-- =====================================================================
-- 20_bedankkaart.sql — verse plaatjes voor de bedankkaart van een partner (03-10-2026)
-- Archief: de SQL wordt via de chat gedraaid (Supabase > SQL Editor > Run). Veilig opnieuw te draaien.
--
-- Waarom: de bedankkaart (js/bedankkaart.js) toont de profielfoto van de partner, je eigen profielfoto
-- en het plaatje van jullie beste post. Links naar plaatjes van Meta verlopen na een tijd, dus we vragen
-- ze vers op op het moment dat je een kaart maakt. Niets wordt bewaard.
--
-- ig_bedank_beelden(partner, media_id) doet hooguit 3 vragen aan Meta:
--   1. Business Discovery (Facebook-route): profielfoto, naam, volgers van de partner  → telt mee voor de
--      Meta-limiet van ± 200 per uur (gedeeld met de partner-klusjes; 1 vraag is niks)
--   2. me (Instagram-route): je eigen profielfoto
--   3. de post (Instagram-route): plaatje (of voorplaatje bij video/reel) + link
-- Elke stap mag mislukken zonder dat de rest stopt (fout staat dan in partner_fout / ik_fout / post_fout).
-- Elke vraag wacht hooguit 4 s, dus samen ruim binnen de 15 s die Supabase de app geeft.
-- =====================================================================

create or replace function public.ig_bedank_beelden(p_partner text, p_media_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  acc  text;
  j    jsonb;
  uit  jsonb := '{}'::jsonb;
  t0   timestamptz := clock_timestamp();
  schoon constant text := 'access_token=[^&[:space:]"]+';   -- voor de zekerheid: nooit een sleutel in een foutmelding
begin
  perform alleen_marnix();
  p_partner := lower(trim(coalesce(p_partner, '')));
  if p_partner !~ '^[a-z0-9._]{1,30}$' then
    raise exception 'Ongeldige partnernaam';                  -- de naam komt in de link naar Meta, dus streng controleren
  end if;
  if p_media_id is not null and not exists (select 1 from ig_media where media_id = p_media_id) then
    raise exception 'Onbekende post';                         -- alleen je eigen posts
  end if;
  perform set_config('http.timeout_msec', '4000', true);     -- 4 s per vraag, alleen binnen deze aanroep

  select ig_id into acc from ig_account order by bijgewerkt_om desc limit 1;
  acc := coalesce(acc, '17841451414340372');

  -- 1. de partner
  begin
    j := fb_get(acc || '?fields=business_discovery.username(' || p_partner
                || ')%7Busername,name,profile_picture_url,followers_count,media_count%7D');
    uit := uit || jsonb_build_object('partner', j->'business_discovery');
  exception when others then
    uit := uit || jsonb_build_object('partner_fout', left(regexp_replace(sqlerrm, schoon, 'access_token=***', 'g'), 200));
  end;

  -- 2. jezelf
  begin
    j := ig_get('me?fields=username,profile_picture_url');
    uit := uit || jsonb_build_object('ik', jsonb_build_object('username', j->>'username', 'profile_picture_url', j->>'profile_picture_url'));
  exception when others then
    uit := uit || jsonb_build_object('ik_fout', left(regexp_replace(sqlerrm, schoon, 'access_token=***', 'g'), 200));
  end;

  -- 3. de post
  if p_media_id is not null then
    begin
      j := ig_get(p_media_id || '?fields=media_type,media_url,thumbnail_url,permalink');
      uit := uit || jsonb_build_object('post', jsonb_build_object(
               'beeld', coalesce(j->>'thumbnail_url', j->>'media_url'), 'permalink', j->>'permalink'));
    exception when others then
      uit := uit || jsonb_build_object('post_fout', left(regexp_replace(sqlerrm, schoon, 'access_token=***', 'g'), 200));
    end;
  end if;

  return uit || jsonb_build_object('duur_ms', round(extract(epoch from clock_timestamp() - t0) * 1000));
end;
$$;

revoke execute on function public.ig_bedank_beelden(text, text) from public, anon;
grant  execute on function public.ig_bedank_beelden(text, text) to authenticated;
