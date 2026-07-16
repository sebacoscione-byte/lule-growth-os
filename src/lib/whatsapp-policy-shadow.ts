import { z } from "zod"
import {
  WHATSAPP_NLU_SCHEMA_VERSION,
  WhatsAppIntentSchema,
} from "@/lib/whatsapp-nlu-schema"
import {
  WHATSAPP_POLICY_VERSION,
  WhatsAppGlobalActionSchema,
  WhatsAppPolicyInputTypeSchema,
  WhatsAppPolicyStateSchema,
  WhatsAppResponseKeySchema,
  type WhatsAppPolicyDecision,
} from "@/lib/whatsapp-policy"
import { WHATSAPP_RESPONSE_CATALOG_VERSION } from "@/lib/whatsapp-response-catalog"
import { PrivacySafeConversationHashSchema } from "@/lib/whatsapp-rollout"

const ComparableDecisionSchema = z.object({
  action: WhatsAppGlobalActionSchema,
  intent: WhatsAppIntentSchema,
  response_key: WhatsAppResponseKeySchema,
  handoff: z.boolean(),
}).strict()

export type ComparableWhatsAppDecision = z.infer<typeof ComparableDecisionSchema>

export const WhatsAppPolicyShadowRecordSchema = z.object({
  event_hash: PrivacySafeConversationHashSchema,
  conversation_hash: PrivacySafeConversationHashSchema,
  initial_state: WhatsAppPolicyStateSchema,
  input_type: WhatsAppPolicyInputTypeSchema,
  legacy_action: WhatsAppGlobalActionSchema,
  legacy_intent: WhatsAppIntentSchema,
  legacy_response_key: WhatsAppResponseKeySchema,
  legacy_handoff: z.boolean(),
  candidate_action: WhatsAppGlobalActionSchema,
  candidate_intent: WhatsAppIntentSchema,
  candidate_response_key: WhatsAppResponseKeySchema,
  candidate_handoff: z.boolean(),
  action_match: z.boolean(),
  intent_match: z.boolean(),
  response_match: z.boolean(),
  handoff_match: z.boolean(),
  policy_version: z.literal(WHATSAPP_POLICY_VERSION),
  nlu_schema_version: z.literal(WHATSAPP_NLU_SCHEMA_VERSION),
  catalog_version: z.literal(WHATSAPP_RESPONSE_CATALOG_VERSION),
  rollout_bucket: z.number().int().min(0).max(99),
  served_by: z.enum(["legacy", "policy_v2"]),
}).strict()

export type WhatsAppPolicyShadowRecord = z.infer<typeof WhatsAppPolicyShadowRecordSchema>

interface BuildShadowRecordInput {
  event_hash: string
  conversation_hash: string
  initial_state: z.infer<typeof WhatsAppPolicyStateSchema>
  input_type: z.infer<typeof WhatsAppPolicyInputTypeSchema>
  legacy: ComparableWhatsAppDecision
  candidate: WhatsAppPolicyDecision
  rollout_bucket: number
  served_by: "legacy" | "policy_v2"
}

/** Compara decisiones sin conservar el mensaje ni identificadores reversibles. */
export function buildWhatsAppPolicyShadowRecord(input: BuildShadowRecordInput): WhatsAppPolicyShadowRecord {
  const legacy = ComparableDecisionSchema.parse(input.legacy)
  const candidate = {
    action: input.candidate.global_action,
    intent: input.candidate.nlu.primary_intent,
    response_key: input.candidate.response_key,
    handoff: input.candidate.handoff,
  }

  return WhatsAppPolicyShadowRecordSchema.parse({
    event_hash: input.event_hash,
    conversation_hash: input.conversation_hash,
    initial_state: input.initial_state,
    input_type: input.input_type,
    legacy_action: legacy.action,
    legacy_intent: legacy.intent,
    legacy_response_key: legacy.response_key,
    legacy_handoff: legacy.handoff,
    candidate_action: candidate.action,
    candidate_intent: candidate.intent,
    candidate_response_key: candidate.response_key,
    candidate_handoff: candidate.handoff,
    action_match: legacy.action === candidate.action,
    intent_match: legacy.intent === candidate.intent,
    response_match: legacy.response_key === candidate.response_key,
    handoff_match: legacy.handoff === candidate.handoff,
    policy_version: WHATSAPP_POLICY_VERSION,
    nlu_schema_version: input.candidate.nlu.schema_version,
    catalog_version: WHATSAPP_RESPONSE_CATALOG_VERSION,
    rollout_bucket: input.rollout_bucket,
    served_by: input.served_by,
  })
}
