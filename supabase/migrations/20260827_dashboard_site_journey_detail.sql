-- ============================================================
-- Dashboard: detalle anónimo del recorrido web por campaña.
--
-- Amplía el agregado existente para distinguir sesiones que sólo cargaron la
-- página, quienes vieron las opciones de sede, quienes tocaron el CTA principal
-- y quienes salieron por cada canal oficial. No devuelve eventos individuales ni
-- datos de pacientes.
-- ============================================================

drop function if exists dashboard_site_journey(date, date);

create function dashboard_site_journey(p_start date, p_end date)
returns table(
  source text,
  medium text,
  campaign text,
  content text,
  visits bigint,
  active_visits bigint,
  hero_visits bigint,
  booking_options_visits bigint,
  hero_booking_visits bigint,
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
      coalesce(nullif(lower(trim(variant)), ''), 'a') as variant,
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
    count(distinct visit_key) filter (where event_type <> 'page_view') as active_visits,
    count(distinct visit_key) filter (
      where event_type in ('view_booking_options', 'click_hero_primary', 'click_hero_secondary')
    ) as hero_visits,
    count(distinct visit_key) filter (where event_type = 'view_booking_options') as booking_options_visits,
    count(distinct visit_key) filter (
      where (event_type = 'click_hero_primary' and variant = 'a')
         or (event_type = 'click_hero_secondary' and variant = 'b')
    ) as hero_booking_visits,
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
