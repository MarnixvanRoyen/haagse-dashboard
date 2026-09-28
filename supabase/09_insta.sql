-- =====================================================================
-- 09_insta.sql — Insta-cijfers van @the_hague_beachlife in het dashboard (28-09-2026)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Vooraf: sleutel in de Vault als 'instagram_access_token' (gedaan 28-09).
-- Alles of niets: gaat er iets mis, dan wordt niets van dit bestand bewaard.
-- =====================================================================

-- 1. Het slot: alleen Marnix (of de database zelf: pg_cron en de SQL Editor)
--    is_marnix()     = ja/nee (voor de beveiligingsregels van de tabellen)
--    alleen_marnix() = stopt met een foutmelding als het iemand anders is (voor in functies)
create or replace function public.is_marnix()
returns boolean
language sql
stable
set search_path = ''
as $$
  select (session_user::text <> 'authenticator'                                  -- niet via de website/API ...
          and nullif(current_setting('request.jwt.claims', true), '') is null)   -- ... en zonder inlog = de database zelf
      or coalesce(auth.uid() = '94a9eceb-d804-4e47-bd22-48a79fd339ac'::uuid, false);  -- of ingelogd als Marnix
$$;

create or replace function public.alleen_marnix()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.is_marnix() then
    raise exception 'Alleen voor Marnix' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.is_marnix()     from public, anon;
grant  execute on function public.is_marnix()     to authenticated;
revoke execute on function public.alleen_marnix() from public, anon, authenticated;

-- 2. Het slot ook in de 5 bestaande functies die de app mag aanroepen.
--    We passen de functie aan zoals hij NU in de database staat (niet uit een oud bestand):
--    direct na de eerste "begin" komt de regel "perform public.alleen_marnix();".
do $$
declare
  f     text;
  def   text;
  nieuw text;
begin
  foreach f in array array['public.gc_live(integer)', 'public.gc_refresh(integer)',
                           'public.muziek_live(text,integer)', 'public.sc_refresh()', 'public.yt_refresh()'] loop
    def := pg_get_functiondef(f::regprocedure);
    continue when def like '%alleen_marnix()%';          -- zit er al in (bij opnieuw draaien)
    nieuw := regexp_replace(def, E'\\n(begin)(\\r?\\n)',
                            E'\n\\1\\2  perform public.alleen_marnix();   -- slot: alleen Marnix (of de database zelf)\\2');
    if nieuw = def then
      raise exception 'Kon het slot niet plaatsen in %', f;
    end if;
    execute nieuw;
  end loop;
end $$;

-- 3. Tabellen (voorvoegsel ig_)
--    ig_account:     het Insta-account zelf (laatste stand)
--    ig_profiel_dag: per Haagse dag: volgers, volgend, aantal posts
--    ig_account_dag: per dag de account-cijfers van Meta (bereik, weergaven, interacties, ...)
--                    LET OP: Meta's dag loopt in Amerikaanse tijd (Los Angeles), dus 9 uur achter op Den Haag
--    ig_media:       alle posts en reels (bijschrift, link, soort, likes/reacties)
--    ig_media_dag:   per post per Haagse dag de cijfers (zo zie je hoe een post groeit)
--    ig_story:       stories (verdwijnen na 24 uur, dus elk uur meten)
--    ig_token:       wanneer verloopt de sleutel, wanneer verlengd
create table if not exists public.ig_account (
  ig_id           text primary key,              -- Instagram user_id (1784...)
  gebruikersnaam  text not null default '',
  naam            text not null default '',
  soort           text not null default '',       -- MEDIA_CREATOR / BUSINESS
  volgers         integer,
  volgend         integer,
  posts           integer,
  profielfoto     text,
  bijgewerkt_om   timestamptz not null default now()
);
create table if not exists public.ig_profiel_dag (
  ig_id       text not null references public.ig_account(ig_id) on delete cascade,
  dag         date not null,
  volgers     integer,
  volgend     integer,
  posts       integer,
  gemeten_om  timestamptz not null default now(),
  primary key (ig_id, dag)
);
create table if not exists public.ig_account_dag (
  ig_id         text  not null references public.ig_account(ig_id) on delete cascade,
  dag           date  not null,                   -- Meta-dag (Los Angeles-tijd)
  cijfers       jsonb not null default '{}',      -- {"reach":..., "views":..., "follows":..., ...}
  opgehaald_om  timestamptz not null default now(),
  primary key (ig_id, dag)
);
create table if not exists public.ig_media (
  media_id       text primary key,
  ig_id          text not null references public.ig_account(ig_id) on delete cascade,
  soort          text not null default '',        -- IMAGE / VIDEO / CAROUSEL_ALBUM
  product        text not null default '',        -- FEED / REELS
  gepost_om      timestamptz,
  bijschrift     text not null default '',
  permalink      text,
  plaatje        text,                             -- tijdelijke link van Meta (verloopt na een tijd)
  likes          integer,
  reacties       integer,
  gezien_om      timestamptz not null default now(),   -- laatst in de lijst van Meta gezien
  insights_om    timestamptz,                          -- laatst cijfers opgehaald
  insights_fout  text
);
create index if not exists ig_media_gepost on public.ig_media (ig_id, gepost_om desc);
create table if not exists public.ig_media_dag (
  media_id     text  not null references public.ig_media(media_id) on delete cascade,
  dag          date  not null,                    -- Haagse dag
  cijfers      jsonb not null default '{}',       -- {"reach":..., "views":..., "likes":..., "saved":..., ...}
  gemeten_om   timestamptz not null default now(),
  primary key (media_id, dag)
);
create table if not exists public.ig_story (
  media_id           text primary key,
  ig_id              text not null references public.ig_account(ig_id) on delete cascade,
  soort              text not null default '',
  gepost_om          timestamptz,
  permalink          text,
  plaatje            text,
  cijfers            jsonb not null default '{}',
  laatst_gemeten_om  timestamptz,
  fout               text
);
create table if not exists public.ig_token (
  naam         text primary key,
  verloopt_op  timestamptz,
  geschat      boolean not null default false,     -- true = nog niet door Meta bevestigd
  verlengd_om  timestamptz,
  fout         text,
  gecontroleerd_om timestamptz
);

-- 4. Beveiliging: alleen Marnix mag lezen; schrijven doet alleen de database zelf
do $$
declare t text;
begin
  foreach t in array array['ig_account','ig_profiel_dag','ig_account_dag','ig_media','ig_media_dag','ig_story','ig_token'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "alleen marnix mag lezen" on public.%I', t);
    execute format('create policy "alleen marnix mag lezen" on public.%I for select to authenticated using ((select public.is_marnix()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Handig voor de app: per post de nieuwste cijfers (bekijkt de tabellen met de rechten van de kijker)
create or replace view public.ig_media_laatst
with (security_invoker = true) as
select m.*, d.dag as cijfers_dag, d.cijfers
  from public.ig_media m
  left join lateral (select dag, cijfers from public.ig_media_dag x
                      where x.media_id = m.media_id order by dag desc limit 1) d on true;
revoke all on public.ig_media_laatst from anon, authenticated;
grant select on public.ig_media_laatst to authenticated;

-- 5. Hulpfunctie: vraag iets op bij Instagram (sleutel komt uit de Vault)
--    pad = bijv. 'me?fields=username', of een volledige link (volgende pagina van een lijst)
create or replace function public.ig_get(pad text)
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
  select decrypted_secret into k from vault.decrypted_secrets where name = 'instagram_access_token' limit 1;
  if k is null then
    raise exception 'Geen instagram_access_token gevonden in de Vault';
  end if;
  if pad like 'http%' then
    url := pad;                                          -- volgende pagina: sleutel zit al in de link
  else
    url := 'https://graph.instagram.com/v25.0/' || pad
           || case when pad like '%?%' then '&' else '?' end || 'access_token=' || k;
  end if;
  r := extensions.http_get(url);
  if r.status <> 200 then
    begin
      msg := r.content::jsonb->'error'->>'message';          -- nette melding van Meta
    exception when others then
      msg := left(r.content, 200);                          -- geen JSON (bijv. een HTML-pagina)
    end;
    -- de sleutel staat nooit in de foutmelding: alleen het pad tot het vraagteken
    raise exception 'Instagram fout % bij %: %', r.status, split_part(pad, '?', 1), left(coalesce(msg, ''), 200);
  end if;
  return r.content::jsonb;
end;
$$;

-- 6. Cijfers van één post/reel/story (probeert eerst alles, lukt dat niet dan de basis)
create or replace function public.ig_media_cijfers(p_media_id text, p_product text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  alles text;
  basis text;
  j     jsonb;
begin
  alles := case p_product
             when 'REELS' then 'reach,views,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time'
             when 'STORY' then 'reach,views,replies,shares,total_interactions,follows,profile_visits'
             else              'reach,views,likes,comments,shares,saved,total_interactions,profile_visits,follows'
           end;
  basis := case p_product when 'STORY' then 'reach,views' else 'reach,likes,comments,shares,saved' end;
  begin
    j := ig_get(p_media_id || '/insights?metric=' || alles);
  exception when others then
    j := ig_get(p_media_id || '/insights?metric=' || basis);   -- mislukt dit ook, dan gaat de fout naar boven
  end;
  return (select coalesce(jsonb_object_agg(x->>'name', coalesce(x->'values'->0->'value', x->'total_value'->'value')), '{}')
            from jsonb_array_elements(coalesce(j->'data', '[]')) x
           where coalesce(x->'values'->0->'value', x->'total_value'->'value') is not null);
end;
$$;

-- 7. Hoofdfunctie: account, account-cijfers per dag, alle posts, en cijfers van posts
--    dagen       = hoeveel dagen account-cijfers terug (standaard 3; Meta kan tot 48 uur achterlopen)
--    extra_posts = naast alle posts van de laatste 30 dagen: zoveel oudere posts (die het langst niet bijgewerkt zijn)
create or replace function public.ig_refresh(dagen integer default 3, extra_posts integer default 60)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
set timezone to 'Europe/Amsterdam'
as $$
declare
  start     timestamptz := now();                -- begin van deze ronde (= tijdstip in gezien_om)
  klok      timestamptz := clock_timestamp();    -- om de duur te meten
  acc       text;
  j         jsonb;
  x         jsonb;
  m         record;
  d         date;
  vandaag_meta date := (now() at time zone 'America/Los_Angeles')::date;
  bereik    text;
  volgende  text;
  metrieken text[] := array['reach','views','accounts_engaged','total_interactions','likes','comments',
                            'shares','saves','replies','reposts','profile_links_taps'];
  met       text;
  c         jsonb;
  n_dagen   int := 0;
  n_posts   int := 0;
  n_cijfers int := 0;
  fouten    text[] := '{}';
begin
  perform alleen_marnix();

  -- a. het account zelf + stand van vandaag
  j := ig_get('me?fields=user_id,username,name,account_type,followers_count,follows_count,media_count,profile_picture_url');
  acc := j->>'user_id';
  insert into ig_account (ig_id, gebruikersnaam, naam, soort, volgers, volgend, posts, profielfoto, bijgewerkt_om)
  values (acc, coalesce(j->>'username', ''), coalesce(j->>'name', ''), coalesce(j->>'account_type', ''),
          (j->>'followers_count')::int, (j->>'follows_count')::int, (j->>'media_count')::int,
          j->>'profile_picture_url', now())
  on conflict (ig_id) do update
     set gebruikersnaam = excluded.gebruikersnaam, naam = excluded.naam, soort = excluded.soort,
         volgers = excluded.volgers, volgend = excluded.volgend, posts = excluded.posts,
         profielfoto = excluded.profielfoto, bijgewerkt_om = now();
  insert into ig_profiel_dag (ig_id, dag, volgers, volgend, posts, gemeten_om)
  values (acc, current_date, (j->>'followers_count')::int, (j->>'follows_count')::int, (j->>'media_count')::int, now())
  on conflict (ig_id, dag) do update
     set volgers = excluded.volgers, volgend = excluded.volgend, posts = excluded.posts, gemeten_om = now();

  -- b. account-cijfers per Meta-dag (van middernacht tot middernacht Los Angeles-tijd)
  d := vandaag_meta - (greatest(dagen, 1) - 1);
  while d <= vandaag_meta loop
    bereik := '&period=day&metric_type=total_value'
           || '&since=' || extract(epoch from (d::timestamp at time zone 'America/Los_Angeles'))::bigint
           || '&until=' || extract(epoch from ((d + 1)::timestamp at time zone 'America/Los_Angeles'))::bigint;
    c := '{}';
    begin
      j := ig_get('me/insights?metric=' || array_to_string(metrieken, ',') || bereik);
      select coalesce(jsonb_object_agg(e->>'name', e->'total_value'->'value'), '{}') into c
        from jsonb_array_elements(coalesce(j->'data', '[]')) e where e->'total_value'->'value' is not null;
    exception when others then
      -- lukt het niet in één keer: één voor één, zodat één kapotte metriek de rest niet tegenhoudt
      foreach met in array metrieken loop
        begin
          j := ig_get('me/insights?metric=' || met || bereik);
          select c || coalesce(jsonb_object_agg(e->>'name', e->'total_value'->'value'), '{}') into c
            from jsonb_array_elements(coalesce(j->'data', '[]')) e where e->'total_value'->'value' is not null;
        exception when others then
          if cardinality(fouten) < 20 then fouten := fouten || (to_char(d, 'YYYY-MM-DD') || ' ' || met || ': ' || left(sqlerrm, 80)); end if;
        end;
      end loop;
    end;
    -- nieuwe volgers en ontvolgers
    begin
      j := ig_get('me/insights?metric=follows_and_unfollows&breakdown=follow_type' || bereik);
      select c || coalesce(jsonb_object_agg(case r->'dimension_values'->>0 when 'FOLLOWER' then 'follows' else 'unfollows' end,
                                            r->'value'), '{}') into c
        from jsonb_array_elements(coalesce(j->'data', '[]')) e,
             jsonb_array_elements(coalesce(e->'total_value'->'breakdowns'->0->'results', '[]')) r
       where r->'dimension_values'->>0 in ('FOLLOWER', 'NON_FOLLOWER');
    exception when others then
      if cardinality(fouten) < 20 then fouten := fouten || (to_char(d, 'YYYY-MM-DD') || ' follows: ' || left(sqlerrm, 80)); end if;
    end;
    if c <> '{}' then
      insert into ig_account_dag (ig_id, dag, cijfers, opgehaald_om) values (acc, d, c, now())
      on conflict (ig_id, dag) do update
         set cijfers = ig_account_dag.cijfers || excluded.cijfers, opgehaald_om = now();   -- samenvoegen: oude waarden blijven als iets mislukt
      n_dagen := n_dagen + 1;
    end if;
    d := d + 1;
  end loop;

  -- c. alle posts en reels (per 100, pagina voor pagina)
  volgende := 'me/media?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count&limit=100';
  while volgende is not null loop
    j := ig_get(volgende);
    for x in select * from jsonb_array_elements(coalesce(j->'data', '[]')) loop
      insert into ig_media (media_id, ig_id, soort, product, gepost_om, bijschrift, permalink, plaatje, likes, reacties, gezien_om)
      values (x->>'id', acc, coalesce(x->>'media_type', ''), coalesce(x->>'media_product_type', ''),
              (x->>'timestamp')::timestamptz, coalesce(x->>'caption', ''), x->>'permalink',
              coalesce(x->>'thumbnail_url', x->>'media_url'),
              (x->>'like_count')::int, (x->>'comments_count')::int, now())
      on conflict (media_id) do update
         set soort = excluded.soort, product = excluded.product, gepost_om = excluded.gepost_om,
             bijschrift = excluded.bijschrift, permalink = excluded.permalink, plaatje = excluded.plaatje,
             likes = excluded.likes, reacties = excluded.reacties, gezien_om = now();
      n_posts := n_posts + 1;
    end loop;
    volgende := j->'paging'->>'next';
  end loop;

  -- d. cijfers per post: alle posts van de laatste 30 dagen + de oudere die het langst wachten
  for m in
    select media_id, product from ig_media
     where ig_id = acc and gezien_om >= start
       and (gepost_om > now() - interval '30 days'
            or media_id in (select media_id from ig_media
                             where ig_id = acc and gezien_om >= start and gepost_om <= now() - interval '30 days'
                             order by insights_om asc nulls first, gepost_om desc
                             limit greatest(extra_posts, 0)))
     order by gepost_om desc
  loop
    begin
      c := ig_media_cijfers(m.media_id, m.product);
      insert into ig_media_dag (media_id, dag, cijfers, gemeten_om) values (m.media_id, current_date, c, now())
      on conflict (media_id, dag) do update set cijfers = ig_media_dag.cijfers || excluded.cijfers, gemeten_om = now();
      update ig_media set insights_om = now(), insights_fout = null where media_id = m.media_id;
      n_cijfers := n_cijfers + 1;
    exception when others then
      update ig_media set insights_om = now(), insights_fout = left(sqlerrm, 200) where media_id = m.media_id;
      if cardinality(fouten) < 20 then fouten := fouten || ('post ' || m.media_id || ': ' || left(sqlerrm, 80)); end if;
    end;
  end loop;

  return jsonb_build_object('account', acc, 'dagen', n_dagen, 'posts', n_posts, 'posts_met_cijfers', n_cijfers,
                            'seconden', round(extract(epoch from clock_timestamp() - klok)::numeric, 1),
                            'fouten', fouten);
end;
$$;

-- 8. Stories: die zijn maar 24 uur zichtbaar, dus elk uur meten (de laatste meting blijft bewaard)
create or replace function public.ig_stories_refresh()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  acc    text;
  j      jsonb;
  x      jsonb;
  n      int := 0;
  fouten text[] := '{}';
begin
  perform alleen_marnix();
  select ig_id into acc from ig_account order by bijgewerkt_om desc limit 1;
  if acc is null then
    acc := ig_get('me?fields=user_id')->>'user_id';
    insert into ig_account (ig_id) values (acc) on conflict do nothing;
  end if;
  j := ig_get('me/stories?fields=id,media_type,permalink,thumbnail_url,media_url,timestamp');
  for x in select * from jsonb_array_elements(coalesce(j->'data', '[]')) loop
    insert into ig_story (media_id, ig_id, soort, gepost_om, permalink, plaatje)
    values (x->>'id', acc, coalesce(x->>'media_type', ''), (x->>'timestamp')::timestamptz, x->>'permalink',
            coalesce(x->>'thumbnail_url', x->>'media_url'))
    on conflict (media_id) do update set permalink = excluded.permalink, plaatje = excluded.plaatje;
    begin
      update ig_story set cijfers = cijfers || ig_media_cijfers(x->>'id', 'STORY'),
                          laatst_gemeten_om = now(), fout = null
       where media_id = x->>'id';
      n := n + 1;
    exception when others then
      -- bijv. minder dan 5 kijkers: dan geeft Meta (nog) geen cijfers
      update ig_story set fout = left(sqlerrm, 200), laatst_gemeten_om = now() where media_id = x->>'id';
      fouten := fouten || (x->>'id' || ': ' || left(sqlerrm, 80));
    end;
  end loop;
  return jsonb_build_object('stories', n, 'fouten', fouten);
end;
$$;

-- 9. Sleutel automatisch verlengen (Meta: sleutel moet minstens 24 uur oud zijn; daarna weer 60 dagen geldig)
--    De nieuwe sleutel gaat meteen de Vault in; hij komt nergens in beeld of in een foutmelding.
create or replace function public.ig_token_verlengen()
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
    from vault.decrypted_secrets where name = 'instagram_access_token' limit 1;
  if s.id is null then
    raise exception 'Geen instagram_access_token gevonden in de Vault';
  end if;
  if s.updated_at > now() - interval '25 hours' then
    return jsonb_build_object('verlengd', false, 'reden', 'sleutel is nog geen 24 uur oud');
  end if;

  r := extensions.http_get('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token='
                           || s.decrypted_secret);
  if r.status <> 200 then
    begin
      msg := r.content::jsonb->'error'->>'message';
    exception when others then
      msg := null;
    end;
    -- niet stoppen met een fout, zodat de melding bewaard blijft (dashboard kan waarschuwen)
    insert into ig_token (naam, fout, gecontroleerd_om)
    values ('instagram_access_token', 'Status ' || r.status || ': ' || left(coalesce(msg, ''), 150), now())
    on conflict (naam) do update set fout = excluded.fout, gecontroleerd_om = now();
    return jsonb_build_object('verlengd', false, 'status', r.status);
  end if;

  j := r.content::jsonb;
  if coalesce(j->>'access_token', '') = '' then
    raise exception 'Instagram gaf geen nieuwe sleutel terug';
  end if;
  perform vault.update_secret(s.id, j->>'access_token');
  tot := now() + make_interval(secs => coalesce((j->>'expires_in')::int, 5184000));
  insert into ig_token (naam, verloopt_op, geschat, verlengd_om, fout, gecontroleerd_om)
  values ('instagram_access_token', tot, false, now(), null, now())
  on conflict (naam) do update
     set verloopt_op = tot, geschat = false, verlengd_om = now(), fout = null, gecontroleerd_om = now();
  return jsonb_build_object('verlengd', true, 'verloopt_op', tot);
end;
$$;

-- beginstand: sleutel gemaakt op 28-09, dus geldig tot ca. 27-11 (geschat, tot de eerste verlenging)
insert into public.ig_token (naam, verloopt_op, geschat)
values ('instagram_access_token', '2026-11-27 12:00+01', true)
on conflict (naam) do nothing;

-- 10. Rechten: niemand via de website/API; alleen de database zelf (pg_cron) en de SQL Editor
revoke execute on function public.ig_get(text)                  from public, anon, authenticated;
revoke execute on function public.ig_media_cijfers(text, text)  from public, anon, authenticated;
revoke execute on function public.ig_refresh(integer, integer)  from public, anon, authenticated;
revoke execute on function public.ig_stories_refresh()          from public, anon, authenticated;
revoke execute on function public.ig_token_verlengen()          from public, anon, authenticated;

-- 11. Automatisch (pg_cron rekent in UTC)
--     elke nacht 04:45 UTC: alles bijwerken  |  elk uur op :50: stories  |  ma + do 03:55 UTC: sleutel verlengen
select cron.unschedule(jobname) from cron.job
 where jobname in ('instagram-dagelijks', 'instagram-stories', 'instagram-sleutel-verlengen');
select cron.schedule('instagram-dagelijks',         '45 4 * * *',   'select public.ig_refresh(3, 60)');
select cron.schedule('instagram-stories',           '50 * * * *',   'select public.ig_stories_refresh()');
select cron.schedule('instagram-sleutel-verlengen', '55 3 * * 1,4', 'select public.ig_token_verlengen()');

-- 12. Test nu meteen: 7 dagen account-cijfers, alle posts, cijfers van de posts van 30 dagen + 20 oudere,
--     en de stories van nu. Verwacht: "fouten": [] (of een paar, zie uitleg in de chat)
select public.ig_refresh(7, 20) as insta, public.ig_stories_refresh() as stories;
