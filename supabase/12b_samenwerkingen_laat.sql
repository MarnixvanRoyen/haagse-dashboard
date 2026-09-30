-- =====================================================================
-- 12b_samenwerkingen_laat.sql — laat aangenomen (meten vanaf het aannemen) + weggehaalde partners bewaren (30-09-2026)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Vooraf: 12_samenwerkingen.sql (versie 2) is gedraaid.
--  1. ig_partner krijgt: aangenomen_om (wanneer we de partner voor het eerst als Accepted zagen),
--     weg + weg_om (partner staat niet meer bij de post: bewaren i.p.v. wissen).
--     Archief: van wie al Accepted was op 30-09 weten we niet wanneer die aannam -> aangenomen_om blijft leeg (= onbekend, telt gewoon mee).
--  2. De verwerking per post zit nu in één hulpfunctie, zodat de nacht-ronde en de 3-uurs-ronde precies hetzelfde doen.
--  3. Nieuw: ig_partners_recent() = alleen de nieuwste 25 posts, elke 3 uur. Zo weten we tot op ± 3 uur wanneer iemand aannam.
--  4. Laat aangenomen (> 3 dagen na de post): meteen een nulmeting van de post (ig_partner_meting, 'bij_aannemen'),
--     daarna 14 dagen elke nacht een meting ('daarna', klusje instagram-partners-laat 05:35 UTC).
--     View ig_partner_laat_effect: nulmeting, laatste meting daarna, en de laatste dagmeting ervóór (voor de eigen groei).
--     De app rekent: erbij na aannemen min wat de post in dat tempo zelf nog zou doen = effect van de partner.
-- Tijden: alles hier draait via pg_cron of de SQL Editor, nooit vanuit de app (geen 15 s-grens).
--   Schrijft bewust NIET in ig_media_dag (ig_live werkt die bij; de lange nacht-ronde zou die rijen vasthouden).
-- Alles of niets: gaat er iets mis, dan wordt niets van dit bestand bewaard.
-- =====================================================================

-- 1. Nieuwe kolommen
alter table public.ig_partner add column if not exists aangenomen_om timestamptz;              -- leeg = onbekend (archief) of nog niet aangenomen
alter table public.ig_partner add column if not exists weg           boolean not null default false;
alter table public.ig_partner add column if not exists weg_om        timestamptz;

-- metingen rond het laat aannemen (eigen tabel, zie uitleg bovenaan)
create table if not exists public.ig_partner_meting (
  media_id  text        not null,
  om        timestamptz not null,
  soort     text        not null check (soort in ('bij_aannemen', 'daarna')),
  cijfers   jsonb       not null default '{}',      -- zelfde namen als ig_media_dag: reach, follows, profile_visits, likes, shares, ...
  primary key (media_id, om)
);
alter table public.ig_partner_meting enable row level security;
drop policy if exists "alleen marnix mag lezen" on public.ig_partner_meting;
create policy "alleen marnix mag lezen" on public.ig_partner_meting for select to authenticated using ((select public.is_marnix()));
revoke all on public.ig_partner_meting from anon, authenticated;
grant select on public.ig_partner_meting to authenticated;

-- 2. Hulpfunctie: één post (zoals Meta hem teruggeeft) verwerken
create or replace function public.ig_partner_verwerk(x jsonb, start timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  mid  text := x->>'id';
  c    jsonb;
  n    int := 0;
  w    int := 0;
  m    int := 0;
  prod text;
begin
  if mid is null then
    return jsonb_build_object('regels', 0, 'weg', 0);
  end if;

  for c in select * from jsonb_array_elements(coalesce(x->'collaborators'->'data', '[]')) loop
    continue when coalesce(c->>'username', '') = '';
    insert into ig_partner as p (media_id, partner, partner_id, status, status_sinds, eerst_gezien, laatst_gezien,
                                 aangenomen_om, weg, weg_om)
    values (mid, c->>'username', c->>'id', coalesce(c->>'invite_status', ''), start, start, start,
            case when c->>'invite_status' = 'Accepted' then start end, false, null)
    on conflict (media_id, partner) do update
       set partner_id    = coalesce(excluded.partner_id, p.partner_id),
           status_sinds  = case when p.status is distinct from excluded.status or p.weg then start else p.status_sinds end,
           -- nu Accepted en daarvoor niet (of weggehaald en terug): dan is dit het moment van aannemen
           aangenomen_om = case when excluded.status = 'Accepted' and (p.status is distinct from 'Accepted' or p.weg) then start
                                when excluded.status = 'Accepted' then p.aangenomen_om
                           end,
           status        = excluded.status,
           laatst_gezien = start,
           weg           = false,
           weg_om        = null;
    n := n + 1;
  end loop;

  -- partner staat niet meer bij de post (jij haalde hem weg, of hij weigerde): bewaren als "weg"
  update ig_partner set weg = true, weg_om = start
   where media_id = mid and laatst_gezien < start and not weg;
  get diagnostics w = row_count;

  -- net laat aangenomen (> 3 dagen na de post)? Dan nu de stand van de post vastleggen = nulmeting
  if exists (select 1 from ig_partner where media_id = mid and aangenomen_om = start and status = 'Accepted' and not weg)
     and (x->>'timestamp')::timestamptz < start - interval '3 days'
     and not exists (select 1 from ig_partner_meting where media_id = mid and soort = 'bij_aannemen' and om > start - interval '1 hour') then
    begin
      select product into prod from ig_media where media_id = mid;
      insert into ig_partner_meting (media_id, om, soort, cijfers)
      values (mid, start, 'bij_aannemen', ig_media_cijfers(mid, coalesce(nullif(prod, ''), 'FEED')));
      m := 1;
    exception when others then
      m := -1;                                        -- lukte niet (bijv. Insta-sleutel): dan geen berekening voor deze post
    end;
  end if;

  insert into ig_partner_post (media_id, gepost_om, aangenomen, uitgenodigd, gecheckt_om)
  select mid, (x->>'timestamp')::timestamptz,
         count(*) filter (where status = 'Accepted' and not weg), count(*) filter (where not weg), start
    from ig_partner where media_id = mid
  on conflict (media_id) do update
     set gepost_om = excluded.gepost_om, aangenomen = excluded.aangenomen,
         uitgenodigd = excluded.uitgenodigd, gecheckt_om = start;

  return jsonb_build_object('regels', n, 'weg', w, 'nulmeting', m);
end;
$$;

-- 3. Hele archief (nacht-ronde): zelfde als versie 2, maar met de hulpfunctie
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
  r        jsonb;
  paginas  int := 0;
  n_posts  int := 0;
  n_rijen  int := 0;
  n_weg    int := 0;
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
      continue when x->>'id' is null;
      r := ig_partner_verwerk(x, start);
      n_posts := n_posts + 1;
      n_rijen := n_rijen + (r->>'regels')::int;
      n_weg   := n_weg + (r->>'weg')::int;
    end loop;

    na := j->'paging'->'cursors'->>'after';
    if j->'paging'->>'next' is null or na is null then
      klaar := true;
      na := null;
      exit;
    end if;
    exit when paginas >= 80
           or extract(epoch from clock_timestamp() - klok) > coalesce(max_sec, 45);
    url := basis || '&after=' || na;
  end loop;

  if fout is null then
    insert into ig_partner_voortgang (id, na, bijgewerkt_om) values (1, na, now())
    on conflict (id) do update set na = excluded.na, bijgewerkt_om = now();
    insert into fb_token (naam, gelukt_om) values ('facebook_access_token', now())
    on conflict (naam) do update set gelukt_om = now(), fout = null;
  else
    insert into fb_token (naam, fout, fout_om) values ('facebook_access_token', left(fout, 250), now())
    on conflict (naam) do update set fout = excluded.fout, fout_om = now();
  end if;

  return jsonb_build_object('klaar', klaar, 'verder_gegaan', verder, 'paginas', paginas, 'posts', n_posts,
                            'partner_regels', n_rijen, 'weggehaald', n_weg, 'fout', fout,
                            'seconden', round(extract(epoch from clock_timestamp() - klok)::numeric, 1));
end;
$$;

-- 4. Alleen de nieuwste 25 posts (elke 3 uur): 1 vraag bij Meta, raakt de bladwijzer van de nacht-ronde niet
create or replace function public.ig_partners_recent()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  start  timestamptz := now();
  acc    text;
  j      jsonb;
  x      jsonb;
  r      jsonb;
  n      int := 0;
  n_rij  int := 0;
  n_weg  int := 0;
  fout   text;
begin
  perform alleen_marnix();
  perform set_config('http.timeout_msec', '30000', true);
  select ig_id into acc from ig_account order by bijgewerkt_om desc limit 1;
  acc := coalesce(acc, '17841451414340372');
  begin
    j := fb_get(acc || '/media?fields=id,timestamp,collaborators%7Bid,username,invite_status%7D&limit=25');
  exception when others then
    fout := sqlerrm;
  end;

  if fout is null then
    for x in select * from jsonb_array_elements(coalesce(j->'data', '[]')) loop
      continue when x->>'id' is null;
      r := ig_partner_verwerk(x, start);
      n := n + 1;
      n_rij := n_rij + (r->>'regels')::int;
      n_weg := n_weg + (r->>'weg')::int;
    end loop;
    insert into fb_token (naam, gelukt_om) values ('facebook_access_token', now())
    on conflict (naam) do update set gelukt_om = now(), fout = null;
  else
    insert into fb_token (naam, fout, fout_om) values ('facebook_access_token', left(fout, 250), now())
    on conflict (naam) do update set fout = excluded.fout, fout_om = now();
  end if;
  return jsonb_build_object('posts', n, 'partner_regels', n_rij, 'weggehaald', n_weg, 'fout', fout);
end;
$$;

-- 4b. Na laat aannemen: 14 dagen elke nacht de post meten (alleen posts met een nulmeting; meestal 0 à 3 posts = een paar seconden)
create or replace function public.ig_partner_laat_meten()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  p      record;
  prod   text;
  n      int := 0;
  fouten text[] := '{}';
begin
  perform alleen_marnix();
  perform set_config('http.timeout_msec', '10000', true);
  for p in select distinct media_id from ig_partner_meting
            where soort = 'bij_aannemen' and om > now() - interval '14 days'
  loop
    begin
      select product into prod from ig_media where media_id = p.media_id;
      insert into ig_partner_meting (media_id, om, soort, cijfers)
      values (p.media_id, now(), 'daarna', ig_media_cijfers(p.media_id, coalesce(nullif(prod, ''), 'FEED')))
      on conflict (media_id, om) do nothing;
      n := n + 1;
    exception when others then
      fouten := fouten || ('post ' || p.media_id || ': ' || left(sqlerrm, 150));
    end;
  end loop;
  return jsonb_build_object('gemeten', n, 'fouten', fouten);
end;
$$;

-- 4c. Voor de app: per laat aangenomen partner de nulmeting, de laatste meting daarna (max 15 dagen) en de laatste dagmeting ervóór
create or replace view public.ig_partner_laat_effect
with (security_invoker = true) as
select p.media_id, p.partner, pp.gepost_om, p.aangenomen_om,
       b.om as basis_om, b.cijfers as basis,
       n.om as na_om,    n.cijfers as na,
       v.gemeten_om as voor_om, v.cijfers as voor
  from public.ig_partner p
  join public.ig_partner_post pp on pp.media_id = p.media_id
  join lateral (select m.om, m.cijfers from public.ig_partner_meting m
                 where m.media_id = p.media_id and m.soort = 'bij_aannemen'
                   and m.om between p.aangenomen_om - interval '1 hour' and p.aangenomen_om + interval '1 hour'
                 order by abs(extract(epoch from m.om - p.aangenomen_om)) limit 1) b on true
  left join lateral (select m.om, m.cijfers from public.ig_partner_meting m
                      where m.media_id = p.media_id and m.soort = 'daarna'
                        and m.om > b.om and m.om <= b.om + interval '15 days'
                      order by m.om desc limit 1) n on true
  left join lateral (select d.gemeten_om, d.cijfers from public.ig_media_dag d
                      where d.media_id = p.media_id and d.gemeten_om < b.om - interval '6 hours'
                      order by d.gemeten_om desc limit 1) v on true
 where p.status = 'Accepted' and not p.weg;
revoke all on public.ig_partner_laat_effect from anon, authenticated;
grant select on public.ig_partner_laat_effect to authenticated;

-- 5. Rechten: niemand via de website/API; alleen de database zelf (pg_cron) en de SQL Editor
revoke execute on function public.ig_partner_verwerk(jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.ig_partners_refresh(integer)           from public, anon, authenticated;
revoke execute on function public.ig_partners_recent()                   from public, anon, authenticated;
revoke execute on function public.ig_partner_laat_meten()                from public, anon, authenticated;

-- 6. Automatisch: elke 3 uur (op :17) de nieuwste 25 posts. De nacht-ronde (instagram-partners, 05:05 UTC) blijft.
select cron.unschedule(jobname) from cron.job where jobname = 'instagram-partners-recent';
select cron.schedule('instagram-partners-recent', '17 */3 * * *', 'select public.ig_partners_recent()');
--    en elke nacht 05:35 UTC (na de lange partner-ronde van 05:05): posts met een laat aangenomen partner meten
select cron.unschedule(jobname) from cron.job where jobname = 'instagram-partners-laat';
select cron.schedule('instagram-partners-laat', '35 5 * * *', 'select public.ig_partner_laat_meten()');

-- 7. Test nu meteen: nieuwste 25 posts + hoe de tabel er nu uitziet
select public.ig_partners_recent() as recent,
       (select count(*) from public.ig_partner)                              as partner_regels,
       (select count(*) from public.ig_partner where weg)                    as weggehaald,
       (select count(*) from public.ig_partner where aangenomen_om is null
                                                 and status = 'Accepted')   as aangenomen_datum_onbekend,
       (select count(*) from public.ig_partner_laat_effect)                  as laat_met_nulmeting;
