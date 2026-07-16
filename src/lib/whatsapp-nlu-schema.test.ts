import { BotNluSchema, WHATSAPP_NLU_SCHEMA_VERSION } from "./whatsapp-nlu-schema"

function validNlu() {
  return {
    schema_version: WHATSAPP_NLU_SCHEMA_VERSION,
    primary_intent: "greeting",
    secondary_intents: ["thanks"],
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
    confidence: 0.98,
    ambiguous: false,
  }
}

describe("BotNluSchema", () => {
  it("acepta exclusivamente una decisión estructurada", () => {
    expect(BotNluSchema.parse(validNlu())).toEqual(validNlu())
  })

  it("rechaza texto libre de respuesta y propiedades extra", () => {
    expect(() => BotNluSchema.parse({ ...validNlu(), patient_reply: "texto inventado" })).toThrow()
  })

  it("rechaza decisiones de política mezcladas en la salida de NLU", () => {
    expect(() => BotNluSchema.parse({ ...validNlu(), global_action: "continue" })).toThrow()
    expect(() => BotNluSchema.parse({ ...validNlu(), response_key: "greeting_existing" })).toThrow()
    expect(() => BotNluSchema.parse({ ...validNlu(), handoff: false })).toThrow()
  })

  it("rechaza intents secundarios no enumerados", () => {
    expect(() => BotNluSchema.parse({ ...validNlu(), secondary_intents: ["invented_intent"] })).toThrow()
  })

  it("rechaza entidades extra sensibles que el intake no necesita", () => {
    expect(() => BotNluSchema.parse({
      ...validNlu(),
      entities: { ...validNlu().entities, patient_age: 72 },
    })).toThrow()
  })
})
