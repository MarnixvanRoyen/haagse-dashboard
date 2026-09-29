-- 09c_insta_volgers_live.sql — ig_live haalt ook nieuwe volgers en ontvolgers op (vandaag + gisteren)
-- Waarom: tot nu toe kwamen follows/unfollows alleen 's nachts binnen (ig_refresh). Daardoor was het
-- groene staafje van vandaag in "Bereik per dag" altijd leeg, en bleef gisteren op de stand van vannacht
-- staan (Meta vult een dag tot 48 uur later nog aan).
-- Hoe: net als bij 11_import_historie wordt de huidige (live) versie van ig_live uit de database gehaald
-- en wordt er één stukje tussen gezet, vlak vóór stap c (nieuwste posts). Dubbel draaien doet niks extra.
-- Kost 2 extra vragen aan Meta per keer verversen (hooguit 1x per 10 min). Stopt netjes als de 4 seconden op zijn.

do $migratie$
declare
  def  text;
  plek text := E'\n  -- c. nieuwste 10 posts';
  blok text := $blok$

  -- b2. nieuwe volgers en ontvolgers van vandaag en gisteren (Meta vult gisteren tot 48 uur later nog aan)
  declare
    dd date;
    fu jsonb;
  begin
    foreach dd in array array[d, d - 1] loop
      exit when extract(epoch from clock_timestamp() - klok) >= max_sec;
      begin
        j := ig_get('me/insights?metric=follows_and_unfollows&breakdown=follow_type&period=day&metric_type=total_value'
                    || '&since=' || extract(epoch from (dd::timestamp at time zone 'America/Los_Angeles'))::bigint
                    || '&until=' || extract(epoch from ((dd + 1)::timestamp at time zone 'America/Los_Angeles'))::bigint);
        -- alleen opslaan als Meta de metriek echt teruggeeft; geen volgers die dag = 0 (niet "onbekend")
        if jsonb_array_length(coalesce(j->'data', '[]')) > 0 then
          select '{"follows":0,"unfollows":0}'::jsonb
                 || coalesce(jsonb_object_agg(case r->'dimension_values'->>0 when 'FOLLOWER' then 'follows' else 'unfollows' end,
                                              r->'value'), '{}')
            into fu
            from jsonb_array_elements(j->'data') e,
                 jsonb_array_elements(coalesce(e->'total_value'->'breakdowns'->0->'results', '[]')) r
           where r->'dimension_values'->>0 in ('FOLLOWER', 'NON_FOLLOWER');
          fu := coalesce(fu, '{"follows":0,"unfollows":0}'::jsonb);
          insert into ig_account_dag (ig_id, dag, cijfers, opgehaald_om) values (acc, dd, fu, now())
          on conflict (ig_id, dag) do update set cijfers = ig_account_dag.cijfers || excluded.cijfers, opgehaald_om = now();
          stappen := stappen || ('volgers ' || to_char(dd, 'DD-MM'));
        end if;
      exception when others then
        fouten := fouten || ('volgers ' || to_char(dd, 'DD-MM') || ': ' || left(sqlerrm, 100));
      end;
    end loop;
  end;
$blok$;
begin
  def := pg_get_functiondef('public.ig_live(integer)'::regprocedure);
  if def like '%-- b2. nieuwe volgers%' then
    raise notice 'ig_live heeft de volgers-stap al, niks gedaan';
    return;
  end if;
  if (length(def) - length(replace(def, plek, ''))) / length(plek) <> 1 then
    raise exception 'ig_live: plek voor de volgers-stap niet (precies 1x) gevonden';
  end if;
  execute replace(def, plek, blok || plek);
  raise notice 'ig_live bijgewerkt: haalt nu ook volgers van vandaag en gisteren op';
end $migratie$;

-- Rechten blijven zoals ze waren (create or replace houdt ze), maar voor de zekerheid:
revoke execute on function public.ig_live(int) from public, anon;
grant  execute on function public.ig_live(int) to authenticated;

-- Test: forceer verversen (ig_live doet hooguit 1x per 5-10 min iets; daarom eerst de "laatst ververst" tijd terugzetten).
-- Verwacht: 3 regels (vandaag, gisteren, eergisteren); bij vandaag en gisteren een getal bij nieuwe_volgers,
-- in "stappen" o.a. "volgers dd-mm" 2x, en "fouten" = [].
update public.ig_ververst set om = now() - interval '1 hour' where id = 1;
drop table if exists pg_temp.t09c;
create temp table t09c as select public.ig_live(5) as r;
select d.dag, d.cijfers->'follows' as nieuwe_volgers, d.cijfers->'unfollows' as ontvolgers, d.opgehaald_om,
       t.r->'stappen' as stappen, t.r->'fouten' as fouten
  from public.ig_account_dag d, t09c t
 order by d.dag desc limit 3;
