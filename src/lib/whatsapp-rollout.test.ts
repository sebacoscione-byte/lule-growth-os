import {
  getWhatsAppPolicyCohortBucket,
  resolveWhatsAppPolicyRollout,
} from "./whatsapp-rollout"

const HASH_LOW = "0".repeat(64)
const HASH_HIGH = "f".repeat(64)

describe("rollout estable de policy v2", () => {
  it("solo acepta hashes SHA-256 y mantiene una cohorte estable", () => {
    expect(getWhatsAppPolicyCohortBucket(HASH_LOW)).toBe(0)
    expect(getWhatsAppPolicyCohortBucket(HASH_LOW)).toBe(0)
    expect(() => getWhatsAppPolicyCohortBucket("5491112345678")).toThrow()
  })

  it("queda completamente apagado por default", () => {
    expect(resolveWhatsAppPolicyRollout(HASH_LOW, {})).toMatchObject({
      served_by: "legacy",
      evaluate_shadow: false,
      reason: "disabled",
    })
  })

  it("usa shadow sin cambiar la respuesta solo cuando se habilita explícitamente", () => {
    expect(resolveWhatsAppPolicyRollout(HASH_LOW, {
      enabled: false,
      shadow_enabled: true,
      canary_percent: 0,
      kill_switch: false,
    })).toMatchObject({ served_by: "legacy", evaluate_shadow: true, reason: "shadow" })
  })

  it("sirve 0%, 10%, 50% y 100% por bucket estable", () => {
    const decide = (hash: string, canary_percent: number) => resolveWhatsAppPolicyRollout(hash, {
      enabled: true,
      shadow_enabled: true,
      canary_percent,
      kill_switch: false,
    }).served_by

    expect(decide(HASH_LOW, 0)).toBe("legacy")
    expect(decide(HASH_LOW, 10)).toBe("policy_v2")
    expect(decide(HASH_LOW, 50)).toBe("policy_v2")
    expect(decide(HASH_HIGH, 50)).toBe("legacy")
    expect(decide(HASH_HIGH, 100)).toBe("policy_v2")
  })

  it("el kill switch revierte a legacy y detiene shadow", () => {
    expect(resolveWhatsAppPolicyRollout(HASH_LOW, {
      enabled: true,
      shadow_enabled: true,
      canary_percent: 100,
      kill_switch: true,
    })).toMatchObject({ served_by: "legacy", evaluate_shadow: false, reason: "kill_switch" })
  })
})
