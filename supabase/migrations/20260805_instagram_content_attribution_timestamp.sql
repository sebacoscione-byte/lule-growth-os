-- Fija el instante de atribución de la conversación. `updated_at` sigue cambiando durante el bot y
-- no puede usarse como fecha del primer contacto atribuible.

alter table whatsapp_sessions add column if not exists content_attributed_at timestamptz;

update whatsapp_sessions
set content_attributed_at = coalesce(last_inbound_at, updated_at, created_at)
where content_item_id is not null and content_attributed_at is null;

create index if not exists whatsapp_sessions_content_attributed_at_idx
  on whatsapp_sessions(content_attributed_at) where content_item_id is not null;

create or replace function instagram_content_attribution(
  p_since timestamptz,
  p_until timestamptz default now()
)
returns table(
  item_id text,
  location_key text,
  visits bigint,
  clicks bigint,
  whatsapp_clicks bigint,
  conversations bigint,
  leads bigint,
  confirmed bigint
)
language sql
stable
set search_path = public
as $$
  with event_totals as (
    select
      e.utm_content as item_id,
      e.location_key,
      count(distinct coalesce(e.session_id::text, e.id::text))
        filter (where e.event_type = 'page_view') as visits,
      count(distinct coalesce(e.session_id::text, e.id::text))
        filter (where e.event_type in ('click_booking', 'click_call', 'click_whatsapp', 'click_maps')) as clicks,
      count(distinct coalesce(e.session_id::text, e.id::text))
        filter (where e.event_type = 'click_whatsapp') as whatsapp_clicks
    from landing_events e
    where e.created_at >= p_since and e.created_at < p_until
      and lower(trim(e.utm_source)) in ('ig', 'insta', 'instagram')
      and nullif(trim(e.utm_content), '') is not null
    group by e.utm_content, e.location_key
  ),
  conversation_totals as (
    select
      s.content_item_id as item_id,
      s.content_origin_location_key as location_key,
      count(distinct s.id) as conversations
    from whatsapp_sessions s
    where s.content_attributed_at >= p_since and s.content_attributed_at < p_until
      and nullif(trim(s.content_item_id), '') is not null
    group by s.content_item_id, s.content_origin_location_key
  ),
  lead_totals as (
    select
      l.utm_content as item_id,
      coalesce(
        case l.preferred_location
          when 'cimel_lanus' then 'cimel'
          when 'swiss_lomas' then 'swiss'
          when 'hospital_britanico' then 'britanico'
          else null
        end,
        l.content_origin_location_key
      ) as location_key,
      count(*) as leads,
      count(*) filter (where l.confirmed_booked) as confirmed
    from leads l
    where l.created_at >= p_since and l.created_at < p_until
      and nullif(trim(l.utm_content), '') is not null
    group by l.utm_content, coalesce(
      case l.preferred_location
        when 'cimel_lanus' then 'cimel'
        when 'swiss_lomas' then 'swiss'
        when 'hospital_britanico' then 'britanico'
        else null
      end,
      l.content_origin_location_key
    )
  ),
  keys as (
    select item_id, location_key from event_totals
    union select item_id, location_key from conversation_totals
    union select item_id, location_key from lead_totals
  )
  select
    k.item_id,
    k.location_key,
    coalesce(e.visits, 0),
    coalesce(e.clicks, 0),
    coalesce(e.whatsapp_clicks, 0),
    coalesce(c.conversations, 0),
    coalesce(l.leads, 0),
    coalesce(l.confirmed, 0)
  from keys k
  left join event_totals e on e.item_id = k.item_id and e.location_key is not distinct from k.location_key
  left join conversation_totals c on c.item_id = k.item_id and c.location_key is not distinct from k.location_key
  left join lead_totals l on l.item_id = k.item_id and l.location_key is not distinct from k.location_key;
$$;

grant execute on function instagram_content_attribution(timestamptz, timestamptz) to authenticated;
