-- =====================================================================
-- Haagse Content Dashboard — "live" muziekcijfers op het Ovâhzicht
-- YouTube en SoundCloud worden ververst zodra je het dashboard opent
-- (hooguit 1x per 10 minuten), zodat je ziet wat er VANDAAG bij is gekomen.
-- Plak dit hele bestand in Supabase > SQL Editor en klik op "Run".
-- Veilig opnieuw te draaien.
-- =====================================================================

-- 1. Bij elke meting het tijdstip onthouden (kolom + trigger)
alter table public.yt_snapshots add column if not exists gemeten_om timestamptz;
alter table public.sc_snapshots add column if not exists gemeten_om timestamptz;

create or replace function public.zet_gemeten_om()
returns trigger language plpgsql as $$
begin
  new.gemeten_om := now();
  return new;
end;
$$;

drop trigger if exists gemeten_om on public.yt_snapshots;
create trigger gemeten_om before insert or update on public.yt_snapshots
  for each row execute function public.zet_gemeten_om();
drop trigger if exists gemeten_om on public.sc_snapshots;
create trigger gemeten_om before insert or update on public.sc_snapshots
  for each row execute function public.zet_gemeten_om();

-- 2. "Vandaag" = een Haagse dag (niet de UTC-dag, die begint pas om 01:00/02:00)
alter function public.yt_refresh() set timezone to 'Europe/Amsterdam';
alter function public.sc_refresh() set timezone to 'Europe/Amsterdam';

-- 3. Vanuit de app: ververs één bron (yt of sc), maar niet vaker dan 1x per 10 min
create or replace function public.muziek_live(bron text, min_minuten int default 10)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
set timezone to 'Europe/Amsterdam'
as $$
declare
  uid       uuid := auth.uid();
  vandaag   date := current_date;
  laatst    timestamptz;
  ververst  boolean := false;
  fout      text;
  vorige_dag date;
  vorige_om  timestamptz;
begin
  if uid is null then raise exception 'Niet ingelogd'; end if;
  if bron not in ('yt', 'sc') then raise exception 'Onbekende bron: %', bron; end if;

  -- wanneer is vandaag voor het laatst gemeten?
  if bron = 'yt' then
    select max(gemeten_om) into laatst from yt_snapshots where user_id = uid and snap_date = vandaag;
  else
    select max(gemeten_om) into laatst from sc_snapshots where user_id = uid and snap_date = vandaag;
  end if;

  -- te lang geleden (of nog niet vandaag)? dan nu ophalen
  if laatst is null or laatst < now() - make_interval(mins => greatest(coalesce(min_minuten, 10), 5)) then
    begin
      if bron = 'yt' then perform yt_refresh(); else perform sc_refresh(); end if;
      ververst := true;
      laatst := now();
    exception when others then
      fout := sqlerrm;
    end;
  end if;

  -- de laatste meting van de vorige dag = het beginpunt van "vandaag erbè"
  if bron = 'yt' then
    select snap_date, max(gemeten_om) into vorige_dag, vorige_om
      from yt_snapshots where user_id = uid and snap_date < vandaag
     group by snap_date order by snap_date desc limit 1;
  else
    select snap_date, max(gemeten_om) into vorige_dag, vorige_om
      from sc_snapshots where user_id = uid and snap_date < vandaag
     group by snap_date order by snap_date desc limit 1;
  end if;

  return jsonb_build_object('bron', bron, 'ververst', ververst, 'om', laatst, 'fout', fout,
                            'vandaag', vandaag, 'vorige_dag', vorige_dag, 'vorige_om', vorige_om);
end;
$$;

revoke execute on function public.muziek_live(text, int) from public, anon;
grant  execute on function public.muziek_live(text, int) to authenticated;

-- 4. Dagafsluiting: vlak voor middernacht (Haagse tijd) nog één meting,
--    zodat "vandaag erbè" morgen netjes vanaf ~00:00 telt.
create or replace function public.muziek_dagafsluiting()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
set timezone to 'Europe/Amsterdam'
as $$
declare fy text; fs text;
begin
  begin perform yt_refresh(); exception when others then fy := sqlerrm; end;
  begin perform sc_refresh(); exception when others then fs := sqlerrm; end;
  return jsonb_build_object('youtube_fout', fy, 'soundcloud_fout', fs);
end;
$$;
revoke execute on function public.muziek_dagafsluiting() from public, anon, authenticated;

-- pg_cron rekent in UTC: 21:58 UTC = 23:58 in de zomer, 22:58 UTC = 23:58 in de winter.
-- (De andere run valt dan op 00:58 of 22:58 en kan geen kwaad.)
select cron.schedule('muziek-dagafsluiting-1', '58 21 * * *', 'select public.muziek_dagafsluiting()');
select cron.schedule('muziek-dagafsluiting-2', '58 22 * * *', 'select public.muziek_dagafsluiting()');

-- 5. Test: haalt YouTube nu op en laat zien wat er terugkomt (werkt alleen ingelogd,
--    dus in de SQL Editor krijg je "Niet ingelogd" — dat is goed). Controleer de cron-taken:
select jobname, schedule, command from cron.job order by jobname;
