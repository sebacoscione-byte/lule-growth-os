import {
  loadWhatsAppGoldenDataset,
  parseWhatsAppGoldenDataset,
  simulateWhatsAppPolicyDataset,
} from "./whatsapp-policy-dataset"

describe("dataset dorado del bot de WhatsApp", () => {
  it("carga y valida los 180 casos del CSV", () => {
    const cases = loadWhatsAppGoldenDataset()
    expect(cases).toHaveLength(180)
    expect(new Set(cases.map(testCase => testCase.id)).size).toBe(180)
  })

  it("logra 180/180 en action, intent, response_key y handoff", () => {
    const simulation = simulateWhatsAppPolicyDataset(loadWhatsAppGoldenDataset())
    expect(simulation.discrepancies).toEqual([])
    expect(simulation).toMatchObject({ total: 180, passed: 180, failed: 0 })
  })

  it("rechaza headers alterados, booleanos libres y IDs duplicados", () => {
    expect(() => parseWhatsAppGoldenDataset("bad,header\n1,2\n")).toThrow("headers")

    const header = "id,group,initial_state,input_type,user_text,expected_global_action,expected_primary_intent,expected_response_key,expected_handoff,notes"
    const row = "x,g,routed,text,Hola,continue,greeting,greeting_existing,yes,"
    expect(() => parseWhatsAppGoldenDataset(`${header}\n${row}\n`)).toThrow()

    const valid = "x,g,routed,text,Hola,continue,greeting,greeting_existing,false,"
    expect(() => parseWhatsAppGoldenDataset(`${header}\n${valid}\n${valid}\n`)).toThrow("Duplicate")
  })
})
