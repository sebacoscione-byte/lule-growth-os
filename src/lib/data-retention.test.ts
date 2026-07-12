import { isClinicalOrProtocolLead, RETENTION_INACTIVITY_MONTHS, type RetentionCandidate } from "./data-retention"

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
})
