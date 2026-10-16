-- =====================================================================
-- 36_events.sql — tab Events: events plannen voor The Hague Beachlife / Marreman Rojas (16-10-2026, chat 53)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Alles of niets: gaat er iets mis, dan wordt niets van dit bestand bewaard.
--
-- Twee tabellen:
--   ev_events = het event zelf (titel, plek, begin/eind, soort, max. plekken, omschrijving, status)
--   ev_gasten = de gastenlijst per event (naam, Insta, e-mail alleen met akkoord, status uitgenodigd/komt/kan nie)
-- Aanmelden doet Marnix zelf (gasten antwoorden via WhatsApp/DM). Geen openbare pagina, dus anon kan nergens bij.
-- Privacy (AVG):
--   * e-mail kan ALLEEN worden opgeslagen als akkoord = ja (regel in de database zelf); geen telefoon nodig
--   * event wissen = gastenlijst gaat mee weg (on delete cascade)
--   * "Contact wisse" na een event = gewone update (e-mail + akkoord leeg), mag via de eigen-rijen-regel
--   * alleen Marnix kan erbij (user_id + "eigen rijen" + is_marnix()); anon heeft geen rechten
-- =====================================================================
begin;

-- 1. Events
create table if not exists public.ev_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid(),
  titel          text not null check (char_length(btrim(titel)) between 1 and 120),
  plek           text not null check (char_length(btrim(plek)) between 1 and 200),
  begint         timestamptz not null,
  eindigt        timestamptz,
  soort          text not null default 'uitnodiging' check (soort in ('uitnodiging', 'open')),
  max_plekken    int check (max_plekken between 1 and 10000),               -- null = geen maximum
  omschrijving   text check (char_length(omschrijving) <= 2000),
  status         text not null default 'concept' check (status in ('concept', 'uitgenodigd', 'afgelast')),
  aangemaakt_om  timestamptz not null default now(),
  bijgewerkt_om  timestamptz not null default now(),
  constraint ev_eind_na_begin check (eindigt is null or eindigt > begint)
);
create index if not exists ev_events_begint on public.ev_events (begint);

-- 2. Gasten
create table if not exists public.ev_gasten (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid(),
  event_id       uuid not null references public.ev_events(id) on delete cascade,
  naam           text not null check (char_length(btrim(naam)) between 1 and 100),
  insta          text check (insta ~ '^[a-z0-9._]{1,30}$'),                  -- zonder @, kleine letters
  email          text check (char_length(email) <= 200 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  akkoord        boolean not null default false,
  akkoord_op     date,
  status         text not null default 'uitgenodigd' check (status in ('uitgenodigd', 'komt', 'kan_nie')),
  aangemaakt_om  timestamptz not null default now(),
  bijgewerkt_om  timestamptz not null default now(),
  constraint ev_email_alleen_met_akkoord check (akkoord or email is null),
  constraint ev_akkoord_met_datum        check (not akkoord or akkoord_op is not null)
);
create index if not exists ev_gasten_event on public.ev_gasten (event_id);

-- 3. bijgewerkt_om automatisch bijhouden (functie hp_bijgewerkt uit 32_plekkies.sql, hier opnieuw voor de zekerheid)
create or replace function public.hp_bijgewerkt()
returns trigger language plpgsql set search_path = '' as $$
begin new.bijgewerkt_om := now(); return new; end; $$;
revoke execute on function public.hp_bijgewerkt() from public, anon, authenticated;
drop trigger if exists ev_events_bijgewerkt on public.ev_events;
create trigger ev_events_bijgewerkt before update on public.ev_events for each row execute function public.hp_bijgewerkt();
drop trigger if exists ev_gasten_bijgewerkt on public.ev_gasten;
create trigger ev_gasten_bijgewerkt before update on public.ev_gasten for each row execute function public.hp_bijgewerkt();

-- 4. Beveiliging: alleen Marnix, alleen eigen rijen (slot is_marnix uit 09_insta.sql)
alter table public.ev_events enable row level security;
alter table public.ev_gasten enable row level security;
drop policy if exists "alleen marnix, eigen rijen" on public.ev_events;
create policy "alleen marnix, eigen rijen" on public.ev_events for all to authenticated
  using ((select public.is_marnix()) and user_id = (select auth.uid()))
  with check ((select public.is_marnix()) and user_id = (select auth.uid()));
drop policy if exists "alleen marnix, eigen rijen" on public.ev_gasten;
create policy "alleen marnix, eigen rijen" on public.ev_gasten for all to authenticated
  using ((select public.is_marnix()) and user_id = (select auth.uid()))
  with check ((select public.is_marnix()) and user_id = (select auth.uid())
              and exists (select 1 from public.ev_events e where e.id = event_id and e.user_id = (select auth.uid())));
revoke all on public.ev_events, public.ev_gasten from anon, authenticated;
grant select, insert, update, delete on public.ev_events, public.ev_gasten to authenticated;

commit;

-- controle: moet 2 regels geven met 0 en geen fout
select 'ev_events' as tabel, count(*) as rijen from public.ev_events
union all
select 'ev_gasten', count(*) from public.ev_gasten;
