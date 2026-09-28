-- =====================================================================
-- 10_kansen.sql — onthoudt wat je met een kans doet (Kansâh-pagina) (29-09-2026)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Per kans: status (bezig / gedaan / verborgen) en de meetwaarde van dat moment, zodat je ziet of het betâh gaat.
-- =====================================================================
create table if not exists public.kans_status (
  sleutel      text primary key,                                   -- bijv. 'insta-onderwerp-maan'
  status       text not null check (status in ('bezig', 'gedaan', 'verborgen')),
  waarde_toen  numeric,                                            -- meetwaarde op het moment dat je hem aanklikte
  tekst_toen   text,                                               -- kop van de kaart toen (ter herinnering)
  gezet_om     timestamptz not null default now()
);

-- alleen Marnix mag lezen en schrijven (slot is_marnix uit 09_insta.sql)
alter table public.kans_status enable row level security;
drop policy if exists "alleen marnix" on public.kans_status;
create policy "alleen marnix" on public.kans_status for all to authenticated
  using ((select public.is_marnix())) with check ((select public.is_marnix()));
revoke all on public.kans_status from anon, authenticated;
grant select, insert, update, delete on public.kans_status to authenticated;

-- controle: moet 0 regels en geen fout geven
select count(*) as kansen_bewaard from public.kans_status;
