jest.mock("@/lib/whatsapp", () => ({ sendTemplate: jest.fn().mockResolvedValue({}) }))
jest.mock("@/lib/whatsapp-templates", () => ({
  getApprovedTemplate: jest.fn(),
}))
jest.mock("@/lib/whatsapp-settings", () => ({
  getWhatsAppSettings: jest.fn(),
}))

import type { SupabaseClient } from "@supabase/supabase-js"
import { runWhatsAppFollowup } from "@/lib/whatsapp-followup"
import { sendTemplate } from "@/lib/whatsapp"
import { getApprovedTemplate } from "@/lib/whatsapp-templates"
import { getWhatsAppSettings } from "@/lib/whatsapp-settings"
import { FOLLOWUP_CONSENT_PURPOSE, FOLLOWUP_CONSENT_VERSION } from "@/lib/whatsapp-consent"

function thenableQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {}
  for (const method of ["select", "lte", "in", "eq", "not", "is", "order", "limit"]) {
    query[method] = jest.fn(() => query)
  }
  query.maybeSingle = jest.fn().mockResolvedValue(result)
  query.then = (resolve: (value: unknown) => unknown) => resolve(result)
  return query
}

function mockSupabase(options: {
  leads?: unknown[]
  leadsError?: unknown
  consent?: Record<string, unknown> | null
  consentError?: unknown
  session?: Record<string, unknown> | null
  claimResult?: boolean
  claimError?: unknown
  completeResult?: boolean
  completeError?: unknown
}) {
  const leadQuery = thenableQuery({ data: options.leads ?? [], error: options.leadsError ?? null })
  const consentQuery = thenableQuery({ data: options.consent ?? null, error: options.consentError ?? null })
  const sessionQuery = thenableQuery({ data: options.session ?? null, error: null })
  const leadUpdateEq = jest.fn().mockResolvedValue({ data: null, error: null })
  const leadUpdate = jest.fn(() => ({ eq: leadUpdateEq }))
  const rpc = jest.fn((name: string) => {
    if (name === "claim_whatsapp_followup") {
      return Promise.resolve({ data: options.claimResult ?? true, error: options.claimError ?? null })
    }
    if (name === "complete_whatsapp_followup") {
      return Promise.resolve({ data: options.completeResult ?? true, error: options.completeError ?? null })
    }
    throw new Error(`rpc inesperada: ${name}`)
  })

  const leadsTable = {
    select: (leadQuery.select as jest.Mock),
    update: leadUpdate,
  }
  const consentTable = { select: (consentQuery.select as jest.Mock) }
  const sessionTable = { select: (sessionQuery.select as jest.Mock) }
  const from = jest.fn((table: string) => {
    if (table === "leads") return leadsTable
    if (table === "consent_records") return consentTable
    if (table === "whatsapp_sessions") return sessionTable
    throw new Error(`tabla inesperada: ${table}`)
  })

  return {
    client: { from, rpc } as unknown as SupabaseClient,
    from,
    leadQuery,
    consentQuery,
    sessionQuery,
    leadUpdate,
    leadUpdateEq,
    rpc,
  }
}

const APPROVED_TEMPLATE = {
  name: "recontacto_incompleto",
  language: "es_AR",
}
const LEAD = { id: "lead-1", name: "Paciente", phone: "5491100000000" }
const NOW = new Date("2026-07-16T15:00:00.000Z")

beforeEach(() => {
  jest.clearAllMocks()
  ;(getWhatsAppSettings as jest.Mock).mockResolvedValue({
    bot_enabled: true,
    enable_service_message_charging: false,
  })
  ;(getApprovedTemplate as jest.Mock).mockResolvedValue(APPROVED_TEMPLATE)
})

describe("runWhatsAppFollowup", () => {
  it("respeta el kill switch global antes de consultar templates o pacientes", async () => {
    ;(getWhatsAppSettings as jest.Mock).mockResolvedValue({
      bot_enabled: false,
      enable_service_message_charging: false,
    })
    const { client, from } = mockSupabase({})

    await expect(runWhatsAppFollowup(client, NOW)).resolves.toEqual({
      sent: 0,
      skipped: 0,
      errors: [],
    })
    expect(getApprovedTemplate).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it("no intenta texto libre si falta el template aprobado", async () => {
    ;(getApprovedTemplate as jest.Mock).mockResolvedValue(null)
    const { client, from } = mockSupabase({})

    const result = await runWhatsAppFollowup(client, NOW)

    expect(result.sent).toBe(0)
    expect(result.errors[0]).toMatch(/Template .* no est[aá] aprobado/i)
    expect(sendTemplate).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it("solo envia con opt-in vigente para la finalidad de seguimiento", async () => {
    const mocked = mockSupabase({
      leads: [LEAD],
      consent: { consented: true, version: FOLLOWUP_CONSENT_VERSION },
      session: { last_inbound_at: null, entry_point: "organic", bot_paused: false, state: "derivado" },
    })

    await expect(runWhatsAppFollowup(mocked.client, NOW)).resolves.toEqual({
      sent: 1,
      skipped: 0,
      errors: [],
    })

    expect(mocked.leadQuery.eq).toHaveBeenCalledWith("consent_to_contact", true)
    expect(mocked.leadQuery.eq).toHaveBeenCalledWith("requires_human", false)
    expect(mocked.leadQuery.eq).toHaveBeenCalledWith("whatsapp_followup_status", "pending")
    expect(mocked.leadQuery.is).toHaveBeenCalledWith("whatsapp_followup_sent_at", null)
    expect(mocked.consentQuery.eq).toHaveBeenCalledWith("purpose", FOLLOWUP_CONSENT_PURPOSE)
    expect(mocked.consentQuery.eq).toHaveBeenCalledWith("wa_id", LEAD.phone)
    expect(sendTemplate).toHaveBeenCalledWith(
      LEAD.phone,
      "recontacto_incompleto",
      "es_AR",
      [LEAD.name],
      expect.objectContaining({ leadId: LEAD.id, windowState: "closed" })
    )
    expect(mocked.rpc).toHaveBeenCalledWith("claim_whatsapp_followup", {
      p_lead_id: LEAD.id,
      p_now: NOW.toISOString(),
    })
    expect(mocked.rpc).toHaveBeenCalledWith("complete_whatsapp_followup", {
      p_lead_id: LEAD.id,
      p_outcome: "sent",
      p_now: NOW.toISOString(),
    })
  })

  it.each([
    ["rechazado", { consented: false, version: FOLLOWUP_CONSENT_VERSION }],
    ["version vieja", { consented: true, version: "appointment_followup_v0" }],
    ["sin registro", null],
  ])("omite seguimiento con consentimiento %s", async (_label, consent) => {
    const { client } = mockSupabase({ leads: [LEAD], consent })

    await expect(runWhatsAppFollowup(client, NOW)).resolves.toEqual({
      sent: 0,
      skipped: 1,
      errors: [],
    })
    expect(sendTemplate).not.toHaveBeenCalled()
  })

  it.each([
    ["bot_paused", { bot_paused: true, state: "derivado" }],
    ["handoff_pending", { bot_paused: false, state: "handoff_pending" }],
    ["human_active", { bot_paused: false, state: "human_active" }],
  ])("no interrumpe una conversacion humana: %s", async (_label, session) => {
    const { client } = mockSupabase({
      leads: [LEAD],
      consent: { consented: true, version: FOLLOWUP_CONSENT_VERSION },
      session,
    })

    await expect(runWhatsAppFollowup(client, NOW)).resolves.toEqual({
      sent: 0,
      skipped: 1,
      errors: [],
    })
    expect(sendTemplate).not.toHaveBeenCalled()
  })

  it("sanea errores de proveedor y no incluye telefono ni contenido sensible", async () => {
    const { client } = mockSupabase({
      leads: [LEAD],
      consent: { consented: true, version: FOLLOWUP_CONSENT_VERSION },
      session: { bot_paused: false, state: "derivado" },
    })
    ;(sendTemplate as jest.Mock).mockRejectedValue(
      new Error(`token secreto al enviar a ${LEAD.phone}`)
    )

    const result = await runWhatsAppFollowup(client, NOW)

    expect(result).toEqual({ sent: 0, skipped: 1, errors: ["candidate_1:followup_send_failed"] })
    expect(JSON.stringify(result)).not.toContain(LEAD.phone)
    expect(JSON.stringify(result)).not.toContain(LEAD.id)
    expect(JSON.stringify(result)).not.toContain("token secreto")
  })

  it("no envía si otra ejecución ya reclamó el seguimiento", async () => {
    const { client } = mockSupabase({
      leads: [LEAD],
      consent: { consented: true, version: FOLLOWUP_CONSENT_VERSION },
      session: { bot_paused: false, state: "derivado" },
      claimResult: false,
    })

    await expect(runWhatsAppFollowup(client, NOW)).resolves.toEqual({ sent: 0, skipped: 1, errors: [] })
    expect(sendTemplate).not.toHaveBeenCalled()
  })
})
