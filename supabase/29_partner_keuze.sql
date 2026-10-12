-- 29_partner_keuze.sql — chat 19 (12-10-2026): jouw eigen keuzes per partner (Partnâhs → "let op")
--
-- Waarom: de app rekent per partner automatische "let op"-signalen uit (geel/rood), in de browser, zonder extra Meta-vragen.
-- Wat jij zelf beslist, moet bewaard blijven en telt altijd zwaarder:
--   - "Nie mee samenwerke" (stop) + een reden die alleen jij ziet; terugzetten kan altijd.
--   - "Klopt, is oké": de signalen van dat moment wegklikken. Komt er later een ánder signaal bij, dan komt de kleur terug
--     (de app vergelijkt de lijst in `oke` met de signalen van nu).
--
-- Veilig: alleen Marnix mag lezen (RLS is_marnix) en schrijven (alleen via ig_partner_keuze_zet, met alleen_marnix()).
-- Opnieuw draaien kan: alles is "if not exists" / "or replace".

-- 1. Tabel
create table if not exists public.ig_partner_keuze (
  partner        text primary key,                 -- Insta-naam, bijv. keep_the_every_moments
  stop           boolean not null default false,   -- true = nie mee samenwerke
  reden          text,                             -- alleen voor jou
  stop_om        timestamptz,
  oke            text[] not null default '{}',     -- signalen die je hebt weggeklikt ("klopt, is oké")
  oke_om         timestamptz,
  bijgewerkt_om  timestamptz not null default now()
);

alter table public.ig_partner_keuze enable row level security;
drop policy if exists "alleen marnix mag lezen" on public.ig_partner_keuze;
create policy "alleen marnix mag lezen" on public.ig_partner_keuze for select to authenticated using ((select public.is_marnix()));
revoke all on public.ig_partner_keuze from anon, authenticated;
grant select on public.ig_partner_keuze to authenticated;

-- 2. Schrijven vanuit de app
--    p_wat: 'stop' (met reden) · 'terug' (weer samenwerke) · 'oke' (deze signalen wegklikken) · 'oke_weg' (wegklikken ongedaan)
create or replace function public.ig_partner_keuze_zet(p_partner text, p_wat text, p_reden text default null, p_signalen text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  naam text := lower(trim(coalesce(p_partner, '')));
  uit  public.ig_partner_keuze;
begin
  perform public.alleen_marnix();
  if naam !~ '^[a-z0-9._]{1,30}$' then
    raise exception 'Onbekende Insta-naam: %', p_partner;
  end if;
  if p_wat not in ('stop', 'terug', 'oke', 'oke_weg') then
    raise exception 'Onbekende keuze: %', p_wat;
  end if;
  insert into public.ig_partner_keuze (partner) values (naam) on conflict (partner) do nothing;
  if p_wat = 'stop' then
    update public.ig_partner_keuze
       set stop = true, reden = nullif(left(trim(coalesce(p_reden, '')), 500), ''), stop_om = now(), bijgewerkt_om = now()
     where partner = naam;
  elsif p_wat = 'terug' then
    update public.ig_partner_keuze set stop = false, reden = null, stop_om = null, bijgewerkt_om = now() where partner = naam;
  elsif p_wat = 'oke' then
    update public.ig_partner_keuze
       set oke = coalesce((select array_agg(distinct left(s, 40) order by left(s, 40)) from unnest(coalesce(p_signalen, '{}')) s
                            where s ~ '^[a-z_]{1,40}$'), '{}'),
           oke_om = now(), bijgewerkt_om = now()
     where partner = naam;
  else
    update public.ig_partner_keuze set oke = '{}', oke_om = null, bijgewerkt_om = now() where partner = naam;
  end if;
  select * into uit from public.ig_partner_keuze where partner = naam;
  return to_jsonb(uit);
end;
$$;
revoke execute on function public.ig_partner_keuze_zet(text, text, text, text[]) from public, anon;
grant  execute on function public.ig_partner_keuze_zet(text, text, text, text[]) to authenticated;

-- 3. Uitkomst (verwacht: tabel_bestaat true, functie_bestaat true, keuzes 0 bij de eerste keer)
select to_regclass('public.ig_partner_keuze') is not null as tabel_bestaat,
       to_regprocedure('public.ig_partner_keuze_zet(text, text, text, text[])') is not null as functie_bestaat,
       (select count(*) from public.ig_partner_keuze) as keuzes;
