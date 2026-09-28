-- =====================================================================
-- 08_goatcounter_live.sql — Sneek-bezoekers van VANDAAG (Haagse tijd) op het Ovâhzicht (28-09-2026)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Vereist: 06_goatcounter.sql is al gedraaid.
-- =====================================================================

-- 1. Nieuwe tabel: aantallen per UUR (GoatCounter rekent in UTC-dagen; met uren kunnen we een Haagse dag tellen)
create table if not exists public.gc_uur (
  uur     timestamptz not null,           -- begin van het uur
  pad     text        not null,           -- "/" = bezoek, of gebeurtenis zoals potje-gestart
  event   boolean     not null default false,
  aantal  integer     not null default 0,
  primary key (uur, pad)
);
-- wanneer is GoatCounter voor het laatst opgehaald?
create table if not exists public.gc_ververst (
  id  int primary key default 1 check (id = 1),
  om  timestamptz not null
);
do $$
declare t text;
begin
  foreach t in array array['gc_uur','gc_ververst'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "dashboard mag lezen" on public.%I', t);
    execute format('create policy "dashboard mag lezen" on public.%I for select to authenticated using (true)', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- 2. gc_refresh: zelfde als in 06, maar slaat nu ook de uren op en onthoudt het tijdstip
create or replace function public.gc_refresh(dagen integer default 3)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  vandaag date := (now() at time zone 'utc')::date;   -- GoatCounter rekent in UTC
  van     date := vandaag - (greatest(dagen, 1) - 1);
  d       date;
  j       jsonb;
  h       jsonb;
  s       jsonb;
  i       int;
  bereik  text;
  n_dag   int := 0;
  n_bron  int := 0;
  fouten  text[] := '{}';
  iso     text := 'YYYY-MM-DD"T"00:00:00"Z"';
begin
  d := van;
  while d <= vandaag loop
    bereik := 'start=' || to_char(d, iso) || '&end=' || to_char(d + 1, iso);
    begin
      -- a. bezoekers en gebeurtenissen van deze dag (per dag én per uur)
      j := gc_get('stats/hits?limit=100&' || bereik);
      delete from gc_uur where uur >= (d::timestamp at time zone 'UTC') and uur < ((d + 1)::timestamp at time zone 'UTC');
      for h in select * from jsonb_array_elements(coalesce(j->'hits', '[]')) loop
        for s in select * from jsonb_array_elements(coalesce(h->'stats', '[]')) loop
          continue when (s->>'day')::date <> d;
          insert into gc_dag (dag, pad, event, titel, aantal)
          values (d, h->>'path', coalesce((h->>'event')::boolean, false),
                  coalesce(h->>'title', ''), coalesce((s->>'daily')::int, 0))
          on conflict (dag, pad) do update
            set aantal = excluded.aantal, event = excluded.event, titel = excluded.titel;
          for i in 0 .. coalesce(jsonb_array_length(s->'hourly'), 0) - 1 loop
            continue when coalesce((s->'hourly'->>i)::int, 0) = 0;
            insert into gc_uur (uur, pad, event, aantal)
            values ((d::timestamp at time zone 'UTC') + make_interval(hours => i), h->>'path',
                    coalesce((h->>'event')::boolean, false), (s->'hourly'->>i)::int)
            on conflict (uur, pad) do update set aantal = excluded.aantal, event = excluded.event;
          end loop;
          n_dag := n_dag + 1;
        end loop;
      end loop;
      perform pg_sleep(0.3);   -- GoatCounter staat max 4 vragen per seconde toe

      -- b. bronnen van deze dag (Instagram, WhatsApp, direct, ...)
      j := gc_get('stats/toprefs?limit=100&' || bereik);
      delete from gc_bronnen where dag = d;
      insert into gc_bronnen (dag, bron, aantal)
      select d, coalesce(nullif(x->>'name', ''), '(direct)'), sum((x->>'count')::int)
        from jsonb_array_elements(coalesce(j->'stats', '[]')) x
       group by 2;
      get diagnostics n_bron = row_count;
      perform pg_sleep(0.3);
    exception when others then
      fouten := fouten || (to_char(d, 'YYYY-MM-DD') || ': ' || left(sqlerrm, 60));
    end;
    d := d + 1;
  end loop;

  insert into gc_ververst (id, om) values (1, now()) on conflict (id) do update set om = now();
  return jsonb_build_object('van', van, 'dag_regels', n_dag, 'bronnen_laatste_dag', n_bron, 'fouten', fouten);
end;
$$;
revoke execute on function public.gc_refresh(integer) from public, anon;
grant  execute on function public.gc_refresh(integer) to authenticated;

-- 3. Vanuit de app bij openen: ververs (vandaag + gisteren in UTC), maar hooguit 1x per 10 minuten
create or replace function public.gc_live(min_minuten int default 10)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  laatst   timestamptz;
  ververst boolean := false;
  fout     text;
  r        jsonb;
begin
  if auth.uid() is null then raise exception 'Niet ingelogd'; end if;
  select om into laatst from gc_ververst where id = 1;
  if laatst is null or laatst < now() - make_interval(mins => greatest(coalesce(min_minuten, 10), 5)) then
    begin
      r := gc_refresh(2);
      ververst := true;
      laatst := now();
      if jsonb_array_length(r->'fouten') > 0 then fout := r->'fouten'->>0; end if;
    exception when others then
      fout := sqlerrm;
    end;
  end if;
  return jsonb_build_object('ververst', ververst, 'om', laatst, 'fout', fout);
end;
$$;
revoke execute on function public.gc_live(int) from public, anon;
grant  execute on function public.gc_live(int) to authenticated;

-- 4. Meteen de uren van de afgelopen 3 dagen ophalen (test). Verwacht: "fouten": []
select public.gc_refresh(3);
select count(*) as uren_opgeslagen from public.gc_uur;
