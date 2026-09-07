-- Permite responder distintas consultas administrativas en una misma conversación.
-- La deduplicación por evento permanece permanente; el cooldown sólo evita repetir el mismo
-- texto automático a la misma persona durante 15 minutos.

create or replace function public.claim_instagram_booking_auto_reply(
  p_source_external_id text,
  p_instagram_account_id text,
  p_participant_id text,
  p_source_type text,
  p_target_id text,
  p_reply_text text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if p_source_external_id is null or char_length(p_source_external_id) not between 3 and 600
     or p_instagram_account_id is null or char_length(p_instagram_account_id) not between 1 and 100
     or p_participant_id is null or char_length(p_participant_id) not between 1 and 100
     or p_source_type not in ('message', 'comment')
     or p_target_id is null or char_length(p_target_id) not between 1 and 600
     or p_reply_text is null or char_length(p_reply_text) not between 1 and 1000 then
    raise exception 'invalid_instagram_auto_reply_claim';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'instagram-auto-reply:' || p_instagram_account_id || ':' || p_participant_id,
    0
  ));

  if exists (
    select 1 from public.instagram_auto_replies
    where source_external_id = p_source_external_id
  ) then
    return null;
  end if;

  if exists (
    select 1 from public.instagram_auto_replies
    where instagram_account_id = p_instagram_account_id
      and participant_id = p_participant_id
      and reply_text = p_reply_text
      and created_at >= clock_timestamp() - interval '15 minutes'
      and status in ('processing', 'sent', 'indeterminate')
  ) then
    return null;
  end if;

  insert into public.instagram_auto_replies (
    source_external_id,
    instagram_account_id,
    participant_id,
    source_type,
    target_id,
    reply_text
  ) values (
    p_source_external_id,
    p_instagram_account_id,
    p_participant_id,
    p_source_type,
    p_target_id,
    p_reply_text
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.claim_instagram_booking_auto_reply(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_instagram_booking_auto_reply(text, text, text, text, text, text)
  to service_role;
