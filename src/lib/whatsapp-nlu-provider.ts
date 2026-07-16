import { z } from "zod"
import {
  BotNluSchema,
  WhatsAppLocationEntitySchema,
  WhatsAppServiceEntitySchema,
  type BotNlu,
} from "@/lib/whatsapp-nlu-schema"
import {
  WhatsAppPolicyStateSchema,
  WhatsAppResponseKeySchema,
} from "@/lib/whatsapp-policy"

/** Contexto mínimo permitido para un clasificador NLU externo. */
export const WhatsAppNluRequestSchema = z.object({
  state: WhatsAppPolicyStateSchema,
  input_type: z.enum(["text", "button", "list"]),
  message: z.string().min(1).max(4000),
  known_slots: z.object({
    service: WhatsAppServiceEntitySchema.optional(),
    coverage_name: z.string().trim().min(1).max(100).optional(),
    preferred_location: WhatsAppLocationEntitySchema.optional(),
    is_for_self: z.boolean().optional(),
  }).strict(),
  last_bot_action: WhatsAppResponseKeySchema.nullable(),
}).strict()

export type WhatsAppNluRequest = z.infer<typeof WhatsAppNluRequestSchema>

export interface WhatsAppNluProvider {
  classify(request: WhatsAppNluRequest): Promise<BotNlu>
}

export type RawWhatsAppNluClassifier = (request: WhatsAppNluRequest) => Promise<unknown>

/**
 * Adapter inyectable para Structured Outputs/tool use. Valida entrada y salida
 * en ambos bordes. Un proveedor que devuelva texto, una respuesta al paciente
 * o cualquier decisión de política es rechazado por el schema estricto.
 *
 * No instancia SDKs ni realiza llamadas por sí mismo.
 */
export function createValidatedWhatsAppNluProvider(
  rawClassifier: RawWhatsAppNluClassifier,
): WhatsAppNluProvider {
  return {
    async classify(rawRequest: WhatsAppNluRequest): Promise<BotNlu> {
      const request = WhatsAppNluRequestSchema.parse(rawRequest)
      const rawNlu = await rawClassifier(request)
      return BotNluSchema.parse(rawNlu)
    },
  }
}
