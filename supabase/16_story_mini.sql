-- 16_story_mini.sql (01-10-2026) — stories: (1) klein plaatje bewaren, (2) eindmeting vlak voordat een story verdwijnt.
-- (1) Meta's plaatje-link van een story verloopt na ± 5 dagen. Daarom maakt de Edge Function "story-mini"
--     elk uur (op :55) van nieuwe stories een klein plaatje (135 x 240 JPEG, ± 5-8 KB) en bewaart dat in ig_story_mini.
--     ± 3 stories per dag = ± 8 MB per jaar (database: 17 van 500 MB).
--     Herdeelde stories en stories uit de export hebben geen plaatje (Meta geeft dat nie) → daar blijft het leeg.
-- (2) De gewone ronde (elk uur op :50) meet een story soms een uur vóór hij verdwijnt. Nieuw klusje: elke 10 minuten
--     kijken of er een story in z'n laatste half uur zit; zo ja, alle stories nog een keer meten.
-- Dubbel draaien kan geen kwaad.

-- 1. Tabel voor de kleine plaatjes (los van ig_story, zodat de gewone story-lijst licht blijft)
create table if not exists public.ig_story_mini (
  media_id    text primary key references public.ig_story(media_id) on delete cascade,
  mini        text,                         -- 'data:image/jpeg;base64,...' (null = nog nie gelukt)
  bytes       integer,
  fout        text,                         -- laatste foutmelding, bijv. "plaatje ophalen lukte nie (403)"
  pogingen    integer not null default 0,   -- na 3 mislukte pogingen geven we het op
  gemaakt_om  timestamptz not null default now()
);
alter table public.ig_story_mini enable row level security;
drop policy if exists "alleen marnix mag lezen" on public.ig_story_mini;
create policy "alleen marnix mag lezen" on public.ig_story_mini for select to authenticated using ((select public.is_marnix()));
revoke all on public.ig_story_mini from anon, authenticated;
grant select on public.ig_story_mini to authenticated;
grant select, insert, update on public.ig_story_mini to service_role;   -- de Edge Function schrijft met de service-sleutel

-- 2. Werklijst voor de Edge Function: stories mét plaatje-link, nog zonder klein plaatje, jonger dan 6 dagen
create or replace function public.ig_mini_todo(aantal integer default 3)
returns table (media_id text, plaatje text, pogingen integer)
language sql
security definer
set search_path = public
as $$
  select s.media_id, s.plaatje, coalesce(m.pogingen, 0)
    from public.ig_story s
    left join public.ig_story_mini m on m.media_id = s.media_id
   where s.plaatje is not null
     and m.mini is null
     and coalesce(m.pogingen, 0) < 3
     and s.gepost_om > now() - interval '6 days'
   order by s.gepost_om desc
   limit greatest(1, least(aantal, 10));
$$;
revoke execute on function public.ig_mini_todo(integer) from public, anon, authenticated;
grant execute on function public.ig_mini_todo(integer) to service_role;

-- 3. Sleutel voor de Edge Function (willekeurig, eenmalig gemaakt). Dezelfde waarde zet je straks
--    bij de Edge Function als secret STORY_MINI_SLEUTEL. Zo kan alleen onze database hem aanroepen.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'story_mini_sleutel') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
                                'story_mini_sleutel',
                                'Sleutel voor Edge Function story-mini (zelfde waarde als secret STORY_MINI_SLEUTEL)');
  end if;
end $$;

-- 4. De Edge Function aanroepen (pg_cron elk uur op :55, of zelf in de SQL Editor om te testen)
create or replace function public.ig_story_mini_maken()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  k text;
  r extensions.http_response;
begin
  perform alleen_marnix();
  if not exists (select 1 from ig_mini_todo(1)) then
    return jsonb_build_object('gedaan', '[]'::jsonb, 'niks_te_doen', true);   -- niks nieuws: Edge Function nie wakker maken
  end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'story_mini_sleutel' limit 1;
  perform set_config('http.timeout_msec', '60000', true);
  r := extensions.http((
         'POST', 'https://bbmsggyqbhbcrziyblhr.supabase.co/functions/v1/story-mini',
         array[extensions.http_header('x-sleutel', k)],
         'application/json', '{}'
       )::extensions.http_request);
  if r.status <> 200 then
    raise exception 'story-mini gaf %: %', r.status, left(coalesce(r.content, ''), 200);
  end if;
  return r.content::jsonb;
end;
$$;
revoke execute on function public.ig_story_mini_maken() from public, anon, authenticated;

-- 5. Eindmeting: zit er een story in z'n laatste half uur die > 8 min nie gemeten is? Dan alles nog een keer meten.
create or replace function public.ig_stories_eindmeting()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform alleen_marnix();
  if exists (select 1 from ig_story
              where bron <> 'export'
                and gepost_om between now() - interval '24 hours' and now() - interval '23 hours 30 minutes'
                and coalesce(laatst_gemeten_om, '-infinity'::timestamptz) < now() - interval '8 minutes') then
    return ig_stories_refresh() || jsonb_build_object('eindmeting', true);
  end if;
  return jsonb_build_object('eindmeting', false);
end;
$$;
revoke execute on function public.ig_stories_eindmeting() from public, anon, authenticated;

-- 6. Klusjes (UTC): plaatjes elk uur op :55 (net na de stories-ronde van :50), eindmeting op :05, :15, ..., :55
select cron.unschedule(jobname) from cron.job where jobname in ('instagram-stories-mini', 'instagram-stories-eind');
select cron.schedule('instagram-stories-mini', '55 * * * *',       'select public.ig_story_mini_maken()');
select cron.schedule('instagram-stories-eind', '5-59/10 * * * *',  'select public.ig_stories_eindmeting()');

-- 7. Controle: welke stories wachten op een plaatje (verwacht: je 4 stories van 29/30-09, als hun link nog werkt)
select to_char(t.gepost_om at time zone 'Europe/Amsterdam', 'DD-MM HH24:MI') as geplaatst, t.wacht_op_plaatje,
       (select count(*) from cron.job where jobname in ('instagram-stories-mini', 'instagram-stories-eind')) as klusjes
  from (select s.gepost_om, true as wacht_op_plaatje from public.ig_story s
         where s.media_id in (select media_id from public.ig_mini_todo(10))) t
 order by t.gepost_om desc;
