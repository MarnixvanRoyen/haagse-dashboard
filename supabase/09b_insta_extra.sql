-- =====================================================================
-- 09b_insta_extra.sql — extra Insta-cijfers + labels + live-knop (29-09-2026)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Vereist: 09_insta.sql is al gedraaid.
-- Verandert ig_refresh NIET; alles hieronder komt ernaast.
-- =====================================================================

-- 1. Hulpje: één cijfer van Meta, opgesplitst (breakdown)
--    geeft bijv. {"FOLLOWER": 1200, "NON_FOLLOWER": 3400} terug
create or replace function public.ig_opsplitsing(pad text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  j jsonb;
begin
  j := ig_get(pad);
  return (select coalesce(jsonb_object_agg(upper(r->'dimension_values'->>0), r->'value'), '{}')
            from jsonb_array_elements(coalesce(j->'data', '[]')) e,
                 jsonb_array_elements(coalesce(e->'total_value'->'breakdowns'->0->'results', '[]')) r
           where r->'dimension_values'->>0 is not null);
end;
$$;

-- 2. Extra account-cijfers per Meta-dag (komt bij de bestaande cijfers in ig_account_dag):
--    reach_volgers / reach_nieuw       = bereik bij volgers / bij mensen die je (nog) niet volgen
--    views_volgers / views_nieuw       = hetzelfde voor weergaven
--    reach_per_soort                   = bereik via POST / REEL / STORY / CAROUSEL_CONTAINER / AD
--    Stopt nooit met een fout: mislukt iets, dan staat het in "fouten" en blijft de rest bewaard.
create or replace function public.ig_extra_refresh(dagen integer default 3)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  acc     text;
  d       date;
  vandaag_meta date := (now() at time zone 'America/Los_Angeles')::date;
  bereik  text;
  o       jsonb;
  c       jsonb;
  n_dagen int := 0;
  fouten  text[] := '{}';
begin
  perform alleen_marnix();
  select ig_id into acc from ig_account order by bijgewerkt_om desc limit 1;
  if acc is null then
    return jsonb_build_object('dagen', 0, 'fouten', array['nog geen account: draai eerst ig_refresh']);
  end if;

  d := vandaag_meta - (greatest(dagen, 1) - 1);
  while d <= vandaag_meta loop
    bereik := '&period=day&metric_type=total_value'
           || '&since=' || extract(epoch from (d::timestamp at time zone 'America/Los_Angeles'))::bigint
           || '&until=' || extract(epoch from ((d + 1)::timestamp at time zone 'America/Los_Angeles'))::bigint;
    c := '{}';
    -- a. bereik: volgers vs niet-volgers
    begin
      o := ig_opsplitsing('me/insights?metric=reach&breakdown=follow_type' || bereik);
      if o ? 'FOLLOWER' or o ? 'NON_FOLLOWER' then
        c := c || jsonb_build_object('reach_volgers', coalesce(o->'FOLLOWER', '0'), 'reach_nieuw', coalesce(o->'NON_FOLLOWER', '0'));
      end if;
    exception when others then
      if cardinality(fouten) < 20 then fouten := fouten || (to_char(d, 'YYYY-MM-DD') || ' reach/follow_type: ' || left(sqlerrm, 80)); end if;
    end;
    -- b. weergaven: volgers vs niet-volgers
    begin
      o := ig_opsplitsing('me/insights?metric=views&breakdown=follow_type' || bereik);
      if o ? 'FOLLOWER' or o ? 'NON_FOLLOWER' then
        c := c || jsonb_build_object('views_volgers', coalesce(o->'FOLLOWER', '0'), 'views_nieuw', coalesce(o->'NON_FOLLOWER', '0'));
      end if;
    exception when others then
      if cardinality(fouten) < 20 then fouten := fouten || (to_char(d, 'YYYY-MM-DD') || ' views/follow_type: ' || left(sqlerrm, 80)); end if;
    end;
    -- c. bereik per soort (posts, reels, stories, ...)
    begin
      o := ig_opsplitsing('me/insights?metric=reach&breakdown=media_product_type' || bereik);
      if o <> '{}' then c := c || jsonb_build_object('reach_per_soort', o); end if;
    exception when others then
      if cardinality(fouten) < 20 then fouten := fouten || (to_char(d, 'YYYY-MM-DD') || ' reach/media_product_type: ' || left(sqlerrm, 80)); end if;
    end;

    if c <> '{}' then
      insert into ig_account_dag (ig_id, dag, cijfers, opgehaald_om) values (acc, d, c, now())
      on conflict (ig_id, dag) do update set cijfers = ig_account_dag.cijfers || excluded.cijfers;
      n_dagen := n_dagen + 1;
    end if;
    d := d + 1;
  end loop;

  -- d. labels bijwerken (nieuwe posts krijgen hun onderwerpen)
  begin
    perform ig_labels_auto();
  exception when others then
    fouten := fouten || ('labels: ' || left(sqlerrm, 80));
  end;

  return jsonb_build_object('dagen', n_dagen, 'fouten', fouten);
end;
$$;

-- 3. Stories: nu ook "navigatie" = wat doen kijkers? (vooruit tikken, terug, WEGGAAN, doorvegen)
--    Zelfde functie als in 09, met één blok erbij (d).
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
  o      jsonb;
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
    -- d. navigatie (los, zodat een fout hier de rest niet raakt)
    begin
      o := ig_opsplitsing(x->>'id' || '/insights?metric=navigation&breakdown=story_navigation_action_type');
      if o <> '{}' then
        update ig_story set cijfers = cijfers || jsonb_build_object(
                 'nav_vooruit', coalesce(o->'TAP_FORWARD', '0'),
                 'nav_terug',   coalesce(o->'TAP_BACK', '0'),
                 'nav_weg',     coalesce(o->'TAP_EXIT', '0'),
                 'nav_vegen',   coalesce(o->'SWIPE_FORWARD', '0'))
         where media_id = x->>'id';
      end if;
    exception when others then
      fouten := fouten || (x->>'id' || ' navigatie: ' || left(sqlerrm, 80));
    end;
  end loop;
  return jsonb_build_object('stories', n, 'fouten', fouten);
end;
$$;

-- 4. Labels per post/story
--    soort 'onderwerp' (zonsondergang, maan, ...), 'muziek' (nummer, of '(geen)'), 'actie' (Sneek, ...)
--    bron 'auto' = uit hashtags/bijschrift, 'handmatig' = door Marnix in de app. Handmatig wint:
--    haal je een auto-label weg, dan blijft het weg (weg = true), ook als de hashtag er nog staat.
create table if not exists public.ig_media_label (
  media_id  text not null,                        -- post (ig_media) of story (ig_story)
  soort     text not null check (soort in ('onderwerp', 'muziek', 'actie')),
  label     text not null,
  bron      text not null default 'auto' check (bron in ('auto', 'handmatig')),
  weg       boolean not null default false,
  gezet_om  timestamptz not null default now(),
  primary key (media_id, soort, label)
);
create index if not exists ig_media_label_label on public.ig_media_label (soort, label);

-- regels voor de automatische labels (hier kun je later zelf regels bij zetten)
create table if not exists public.ig_label_regel (
  soort    text not null,
  label    text not null,
  patroon  text not null,                         -- zoekpatroon in het bijschrift (hoofdletters maakt niet uit)
  primary key (soort, label)
);
insert into public.ig_label_regel (soort, label, patroon) values
  ('onderwerp', 'zonsondergang', '#sunset|#zonsondergang|#goldenhour'),
  ('onderwerp', 'zonsopkomst',   '#sunrise|#zonsopkomst'),
  ('onderwerp', 'maan',          '#(full|super|blood)?moon|#moonrise|#maan|#volle ?maan'),
  ('onderwerp', 'wolken & lucht','#clouds?\M|#skies\M|#sky\M|#skyphotography|#wolken'),
  ('onderwerp', 'skyline',       '#skyline'),
  ('onderwerp', 'surf & kite',   '#(wind|kite)?surf|#kite'),
  ('onderwerp', 'Scheveningen',  'scheveningen'),
  ('onderwerp', 'Pier',          '\mpier\M|@depierscheveningen'),
  ('onderwerp', 'storm & weer',  '#storm|#rain\M|#fog\M|#mist\M|#snow\M|#regen|#sneeuw|#weather'),
  ('onderwerp', 'strand',        '#beach\M|#beachvibes|#strand\M'),
  ('actie',     'Sneek',         'sneek'),
  ('muziek',    '(eigen muziek)','#marremanrojas|marreman')
on conflict (soort, label) do nothing;

do $$
declare t text;
begin
  foreach t in array array['ig_media_label','ig_label_regel'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "alleen marnix mag lezen" on public.%I', t);
    execute format('create policy "alleen marnix mag lezen" on public.%I for select to authenticated using ((select public.is_marnix()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- automatische labels (opnieuw) uitrekenen voor alle posts
create or replace function public.ig_labels_auto()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  n_nieuw int;
  n_weg   int;
begin
  perform alleen_marnix();
  -- nieuwe treffers erbij (handmatige regels en weggehaalde labels blijven zoals ze zijn)
  insert into ig_media_label (media_id, soort, label, bron)
  select m.media_id, r.soort, r.label, 'auto'
    from ig_media m join ig_label_regel r on m.bijschrift ~* r.patroon
  on conflict (media_id, soort, label) do nothing;
  get diagnostics n_nieuw = row_count;
  -- auto-labels die niet meer kloppen (bijschrift of regel veranderd) eruit
  delete from ig_media_label l
   where l.bron = 'auto' and not l.weg
     and not exists (select 1 from ig_media m join ig_label_regel r on r.soort = l.soort and r.label = l.label
                      where m.media_id = l.media_id and m.bijschrift ~* r.patroon);
  get diagnostics n_weg = row_count;
  return jsonb_build_object('nieuw', n_nieuw, 'weg', n_weg);
end;
$$;

-- vanuit de app: label aan- of uitzetten
--   muziek: één nummer per post, dus een nieuw nummer vervangt het vorige.
--   Gebruik label '(geen)' voor "zonder eigen muziek" (anders weten we niet of je het gewoon nog niet gelabeld hebt).
create or replace function public.ig_label_zet(p_media_id text, p_soort text, p_label text, p_aan boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform alleen_marnix();
  if p_soort not in ('onderwerp', 'muziek', 'actie') or coalesce(trim(p_label), '') = '' then
    raise exception 'Onbekend soort label of leeg label';
  end if;
  if not exists (select 1 from ig_media where media_id = p_media_id)
     and not exists (select 1 from ig_story where media_id = p_media_id) then
    raise exception 'Onbekende post of story: %', p_media_id;
  end if;
  if p_aan then
    if p_soort = 'muziek' then
      -- ander nummer op deze post: auto-labels onthouden als weg, handmatige weghalen
      update ig_media_label set weg = true, bron = 'handmatig', gezet_om = now()
       where media_id = p_media_id and soort = 'muziek' and label <> trim(p_label) and bron = 'auto';
      delete from ig_media_label
       where media_id = p_media_id and soort = 'muziek' and label <> trim(p_label) and bron = 'handmatig' and not weg;
    end if;
    insert into ig_media_label (media_id, soort, label, bron, weg, gezet_om)
    values (p_media_id, p_soort, trim(p_label), 'handmatig', false, now())
    on conflict (media_id, soort, label) do update set bron = 'handmatig', weg = false, gezet_om = now();
  else
    -- auto-label: onthouden dat het weg moet; handmatig label: gewoon weghalen
    update ig_media_label set weg = true, bron = 'handmatig', gezet_om = now()
     where media_id = p_media_id and soort = p_soort and label = trim(p_label) and bron = 'auto';
    delete from ig_media_label
     where media_id = p_media_id and soort = p_soort and label = trim(p_label) and bron = 'handmatig' and not weg;
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('soort', soort, 'label', label, 'bron', bron) order by soort, label), '[]')
            from ig_media_label where media_id = p_media_id and not weg);
end;
$$;

-- 5. Handig voor de app: per post alle cijfers + kwaliteitsscore + labels in één rij
--    kwaliteit = (bewaard + gedeeld) per 1.000 bereik  |  per_1000_volgers = bereik per 1.000 volgers op dat moment
create or replace view public.ig_post_stats
with (security_invoker = true) as
select m.media_id, m.soort, m.product, m.gepost_om, m.permalink, m.plaatje,
       left(m.bijschrift, 300) as bijschrift,
       m.cijfers_dag,
       (m.cijfers->>'reach')::int              as bereik,
       (m.cijfers->>'views')::int              as weergaven,
       coalesce((m.cijfers->>'likes')::int, m.likes)       as likes,
       coalesce((m.cijfers->>'comments')::int, m.reacties) as reacties,
       (m.cijfers->>'saved')::int              as bewaard,
       (m.cijfers->>'shares')::int             as gedeeld,
       (m.cijfers->>'follows')::int            as nieuwe_volgers,
       (m.cijfers->>'profile_visits')::int     as profielbezoeken,
       (m.cijfers->>'total_interactions')::int as interacties,
       round((m.cijfers->>'ig_reels_avg_watch_time')::numeric / 1000, 1) as kijktijd_sec,
       case when (m.cijfers->>'reach')::int > 0
            then round((coalesce((m.cijfers->>'saved')::int, 0) + coalesce((m.cijfers->>'shares')::int, 0))
                       * 1000.0 / (m.cijfers->>'reach')::int, 1) end as kwaliteit,
       v.volgers as volgers_toen,
       case when v.volgers > 0 and (m.cijfers->>'reach')::int is not null
            then round((m.cijfers->>'reach')::int * 1000.0 / v.volgers) end as per_1000_volgers,
       to_char(m.gepost_om at time zone 'Europe/Amsterdam', 'ID')::int as weekdag,   -- 1 = maandag
       extract(hour from m.gepost_om at time zone 'Europe/Amsterdam')::int as uur,
       coalesce(l.labels, '[]') as labels
  from public.ig_media_laatst m
  left join lateral (select p.volgers from public.ig_profiel_dag p
                      where p.ig_id = m.ig_id
                        and abs(p.dag - (m.gepost_om at time zone 'Europe/Amsterdam')::date) <= 3
                      order by abs(p.dag - (m.gepost_om at time zone 'Europe/Amsterdam')::date) limit 1) v on true
  left join lateral (select jsonb_agg(jsonb_build_object('soort', x.soort, 'label', x.label, 'bron', x.bron)
                                      order by x.soort, x.label) as labels
                       from public.ig_media_label x where x.media_id = m.media_id and not x.weg) l on true;
revoke all on public.ig_post_stats from anon, authenticated;
grant select on public.ig_post_stats to authenticated;

-- 6. Sneek-bezoekers per bron, in groepen (Insta, Meta/Facebook, eigen Insta-links, WhatsApp, ...)
--    eigen link = ?ref=bio / ?ref=story-2909 / ?ref=post-2909
create or replace view public.gc_bronnen_groep
with (security_invoker = true) as
select dag, bron, aantal,
       case
         when bron ~* '^(bio|story-|post-|reel-)'                 then 'Insta (eigen link)'
         when bron ~* 'instagram|^ig$'                             then 'Insta'
         when bron ~* 'facebook|^fb$|fb\.me|messenger'             then 'Facebook (Meta)'
         when bron ~* 'whatsapp|wa\.me'                            then 'WhatsApp'
         when bron = '(direct)'                                    then 'Direct'
         when bron ~* 'google|bing|duckduckgo|ecosia|yahoo'        then 'Zoekmachine'
         else 'Overig'
       end as groep,
       case when bron ~* '^bio$' then 'bio'
            when bron ~* '^(story|post|reel)-' then split_part(lower(bron), '-', 1)
       end as link_soort
  from public.gc_bronnen;
revoke all on public.gc_bronnen_groep from anon, authenticated;
grant select on public.gc_bronnen_groep to authenticated;

-- 7. Knop "Nâh ververse" in de app: snel bijwerken (binnen 8 seconden), hooguit 1x per 10 minuten
--    profiel (volgers), cijfers van vandaag, nieuwste posts + hun cijfers, stories.
--    Stopt netjes als het te lang duurt; de nacht-ronde (ig_refresh) doet de rest.
create table if not exists public.ig_ververst (
  id   int primary key default 1 check (id = 1),
  om   timestamptz not null,
  fout text
);
alter table public.ig_ververst enable row level security;
drop policy if exists "alleen marnix mag lezen" on public.ig_ververst;
create policy "alleen marnix mag lezen" on public.ig_ververst for select to authenticated using ((select public.is_marnix()));
revoke all on public.ig_ververst from anon, authenticated;
grant select on public.ig_ververst to authenticated;

create or replace function public.ig_live(min_minuten int default 10)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
set timezone to 'Europe/Amsterdam'
as $$
declare
  klok     timestamptz := clock_timestamp();
  max_sec  numeric := 4;                 -- daarna niks nieuws meer beginnen (Supabase breekt af na 8 s)
  laatst   timestamptz;
  acc      text;
  j        jsonb;
  x        jsonb;
  m        record;
  c        jsonb;
  d        date := (now() at time zone 'America/Los_Angeles')::date;
  bereik   text;
  stappen  text[] := '{}';
  fouten   text[] := '{}';
begin
  perform alleen_marnix();
  select om into laatst from ig_ververst where id = 1;
  if laatst is not null and laatst > now() - make_interval(mins => greatest(coalesce(min_minuten, 10), 5)) then
    return jsonb_build_object('ververst', false, 'om', laatst, 'fout', null);
  end if;
  select ig_id into acc from ig_account order by bijgewerkt_om desc limit 1;

  -- a. profiel: volgers van nu
  begin
    j := ig_get('me?fields=user_id,followers_count,follows_count,media_count');
    acc := coalesce(j->>'user_id', acc);
    update ig_account set volgers = (j->>'followers_count')::int, volgend = (j->>'follows_count')::int,
                          posts = (j->>'media_count')::int, bijgewerkt_om = now() where ig_id = acc;
    insert into ig_profiel_dag (ig_id, dag, volgers, volgend, posts, gemeten_om)
    values (acc, current_date, (j->>'followers_count')::int, (j->>'follows_count')::int, (j->>'media_count')::int, now())
    on conflict (ig_id, dag) do update
       set volgers = excluded.volgers, volgend = excluded.volgend, posts = excluded.posts, gemeten_om = now();
    stappen := stappen || 'profiel'::text;
  exception when others then
    fouten := fouten || ('profiel: ' || left(sqlerrm, 100));
  end;
  if acc is null then
    return jsonb_build_object('ververst', false, 'om', laatst, 'fout', coalesce(fouten[1], 'geen account'));
  end if;

  -- b. account-cijfers van vandaag (Meta-dag)
  if extract(epoch from clock_timestamp() - klok) < max_sec then
    begin
      bereik := '&period=day&metric_type=total_value'
             || '&since=' || extract(epoch from (d::timestamp at time zone 'America/Los_Angeles'))::bigint
             || '&until=' || extract(epoch from ((d + 1)::timestamp at time zone 'America/Los_Angeles'))::bigint;
      j := ig_get('me/insights?metric=reach,views,accounts_engaged,total_interactions,likes,comments,shares,saves' || bereik);
      select coalesce(jsonb_object_agg(e->>'name', e->'total_value'->'value'), '{}') into c
        from jsonb_array_elements(coalesce(j->'data', '[]')) e where e->'total_value'->'value' is not null;
      if c <> '{}' then
        insert into ig_account_dag (ig_id, dag, cijfers, opgehaald_om) values (acc, d, c, now())
        on conflict (ig_id, dag) do update set cijfers = ig_account_dag.cijfers || excluded.cijfers, opgehaald_om = now();
      end if;
      stappen := stappen || 'vandaag'::text;
    exception when others then
      fouten := fouten || ('vandaag: ' || left(sqlerrm, 100));
    end;
  end if;

  -- c. nieuwste 10 posts (een post van vandaag komt er zo meteen in)
  if extract(epoch from clock_timestamp() - klok) < max_sec then
    begin
      j := ig_get('me/media?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count&limit=10');
      for x in select * from jsonb_array_elements(coalesce(j->'data', '[]')) loop
        insert into ig_media (media_id, ig_id, soort, product, gepost_om, bijschrift, permalink, plaatje, likes, reacties, gezien_om)
        values (x->>'id', acc, coalesce(x->>'media_type', ''), coalesce(x->>'media_product_type', ''),
                (x->>'timestamp')::timestamptz, coalesce(x->>'caption', ''), x->>'permalink',
                coalesce(x->>'thumbnail_url', x->>'media_url'),
                (x->>'like_count')::int, (x->>'comments_count')::int, now())
        on conflict (media_id) do update
           set bijschrift = excluded.bijschrift, permalink = excluded.permalink, plaatje = excluded.plaatje,
               likes = excluded.likes, reacties = excluded.reacties, gezien_om = now();
      end loop;
      stappen := stappen || 'posts'::text;
    exception when others then
      fouten := fouten || ('posts: ' || left(sqlerrm, 100));
    end;
  end if;

  -- d. cijfers van (hooguit 3) posts van de laatste 2 dagen: daar verandert het meest
  for m in select media_id, product from ig_media
            where ig_id = acc and gepost_om > now() - interval '2 days' order by gepost_om desc limit 3 loop
    exit when extract(epoch from clock_timestamp() - klok) >= max_sec;
    begin
      c := ig_media_cijfers(m.media_id, m.product);
      insert into ig_media_dag (media_id, dag, cijfers, gemeten_om) values (m.media_id, current_date, c, now())
      on conflict (media_id, dag) do update set cijfers = ig_media_dag.cijfers || excluded.cijfers, gemeten_om = now();
      update ig_media set insights_om = now(), insights_fout = null where media_id = m.media_id;
      stappen := stappen || ('post ' || m.media_id);
    exception when others then
      fouten := fouten || ('post ' || m.media_id || ': ' || left(sqlerrm, 100));
    end;
  end loop;

  -- e. stories (alleen als er nog tijd is)
  if extract(epoch from clock_timestamp() - klok) < max_sec then
    begin
      perform ig_stories_refresh();
      stappen := stappen || 'stories'::text;
    exception when others then
      fouten := fouten || ('stories: ' || left(sqlerrm, 100));
    end;
  end if;

  -- f. labels voor nieuwe posts
  begin
    perform ig_labels_auto();
  exception when others then
    fouten := fouten || ('labels: ' || left(sqlerrm, 100));
  end;

  insert into ig_ververst (id, om, fout) values (1, now(), fouten[1])
  on conflict (id) do update set om = now(), fout = excluded.fout;
  return jsonb_build_object('ververst', true, 'om', now(), 'stappen', stappen, 'fout', fouten[1], 'fouten', fouten,
                            'seconden', round(extract(epoch from clock_timestamp() - klok)::numeric, 1));
end;
$$;

-- 8. Rechten: de app mag alleen ig_live en ig_label_zet aanroepen (met het slot alleen_marnix erin)
revoke execute on function public.ig_opsplitsing(text)                    from public, anon, authenticated;
revoke execute on function public.ig_extra_refresh(integer)               from public, anon, authenticated;
revoke execute on function public.ig_stories_refresh()                    from public, anon, authenticated;
revoke execute on function public.ig_labels_auto()                        from public, anon, authenticated;
revoke execute on function public.ig_label_zet(text, text, text, boolean) from public, anon;
grant  execute on function public.ig_label_zet(text, text, text, boolean) to authenticated;
revoke execute on function public.ig_live(int)                            from public, anon;
grant  execute on function public.ig_live(int)                            to authenticated;

-- 9. Automatisch: elke nacht 04:55 UTC (na ig_refresh van 04:45) de extra cijfers + labels
select cron.unschedule(jobname) from cron.job where jobname = 'instagram-extra';
select cron.schedule('instagram-extra', '55 4 * * *', 'select public.ig_extra_refresh(3)');

-- 10. Test nu meteen: labels voor alle posts, dan 7 dagen extra cijfers. Verwacht: "fouten": []
select public.ig_labels_auto();
select public.ig_extra_refresh(7) as extra,
       (select jsonb_object_agg(label, n) from (select label, count(*) n from public.ig_media_label
                                                  where not weg group by label) x) as labels;
