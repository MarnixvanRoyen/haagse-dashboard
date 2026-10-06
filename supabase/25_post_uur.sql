-- =====================================================================
-- 25_post_uur.sql — "Deze gaat lekkâh!": elk uur een meting per nieuwe post (06-10-2026)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Alles of niets: gaat er iets mis, dan wordt niets van dit bestand bewaard.
--
-- Waarom: om te zien of een nieuwe post sneller gaat dan normaal, moet je weten hoeveel bereik hij had
--   na 2, 5 of 10 uur. Meta bewaart dat niet (alleen de stand van nu), dus we bewaren het zelf.
-- Wat:
--   1. tabel ig_post_uur: per post (tot 48 uur na het posten) metingen met leeftijd in minuten
--   2. trigger op ig_media_dag: elke meting die er toch al is (ig_live bij openen dashboard, nacht-ronde)
--      gaat ook in ig_post_uur → geen extra vraag aan Meta en ig_live zelf hoeft nie aangepast
--   3. functie ig_post_uur_meten(): het uurlijkse klusje (pg_cron elk uur op :10)
--        - 1 vraag: je nieuwste 10 posts (een nieuwe post komt zo meteen binnen; bestaande posts worden
--          NIET bijgewerkt, zodat het klusje ig_live nooit in de weg zit)
--        - per post jonger dan 48 uur 1 vraag (ig_media_cijfers); hooguit 8 posts, hooguit 90 s
--        - verwijderde post (Meta: "does not exist" én nie in de lijst nieuwste 10) → gemarkeerd zoals in 22
--   Meestal 2-4 vragen aan Meta per uur. Het oordeel (gaat lekkâh / staat in de fik) rekent de app uit.
-- Niks gewist. Schrijft NIET in ig_media_dag (eigen tabel → geen slot-gedoe met ig_live).
-- =====================================================================

-- 1. Tabel
create table if not exists public.ig_post_uur (
  media_id  text        not null references public.ig_media(media_id) on delete cascade,
  om        timestamptz not null,                 -- moment van de meting
  minuut    integer     not null,                 -- leeftijd van de post op dat moment, in minuten
  bron      text        not null,                 -- 'uur' (klusje) of 'dag' (overgenomen uit ig_media_dag, bijv. via ig_live)
  cijfers   jsonb       not null default '{}',     -- zelfde namen als ig_media_dag: reach, likes, views, saved, shares, ...
  fout      text,                                 -- meting mislukt? dan hier de reden (cijfers leeg)
  primary key (media_id, om)
);
create index if not exists ig_post_uur_om on public.ig_post_uur (om);
alter table public.ig_post_uur enable row level security;
drop policy if exists "alleen marnix mag lezen" on public.ig_post_uur;
create policy "alleen marnix mag lezen" on public.ig_post_uur for select to authenticated using ((select public.is_marnix()));
revoke all on public.ig_post_uur from anon, authenticated;
grant select on public.ig_post_uur to authenticated;

-- 2. Trigger: een meting in ig_media_dag van een post < 48 uur oud → ook in ig_post_uur
--    Mag NOOIT een fout geven (anders zou ig_live of de nacht-ronde mislukken) → alles in een vangnet.
create or replace function public.ig_post_uur_van_dag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  gepost timestamptz;
begin
  begin
    if new.cijfers ? 'reach' and (tg_op = 'INSERT' or new.gemeten_om is distinct from old.gemeten_om) then
      select gepost_om into gepost from ig_media where media_id = new.media_id;
      if gepost is not null and new.gemeten_om > gepost and new.gemeten_om < gepost + interval '48 hours' then
        insert into ig_post_uur (media_id, om, minuut, bron, cijfers)
        values (new.media_id, new.gemeten_om, floor(extract(epoch from new.gemeten_om - gepost) / 60)::int, 'dag', new.cijfers)
        on conflict (media_id, om) do nothing;
      end if;
    end if;
  exception when others then
    null;   -- liever een meting minder dan een mislukte ververs-ronde
  end;
  return new;
end;
$$;
revoke execute on function public.ig_post_uur_van_dag() from public, anon, authenticated;
drop trigger if exists ig_post_uur_van_dag on public.ig_media_dag;
create trigger ig_post_uur_van_dag after insert or update on public.ig_media_dag
  for each row execute function public.ig_post_uur_van_dag();

-- 3. Het uurlijkse klusje
create or replace function public.ig_post_uur_meten()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
set timezone to 'Europe/Amsterdam'
as $$
declare
  klok    timestamptz := clock_timestamp();
  max_sec numeric := 90;               -- daarna niks nieuws meer beginnen
  acc     text;
  j       jsonb;
  x       jsonb;
  m       record;
  c       jsonb;
  lijst   text[];                      -- id's in de lijst nieuwste 10 (null = lijst ophalen mislukt)
  nu      timestamptz;
  n_ok    int := 0;
  n_nieuw int := 0;
  n_weg   int := 0;
  fouten  text[] := '{}';
begin
  perform set_config('http.timeout_msec', '10000', true);   -- hooguit 10 s wachten op Meta per vraag
  perform set_config('lock_timeout', '5s', true);           -- hooguit 5 s wachten op een slot
  select ig_id into acc from ig_account order by bijgewerkt_om desc limit 1;
  if acc is null then
    raise exception 'ig_post_uur_meten: geen Insta-account in ig_account';
  end if;

  -- a. nieuwste 10 posts: nieuwe posts toevoegen (bestaande nie aanraken)
  begin
    j := ig_get('me/media?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count&limit=10');
    lijst := '{}';
    for x in select * from jsonb_array_elements(coalesce(j->'data', '[]')) loop
      lijst := lijst || (x->>'id');
      insert into ig_media (media_id, ig_id, soort, product, gepost_om, bijschrift, permalink, plaatje, likes, reacties, gezien_om)
      values (x->>'id', acc, coalesce(x->>'media_type', ''), coalesce(x->>'media_product_type', ''),
              (x->>'timestamp')::timestamptz, coalesce(x->>'caption', ''), x->>'permalink',
              coalesce(x->>'thumbnail_url', x->>'media_url'),
              (x->>'like_count')::int, (x->>'comments_count')::int, now())
      on conflict (media_id) do nothing;
      if found then n_nieuw := n_nieuw + 1; end if;
    end loop;
  exception when others then
    lijst := null;
    fouten := fouten || ('lijst: ' || left(sqlerrm, 150));
  end;

  -- b. per post jonger dan 48 uur: 1 meting (nieuwste eerst; stories staan nie in ig_media)
  for m in select media_id, product, gepost_om from ig_media
            where ig_id = acc and gepost_om > now() - interval '48 hours' and verwijderd_op is null
            order by gepost_om desc limit 8 loop
    exit when extract(epoch from clock_timestamp() - klok) >= max_sec;
    nu := clock_timestamp();
    begin
      c := ig_media_cijfers(m.media_id, coalesce(nullif(m.product, ''), 'FEED'));
      insert into ig_post_uur (media_id, om, minuut, bron, cijfers)
      values (m.media_id, nu, floor(extract(epoch from nu - m.gepost_om) / 60)::int, 'uur', c)
      on conflict (media_id, om) do nothing;
      n_ok := n_ok + 1;
    exception when others then
      fouten := fouten || (m.media_id || ': ' || left(sqlerrm, 150));
      insert into ig_post_uur (media_id, om, minuut, bron, cijfers, fout)
      values (m.media_id, nu, floor(extract(epoch from nu - m.gepost_om) / 60)::int, 'uur', '{}', left(sqlerrm, 200))
      on conflict (media_id, om) do nothing;
      -- zelfde regel als 22: "does not exist" telt alleen als hij ook nie in de lijst nieuwste 10 van deze ronde staat
      if sqlerrm ilike '%does not exist%' and lijst is not null and cardinality(lijst) > 0 and not (m.media_id = any (lijst)) then
        update ig_media set verwijderd_op = now(), verwijderd_reden = 'bestaat_nie'
         where media_id = m.media_id and verwijderd_op is null;
        if found then n_weg := n_weg + 1; end if;
      end if;
    end;
  end loop;

  return jsonb_build_object('gemeten', n_ok, 'nieuwe_posts', n_nieuw, 'verwijderd', n_weg, 'fouten', fouten,
                            'seconden', round(extract(epoch from clock_timestamp() - klok)::numeric, 1));
end;
$$;
revoke execute on function public.ig_post_uur_meten() from public, anon, authenticated;

-- 4. Elk uur op :10 (UTC; bij ons ook :10). Bezet (check 06-10): :05/:15/:25/:35/:45/:55 (stories-eind), :17 (elke 3 uur),
--    :28, :40, :50, :55 en 's nachts 03:55-05:35. :10 is vrij.
select cron.unschedule(jobname) from cron.job where jobname = 'instagram-post-uur';
select cron.schedule('instagram-post-uur', '10 * * * *', 'select public.ig_post_uur_meten()');

-- 5. Meteen 1x meten; de uitkomst zie je onderin (gemeten, nieuwe_posts, verwijderd, fouten, seconden)
select public.ig_post_uur_meten() as eerste_meting;
