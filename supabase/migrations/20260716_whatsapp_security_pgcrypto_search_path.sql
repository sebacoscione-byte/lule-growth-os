-- Production hotfix: pgcrypto is installed in Supabase's trusted `extensions` schema.
-- These SECURITY DEFINER functions previously pinned search_path to `public`, so runtime calls to
-- hmac()/digest() failed with SQLSTATE 42883 and the WhatsApp enqueue trigger returned HTTP 503.
-- Put trusted schemas first and keep `public` only for the application tables referenced by name.

alter function public.account_whatsapp_outbound_delivery(text, text)
  set search_path to pg_catalog, extensions, public;
alter function public.block_erased_whatsapp_contact_write()
  set search_path to pg_catalog, extensions, public;
alter function public.create_whatsapp_erasure_tombstone(text, text)
  set search_path to pg_catalog, extensions, public;
alter function public.create_whatsapp_handoff(text, uuid, text, jsonb, integer, numeric, text)
  set search_path to pg_catalog, extensions, public;
alter function public.ensure_whatsapp_lead_core(text, text, text, boolean, boolean, text)
  set search_path to pg_catalog, extensions, public;
alter function public.erase_lead(uuid, text)
  set search_path to pg_catalog, extensions, public;
alter function public.is_whatsapp_erasure_event_suppressed(text, text, timestamp with time zone)
  set search_path to pg_catalog, extensions, public;
alter function public.is_whatsapp_erasure_identifier_suppressed(text, text)
  set search_path to pg_catalog, extensions, public;
alter function public.quarantine_whatsapp_ambiguous_delivery(text, text, text)
  set search_path to pg_catalog, extensions, public;
alter function public.recover_stale_whatsapp_outbound_intents()
  set search_path to pg_catalog, extensions, public;
alter function public.whatsapp_erasure_identifier_hmac(text, text)
  set search_path to pg_catalog, extensions, public;
