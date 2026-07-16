import { WHATSAPP_NLU_SCHEMA_VERSION } from "./whatsapp-nlu-schema"
import { createValidatedWhatsAppNluProvider } from "./whatsapp-nlu-provider"

const request = {
  state: "routed" as const,
  input_type: "text" as const,
  message: "Hola",
  known_slots: {},
  last_bot_action: "greeting_existing" as const,
}

function validNlu() {
  return {
    schema_version: WHATSAPP_NLU_SCHEMA_VERSION,
    primary_intent: "greeting",
    secondary_intents: [],
    entities: {
      service: "unknown",
      coverage_name: null,
      payment_mode: "unknown",
      preferred_location: "unknown",
      is_for_self: null,
    },
    safety: {
      current_symptoms_possible: false,
      negated_symptoms: false,
      historical_context: false,
      third_party_context: false,
      emergency_signal: "none",
    },
    missing_slots: [],
    confidence: 0.99,
    ambiguous: false,
  }
}

describe("adapter estricto de proveedor NLU", () => {
  it("es mockeable y devuelve solo BotNlu validado", async () => {
    const rawClassifier = jest.fn(async () => validNlu())
    const provider = createValidatedWhatsAppNluProvider(rawClassifier)

    await expect(provider.classify(request)).resolves.toEqual(validNlu())
    expect(rawClassifier).toHaveBeenCalledWith(request)
  })

  it("rechaza texto libre en lugar de NLU", async () => {
    const provider = createValidatedWhatsAppNluProvider(async () => "Hola, ¿en qué puedo ayudarte?")
    await expect(provider.classify(request)).rejects.toThrow()
  })

  it("rechaza action, response_key, handoff y respuestas mezcladas por el proveedor", async () => {
    const forbiddenFields = [
      { global_action: "continue" },
      { response_key: "greeting_existing" },
      { handoff: false },
      { patient_reply: "texto libre" },
    ]

    for (const forbidden of forbiddenFields) {
      const provider = createValidatedWhatsAppNluProvider(async () => ({ ...validNlu(), ...forbidden }))
      await expect(provider.classify(request)).rejects.toThrow()
    }
  })

  it("valida también el contexto mínimo antes de invocar al proveedor", async () => {
    const rawClassifier = jest.fn(async () => validNlu())
    const provider = createValidatedWhatsAppNluProvider(rawClassifier)

    await expect(provider.classify({
      ...request,
      // La firma pública es tipada, pero este cast verifica el borde runtime.
      secret: "no debe entrar al prompt",
    } as typeof request)).rejects.toThrow()
    expect(rawClassifier).not.toHaveBeenCalled()
  })
})
