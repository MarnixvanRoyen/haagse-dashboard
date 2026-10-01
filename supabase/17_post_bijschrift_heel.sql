-- 17_post_bijschrift_heel.sql (01-10-2026)
-- Het dashboard toont bij posts de eerste regel van het bijschrift; als je erover zweeft het HELE bijschrift.
-- De view ig_post_stats kapte het bijschrift af op 300 tekens → nu het hele bijschrift (Insta max 2.200 tekens).
-- Verder is de view precies hetzelfde als in 09b_insta_extra.sql.
create or replace view public.ig_post_stats
with (security_invoker = true) as
select m.media_id, m.soort, m.product, m.gepost_om, m.permalink, m.plaatje,
       m.bijschrift as bijschrift,
       m.cijfers_dag,
       (m.cijfers->>'reach')::int              as bereik,
       (m.cijfers->>'views')::int              as weergaven,
       coalesce((m.cijfers->>'likes')::int, m.likes)       as likes,
       coalesce((m.cijfers->>'comments')::int, m.reacties) as reacties,
       (m.cijfers->>'saved')::int              as bewaard,
       (m.cijfers->>'shares')::int             as gedeeld,
       (m.cijfers->>'follows')::int            as nieuwe_volgers,
       (m.cijfers->>'profile_visits')::int     as profielbezoeken,
       (m.cijfers->>'total_interactions')::int as interacties,
       round((m.cijfers->>'ig_reels_avg_watch_time')::numeric / 1000, 1) as kijktijd_sec,
       case when (m.cijfers->>'reach')::int > 0
            then round((coalesce((m.cijfers->>'saved')::int, 0) + coalesce((m.cijfers->>'shares')::int, 0))
                       * 1000.0 / (m.cijfers->>'reach')::int, 1) end as kwaliteit,
       v.volgers as volgers_toen,
       case when v.volgers > 0 and (m.cijfers->>'reach')::int is not null
            then round((m.cijfers->>'reach')::int * 1000.0 / v.volgers) end as per_1000_volgers,
       to_char(m.gepost_om at time zone 'Europe/Amsterdam', 'ID')::int as weekdag,   -- 1 = maandag
       extract(hour from m.gepost_om at time zone 'Europe/Amsterdam')::int as uur,
       coalesce(l.labels, '[]') as labels
  from public.ig_media_laatst m
  left join lateral (select p.volgers from public.ig_profiel_dag p
                      where p.ig_id = m.ig_id
                        and abs(p.dag - (m.gepost_om at time zone 'Europe/Amsterdam')::date) <= 3
                      order by abs(p.dag - (m.gepost_om at time zone 'Europe/Amsterdam')::date) limit 1) v on true
  left join lateral (select jsonb_agg(jsonb_build_object('soort', x.soort, 'label', x.label, 'bron', x.bron)
                                      order by x.soort, x.label) as labels
                       from public.ig_media_label x where x.media_id = m.media_id and not x.weg) l on true;
revoke all on public.ig_post_stats from anon, authenticated;
grant select on public.ig_post_stats to authenticated;

-- Check (moet de langste bijschrift-lengte tonen, meer dan 300 als je lange bijschriften hebt):
select max(length(bijschrift)) as langste, count(*) as posts from public.ig_post_stats;
