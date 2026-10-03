-- =====================================================================
-- 21_kansen_extra.sql — Kansâh: zelf posts/nummâhs toevoegen aan of weghalen uit een challenge (03-10-2026)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- extra = {"plus": [media_id], "min": [media_id], "nummers": [track_id]}
-- =====================================================================
alter table public.kans_poging add column if not exists extra jsonb not null default '{}'::jsonb;
notify pgrst, 'reload schema';   -- zodat de app de nieuwe kolom meteen ziet

-- controle: elke poging heeft nu een (lege) extra
select sleutel, extra from public.kans_poging order by gestart_om;
