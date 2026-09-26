-- =====================================================================
-- 06_goatcounter.sql — Sneek-bezoekers uit GoatCounter in het dashboard (27-09-2026)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Vooraf: API-sleutel van GoatCounter in de Vault als 'goatcounter_api_key'.
-- =====================================================================

-- 1. Tabellen
--    gc_dag:     per dag per pagina/gebeurtenis het aantal (bezoekers op "/", of potje-gestart, score-gedeeld)
--    gc_bronnen: per dag waar bezoekers vandaan kwamen (Instagram, WhatsApp, direct, ...)
create table if not exists public.gc_dag (
  dag     date    not null,
  pad     text    not null,
  event   boolean not null default false,
  titel   text    not null default '',
  aantal  integer not null default 0,
  primary key (dag, pad)
);
create table if not exists public.gc_bronnen (
  dag     date    not null,
  bron    text    not null,
  aantal  integer not null default 0,
  primary key (dag, bron)
);

-- 2. Beveiliging: alleen ingelogd (= alleen jij) mag lezen; schrijven doet alleen de database zelf
do $$
declare t text;
begin
  foreach t in array array['gc_dag','gc_bronnen'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "dashboard mag lezen" on public.%I', t);
    execute format('create policy "dashboard mag lezen" on public.%I for select to authenticated using (true)', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- 3. Hulpfunctie: vraag iets op bij de GoatCounter-API (sleutel komt uit de Vault)
create or replace function public.gc_get(path text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  k text;
  r extensions.http_response;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'goatcounter_api_key' limit 1;
  if k is null then
    raise exception 'Geen goatcounter_api_key gevonden in de Vault';
  end if;
  r := extensions.http((
         'GET', 'https://marremanrojas.goatcounter.com/api/v0/' || path,
         array[extensions.http_header('Authorization', 'Bearer ' || k),
               extensions.http_header('Content-Type', 'application/json')],
         null, null
       )::extensions.http_request);
  if r.status <> 200 then
    raise exception 'GoatCounter fout % bij %: %', r.status, path, left(r.content, 300);
  end if;
  return r.content::jsonb;
end;
$$;

-- 4. Hoofdfunctie: haal de laatste X dagen op (standaard 3) en werk de tabellen bij
create or replace function public.gc_refresh(dagen integer default 3)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  vandaag date := (now() at time zone 'utc')::date;   -- GoatCounter rekent in UTC
  van    date := vandaag - (greatest(dagen, 1) - 1);
  d      date;
  j      jsonb;
  h      jsonb;
  s      jsonb;
  n_dag  int := 0;
  n_bron int := 0;
  iso    text := 'YYYY-MM-DD"T"00:00:00"Z"';
  -- 'nu' afgerond op het hele uur: GoatCounter wil geen eindtijd in de toekomst
  nu     text := to_char(date_trunc('hour', now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24":00:00Z"');
begin
  -- a. bezoekers en gebeurtenissen per dag
  j := gc_get('stats/hits?group=day&limit=200&start=' || to_char(van, iso)
              || '&end=' || nu);
  for h in select * from jsonb_array_elements(coalesce(j->'hits', '[]')) loop
    for s in select * from jsonb_array_elements(coalesce(h->'stats', '[]')) loop
      insert into gc_dag (dag, pad, event, titel, aantal)
      values ((s->>'day')::date, h->>'path', coalesce((h->>'event')::boolean, false),
              coalesce(h->>'title', ''), coalesce((s->>'daily')::int, 0))
      on conflict (dag, pad) do update
        set aantal = excluded.aantal, event = excluded.event, titel = excluded.titel;
      n_dag := n_dag + 1;
    end loop;
  end loop;

  -- b. bronnen per dag (1 vraag per dag; GoatCounter staat max 4 vragen per seconde toe)
  d := van;
  while d <= vandaag loop
    j := gc_get('stats/toprefs?limit=100&start=' || to_char(d, iso) || '&end=' || case when d = vandaag then nu else to_char(d + 1, iso) end);
    delete from gc_bronnen where dag = d;
    insert into gc_bronnen (dag, bron, aantal)
    select d, coalesce(nullif(x->>'name', ''), '(direct)'), sum((x->>'count')::int)
      from jsonb_array_elements(coalesce(j->'stats', '[]')) x
     group by 2;
    get diagnostics n_bron = row_count;
    perform pg_sleep(0.3);
    d := d + 1;
  end loop;

  return jsonb_build_object('van', van, 'dag_regels', n_dag, 'bronnen_laatste_dag', n_bron);
end;
$$;
revoke execute on function public.gc_get(text)          from public, anon, authenticated;
revoke execute on function public.gc_refresh(integer)   from public, anon;
grant  execute on function public.gc_refresh(integer)   to authenticated;

-- 5. Elke nacht om 04:35 UTC automatisch de laatste 3 dagen bijwerken (na YouTube en SoundCloud)
select cron.unschedule('goatcounter-dagelijks') where exists (select 1 from cron.job where jobname = 'goatcounter-dagelijks');
select cron.schedule('goatcounter-dagelijks', '35 4 * * *', 'select public.gc_refresh(3)');

-- 6. Test nu meteen, en haal meteen alles sinds de start (25 sept) op
select public.gc_refresh(14);
