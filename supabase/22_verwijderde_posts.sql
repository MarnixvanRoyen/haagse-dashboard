-- =====================================================================
-- 22_verwijderde_posts.sql — verwijderde (of gearchiveerde) Insta-posts tellen nergens meer mee (06-10-2026)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
-- Alles of niets: gaat er iets mis, dan wordt niets van dit bestand bewaard.
--
-- Aanleiding: de carrousel van ma 5 okt 23:15 (18064467923511663) is op Insta verwijderd, maar bleef in het
-- dashboard meetellen, en ig_live vroeg elke ronde z'n cijfers op → gele melding "deels bèwerkt" (fout 400 "does not exist").
--
-- Wat er verandert:
--   1. ig_media krijgt verwijderd_op + verwijderd_reden. NIETS wordt gewist: rij en cijfers blijven bewaard.
--   2. ig_refresh (elke nacht): staat een post nie meer in de VOLLEDIGE lijst van Meta → gemarkeerd
--      (reden 'nie_in_lijst' = verwijderd of gearchiveerd). Alleen als de lijst compleet lijkt:
--      minstens 90% van je bekende posts erin én hooguit 10 posts tegelijk. Anders: niks markeren + melding.
--   3. ig_live (dashboard): fout "does not exist" bij een jonge post telt alleen als bewijs als de post ook ontbreekt
--      in de lijst van je nieuwste 10 posts die in dezelfde ronde gelukt is (reden 'bestaat_nie').
--      Zo'n post geeft dan geen gele melding meer en wordt nie meer opgevraagd. Andere fouten blijven fouten.
--   4. Komt een post terug in een lijst van Meta (hersteld uit "Onlangs verwijderd" of uit het archief)
--      → telt meteen weer mee. Met de hand terugzetten: select public.ig_post_terugzetten('<media_id>');
--   5. De view ig_post_stats (waar ALLE kaarten uit lezen) laat alleen nog actieve posts zien = het ene filter.
--   6. ig_partner_laat_meten slaat verwijderde posts over.
-- Geen extra vragen aan Meta.
-- =====================================================================

-- 1. kolommen
alter table public.ig_media add column if not exists verwijderd_op    timestamptz;
alter table public.ig_media add column if not exists verwijderd_reden text;   -- 'nie_in_lijst' of 'bestaat_nie'

-- hulpje (alleen tijdens deze run): vervang een stuk tekst precies 1 keer, anders stoppen
create or replace function pg_temp.vervang(def text, oud text, nieuw text, wat text)
returns text language plpgsql as $$
declare n int;
begin
  n := (length(def) - length(replace(def, oud, ''))) / length(oud);
  if n <> 1 then
    raise exception '22: plek "%" niet precies 1x gevonden (% keer)', wat, n;
  end if;
  return replace(def, oud, nieuw);
end $$;

-- 2. ig_refresh: terug in de lijst = weer actief; na de volledige lijst: wie ontbreekt markeren (met veiligheidsgrenzen)
do $migratie$
declare def text;
begin
  def := pg_get_functiondef('public.ig_refresh(integer,integer)'::regprocedure);
  if def like '%-- 22: verwijderd%' then
    raise notice 'ig_refresh is al aangepast, niks gedaan';
    return;
  end if;
  def := pg_temp.vervang(def,
    E'             likes = excluded.likes, reacties = excluded.reacties, gezien_om = now();\n      n_posts := n_posts + 1;',
    E'             likes = excluded.likes, reacties = excluded.reacties, gezien_om = now(),\n'
    || E'             verwijderd_op = null, verwijderd_reden = null;   -- 22: verwijderd — staat (weer) in de lijst = telt mee\n'
    || E'      n_posts := n_posts + 1;',
    'ig_refresh: opslaan van een post');
  def := pg_temp.vervang(def,
    E'  -- d. cijfers per post: alle posts',
    E'  -- 22: wie nie meer in de volledige lijst staat, telt nie meer mee (verwijderd of gearchiveerd).\n'
    || E'  --     Alleen als de lijst compleet lijkt: >= 90% van de bekende posts erin en hooguit 10 tegelijk.\n'
    || E'  declare\n'
    || E'    n_in  int;\n'
    || E'    n_uit int;\n'
    || E'  begin\n'
    || E'    select count(*) filter (where gezien_om >= start), count(*) filter (where gezien_om < start)\n'
    || E'      into n_in, n_uit\n'
    || E'      from ig_media where ig_id = acc and verwijderd_op is null;\n'
    || E'    if n_uit > 0 then\n'
    || E'      if n_in >= 0.9 * (n_in + n_uit) and n_uit <= 10 then\n'
    || E'        update ig_media set verwijderd_op = now(), verwijderd_reden = ''nie_in_lijst''\n'
    || E'         where ig_id = acc and verwijderd_op is null and gezien_om < start;\n'
    || E'      elsif cardinality(fouten) < 20 then\n'
    || E'        fouten := fouten || (''lijst van Meta leek onvolledig ('' || n_in || '' van '' || (n_in + n_uit) || '' posts): niks als verwijderd gemarkeerd'');\n'
    || E'      end if;\n'
    || E'    end if;\n'
    || E'  end;\n\n'
    || E'  -- d. cijfers per post: alle posts',
    'ig_refresh: begin stap d');
  execute def;
  raise notice 'ig_refresh aangepast';
end $migratie$;

-- 3. ig_live: lijst van de nieuwste 10 onthouden; "does not exist" + nie in die lijst = verwijderd (geen gele melding)
do $migratie$
declare def text;
begin
  def := pg_get_functiondef('public.ig_live(integer)'::regprocedure);
  if def like '%-- 22: verwijderd%' then
    raise notice 'ig_live is al aangepast, niks gedaan';
    return;
  end if;
  -- twee variabelen erbij (vlak voor de eerste begin)
  def := pg_temp.vervang(def,
    E'  fouten   text[] := ''{}'';\nbegin\n',
    E'  fouten   text[] := ''{}'';\n'
    || E'  lijst_ids    text[];        -- 22: verwijderd — id''s in de lijst van de nieuwste 10 (deze ronde)\n'
    || E'  lijst_oudste timestamptz;   -- oudste post in die lijst (wat jonger is, hoort erin te staan)\n'
    || E'begin\n',
    'ig_live: variabelen');
  -- terug in de lijst = weer actief, en de lijst onthouden
  def := pg_temp.vervang(def,
    E'               likes = excluded.likes, reacties = excluded.reacties, gezien_om = now();\n      end loop;\n      stappen := stappen || ''posts''::text;',
    E'               likes = excluded.likes, reacties = excluded.reacties, gezien_om = now(),\n'
    || E'               verwijderd_op = null, verwijderd_reden = null;\n'
    || E'      end loop;\n'
    || E'      select array_agg(e->>''id''),\n'
    || E'             case when count(*) >= 10 then min((e->>''timestamp'')::timestamptz) else ''-infinity''::timestamptz end\n'
    || E'        into lijst_ids, lijst_oudste\n'
    || E'        from jsonb_array_elements(coalesce(j->''data'', ''[]'')) e;\n'
    || E'      stappen := stappen || ''posts''::text;',
    'ig_live: lijst nieuwste 10');
  -- stap d: verwijderde posts nie meer opvragen
  def := pg_temp.vervang(def,
    E'  for m in select media_id, product from ig_media\n            where ig_id = acc and gepost_om > now() - interval ''2 days'' order by',
    E'  for m in select media_id, product, gepost_om from ig_media\n            where ig_id = acc and verwijderd_op is null and gepost_om > now() - interval ''2 days'' order by',
    'ig_live: stap d');
  -- fout "does not exist" + nie in de lijst van deze ronde = verwijderd, geen fout
  def := pg_temp.vervang(def,
    E'      fouten := fouten || (''post '' || m.media_id || '': '' || left(sqlerrm, 100));',
    E'      if sqlerrm ~ ''fout 400 .*does not exist'' and cardinality(lijst_ids) > 0\n'
    || E'         and not (m.media_id = any(lijst_ids)) and m.gepost_om >= lijst_oudste then\n'
    || E'        update ig_media set verwijderd_op = now(), verwijderd_reden = ''bestaat_nie'' where media_id = m.media_id;\n'
    || E'        stappen := stappen || (''post '' || m.media_id || '' verwijderd'');\n'
    || E'      else\n'
    || E'        fouten := fouten || (''post '' || m.media_id || '': '' || left(sqlerrm, 100));\n'
    || E'      end if;',
    'ig_live: fout bij een post');
  execute def;
  raise notice 'ig_live aangepast';
end $migratie$;
revoke execute on function public.ig_live(int) from public, anon;
grant  execute on function public.ig_live(int) to authenticated;

-- 4. ig_partner_laat_meten: verwijderde posts overslaan
do $migratie$
declare def text;
begin
  def := pg_get_functiondef('public.ig_partner_laat_meten()'::regprocedure);
  if def like '%verwijderd_op%' then
    raise notice 'ig_partner_laat_meten is al aangepast, niks gedaan';
    return;
  end if;
  def := pg_temp.vervang(def,
    E'            where soort = ''bij_aannemen'' and om > now() - interval ''14 days''',
    E'            where soort = ''bij_aannemen'' and om > now() - interval ''14 days''\n'
    || E'              and media_id not in (select media_id from ig_media where verwijderd_op is not null)   -- 22',
    'ig_partner_laat_meten');
  execute def;
end $migratie$;
revoke execute on function public.ig_partner_laat_meten() from public, anon, authenticated;

-- 5. het ene filter: ig_post_stats laat alleen actieve posts zien (de rest van de view blijft zoals hij nu is)
do $migratie$
declare def text;
begin
  def := pg_get_viewdef('public.ig_post_stats'::regclass, true);
  if def like '%verwijderd_op%' then
    raise notice 'ig_post_stats filtert al, niks gedaan';
    return;
  end if;
  if def ~* '\mwhere\M[^)]*$' then
    raise exception '22: ig_post_stats heeft al een where aan het eind, eerst bekijken';
  end if;
  def := rtrim(rtrim(def), ';')
      || E'\n  WHERE NOT (EXISTS ( SELECT 1 FROM public.ig_media w WHERE w.media_id = m.media_id AND w.verwijderd_op IS NOT NULL))';
  execute 'create or replace view public.ig_post_stats with (security_invoker = true) as ' || def;
end $migratie$;
revoke all on public.ig_post_stats from anon, authenticated;
grant select on public.ig_post_stats to authenticated;

-- 6. met de hand terugzetten (ook vanuit het dashboard, knop "Zet terug")
create or replace function public.ig_post_terugzetten(p_media_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  perform alleen_marnix();
  update ig_media set verwijderd_op = null, verwijderd_reden = null
   where media_id = p_media_id and verwijderd_op is not null;
  get diagnostics n = row_count;
  return jsonb_build_object('teruggezet', n);
end;
$$;
revoke execute on function public.ig_post_terugzetten(text) from public, anon;
grant  execute on function public.ig_post_terugzetten(text) to authenticated;

-- 7. Nu meteen: de carrousel van 5 okt markeren (de check van 06-10 liet zien: nie meer bij Meta, 787 van 788).
--    Alleen deze ene post, en alleen als hij nog nie gemarkeerd is. Vanaf vannacht doet ig_refresh het zelf.
update public.ig_media set verwijderd_op = now(), verwijderd_reden = 'nie_in_lijst'
 where media_id = '18064467923511663' and verwijderd_op is null;

-- 8. Uitkomst: welke posts tellen nie meer mee, en hoeveel tellen er wel mee
select (select count(*) from public.ig_post_stats) as posts_die_meetellen,
       (select count(*) from public.ig_media where verwijderd_op is not null) as posts_weg,
       (select string_agg(media_id || ' (' || to_char(gepost_om at time zone 'Europe/Amsterdam', 'DD-MM HH24:MI') || ', '
                          || verwijderd_reden || ')', '; ')
          from public.ig_media where verwijderd_op is not null) as welke;
