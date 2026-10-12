-- =====================================================================
-- 30_demografie.sql — Wie kijkt d'r? Leeftijd, geslacht, land en stad van je Insta-publiek (12-10-2026, chat 13)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Alles of niets: gaat er iets mis vóór de commit, dan wordt niets van dit bestand bewaard.
--
-- Meta (Instagram-route, zelfde sleutel als de rest; recht instagram_business_manage_insights):
--   follower_demographics          → wie = 'volgers'   (wie je volgt)
--   engaged_audience_demographics  → wie = 'reageert'  (wie likete, reageerde, deelde of bewaarde)
--   reached_audience_demographics  → wie = 'bereik'    (wie je zag)
--   elk × breakdown age / gender / country / city, period=lifetime, timeframe=this_month (= laatste 30 dagen).
--   Meta geeft per lijstje alleen de top 45, telt alleen wie het kent, en loopt tot 48 uur achter.
-- Elke nacht 1 momentopname = 12 vragen aan Meta (Instagram-route, nie de Facebook-limiet).
-- Threads blijft in th_demografie (19_threads.sql, 1x per week).
-- =====================================================================
begin;

-- 1. Tabel: per dag (Haagse dag) per groep per soort de verdeling
create table if not exists public.ig_demografie (
  wie         text not null check (wie in ('volgers', 'reageert', 'bereik')),
  soort       text not null check (soort in ('age', 'gender', 'country', 'city')),
  dag         date not null,
  data        jsonb not null default '{}',     -- {"35-44": 869, ...} of {"The Hague, Zuid-Holland": 1451, ...}
  fout        text,
  gemeten_om  timestamptz not null default now(),
  primary key (wie, soort, dag)
);
alter table public.ig_demografie enable row level security;
drop policy if exists "alleen marnix mag lezen" on public.ig_demografie;
create policy "alleen marnix mag lezen" on public.ig_demografie for select to authenticated using ((select public.is_marnix()));
revoke all on public.ig_demografie from anon, authenticated;
grant select on public.ig_demografie to authenticated;

-- 2. Ophalen: 3 groepen × 4 soorten. Een mislukte vraag wordt overgeslagen en gemeld (ronde gaat door).
--    Mislukt hij op een dag waarop hij al gelukt was, dan blijft de goede meting staan.
create or replace function public.ig_demografie_refresh()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  vandaag  date := (now() at time zone 'Europe/Amsterdam')::date;
  w        record;
  b        text;
  j        jsonb;
  c        jsonb;
  n_ok     int := 0;
  fouten   text[] := '{}';
  t0       timestamptz := clock_timestamp();
begin
  for w in select * from (values ('volgers', 'follower_demographics'),
                                 ('reageert', 'engaged_audience_demographics'),
                                 ('bereik', 'reached_audience_demographics')) x(wie, metriek) loop
    foreach b in array array['age', 'gender', 'country', 'city'] loop
      begin
        j := ig_get('me/insights?metric=' || w.metriek || '&period=lifetime&metric_type=total_value&timeframe=this_month&breakdown=' || b);
        select coalesce(jsonb_object_agg(r->'dimension_values'->>0, (r->>'value')::numeric), '{}') into c
          from jsonb_array_elements(coalesce(j->'data', '[]')) e,
               jsonb_array_elements(coalesce(e->'total_value'->'breakdowns'->0->'results', '[]')) r
         where r->'dimension_values'->>0 is not null;
        if c = '{}'::jsonb then raise exception 'Meta gaf een lege lijst (onder 100 volgers of te weinig mensen)'; end if;
        insert into ig_demografie (wie, soort, dag, data, fout, gemeten_om) values (w.wie, b, vandaag, c, null, now())
        on conflict (wie, soort, dag) do update set data = excluded.data, fout = null, gemeten_om = now();
        n_ok := n_ok + 1;
      exception when others then
        insert into ig_demografie (wie, soort, dag, data, fout, gemeten_om) values (w.wie, b, vandaag, '{}', left(sqlerrm, 200), now())
        on conflict (wie, soort, dag) do update set fout = excluded.fout, gemeten_om = now()
          where ig_demografie.data = '{}'::jsonb;              -- een goede meting van vandaag nie overschrijven
        fouten := fouten || (w.wie || ' ' || b || ': ' || left(sqlerrm, 80));
      end;
    end loop;
  end loop;
  return jsonb_build_object('gelukt', n_ok, 'van', 12, 'fouten', to_jsonb(fouten),
                            'sec', round(extract(epoch from clock_timestamp() - t0)::numeric, 1));
end $$;
revoke execute on function public.ig_demografie_refresh() from public, anon, authenticated;

-- 3. Elke nacht om 05:45 UTC (07:45 bij ons in de zomer), na de andere Insta-klusjes
select cron.unschedule(jobname) from cron.job where jobname = 'instagram-demografie';
select cron.schedule('instagram-demografie', '45 5 * * *', 'select public.ig_demografie_refresh()');

commit;

-- 4. Meteen 1x ophalen (los van de commit: lukt Meta nie, dan staan tabel en klusje er toch)
select public.ig_demografie_refresh() as eerste_meting;
