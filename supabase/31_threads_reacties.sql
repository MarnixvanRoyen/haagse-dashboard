-- =====================================================================
-- 31_threads_reacties.sql — je reacties op Threads in het dashboard (12-10-2026, chat 34)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Alles of niets: gaat er iets mis, dan wordt niets van dit bestand bewaard.
--
-- Waarom: Meta geeft je reacties (posts onder een andere post) alleen via een apart lijstje (me/replies).
--   19_threads.sql haalt alleen me/threads op, dus reacties ontbraken helemaal. Check 12-10: ± 20 reacties
--   in 2 weken, veel met foto. Reacties komen in een EIGEN tabel, zodat de bestaande Threads-tegels,
--   toppâhs en de verwijderd-regel van 24 (die alleen naar gewone posts kijken) nie veranderen.
-- Onder wiens post? Meta vult root_post (= de bovenste post van het gesprek) alleen als die post van jou is
--   (check 12-10: 1 van de 20 gevuld, en dat was een antwoord onder je eigen post). Dus:
--   root_post staat in th_media = "onder eigen post", leeg of onbekend = "onder andermans post" (rekent de app).
-- Cijfers per reactie: zelfde vraag als bij posts (th_media_cijfers: weergaven, likes, reacties, reposts, quotes).
--   Alleen de laatste stand (geen geschiedenis per dag nodig voor de vergelijking).
-- Meta-vragen per nacht: 1-2 voor de lijst + 1 per reactie van de laatste 30 dagen + 40 oudere (± 80).
-- =====================================================================
begin;

-- 1. tabel
create table if not exists public.th_reactie (
  media_id         text primary key,
  th_id            text not null references public.th_account(th_id) on delete cascade,
  soort            text not null default '',          -- TEXT_POST / IMAGE / VIDEO / CAROUSEL_ALBUM / AUDIO
  gepost_om        timestamptz,
  tekst            text not null default '',
  permalink        text,
  plaatje          text,                               -- tijdelijke link van Meta
  root_post        text,                               -- bovenste post van het gesprek (alleen als die van jou is)
  replied_to       text,                               -- de post/reactie waar je direct onder reageerde (idem)
  cijfers          jsonb not null default '{}',        -- {"views":..,"likes":..,"replies":..,"reposts":..,"quotes":..,"shares":..}
  gezien_om        timestamptz not null default now(), -- laatst in de lijst van Meta gezien
  insights_om      timestamptz,
  insights_fout    text,
  verwijderd_op    timestamptz,                        -- nie meer in de lijst van Meta = telt nergens mee (niks gewist)
  verwijderd_reden text
);
create index if not exists th_reactie_gepost_om on public.th_reactie (gepost_om desc);

-- 2. beveiliging: alleen Marnix mag lezen; schrijven doet alleen de database zelf
alter table public.th_reactie enable row level security;
drop policy if exists "alleen marnix mag lezen" on public.th_reactie;
create policy "alleen marnix mag lezen" on public.th_reactie for select to authenticated using ((select public.is_marnix()));
revoke all on public.th_reactie from anon, authenticated;
grant select on public.th_reactie to authenticated;

-- 3. ophalen (elke nacht via pg_cron)
--    nieuw_dagen = cijfers van alle reacties van zoveel dagen; extra = zoveel oudere (die het langst wachten);
--    max_sec = daarna geen nieuwe cijfer-vragen meer (de lijst wordt altijd helemaal opgehaald)
create or replace function public.th_reacties_refresh(nieuw_dagen integer default 30, extra integer default 40, max_sec integer default 240)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  start     timestamptz := now();
  klok      timestamptz := clock_timestamp();
  acc       text;
  j         jsonb;
  x         jsonb;
  m         record;
  c         jsonb;
  basis     text := 'me/replies?fields=id,media_type,permalink,text,timestamp,thumbnail_url,media_url,root_post,replied_to&limit=100';
  volgende  text;
  paginas   int := 0;
  n_lijst   int := 0;
  n_cijfers int := 0;
  n_weg     int := 0;
  n_in      int;
  n_uit     int;
  compleet  boolean := false;
  fouten    text[] := '{}';
begin
  perform alleen_marnix();
  select th_id into acc from th_account order by bijgewerkt_om desc nulls last limit 1;
  if acc is null then
    raise exception 'Nog geen Threads-account in th_account: draai eerst 19_threads.sql';
  end if;

  -- a. de hele lijst van je reacties (per 100, hooguit 50 pagina's)
  volgende := basis;
  while volgende is not null and paginas < 50 loop
    begin
      j := th_get(volgende);
    exception when others then
      fouten := fouten || ('lijst: ' || left(sqlerrm, 150));
      exit;
    end;
    paginas := paginas + 1;
    for x in select * from jsonb_array_elements(coalesce(j->'data', '[]')) loop
      continue when x->>'id' is null;
      insert into th_reactie (media_id, th_id, soort, gepost_om, tekst, permalink, plaatje, root_post, replied_to, gezien_om)
      values (x->>'id', acc, coalesce(x->>'media_type', ''), (x->>'timestamp')::timestamptz, coalesce(x->>'text', ''),
              x->>'permalink', coalesce(x->>'thumbnail_url', x->>'media_url'),
              coalesce(x->'root_post'->>'id', x->>'root_post'), coalesce(x->'replied_to'->>'id', x->>'replied_to'), now())
      on conflict (media_id) do update
         set soort = excluded.soort, gepost_om = excluded.gepost_om, tekst = excluded.tekst, permalink = excluded.permalink,
             plaatje = excluded.plaatje,
             root_post = coalesce(excluded.root_post, th_reactie.root_post),
             replied_to = coalesce(excluded.replied_to, th_reactie.replied_to),
             gezien_om = now(), verwijderd_op = null, verwijderd_reden = null;   -- staat (weer) in de lijst = telt mee
      n_lijst := n_lijst + 1;
    end loop;
    volgende := coalesce(j->'paging'->>'next',
                         case when jsonb_array_length(coalesce(j->'data', '[]')) >= 100 and j->'paging'->'cursors'->>'after' is not null
                              then basis || '&after=' || (j->'paging'->'cursors'->>'after') end);
  end loop;
  compleet := volgende is null and paginas > 0;
  if paginas = 0 then                                   -- lijst lukte helemaal nie (bijv. sleutel stuk): nie verder vragen
    return jsonb_build_object('reacties_in_lijst', 0, 'paginas', 0, 'lijst_compleet', false, 'nie_meer_in_lijst', 0,
                              'met_cijfers', 0, 'seconden', round(extract(epoch from clock_timestamp() - klok)::numeric, 1),
                              'fouten', fouten);
  end if;

  -- b. wie nie meer in de volledige lijst staat, telt nie meer mee (zelfde grenzen als 24: lijst compleet,
  --    >= 90% van de bekende reacties erin, hooguit 10 tegelijk)
  if compleet then
    select count(*) filter (where gezien_om >= start), count(*) filter (where gezien_om < start)
      into n_in, n_uit
      from th_reactie where th_id = acc and verwijderd_op is null;
    if n_uit > 0 then
      if n_in >= 0.9 * (n_in + n_uit) and n_uit <= 10 then
        update th_reactie set verwijderd_op = now(), verwijderd_reden = 'nie_in_lijst'
         where th_id = acc and verwijderd_op is null and gezien_om < start;
        n_weg := n_uit;
      else
        fouten := fouten || ('lijst van Meta leek onvolledig (' || n_in || ' van ' || (n_in + n_uit) || ' reacties): niks als verwijderd gemarkeerd');
      end if;
    end if;
  end if;

  -- c. cijfers per reactie: alles van de laatste nieuw_dagen + de oudere die het langst wachten
  for m in
    select media_id from th_reactie
     where th_id = acc and verwijderd_op is null
       and (gepost_om > now() - make_interval(days => greatest(nieuw_dagen, 0))
            or media_id in (select media_id from th_reactie
                             where th_id = acc and verwijderd_op is null
                               and gepost_om <= now() - make_interval(days => greatest(nieuw_dagen, 0))
                             order by insights_om asc nulls first, gepost_om desc
                             limit greatest(extra, 0)))
     order by gepost_om desc
  loop
    if clock_timestamp() - klok > make_interval(secs => max_sec) then
      fouten := fouten || ('gestopt na ' || max_sec || ' s: de rest volgt vannacht'::text);
      exit;
    end if;
    begin
      c := th_media_cijfers(m.media_id);
      update th_reactie set cijfers = cijfers || c, insights_om = now(), insights_fout = null where media_id = m.media_id;
      n_cijfers := n_cijfers + 1;
    exception when others then
      update th_reactie set insights_om = now(), insights_fout = left(sqlerrm, 200) where media_id = m.media_id;
      if cardinality(fouten) < 20 then fouten := fouten || ('reactie ' || m.media_id || ': ' || left(sqlerrm, 80)); end if;
    end;
  end loop;

  return jsonb_build_object('reacties_in_lijst', n_lijst, 'paginas', paginas, 'lijst_compleet', compleet,
                            'nie_meer_in_lijst', n_weg, 'met_cijfers', n_cijfers,
                            'seconden', round(extract(epoch from clock_timestamp() - klok)::numeric, 1),
                            'fouten', fouten);
end;
$$;
revoke execute on function public.th_reacties_refresh(integer, integer, integer) from public, anon, authenticated;

-- 4. automatisch: elke nacht 05:25 UTC (na threads-dagelijks 05:15, zodat th_media vers is)
select cron.unschedule(jobname) from cron.job where jobname = 'threads-reacties';
select cron.schedule('threads-reacties', '25 5 * * *', 'select public.th_reacties_refresh(30, 40, 240)');

commit;

-- 5. meteen 1x: alle reacties + cijfers van de laatste 100 dagen (de kaart kijkt 90 dagen terug)
select public.th_reacties_refresh(100, 0, 600) as reacties;
