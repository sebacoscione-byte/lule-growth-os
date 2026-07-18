import {
  getReferralCode, findReferralCodeInfo, extractReferralCode, withReferralCode,
  withGeneralFallbackCode, allReferralCodes,
} from "./landing-referral-codes"

describe("getReferralCode", () => {
  it("devuelve el código correcto para una combinación real de landing+sede", () => {
    expect(getReferralCode("cardiologa-lanus", "cimel")?.code).toBe("LAN-CARD-01")
    expect(getReferralCode("cardiologa-lomas", "swiss")?.code).toBe("LOM-CARD-01")
    expect(getReferralCode("ecocardiograma-lanus", "cimel")?.code).toBe("LAN-ECO-01")
    expect(getReferralCode("google-maps", null)?.code).toBe("MAPS-GRAL-01")
  })

  it("devuelve null si la combinación no existe", () => {
    expect(getReferralCode("cardiologa-lanus", "swiss")).toBeNull()
    expect(getReferralCode("landing-inexistente", "cimel")).toBeNull()
  })

  it("cada landing+sede real tiene un código único (sin duplicados)", () => {
    const codes = allReferralCodes().map(info => info.code)
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe("findReferralCodeInfo", () => {
  it("encuentra la info a partir del código, sin importar mayúsculas/minúsculas", () => {
    expect(findReferralCodeInfo("lan-card-01")?.landingSlug).toBe("cardiologa-lanus")
    expect(findReferralCodeInfo("LAN-CARD-01")?.landingSlug).toBe("cardiologa-lanus")
    expect(findReferralCodeInfo("maps-gral-01")?.landingSlug).toBe("google-maps")
  })

  it("devuelve null para un código que no existe", () => {
    expect(findReferralCodeInfo("XXX-YYY-99")).toBeNull()
  })
})

describe("extractReferralCode", () => {
  it("extrae el código de un mensaje real con el formato esperado", () => {
    const text = "Hola, quiero pedir turno.\n\nRef: LAN-CARD-01"
    const result = extractReferralCode(text)
    expect(result.code).toBe("LAN-CARD-01")
    expect(result.cleanedText).toBe("Hola, quiero pedir turno.")
  })

  it("es tolerante a variaciones de mayúsculas y espaciado", () => {
    expect(extractReferralCode("hola ref:lan-card-01").code).toBe("LAN-CARD-01")
    expect(extractReferralCode("hola REF LAN-CARD-01").code).toBe("LAN-CARD-01")
  })

  it("devuelve null si no hay ningún código en el texto (mensaje editado/orgánico)", () => {
    const result = extractReferralCode("Hola, quiero pedir turno con la doctora")
    expect(result.code).toBeNull()
    expect(result.cleanedText).toBe("Hola, quiero pedir turno con la doctora")
  })

  it("no confunde un texto libre con un código real", () => {
    expect(extractReferralCode("mi numero de referencia es ABC-123").code).toBeNull()
  })
})

describe("withReferralCode / withGeneralFallbackCode", () => {
  it("agrega la referencia al final del mensaje cuando existe un código para esa landing+sede", () => {
    const result = withReferralCode("Hola, quiero turno.", "cardiologa-lanus", "cimel")
    expect(result).toContain("Hola, quiero turno.")
    expect(result).toContain("Ref: LAN-CARD-01")
  })

  it("no agrega nada si no hay código para esa combinación", () => {
    const result = withReferralCode("Hola, quiero turno.", "landing-inexistente", "cimel")
    expect(result).toBe("Hola, quiero turno.")
  })

  it("withGeneralFallbackCode siempre agrega el código compartido", () => {
    expect(withGeneralFallbackCode("Consultanos")).toBe("Consultanos\n\nRef: WEB-GRAL-01")
  })

  it("un mensaje con referencia, al extraerse, vuelve al texto original", () => {
    const original = "Hola, me gustaría pedir turno con la Dra. Lucía Chahin en CIMEL Lanús (martes). ¿Me pueden ayudar?"
    const withRef = withReferralCode(original, "cardiologa-lanus", "cimel")
    const { code, cleanedText } = extractReferralCode(withRef)
    expect(code).toBe("LAN-CARD-01")
    expect(cleanedText).toBe(original)
  })
})
