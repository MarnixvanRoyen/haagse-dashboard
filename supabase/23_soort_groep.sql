-- =====================================================================
-- 23_soort_groep.sql — één indeling per soort post: 'foto' (foto's en carrousels), 'reel' of 'story' (06-10-2026)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Alles of niets: gaat er iets mis, dan wordt niets van dit bestand bewaard.
--
-- Waarom: reels doen het bij @the_hague_beachlife heel anders dan foto's/carrousels (check 06-10, laatste 90 dagen:
-- middelste bereik 583 vs 1.151, likes per kijkâh 10,2% vs 12,6%, kwaliteit 3,4 vs 4,4), en Meta geeft voor reels
-- geen volgâhs/profielbezoek per post. Dus: altijd binnen de eigen groep vergelijken.
--   1. functie ig_groep(soort, product): de ENIGE regel (de app gebruikt precies dezelfde: soortGroep in insta.js)
--   2. ig_post_stats krijgt kolom 'groep' (achteraan; de rest van de view blijft zoals hij is, ook het filter uit 22)
-- Niks gewist, geen vragen aan Meta.
-- =====================================================================

-- 1. de regel: reel = REELS of een (oude) video; stories hebben hun eigen tabel (ig_story) → 'story'; de rest = foto
create or replace function public.ig_groep(p_soort text, p_product text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when upper(coalesce(p_product, '')) = 'STORY'                                     then 'story'
           when upper(coalesce(p_product, '')) = 'REELS' or upper(coalesce(p_soort, '')) = 'VIDEO' then 'reel'
           else 'foto'
         end;
$$;
revoke execute on function public.ig_groep(text, text) from public, anon;
grant  execute on function public.ig_groep(text, text) to authenticated;

-- 2. kolom 'groep' achteraan in ig_post_stats (de view zoals hij NU is, met het filter uit 22)
do $migratie$
declare def text;
begin
  def := pg_get_viewdef('public.ig_post_stats'::regclass, true);
  if def like '%ig_groep(%' then
    raise notice 'ig_post_stats heeft al een kolom groep, niks gedaan';
    return;
  end if;
  if regexp_count(def, '''\[\]''::jsonb\) AS labels\s+FROM ') <> 1 then
    raise exception '23: plek voor de kolom groep niet (precies 1x) gevonden in ig_post_stats';
  end if;
  def := regexp_replace(def, '(''\[\]''::jsonb\) AS labels)(\s+FROM )', E'\\1,\n    public.ig_groep(m.soort, m.product) AS groep\\2');
  execute 'create or replace view public.ig_post_stats with (security_invoker = true) as ' || rtrim(rtrim(def), ';');
end $migratie$;
revoke all on public.ig_post_stats from anon, authenticated;
grant select on public.ig_post_stats to authenticated;

-- 3. Uitkomst: per groep hoeveel actieve posts (verwacht: foto ± 724, reel ± 63)
select groep, count(*) as posts,
       count(*) filter (where gepost_om > now() - interval '90 days') as laatste_90_dagen
  from public.ig_post_stats
 group by groep
 order by groep;
