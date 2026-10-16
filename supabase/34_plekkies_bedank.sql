-- =====================================================================
-- 34_plekkies_bedank.sql — Plekkies: onthouden wat je met het bedankje deed (16-10-2026, chat 50.3)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
--
-- Waarom: 48 uur na een geposte plekkie-post vraagt het dashboard of je een bedankkaart wil sturen.
-- Wat je kiest (verstuurd / later / nie sture) staat hier, zodat je iPhone en je Mac het allebei weten.
--   bedank_status: null = nog niks gedaan · 'verstuurd' (Deel of Downloade getikt) · 'later' (morgen opnieuw vragen)
--                  · 'overslaan' (nooit meer vragen)
--   bedank_op:     wanneer je dat koos
-- Beveiliging: zelfde tabel, dus zelfde slot (alleen Marnix, eigen rijen; 32_plekkies.sql). Geen nieuwe rechten nodig.
-- =====================================================================
begin;
alter table public.hp_shoots add column if not exists bedank_status text;
alter table public.hp_shoots add column if not exists bedank_op timestamptz;
alter table public.hp_shoots drop constraint if exists hp_shoots_bedank_check;
alter table public.hp_shoots add constraint hp_shoots_bedank_check
  check ((bedank_status is null and bedank_op is null)
      or (bedank_status in ('verstuurd', 'later', 'overslaan') and bedank_op is not null));
commit;

-- controle: moet 2 regels geven (bedank_op, bedank_status)
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'hp_shoots' and column_name like 'bedank%'
order by column_name;
