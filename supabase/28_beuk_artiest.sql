-- =====================================================================
-- 28 · Beuk splitsen: wat nu al kan (chat 05.2, 10-10-2026)
-- Doel: het dashboard weet per nummer of het van Marreman Rojas of van Beuk is.
--   1. Spotify: kolom "artist" in sp_snapshots. Een import vervangt alleen de cijfers
--      van díe artiest (eerst wiste een Beuk-CSV de Marreman Rojas-cijfers van die dag).
--   2. SoundCloud live: kolom "artist" in sc_tracks, gevuld uit het SoundCloud-veld
--      metadata_artist (het veld "Artist" bij je upload). sc_refresh wordt aangepast
--      zoals hij NU in de database staat (slot alleen_marnix en tijdzone blijven).
--   3. YouTube: het eigen Beuk-kanaal en de twee Beuk-Topic-kanalen erbij in yt_config.
-- Veilig opnieuw te draaien. Bestaande cijfers blijven staan.
-- Alles of niets (begin … commit): gaat er iets mis, dan blijft alles zoals het was.
-- =====================================================================

begin;

-- 1. Spotify per artiest -------------------------------------------------
alter table public.sp_snapshots add column if not exists artist text not null default 'Marreman Rojas';

-- oude "uniek per dag + nummer" wordt "uniek per dag + artiest + nummer"
alter table public.sp_snapshots drop constraint if exists sp_snapshots_user_id_snap_date_song_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sp_snapshots_dag_artiest_song_key') then
    alter table public.sp_snapshots
      add constraint sp_snapshots_dag_artiest_song_key unique (user_id, snap_date, artist, song);
  end if;
end $$;

-- nieuwe import: vervangt alleen de momentopname van dezelfde dag én dezelfde artiest
drop function if exists public.import_spotify(jsonb, date, text);
create or replace function public.import_spotify(rows jsonb, snap date, file_name text default null,
                                                 artiest text default 'Marreman Rojas')
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  n_del int;
  n_ins int;
  a     text := coalesce(nullif(btrim(artiest), ''), 'Marreman Rojas');
begin
  if auth.uid() is null then
    raise exception 'Niet ingelogd';
  end if;

  delete from sp_snapshots where user_id = auth.uid() and snap_date = snap and artist = a;
  get diagnostics n_del = row_count;

  -- zelfde titel twee keer in het bestand? dan samen optellen
  insert into sp_snapshots (user_id, snap_date, artist, song, release_date, streams, listeners, saves, source_file)
  select auth.uid(), snap, a, x.song, min(x.release_date), sum(coalesce(x.streams,0)), sum(x.listeners), sum(x.saves), file_name
    from jsonb_to_recordset(rows) as x(song text, release_date date, streams numeric, listeners numeric, saves numeric)
   where coalesce(x.song,'') <> ''
   group by x.song;
  get diagnostics n_ins = row_count;

  return jsonb_build_object('deleted', n_del, 'inserted', n_ins, 'artiest', a);
end;
$$;

revoke execute on function public.import_spotify(jsonb, date, text, text) from public, anon;
grant  execute on function public.import_spotify(jsonb, date, text, text) to authenticated;

-- 2. SoundCloud live: artiest per track ------------------------------------
alter table public.sc_tracks add column if not exists artist text;   -- leeg = niet ingevuld op SoundCloud

do $$
declare
  def   text;
  nieuw text;
begin
  def := pg_get_functiondef('public.sc_refresh()'::regprocedure);
  if def like '%metadata_artist%' then
    raise notice 'sc_refresh bewaart de artiest al (overgeslagen)';
    return;
  end if;
  -- a. kolom artist erbij in de insert
  nieuw := regexp_replace(def,
    'insert into sc_tracks \(user_id, track_id, title, permalink_url, created_at, duration_ms\)',
    'insert into sc_tracks (user_id, track_id, title, permalink_url, created_at, duration_ms, artist)');
  if nieuw = def then raise exception 'Kon sc_refresh niet aanpassen (stap a)'; end if;
  def := nieuw;
  -- b. waarde uit metadata_artist + bijwerken bij een bestaande track
  nieuw := regexp_replace(def,
    '(\(t->>''duration''\)::bigint)(\s+from jsonb_array_elements\(items\) t\s+on conflict \(user_id, track_id\) do update\s+set )',
    E'\\1,\n             nullif(btrim(t->>''metadata_artist''), '''')\\2artist = excluded.artist, ');
  if nieuw = def then raise exception 'Kon sc_refresh niet aanpassen (stap b)'; end if;
  execute nieuw;
end $$;

-- 3. YouTube: Beuk-kanalen erbij (eigen kanaal @BeukOfficial + 2 Topic-kanalen "Beuk - Onderwerp")
update public.yt_config
   set channel_ids = array(select distinct x from unnest(channel_ids || array[
         'UCT_ZyuoQScDbKfSt-Pky8sA',   -- eigen kanaal Beuk
         'UCmDsHjgV7COP6F7riyeAn6A',   -- Topic-kanaal Beuk
         'UCJ4bYhbZowfSSmzoq6Aqctw'    -- Topic-kanaal Beuk
       ]) x order by x),
       updated_at = now()
 where not (channel_ids @> array['UCT_ZyuoQScDbKfSt-Pky8sA','UCmDsHjgV7COP6F7riyeAn6A','UCJ4bYhbZowfSSmzoq6Aqctw']);

commit;

-- 4. Meteen één keer ophalen, zodat de artiesten en Beuk-video's er nu al in staan
--    (na de commit: lukt het ophalen even niet, dan blijven de aanpassingen hierboven gewoon staan)
select public.sc_refresh() as soundcloud, public.yt_refresh() as youtube;

-- 5. Controle (alleen lezen)
select 'SoundCloud' as bron, coalesce(artist, '(leeg)') as artiest, count(*) as nummers
  from public.sc_tracks group by 2
union all
select 'YouTube', case when channel_id in ('UCT_ZyuoQScDbKfSt-Pky8sA','UCmDsHjgV7COP6F7riyeAn6A','UCJ4bYhbZowfSSmzoq6Aqctw')
                       then 'Beuk' else 'Marreman Rojas' end, count(*)
  from public.yt_videos group by 2
union all
select 'Spotify', artist, count(distinct song) from public.sp_snapshots group by 2
order by 1, 2;
