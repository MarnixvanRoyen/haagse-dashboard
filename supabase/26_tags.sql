-- =====================================================================
-- 26_tags.sql — wie tagt jou? (posts van anderen waarin @the_hague_beachlife getagd is) (06-10-2026)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Alles of niets: gaat er iets mis, dan wordt niets van dit bestand bewaard.
--
-- Nodig: Facebook-sleutel met het recht instagram_manage_comments (sinds 06-10-2026, geldig tot 05-12-2026).
-- Meta: GET /<ig-id>/tags (Facebook-route, graph.facebook.com v26.0). Geeft per post: id, maker, datum, soort,
-- likes (ontbreekt als de maker likes verbergt), reacties, link. NIET: bereik, bewaard, gedeeld van hún post.
-- Traag: ± 8 s per pagina van 25 (proef 06-10: 210 posts in 11 pagina's, 88 s, terug tot 09-10-2022).
--
-- Wat er verandert:
--   1. Tabel ig_tag: één regel per post waarin je getagd bent. Niks wordt gewist: verdwijnt een post (of de tag)
--      uit de lijst, dan krijgt hij weg = true en telt hij nergens meer mee.
--   2. Tabel ig_tag_stand: wanneer laatst gelukt, laatste volledige ronde, laatste fout (voor het dashboard).
--   3. Functie ig_tags_refresh(volledig, max_sec):
--        - gewone dag: alleen de nieuwste pagina (25 posts, 1 Meta-vraag) → likes van verse posts groeien mee;
--        - 1× per 7 dagen (of volledig = true): de hele lijst; pas dan worden ontbrekende posts 'weg'
--          (alleen als ≥ 90% van de bekende posts erin stond en hooguit 10 tegelijk, net als 22).
--        - sleutelfout → fb_token.fout (het bestaande alarm gaat af); andere fout → ig_tag_stand.fout.
--   4. View ig_partner_bron = je partners (ig_partner) + wie jou tagt (ig_tag, status 'Tag').
--      ig_partner_info_refresh (12c, Business Discovery) leest voortaan daaruit:
--        - taggers krijgen ook hun grootte en "normaal" (zelfde regels: nooit gemeten eerst, daarna elke maand);
--        - hun tag-posts tellen niet mee in hun normaal (net als jullie gezamenlijke posts).
--      Geen extra pg_cron-klusje daarvoor; de limiet blijft 15 per uur.
--   5. pg_cron 'instagram-tags' elke dag om 05:22 UTC (minuut 22 is vrij; :05/:15/:25… zijn bezet door stories-eind).
-- =====================================================================

-- 1. tabellen
create table if not exists public.ig_tag (
  media_id       text primary key,
  maker          text not null,                 -- gebruikersnaam van wie jou tagde
  gepost_om      timestamptz,
  soort          text,                          -- FEED / REELS (media_product_type)
  likes          integer,                       -- leeg = maker verbergt likes
  reacties       integer,
  link           text,
  eerst_gezien   timestamptz not null default now(),
  laatst_gezien  timestamptz not null default now(),
  weg            boolean not null default false, -- nie meer in de volledige lijst (post weg of tag eraf)
  weg_om         timestamptz
);
create index if not exists ig_tag_maker on public.ig_tag (maker);

create table if not exists public.ig_tag_stand (
  id             int primary key default 1 check (id = 1),
  gelukt_om      timestamptz,                   -- laatste ronde zonder fout
  volledig_om    timestamptz,                   -- laatste keer de HELE lijst gehad
  aantal         integer,                       -- posts in die laatste volledige lijst
  fout           text,
  fout_om        timestamptz,
  melding        text                           -- bijv. "lijst leek onvolledig, niks op weg gezet"
);

do $$
declare t text;
begin
  foreach t in array array['ig_tag', 'ig_tag_stand'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "alleen marnix mag lezen" on public.%I', t);
    execute format('create policy "alleen marnix mag lezen" on public.%I for select to authenticated using ((select public.is_marnix()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- 2. ophalen
create or replace function public.ig_tags_refresh(volledig boolean default null, max_sec integer default 240)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  klok      timestamptz := clock_timestamp();
  start     timestamptz := now();
  acc       text;
  na        text;
  j         jsonb;
  x         jsonb;
  p         int := 0;
  n         int := 0;
  max_p     int;
  compleet  boolean := false;
  stopfout  text;
  n_in      int;
  n_uit     int;
  n_weg     int := 0;
  melding_t text;
begin
  perform alleen_marnix();
  perform set_config('http.timeout_msec', '30000', true);   -- 30 s per vraag (alleen binnen deze ronde)
  if volledig is null then                                   -- vanzelf: 1× per 7 dagen de hele lijst
    select coalesce(max(volledig_om) < now() - interval '7 days', true) into volledig from ig_tag_stand;
  end if;
  max_p := case when volledig then 60 else 1 end;            -- 60 × 25 = 1.500 posts; nu ± 210
  select ig_id into acc from ig_account order by bijgewerkt_om desc limit 1;
  acc := coalesce(acc, '17841451414340372');

  loop
    if p >= max_p then
      compleet := not volledig;                              -- gewone dag: 1 pagina is precies de bedoeling
      exit;
    end if;
    if extract(epoch from clock_timestamp() - klok) > coalesce(max_sec, 240) then
      exit;                                                  -- te lang bezig: wat binnen is blijft bewaard
    end if;
    begin
      j := fb_get(acc || '/tags?fields=id,username,timestamp,media_product_type,like_count,comments_count,permalink&limit=25'
                  || coalesce('&after=' || na, ''));
    exception when others then
      stopfout := regexp_replace(sqlerrm, 'access_token=[^&[:space:]"]+', 'access_token=***', 'g');
      exit;
    end;
    p := p + 1;
    for x in select * from jsonb_array_elements(coalesce(j->'data', '[]'::jsonb)) loop
      continue when x->>'id' is null or coalesce(x->>'username', '') = '';
      insert into ig_tag as t (media_id, maker, gepost_om, soort, likes, reacties, link, eerst_gezien, laatst_gezien)
      values (x->>'id', x->>'username', (x->>'timestamp')::timestamptz, x->>'media_product_type',
              (x->>'like_count')::int, (x->>'comments_count')::int, x->>'permalink', now(), now())
      on conflict (media_id) do update
         set maker = excluded.maker, gepost_om = excluded.gepost_om, soort = excluded.soort,
             likes = excluded.likes, reacties = excluded.reacties, link = coalesce(excluded.link, t.link),
             laatst_gezien = now(), weg = false, weg_om = null;   -- weer in de lijst = telt weer mee
      n := n + 1;
    end loop;
    na := j->'paging'->'cursors'->>'after';
    if na is null or jsonb_array_length(coalesce(j->'data', '[]'::jsonb)) = 0 then
      compleet := true;                                      -- laatste pagina gehad
      exit;
    end if;
  end loop;

  -- volledige lijst gehad: wie ontbreekt, is weg (met veiligheidsgrenzen)
  if volledig and compleet and stopfout is null then
    select count(*) filter (where laatst_gezien >= start), count(*) filter (where laatst_gezien < start)
      into n_in, n_uit
      from ig_tag where not weg;
    if n_uit > 0 then
      if n_in >= 0.9 * (n_in + n_uit) and n_uit <= 10 then
        update ig_tag set weg = true, weg_om = now() where not weg and laatst_gezien < start;
        get diagnostics n_weg = row_count;
      else
        melding_t := format('lijst leek onvolledig (%s erin, %s ontbreken): niks op weg gezet', n_in, n_uit);
      end if;
    end if;
  end if;

  -- stand bijhouden
  insert into ig_tag_stand (id) values (1) on conflict (id) do nothing;
  if stopfout is not null then
    update ig_tag_stand set fout = left(stopfout, 250), fout_om = now() where id = 1;
    if fb_sleutelfout(stopfout) then                          -- sleutel stuk: ook de gewone waarschuwing aanzetten
      insert into fb_token (naam, fout, fout_om) values ('facebook_access_token', left(stopfout, 250), now())
      on conflict (naam) do update set fout = excluded.fout, fout_om = now();
    end if;
  else
    update ig_tag_stand
       set gelukt_om = now(), fout = null,
           volledig_om = case when volledig and compleet then now() else volledig_om end,
           aantal      = case when volledig and compleet then n else aantal end,
           melding     = case when volledig and compleet then melding_t
                              when volledig then 'volledige ronde nie af (te lang bezig): volgende keer opnieuw'
                              else melding end
     where id = 1;
  end if;

  return jsonb_build_object('volledig', volledig, 'compleet', compleet, 'paginas', p, 'posts', n, 'weg', n_weg,
                            'melding', melding_t, 'fout', stopfout,
                            'seconden', round(extract(epoch from clock_timestamp() - klok)::numeric, 1));
end;
$$;
revoke execute on function public.ig_tags_refresh(boolean, integer) from public, anon, authenticated;

-- 3. partners + taggers samen, voor Business Discovery (alleen intern, niet via de API)
create or replace view public.ig_partner_bron as
  select media_id, partner, status, weg from public.ig_partner
  union all
  select media_id, maker, 'Tag', weg from public.ig_tag;
revoke all on public.ig_partner_bron from anon, authenticated;

-- 4. ig_partner_info_refresh (12c) leest voortaan uit ig_partner_bron (de live-versie aanpassen, niet het bestand)
create or replace function pg_temp.vervang(def text, oud text, nieuw text, aantal int, wat text)
returns text language plpgsql as $$
declare n int;
begin
  n := (length(def) - length(replace(def, oud, ''))) / length(oud);
  if n <> aantal then
    raise exception '26: plek "%" niet precies %x gevonden (% keer)', wat, aantal, n;
  end if;
  return replace(def, oud, nieuw);
end $$;

do $migratie$
declare def text;
begin
  def := pg_get_functiondef('public.ig_partner_info_refresh(integer,integer)'::regprocedure);
  if def like '%ig_partner_bron%' then
    raise notice 'ig_partner_info_refresh is al aangepast, niks gedaan';
    return;
  end if;
  -- kandidaten + "nog te doen": partners én taggers
  def := pg_temp.vervang(def, 'from ig_partner a', 'from ig_partner_bron a', 2, 'kandidatenlijst');
  -- hun normaal: gezamenlijke posts én posts waarin ze jou tagden tellen nie mee
  def := pg_temp.vervang(def, 'not exists (select 1 from ig_partner where media_id = m->>''id'')',
                              'not exists (select 1 from ig_partner_bron where media_id = m->>''id'')', 1, 'normaal');
  execute def;
end $migratie$;
revoke execute on function public.ig_partner_info_refresh(integer, integer) from public, anon, authenticated;

-- 5. automatisch (pg_cron rekent in UTC): elke dag 05:22
select cron.unschedule(jobname) from cron.job where jobname = 'instagram-tags';
select cron.schedule('instagram-tags', '22 5 * * *', 'select public.ig_tags_refresh()');

-- 6. klaar: wat staat er nu (de eerste vulling is een aparte opdracht, zie de chat: select public.ig_tags_refresh(true);)
select (select count(*) from public.ig_tag)                                                  as tag_posts,
       (select count(*) from cron.job where jobname = 'instagram-tags')                       as klusje,
       (pg_get_functiondef('public.ig_partner_info_refresh(integer,integer)'::regprocedure) like '%ig_partner_bron%') as bd_met_taggers;
