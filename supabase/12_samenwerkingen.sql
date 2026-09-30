-- =====================================================================
-- 12_samenwerkingen.sql — samenwerkingspartners per Insta-post (30-09-2026; versie 2: 25 per vraag, 30 s wachttijd, verder waar hij was)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Vooraf: Facebook-sleutel in de Vault als 'facebook_access_token' (gedaan 30-09, 60 dagen geldig).
-- Waarom een tweede sleutel: de partners (collaborators) geeft Meta alleen via Facebook Login (graph.facebook.com),
-- niet via de Instagram-sleutel. De rest van de Insta-cijfers blijft via de Instagram-sleutel lopen.
-- Alles of niets: gaat er iets mis, dan wordt niets van dit bestand bewaard.
-- =====================================================================

-- 1. Tabellen
--    ig_partner:      per post per partner: gebruikersnaam en status (Accepted = staat ook op hun profiel, Pending = niet aangenomen)
--    ig_partner_post: welke posts zijn gecontroleerd, met hoeveel partners (0 aangenomen = eigenlijk een solo-post)
--    ig_partner_info: grootte van de partner (volgers, posts) via Business Discovery; lukt alleen bij zakelijke/maker-accounts
--    fb_token:        wanneer verloopt de Facebook-sleutel, laatste fout, laatste keer gelukt
create table if not exists public.ig_partner (
  media_id       text not null,
  partner        text not null,                     -- gebruikersnaam, bijv. ig_skylovers
  partner_id     text,
  status         text not null default '',          -- Accepted / Pending (/ Declined)
  status_sinds   timestamptz not null default now(),-- wanneer we deze status voor het eerst zagen
  eerst_gezien   timestamptz not null default now(),
  laatst_gezien  timestamptz not null default now(),
  primary key (media_id, partner)
);
create index if not exists ig_partner_partner on public.ig_partner (partner);
create table if not exists public.ig_partner_post (
  media_id     text primary key,
  gepost_om    timestamptz,
  aangenomen   integer not null default 0,          -- aantal partners met Accepted
  uitgenodigd  integer not null default 0,          -- aantal partners in totaal (ook Pending)
  gecheckt_om  timestamptz not null default now()
);
create table if not exists public.ig_partner_info (
  partner        text primary key,
  naam           text,
  volgers        integer,
  posts          integer,
  bijgewerkt_om  timestamptz,
  fout           text
);
create table if not exists public.fb_token (
  naam              text primary key,
  verloopt_op       timestamptz,
  data_verloopt_op  timestamptz,                    -- Meta: elke 90 dagen opnieuw toestemming geven (gebeurt bij een nieuwe sleutel)
  gelukt_om         timestamptz,                    -- laatste keer dat het ophalen lukte
  fout              text,
  fout_om           timestamptz,
  gecontroleerd_om  timestamptz
);

-- 2. Beveiliging: alleen Marnix mag lezen; schrijven doet alleen de database zelf
do $$
declare t text;
begin
  foreach t in array array['ig_partner','ig_partner_post','ig_partner_info','fb_token'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "alleen marnix mag lezen" on public.%I', t);
    execute format('create policy "alleen marnix mag lezen" on public.%I for select to authenticated using ((select public.is_marnix()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- 3. Hulpfunctie: vraag iets op bij Facebook (sleutel komt uit de Vault, staat nooit in een foutmelding)
--    pad = bijv. '1784.../media?fields=id', of een volledige link (volgende pagina; daar zit de sleutel al in)
create or replace function public.fb_get(pad text)
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
  select decrypted_secret into k from vault.decrypted_secrets where name = 'facebook_access_token' limit 1;
  if k is null then
    raise exception 'Geen facebook_access_token gevonden in de Vault';
  end if;
  if pad like 'http%' then
    url := pad;
  else
    url := 'https://graph.facebook.com/v26.0/' || pad
           || case when pad like '%?%' then '&' else '?' end || 'access_token=' || k;
  end if;
  r := extensions.http_get(url);
  if r.status <> 200 then
    begin
      msg := r.content::jsonb->'error'->>'message';
    exception when others then
      msg := left(r.content, 200);
    end;
    raise exception 'Facebook fout % bij %: %', r.status,
      split_part(regexp_replace(pad, '^https://graph\.facebook\.com/v[0-9.]+/', ''), '?', 1),
      left(coalesce(msg, ''), 200);
  end if;
  return r.content::jsonb;
end;
$$;

-- is dit een fout van de sleutel zelf (verlopen/ingetrokken)? Dan stoppen we meteen en waarschuwt het dashboard.
create or replace function public.fb_sleutelfout(msg text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(msg, '') ~* '(access token|oauth|session has expired|not authori[sz]ed|\(#190\)|Vault)';
$$;

-- 4. Sleutel controleren: tot wanneer geldig? (Meta's debug_token; als app-beheerder mag je je eigen sleutel zo bekijken)
create or replace function public.fb_token_check()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  k   text;
  r   extensions.http_response;
  d   jsonb;
  msg text;
  tot timestamptz;
  dat timestamptz;
begin
  perform alleen_marnix();
  select decrypted_secret into k from vault.decrypted_secrets where name = 'facebook_access_token' limit 1;
  if k is null then
    insert into fb_token (naam, fout, fout_om, gecontroleerd_om)
    values ('facebook_access_token', 'Geen facebook_access_token gevonden in de Vault', now(), now())
    on conflict (naam) do update set fout = excluded.fout, fout_om = now(), gecontroleerd_om = now();
    return jsonb_build_object('geldig', false, 'fout', 'geen sleutel in de Vault');
  end if;
  r := extensions.http_get('https://graph.facebook.com/v26.0/debug_token?input_token=' || k || '&access_token=' || k);
  begin
    d := r.content::jsonb;
  exception when others then
    d := null;
  end;
  if r.status <> 200 or d is null or coalesce((d->'data'->>'is_valid')::boolean, false) = false then
    msg := coalesce(d->'error'->>'message', d->'data'->'error'->>'message', 'sleutel ongeldig (status ' || r.status || ')');
    insert into fb_token (naam, fout, fout_om, gecontroleerd_om)
    values ('facebook_access_token', left(msg, 200), now(), now())
    on conflict (naam) do update set fout = excluded.fout, fout_om = now(), gecontroleerd_om = now();
    return jsonb_build_object('geldig', false, 'fout', left(msg, 200));
  end if;
  tot := case when coalesce((d->'data'->>'expires_at')::bigint, 0) > 0
              then to_timestamp((d->'data'->>'expires_at')::bigint) end;          -- 0 = verloopt nooit
  dat := case when coalesce((d->'data'->>'data_access_expires_at')::bigint, 0) > 0
              then to_timestamp((d->'data'->>'data_access_expires_at')::bigint) end;
  insert into fb_token (naam, verloopt_op, data_verloopt_op, gecontroleerd_om)
  values ('facebook_access_token', tot, dat, now())
  on conflict (naam) do update
     set verloopt_op = tot, data_verloopt_op = dat, gecontroleerd_om = now(),
         fout = null;                        -- sleutel is geldig: een oude fout hoort bij een oude sleutel
  return jsonb_build_object('geldig', true, 'verloopt_op', tot, 'data_verloopt_op', dat);
end;
$$;

-- 5. Partners van alle posts ophalen (hele archief: ± 800 posts = ± 32 vragen van 25)
--    Een uitnodiging kan later nog aangenomen worden; daarom elke nacht alles opnieuw.
--    Meta is traag met partners erbij: per vraag 25 posts en 30 seconden wachttijd (standaard is 5 s).
--    max_sec = na zoveel seconden stoppen en onthouden waar we waren (ig_partner_voortgang);
--    de volgende keer gaat hij daar verder. Handig in de SQL Editor; de nacht-ronde krijgt ruim de tijd.
create table if not exists public.ig_partner_voortgang (
  id             int primary key default 1 check (id = 1),
  na             text,                              -- bladwijzer van Meta (geen sleutel): hier verder gaan
  bijgewerkt_om  timestamptz
);
alter table public.ig_partner_voortgang enable row level security;
revoke all on public.ig_partner_voortgang from anon, authenticated;

drop function if exists public.ig_partners_refresh();   -- oude versie zonder max_sec
create or replace function public.ig_partners_refresh(max_sec integer default 45)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  start    timestamptz := now();
  klok     timestamptz := clock_timestamp();
  acc      text;
  basis    text;
  url      text;
  na       text;
  j        jsonb;
  x        jsonb;
  c        jsonb;
  mid      text;
  paginas  int := 0;
  n_posts  int := 0;
  n_rijen  int := 0;
  n_weg    int := 0;
  d        int;
  fout     text;
  klaar    boolean := false;
  verder   boolean := false;
begin
  perform alleen_marnix();
  perform set_config('http.timeout_msec', '30000', true);   -- 30 s per vraag (alleen binnen deze ronde)
  select ig_id into acc from ig_account order by bijgewerkt_om desc limit 1;
  acc := coalesce(acc, '17841451414340372');
  basis := acc || '/media?fields=id,timestamp,collaborators%7Bid,username,invite_status%7D&limit=25';
  select v.na into na from ig_partner_voortgang v where id = 1;
  verder := na is not null;
  url := basis || case when na is not null then '&after=' || na else '' end;

  loop
    begin
      j := fb_get(url);
    exception when others then
      fout := sqlerrm;
      exit;
    end;
    paginas := paginas + 1;

    for x in select * from jsonb_array_elements(coalesce(j->'data', '[]')) loop
      mid := x->>'id';
      continue when mid is null;
      n_posts := n_posts + 1;

      for c in select * from jsonb_array_elements(coalesce(x->'collaborators'->'data', '[]')) loop
        continue when coalesce(c->>'username', '') = '';
        insert into ig_partner as p (media_id, partner, partner_id, status, status_sinds, eerst_gezien, laatst_gezien)
        values (mid, c->>'username', c->>'id', coalesce(c->>'invite_status', ''), start, start, start)
        on conflict (media_id, partner) do update
           set partner_id    = coalesce(excluded.partner_id, p.partner_id),
               status_sinds  = case when p.status is distinct from excluded.status then start else p.status_sinds end,
               status        = excluded.status,
               laatst_gezien = start;
        n_rijen := n_rijen + 1;
      end loop;

      -- partner niet meer bij de post (uitnodiging ingetrokken/geweigerd): weghalen
      delete from ig_partner where media_id = mid and laatst_gezien < start;
      get diagnostics d = row_count;
      n_weg := n_weg + d;

      insert into ig_partner_post (media_id, gepost_om, aangenomen, uitgenodigd, gecheckt_om)
      select mid, (x->>'timestamp')::timestamptz,
             count(*) filter (where status = 'Accepted'), count(*), start
        from ig_partner where media_id = mid
      on conflict (media_id) do update
         set gepost_om = excluded.gepost_om, aangenomen = excluded.aangenomen,
             uitgenodigd = excluded.uitgenodigd, gecheckt_om = start;
    end loop;

    na := j->'paging'->'cursors'->>'after';
    if j->'paging'->>'next' is null or na is null then
      klaar := true;                                   -- einde van de lijst: volgende keer weer vooraan beginnen
      na := null;
      exit;
    end if;
    exit when paginas >= 80                            -- 80 x 25 = 2.000 posts: nooit eindeloos
           or extract(epoch from clock_timestamp() - klok) > coalesce(max_sec, 45);
    url := basis || '&after=' || na;
  end loop;

  if fout is null then
    insert into ig_partner_voortgang (id, na, bijgewerkt_om) values (1, na, now())
    on conflict (id) do update set na = excluded.na, bijgewerkt_om = now();
    insert into fb_token (naam, gelukt_om) values ('facebook_access_token', now())
    on conflict (naam) do update set gelukt_om = now(), fout = null;   -- het werkt (weer): oude fout weg
  else
    insert into fb_token (naam, fout, fout_om) values ('facebook_access_token', left(fout, 250), now())
    on conflict (naam) do update set fout = excluded.fout, fout_om = now();
  end if;

  return jsonb_build_object('klaar', klaar, 'verder_gegaan', verder, 'paginas', paginas, 'posts', n_posts,
                            'partner_regels', n_rijen, 'weggehaald', n_weg, 'fout', fout,
                            'seconden', round(extract(epoch from clock_timestamp() - klok)::numeric, 1),
                            'wachttijd_ms', current_setting('http.timeout_msec', true));
end;
$$;

-- 6. Grootte van partners (Business Discovery): per ronde hooguit 'max_aantal' partners,
--    eerst wie je vaak aannam, en elke partner hooguit 1x per 14 dagen (Meta telt het aantal vragen per uur)
create or replace function public.ig_partner_info_refresh(max_aantal integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  acc   text;
  p     record;
  j     jsonb;
  bd    jsonb;
  n_ok  int := 0;
  n_nee int := 0;
  fout  text;
begin
  perform alleen_marnix();
  select ig_id into acc from ig_account order by bijgewerkt_om desc limit 1;
  acc := coalesce(acc, '17841451414340372');

  for p in
    select x.partner
      from (select partner, count(*) filter (where status = 'Accepted') as aan, count(*) as alles
              from ig_partner group by partner) x
      left join ig_partner_info i on i.partner = x.partner
     where i.bijgewerkt_om is null or i.bijgewerkt_om < now() - interval '14 days'
     order by i.bijgewerkt_om nulls first, x.aan desc, x.alles desc
     limit greatest(coalesce(max_aantal, 25), 0)
  loop
    begin
      j := fb_get(acc || '?fields=business_discovery.username(' || p.partner || ')%7Bname,followers_count,media_count%7D');
      bd := j->'business_discovery';
      insert into ig_partner_info (partner, naam, volgers, posts, bijgewerkt_om, fout)
      values (p.partner, bd->>'name', (bd->>'followers_count')::int, (bd->>'media_count')::int, now(), null)
      on conflict (partner) do update
         set naam = excluded.naam, volgers = excluded.volgers, posts = excluded.posts, bijgewerkt_om = now(), fout = null;
      n_ok := n_ok + 1;
    exception when others then
      if fb_sleutelfout(sqlerrm) then          -- sleutel stuk: stoppen, niet 25 keer dezelfde fout
        fout := sqlerrm;
        exit;
      end if;
      -- bijv. een persoonlijk account: dat kan Meta niet laten zien. Onthouden, over 14 dagen opnieuw proberen.
      insert into ig_partner_info (partner, bijgewerkt_om, fout)
      values (p.partner, now(), left(sqlerrm, 200))
      on conflict (partner) do update set bijgewerkt_om = now(), fout = excluded.fout;
      n_nee := n_nee + 1;
    end;
  end loop;

  if fout is not null then
    insert into fb_token (naam, fout, fout_om) values ('facebook_access_token', left(fout, 250), now())
    on conflict (naam) do update set fout = excluded.fout, fout_om = now();
  end if;
  return jsonb_build_object('gelukt', n_ok, 'niet_te_zien', n_nee, 'fout', fout);
end;
$$;

-- 7. Rechten: niemand via de website/API; alleen de database zelf (pg_cron) en de SQL Editor
revoke execute on function public.fb_get(text)                      from public, anon, authenticated;
revoke execute on function public.fb_sleutelfout(text)              from public, anon, authenticated;
revoke execute on function public.fb_token_check()                  from public, anon, authenticated;
revoke execute on function public.ig_partners_refresh(integer)      from public, anon, authenticated;
revoke execute on function public.ig_partner_info_refresh(integer)  from public, anon, authenticated;

-- 8. Automatisch (pg_cron rekent in UTC): elke nacht 05:05 UTC sleutel controleren, partners en partnergrootte bijwerken
select cron.unschedule(jobname) from cron.job where jobname = 'instagram-partners';
select cron.schedule('instagram-partners', '5 5 * * *',
  'select public.fb_token_check(), public.ig_partners_refresh(900), public.ig_partner_info_refresh(25)');

-- 9. Test nu meteen: sleutel controleren, 45 seconden partners ophalen, van 10 partners de grootte
--    Staat bij partners "klaar": false, dan nog eens Run: hij gaat verder waar hij was.
select public.fb_token_check()            as sleutel,
       public.ig_partners_refresh(45)     as partners,
       public.ig_partner_info_refresh(10) as grootte;
