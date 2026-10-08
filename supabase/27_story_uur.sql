-- =====================================================================
-- 27_story_uur.sql — stories: elke meting bewaren, niet alleen de laatste (08-10-2026, chat 27.1)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Alles of niets: gaat er iets mis, dan wordt niets van dit bestand bewaard.
--
-- Waarom: ig_story bewaart per story alleen de LAATSTE stand. Voor "is deze story on fire?" (chat 27)
--   moet je weten hoeveel bereik een story had na 1, 3 of 6 uur. Dat bewaren we nu zelf, net als
--   ig_post_uur (25) dat voor posts doet.
-- Wat:
--   1. tabel ig_story_uur: per story (tot 25 uur na het plaatsen) elke meting, met leeftijd in minuten
--   2. trigger op ig_story: elke meting die er toch al is (klusje instagram-stories elk uur op :50,
--      eindmeting rond 23,5-24 uur) gaat ook in ig_story_uur
--        - bron 'uur'  = gewone meting
--        - bron 'eind' = meting in het laatste half uur (23,5-25 uur oud)
--        - mislukt (bijv. < 5 kijkers): regel met fout en lege cijfers
--        - export-stories (bron 'export') doen nie mee
--   3. de stories die nu online staan: hun laatste meting meteen overnemen
-- Géén extra vragen aan Meta, géén nieuw klusje, niks aan de app. Niks gewist.
-- Let op: ig_stories_refresh schrijft per story 2x (eerst de cijfers, dan los de navigatie/tikte-weg).
--   Beide horen bij dezelfde meting (zelfde tijdstip) → de trigger werkt dezelfde regel bij.
-- =====================================================================

-- 1. Tabel
create table if not exists public.ig_story_uur (
  media_id  text        not null references public.ig_story(media_id) on delete cascade,
  om        timestamptz not null,                 -- moment van de meting (= ig_story.laatst_gemeten_om)
  minuut    integer     not null,                 -- leeftijd van de story op dat moment, in minuten
  bron      text        not null,                 -- 'uur' (gewone meting) of 'eind' (laatste half uur)
  cijfers   jsonb       not null default '{}',     -- zelfde namen als ig_story: reach, views, shares, replies, follows,
                                                  --   profile_visits, nav_weg, nav_vooruit, ...
  fout      text,                                 -- meting mislukt? dan hier de reden (cijfers leeg)
  primary key (media_id, om)
);
create index if not exists ig_story_uur_om on public.ig_story_uur (om);
alter table public.ig_story_uur enable row level security;
drop policy if exists "alleen marnix mag lezen" on public.ig_story_uur;
create policy "alleen marnix mag lezen" on public.ig_story_uur for select to authenticated using ((select public.is_marnix()));
revoke all on public.ig_story_uur from anon, authenticated;
grant select on public.ig_story_uur to authenticated;

-- 2. Trigger: nieuwe meting in ig_story van een story < 25 uur oud → ook in ig_story_uur
--    Mag NOOIT een fout geven (anders mislukt het uurlijkse klusje) → alles in een vangnet.
create or replace function public.ig_story_uur_van_story()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  leeftijd integer;
begin
  begin
    if new.laatst_gemeten_om is not null
       and new.gepost_om is not null
       and coalesce(new.bron, 'api') <> 'export'
       and new.laatst_gemeten_om > new.gepost_om
       and new.laatst_gemeten_om < new.gepost_om + interval '25 hours'
       and (tg_op = 'INSERT'
            or new.laatst_gemeten_om is distinct from old.laatst_gemeten_om
            or new.cijfers is distinct from old.cijfers
            or new.fout is distinct from old.fout) then
      leeftijd := floor(extract(epoch from new.laatst_gemeten_om - new.gepost_om) / 60)::int;
      insert into ig_story_uur (media_id, om, minuut, bron, cijfers, fout)
      values (new.media_id, new.laatst_gemeten_om, leeftijd,
              case when leeftijd >= 1410 then 'eind' else 'uur' end,          -- 1410 min = 23,5 uur
              case when new.fout is null then new.cijfers else '{}'::jsonb end,
              new.fout)
      on conflict (media_id, om) do update
        set cijfers = excluded.cijfers, fout = excluded.fout;               -- 2e schrijfbeurt (navigatie) van dezelfde meting
    end if;
  exception when others then
    null;   -- liever een meting minder dan een mislukte story-ronde
  end;
  return new;
end;
$$;
revoke execute on function public.ig_story_uur_van_story() from public, anon, authenticated;
drop trigger if exists ig_story_uur_van_story on public.ig_story;
create trigger ig_story_uur_van_story after insert or update on public.ig_story
  for each row execute function public.ig_story_uur_van_story();

-- 3. Stories die nu online staan: hun laatste meting alvast overnemen (bij opnieuw draaien: niks dubbel)
insert into public.ig_story_uur (media_id, om, minuut, bron, cijfers, fout)
select s.media_id, s.laatst_gemeten_om,
       floor(extract(epoch from s.laatst_gemeten_om - s.gepost_om) / 60)::int,
       case when s.laatst_gemeten_om - s.gepost_om >= interval '23 hours 30 minutes' then 'eind' else 'uur' end,
       case when s.fout is null then s.cijfers else '{}'::jsonb end,
       s.fout
  from public.ig_story s
 where coalesce(s.bron, 'api') <> 'export'
   and s.laatst_gemeten_om > s.gepost_om
   and s.laatst_gemeten_om < s.gepost_om + interval '25 hours'
   and s.gepost_om > now() - interval '25 hours'
on conflict (media_id, om) do nothing;
