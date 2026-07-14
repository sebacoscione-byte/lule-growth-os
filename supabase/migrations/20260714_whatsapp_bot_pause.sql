-- ============================================================
-- Pausar el bot de WhatsApp por conversación cuando el equipo
-- responde a mano desde el Inbox, para que no se pisen los dos.
-- ============================================================

alter table whatsapp_sessions
  add column if not exists bot_paused boolean not null default false;
