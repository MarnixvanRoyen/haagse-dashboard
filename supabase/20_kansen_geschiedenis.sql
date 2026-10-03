-- =====================================================================
-- 20_kansen_geschiedenis.sql — Kansâh: tijdstempels, looptijd, rapport en geschiedenis (03-10-2026)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
--
-- Elke keer dat je op "Mee bezig" klikt, start er een POGING:
--   gestart_om (tijdstempel) + looptijd (vast per kans) = rapport_op.
--   Afmelden met "Gedaan" of "Gestopt" zet gestopt_om + afloop.
--   Elke dag dat je het dashboard opent, bewaart de app de meetwaarde van de kans (kans_meting).
--   Op rapport_op rekent de app het rapport uit en bewaart het hier (rapport, rapport_klaar_om).
--   gelezen_om = je hebt het rapport bekeken (dan stopt de melding op Ovâhzicht).
-- kans_status (10_kansen.sql) blijft bestaan, alleen nog voor "Nie voor mij" (verborgen).
-- =====================================================================

-- 0. tabel uit 10_kansen.sql (voor het geval die nog nie gedraaid is)
create table if not exists public.kans_status (
  sleutel      text primary key,
  status       text not null check (status in ('bezig', 'gedaan', 'verborgen')),
  waarde_toen  numeric,
  tekst_toen   text,
  gezet_om     timestamptz not null default now()
);
alter table public.kans_status enable row level security;
drop policy if exists "alleen marnix" on public.kans_status;
create policy "alleen marnix" on public.kans_status for all to authenticated
  using ((select public.is_marnix())) with check ((select public.is_marnix()));
revoke all on public.kans_status from anon, authenticated;
grant select, insert, update, delete on public.kans_status to authenticated;

-- 1. pogingen: één regel per keer dat je met een kans aan de slag gaat
create table if not exists public.kans_poging (
  id               bigint generated always as identity primary key,
  sleutel          text not null,                                   -- bijv. 'insta-onderwerp-maan'
  bron             text not null check (bron in ('muziek', 'insta', 'sneek')),
  kop              text,                                            -- kop van de kaart toen (html, van het dashboard zelf)
  actie            text,                                            -- "Doe: …" van de kaart toen
  big              text,                                            -- groot getal op de kaart toen
  gestart_om       timestamptz not null default now(),
  looptijd_dagen   integer not null check (looptijd_dagen between 1 and 365),
  rapport_op       timestamptz not null,
  gestopt_om       timestamptz,
  afloop           text check (afloop in ('gedaan', 'gestopt')),
  meet_naam        text,                                            -- wat er gemeten wordt, bijv. 'plays erbij per week'
  meet_beter       text check (meet_beter in ('hoger', 'lager')),
  meet_fmt         text,                                            -- 'eur' of leeg
  waarde_start     numeric,
  rapport          jsonb,
  rapport_klaar_om timestamptz,
  gelezen_om       timestamptz,
  constraint afloop_samen check ((afloop is null) = (gestopt_om is null))
);
-- per kans hooguit één poging tegelijk "mee bezig"
create unique index if not exists kans_poging_een_bezig on public.kans_poging (sleutel) where gestopt_om is null;
create index if not exists kans_poging_rapport on public.kans_poging (rapport_op) where rapport is null;

-- 2. dagmetingen: de meetwaarde van de kans per dag zolang de poging loopt
create table if not exists public.kans_meting (
  poging_id  bigint not null references public.kans_poging(id) on delete cascade,
  dag        date not null,                                          -- Haagse dag
  waarde     numeric not null,
  primary key (poging_id, dag)
);

-- 3. alleen Marnix mag lezen en schrijven (slot is_marnix uit 09_insta.sql)
alter table public.kans_poging enable row level security;
alter table public.kans_meting enable row level security;
drop policy if exists "alleen marnix" on public.kans_poging;
drop policy if exists "alleen marnix" on public.kans_meting;
create policy "alleen marnix" on public.kans_poging for all to authenticated
  using ((select public.is_marnix())) with check ((select public.is_marnix()));
create policy "alleen marnix" on public.kans_meting for all to authenticated
  using ((select public.is_marnix())) with check ((select public.is_marnix()));
revoke all on public.kans_poging, public.kans_meting from anon, authenticated;
grant select, insert, update, delete on public.kans_poging, public.kans_meting to authenticated;

-- 4. controle: tabellen bestaan, en hoeveel oude "mee bezig/gedaan" de app straks overzet naar pogingen
select
  (select count(*) from public.kans_poging)                                         as pogingen,
  (select count(*) from public.kans_meting)                                         as metingen,
  (select count(*) from public.kans_status where status in ('bezig', 'gedaan'))     as oude_stand_over_te_zetten,
  (select count(*) from public.kans_status where status = 'verborgen')              as nie_voor_mij;
