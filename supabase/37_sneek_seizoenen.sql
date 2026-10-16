-- 37. Sneek: alle seizoenen bewaren + dashboard kan wisselen (chat 54.3, 17-10-2026)
-- Waarom: in scores staat 1 regel per speler. Speelt iemand in een nieuw seizoen, dan wordt die regel overschreven.
-- Vanaf nu kopieert een trigger de oude regel eerst naar scores_archief. Zo blijft elk seizoen bewaard, zonder handwerk.
-- Het dashboard leest de view sneek_scores_seizoenen (alle seizoenen) en vraagt sneek_seizoen() voor het huidige seizoen.
-- Volgend seizoen beginnen: sneek_seizoen() ophogen (zie onderaan) + SEIZOEN in sneek/index.html. Dashboard volgt vanzelf.
-- Draaien in 2 delen (A en B), net als SQL 35 (in één keer plakken werd toen afgeknipt).

-- ===================== DEEL A =====================
begin;

-- 1. Archief voor alle afgelopen seizoenen (1 regel per seizoen per speler)
create table if not exists public.scores_archief (
  seizoen      smallint    not null,
  insta        text        not null,
  score        integer     not null,
  created_at   timestamptz not null,
  eerst_gezien timestamptz,
  in_seizoen   timestamptz,
  primary key (seizoen, insta)
);
alter table public.scores_archief enable row level security;
revoke all on public.scores_archief from anon, authenticated;
drop policy if exists "dashboard mag lezen" on public.scores_archief;
create policy "dashboard mag lezen" on public.scores_archief for select to authenticated using (true);
grant select on public.scores_archief to authenticated;

-- Seizoen 1 erin (uit het handmatige archief van chat 54; scores_seizoen1 blijft gewoon staan)
insert into public.scores_archief (seizoen, insta, score, created_at, eerst_gezien, in_seizoen)
select 1, insta, score, created_at, eerst_gezien, eerst_gezien from public.scores_seizoen1
on conflict (seizoen, insta) do nothing;

-- 2. Kolom in_seizoen: wanneer iemand voor het eerst op de lèst van zijn seizoen kwam
alter table public.scores add column if not exists in_seizoen timestamptz;
update public.scores set in_seizoen = eerst_gezien where seizoen = 1 and in_seizoen is null;
-- Seizoen 2: eerste goedgekeurde potje sinds het seizoen begon (beste schatting), anders de datum van de score
update public.scores s set in_seizoen = coalesce(
  (select min(p.ingeleverd) from public.potjes p
    where p.insta = s.insta and p.goed
      and p.ingeleverd >= (select min(created_at) from public.scores where seizoen = s.seizoen)),
  s.created_at)
where s.seizoen > 1 and s.in_seizoen is null;

commit;

-- ===================== DEEL B =====================
begin;

-- 3. Trigger: bij een seizoenwissel eerst de oude regel archiveren
create or replace function public.sneek_scores_seizoen_wissel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.in_seizoen := coalesce(new.in_seizoen, now());
  elsif new.seizoen is distinct from old.seizoen then
    insert into public.scores_archief (seizoen, insta, score, created_at, eerst_gezien, in_seizoen)
    values (old.seizoen, old.insta, old.score, old.created_at, old.eerst_gezien, old.in_seizoen)
    on conflict (seizoen, insta) do nothing;
    new.in_seizoen := now();
  end if;
  return new;
end; $$;
revoke all on function public.sneek_scores_seizoen_wissel() from public, anon, authenticated;
drop trigger if exists sneek_seizoen_wissel on public.scores;
create trigger sneek_seizoen_wissel before insert or update on public.scores
  for each row execute function public.sneek_scores_seizoen_wissel();

-- 4. Eén overzicht met alle seizoenen (archief + wat nog in scores staat, zonder dubbele)
create or replace view public.sneek_scores_seizoenen with (security_invoker = true) as
select seizoen, insta, score, created_at, eerst_gezien, in_seizoen from public.scores_archief
union all
select s.seizoen, s.insta, s.score, s.created_at, s.eerst_gezien, s.in_seizoen from public.scores s
where not exists (select 1 from public.scores_archief a where a.seizoen = s.seizoen and a.insta = s.insta);
revoke all on public.sneek_scores_seizoenen from anon, authenticated;
grant select on public.sneek_scores_seizoenen to authenticated;

-- 5. Dashboard mag vragen welk seizoen het nu is (alleen een getal)
grant execute on function public.sneek_seizoen() to authenticated;

commit;

-- ===================== CONTROLE (daarna draaien) =====================
-- verwacht: seizoen 1 = 15 spelers (hoogste 156), seizoen 2 = 3 spelers (hoogste 696), trigger = sneek_seizoen_wissel
-- select seizoen, count(*) spelers, max(score) hoogste, min(in_seizoen) begin from public.sneek_scores_seizoenen group by 1 order by 1;
-- select tgname from pg_trigger where tgrelid = 'public.scores'::regclass and not tgisinternal;

-- ===================== VOLGEND SEIZOEN (later, niet nu) =====================
-- create or replace function public.sneek_seizoen() returns smallint language sql immutable as $$ select 3::smallint $$;
-- + in sneek/index.html: SEIZOEN = 3 (kop en ophalen van de lèst). Archiveren gaat vanzelf via de trigger.
