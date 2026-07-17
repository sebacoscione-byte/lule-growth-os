import {
  isClinicalOrProtocolLead,
  RETENTION_INACTIVITY_MONTHS,
  SECURITY_AUDIT_RETENTION_MONTHS,
  WHATSAPP_COST_EVENT_RETENTION_MONTHS,
  WHATSAPP_DEAD_LETTER_RETENTION_DAYS,
  WHATSAPP_DELIVERY_STATUS_RETENTION_DAYS,
  WHATSAPP_HANDOFF_MESSAGE_RETENTION_DAYS,
  WHATSAPP_ORPHAN_SESSION_RETENTION_DAYS,
  WHATSAPP_ORPHAN_CONSENT_RETENTION_MONTHS,
  WHATSAPP_PROCESSED_EVENT_RETENTION_DAYS,
  WHATSAPP_OUTBOUND_LEDGER_RETENTION_DAYS,
  WHATSAPP_SHADOW_RETENTION_DAYS,
  runDataRetentionSweep,
  type RetentionCandidate,
} from "./data-retention"

function candidate(overrides: Partial<RetentionCandidate> = {}): RetentionCandidate {
  return {
    id: "1",
    protocol_interest: false,
    protocol_name: null,
    status: "nuevo",
    ...overrides,
  }
}

describe("isClinicalOrProtocolLead", () => {
  it("es false para un lead administrativo/comercial común", () => {
    expect(isClinicalOrProtocolLead(candidate())).toBe(false)
  })

  it("es true si protocol_interest está en true", () => {
    expect(isClinicalOrProtocolLead(candidate({ protocol_interest: true }))).toBe(true)
  })

  it("es true si tiene un protocol_name cargado", () => {
    expect(isClinicalOrProtocolLead(candidate({ protocol_name: "Estudio X" }))).toBe(true)
  })

  it("es true si el status es elegible_protocolo", () => {
    expect(isClinicalOrProtocolLead(candidate({ status: "elegible_protocolo" }))).toBe(true)
  })

  it("no confunde un protocol_opt_out con seguir siendo clínico si ya no hay interés ni nombre", () => {
    // protocol_opt_out no es un campo que mire esta función a propósito: una vez que el paciente
    // se bajó del protocolo (protocol_interest=false, sin protocol_name), vuelve a tratarse como
    // un lead administrativo común para la retención.
    expect(isClinicalOrProtocolLead(candidate({ protocol_interest: false, protocol_name: null, status: "nuevo" }))).toBe(false)
  })
})

describe("RETENTION_INACTIVITY_MONTHS", () => {
  it("es 24 meses, según la política definida (DATA-02)", () => {
    expect(RETENTION_INACTIVITY_MONTHS).toBe(24)
  })

  it("define plazos cerrados para cola, shadow, estados y auditoría", () => {
    expect(WHATSAPP_PROCESSED_EVENT_RETENTION_DAYS).toBe(30)
    expect(WHATSAPP_DEAD_LETTER_RETENTION_DAYS).toBe(90)
    expect(WHATSAPP_SHADOW_RETENTION_DAYS).toBe(180)
    expect(WHATSAPP_DELIVERY_STATUS_RETENTION_DAYS).toBe(180)
    expect(WHATSAPP_HANDOFF_MESSAGE_RETENTION_DAYS).toBe(30)
    expect(WHATSAPP_OUTBOUND_LEDGER_RETENTION_DAYS).toBe(180)
    expect(SECURITY_AUDIT_RETENTION_MONTHS).toBe(24)
    expect(WHATSAPP_COST_EVENT_RETENTION_MONTHS).toBe(24)
    expect(WHATSAPP_ORPHAN_SESSION_RETENTION_DAYS).toBe(30)
    expect(WHATSAPP_ORPHAN_CONSENT_RETENTION_MONTHS).toBe(24)
  })
})

describe("runDataRetentionSweep", () => {
  it("ejecuta la limpieza operacional dentro de la misma barrida semanal", async () => {
    const rpc = jest.fn(async (name: string) => {
      if (name === "find_leads_past_retention_threshold") return { data: [], error: null }
      if (name === "run_whatsapp_operational_retention") {
        return { data: [{
          queue_processed_deleted: 4,
          queue_dead_letter_deleted: 1,
          shadow_deleted: 3,
          delivery_status_deleted: 2,
          outbound_ledger_deleted: 2,
          security_audit_deleted: 0,
          cost_events_deleted: 5,
          orphan_sessions_deleted: 2,
          orphan_consents_anonymized: 3,
          expired_leases_deleted: 1,
        }], error: null }
      }
      if (name === "run_whatsapp_handoff_message_retention") {
        return { data: 6, error: null }
      }
      throw new Error(`rpc inesperada: ${name}`)
    })
    const result = await runDataRetentionSweep({ rpc } as never)
    expect(result.operational).toEqual(expect.objectContaining({
      queue_processed_deleted: 4,
      shadow_deleted: 3,
      handoff_messages_deleted: 6,
    }))
    expect(rpc).toHaveBeenCalledWith("run_whatsapp_operational_retention", expect.objectContaining({
      p_processed_days: 30,
      p_shadow_days: 180,
      p_cost_event_months: 24,
      p_orphan_session_days: 30,
      p_orphan_consent_months: 24,
    }))
    expect(rpc).toHaveBeenCalledWith("run_whatsapp_handoff_message_retention", {
      p_retention_days: 30,
    })
  })

  it("sanea errores por candidato y nunca devuelve UUID ni mensaje crudo de DB", async () => {
    const sensitiveId = "11111111-1111-4111-8111-111111111111"
    const rpc = jest.fn(async (name: string) => {
      if (name === "find_leads_past_retention_threshold") {
        return { data: [candidate({ id: sensitiveId })], error: null }
      }
      if (name === "erase_lead") return { data: null, error: { message: "secret database detail" } }
      return { data: [], error: null }
    })
    const result = await runDataRetentionSweep({ rpc } as never)
    expect(result.errors).toContain("candidate_1:retention_erasure_failed")
    expect(JSON.stringify(result)).not.toContain(sensitiveId)
    expect(JSON.stringify(result)).not.toContain("secret database detail")
  })
})
