-- Atribución comprobable de contenido de Instagram:
-- pieza (utm_content), CTA/landing (referral_code), conversación, lead y turno confirmado.
-- Es aditiva y mantiene la RPC v1 para no cortar mensajes durante un deploy gradual.

alter table whatsapp_sessions add column if not exists content_item_id text;
alter table whatsapp_sessions add column if not exists content_origin_location_key text;
alter table leads add column if not exists referral_code text;
alter table leads add column if not exists content_origin_location_key text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_sessions_content_item_id_length') then
    alter table whatsapp_sessions add constraint whatsapp_sessions_content_item_id_length
      check (content_item_id is null or length(content_item_id) between 6 and 160);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_sessions_content_origin_location_check') then
    alter table whatsapp_sessions add constraint whatsapp_sessions_content_origin_location_check
      check (content_origin_location_key is null or content_origin_location_key in ('cimel', 'swiss', 'britanico'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_referral_code_length') then
    alter table leads add constraint leads_referral_code_length
      check (referral_code is null or length(referral_code) <= 64);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_content_origin_location_check') then
    alter table leads add constraint leads_content_origin_location_check
      check (content_origin_location_key is null or content_origin_location_key in ('cimel', 'swiss', 'britanico'));
  end if;
end $$;

create index if not exists whatsapp_sessions_content_item_idx
  on whatsapp_sessions(content_item_id) where content_item_id is not null;
create index if not exists leads_referral_code_idx
  on leads(referral_code) where referral_code is not null;

create table if not exists instagram_strategy_recommendations (
  recommendation_key text primary key,
  status text not null default 'pending' check (status in ('pending', 'approved', 'dismissed')),
  summary text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table instagram_strategy_recommendations enable row level security;

drop policy if exists service_role_all_instagram_strategy_recommendations on instagram_strategy_recommendations;
create policy service_role_all_instagram_strategy_recommendations
  on instagram_strategy_recommendations for all to service_role using (true) with check (true);

drop policy if exists authenticated_read_instagram_strategy_recommendations on instagram_strategy_recommendations;
create policy authenticated_read_instagram_strategy_recommendations
  on instagram_strategy_recommendations for select to authenticated using (true);

create or replace function upsert_whatsapp_intake_lead_v2(
  p_phone text,
  p_name text,
  p_requested_service text,
  p_general_reason text,
  p_insurance text,
  p_utm_content text,
  p_referral_code text,
  p_content_origin_location_key text,
  p_landing_page text,
  p_raw_message text,
  p_wa_message_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id uuid;
begin
  if coalesce(p_phone, '') !~ '^[0-9]{6,20}$' then raise exception 'invalid_phone'; end if;
  if p_requested_service is not null
    and p_requested_service not in ('consulta_cardiologia', 'ecocardiograma', 'no_definido') then
    raise exception 'invalid_requested_service';
  end if;
  if p_general_reason is not null
    and p_general_reason not in ('consulta_cardiologica', 'estudio_cardiologico', 'protocolo_investigacion') then
    raise exception 'invalid_general_reason';
  end if;
  if p_content_origin_location_key is not null
    and p_content_origin_location_key not in ('cimel', 'swiss', 'britanico') then
    raise exception 'invalid_content_origin_location';
  end if;
  if length(coalesce(p_insurance, '')) > 200
    or length(coalesce(p_utm_content, '')) > 160
    or length(coalesce(p_referral_code, '')) > 64
    or length(coalesce(p_landing_page, '')) > 200
    or length(coalesce(p_raw_message, '')) > 4096
    or length(coalesce(p_wa_message_id, '')) > 512 then
    raise exception 'invalid_intake_payload';
  end if;

  if not coalesce((
    select c.consented and c.version = 'v2-administrative-service'
    from consent_records c
    where c.wa_id = p_phone and c.purpose = 'administrative_service'
    order by c.created_at desc, c.id desc
    limit 1
  ), false) then
    raise exception 'administrative_consent_required';
  end if;

  v_lead_id := ensure_whatsapp_lead(
    p_phone, p_name, 'interesado', false, false, p_wa_message_id
  );

  update leads
  set requested_service = coalesce(p_requested_service, requested_service),
      general_reason = coalesce(p_general_reason, general_reason),
      insurance = coalesce(nullif(btrim(p_insurance), ''), insurance),
      utm_content = coalesce(nullif(btrim(p_utm_content), ''), utm_content),
      referral_code = coalesce(nullif(btrim(p_referral_code), ''), referral_code),
      content_origin_location_key = coalesce(
        nullif(btrim(p_content_origin_location_key), ''), content_origin_location_key
      ),
      landing_page = coalesce(nullif(btrim(p_landing_page), ''), landing_page),
      updated_at = now()
  where id = v_lead_id;

  if nullif(btrim(p_raw_message), '') is not null and nullif(p_wa_message_id, '') is not null then
    insert into messages(lead_id, role, content, direction, wa_message_id)
    values (v_lead_id, 'user', btrim(p_raw_message), 'inbound', p_wa_message_id)
    on conflict (wa_message_id) do nothing;
  end if;

  if nullif(p_wa_message_id, '') is not null then
    update whatsapp_cost_events
    set lead_id = v_lead_id
    where wa_message_id = p_wa_message_id and lead_id is null;
  end if;

  update consent_records set lead_id = v_lead_id where wa_id = p_phone and lead_id is null;
  return v_lead_id;
end;
$$;

revoke all on function upsert_whatsapp_intake_lead_v2(
  text, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function upsert_whatsapp_intake_lead_v2(
  text, text, text, text, text, text, text, text, text, text, text
) to service_role;

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
    where s.created_at >= p_since and s.created_at < p_until
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
