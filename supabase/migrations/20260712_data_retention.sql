-- ============================================================
-- Migración: retención diferenciada de datos (DATA-02)
--
-- Política definida por Seba (2026-07-12):
--   - Leads que nunca se convirtieron en pacientes, o con solo datos administrativos/comerciales:
--     se anonimizan/eliminan tras 24 meses de inactividad (reusa erase_lead(), ver
--     20260711_data_erasure.sql).
--   - Datos de participación en protocolo de investigación (protocol_interest, protocol_name,
--     status = elegible_protocolo): NUNCA se borran automáticamente. Se conservan por el plazo
--     legal aplicable. En su lugar, tras 24 meses de inactividad se bloquea el uso comercial
--     (consent_to_contact = false) sin tocar el dato — retention_hold = true deja constancia de
--     por qué ese lead ya no se contacta más, sin haber sido borrado.
-- La clasificación clínica/protocolo real vive en código (isClinicalOrProtocolLead en
-- src/lib/data-retention.ts, con tests) — esta función SQL solo hace el filtro de inactividad
-- (requiere el join con messages, más simple en SQL) y devuelve los campos que esa función
-- necesita para decidir.
-- ============================================================

alter table leads add column if not exists retention_hold boolean not null default false;

comment on column leads.retention_hold is
  'true cuando el lead quedó bajo resguardo legal (datos de protocolo/investigación tras 24 meses de inactividad): no se contacta más, pero el dato no se borra.';

create or replace function find_leads_past_retention_threshold(p_inactivity_months int)
returns table (id uuid, protocol_interest boolean, protocol_name text, status text) as $$
  select l.id, l.protocol_interest, l.protocol_name, l.status
  from leads l
  where l.retention_hold = false
    and greatest(
      l.updated_at,
      coalesce((select max(m.created_at) from messages m where m.lead_id = l.id), l.updated_at)
    ) < now() - (p_inactivity_months || ' months')::interval
$$ language sql stable;
