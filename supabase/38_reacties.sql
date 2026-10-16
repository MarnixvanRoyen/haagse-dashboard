-- =====================================================================
-- 38_reacties.sql — melding bij Insta-reacties waar je nog niet op gereageerd hebt (17-10-2026, chat 48)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Alles of niets: gaat er iets mis, dan wordt niets van dit bestand bewaard.
--
-- Nodig: Facebook-sleutel met instagram_manage_comments (staat er al op sinds 06-10-2026, zie 26_tags.sql).
-- Er wordt alleen GELEZEN bij Meta; het dashboard plaatst nooit zelf een reactie.
--
-- Keuzes (Marnix, 17-10):
--   - alleen Insta (posts + reels), posts van de laatste 30 dagen;
--   - beantwoord = een antwoord van jou onder de reactie, óf een latere eigen reactie onder dezelfde post met @naam;
--   - knop Afvinken (emoji, spam): weg uit de melding zonder te reageren.
--   Extra: reageert dezelfde persoon later nog eens onder jouw antwoord (met tekst, nie alleen emoji),
--   dan staat het gesprek weer open. Verborgen reacties tellen nie mee. Een like kan Meta nie laten zien.
--
-- Wat er verandert:
--   1. Tabellen ig_reactie (één regel per reactie van een ander), ig_reactie_post (per post: wanneer gecheckt,
--      hoeveel reacties toen) en ig_reactie_stand (laatste ronde, fout).
--   2. View ig_reactie_open: de reacties die op je wachten (voor het dashboard).
--   3. ig_reacties_refresh(max_vragen, max_sec): 1 vraag voor de lijst met posts (+ aantal reacties per post),
--      daarna alleen posts waar het aantal veranderd is (jouw antwoord telt ook mee in dat aantal, dus na een
--      antwoord wordt de post vanzelf opnieuw bekeken). Zuinig: standaard hooguit 30 Meta-vragen per ronde.
--   4. ig_reacties_live(): knop "Check nâh" in het dashboard (kort, hooguit 1× per 90 seconden).
--   5. ig_reactie_afvinken(ids, aan): afvinken / ongedaan maken vanuit het dashboard.
--   6. pg_cron 'instagram-reacties' elk uur op :20.
-- =====================================================================

-- 1. tabellen
create table if not exists public.ig_reactie (
  comment_id           text primary key,
  media_id             text not null,
  gebruiker            text not null default '',
  tekst                text not null default '',
  gepost_om            timestamptz,
  likes                integer,
  verborgen            boolean not null default false,   -- door jou verborgen op Insta: telt nie mee
  laatste_ander_om     timestamptz,     -- laatste bericht van die persoon in dit gesprek (de reactie zelf of een vervolg)
  laatste_ander_tekst  text,
  mijn_antwoord_om     timestamptz,     -- laatste antwoord van jou (eronder, of eigen reactie met @naam)
  afgevinkt_om         timestamptz,     -- jij vinkte af in het dashboard
  eerst_gezien         timestamptz not null default now(),
  laatst_gezien        timestamptz not null default now(),
  weg_op               timestamptz      -- nie meer bij de post (verwijderd)
);
create index if not exists ig_reactie_media on public.ig_reactie (media_id);

create table if not exists public.ig_reactie_post (
  media_id     text primary key,
  gepost_om    timestamptz,
  aantal_meta  integer,                 -- comments_count van Meta bij de laatste gelukte check
  gecheckt_om  timestamptz,
  fout         text,
  fout_om      timestamptz
);

create table if not exists public.ig_reactie_stand (
  id              int primary key default 1 check (id = 1),
  gelukt_om       timestamptz,          -- laatste ronde zonder fout bij de lijst
  posts_gecheckt  integer,
  vragen          integer,
  fout            text,
  fout_om         timestamptz,
  melding         text,
  live_om         timestamptz           -- laatste keer "Check nâh" (rem: hooguit 1× per 90 s)
);

do $$
declare t text;
begin
  foreach t in array array['ig_reactie', 'ig_reactie_post', 'ig_reactie_stand'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "alleen marnix mag lezen" on public.%I', t);
    execute format('create policy "alleen marnix mag lezen" on public.%I for select to authenticated using ((select public.is_marnix()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- 2. wat wacht er op je? (security_invoker: dezelfde slotregels als de tabellen)
create or replace view public.ig_reactie_open with (security_invoker = on) as
  select r.comment_id, r.media_id, r.gebruiker, r.tekst, r.gepost_om, r.likes,
         r.laatste_ander_om, r.laatste_ander_tekst, r.mijn_antwoord_om, r.afgevinkt_om,
         (r.mijn_antwoord_om is not null) as vervolg,       -- je had al geantwoord, maar ze reageerden opnieuw
         m.gepost_om as post_om, m.permalink, m.plaatje, m.bijschrift, m.product
    from public.ig_reactie r
    join public.ig_media m on m.media_id = r.media_id
   where r.weg_op is null
     and not r.verborgen
     and r.laatste_ander_om is not null
     and r.laatste_ander_om > greatest(coalesce(r.mijn_antwoord_om, '-infinity'), coalesce(r.afgevinkt_om, '-infinity'))
     and m.verwijderd_op is null
     and m.gepost_om >= now() - interval '30 days';
revoke all on public.ig_reactie_open from anon, authenticated;
grant select on public.ig_reactie_open to authenticated;

-- 3. het werk zelf (intern; niet via de website aan te roepen)
create or replace function public.ig_reacties_ronde(max_vragen integer, max_sec numeric, http_ms integer)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  klok      timestamptz := clock_timestamp();
  acc       text;
  ik        text;
  url       text;
  j         jsonb;
  x         jsonb;
  alle      jsonb;
  n_vragen  int := 0;
  p         int;
  stopfout  text;
  v_fout    text;
  pfout     text;
  n_posts   int := 0;
  n_gecheckt int := 0;
  n_open    int;
  melding_t text;
  ronde     timestamptz;
  rec       record;
  lijst_ok  boolean := false;
begin
  perform alleen_marnix();
  perform set_config('http.timeout_msec', http_ms::text, true);
  select ig_id, gebruikersnaam into acc, ik from ig_account order by bijgewerkt_om desc limit 1;
  acc := coalesce(acc, '17841451414340372');
  ik  := lower(coalesce(nullif(ik, ''), 'the_hague_beachlife'));

  -- a. de posts van de laatste 30 dagen + hoeveel reacties Meta nu telt (1 vraag, soms 2)
  create temp table if not exists rx_lijst (media_id text primary key, gepost_om timestamptz, aantal int) on commit drop;
  truncate rx_lijst;
  url := acc || '/media?fields=id,timestamp,comments_count,media_product_type&limit=50';
  for p in 1..4 loop
    n_vragen := n_vragen + 1;                          -- telt ook als het misgaat (Meta telt hem ook)
    begin
      j := fb_get(url);
    exception when others then
      stopfout := regexp_replace(sqlerrm, 'access_token=[^&[:space:]"]+', 'access_token=***', 'g');
      exit;
    end;
    for x in select * from jsonb_array_elements(coalesce(j->'data', '[]'::jsonb)) loop
      continue when x->>'id' is null or coalesce(x->>'media_product_type', '') = 'STORY';
      if (x->>'timestamp')::timestamptz >= now() - interval '30 days' then
        insert into rx_lijst values (x->>'id', (x->>'timestamp')::timestamptz, coalesce((x->>'comments_count')::int, 0))
        on conflict (media_id) do nothing;
      end if;
    end loop;
    -- nieuwste eerst: is de oudste op deze pagina al ouder dan 30 dagen, dan hebben we alles
    if j->'paging'->>'next' is null
       or (select min((y->>'timestamp')::timestamptz) from jsonb_array_elements(coalesce(j->'data', '[]'::jsonb)) y)
          < now() - interval '30 days' then
      lijst_ok := true;
      exit;
    end if;
    url := j->'paging'->>'next';
  end loop;

  if stopfout is null and lijst_ok then
    select count(*) into n_posts from rx_lijst;
    insert into ig_reactie_post as rp (media_id, gepost_om)
    select media_id, gepost_om from rx_lijst
    on conflict (media_id) do update set gepost_om = excluded.gepost_om;

    -- posts zonder reacties: geen vraag nodig (en wat er stond is weg)
    update ig_reactie r set weg_op = now()
      from rx_lijst l where l.aantal = 0 and r.media_id = l.media_id and r.weg_op is null;
    update ig_reactie_post rp set aantal_meta = 0, gecheckt_om = now(), fout = null
      from rx_lijst l where l.aantal = 0 and rp.media_id = l.media_id
       and (rp.aantal_meta is distinct from 0 or rp.gecheckt_om is null);

    -- b. alleen posts waar iets veranderd is (of die al een dag niet bekeken zijn terwijl er iets openstaat)
    for rec in
      select l.media_id, l.aantal
        from rx_lijst l
        join ig_reactie_post rp on rp.media_id = l.media_id
       where l.aantal > 0
         and (rp.gecheckt_om is null
              or rp.aantal_meta is distinct from l.aantal
              or (rp.gecheckt_om < now() - interval '1 day'
                  and exists (select 1 from ig_reactie r where r.media_id = l.media_id and r.weg_op is null
                                 and r.laatste_ander_om > greatest(coalesce(r.mijn_antwoord_om, '-infinity'),
                                                                   coalesce(r.afgevinkt_om, '-infinity')))))
       order by (rp.gecheckt_om is null) desc, l.gepost_om desc
    loop
      exit when n_vragen >= max_vragen or extract(epoch from clock_timestamp() - klok) > max_sec;
      alle := '[]'::jsonb;
      pfout := null;
      url := rec.media_id || '/comments?fields=id,text,timestamp,username,like_count,hidden,'
             || 'replies.limit(50)%7Bid,text,timestamp,username%7D&limit=50';
      loop
        n_vragen := n_vragen + 1;
        begin
          j := fb_get(url);
        exception when others then
          pfout := regexp_replace(sqlerrm, 'access_token=[^&[:space:]"]+', 'access_token=***', 'g');
          exit;
        end;
        alle := alle || coalesce(j->'data', '[]'::jsonb);
        exit when j->'paging'->>'next' is null or jsonb_array_length(coalesce(j->'data', '[]'::jsonb)) = 0;
        if n_vragen >= max_vragen + 5 then                -- heel veel reacties: rest volgende ronde
          pfout := 'nie alle pagina''s gehad (te veel reacties voor één ronde)';
          exit;
        end if;
        url := j->'paging'->>'next';
      end loop;

      if pfout is not null then
        if fb_sleutelfout(pfout) then stopfout := pfout; exit; end if;
        update ig_reactie_post set fout = left(pfout, 250), fout_om = now() where media_id = rec.media_id;
        continue;                                       -- deze post overslaan, de rest gewoon doen
      end if;

      ronde := clock_timestamp();
      with c as (
        select e->>'id' as id, coalesce(e->>'username', '') as u, coalesce(e->>'text', '') as t,
               (e->>'timestamp')::timestamptz as ts, (e->>'like_count')::int as likes,
               coalesce((e->>'hidden')::boolean, false) as verb,
               coalesce(e->'replies'->'data', '[]'::jsonb) as reps
          from jsonb_array_elements(alle) e
         where e->>'id' is not null
      ), mijn_top as (                                  -- jouw eigen reacties onder de post (voor @naam)
        select ts, lower(t) as t from c where lower(u) = ik
      ), r as (                                         -- antwoorden onder een reactie
        select c.id as cid, coalesce(y->>'username', '') as u, coalesce(y->>'text', '') as t,
               (y->>'timestamp')::timestamptz as ts
          from c, jsonb_array_elements(c.reps) y
      ), per as (
        select c.*,
               greatest(
                 (select max(r.ts) from r where r.cid = c.id and lower(r.u) = ik),
                 (select max(m.ts) from mijn_top m
                   where c.u <> '' and m.ts > c.ts
                     and m.t ~ ('(^|[^a-z0-9._])@' || regexp_replace(lower(c.u), '([^a-z0-9_])', '\\\1', 'g')
                                || '($|[^a-z0-9._])'))
               ) as mijn_om,
               (select r2.ts from r r2 where r2.cid = c.id and lower(r2.u) = lower(c.u) and c.u <> ''
                   and r2.t ~ '[0-9A-Za-zÀ-ɏ]' order by r2.ts desc limit 1) as v_ts,
               (select r2.t from r r2 where r2.cid = c.id and lower(r2.u) = lower(c.u) and c.u <> ''
                   and r2.t ~ '[0-9A-Za-zÀ-ɏ]' order by r2.ts desc limit 1) as v_t
          from c
         where lower(c.u) <> ik
      )
      insert into ig_reactie as g (comment_id, media_id, gebruiker, tekst, gepost_om, likes, verborgen,
                                   laatste_ander_om, laatste_ander_tekst, mijn_antwoord_om, eerst_gezien, laatst_gezien)
      select id, rec.media_id, u, t, ts, likes, verb,
             case when v_ts > ts then v_ts else ts end,
             case when v_ts > ts then v_t  else t  end,
             mijn_om, ronde, ronde
        from per
      on conflict (comment_id) do update
         set gebruiker = excluded.gebruiker, tekst = excluded.tekst, gepost_om = excluded.gepost_om,
             likes = excluded.likes, verborgen = excluded.verborgen,
             laatste_ander_om = excluded.laatste_ander_om, laatste_ander_tekst = excluded.laatste_ander_tekst,
             mijn_antwoord_om = excluded.mijn_antwoord_om, laatst_gezien = excluded.laatst_gezien, weg_op = null;

      -- hele lijst van deze post gehad: wat er nie meer bij staat, is verwijderd
      -- (nie als Meta opeens niks teruggeeft terwijl hij wel reacties telt: dan liever niks wegzetten)
      if jsonb_array_length(alle) > 0 then
        update ig_reactie set weg_op = now()
         where media_id = rec.media_id and weg_op is null and laatst_gezien < ronde;
      else
        melding_t := 'Meta gaf geen reacties terug bij een post met ' || rec.aantal || ' reacties: niks weggezet';
      end if;

      update ig_reactie_post set aantal_meta = rec.aantal, gecheckt_om = now(), fout = null, fout_om = null
       where media_id = rec.media_id;
      n_gecheckt := n_gecheckt + 1;
    end loop;
  end if;

  if stopfout is null and not lijst_ok then
    v_fout := 'lijst met posts nie compleet';
  end if;
  v_fout := coalesce(stopfout, v_fout);

  -- stand bijhouden
  insert into ig_reactie_stand (id) values (1) on conflict (id) do nothing;
  if v_fout is not null then
    update ig_reactie_stand set fout = left(v_fout, 250), fout_om = now() where id = 1;
    if fb_sleutelfout(v_fout) then                         -- sleutel stuk: ook de gewone waarschuwing aanzetten
      insert into fb_token (naam, fout, fout_om) values ('facebook_access_token', left(v_fout, 250), now())
      on conflict (naam) do update set fout = excluded.fout, fout_om = now();
    end if;
  else
    update ig_reactie_stand
       set gelukt_om = now(), fout = null, fout_om = null, posts_gecheckt = n_gecheckt, vragen = n_vragen,
           melding = melding_t
     where id = 1;
  end if;

  select count(*) into n_open from ig_reactie_open;
  return jsonb_build_object('posts_30_dagen', n_posts, 'posts_bekeken', n_gecheckt, 'meta_vragen', n_vragen,
                            'open', n_open, 'melding', melding_t, 'fout', v_fout,
                            'seconden', round(extract(epoch from clock_timestamp() - klok)::numeric, 1));
end;
$$;
revoke execute on function public.ig_reacties_ronde(integer, numeric, integer) from public, anon, authenticated;

-- elk uur (pg_cron) of met de hand in de SQL Editor
create or replace function public.ig_reacties_refresh(max_vragen integer default 30, max_sec integer default 240)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform alleen_marnix();
  return ig_reacties_ronde(coalesce(max_vragen, 30), coalesce(max_sec, 240), 30000);
end;
$$;
revoke execute on function public.ig_reacties_refresh(integer, integer) from public, anon, authenticated;

-- knop "Check nâh" in het dashboard: kort (de website wacht hooguit ± 8 s), hooguit 1× per 90 seconden
create or replace function public.ig_reacties_live()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  vorige timestamptz;
begin
  perform alleen_marnix();
  insert into ig_reactie_stand (id) values (1) on conflict (id) do nothing;
  select live_om into vorige from ig_reactie_stand where id = 1 for update;
  if vorige > now() - interval '90 seconds' then
    return jsonb_build_object('te_snel', true, 'weer_om', vorige + interval '90 seconds');
  end if;
  update ig_reactie_stand set live_om = now() where id = 1;
  return ig_reacties_ronde(6, 4, 2500);
end;
$$;
revoke execute on function public.ig_reacties_live() from public, anon;
grant  execute on function public.ig_reacties_live() to authenticated;

-- 4. afvinken (aan = true) of ongedaan maken (aan = false); meerdere tegelijk mag
create or replace function public.ig_reactie_afvinken(ids text[], aan boolean default true)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  perform alleen_marnix();
  update ig_reactie set afgevinkt_om = case when aan then now() else null end
   where comment_id = any(ids);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.ig_reactie_afvinken(text[], boolean) from public, anon;
grant  execute on function public.ig_reactie_afvinken(text[], boolean) to authenticated;

-- 5. elk uur op :20
select cron.schedule('instagram-reacties', '20 * * * *', 'select public.ig_reacties_refresh()');
