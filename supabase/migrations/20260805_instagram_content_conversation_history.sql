-- Historial inmutable de conversaciones atribuibles. La sesión de WhatsApp es una fila mutable y
-- puede volver desde otra pieza; el trigger conserva cada combinación persona anónima/pieza sin
-- copiar teléfono, nombre ni texto del mensaje.

create table if not exists instagram_content_conversations (
  id uuid default uuid_generate_v4() primary key,
  whatsapp_session_id uuid not null references whatsapp_sessions(id) on delete cascade,
  content_item_id text not null check (length(content_item_id) between 6 and 160),
  referral_code text check (referral_code is null or length(referral_code) <= 64),
  location_key text check (location_key is null or location_key in ('cimel', 'swiss', 'britanico')),
  attributed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (whatsapp_session_id, content_item_id)
);

create index if not exists instagram_content_conversations_item_time_idx
  on instagram_content_conversations(content_item_id, attributed_at);

alter table instagram_content_conversations enable row level security;

drop policy if exists service_role_all_instagram_content_conversations on instagram_content_conversations;
create policy service_role_all_instagram_content_conversations
  on instagram_content_conversations for all to service_role using (true) with check (true);

create or replace function capture_instagram_content_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.content_item_id is null or new.content_attributed_at is null then return new; end if;
  insert into instagram_content_conversations(
    whatsapp_session_id, content_item_id, referral_code, location_key, attributed_at
  ) values (
    new.id, new.content_item_id, new.referral_code, new.content_origin_location_key, new.content_attributed_at
  )
  on conflict (whatsapp_session_id, content_item_id) do update
  set referral_code = coalesce(excluded.referral_code, instagram_content_conversations.referral_code),
      location_key = coalesce(excluded.location_key, instagram_content_conversations.location_key),
      attributed_at = least(excluded.attributed_at, instagram_content_conversations.attributed_at);
  return new;
end;
$$;

drop trigger if exists capture_instagram_content_conversation_trigger on whatsapp_sessions;
create trigger capture_instagram_content_conversation_trigger
after insert or update of content_item_id, content_attributed_at on whatsapp_sessions
for each row
when (new.content_item_id is not null and new.content_attributed_at is not null)
execute function capture_instagram_content_conversation();

insert into instagram_content_conversations(
  whatsapp_session_id, content_item_id, referral_code, location_key, attributed_at
)
select id, content_item_id, referral_code, content_origin_location_key, content_attributed_at
from whatsapp_sessions
where content_item_id is not null and content_attributed_at is not null
on conflict (whatsapp_session_id, content_item_id) do nothing;

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
security definer
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
      c.content_item_id as item_id,
      c.location_key,
      count(*) as conversations
    from instagram_content_conversations c
    where c.attributed_at >= p_since and c.attributed_at < p_until
    group by c.content_item_id, c.location_key
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

revoke all on function instagram_content_attribution(timestamptz, timestamptz) from public, anon;
grant execute on function instagram_content_attribution(timestamptz, timestamptz) to authenticated, service_role;
