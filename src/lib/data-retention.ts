import type { SupabaseClient } from "@supabase/supabase-js"

// Política DATA-02 (docs/BACKLOG.md, definida por Seba 2026-07-12): leads sin actividad por más
// de 24 meses entran a la barrida de retención. El plazo es el mismo para todas las categorías —
// lo que cambia es qué pasa con cada una (ver isClinicalOrProtocolLead).
export const RETENTION_INACTIVITY_MONTHS = 24
const AUTO_RETENTION_ACTOR = "auto_retention_24m"

export interface RetentionCandidate {
  id: string
  protocol_interest: boolean
  protocol_name: string | null
  status: string
}

/**
 * Datos de participación en un protocolo de investigación clínica: se conservan sin límite
 * automático (plazo legal mínimo, al menos 10 años desde la última actuación) — nunca se borran
 * solos, a diferencia de un lead administrativo/comercial común. `isClinicalOrProtocolLead` es la
 * única fuente de verdad de esta clasificación (no duplicar el criterio en SQL).
 */
export function isClinicalOrProtocolLead(lead: RetentionCandidate): boolean {
  return lead.protocol_interest || lead.protocol_name !== null || lead.status === "elegible_protocolo"
}

export interface DataRetentionSweepResult {
  erased: number
  blocked: number
  errors: string[]
}

/**
 * Corre la política de retención sobre los leads inactivos hace más de RETENTION_INACTIVITY_MONTHS
 * (calculado en find_leads_past_retention_threshold, que ya excluye a los que ya están en
 * retention_hold): a los de protocolo/clínicos los bloquea para uso comercial sin borrar nada; al
 * resto los borra por completo reusando erase_lead (mismo mecanismo auditable que el botón manual
 * "Eliminar datos de este paciente").
 */
export async function runDataRetentionSweep(supabase: SupabaseClient): Promise<DataRetentionSweepResult> {
  const { data, error } = await supabase.rpc("find_leads_past_retention_threshold", {
    p_inactivity_months: RETENTION_INACTIVITY_MONTHS,
  })
  if (error) throw new Error(`No se pudieron buscar leads para la barrida de retención: ${error.message}`)

  let erased = 0
  let blocked = 0
  const errors: string[] = []

  for (const lead of (data ?? []) as RetentionCandidate[]) {
    try {
      if (isClinicalOrProtocolLead(lead)) {
        const { error: updateError } = await supabase
          .from("leads")
          .update({ consent_to_contact: false, retention_hold: true })
          .eq("id", lead.id)
        if (updateError) throw new Error(updateError.message)
        blocked++
      } else {
        const { error: eraseError } = await supabase.rpc("erase_lead", {
          p_lead_id: lead.id,
          p_performed_by: AUTO_RETENTION_ACTOR,
        })
        if (eraseError) throw new Error(eraseError.message)
        erased++
      }
    } catch (err) {
      errors.push(`lead=${lead.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { erased, blocked, errors }
}
