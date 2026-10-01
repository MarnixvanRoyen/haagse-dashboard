-- 18_bereik_uur.sql — Bereik van vandaag elk uur vastleggen, zodat "vandaag" eerlijk te vergelijken is
--                     met "gistâh op hetzelfde tijdstip" (01-10-2026)
-- Waarom: Meta geeft alleen het bereik van de hele Meta-dag (of: van de Meta-dag tot nu). Een stand van
--   gistâh om 14:20 bestaat bij Meta niet meer. Die moeten we dus zelf bewaren: elk uur een momentopname.
-- Wat:
--   1. tabel ig_bereik_uur: per Meta-dag de stand "bereik tot nu" met tijdstip (+ minuten sinds start Meta-dag)
--   2. hulpfunctie ig_bereik_bewaar(...): schrijft één momentopname (gebruikt door 3 en 4)
--   3. functie ig_bereik_uur_meten(): 1 vraag aan Meta (± 0,5-1 s), bewaart de stand. pg_cron elk uur op :28
--   4. ig_live (dashboard openen / Ververse) bewaart óók een momentopname, zonder extra vraag aan Meta
--      (hij haalt het bereik van vandaag toch al op). Ingevoegd via pg_get_functiondef; dubbel draaien doet niks.
-- Veilig opnieuw te draaien. Gaat er iets mis, dan wordt niets van dit bestand bewaard.
-- (Nummer 18 omdat 17_post_bijschrift_heel.sql al bestaat.)

-- 1. Tabel
create table if not exists public.ig_bereik_uur (
  ig_id    text        not null references public.ig_account(ig_id) on delete cascade,
  dag      date        not null,                 -- Meta-dag (Los Angeles-tijd; bij ons van 09:00 tot 09:00)
  minuut   integer     not null,                 -- minuten sinds het begin van die Meta-dag
  om       timestamptz not null,                 -- moment van de meting
  bereik   integer     not null,                 -- bereik van de Meta-dag tot dit moment
  cijfers  jsonb       not null default '{}',     -- de rest van de stand tot nu (weergaven, interacties, ...)
  bron     text        not null,                 -- 'uur' (klusje) of 'live' (dashboard openen / Ververse)
  primary key (ig_id, dag, minuut)
);
alter table public.ig_bereik_uur enable row level security;
drop policy if exists "alleen marnix mag lezen" on public.ig_bereik_uur;
create policy "alleen marnix mag lezen" on public.ig_bereik_uur for select to authenticated using ((select public.is_marnix()));
revoke all on public.ig_bereik_uur from anon, authenticated;
grant select on public.ig_bereik_uur to authenticated;

-- 2. Hulpfunctie: één momentopname bewaren (alleen tijdens de Meta-dag zelf, alleen met een echt getal)
create or replace function public.ig_bereik_bewaar(p_acc text, p_dag date, p_cijfers jsonb, p_bron text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  p_nu    timestamptz := clock_timestamp();
  p_start timestamptz := p_dag::timestamp at time zone 'America/Los_Angeles';
  p_eind  timestamptz := (p_dag + 1)::timestamp at time zone 'America/Los_Angeles';
begin
  if p_acc is null or jsonb_typeof(p_cijfers->'reach') is distinct from 'number' then
    return;                                         -- geen bereik in het antwoord: niks te bewaren
  end if;
  if p_nu < p_start or p_nu >= p_eind then
    return;                                         -- die Meta-dag is (nog) niet bezig
  end if;
  insert into ig_bereik_uur (ig_id, dag, minuut, om, bereik, cijfers, bron)
  values (p_acc, p_dag, floor(extract(epoch from p_nu - p_start) / 60)::int, p_nu,
          (p_cijfers->>'reach')::numeric::int, p_cijfers - 'reach', p_bron)
  on conflict (ig_id, dag, minuut) do update
     set om = excluded.om, bereik = excluded.bereik, cijfers = excluded.cijfers, bron = excluded.bron;
end;
$$;
revoke execute on function public.ig_bereik_bewaar(text, date, jsonb, text) from public, anon, authenticated;

-- 3. Het uurlijkse klusje: 1 vraag aan Meta (bereik + 7 andere cijfers van vandaag tot nu)
--    Werkt ook de regel van vandaag in ig_account_dag bij (dan is "Bereik vandaag" in de app hooguit een uur oud).
--    Hooguit 10 s wachten op Meta, hooguit 5 s op een slot. Mislukt het, dan staat de fout in cron.job_run_details.
create or replace function public.ig_bereik_uur_meten()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
set timezone to 'Europe/Amsterdam'
as $$
declare
  klok  timestamptz := clock_timestamp();
  acc   text;
  j     jsonb;
  c     jsonb;
  d     date := (now() at time zone 'America/Los_Angeles')::date;
  reeks text;
begin
  perform set_config('http.timeout_msec', '10000', true);
  perform set_config('lock_timeout', '5s', true);
  select ig_id into acc from ig_account order by bijgewerkt_om desc limit 1;
  if acc is null then
    raise exception 'ig_bereik_uur_meten: geen Insta-account in ig_account';
  end if;
  reeks := '&period=day&metric_type=total_value'
        || '&since=' || extract(epoch from (d::timestamp at time zone 'America/Los_Angeles'))::bigint
        || '&until=' || extract(epoch from ((d + 1)::timestamp at time zone 'America/Los_Angeles'))::bigint;
  begin
    j := ig_get('me/insights?metric=reach,views,accounts_engaged,total_interactions,likes,comments,shares,saves' || reeks);
  exception when others then
    j := ig_get('me/insights?metric=reach' || reeks);   -- bundel lukt niet: dan alleen het bereik
  end;
  select coalesce(jsonb_object_agg(e->>'name', e->'total_value'->'value'), '{}') into c
    from jsonb_array_elements(coalesce(j->'data', '[]')) e where e->'total_value'->'value' is not null;
  if c->'reach' is null then
    return jsonb_build_object('bewaard', false, 'dag', d, 'reden', 'Meta gaf (nog) geen bereik voor vandaag',
                              'seconden', round(extract(epoch from clock_timestamp() - klok)::numeric, 1));
  end if;
  insert into ig_account_dag (ig_id, dag, cijfers, opgehaald_om) values (acc, d, c, now())
  on conflict (ig_id, dag) do update set cijfers = ig_account_dag.cijfers || excluded.cijfers, opgehaald_om = now();
  perform ig_bereik_bewaar(acc, d, c, 'uur');
  return jsonb_build_object('bewaard', true, 'dag', d, 'bereik', c->'reach',
                            'seconden', round(extract(epoch from clock_timestamp() - klok)::numeric, 1));
end;
$$;
revoke execute on function public.ig_bereik_uur_meten() from public, anon, authenticated;

-- 4. ig_live (dashboard openen / Ververse) bewaart ook een momentopname, direct na het ophalen van "vandaag"
do $migratie$
declare
  def  text;
  plek text := E'      stappen := stappen || ''vandaag''::text;\n';
  blok text := E'      -- 18: momentopname bereik vandaag-tot-nu (om eerlijk te vergelijken met gistâh op hetzelfde tijdstip)\n'
            || E'      begin\n'
            || E'        perform ig_bereik_bewaar(acc, d, c, ''live'');\n'
            || E'      exception when others then\n'
            || E'        fouten := fouten || (''momentopname: '' || left(sqlerrm, 100));\n'
            || E'      end;\n';
begin
  def := pg_get_functiondef('public.ig_live(integer)'::regprocedure);
  if def like '%-- 18: momentopname%' then
    raise notice 'ig_live bewaart al een momentopname, niks gedaan';
    return;
  end if;
  if (length(def) - length(replace(def, plek, ''))) / length(plek) <> 1 then
    raise exception 'ig_live: plek voor de momentopname niet (precies 1x) gevonden';
  end if;
  execute replace(def, plek, blok || plek);
  raise notice 'ig_live bewaart nu ook een momentopname van het bereik';
end $migratie$;
revoke execute on function public.ig_live(int) from public, anon;
grant  execute on function public.ig_live(int) to authenticated;

-- 5. Elk uur op :28 (UTC; dus ook bij ons op :28). Bezet: :05/:15/:25/:35/:45/:55 (stories-eind), :17, :40, :50, :55
select cron.unschedule(jobname) from cron.job where jobname = 'instagram-bereik-uur';
select cron.schedule('instagram-bereik-uur', '28 * * * *', 'select public.ig_bereik_uur_meten()');

-- 6. Test nu meteen: één meting door het klusje en één via ig_live (forceren), plus een losse proef bij Meta.
--    Elk in een eigen blokje: gaat een test mis, dan blijft de rest (tabel, functies, klusje) gewoon staan.
drop table if exists pg_temp.t18;
create temp table t18 (klusje jsonb, live jsonb, gistah_tot_zelfde_tijd text);
insert into t18 default values;
do $test$
begin
  update t18 set klusje = public.ig_bereik_uur_meten();
exception when others then
  update t18 set klusje = jsonb_build_object('fout', left(sqlerrm, 200));
end $test$;
update public.ig_ververst set om = now() - interval '1 hour' where id = 1;
update t18 set live = public.ig_live(5);
do $test$
begin   -- proef: geeft Meta ook "gistâh vanaf het begin van de Meta-dag tot precies 24 uur geleden"?
  update t18 set gistah_tot_zelfde_tijd = public.ig_get('me/insights?metric=reach&period=day&metric_type=total_value'
    || '&since=' || extract(epoch from (((now() at time zone 'America/Los_Angeles')::date - 1)::timestamp at time zone 'America/Los_Angeles'))::bigint
    || '&until=' || extract(epoch from now() - interval '1 day')::bigint)->'data'->0->'total_value'->>'value';
exception when others then
  update t18 set gistah_tot_zelfde_tijd = 'fout: ' || left(sqlerrm, 150);
end $test$;
-- Uitkomst. Verwacht: 1 of 2 metingen (bron 'uur' en/of 'live'; vallen ze in dezelfde minuut, dan overschrijft de tweede de eerste); live_seconden rond 2-3; live_fouten [].
-- Laatste 2 kolommen: is gistah_tot_zelfde_tijd gelijk aan gistah_hele_dag (of een fout), dan rekent Meta alleen
-- in hele dagen (verwacht) en zijn onze eigen momentopnamen de enige manier.
select (select jsonb_agg(jsonb_build_object('om', to_char(om at time zone 'Europe/Amsterdam', 'DD-MM HH24:MI:SS'),
                                            'minuut', minuut, 'bereik', bereik, 'bron', bron) order by om)
          from public.ig_bereik_uur where dag = (now() at time zone 'America/Los_Angeles')::date) as metingen_vandaag,
       t.klusje, t.live->'seconden' as live_seconden, t.live->'fouten' as live_fouten,
       (select jobname || ' ' || schedule from cron.job where jobname = 'instagram-bereik-uur') as klusje_rooster,
       (select cijfers->>'reach' from public.ig_account_dag
         where dag = (now() at time zone 'America/Los_Angeles')::date - 1) as gistah_hele_dag,
       t.gistah_tot_zelfde_tijd
  from t18 t;
