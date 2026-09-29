-- =====================================================================
-- 11_import_historie.sql — elke upload (SoundCloud-CSV / DJ·World-PDF) bewaren als "momentopname" (29-09-2026)
-- Zo kan het tabblad "Wat is d'r nieuw?" de nieuwste upload vergelijken met de vorige.
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- BELANGRIJK: draai dit VÓÓR je de nieuwe CSV uploadt; stap 4 legt de huidige stand vast als "vorige".
-- =====================================================================

-- 1. Tabel met momentopnames (per upload één regel; de inhoud compact als jsonb)
create table if not exists public.muziek_imports (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  bron         text not null check (bron in ('sc', 'label')),
  bestand      text,
  stand_van    timestamptz not null default now(),   -- wanneer deze stand is ingeladen
  bewaard_om   timestamptz not null default now(),
  samenvatting jsonb not null default '{}',
  data         jsonb not null,
  vingerafdruk text not null                          -- md5 van data: zelfde bestand 2x = niet 2x bewaren
);
create index if not exists muziek_imports_zoek on public.muziek_imports (user_id, bron, stand_van);

alter table public.muziek_imports enable row level security;
drop policy if exists "eigen rijen lezen" on public.muziek_imports;
create policy "eigen rijen lezen" on public.muziek_imports for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_marnix()));
revoke all on public.muziek_imports from anon, authenticated;
grant select on public.muziek_imports to authenticated;

-- 2. Momentopname maken van wat er NU in de tabellen staat
create or replace function public.muziek_snapshot(p_bron text, p_bestand text default null,
                                                   p_uid uuid default null, p_stand timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := coalesce(auth.uid(), p_uid);   -- p_uid telt alleen vanuit de SQL Editor (daar is niemand ingelogd)
  d      jsonb;
  s      jsonb;
  vinger text;
  vorige text;
begin
  if auth.uid() is not null then perform public.alleen_marnix(); end if;
  if uid is null then raise exception 'Geen gebruiker'; end if;

  if p_bron = 'sc' then
    -- per luistermaand, afrekenmaand, artiest, nummer, platform, soort en land opgeteld
    select coalesce(jsonb_agg(jsonb_build_array(m, a, artist, track, partner, type, country, units, usd)
                              order by m, a, artist, track, partner, type, country), '[]'::jsonb)
      into d
      from (select to_char(reporting_period, 'YYYY-MM') m, to_char(accounting_period, 'YYYY-MM') a,
                   artist, track, partner, type, country, sum(units) units, round(sum(revenue_usd), 6) usd
              from sc_earnings where user_id = uid
             group by 1, 2, 3, 4, 5, 6, 7) x;
    select jsonb_build_object('regels', count(*), 'usd', round(coalesce(sum(revenue_usd), 0), 4),
                              'units', coalesce(sum(units), 0),
                              'laatste_afrekening', to_char(max(accounting_period), 'YYYY-MM'),
                              'laatste_maand', to_char(max(reporting_period), 'YYYY-MM'))
      into s from sc_earnings where user_id = uid;
  elsif p_bron = 'label' then
    d := jsonb_build_object(
      'periodes', (select coalesce(jsonb_agg(jsonb_build_object('m', to_char(period_month, 'YYYY-MM'), 'naam', name,
                          'bruto', gross, 'netto', net, 'status', status) order by period_month, name), '[]'::jsonb)
                     from label_periods where user_id = uid),
      'nummers',  (select coalesce(jsonb_agg(jsonb_build_object('t', track, 'v', version, 'a', artist,
                          'streams', stream_count, 'downloads', download_count, 'bruto', gross, 'netto', net)
                          order by track, version), '[]'::jsonb)
                     from label_tracks where user_id = uid),
      'saldo',    (select to_jsonb(x) - 'user_id' - 'id'
                     from (select * from label_statements where user_id = uid order by statement_date desc limit 1) x));
    s := jsonb_build_object('netto',     (select round(coalesce(sum(net), 0), 4) from label_periods where user_id = uid),
                            'streams',   (select coalesce(sum(stream_count), 0) from label_tracks where user_id = uid),
                            'downloads', (select coalesce(sum(download_count), 0) from label_tracks where user_id = uid),
                            'overzicht_van', d->'saldo'->>'statement_date');
  else
    raise exception 'Onbekende bron: %', p_bron;
  end if;

  vinger := md5(d::text);
  select vingerafdruk into vorige from muziek_imports
   where user_id = uid and bron = p_bron order by stand_van desc, id desc limit 1;
  if vorige = vinger then
    return jsonb_build_object('bewaard', false, 'reden', 'precies hetzelfde als de vorige upload');
  end if;

  insert into muziek_imports (user_id, bron, bestand, stand_van, samenvatting, data, vingerafdruk)
  values (uid, p_bron, p_bestand, coalesce(p_stand, now()), s, d, vinger);
  return jsonb_build_object('bewaard', true, 'samenvatting', s);
end;
$$;
revoke execute on function public.muziek_snapshot(text, text, uuid, timestamptz) from public, anon;
grant  execute on function public.muziek_snapshot(text, text, uuid, timestamptz) to authenticated;

-- 3. De twee import-functies maken voortaan zelf een momentopname (vlak vóór hun "return").
--    We passen de functie aan zoals hij NU in de database staat.
do $$
declare
  def text;
begin
  def := pg_get_functiondef('public.import_soundcloud(jsonb,text)'::regprocedure);
  if def not like '%muziek_snapshot%' then
    def := regexp_replace(def, '(\n\s*return jsonb_build_object\(''deleted'')',
                          E'\n  perform public.muziek_snapshot(''sc'', file_name);\\1');
    if def not like '%muziek_snapshot%' then raise exception 'import_soundcloud: plek voor momentopname niet gevonden'; end if;
    execute def;
  end if;

  def := pg_get_functiondef('public.import_djworld(jsonb)'::regprocedure);
  if def not like '%muziek_snapshot%' then
    def := regexp_replace(def, '(\n\s*return jsonb_build_object\(''periods'')',
                          E'\n  perform public.muziek_snapshot(''label'', coalesce(doc->>''bestand'', ''DJ·World '' || (doc->>''statement_date'')));\\1');
    if def not like '%muziek_snapshot%' then raise exception 'import_djworld: plek voor momentopname niet gevonden'; end if;
    execute def;
  end if;
end $$;

-- 4. Nulmeting: de huidige stand vastleggen als "vorige upload"
select public.muziek_snapshot('sc',
         (select source_file from sc_earnings e where e.user_id = u.id
           group by source_file order by count(*) desc limit 1),
         u.id,
         (select max(imported_at) from sc_earnings e where e.user_id = u.id)) as soundcloud,
       public.muziek_snapshot('label', 'DJ·World-overzicht',
         u.id,
         (select max(statement_date)::timestamptz from label_statements s where s.user_id = u.id)) as djworld
  from auth.users u where u.email = 'marnixvanroyen@gmail.com';

-- 5. Controle: wat staat er nu als momentopname?
select bron, bestand, stand_van, samenvatting from public.muziek_imports order by bron, stand_van;
