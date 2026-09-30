-- 13_ig_live_sneller.sql — Insta verversen (ig_live) mag nooit meer vastlopen op de tijdslimiet (30-09-2026)
-- Probleem: Supabase breekt een vraag vanuit het dashboard af na 8 s ("statement timeout") en bewaart dan NIKS.
--   Meting 30-09: ig_live duurde 9,9 s; alleen de stories-stap al 6-10 s (4 stories x 3 vragen aan Meta).
-- Oplossing:
--   1. stories-stap uit ig_live (het uurlijkse klusje instagram-stories doet ze al, elk uur op :50)
--   2. elke vraag aan Meta wacht hooguit 3 s (was 5 s), op een slot van een ander klusje hooguit 2 s
--   3. na 6 s begint ig_live niks nieuws meer (was 4 s)
--   4. tijdslimiet voor ingelogd (= alleen Marnix; Sneek-spelers zijn anon en merken niks) van 8 naar 15 s
--   Rekensom slechtste geval: 6 s + 2 vragen x 3 s + labels < 15 s. Normaal ± 4-5 s.
-- Veilig opnieuw te draaien. Gaat er iets mis, dan wordt niets van ig_live veranderd.

do $migratie$
declare
  def  text;
  a    int;
  b    int;
  n    int;
  slot text := E'  perform alleen_marnix();\n';
begin
  def := pg_get_functiondef('public.ig_live(integer)'::regprocedure);
  if def like '%-- 13: sneller%' then
    raise notice 'ig_live is al sneller gemaakt, niks gedaan';
    return;
  end if;

  -- 1. stories-stap eruit (alles van "-- e. stories" tot "-- f. labels")
  a := strpos(def, '  -- e. stories');
  b := strpos(def, '  -- f. labels');
  if a = 0 or b = 0 or b < a then
    raise exception 'ig_live: stories-stap niet gevonden';
  end if;
  def := left(def, a - 1)
      || E'  -- e. stories: niet meer hier (duurde 6-10 s); het uurlijkse klusje instagram-stories doet ze\n\n'
      || substr(def, b);

  -- 2. per vraag hooguit 3 s wachten op Meta, hooguit 2 s op een slot (alleen binnen deze ronde)
  n := (length(def) - length(replace(def, slot, ''))) / length(slot);
  if n <> 1 then
    raise exception 'ig_live: plek na alleen_marnix() niet (precies 1x) gevonden';
  end if;
  def := replace(def, slot, slot
      || E'  -- 13: sneller — elke vraag aan Meta hooguit 3 s, op een ander klusje hooguit 2 s wachten\n'
      || E'  perform set_config(''http.timeout_msec'', ''3000'', true);\n'
      || E'  perform set_config(''lock_timeout'', ''2s'', true);\n');

  -- 3. na 6 s niks nieuws meer beginnen
  if strpos(def, 'max_sec  numeric := 4;') = 0 then
    raise exception 'ig_live: regel max_sec niet gevonden';
  end if;
  def := replace(def, 'max_sec  numeric := 4;', 'max_sec  numeric := 6;');
  def := replace(def, '(Supabase breekt af na 8 s)', '(Supabase breekt af na 15 s)');

  execute def;
  raise notice 'ig_live is sneller gemaakt';
end $migratie$;

-- Rechten blijven (create or replace houdt ze), maar voor de zekerheid:
revoke execute on function public.ig_live(int) from public, anon;
grant  execute on function public.ig_live(int) to authenticated;

-- 4. Tijdslimiet voor ingelogd: 15 s (daarna laat Supabase het meteen weten)
alter role authenticated set statement_timeout = '15s';
notify pgrst, 'reload config';

-- Test: forceer verversen en kijk hoe lang het duurt. Verwacht: seconden < 8, "fouten" = [], geen "stories" in stappen.
update public.ig_ververst set om = now() - interval '1 hour' where id = 1;
select public.ig_live(5) as ig_live_test,
       (select rolconfig from pg_roles where rolname = 'authenticated') as instelling_ingelogd;
