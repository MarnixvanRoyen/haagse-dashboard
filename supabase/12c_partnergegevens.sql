-- =====================================================================
-- 12c_partnergegevens.sql — gegevens van de partners zelf via Business Discovery (30-09-2026)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Vooraf: 12 + 12b gedraaid, en de Facebook-sleutel heeft het recht instagram_manage_insights (gedaan 30-09).
-- Wat Meta geeft (1 vraag per partner): volgers, volgend, aantal posts, naam, bio, website, en hun laatste posts
--   met reacties, likes (niet als ze likes verbergen) en weergaven (alleen bij reels). Géén bereik, geen stories.
--   Alleen zakelijke/maker-accounts; persoonlijke of privé-accounts geven "niet te zien".
-- Wat dit bestand doet:
--   1. ig_partner_info krijgt extra kolommen; nieuwe tabel ig_partner_info_dag = geschiedenis (grootte per meetdag),
--      zodat we de grootte op het moment van een post weten en groei zien. fb_token krijgt de stand van dit klusje.
--   2. Oude foutregels (de #10-fout van vóór het nieuwe recht) weg, zodat alles opnieuw geprobeerd wordt.
--   3. ig_partner_info_refresh(max_aantal, max_sec): volgorde = partners op een nieuwe post (≤ 14 dagen) eerst
--      (grootte bij de post), dan nooit gemeten, dan wie vaak aannam. Wie aannam elke week opnieuw, de rest elke maand,
--      "niet te zien" elke maand opnieuw proberen (onbekende fout: na 2 dagen). Rechten- of limietfout (#10, #4, #17, #32, #613, #80002) of een
--      sleutelfout = hele ronde stoppen. Tijdelijke fout (time-out, 5xx) = overslaan, volgende ronde opnieuw.
--   4. pg_cron: elk uur op :40 hooguit 15 partners (Meta: ± 200 vragen per uur voor de hele app).
--      De nacht-ronde 05:05 doet voortaan alleen nog de partners van je posts.
-- Tijden: alleen pg_cron en de SQL Editor, nooit vanuit de app (geen 15 s-grens). De app leest alleen.
-- Alles of niets: gaat er iets mis, dan wordt niets van dit bestand bewaard.
-- =====================================================================

-- 1. Kolommen en geschiedenis
alter table public.ig_partner_info add column if not exists volgend         integer;
alter table public.ig_partner_info add column if not exists bio             text;
alter table public.ig_partner_info add column if not exists website         text;
alter table public.ig_partner_info add column if not exists reacties_med    numeric;   -- mediaan reacties per post (hun laatste posts, ≥ 1 dag oud)
alter table public.ig_partner_info add column if not exists likes_med       numeric;   -- leeg als ze likes verbergen
alter table public.ig_partner_info add column if not exists likes_verborgen boolean;
alter table public.ig_partner_info add column if not exists reel_views_med  numeric;   -- mediaan weergaven van hun reels
alter table public.ig_partner_info add column if not exists n_gemeten       integer;   -- over zoveel posts gemeten
alter table public.ig_partner_info add column if not exists n_reels         integer;
alter table public.ig_partner_info add column if not exists laatste_post    timestamptz;
alter table public.ig_partner_info add column if not exists per_week        numeric;   -- posts per week
alter table public.ig_partner_info add column if not exists gelukt_om       timestamptz; -- laatste geslaagde meting (bijgewerkt_om = laatste poging)

create table if not exists public.ig_partner_info_dag (
  partner         text not null,
  dag             date not null,                     -- Haagse dag van de meting
  volgers         integer,
  volgend         integer,
  posts           integer,
  reacties_med    numeric,
  likes_med       numeric,
  reel_views_med  numeric,
  n_gemeten       integer,
  n_reels         integer,
  gemeten_om      timestamptz not null default now(),
  primary key (partner, dag)
);

alter table public.fb_token add column if not exists grootte_gelukt_om timestamptz;
alter table public.fb_token add column if not exists grootte_fout      text;
alter table public.fb_token add column if not exists grootte_fout_om   timestamptz;

alter table public.ig_partner_info_dag enable row level security;
drop policy if exists "alleen marnix mag lezen" on public.ig_partner_info_dag;
create policy "alleen marnix mag lezen" on public.ig_partner_info_dag for select to authenticated using ((select public.is_marnix()));
revoke all on public.ig_partner_info_dag from anon, authenticated;
grant select on public.ig_partner_info_dag to authenticated;

-- 2. Oude foutregels weg (alles van vóór het nieuwe recht): die partners worden opnieuw geprobeerd
delete from public.ig_partner_info where volgers is null;

-- 3. Het klusje
drop function if exists public.ig_partner_info_refresh(integer);          -- oude versie (alleen volgers)
create or replace function public.ig_partner_info_refresh(max_aantal integer default 15, max_sec integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  klok     timestamptz := clock_timestamp();
  vandaag  date := (now() at time zone 'Europe/Amsterdam')::date;
  velden   text := 'username,name,followers_count,follows_count,media_count,biography,website,'
                || 'media.limit(15)%7Bid,timestamp,media_type,media_product_type,like_count,comments_count,view_count%7D';
  acc      text;
  p        record;
  j        jsonb;
  bd       jsonb;
  s        record;
  oud      record;
  pw       numeric;
  n_ok     int := 0;
  n_nee    int := 0;
  n_later  int := 0;
  stopfout text;
  msg      text;
  nog      int;
begin
  perform alleen_marnix();
  perform set_config('http.timeout_msec', '30000', true);   -- 30 s per vraag (alleen binnen deze ronde)
  select ig_id into acc from ig_account order by bijgewerkt_om desc limit 1;
  acc := coalesce(acc, '17841451414340372');

  for p in
    with x as (
      select a.partner,
             count(*) filter (where a.status = 'Accepted' and not a.weg)            as aan,
             max(pp.gepost_om) filter (where a.status = 'Accepted' and not a.weg)   as laatst_aan
        from ig_partner a
        left join ig_partner_post pp on pp.media_id = a.media_id
       group by a.partner)
    select x.partner, x.aan,
           coalesce(x.laatst_aan > now() - interval '14 days'
            and (i.gelukt_om is null or i.gelukt_om < x.laatst_aan)
            and i.fout is null
            and (i.bijgewerkt_om is null or i.bijgewerkt_om < now() - interval '20 hours'), false) as bij_post
      from x
      left join ig_partner_info i on i.partner = x.partner
     where x.partner ~ '^[A-Za-z0-9._]+$'                    -- Insta-namen: letters, cijfers, punt, liggend streepje
       and (i.bijgewerkt_om is null                                                        -- nooit geprobeerd
            or (x.laatst_aan > now() - interval '14 days' and (i.gelukt_om is null or i.gelukt_om < x.laatst_aan)
                and i.fout is null and i.bijgewerkt_om < now() - interval '20 hours')       -- nieuwe samenwerking: meten bij de post
            or (i.fout is null and x.aan > 0  and i.bijgewerkt_om < now() - interval '7 days')   -- nam aan: elke week
            or (i.fout is null and x.aan = 0  and i.bijgewerkt_om < now() - interval '30 days')  -- nooit aangenomen: elke maand
            or (i.fout is not null and i.bijgewerkt_om < now() - case when i.fout ~* 'Invalid user id|cannot be found|geen gegevens|\(#110\)'
                                                                     then interval '30 days'      -- niet te zien: elke maand opnieuw
                                                                     else interval '2 days' end)) -- onbekende fout: over 2 dagen opnieuw
     order by 3 desc, (i.bijgewerkt_om is null) desc, x.aan desc, i.bijgewerkt_om nulls first, x.partner
     limit greatest(coalesce(max_aantal, 15), 0)
  loop
    exit when extract(epoch from clock_timestamp() - klok) > coalesce(max_sec, 120);
    begin
      j := fb_get(acc || '?fields=business_discovery.username(' || p.partner || ')%7B' || velden || '%7D');
    exception when others then
      msg := sqlerrm;
      if fb_sleutelfout(msg)
         or msg ~* '\(#(10|4|17|32|613|80001|80002)\)|request limit|rate limit|too many calls|does not have permission' then
        stopfout := msg;                                   -- sleutel, recht of limiet: hele ronde stoppen
        exit;
      end if;
      if msg ~* 'time.?out|timed out|too slow|Facebook fout 5[0-9][0-9]|could not resolve|connection' then
        n_later := n_later + 1;                        -- tijdelijk: niks opslaan, volgende ronde opnieuw
        continue;
      end if;
      -- bijv. persoonlijk of privé-account, of naam veranderd: onthouden, over 30 dagen opnieuw
      -- (een onbekende fout ook onthouden, maar dan over 2 dagen opnieuw: zie de volgorde hierboven)
      insert into ig_partner_info (partner, bijgewerkt_om, fout)
      values (p.partner, now(), left(regexp_replace(msg, '^Facebook fout [0-9]+ bij [^:]*: ', ''), 200))
      on conflict (partner) do update set bijgewerkt_om = now(), fout = excluded.fout;
      n_nee := n_nee + 1;
      continue;
    end;

    bd := j->'business_discovery';
    if bd is null or bd->>'followers_count' is null then
      insert into ig_partner_info (partner, bijgewerkt_om, fout)
      values (p.partner, now(), 'Meta gaf geen gegevens (geen zakelijk/maker-account?)')
      on conflict (partner) do update set bijgewerkt_om = now(), fout = excluded.fout;
      n_nee := n_nee + 1;
      continue;
    end if;

    -- hun laatste posts: alleen van henzelf (niet onze gezamenlijke posts), minstens 1 dag oud (cijfers groeien nog)
    select count(*)                                                                             as n,
           count(*) filter (where m ? 'like_count')                                              as n_likes,
           count(*) filter (where m->>'media_product_type' = 'REELS' and m ? 'view_count')       as n_reels,
           percentile_cont(0.5) within group (order by (m->>'comments_count')::numeric)          as reacties,
           percentile_cont(0.5) within group (order by (m->>'like_count')::numeric)
             filter (where m ? 'like_count')                                                     as likes,
           percentile_cont(0.5) within group (order by (m->>'view_count')::numeric)
             filter (where m->>'media_product_type' = 'REELS' and m ? 'view_count')              as views
      into s
      from jsonb_array_elements(coalesce(bd->'media'->'data', '[]')) m
     where (m->>'timestamp')::timestamptz < now() - interval '1 day'
       and not exists (select 1 from ig_media   where media_id = m->>'id')
       and not exists (select 1 from ig_partner where media_id = m->>'id');

    -- posts per week: verschil in aantal posts sinds een meting van ≥ 6 dagen terug; anders uit de datums van hun laatste posts
    pw := null;
    select d.posts, d.gemeten_om into oud from ig_partner_info_dag d
     where d.partner = p.partner and d.gemeten_om < now() - interval '6 days' and d.posts is not null
     order by d.gemeten_om desc limit 1;
    if oud.posts is not null and (bd->>'media_count')::int >= oud.posts then
      pw := round(((bd->>'media_count')::int - oud.posts) / (extract(epoch from now() - oud.gemeten_om) / 604800.0), 1);
    else
      select case when count(*) >= 2 and max(t) > min(t)
                  then round((count(*) - 1) / (extract(epoch from max(t) - min(t)) / 604800.0), 1) end
        into pw
        from (select (m->>'timestamp')::timestamptz as t
                from jsonb_array_elements(coalesce(bd->'media'->'data', '[]')) m
               order by 1 desc offset 1) z;                     -- nieuwste overslaan (kan vastgepind zijn)
    end if;

    insert into ig_partner_info as i (partner, naam, volgers, volgend, posts, bio, website, reacties_med, likes_med,
                                      likes_verborgen, reel_views_med, n_gemeten, n_reels, laatste_post, per_week,
                                      bijgewerkt_om, gelukt_om, fout)
    values (p.partner, bd->>'name', (bd->>'followers_count')::int, (bd->>'follows_count')::int, (bd->>'media_count')::int,
            left(bd->>'biography', 300), bd->>'website', s.reacties, s.likes,
            case when s.n > 0 then s.n_likes = 0 end, s.views, s.n, s.n_reels,
            (select max((m->>'timestamp')::timestamptz) from jsonb_array_elements(coalesce(bd->'media'->'data', '[]')) m),
            pw, now(), now(), null)
    on conflict (partner) do update
       set naam = excluded.naam, volgers = excluded.volgers, volgend = excluded.volgend, posts = excluded.posts,
           bio = excluded.bio, website = excluded.website, reacties_med = excluded.reacties_med,
           likes_med = excluded.likes_med, likes_verborgen = excluded.likes_verborgen,
           reel_views_med = excluded.reel_views_med, n_gemeten = excluded.n_gemeten, n_reels = excluded.n_reels,
           laatste_post = excluded.laatste_post, per_week = excluded.per_week,
           bijgewerkt_om = now(), gelukt_om = now(), fout = null;

    insert into ig_partner_info_dag as d (partner, dag, volgers, volgend, posts, reacties_med, likes_med, reel_views_med,
                                          n_gemeten, n_reels, gemeten_om)
    values (p.partner, vandaag, (bd->>'followers_count')::int, (bd->>'follows_count')::int, (bd->>'media_count')::int,
            s.reacties, s.likes, s.views, s.n, s.n_reels, now())
    on conflict (partner, dag) do update
       set volgers = excluded.volgers, volgend = excluded.volgend, posts = excluded.posts,
           reacties_med = excluded.reacties_med, likes_med = excluded.likes_med, reel_views_med = excluded.reel_views_med,
           n_gemeten = excluded.n_gemeten, n_reels = excluded.n_reels, gemeten_om = now();
    n_ok := n_ok + 1;
  end loop;

  -- stand bijhouden (het dashboard laat een fout zien onder de kaart)
  if stopfout is not null then
    insert into fb_token (naam, grootte_fout, grootte_fout_om) values ('facebook_access_token', left(stopfout, 250), now())
    on conflict (naam) do update set grootte_fout = excluded.grootte_fout, grootte_fout_om = now();
    if fb_sleutelfout(stopfout) then                     -- sleutel stuk: ook de gewone waarschuwing aanzetten
      update fb_token set fout = left(stopfout, 250), fout_om = now() where naam = 'facebook_access_token';
    end if;
  elsif n_ok > 0 then
    insert into fb_token (naam, grootte_gelukt_om) values ('facebook_access_token', now())
    on conflict (naam) do update set grootte_gelukt_om = now(), grootte_fout = null;
  end if;

  -- hoeveel staan er nog te wachten (zelfde regels als hierboven)
  select count(*) into nog
    from (select a.partner, count(*) filter (where a.status = 'Accepted' and not a.weg) as aan
            from ig_partner a group by a.partner) x
    left join ig_partner_info i on i.partner = x.partner
   where x.partner ~ '^[A-Za-z0-9._]+$'
     and (i.bijgewerkt_om is null
          or (i.fout is null and x.aan > 0 and i.bijgewerkt_om < now() - interval '7 days')
          or (i.fout is null and x.aan = 0 and i.bijgewerkt_om < now() - interval '30 days')
          or (i.fout is not null and i.bijgewerkt_om < now() - case when i.fout ~* 'Invalid user id|cannot be found|geen gegevens|\(#110\)'
                                                                   then interval '30 days' else interval '2 days' end));

  return jsonb_build_object('gelukt', n_ok, 'niet_te_zien', n_nee, 'later_opnieuw', n_later, 'nog_te_doen', nog,
                            'gestopt', stopfout, 'seconden', round(extract(epoch from clock_timestamp() - klok)::numeric, 1));
end;
$$;

revoke execute on function public.ig_partner_info_refresh(integer, integer) from public, anon, authenticated;

-- 4. Automatisch (pg_cron rekent in UTC)
select cron.unschedule(jobname) from cron.job where jobname in ('instagram-partners', 'instagram-partners-grootte');
select cron.schedule('instagram-partners',         '5 5 * * *',  'select public.fb_token_check(), public.ig_partners_refresh(900)');
select cron.schedule('instagram-partners-grootte', '40 * * * *', 'select public.ig_partner_info_refresh(15, 120)');

-- 5. Test nu meteen: 15 partners (hooguit ± 40 seconden). De rest gaat vanzelf, elk uur 15.
--    Twee opdrachten: de SQL Editor laat alleen de uitkomst van de laatste zien, en die telt pas ná de ronde.
select public.ig_partner_info_refresh(15, 40);
select (select count(*) from public.ig_partner_info where volgers is not null)  as met_grootte,
       (select count(*) from public.ig_partner_info where fout is not null)     as niet_te_zien,
       (select count(distinct partner) from public.ig_partner)                  as partners_totaal,
       (select grootte_fout from public.fb_token where naam = 'facebook_access_token') as gestopt_door,
       (select jsonb_agg(t) from (select partner, volgers, posts, per_week, reacties_med, likes_med, reel_views_med, n_gemeten
                                    from public.ig_partner_info where volgers is not null
                                   order by volgers desc limit 5) t) as grootste_5,
       (select jsonb_agg(t) from (select partner, fout from public.ig_partner_info where fout is not null limit 5) t) as voorbeelden_niet_te_zien;
