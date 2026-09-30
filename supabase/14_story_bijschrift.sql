-- 14_story_bijschrift.sql (30-09-2026) — stories: bijschrift bewaren, zodat het dashboard ziet of een story
-- zelf gemaakt is (geen bijschrift) of een gedeelde post (neemt het bijschrift van die post mee).
-- Meta geeft het bijschrift alleen zolang de story online staat (24 uur), dus oudere stories blijven "onbekend".
-- Dubbel draaien kan geen kwaad.

-- 1. Kolom erbij. null = nie gemeten (story van vóór deze aanpassing), '' = geen bijschrift, anders = tekst
alter table public.ig_story add column if not exists bijschrift text;

-- 2. ig_stories_refresh haalt voortaan ook het bijschrift op (ingevoegd in de bestaande functie)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.ig_stories_refresh()'::regprocedure);
  if position('bijschrift' in d) = 0 then
    d := replace(d, 'me/stories?fields=id,media_type,permalink,thumbnail_url,media_url,timestamp''',
                    'me/stories?fields=id,media_type,permalink,thumbnail_url,media_url,timestamp,caption''');
    d := replace(d, 'insert into ig_story (media_id, ig_id, soort, gepost_om, permalink, plaatje)',
                    'insert into ig_story (media_id, ig_id, soort, gepost_om, permalink, plaatje, bijschrift)');
    d := replace(d, 'coalesce(x->>''thumbnail_url'', x->>''media_url''))',
                    'coalesce(x->>''thumbnail_url'', x->>''media_url''), coalesce(x->>''caption'', ''''))');
    d := replace(d, 'on conflict (media_id) do update set permalink = excluded.permalink, plaatje = excluded.plaatje;',
                    'on conflict (media_id) do update set permalink = excluded.permalink, plaatje = excluded.plaatje, bijschrift = excluded.bijschrift;');
    if position(',caption''' in d) = 0 or position('bijschrift = excluded.bijschrift' in d) = 0
       or position('plaatje, bijschrift)' in d) = 0 or position('''''))' in d) = 0 then
      raise exception 'ig_stories_refresh ziet er anders uit dan verwacht: niks aangepast. Stuur deze melding naar Claude.';
    end if;
    execute d;
  end if;
end $$;

-- 3. Meteen de stories van nu ophalen (mét bijschrift) ...
select public.ig_stories_refresh();

-- 4. ... en laten zien wat er nu staat (aparte opdracht: in dezelfde opdracht zie je de wijzigingen nog nie)
select to_char(gepost_om at time zone 'Europe/Amsterdam', 'DD-MM HH24:MI') as geplaatst,
       case when bijschrift is null then 'onbekend (van vóór deze aanpassing)'
            when bijschrift = '' then 'geen bijschrift → zelf gemaakt'
            else 'gedeelde post: ' || left(bijschrift, 40) end as wat
  from public.ig_story
 where gepost_om > now() - interval '2 days'
 order by gepost_om desc;
