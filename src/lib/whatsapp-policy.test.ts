import { evaluateWhatsAppPolicy, WhatsAppPolicyDecisionSchema } from "./whatsapp-policy"

describe("separación NLU / policy", () => {
  it("ubica action, response_key y handoff exclusivamente en la decisión de política", () => {
    const decision = evaluateWhatsAppPolicy({ state: "routed", input_type: "text", text: "Hola" })

    expect(decision).toMatchObject({
      global_action: "continue",
      response_key: "greeting_existing",
      handoff: false,
      nlu: { primary_intent: "greeting" },
    })
    expect(decision.nlu).not.toHaveProperty("global_action")
    expect(decision.nlu).not.toHaveProperty("response_key")
    expect(decision.nlu).not.toHaveProperty("handoff")
  })

  it("rechaza texto de respuesta agregado a una decisión", () => {
    const decision = evaluateWhatsAppPolicy({ state: "routed", input_type: "text", text: "Hola" })
    expect(() => WhatsAppPolicyDecisionSchema.parse({
      ...decision,
      patient_reply: "texto no aprobado",
    })).toThrow()
  })
})
