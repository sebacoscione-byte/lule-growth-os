import { classifyWhatsAppIntent } from "@/lib/ai"
import { isEmergencyMessage } from "@/lib/medical-safety"
import type { WhatsAppAiProvider, WhatsAppIntent } from "@/types"

export interface IntakeExtraction {
  motivo: "turno" | "estudio" | "protocolo" | null
  obraSocial: string | null
  edad: number | null
  sede: "cimel_lanus" | "swiss_lomas" | "hospital_britanico" | null
  notas: string | null
}

/**
 * Extrae del primer mensaje combinado (motivo + cobertura + edad + sede + sintomas/estudios) todo lo
 * que el paciente haya contestado de una — nunca vuelve a preguntar lo que ya vino en este bloque.
 * Deterministico a proposito (sin IA): tiene que ser gratis y rapido, se corre en cada mensaje entrante.
 */
export function extractIntake(text: string, knownObrasSociales: string[] = []): IntakeExtraction {
  const lower = text.toLowerCase()

  let motivo: IntakeExtraction["motivo"] = null
  if (/\bprotocolo\b|investigaci[oó]n/.test(lower)) motivo = "protocolo"
  else if (/ecocardiograma|electro(cardiograma)?|\bestudio\b/.test(lower)) motivo = "estudio"
  else if (/turno|consulta|atenderme|atenci[oó]n/.test(lower)) motivo = "turno"

  let obraSocial: string | null = null
  if (/particular|sin cobertura|no tengo obra social|no tengo cobertura|no tengo prepaga/.test(lower)) {
    obraSocial = "Particular / sin cobertura"
  } else {
    const match = knownObrasSociales.find(os => lower.includes(os.toLowerCase()))
    if (match) obraSocial = match
  }

  let edad: number | null = null
  const edadMatch = lower.match(/(\d{1,3})\s*(años|anos|añitos)/) ?? lower.match(/tengo\s+(\d{1,3})\b/)
  if (edadMatch) {
    const parsed = parseInt(edadMatch[1], 10)
    if (parsed > 0 && parsed < 120) edad = parsed
  }

  let sede: IntakeExtraction["sede"] = null
  if (/cimel|lan[uú]s|martes/.test(lower)) sede = "cimel_lanus"
  else if (/brit[aá]nico|miercoles|mi[eé]rcoles/.test(lower)) sede = "hospital_britanico"
  else if (/swiss|lomas|viernes/.test(lower)) sede = "swiss_lomas"

  return { motivo, obraSocial, edad, sede, notas: text.trim() || null }
}

const DETERMINISTIC_RULES: Array<{ intent: WhatsAppIntent; test: RegExp }> = [
  { intent: "cancelar_reprogramar", test: /cancelar|reprogramar|cambiar (el|mi) turno|no puedo ir/ },
  { intent: "hablar_con_humano", test: /hablar con (alguien|una persona|un humano)|atienda una persona|comunicarme con (la )?(secretaria|recepci[oó]n)/ },
  { intent: "derivar_protocolo", test: /protocolo|estudio de investigaci[oó]n|investigaci[oó]n cl[ií]nica/ },
  { intent: "consultar_cobertura", test: /obra social|obras sociales|cobertura|prepaga|pami|aceptan/ },
  { intent: "ubicacion_horarios", test: /horario|direcci[oó]n|donde queda|d[oó]nde queda|ubicaci[oó]n|que d[ií]a|qu[eé] d[ií]a/ },
  { intent: "estudios_cardiologicos", test: /ecocardiograma|electro(cardiograma)?|pr[aá]ctica|qu[eé] hace|que hace/ },
  { intent: "pedir_turno", test: /turno|sacar turno|pedir turno|consulta/ },
]

export function classifyIntentDeterministic(text: string): WhatsAppIntent | null {
  const lower = text.toLowerCase()
  if (isEmergencyMessage(lower)) return "urgencia_medica"
  const match = DETERMINISTIC_RULES.find(rule => rule.test.test(lower))
  return match?.intent ?? null
}

const UNIMPLEMENTED_PROVIDERS: WhatsAppAiProvider[] = ["openai", "otro_llm", "meta_business_agent"]

/**
 * Reglas primero, siempre. La IA solo entra como respaldo cuando nada matchea, y devuelve un enum
 * cerrado — nunca texto libre. `provider` viene de app_config.whatsapp_settings.ai_provider: "sin_ia"
 * desactiva el respaldo (default, para no sumar costo de IA); "gemini"/"anthropic" usan el proveedor
 * ya configurado globalmente en ai.ts; el resto son opciones de interfaz todavía no implementadas.
 */
export async function classifyIntent(text: string, provider: WhatsAppAiProvider): Promise<WhatsAppIntent> {
  const deterministic = classifyIntentDeterministic(text)
  if (deterministic) return deterministic
  if (provider === "sin_ia") return "otro_no_entendido"
  if (UNIMPLEMENTED_PROVIDERS.includes(provider)) {
    console.error(`Proveedor de IA "${provider}" seleccionado en Configuración pero todavía no está implementado.`)
    return "otro_no_entendido"
  }
  try {
    return await classifyWhatsAppIntent(text)
  } catch {
    return "otro_no_entendido"
  }
}

export const INTENT_REPLIES: Partial<Record<WhatsAppIntent, string>> = {
  hablar_con_humano: "Te derivamos con una persona del equipo de la Dra. Lucía Chahin, te va a contactar a la brevedad.",
  cancelar_reprogramar: "Para cancelar o reprogramar tu turno, comunicate directamente con la institución donde lo sacaste — nosotros no gestionamos la agenda.",
  otro_no_entendido: "No estoy seguro de haber entendido tu consulta. ¿Podés reformularla o preferís hablar con una persona del equipo?",
}

export type ProtocolButtonReply = "opt_in" | "opt_out"

// Textos exactos de los botones del template invitacion_protocolo (WhatsApp Manager).
// Son botones de respuesta rapida (tap, no texto libre), asi que el match exacto es seguro.
const PROTOCOL_OPT_OUT_BUTTON_TEXT = "no, gracias"
const PROTOCOL_OPT_IN_BUTTON_TEXT = "sí, quiero más información"

export function classifyProtocolButtonReply(text: string): ProtocolButtonReply | null {
  const lower = text.toLowerCase().trim()
  if (lower === PROTOCOL_OPT_OUT_BUTTON_TEXT) return "opt_out"
  if (lower === PROTOCOL_OPT_IN_BUTTON_TEXT) return "opt_in"
  return null
}
