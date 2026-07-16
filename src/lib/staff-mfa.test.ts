import {
  getMfaAccessDecision,
  getMfaGateDecision,
  mfaErrorMessage,
  normalizeTotpCode,
  safeMfaNextPath,
  staffRoleLabel,
  totpQrDataUrl,
  unverifiedTotpFactors,
  verifiedTotpFactors,
} from "@/lib/staff-mfa"

describe("getMfaAccessDecision", () => {
  it("permite una sesión AAL2", () => {
    expect(getMfaAccessDecision({ currentLevel: "aal2", nextLevel: "aal2" })).toBe("allow")
  })

  it("requiere step-up cuando existe un factor verificado", () => {
    expect(getMfaAccessDecision({ currentLevel: "aal1", nextLevel: "aal2" })).toBe("step_up")
  })

  it("permite AAL1 solamente cuando no hay un nivel superior disponible", () => {
    expect(getMfaAccessDecision({ currentLevel: "aal1", nextLevel: "aal1" })).toBe("allow")
  })

  it.each([null, undefined, { currentLevel: null, nextLevel: null }, { currentLevel: "aal3", nextLevel: "aal3" }])(
    "falla cerrado ante niveles ausentes o desconocidos",
    snapshot => {
      expect(getMfaAccessDecision(snapshot)).toBe("unavailable")
    }
  )
})

describe("getMfaGateDecision", () => {
  it("fuerza alta de factor si la política requiere MFA y la cuenta no tiene uno", () => {
    expect(getMfaGateDecision({ currentLevel: "aal1", nextLevel: "aal1" }, true)).toBe("setup")
  })

  it("no fuerza alta antes de activar la política", () => {
    expect(getMfaGateDecision({ currentLevel: "aal1", nextLevel: "aal1" }, false)).toBe("allow")
  })

  it("siempre exige challenge a una cuenta que ya optó por MFA", () => {
    expect(getMfaGateDecision({ currentLevel: "aal1", nextLevel: "aal2" }, false)).toBe("step_up")
  })
})

describe("safeMfaNextPath", () => {
  it("conserva rutas internas con query", () => {
    expect(safeMfaNextPath("/leads?status=new")).toBe("/leads?status=new")
  })

  it.each([
    "https://evil.example/path",
    "//evil.example/path",
    "/\\evil.example/path",
    "/login",
    "/login/mfa?next=/dashboard",
    "/seguridad/mfa",
    "/seguridad/mfa?next=/leads",
    "dashboard",
  ])("rechaza destinos inseguros o cíclicos", value => {
    expect(safeMfaNextPath(value)).toBe("/dashboard")
  })
})

describe("helpers TOTP", () => {
  it("acepta sólo códigos TOTP de seis dígitos", () => {
    expect(normalizeTotpCode("123 456")).toBe("123456")
    expect(normalizeTotpCode("123-456")).toBe("123456")
    expect(normalizeTotpCode("12345a")).toBeNull()
    expect(normalizeTotpCode("1234567")).toBeNull()
  })

  it("separa factores verificados e incompletos sin aceptar otros tipos", () => {
    const factors = [
      { id: "verified", factor_type: "totp", status: "verified" },
      { id: "pending", factor_type: "totp", status: "unverified" },
      { id: "phone", factor_type: "phone", status: "verified" },
    ]
    expect(verifiedTotpFactors(factors).map(factor => factor.id)).toEqual(["verified"])
    expect(unverifiedTotpFactors(factors).map(factor => factor.id)).toEqual(["pending"])
  })

  it("convierte únicamente SVG de Supabase a un data URL de imagen", () => {
    expect(totpQrDataUrl("<svg><path /></svg>")).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(totpQrDataUrl("data:image/svg+xml;utf-8,%3Csvg%3E%3C/svg%3E")).toMatch(/^data:image\/svg\+xml/)
    expect(totpQrDataUrl("javascript:alert(1)")).toBeNull()
  })
})

describe("staffRoleLabel", () => {
  it("sólo muestra roles cerrados y no metadata arbitraria", () => {
    expect(staffRoleLabel("doctor")).toBe("Profesional médica")
    expect(staffRoleLabel("administrador-total")).toBe("Rol pendiente de asignación")
    expect(staffRoleLabel(null)).toBe("Rol pendiente de asignación")
  })
})

describe("mfaErrorMessage", () => {
  it("traduce códigos conocidos sin devolver mensajes del proveedor", () => {
    expect(mfaErrorMessage({ code: "mfa_verification_failed" })).toContain("código no es válido")
    expect(mfaErrorMessage({ code: "over_request_rate_limit" })).toContain("demasiados intentos")
    expect(mfaErrorMessage({ code: "provider_secret_here" })).not.toContain("provider_secret_here")
  })
})
