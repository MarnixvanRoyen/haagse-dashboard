-- =====================================================================
-- 32_plekkies.sql — tab Plekkies: serie "Haagse plekkies doâh Haagse mense" (15-10-2026, chat 50)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Alles of niets: gaat er iets mis, dan wordt niets van dit bestand bewaard.
--
-- Twee tabellen:
--   hp_mensen = wie doet mee (naam, Insta, contact, notitie, akkoord)
--   hp_shoots = waar en wanneer, tekst, status en de gekoppelde Insta-post
-- Privacy (AVG):
--   * e-mail en telefoon kunnen ALLEEN worden opgeslagen als akkoord = ja (regel in de database zelf)
--   * hp_contact_wissen(id): contact + notitie weg, persoon naar het archief (naam + Insta + geposte shoots blijven),
--     shoots die nooit gepost zijn worden mee gewist
--   * hp_alles_wissen(id):   persoon helemaal weg; geposte shoots blijven zonder naam ("gewiste persoon")
--   * alleen Marnix kan erbij (user_id + "eigen rijen" + is_marnix()); anon heeft geen rechten
-- =====================================================================
begin;

-- 1. Mensen
create table if not exists public.hp_mensen (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid(),
  naam           text not null check (char_length(btrim(naam)) between 1 and 100),
  insta          text check (insta ~ '^[a-z0-9._]{1,30}$'),                  -- zonder @, kleine letters
  email          text check (char_length(email) <= 200 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  telefoon       text check (telefoon ~ '^[0-9 +()-]{6,25}$'),
  notitie        text check (char_length(notitie) <= 3000),                  -- hun plekkie en verhaal
  akkoord        boolean not null default false,
  akkoord_op     date,
  akkoord_hoe    text check (akkoord_hoe in ('dm', 'mail', 'mondeling', 'anders')),
  archief        boolean not null default false,                             -- contact gewist, alleen naam + posts bewaard
  gewist_om      timestamptz,
  aangemaakt_om  timestamptz not null default now(),
  bijgewerkt_om  timestamptz not null default now(),
  constraint hp_contact_alleen_met_akkoord check (akkoord or (email is null and telefoon is null)),
  constraint hp_akkoord_met_datum          check (not akkoord or akkoord_op is not null),
  constraint hp_archief_zonder_contact     check (not archief or (email is null and telefoon is null and notitie is null))
);

-- 2. Shoots
create table if not exists public.hp_shoots (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid(),
  persoon_id     uuid references public.hp_mensen(id) on delete set null,   -- null = gewiste persoon
  plek           text not null check (char_length(btrim(plek)) between 1 and 200),
  kaart_link     text check (char_length(kaart_link) <= 1000 and kaart_link ~ '^https://'),
  wanneer        timestamptz,                                               -- datum + tijd (null = nog nie gepland)
  status         text not null default 'gepland' check (status in ('gepland', 'geschoten', 'gepost')),
  caption        text check (char_length(caption) <= 5000),
  story_tekst    text check (char_length(story_tekst) <= 5000),
  tekst_status   text not null default 'idee' check (tekst_status in ('idee', 'klaar', 'gepost')),
  media_id       text check (media_id ~ '^[0-9]{5,30}$'),                   -- gekoppelde Insta-post (ig_media)
  aangemaakt_om  timestamptz not null default now(),
  bijgewerkt_om  timestamptz not null default now()
);
create index if not exists hp_shoots_persoon on public.hp_shoots (persoon_id);
create index if not exists hp_shoots_wanneer on public.hp_shoots (wanneer);

-- 3. bijgewerkt_om automatisch bijhouden
create or replace function public.hp_bijgewerkt()
returns trigger language plpgsql set search_path = '' as $$
begin new.bijgewerkt_om := now(); return new; end; $$;
revoke execute on function public.hp_bijgewerkt() from public, anon, authenticated;
drop trigger if exists hp_mensen_bijgewerkt on public.hp_mensen;
create trigger hp_mensen_bijgewerkt before update on public.hp_mensen for each row execute function public.hp_bijgewerkt();
drop trigger if exists hp_shoots_bijgewerkt on public.hp_shoots;
create trigger hp_shoots_bijgewerkt before update on public.hp_shoots for each row execute function public.hp_bijgewerkt();

-- 4. Beveiliging: alleen Marnix, alleen eigen rijen (slot is_marnix uit 09_insta.sql)
alter table public.hp_mensen enable row level security;
alter table public.hp_shoots enable row level security;
drop policy if exists "alleen marnix, eigen rijen" on public.hp_mensen;
create policy "alleen marnix, eigen rijen" on public.hp_mensen for all to authenticated
  using ((select public.is_marnix()) and user_id = (select auth.uid()))
  with check ((select public.is_marnix()) and user_id = (select auth.uid()));
drop policy if exists "alleen marnix, eigen rijen" on public.hp_shoots;
create policy "alleen marnix, eigen rijen" on public.hp_shoots for all to authenticated
  using ((select public.is_marnix()) and user_id = (select auth.uid()))
  with check ((select public.is_marnix()) and user_id = (select auth.uid()));
revoke all on public.hp_mensen, public.hp_shoots from anon, authenticated;
grant select, insert, update, delete on public.hp_mensen, public.hp_shoots to authenticated;

-- 5. Wissen (knoppen in de app)
create or replace function public.hp_contact_wissen(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n_shoots int; n int;
begin
  perform public.alleen_marnix();
  delete from public.hp_shoots where persoon_id = p_id and status <> 'gepost';
  get diagnostics n_shoots = row_count;
  update public.hp_mensen
     set email = null, telefoon = null, notitie = null, archief = true, gewist_om = now()
   where id = p_id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Persoon nie gevonden'; end if;
  return jsonb_build_object('gewist', true, 'shoots_gewist', n_shoots);
end; $$;

create or replace function public.hp_alles_wissen(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n_shoots int; n int;
begin
  perform public.alleen_marnix();
  delete from public.hp_shoots where persoon_id = p_id and status <> 'gepost';
  get diagnostics n_shoots = row_count;
  delete from public.hp_mensen where id = p_id;       -- geposte shoots blijven, persoon_id wordt null
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Persoon nie gevonden'; end if;
  return jsonb_build_object('gewist', true, 'shoots_gewist', n_shoots);
end; $$;
revoke execute on function public.hp_contact_wissen(uuid) from public, anon;
revoke execute on function public.hp_alles_wissen(uuid)   from public, anon;
grant  execute on function public.hp_contact_wissen(uuid) to authenticated;
grant  execute on function public.hp_alles_wissen(uuid)   to authenticated;

commit;

-- controle: moet 2 regels geven met 0 en geen fout
select 'hp_mensen' as tabel, count(*) as rijen from public.hp_mensen
union all
select 'hp_shoots', count(*) from public.hp_shoots;
