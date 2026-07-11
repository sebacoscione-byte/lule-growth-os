import { getServiceDb } from "@/lib/supabase/service"

/**
 * Elimina un lead y sus datos relacionados (DATA-02): mensajes y derivaciones a humano se borran
 * (contienen texto/resumen identificable); los eventos de costo y de consentimiento se conservan
 * pero con el teléfono anonimizado (no se puede dejar null, son columnas `not null`), para no
 * perder agregados históricos de costo/consentimiento; la sesión de WhatsApp de ese teléfono y el
 * lead mismo se eliminan. Todo corre en una sola transacción vía la función `erase_lead` de
 * Postgres (migración `20260711_data_erasure.sql`) — si algo falla a mitad de camino, no queda un
 * estado a medio borrar.
 *
 * Queda registro en `data_erasure_log` (quién y cuándo) sin conservar ningún dato del paciente.
 */
export async function eraseLead(leadId: string, performedBy: string): Promise<void> {
  const db = getServiceDb()
  const { error } = await db.rpc("erase_lead", { p_lead_id: leadId, p_performed_by: performedBy })
  if (error) throw new Error(`Error eliminando datos del lead ${leadId}: ${error.message}`)
}
