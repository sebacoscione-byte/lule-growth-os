-- Registra cuándo las opciones concretas de sede entran en pantalla. No contiene datos personales.
do $$
declare
  existing_constraint text;
begin
  select con.conname into existing_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'landing_events'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%event_type%cta_cimel%'
  limit 1;

  if existing_constraint is not null then
    execute format('alter table landing_events drop constraint %I', existing_constraint);
  end if;
end $$;

alter table landing_events add constraint landing_events_event_type_check
  check (event_type in (
    'cta_cimel', 'cta_swiss', 'cta_britanico', 'instructions_viewed', 'form_started', 'form_submitted',
    'page_view', 'view_booking_options', 'click_booking', 'click_call', 'click_whatsapp', 'click_maps',
    'click_hero_primary', 'click_hero_secondary', 'click_instagram'
  ));

create or replace function dashboard_site_journey(p_start date, p_end date)
returns table(
  source text,
  medium text,
  campaign text,
  content text,
  visits bigint,
  hero_visits bigint,
  contact_visits bigint,
  booking_visits bigint,
  call_visits bigint,
  whatsapp_visits bigint,
  maps_visits bigint,
  instagram_visits bigint
)
language sql
stable
as $$
  with normalized as (
    select
      case
        when lower(trim(utm_source)) in ('ig', 'insta', 'instagram') then 'instagram'
        when nullif(lower(trim(utm_source)), '') is null then 'direct'
        else lower(trim(utm_source))
      end as source,
      coalesce(nullif(lower(trim(utm_medium)), ''), 'sin_medium') as medium,
      coalesce(nullif(lower(trim(utm_campaign)), ''), 'sin_campana') as campaign,
      coalesce(nullif(lower(trim(utm_content)), ''), 'sin_contenido') as content,
      event_type,
      coalesce(session_id::text, id::text) as visit_key
    from landing_events
    where timezone('America/Argentina/Buenos_Aires', created_at)::date
      between least(p_start, p_end) and greatest(p_start, p_end)
  )
  select
    source,
    medium,
    campaign,
    content,
    count(distinct visit_key) filter (where event_type = 'page_view') as visits,
    count(distinct visit_key) filter (
      where event_type in ('view_booking_options', 'click_hero_primary', 'click_hero_secondary')
    ) as hero_visits,
    count(distinct visit_key) filter (
      where event_type in ('click_booking', 'click_call', 'click_whatsapp', 'click_maps')
    ) as contact_visits,
    count(distinct visit_key) filter (where event_type = 'click_booking') as booking_visits,
    count(distinct visit_key) filter (where event_type = 'click_call') as call_visits,
    count(distinct visit_key) filter (where event_type = 'click_whatsapp') as whatsapp_visits,
    count(distinct visit_key) filter (where event_type = 'click_maps') as maps_visits,
    count(distinct visit_key) filter (where event_type = 'click_instagram') as instagram_visits
  from normalized
  group by source, medium, campaign, content
  order by visits desc, contact_visits desc;
$$;

revoke all on function dashboard_site_journey(date, date) from public, anon;
grant execute on function dashboard_site_journey(date, date) to authenticated;
