-- 35. Sneek: nieuw seizoen op de scorelèst (chat 54, 16-10-2026)
-- Wat: de lèst van nu wordt 'seizoen 1' (bewaard in scores_seizoen1). Het spel toont voortaan alleen seizoen 2.
-- Per speler blijft 1 regel in scores (eerst_gezien blijft staan, dus het dashboard telt nieuwe spelers nog goed).
-- Draaien VÓÓR het pushen van Sneek (het nieuwe spel vraagt om de kolom seizoen).
-- LET OP: in één keer plakken ging mis (Supabase kreeg de tekst afgeknipt binnen). Gedraaid in 2 delen op 16-10:
--   deel A = stap 1 t/m 3 (met begin/commit), deel B = stap 4 (poortwachter). Allebei gecontroleerd: OK.
-- Poortwachter = kopie van potje-beveiliging.sql (A8), alleen het stuk 'insert into public.scores' is anders.
begin;

-- 1. Archief: kopie van de lèst zoals hij nu is
create table if not exists public.scores_seizoen1 as select * from public.scores;
alter table public.scores_seizoen1 enable row level security;
revoke all on public.scores_seizoen1 from anon, authenticated;
drop policy if exists "dashboard mag lezen" on public.scores_seizoen1;
create policy "dashboard mag lezen" on public.scores_seizoen1 for select to authenticated using (true);
grant select on public.scores_seizoen1 to authenticated;

-- 2. Huidig seizoen op één plek (volgend seizoen: hier 3 van maken + SEIZOEN in het spel)
create or replace function public.sneek_seizoen() returns smallint language sql immutable as $$ select 2::smallint $$;
revoke all on function public.sneek_seizoen() from public, anon, authenticated;

-- 3. Kolom seizoen: alle bestaande regels = 1, nieuwe regels = het huidige seizoen
alter table public.scores add column if not exists seizoen smallint not null default 1;
alter table public.scores alter column seizoen set default public.sneek_seizoen();

-- 4. Poortwachter
create or replace function public.bewaar_score_potje(p_potje uuid, p_insta text, p_score integer)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare ip text := public.sneek_ip_hash(); k public.potjes%rowtype; ms numeric;
begin
  -- Zelfde basisregels als altijd
  if p_insta is null or p_insta !~ '^[a-z0-9._]{1,30}$' then raise exception 'niet gelukt'; end if;
  if p_score is null or p_score < 1 or p_score > 1000 then raise exception 'niet gelukt'; end if;

  -- Rem per IP: max 10 per minuut en 60 per uur (pogingen die geweigerd zijn tellen ook mee)
  if (select count(*) from public.potjes where ip_hash = ip and ingeleverd > now() - interval '1 minute')
   + (select count(*) from public.score_poging where ip_hash = ip and tijd > now() - interval '1 minute') >= 10
  or (select count(*) from public.potjes where ip_hash = ip and ingeleverd > now() - interval '1 hour')
   + (select count(*) from public.score_poging where ip_hash = ip and tijd > now() - interval '1 hour') >= 60 then
    raise exception 'effe wachten';
  end if;
  -- Bestaande remmen: iedereen samen max 30 per minuut, zelfde naam max 1 keer per 30 seconden
  if (select count(*) from public.scores where created_at > now() - interval '1 minute') >= 30 then
    raise exception 'te druk';
  end if;
  if exists (select 1 from public.scores where insta = p_insta and created_at > now() - interval '30 seconds') then
    raise exception 'effe wachten';
  end if;

  -- Kaartje controleren (en vastzetten, zodat het maar 1 keer kan)
  select * into k from public.potjes where id = p_potje for update;
  if not found or k.ingeleverd is not null or k.gestart < now() - interval '12 hours' then
    insert into public.score_poging (insta, score, reden, ip_hash, potje)
    values (p_insta, p_score, case when not found then 'geen kaartje' when k.ingeleverd is not null then 'kaartje al gebruikt' else 'kaartje verlopen' end, ip, p_potje);
    return;   -- stil weigeren: geen foutmelding die de regels verraadt (de speler komt gewoon niet op de lèst)
  end if;

  -- Tijdcheck: kon deze score in deze tijd?
  ms := extract(epoch from (now() - k.gestart)) * 1000;
  if ms < public.sneek_min_ms(p_score) then
    insert into public.score_poging (insta, score, reden, ip_hash, potje, speeltijd_s)
    values (p_insta, p_score, 'te snel', ip, p_potje, round(ms / 1000, 1));
    update public.potjes set ingeleverd = now(), insta = p_insta, score = p_score, goed = false where id = p_potje;
    return;   -- stil weigeren
  end if;

  update public.potjes set ingeleverd = now(), insta = p_insta, score = p_score, goed = true where id = p_potje;
  -- Seizoen (chat 54): nieuwe regels krijgen het huidige seizoen. Wie nog op een oud seizoen staat,
  -- krijgt zijn eerste score van het nieuwe seizoen altijd (ook als die lager is); daarna alleen een betere.
  insert into public.scores (insta, score, seizoen)
  values (p_insta, p_score, public.sneek_seizoen())
  on conflict (insta) do update
    set score = excluded.score, created_at = now(), seizoen = excluded.seizoen
    where public.scores.score < excluded.score or public.scores.seizoen < excluded.seizoen;
end; $$;
revoke all on function public.bewaar_score_potje(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.bewaar_score_potje(uuid, text, integer) to anon;

commit;

-- CONTROLE (daarna draaien): seizoen 1 = alle oude spelers, archief even groot
-- select seizoen, count(*) spelers, max(score) hoogste from public.scores group by 1
-- union all select 0, count(*), max(score) from public.scores_seizoen1;
