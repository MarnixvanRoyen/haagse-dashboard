-- =====================================================================
-- 33_plekkies_te_plannen.sql — status "Te plannen" voor Plekkies (15-10-2026, chat 50)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Statussen: te_plannen → gepland → geschoten → gepost. Nieuwe kaart begint op te_plannen.
-- =====================================================================
begin;
alter table public.hp_shoots drop constraint if exists hp_shoots_status_check;
alter table public.hp_shoots add constraint hp_shoots_status_check
  check (status in ('te_plannen', 'gepland', 'geschoten', 'gepost'));
alter table public.hp_shoots alter column status set default 'te_plannen';
commit;

-- controle: moet de nieuwe regel en de standaard 'te_plannen' laten zien
select pg_get_constraintdef(oid) as regel,
       (select column_default from information_schema.columns
         where table_schema = 'public' and table_name = 'hp_shoots' and column_name = 'status') as standaard
from pg_constraint where conname = 'hp_shoots_status_check';
