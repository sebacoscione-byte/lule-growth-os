import { classifyWhatsAppIntent } from "@/lib/ai"
import { isEmergencyMessage } from "@/lib/medical-safety"
import type { WhatsAppLocationConfig } from "@/lib/whatsapp-location-config"
import type { WhatsAppAiProvider, WhatsAppIntent } from "@/types"

export interface IntakeExtraction {
  motivo: "turno" | "estudio" | "protocolo" | null
  obraSocial: string | null
  sede: "cimel_lanus" | "swiss_lomas" | "hospital_britanico" | null
}

/**
 * Extrae del primer mensaje administrativo (motivo + cobertura + sede) todo lo
 * que el paciente haya contestado de una — nunca vuelve a preguntar lo que ya vino en este bloque.
 * Deterministico a proposito (sin IA): tiene que ser gratis y rapido, se corre en cada mensaje entrante.
 * No devuelve una copia libre del texto: el mensaje ya se conserva una sola vez en `messages`.
 */
export function extractIntake(
  text: string,
  knownObrasSociales: string[] = [],
  knownLocations: WhatsAppLocationConfig[] = []
): IntakeExtraction {
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

  const normalize = (value: string) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
  const normalizedText = normalize(text)
  const genericTokens = new Set(["centro", "clinica", "hospital", "medical", "medico", "salud"])
  const matchedLocation = knownLocations.find(location => {
    const normalizedName = normalize(location.name)
    const normalizedId = normalize(location.id.replaceAll("_", " "))
    const tokens = normalizedName
      .split(/\s+/)
      .filter(token => token.length >= 5 && !genericTokens.has(token))
    const day = location.day ? normalize(location.day) : null
    return normalizedText.includes(normalizedName)
      || normalizedText.includes(normalizedId)
      || tokens.some(token => normalizedText.includes(token))
      || Boolean(day && normalizedText.includes(day))
  })
  const sede: IntakeExtraction["sede"] = matchedLocation?.id ?? null

  return { motivo, obraSocial, sede }
}

// Ola 4 (incidente real 2026-07-14, David Portas): el patrón original solo matcheaba la frase
// exacta "hablar con alguien/una persona/un humano" -- el paciente escribió "Prefiero una persona
// del equipo porfavor", "Prefiero una persona del equipo" y "Persona" (tres mensajes seguidos) sin
// que ninguno matcheara, recibiendo el mismo "no entendí" genérico cada vez, hasta que en el quinto
// intento acertó la frase exacta. Se amplía para cubrir "prefiero/quiero/necesito ... persona/
// humano/alguien" en cualquier orden, y un mensaje que es solo esa palabra suelta.
const HABLAR_CON_HUMANO_PATTERN =
  /hablar con (alguien|una persona|un humano)|atienda una persona|comunicarme con (la )?(secretaria|recepci[oó]n)|\b(prefiero|quiero|necesito)\b.*\b(persona|humano|alguien)\b|^\s*(persona|humano|alguien)s?\s*[.!¡]*\s*$/

// Ola 4 (incidente real 2026-07-14): el paciente escribió "gracias doc, ya conseguí turno en el
// [otro lugar]" para cerrar la conversación -- como "turno" matcheaba `pedir_turno` (más abajo en
// este mismo array), el bot le reenvió el menú de sedes como si estuviera arrancando a pedir un
// turno de nuevo. Chequeado antes que `pedir_turno` para que un cierre no se confunda con un
// pedido nuevo.
const TURNO_YA_RESUELTO_PATTERN =
  /\bya (consegu[ií]|ten[ií]a|tengo|saqu[ié])\b.{0,20}\bturno\b|\bya me atend[ií]/

const DETERMINISTIC_RULES: Array<{ intent: WhatsAppIntent; test: RegExp }> = [
  { intent: "cancelar_reprogramar", test: /cancelar|reprogramar|cambiar (el|mi) turno|no puedo ir/ },
  { intent: "hablar_con_humano", test: HABLAR_CON_HUMANO_PATTERN },
  { intent: "turno_ya_resuelto", test: TURNO_YA_RESUELTO_PATTERN },
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
  if (provider !== "gemini" && provider !== "anthropic") return "otro_no_entendido"
  try {
    return await classifyWhatsAppIntent(text, provider)
  } catch {
    return "otro_no_entendido"
  }
}

export const INTENT_REPLIES: Partial<Record<WhatsAppIntent, string>> = {
  hablar_con_humano: "La conversación quedó derivada a una persona del equipo de la Dra. Lucía Chahin.",
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

// DATA-02: la baja de contacto comercial/marketing tiene que ser inmediata (no esperar a la
// barrida semanal de retención) — palabras clave deterministas, chequeadas antes que cualquier
// otra cosa en el mensaje entrante. "BAJA"/"STOP" son las convenciones estándar de opt-out en
// Argentina (mismo patrón que un SMS masivo). No confundir con protocol_opt_out (ese es solo para
// la invitación puntual a un protocolo de investigación, ver classifyProtocolButtonReply).
const MARKETING_OPT_OUT_PATTERN =
  /^(?:baja|stop|unsubscribe)[.! ]*$|\b(?:quiero|solicito|pedir|pido|darme|dame|dar)\s+(?:la\s+)?baja\b|\bdarme\s+de\s+baja\b|no (?:me )?(?:escriban|contacten|molesten) m[aá]s|dejen de (?:escribirme|contactarme)|no quiero (?:m[aá]s )?mensajes/

export function isMarketingOptOutMessage(text: string): boolean {
  return MARKETING_OPT_OUT_PATTERN.test(text.toLowerCase())
}
