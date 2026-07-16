import { z } from "zod"

export const WhatsAppPolicyRolloutConfigSchema = z.object({
  enabled: z.boolean().default(false),
  shadow_enabled: z.boolean().default(false),
  canary_percent: z.number().int().min(0).max(100).default(0),
  kill_switch: z.boolean().default(false),
}).strict()

export const PrivacySafeConversationHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 conversation hash")

export type WhatsAppPolicyRolloutConfig = z.input<typeof WhatsAppPolicyRolloutConfigSchema>

export interface WhatsAppPolicyRolloutDecision {
  served_by: "legacy" | "policy_v2"
  evaluate_shadow: boolean
  cohort_bucket: number
  reason: "kill_switch" | "disabled" | "shadow" | "canary" | "outside_canary"
}

/** Bucket estable 0..99. Solo acepta un hash; no admite teléfono ni otro PII crudo. */
export function getWhatsAppPolicyCohortBucket(conversationHash: string): number {
  const safeHash = PrivacySafeConversationHashSchema.parse(conversationHash)
  return Number.parseInt(safeHash.slice(0, 8), 16) % 100
}

/**
 * Selección reversible de cohorte. Los defaults dejan v2 y shadow apagados;
 * cada modo requiere activación explícita y el kill switch revierte de inmediato.
 */
export function resolveWhatsAppPolicyRollout(
  conversationHash: string,
  rawConfig: WhatsAppPolicyRolloutConfig,
): WhatsAppPolicyRolloutDecision {
  const config = WhatsAppPolicyRolloutConfigSchema.parse(rawConfig)
  const cohortBucket = getWhatsAppPolicyCohortBucket(conversationHash)

  if (config.kill_switch) {
    return {
      served_by: "legacy",
      evaluate_shadow: false,
      cohort_bucket: cohortBucket,
      reason: "kill_switch",
    }
  }

  if (!config.enabled) {
    return {
      served_by: "legacy",
      evaluate_shadow: config.shadow_enabled,
      cohort_bucket: cohortBucket,
      reason: config.shadow_enabled ? "shadow" : "disabled",
    }
  }

  if (cohortBucket < config.canary_percent) {
    return {
      served_by: "policy_v2",
      evaluate_shadow: false,
      cohort_bucket: cohortBucket,
      reason: "canary",
    }
  }

  return {
    served_by: "legacy",
    evaluate_shadow: config.shadow_enabled,
    cohort_bucket: cohortBucket,
    reason: "outside_canary",
  }
}
