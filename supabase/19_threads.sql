-- =====================================================================
-- 19_threads.sql — Threads-cijfers van @the_hague_beachlife in het dashboard (02-10-2026, chat 06)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Vooraf: sleutel in de Vault als 'threads_access_token' (Marnix zelf, via Integrations > Vault).
-- Alles of niets: gaat er iets mis, dan wordt niets van dit bestand bewaard.
--
-- Bron: de Threads API van Meta (graph.threads.net/v1.0), eigen Meta-app met use case "Access the Threads API",
--       rechten threads_basic + threads_manage_insights. Sleutel = long-lived (60 dagen), verlengt zichzelf (di + vr).
-- Wat Meta geeft (docs, 02-10):
--   account (per periode): views (Meta: "hoe vaak je profiel bekeken werd"), likes, replies (alleen eerste laag),
--                          reposts, quotes, clicks (klikken op links in je posts), followers_count (alleen de stand van nu),
--                          follower_demographics (land/stad/leeftijd/geslacht, vanaf 100 volgers)
--   per post (lifetime):   views, likes, replies, reposts, quotes, shares
--   Geen bereik (unieke kijkers), geen nieuwe volgers per post, geen nieuwe/weg-volgers per dag.
--   → nieuwe volgers per dag rekenen we zelf: verschil in volgers tussen twee Haagse dagen (th_profiel_dag).
-- Dagen: account-cijfers per Meta-dag (Los Angeles-tijd, net als Insta: bij ons van 09:00 tot 09:00).
--        Volgers en cijfers per post per Haagse dag.
-- Tijdslimiet (zie VOLGENDE-CHAT "Tijden en tijdslimieten"): th_live (vanuit de app) stopt na 6 s met nieuwe
--   stappen, elke vraag aan Meta hooguit 3 s, op een slot hooguit 2 s → ruim binnen de 15 s.
-- =====================================================================

-- 1. Tabellen (voorvoegsel th_)
create table if not exists public.th_account (
  th_id           text primary key,                 -- Threads user-id
  gebruikersnaam  text not null default '',
  naam            text not null default '',
  bio             text not null default '',
  profielfoto     text,                              -- tijdelijke link van Meta
  geverifieerd    boolean,
  volgers         integer,
  bijgewerkt_om   timestamptz not null default now() -- laatste keer dat het ophalen lukte
);
create table if not exists public.th_profiel_dag (     -- volgers per Haagse dag (laatste stand van die dag)
  th_id       text not null references public.th_account(th_id) on delete cascade,
  dag         date not null,
  volgers     integer,
  gemeten_om  timestamptz not null default now(),
  primary key (th_id, dag)
);
create table if not exists public.th_account_dag (     -- per Meta-dag: {"views":..,"likes":..,"replies":..,"reposts":..,"quotes":..,"clicks":..}
  th_id         text  not null references public.th_account(th_id) on delete cascade,
  dag           date  not null,
  cijfers       jsonb not null default '{}',
  opgehaald_om  timestamptz not null default now(),
  primary key (th_id, dag)
);
create table if not exists public.th_media (
  media_id       text primary key,
  th_id          text not null references public.th_account(th_id) on delete cascade,
  soort          text not null default '',          -- TEXT_POST / IMAGE / VIDEO / CAROUSEL_ALBUM / AUDIO / REPOST_FACADE
  product        text not null default '',          -- THREADS
  gepost_om      timestamptz,
  tekst          text not null default '',
  permalink      text,
  plaatje        text,                               -- tijdelijke link van Meta
  is_quote       boolean,
  link           text,                               -- link in de post (link_attachment_url)
  gezien_om      timestamptz not null default now(), -- laatst in de lijst van Meta gezien
  insights_om    timestamptz,
  insights_fout  text
);
create index if not exists th_media_gepost on public.th_media (th_id, gepost_om desc);
create table if not exists public.th_media_dag (       -- per post per Haagse dag de stand (lifetime): zo zie je hoe een post groeit
  media_id    text  not null references public.th_media(media_id) on delete cascade,
  dag         date  not null,
  cijfers     jsonb not null default '{}',          -- {"views":..,"likes":..,"replies":..,"reposts":..,"quotes":..,"shares":..}
  gemeten_om  timestamptz not null default now(),
  primary key (media_id, dag)
);
create table if not exists public.th_demografie (      -- waar wonen je volgers? (1x per week; Meta geeft het pas vanaf 100 volgers)
  th_id       text not null references public.th_account(th_id) on delete cascade,
  soort       text not null,                         -- country / city / age / gender
  dag         date not null,
  data        jsonb not null default '{}',           -- {"NL": 812, "BE": 40, ...} of {"The Hague, South Holland, Netherlands": 120, ...}
  fout        text,
  gemeten_om  timestamptz not null default now(),
  primary key (th_id, soort, dag)
);
create table if not exists public.th_ververst (        -- laatste keer dat de app (th_live) verversde
  id   int primary key default 1 check (id = 1),
  om   timestamptz not null,
  fout text
);
create table if not exists public.th_token (           -- eigen tabel (niet ig_token: de app leest daar 1 regel zonder filter)
  naam             text primary key,
  verloopt_op      timestamptz,
  geschat          boolean not null default false,   -- true = nog niet door Meta bevestigd
  verlengd_om      timestamptz,
  fout             text,
  gecontroleerd_om timestamptz
);

-- 2. Beveiliging: alleen Marnix mag lezen; schrijven doet alleen de database zelf
do $$
declare t text;
begin
  foreach t in array array['th_account','th_profiel_dag','th_account_dag','th_media','th_media_dag','th_demografie','th_ververst','th_token'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "alleen marnix mag lezen" on public.%I', t);
    execute format('create policy "alleen marnix mag lezen" on public.%I for select to authenticated using ((select public.is_marnix()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- per post de nieuwste stand (bekijkt de tabellen met de rechten van de kijker)
create or replace view public.th_media_laatst
with (security_invoker = true) as
select m.*, d.dag as cijfers_dag, d.cijfers
  from public.th_media m
  left join lateral (select dag, cijfers from public.th_media_dag x
                      where x.media_id = m.media_id order by dag desc limit 1) d on true;
revoke all on public.th_media_laatst from anon, authenticated;
grant select on public.th_media_laatst to authenticated;

-- 3. Hulpfunctie: vraag iets op bij Threads (sleutel uit de Vault, komt nooit in een foutmelding)
create or replace function public.th_get(pad text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  k   text;
  url text;
  r   extensions.http_response;
  msg text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'threads_access_token' limit 1;
  if k is null then
    raise exception 'Geen threads_access_token gevonden in de Vault';
  end if;
  if pad like 'http%' then
    url := pad;                                          -- volgende pagina: sleutel zit al in de link
  else
    url := 'https://graph.threads.net/v1.0/' || pad
           || case when pad like '%?%' then '&' else '?' end || 'access_token=' || k;
  end if;
  r := extensions.http_get(url);
  if r.status <> 200 then
    begin
      msg := r.content::jsonb->'error'->>'message';
    exception when others then
      msg := left(r.content, 200);
    end;
    raise exception 'Threads fout % bij %: %', r.status,
      split_part(regexp_replace(pad, '^https?://[^/]+/(v[0-9.]+/)?', ''), '?', 1), left(coalesce(msg, ''), 200);
  end if;
  return r.content::jsonb;
end;
$$;

-- 4. Hulpje: één getal uit een stukje antwoord van Meta, wat de vorm ook is
--    {"total_value":{"value":5}}  |  {"values":[{"value":3},{"value":4}]} (opgeteld)  |  {"link_total_values":[{"value":2,"link_url":..}]} (opgeteld)
create or replace function public.th_waarde(e jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (e->'total_value'->>'value')::numeric,
    (select sum((v->>'value')::numeric) from jsonb_array_elements(case jsonb_typeof(e->'values') when 'array' then e->'values' else '[]' end) v
      having count(v->>'value') > 0),
    (select sum((v->>'value')::numeric) from jsonb_array_elements(case jsonb_typeof(e->'link_total_values') when 'array' then e->'link_total_values' else '[]' end) v
      having count(v->>'value') > 0));
$$;

-- 5. Cijfers van één post (probeert eerst alles, dan steeds minder: 'shares' en 'views' zijn bij Meta nog "in ontwikkeling")
create or replace function public.th_media_cijfers(p_media_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  sets   text[] := array['views,likes,replies,reposts,quotes,shares', 'views,likes,replies,reposts,quotes', 'likes,replies,reposts,quotes'];
  s      text;
  j      jsonb;
  laatst text;
begin
  foreach s in array sets loop
    begin
      j := th_get(p_media_id || '/insights?metric=' || s);
      exit;
    exception when others then
      laatst := sqlerrm;
    end;
  end loop;
  if j is null then
    raise exception '%', laatst;
  end if;
  return (select coalesce(jsonb_object_agg(x->>'name', th_waarde(x)), '{}')
            from jsonb_array_elements(coalesce(j->'data', '[]')) x
           where th_waarde(x) is not null);
end;
$$;

-- 6. Account-cijfers van één Meta-dag (likes, replies, reposts, quotes, clicks), tot nu als de dag nog loopt.
--    Lukt de bundel niet: één voor één, zodat één kapotte metriek de rest niet tegenhoudt.
create or replace function public.th_dag_totalen(p_dag date)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  metrieken text[] := array['likes','replies','reposts','quotes','clicks'];
  van   bigint := extract(epoch from (p_dag::timestamp at time zone 'America/Los_Angeles'))::bigint;
  tot   bigint := extract(epoch from least(now(), (p_dag + 1)::timestamp at time zone 'America/Los_Angeles'))::bigint;
  j     jsonb;
  c     jsonb := '{}';
  met   text;
  fout  text;
begin
  if tot <= van then
    return '{}';                                       -- die dag is nog niet begonnen
  end if;
  begin
    j := th_get('me/threads_insights?metric=' || array_to_string(metrieken, ',') || '&since=' || van || '&until=' || tot);
    select coalesce(jsonb_object_agg(e->>'name', th_waarde(e)), '{}') into c
      from jsonb_array_elements(coalesce(j->'data', '[]')) e where th_waarde(e) is not null;
    -- clicks zonder klikken: Meta geeft dan een lege lijst → 0 (anders lijkt het "nie gemeten")
    if exists (select 1 from jsonb_array_elements(coalesce(j->'data', '[]')) e where e->>'name' = 'clicks') and not c ? 'clicks' then
      c := c || '{"clicks": 0}';
    end if;
  exception when others then
    foreach met in array metrieken loop
      begin
        j := th_get('me/threads_insights?metric=' || met || '&since=' || van || '&until=' || tot);
        select c || coalesce(jsonb_object_agg(e->>'name', coalesce(th_waarde(e), 0)), '{}') into c
          from jsonb_array_elements(coalesce(j->'data', '[]')) e;
      exception when others then
        fout := coalesce(fout, sqlerrm);
      end;
    end loop;
    if c = '{}' and fout is not null then
      raise exception '%', fout;                       -- niks gelukt: fout naar boven
    end if;
  end;
  return c;
end;
$$;

-- 7. "views" van het account is een reeks per dag: één vraag voor de hele periode, elke waarde op z'n dag zetten.
--    Meta geeft per dag een end_time (einde van die dag); de dag zelf = end_time min 1 dag (UTC-datum).
create or replace function public.th_views_reeks(p_acc text, p_van date, p_tot date)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  van bigint := extract(epoch from (p_van::timestamp at time zone 'America/Los_Angeles'))::bigint;
  tot bigint := extract(epoch from least(now(), (p_tot + 1)::timestamp at time zone 'America/Los_Angeles'))::bigint;
  j   jsonb;
  v   jsonb;
  n   int := 0;
begin
  j := th_get('me/threads_insights?metric=views&since=' || van || '&until=' || tot);
  for v in select x from jsonb_array_elements(coalesce(j->'data', '[]')) e,
                         jsonb_array_elements(case jsonb_typeof(e->'values') when 'array' then e->'values' else '[]' end) x
            where e->>'name' = 'views' and x->>'value' is not null and x->>'end_time' is not null loop
    insert into th_account_dag (th_id, dag, cijfers, opgehaald_om)
    values (p_acc, (((v->>'end_time')::timestamptz - interval '1 day') at time zone 'UTC')::date,
            jsonb_build_object('views', (v->>'value')::numeric), now())
    on conflict (th_id, dag) do update set cijfers = th_account_dag.cijfers || excluded.cijfers, opgehaald_om = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- 8. Volgers van nu (followers_count kent geen periode) → th_account + th_profiel_dag (Haagse dag)
create or replace function public.th_volgers_bewaar(p_acc text)
returns integer
language plpgsql
security definer
set search_path = public, extensions
set timezone to 'Europe/Amsterdam'
as $$
declare
  j  jsonb;
  vg integer;
begin
  j := th_get('me/threads_insights?metric=followers_count');
  select th_waarde(e)::int into vg from jsonb_array_elements(coalesce(j->'data', '[]')) e where e->>'name' = 'followers_count' limit 1;
  if vg is null then
    raise exception 'Threads gaf geen followers_count terug';
  end if;
  update th_account set volgers = vg, bijgewerkt_om = now() where th_id = p_acc;
  insert into th_profiel_dag (th_id, dag, volgers, gemeten_om) values (p_acc, current_date, vg, now())
  on conflict (th_id, dag) do update set volgers = excluded.volgers, gemeten_om = now();
  return vg;
end;
$$;

-- 9. Eén pagina posts opslaan (gebruikt door th_refresh en th_live)
create or replace function public.th_posts_bewaar(p_acc text, j jsonb)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  x jsonb;
  n int := 0;
begin
  for x in select * from jsonb_array_elements(coalesce(j->'data', '[]')) loop
    continue when x->>'id' is null;
    insert into th_media (media_id, th_id, soort, product, gepost_om, tekst, permalink, plaatje, is_quote, link, gezien_om)
    values (x->>'id', p_acc, coalesce(x->>'media_type', ''), coalesce(x->>'media_product_type', ''),
            (x->>'timestamp')::timestamptz, coalesce(x->>'text', ''), x->>'permalink',
            coalesce(x->>'thumbnail_url', x->>'media_url'), (x->>'is_quote_post')::boolean, x->>'link_attachment_url', now())
    on conflict (media_id) do update
       set soort = excluded.soort, product = excluded.product, gepost_om = excluded.gepost_om, tekst = excluded.tekst,
           permalink = excluded.permalink, plaatje = excluded.plaatje, is_quote = excluded.is_quote, link = excluded.link,
           gezien_om = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- 10. Hoofdfunctie (elke nacht via pg_cron): profiel, volgers, account-cijfers per dag, alle posts, cijfers per post,
--     en 1x per week waar je volgers wonen.
--     dagen       = hoeveel Meta-dagen account-cijfers terug (standaard 3; Meta kan achterlopen)
--     extra_posts = naast alle posts van de laatste 30 dagen: zoveel oudere posts (die het langst niet bijgewerkt zijn)
create or replace function public.th_refresh(dagen integer default 3, extra_posts integer default 60)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
set timezone to 'Europe/Amsterdam'
as $$
declare
  start     timestamptz := now();
  klok      timestamptz := clock_timestamp();
  acc       text;
  j         jsonb;
  m         record;
  d         date;
  vandaag_meta date := (now() at time zone 'America/Los_Angeles')::date;
  basis     text := 'me/threads?fields=id,media_product_type,media_type,permalink,text,timestamp,is_quote_post,thumbnail_url,media_url,link_attachment_url&limit=100';
  volgende  text;
  paginas   int := 0;
  c         jsonb;
  b         text;
  n_dagen   int := 0;
  n_views   int := 0;
  n_posts   int := 0;
  n_cijfers int := 0;
  n_demo    int := 0;
  volgers   int;
  fouten    text[] := '{}';
begin
  perform alleen_marnix();

  -- a. profiel
  j := th_get('me?fields=id,username,name,threads_profile_picture_url,threads_biography,is_verified');
  acc := j->>'id';
  insert into th_account (th_id, gebruikersnaam, naam, bio, profielfoto, geverifieerd, bijgewerkt_om)
  values (acc, coalesce(j->>'username', ''), coalesce(j->>'name', ''), coalesce(j->>'threads_biography', ''),
          j->>'threads_profile_picture_url', (j->>'is_verified')::boolean, now())
  on conflict (th_id) do update
     set gebruikersnaam = excluded.gebruikersnaam, naam = excluded.naam, bio = excluded.bio,
         profielfoto = excluded.profielfoto, geverifieerd = excluded.geverifieerd, bijgewerkt_om = now();

  -- b. volgers van nu
  begin
    volgers := th_volgers_bewaar(acc);
  exception when others then
    fouten := fouten || ('volgers: ' || left(sqlerrm, 120));
  end;

  -- c. account-cijfers per Meta-dag
  d := vandaag_meta - (greatest(dagen, 1) - 1);
  while d <= vandaag_meta loop
    begin
      c := th_dag_totalen(d);
      if c <> '{}' then
        insert into th_account_dag (th_id, dag, cijfers, opgehaald_om) values (acc, d, c, now())
        on conflict (th_id, dag) do update set cijfers = th_account_dag.cijfers || excluded.cijfers, opgehaald_om = now();
        n_dagen := n_dagen + 1;
      end if;
    exception when others then
      if cardinality(fouten) < 20 then fouten := fouten || (to_char(d, 'YYYY-MM-DD') || ': ' || left(sqlerrm, 100)); end if;
    end;
    d := d + 1;
  end loop;
  begin
    n_views := th_views_reeks(acc, vandaag_meta - (greatest(dagen, 1) - 1), vandaag_meta);
  exception when others then
    fouten := fouten || ('views: ' || left(sqlerrm, 120));
  end;

  -- d. alle posts (per 100, pagina voor pagina; hooguit 50 pagina's = 5.000 posts)
  volgende := basis;
  while volgende is not null and paginas < 50 loop
    j := th_get(volgende);
    n_posts := n_posts + th_posts_bewaar(acc, j);
    paginas := paginas + 1;
    volgende := coalesce(j->'paging'->>'next',
                         case when jsonb_array_length(coalesce(j->'data', '[]')) >= 100 and j->'paging'->'cursors'->>'after' is not null
                              then basis || '&after=' || (j->'paging'->'cursors'->>'after') end);
  end loop;

  -- e. cijfers per post: alle posts van de laatste 30 dagen + de oudere die het langst wachten
  --    (reposts van een ander = REPOST_FACADE: daar geeft Meta geen cijfers voor)
  for m in
    select media_id from th_media
     where th_id = acc and gezien_om >= start and soort <> 'REPOST_FACADE'
       and (gepost_om > now() - interval '30 days'
            or media_id in (select media_id from th_media
                             where th_id = acc and gezien_om >= start and soort <> 'REPOST_FACADE'
                               and gepost_om <= now() - interval '30 days'
                             order by insights_om asc nulls first, gepost_om desc
                             limit greatest(extra_posts, 0)))
     order by gepost_om desc
  loop
    begin
      c := th_media_cijfers(m.media_id);
      insert into th_media_dag (media_id, dag, cijfers, gemeten_om) values (m.media_id, current_date, c, now())
      on conflict (media_id, dag) do update set cijfers = th_media_dag.cijfers || excluded.cijfers, gemeten_om = now();
      update th_media set insights_om = now(), insights_fout = null where media_id = m.media_id;
      n_cijfers := n_cijfers + 1;
    exception when others then
      update th_media set insights_om = now(), insights_fout = left(sqlerrm, 200) where media_id = m.media_id;
      if cardinality(fouten) < 20 then fouten := fouten || ('post ' || m.media_id || ': ' || left(sqlerrm, 80)); end if;
    end;
  end loop;

  -- f. waar wonen je volgers? (1x per week, 4 vragen)
  if not exists (select 1 from th_demografie where th_id = acc and fout is null and gemeten_om > now() - interval '6 days') then
    foreach b in array array['country', 'city', 'age', 'gender'] loop
      begin
        j := th_get('me/threads_insights?metric=follower_demographics&breakdown=' || b);
        select coalesce(jsonb_object_agg(r->'dimension_values'->>0, (r->>'value')::numeric), '{}') into c
          from jsonb_array_elements(coalesce(j->'data', '[]')) e,
               jsonb_array_elements(coalesce(e->'total_value'->'breakdowns'->0->'results', '[]')) r
         where r->'dimension_values'->>0 is not null;
        insert into th_demografie (th_id, soort, dag, data, fout, gemeten_om) values (acc, b, current_date, c, null, now())
        on conflict (th_id, soort, dag) do update set data = excluded.data, fout = null, gemeten_om = now();
        n_demo := n_demo + 1;
      exception when others then
        insert into th_demografie (th_id, soort, dag, data, fout, gemeten_om) values (acc, b, current_date, '{}', left(sqlerrm, 200), now())
        on conflict (th_id, soort, dag) do update set fout = excluded.fout, gemeten_om = now();
        if cardinality(fouten) < 20 then fouten := fouten || ('demografie ' || b || ': ' || left(sqlerrm, 80)); end if;
      end;
    end loop;
  end if;

  return jsonb_build_object('account', acc, 'gebruikersnaam', (select gebruikersnaam from th_account where th_id = acc),
                            'volgers', volgers, 'dagen', n_dagen, 'views_dagen', n_views, 'posts', n_posts,
                            'posts_met_cijfers', n_cijfers, 'demografie', n_demo,
                            'seconden', round(extract(epoch from clock_timestamp() - klok)::numeric, 1),
                            'fouten', fouten);
end;
$$;

-- 11. Voor de app (dashboard openen / Ververse): snel een paar verse cijfers, hooguit 1x per 5-10 min.
--     Na 6 s niks nieuws meer beginnen; elke vraag hooguit 3 s; slot van een ander klusje hooguit 2 s.
create or replace function public.th_live(min_minuten int default 10)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
set timezone to 'Europe/Amsterdam'
as $$
declare
  klok     timestamptz := clock_timestamp();
  max_sec  numeric := 6;                 -- daarna niks nieuws meer beginnen (Supabase breekt af na 15 s)
  laatst   timestamptz;
  acc      text;
  j        jsonb;
  m        record;
  c        jsonb;
  d        date := (now() at time zone 'America/Los_Angeles')::date;
  stappen  text[] := '{}';
  fouten   text[] := '{}';
  stuk     boolean := false;             -- sleutel geweigerd: dan de rest overslaan (scheelt wachten)
begin
  perform alleen_marnix();
  perform set_config('http.timeout_msec', '3000', true);
  perform set_config('lock_timeout', '2s', true);
  select om into laatst from th_ververst where id = 1;
  if laatst is not null and laatst > now() - make_interval(mins => greatest(coalesce(min_minuten, 10), 5)) then
    return jsonb_build_object('ververst', false, 'om', laatst, 'fout', null);
  end if;
  select th_id into acc from th_account order by bijgewerkt_om desc limit 1;
  if acc is null then
    return jsonb_build_object('ververst', false, 'om', laatst, 'fout', 'nog geen Threads-account: draai eerst th_refresh');
  end if;

  -- a. volgers van nu
  begin
    perform th_volgers_bewaar(acc);
    stappen := stappen || 'volgers'::text;
  exception when others then
    fouten := fouten || ('volgers: ' || left(sqlerrm, 100));
    stuk := sqlerrm ~* '(access token|OAuthException|not authori[sz]ed|session has expired|code 190)';
  end;

  -- b. likes/reacties/reposts/quotes/klikken van vandaag (Meta-dag) tot nu
  if extract(epoch from clock_timestamp() - klok) < max_sec and not stuk then
    begin
      c := th_dag_totalen(d);
      if c <> '{}' then
        insert into th_account_dag (th_id, dag, cijfers, opgehaald_om) values (acc, d, c, now())
        on conflict (th_id, dag) do update set cijfers = th_account_dag.cijfers || excluded.cijfers, opgehaald_om = now();
      end if;
      stappen := stappen || 'vandaag'::text;
    exception when others then
      fouten := fouten || ('vandaag: ' || left(sqlerrm, 100));
    end;
  end if;

  -- c. weergaven van gistâh en vandaag
  if extract(epoch from clock_timestamp() - klok) < max_sec and not stuk then
    begin
      perform th_views_reeks(acc, d - 1, d);
      stappen := stappen || 'views'::text;
    exception when others then
      fouten := fouten || ('views: ' || left(sqlerrm, 100));
    end;
  end if;

  -- d. nieuwste 10 posts (een post van vandaag komt er zo meteen in)
  if extract(epoch from clock_timestamp() - klok) < max_sec and not stuk then
    begin
      j := th_get('me/threads?fields=id,media_product_type,media_type,permalink,text,timestamp,is_quote_post,thumbnail_url,media_url,link_attachment_url&limit=10');
      perform th_posts_bewaar(acc, j);
      stappen := stappen || 'posts'::text;
    exception when others then
      fouten := fouten || ('posts: ' || left(sqlerrm, 100));
    end;
  end if;

  -- e. cijfers van (hooguit 3) posts van de laatste 2 dagen: daar verandert het meest
  for m in select media_id from th_media
            where th_id = acc and soort <> 'REPOST_FACADE' and gepost_om > now() - interval '2 days'
            order by gepost_om desc limit 3 loop
    exit when extract(epoch from clock_timestamp() - klok) >= max_sec or stuk;
    begin
      c := th_media_cijfers(m.media_id);
      insert into th_media_dag (media_id, dag, cijfers, gemeten_om) values (m.media_id, current_date, c, now())
      on conflict (media_id, dag) do update set cijfers = th_media_dag.cijfers || excluded.cijfers, gemeten_om = now();
      update th_media set insights_om = now(), insights_fout = null where media_id = m.media_id;
      stappen := stappen || ('post ' || m.media_id);
    exception when others then
      fouten := fouten || ('post ' || m.media_id || ': ' || left(sqlerrm, 100));
    end;
  end loop;

  insert into th_ververst (id, om, fout) values (1, now(), fouten[1])
  on conflict (id) do update set om = now(), fout = excluded.fout;
  return jsonb_build_object('ververst', true, 'om', now(), 'stappen', stappen, 'fout', fouten[1], 'fouten', fouten,
                            'seconden', round(extract(epoch from clock_timestamp() - klok)::numeric, 1));
end;
$$;

-- 12. Sleutel automatisch verlengen (Meta: sleutel moet minstens 24 uur oud zijn; daarna weer 60 dagen geldig).
--     Let op: een Threads-sleutel die 60 dagen niet verlengd is, is voorgoed dood (dan een nieuwe maken).
create or replace function public.th_token_verlengen()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s   record;
  r   extensions.http_response;
  j   jsonb;
  msg text;
  tot timestamptz;
begin
  perform alleen_marnix();
  select id, decrypted_secret, updated_at into s
    from vault.decrypted_secrets where name = 'threads_access_token' limit 1;
  if s.id is null then
    raise exception 'Geen threads_access_token gevonden in de Vault';
  end if;
  if s.updated_at > now() - interval '25 hours' then
    return jsonb_build_object('verlengd', false, 'reden', 'sleutel is nog geen 24 uur oud');
  end if;

  r := extensions.http_get('https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token='
                           || s.decrypted_secret);
  if r.status <> 200 then
    begin
      msg := r.content::jsonb->'error'->>'message';
    exception when others then
      msg := null;
    end;
    insert into th_token (naam, fout, gecontroleerd_om)
    values ('threads_access_token', 'Status ' || r.status || ': ' || left(coalesce(msg, ''), 150), now())
    on conflict (naam) do update set fout = excluded.fout, gecontroleerd_om = now();
    return jsonb_build_object('verlengd', false, 'status', r.status);
  end if;

  j := r.content::jsonb;
  if coalesce(j->>'access_token', '') = '' then
    raise exception 'Threads gaf geen nieuwe sleutel terug';
  end if;
  perform vault.update_secret(s.id, j->>'access_token');
  tot := now() + make_interval(secs => coalesce((j->>'expires_in')::int, 5184000));
  insert into th_token (naam, verloopt_op, geschat, verlengd_om, fout, gecontroleerd_om)
  values ('threads_access_token', tot, false, now(), null, now())
  on conflict (naam) do update
     set verloopt_op = tot, geschat = false, verlengd_om = now(), fout = null, gecontroleerd_om = now();
  return jsonb_build_object('verlengd', true, 'verloopt_op', tot);
end;
$$;

-- beginstand: 60 dagen na het moment dat de sleutel in de Vault kwam (geschat, tot de eerste verlenging)
insert into public.th_token (naam, verloopt_op, geschat)
select 'threads_access_token',
       coalesce((select updated_at from vault.decrypted_secrets where name = 'threads_access_token' limit 1), now()) + interval '60 days',
       true
on conflict (naam) do nothing;

-- 13. Rechten: de app mag alleen th_live (met het slot alleen_marnix erin); de rest alleen de database zelf
revoke execute on function public.th_get(text)                   from public, anon, authenticated;
revoke execute on function public.th_waarde(jsonb)               from public, anon, authenticated;
revoke execute on function public.th_media_cijfers(text)         from public, anon, authenticated;
revoke execute on function public.th_dag_totalen(date)           from public, anon, authenticated;
revoke execute on function public.th_views_reeks(text, date, date) from public, anon, authenticated;
revoke execute on function public.th_volgers_bewaar(text)        from public, anon, authenticated;
revoke execute on function public.th_posts_bewaar(text, jsonb)   from public, anon, authenticated;
revoke execute on function public.th_refresh(integer, integer)   from public, anon, authenticated;
revoke execute on function public.th_token_verlengen()           from public, anon, authenticated;
revoke execute on function public.th_live(int)                   from public, anon;
grant  execute on function public.th_live(int)                   to authenticated;

-- 14. Automatisch (pg_cron rekent in UTC)
--     elke nacht 05:15 UTC: alles bijwerken  |  di + vr 03:57 UTC: sleutel verlengen
select cron.unschedule(jobname) from cron.job where jobname in ('threads-dagelijks', 'threads-sleutel-verlengen');
select cron.schedule('threads-dagelijks',         '15 5 * * *',   'select public.th_refresh(3, 60)');
select cron.schedule('threads-sleutel-verlengen', '57 3 * * 2,5', 'select public.th_token_verlengen()');

-- 15. Test nu meteen: 30 dagen account-cijfers, alle posts, cijfers van de posts van 30 dagen + 40 oudere,
--     en waar je volgers wonen. Verwacht: "fouten": [] (of een paar, zie uitleg in de chat).
select public.th_refresh(30, 40) as threads;
