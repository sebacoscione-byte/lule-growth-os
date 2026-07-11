-- ============================================================
-- Migración: eliminación auditable de datos de un paciente (DATA-02)
--
-- erase_lead(p_lead_id, p_performed_by) elimina, en una única transacción (una función plpgsql
-- es atómica: si algo falla a mitad de camino, todo se revierte):
--   - handoff_events y messages del lead (contienen texto/resumen identificable)
--   - anonimiza wa_id (no se puede dejar null, ambas columnas son not null) en
--     whatsapp_cost_events y consent_records, preservando la fila para no perder agregados
--     de costo/consentimiento históricos
--   - la fila de whatsapp_sessions con ese teléfono (no se puede anonimizar in-place: phone es
--     la clave única de la tabla)
--   - la fila de leads
-- data_erasure_log deja evidencia de que se ejecutó un borrado (quién y cuándo), sin conservar
-- ningún dato del paciente eliminado.
-- ============================================================

create table if not exists data_erasure_log (
  id uuid default uuid_generate_v4() primary key,
  lead_id uuid not null,
  performed_by text not null,
  performed_at timestamptz not null default now()
);

create index if not exists data_erasure_log_performed_at_idx on data_erasure_log(performed_at desc);

create or replace function erase_lead(p_lead_id uuid, p_performed_by text)
returns void as $$
declare
  v_phone text;
begin
  select phone into v_phone from leads where id = p_lead_id;
  if not found then
    raise exception 'lead % no encontrado', p_lead_id;
  end if;

  delete from handoff_events where lead_id = p_lead_id;
  delete from messages where lead_id = p_lead_id;
  update whatsapp_cost_events set wa_id = 'erased' where lead_id = p_lead_id;
  update consent_records set wa_id = 'erased' where lead_id = p_lead_id;

  -- `leads.phone` no tiene constraint unique (a diferencia de whatsapp_sessions.phone) — en
  -- teoria dos leads distintos podrian compartir telefono (ej. carga manual duplicada). Por eso
  -- solo se borra la sesion si no pertenece a otro lead, para no arrastrar datos de un paciente
  -- distinto al que se esta eliminando.
  if v_phone is not null then
    delete from whatsapp_sessions
    where phone = v_phone
      and (lead_id is null or lead_id = p_lead_id);
  end if;

  delete from leads where id = p_lead_id;

  insert into data_erasure_log (lead_id, performed_by) values (p_lead_id, p_performed_by);
end;
$$ language plpgsql;

alter table data_erasure_log enable row level security;

create policy "service_role_all_data_erasure_log"
  on data_erasure_log for all to service_role using (true) with check (true);
create policy "authenticated_read_data_erasure_log"
  on data_erasure_log for select to authenticated using (true);
