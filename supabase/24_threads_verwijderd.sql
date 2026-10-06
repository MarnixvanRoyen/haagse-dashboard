-- =====================================================================
-- 24_threads_verwijderd.sql — verwijderde Threads-posts tellen nergens meer mee (06-10-2026)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Alles of niets: gaat er iets mis, dan wordt niets van dit bestand bewaard.
--
-- Zelfde aanpak als 22 (Insta):
--   1. th_media krijgt verwijderd_op + verwijderd_reden. NIETS wordt gewist.
--   2. th_posts_bewaar: staat een post (weer) in een lijst van Meta → telt mee (verwijderd_op leeg).
--   3. th_refresh (elke nacht): post ontbreekt in de VOLLEDIGE lijst → gemarkeerd ('nie_in_lijst'),
--      alleen als de lijst compleet lijkt (alle bladzijden gelukt, >= 90% van de bekende posts erin, hooguit 10 tegelijk).
--   4. th_live (dashboard): fout "does not exist" bij een jonge post telt alleen als hij óók ontbreekt in de
--      lijst van je nieuwste 10 posts uit dezelfde ronde ('bestaat_nie'). Dan geen gele melding meer.
--   5. th_media_laatst (waar de Threads-kaarten uit lezen) laat alleen actieve posts zien.
--   6. Met de hand terugzetten: select public.th_post_terugzetten('<media_id>');  (knop "Zet terug" op de Threads-tab)
-- Geen extra vragen aan Meta (alleen de check onderaan doet ± 4 leesvragen).
-- =====================================================================

-- 1. kolommen
alter table public.th_media add column if not exists verwijderd_op    timestamptz;
alter table public.th_media add column if not exists verwijderd_reden text;   -- 'nie_in_lijst' of 'bestaat_nie'

-- hulpje (alleen tijdens deze run): vervang een stuk tekst precies 1 keer, anders stoppen
create or replace function pg_temp.vervang(def text, oud text, nieuw text, wat text)
returns text language plpgsql as $$
declare n int;
begin
  n := (length(def) - length(replace(def, oud, ''))) / length(oud);
  if n <> 1 then
    raise exception '24: plek "%" niet precies 1x gevonden (% keer)', wat, n;
  end if;
  return replace(def, oud, nieuw);
end $$;

-- 2. th_posts_bewaar: in de lijst = telt mee
do $migratie$
declare def text;
begin
  def := pg_get_functiondef('public.th_posts_bewaar(text,jsonb)'::regprocedure);
  if def like '%-- 24: verwijderd%' then
    raise notice 'th_posts_bewaar is al aangepast, niks gedaan';
    return;
  end if;
  def := pg_temp.vervang(def,
    E'           gezien_om = now();\n    n := n + 1;',
    E'           gezien_om = now(), verwijderd_op = null, verwijderd_reden = null;   -- 24: verwijderd — staat (weer) in de lijst = telt mee\n    n := n + 1;',
    'th_posts_bewaar');
  execute def;
end $migratie$;
revoke execute on function public.th_posts_bewaar(text, jsonb) from public, anon, authenticated;

-- 3. th_refresh: na de volledige lijst markeren wie ontbreekt (met veiligheidsgrenzen)
do $migratie$
declare def text;
begin
  def := pg_get_functiondef('public.th_refresh(integer,integer)'::regprocedure);
  if def like '%-- 24: verwijderd%' then
    raise notice 'th_refresh is al aangepast, niks gedaan';
    return;
  end if;
  def := pg_temp.vervang(def,
    E'  -- e. cijfers per post: alle posts',
    E'  -- 24: verwijderd — wie nie meer in de volledige lijst staat, telt nie meer mee.\n'
    || E'  --     Alleen als alle bladzijden binnen zijn (volgende is leeg), >= 90% van de bekende posts erin en hooguit 10 tegelijk.\n'
    || E'  declare\n'
    || E'    n_in  int;\n'
    || E'    n_uit int;\n'
    || E'  begin\n'
    || E'    select count(*) filter (where gezien_om >= start), count(*) filter (where gezien_om < start)\n'
    || E'      into n_in, n_uit\n'
    || E'      from th_media where th_id = acc and verwijderd_op is null;\n'
    || E'    if n_uit > 0 then\n'
    || E'      if volgende is null and n_in >= 0.9 * (n_in + n_uit) and n_uit <= 10 then\n'
    || E'        update th_media set verwijderd_op = now(), verwijderd_reden = ''nie_in_lijst''\n'
    || E'         where th_id = acc and verwijderd_op is null and gezien_om < start;\n'
    || E'      elsif cardinality(fouten) < 20 then\n'
    || E'        fouten := fouten || (''lijst van Meta leek onvolledig ('' || n_in || '' van '' || (n_in + n_uit) || '' posts): niks als verwijderd gemarkeerd'');\n'
    || E'      end if;\n'
    || E'    end if;\n'
    || E'  end;\n\n'
    || E'  -- e. cijfers per post: alle posts',
    'th_refresh: begin stap e');
  execute def;
end $migratie$;

-- 4. th_live: lijst nieuwste 10 onthouden; "does not exist" + nie in die lijst = verwijderd (geen gele melding)
do $migratie$
declare def text;
begin
  def := pg_get_functiondef('public.th_live(integer)'::regprocedure);
  if def like '%-- 24: verwijderd%' then
    raise notice 'th_live is al aangepast, niks gedaan';
    return;
  end if;
  def := pg_temp.vervang(def,
    E'  fouten   text[] := ''{}'';\n',
    E'  fouten   text[] := ''{}'';\n'
    || E'  lijst_ids    text[];        -- 24: verwijderd — id''s in de lijst van de nieuwste 10 (deze ronde)\n'
    || E'  lijst_oudste timestamptz;   -- oudste post in die lijst (wat jonger is, hoort erin te staan)\n',
    'th_live: variabelen');
  def := pg_temp.vervang(def,
    E'      perform th_posts_bewaar(acc, j);\n      stappen := stappen || ''posts''::text;',
    E'      perform th_posts_bewaar(acc, j);\n'
    || E'      select array_agg(e->>''id''),\n'
    || E'             case when count(*) >= 10 then min((e->>''timestamp'')::timestamptz) else ''-infinity''::timestamptz end\n'
    || E'        into lijst_ids, lijst_oudste\n'
    || E'        from jsonb_array_elements(coalesce(j->''data'', ''[]'')) e;\n'
    || E'      stappen := stappen || ''posts''::text;',
    'th_live: lijst nieuwste 10');
  def := pg_temp.vervang(def,
    E'  for m in select media_id from th_media\n            where th_id = acc and soort <> ''REPOST_FACADE'' and gepost_om',
    E'  for m in select media_id, gepost_om from th_media\n            where th_id = acc and verwijderd_op is null and soort <> ''REPOST_FACADE'' and gepost_om',
    'th_live: stap e');
  def := pg_temp.vervang(def,
    E'      fouten := fouten || (''post '' || m.media_id || '': '' || left(sqlerrm, 100));',
    E'      if sqlerrm ~ ''fout 40[04] .*(does not exist|Object with ID)'' and cardinality(lijst_ids) > 0\n'
    || E'         and not (m.media_id = any(lijst_ids)) and m.gepost_om >= lijst_oudste then\n'
    || E'        update th_media set verwijderd_op = now(), verwijderd_reden = ''bestaat_nie'' where media_id = m.media_id;\n'
    || E'        stappen := stappen || (''post '' || m.media_id || '' verwijderd'');\n'
    || E'      else\n'
    || E'        fouten := fouten || (''post '' || m.media_id || '': '' || left(sqlerrm, 100));\n'
    || E'      end if;',
    'th_live: fout bij een post');
  execute def;
end $migratie$;
revoke execute on function public.th_live(int) from public, anon;
grant  execute on function public.th_live(int) to authenticated;

-- 5. het ene filter voor Threads: th_media_laatst laat alleen actieve posts zien
do $migratie$
declare def text;
begin
  def := pg_get_viewdef('public.th_media_laatst'::regclass, true);
  if def like '%verwijderd_op%' then
    raise notice 'th_media_laatst filtert al, niks gedaan';
    return;
  end if;
  if def ~* '\mwhere\M[^)]*$' then
    raise exception '24: th_media_laatst heeft al een where aan het eind, eerst bekijken';
  end if;
  execute 'create or replace view public.th_media_laatst with (security_invoker = true) as '
       || rtrim(rtrim(def), ';') || E'\n  WHERE m.verwijderd_op IS NULL';
end $migratie$;
revoke all on public.th_media_laatst from anon, authenticated;
grant select on public.th_media_laatst to authenticated;

-- 6. met de hand terugzetten
create or replace function public.th_post_terugzetten(p_media_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  perform alleen_marnix();
  update th_media set verwijderd_op = null, verwijderd_reden = null
   where media_id = p_media_id and verwijderd_op is not null;
  get diagnostics n = row_count;
  return jsonb_build_object('teruggezet', n);
end;
$$;
revoke execute on function public.th_post_terugzetten(text) from public, anon;
grant  execute on function public.th_post_terugzetten(text) to authenticated;

-- 7. Check (alleen lezen, ± 4 vragen aan Threads): welke Threads-posts staan in de database maar nie meer bij Meta?
--    Markeren doet de nachtronde (of th_live bij een jonge post); hier alleen kijken.
with recursive pagina(n, j) as (
  select 1, public.th_get('me/threads?fields=id&limit=100')
  union all
  select n + 1, public.th_get(j->'paging'->>'next')
    from pagina
   where j->'paging'->>'next' is not null and n < 50
),
bij_meta as (
  select distinct x->>'id' as media_id from pagina, jsonb_array_elements(coalesce(j->'data', '[]')) x
)
select (select count(*) from bij_meta) as bij_meta,
       (select count(*) from public.th_media) as in_database,
       (select count(*) from public.th_media_laatst) as tellen_mee,
       (select string_agg(m.media_id || ' (' || to_char(m.gepost_om at time zone 'Europe/Amsterdam', 'DD-MM HH24:MI') || ', '
                          || left(m.tekst, 40) || ')', '; ' order by m.gepost_om desc)
          from public.th_media m where m.media_id not in (select media_id from bij_meta)) as nie_meer_bij_meta;
