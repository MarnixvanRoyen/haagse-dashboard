-- 05_sneek.sql — Sneek-cijfers in het Haagse Content Performance Dashboard (27-09-2026)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run).

-- 1. Het dashboard (ingelogd = alleen Marnix) mag de scorelèst lezen.
--    Tot nu toe mocht alleen 'anon' (bezoekers van het spel) lezen.
--    De lèst is sowieso openbaar, dus dit geeft niemand iets nieuws.
drop policy if exists "dashboard mag lezen" on public.scores;
create policy "dashboard mag lezen"
  on public.scores for select
  to authenticated
  using (true);
grant select on public.scores to authenticated;

-- 2. Nieuwe kolom: wanneer iemand vóór het eerst op de lèst kwam.
--    created_at verschuift bij elke betere score, dus daarmee kun je nieuwe spelers niet tellen.
--    De poortwachter (bewaar_score) raakt deze kolom niet aan: nieuwe spelers krijgen vanzelf now(),
--    bij een betere score blijft de datum staan. Het spel zelf hoeft niet te veranderen.
alter table public.scores add column if not exists eerst_gezien timestamptz;
update public.scores set eerst_gezien = created_at where eerst_gezien is null;  -- beste schatting voor bestaande spelers
alter table public.scores alter column eerst_gezien set default now();
alter table public.scores alter column eerst_gezien set not null;
