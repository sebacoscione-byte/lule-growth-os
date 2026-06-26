import Anthropic from "@anthropic-ai/sdk"
import { createHash } from "crypto"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { parseAiJson } from "@/lib/parse-ai-json"
import type { ClassifyResult, ContentSource } from "@/types"

export type AiMode = "manual" | "gemini_api"

type AiProvider = "anthropic" | "gemini"
type AiMessage = { role: "user" | "assistant"; content: string }

type GenerateOptions = {
  system: string
  messages: AiMessage[]
  maxTokens: number
  json?: boolean
  purpose?: string
}

const SPANISH_INSTRUCTION = `Responde siempre en espanol rioplatense claro, natural y profesional.
No respondas en ingles, salvo nombres propios, marcas o terminos tecnicos inevitables.`

let anthropic: Anthropic | null = null

// ---------------------------------------------------------------------------
// Mode + provider detection
// ---------------------------------------------------------------------------

export function getAiMode(): AiMode {
  return process.env.NEXT_PUBLIC_AI_MODE === "gemini_api" ? "gemini_api" : "manual"
}

function getRequestedProvider(): AiProvider | "auto" {
  const provider = process.env.AI_PROVIDER?.toLowerCase()
  return provider === "anthropic" || provider === "gemini" ? provider : "auto"
}

function getProviderOrder(): AiProvider[] {
  const requested = getRequestedProvider()
  if (requested !== "auto") return [requested]
  return process.env.GEMINI_API_KEY ? ["gemini", "anthropic"] : ["anthropic", "gemini"]
}

export function getAiConfiguration() {
  const requested = getRequestedProvider()
  const mode = getAiMode()
  const available = {
    gemini: Boolean(process.env.GEMINI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  }
  const active =
    mode === "manual"
      ? null
      : requested === "auto"
      ? available.gemini ? "gemini" : available.anthropic ? "anthropic" : null
      : requested
  return { requested, active, available, mode }
}

// ---------------------------------------------------------------------------
// Supabase helpers (service role, no cookies needed)
// ---------------------------------------------------------------------------

function getDb() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function hashPrompt(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 40)
}

async function getCachedOutput(promptHash: string): Promise<string | null> {
  try {
    const { data } = await getDb()
      .from("ai_outputs")
      .select("output_text")
      .eq("prompt_hash", promptHash)
      .single()
    return data?.output_text ?? null
  } catch {
    return null
  }
}

async function saveCachedOutput(
  promptHash: string,
  purpose: string,
  inputPrompt: string,
  outputText: string
) {
  try {
    await getDb()
      .from("ai_outputs")
      .upsert(
        { prompt_hash: promptHash, purpose, input_prompt: inputPrompt.slice(0, 5000), output_text: outputText },
        { onConflict: "prompt_hash" }
      )
  } catch { /* non-critical */ }
}

async function logRequest(
  provider: string,
  model: string | null,
  promptHash: string,
  purpose: string,
  success: boolean,
  errorMessage?: string
) {
  try {
    await getDb().from("ai_requests").insert({
      provider, model, prompt_hash: promptHash, purpose, success,
      error_message: errorMessage ?? null,
    })
  } catch { /* non-critical */ }
}

export async function getDailyRequestCount(): Promise<number> {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const { count } = await getDb()
      .from("ai_requests")
      .select("id", { count: "exact", head: true })
      .gte("created_at", today.toISOString())
      .eq("success", true)
    return count ?? 0
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Prompt builders — pure functions, no API calls
// ---------------------------------------------------------------------------

const IMAGE_PROMPT_RULES = `DIRECCION VISUAL PARA GEMINI:
- Inclui "image_prompt": un prompt autocontenido y detallado para que Gemini genere la placa visual final.
- Redacta "image_prompt" en ingles para maximizar la precision visual; no incluyas instrucciones conversacionales ni explicaciones.
- El prompt debe pedir una pieza editorial premium que detenga el scroll, conectada de forma concreta con el tema y adaptada al formato.
- Define un unico punto focal claro y una escena que se entienda en menos de un segundo.
- La escena debe activar curiosidad o identificacion en un paciente potencial: mostrar un momento cotidiano reconocible, una decision preventiva o el beneficio emocional de ocuparse de la salud.
- Debe existir una tension visual suave entre "seguir postergando" y "ocuparse a tiempo", sin representar peligro, dolor, miedo ni urgencia.
- La imagen debe sentirse cercana y confiable, no fria, hospitalaria ni publicitaria de stock.
- Elegi una sola direccion creativa concreta: momento humano cotidiano, naturaleza muerta editorial u objeto usado como metafora visual. No mezcles conceptos.
- Describi sujeto, accion, encuadre, lente o perspectiva, iluminacion, profundidad, paleta, textura, estado de animo y ubicacion del espacio negativo.
- Usa este orden dentro del prompt: objetivo y tema; escena principal; composicion; luz y color; acabado editorial; espacio negativo; restricciones.
- Indica proporcion vertical 4:5 para feed; usa 9:16 solo si el formato es historia.
- Reserva una zona limpia de alto contraste para integrar el titular y subtitulo sin tapar el punto focal.
- El texto debe ser breve, grande, legible en pantalla chica y con jerarquia clara. Usa como maximo dos familias o pesos tipograficos.
- Para historia, manten texto y elementos importantes dentro de la zona segura central, lejos de los bordes superior e inferior.
- Para carrusel, crea una portada que abra una brecha de curiosidad y se entienda en menos de tres segundos.
- Pedi iluminacion natural o cinematografica suave, profundidad, textura y una paleta sobria con acentos bordo, azul profundo o verde azulado.
- Prioriza escenas humanas cotidianas, objetos o metaforas visuales inteligentes. Evita la placa de texto generica.
- Si aparecen personas: adultas, aspecto argentino o latino diverso, expresion serena, nunca con dolor ni en una urgencia.
- No representar a una medica real ni inventar el rostro de la Dra. Lucia Chahin.
- PROHIBIDO dentro de la imagen: texto adicional al titular y subtitulo solicitados, logos, marcas de agua, interfaces, diagnosticos, estudios legibles, anatomia gore, personas angustiadas, corazon rojo de stock, estetoscopio flotante o ECG decorativo.
- No pedir collages, infografias, posters, flyers, marcos, placas, fondos con gradiente ni composiciones divididas.
- El prompt debe terminar reforzando: "Render only the exact requested Spanish headline and subtitle. No extra text, no logos, no watermark."
- Inclui "image_alt_text": descripcion accesible en espanol, factual y breve, maximo 180 caracteres.`

const PATIENT_ACQUISITION_RULES = `CRITERIO DE CAPTACION DE PACIENTES:
- Cada pieza debe seguir esta secuencia: detener el scroll, generar identificacion, entregar una idea util y facilitar el proximo paso.
- El hook y el titular deben ser especificos, faciles de entender en menos de tres segundos y abrir una brecha de curiosidad relevante.
- El hook, el titular y la imagen deben trabajar juntos: la imagen atrae e intriga; el titular aclara la promesa de valor sin repetir literalmente lo mismo.
- Habla de situaciones, dudas o decisiones cotidianas que una persona puede reconocer sin asumir que tiene una enfermedad.
- Entrega valor real antes del CTA: una explicacion clara, un mito corregido, una pregunta util o un motivo concreto para un control preventivo.
- Conecta el aprendizaje con considerar una consulta cardiologica o ecocardiograma cuando corresponda, sin presionar ni prometer resultados.
- El CTA debe reducir friccion y explicar el siguiente paso por canales oficiales. Nunca uses escasez, culpa, miedo o urgencia comercial.
- Evita hooks vagos o genericos como "cuidar tu corazon es importante", "todo lo que tenes que saber" o "la salud es lo primero".`

export function buildContentPlanPrompt(input: {
  topic: string
  category: string
  format: string
  cta: string
  appointment_link?: string | null
  source?: ContentSource | null
}): string {
  const sourceSection = input.source
    ? `FUENTE ADICIONAL DE REFERENCIA (usala como contexto, no como única fuente):
Título: ${input.source.title}
Publicación: ${input.source.publication}
Fecha: ${input.source.published_at}
Resumen: ${input.source.summary || "No disponible"}

Podés mencionar esta fuente de forma general si es relevante, pero el contenido debe basarse principalmente en conocimiento médico actualizado sobre el tema.`
    : ""

  return `Sos responsable de contenido de la Dra. Lucía Chahin, cardióloga.
Creás propuestas editoriales para Instagram y Google Business.

CONTEXTO:
- Lucía atiende martes en CIMEL Lanús (Tucumán 1314) y viernes en Swiss Medical Lomas
- La app NO reserva turnos ni da diagnósticos
- Objetivo: educar, generar conciencia cardiovascular e invitar a pedir turno

REGLAS OBLIGATORIAS:
- Todo en español rioplatense
- Basate en conocimiento médico actualizado y evidencia general sobre el tema
- Podés incorporar datos recientes, estadísticas o avances que conozcas sobre el tema
- No diagnósticos ni tratamientos personalizados
- No afirmaciones médicas personalizadas ni promesas de resultados
- No lenguaje alarmista ni que asuma condiciones del lector
- Ante síntomas de alarma → siempre derivar a guardia

${IMAGE_PROMPT_RULES}

${PATIENT_ACQUISITION_RULES}

ENFOQUE DEL CONTENIDO:
El contenido debe captar pacientes potenciales educándolos. Usá datos relevantes,
desmitificá creencias comunes, explicá conceptos de forma accesible, o destacá la
importancia del chequeo cardiovascular preventivo. El objetivo es que el lector
sienta que aprendió algo valioso y quiera pedir turno.

PEDIDO:
${input.topic.trim()
  ? `Tema o enfoque sugerido: ${input.topic}`
  : "No se definio un tema. Elegi de forma autonoma el enfoque mas atractivo, util y concreto dentro de la categoria."}
Categoría: ${input.category}
Formato Instagram: ${input.format}
${input.cta ? `Estilo de cierre sugerido: ${input.cta}` : ""}
${input.appointment_link
  ? `Link de turnos: ${input.appointment_link}
El caption debe cerrar invitando al lector a usar ese link para pedir turno. NO invitar a escribir mensajes directos ni a responder al post.`
  : `No hay link disponible aún. Si incluís un cierre, usá "link en la bio" como referencia al link de turnos. NO invitar a escribir mensajes directos.`}
${sourceSection}
RESPUESTA ESPERADA:
Devolvé ÚNICAMENTE el JSON válido, sin markdown, sin bloques de código, sin explicaciones.
Si un texto necesita comillas, escapalas como \\\" o usa comillas simples para no romper el JSON.
${input.format === "carrusel" ? `Formato CARRUSEL: incluí un array "slides" con 4-5 slides de contenido (además de la portada).
Cada slide tiene "headline" (máx. 40 caracteres) y "text" (1-2 oraciones del contenido de esa slide).
Usá exactamente estas claves:

{
  "hook": "frase gancho para la portada del carrusel",
  "caption": "caption completo (150-300 palabras). Estructurá con introducción + puntos clave de cada slide.",
  "google_text": "texto para Google Business, máximo 1500 caracteres",
  "hashtags": "#hashtag1 #hashtag2 (10-15 hashtags)",
  "visual_headline": "título de la portada, máximo 40 caracteres",
  "visual_subtitle": "subtítulo de la portada, máximo 60 caracteres",
  "visual_style": "rose",
  "image_prompt": "prompt visual detallado listo para que Gemini genere la portada final",
  "image_alt_text": "descripcion accesible breve en espanol",
  "slides": [
    {"headline": "Slide 1 — título", "text": "Contenido de esta slide en 1-2 oraciones."},
    {"headline": "Slide 2 — título", "text": "Contenido de esta slide."},
    {"headline": "Slide 3 — título", "text": "Contenido de esta slide."},
    {"headline": "Slide 4 — título", "text": "Contenido de esta slide."}
  ]
}` : `Usá exactamente estas claves:

{
  "hook": "frase gancho de 1-2 líneas para captar atención en Instagram",
  "caption": "caption completo para Instagram con emojis y párrafos (150-300 palabras)",
  "google_text": "texto para publicación en Google Business, máximo 1500 caracteres",
  "hashtags": "#hashtag1 #hashtag2 (10-15 hashtags relevantes al tema y cardiología)",
  "visual_headline": "titular para la placa visual, máximo 60 caracteres",
  "visual_subtitle": "subtítulo para la placa visual, máximo 80 caracteres",
  "visual_style": "rose",
  "image_prompt": "prompt visual detallado listo para que Gemini genere la placa final",
  "image_alt_text": "descripcion accesible breve en espanol"
}`}`
}

export function buildReplyPrompt(message: string, leadContext: string): string {
  return `Sos el asistente de la Dra. Lucía Chahin, cardióloga.
Respondé este mensaje de forma cálida y profesional en español rioplatense.

REGLAS:
- No des diagnósticos ni tratamientos
- No confirmes disponibilidad ni reservés turnos
- Si hay síntomas de alarma → derivar a guardia inmediatamente
- Lucía atiende martes en CIMEL Lanús y viernes en Swiss Medical Lomas

Contexto del lead: ${leadContext}

Mensaje a responder: "${message}"

Devolvé solo el texto de la respuesta, sin JSON ni formato extra.`
}

// ---------------------------------------------------------------------------
// API callers
// ---------------------------------------------------------------------------

function getAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY no esta configurada.")
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return anthropic
}

async function generateWithAnthropic(options: GenerateOptions): Promise<string> {
  const response = await getAnthropic().messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: options.maxTokens,
    system: `${SPANISH_INSTRUCTION}\n\n${options.system}`,
    messages: options.messages,
  })
  return response.content.filter(b => b.type === "text").map(b => b.text).join("")
}

async function generateWithGemini(options: GenerateOptions): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("GEMINI_API_KEY no esta configurada.")
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash"
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `${SPANISH_INSTRUCTION}\n\n${options.system}` }] },
        contents: options.messages.map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          maxOutputTokens: options.maxTokens,
          ...(options.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    }
  )
  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    error?: { message?: string; status?: string }
  }
  if (!response.ok) {
    throw new Error(data.error?.message || `Gemini respondio con estado ${response.status}.`)
  }
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || ""
  if (!text) throw new Error("Gemini no devolvio contenido.")
  return text
}

async function generateText(options: GenerateOptions): Promise<string> {
  const dailyLimit = Number(process.env.DAILY_AI_REQUEST_LIMIT ?? 20)
  const dailyCount = await getDailyRequestCount()
  if (dailyCount >= dailyLimit) {
    throw new Error(`DAILY_LIMIT_EXCEEDED:${dailyLimit}`)
  }

  const promptText = `${options.system}\n${options.messages.map(m => m.content).join("\n")}`
  const promptHash = hashPrompt(promptText)
  const purpose = options.purpose ?? "general"

  const cached = await getCachedOutput(promptHash)
  if (cached) return cached

  const errors: unknown[] = []
  for (const provider of getProviderOrder()) {
    const model = provider === "gemini"
      ? (process.env.GEMINI_MODEL ?? "gemini-2.0-flash")
      : (process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6")
    try {
      const text = provider === "gemini"
        ? await generateWithGemini(options)
        : await generateWithAnthropic(options)
      await saveCachedOutput(promptHash, purpose, promptText, text)
      await logRequest(provider, model, promptHash, purpose, true)
      return text
    } catch (error) {
      errors.push(error)
      await logRequest(provider, model, promptHash, purpose, false,
        error instanceof Error ? error.message : String(error))
      if (getRequestedProvider() !== "auto") break
    }
  }
  throw errors[0] || new Error("No hay un proveedor de IA disponible.")
}

// ---------------------------------------------------------------------------
// Public error formatter
// ---------------------------------------------------------------------------

export function getPublicAiError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()

  if (normalized.startsWith("daily_limit_exceeded:")) {
    const limit = message.split(":")[1]
    return `Se alcanzó el límite diario de ${limit} llamadas a la IA. Usá el modo manual o esperá hasta mañana.`
  }
  if (normalized.includes("credit balance") || normalized.includes("billing") || normalized.includes("insufficient")) {
    return "El proveedor de IA no tiene saldo disponible. Activá billing en Google Cloud o usá el modo manual."
  }
  if (normalized.includes("quota") || normalized.includes("resource_exhausted") || normalized.includes("rate limit")) {
    return "RATE_LIMIT: El proveedor de IA alcanzó su límite. Intentá de nuevo en unos minutos o usá el modo manual."
  }
  if (normalized.includes("api_key") || normalized.includes("api key") || normalized.includes("authentication")) {
    return "Falta configurar una clave de IA válida. Revisá GEMINI_API_KEY en las variables de entorno."
  }
  if (normalized.includes("not found") && normalized.includes("model")) {
    return "El modelo de IA configurado no está disponible. Revisá GEMINI_MODEL."
  }
  return "No se pudo generar la respuesta con IA. Revisá la configuración del proveedor e intentá nuevamente."
}

// ---------------------------------------------------------------------------
// JSON parser helper
// ---------------------------------------------------------------------------

function parseJson<T>(text: string): T {
  return parseAiJson<T>(text)
}

// ---------------------------------------------------------------------------
// System prompt (chatbot)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Sos el asistente administrativo digital de la Dra. Lucia Chahin.
Tu objetivo es captar interesados y guiarlos para pedir turno.

REGLAS OBLIGATORIAS:
- No das diagnostico
- No indicas tratamiento
- No interpretas estudios
- No das consejos medicos personalizados
- No confirmas disponibilidad
- No reservas turnos
- No hablas en nombre de CIMEL ni de Swiss Medical
- No prometes atencion ni resultados
- No pedis DNI, estudios, imagenes, ECG ni historia clinica
- Solo pedis datos minimos para seguimiento
- Usas tono claro, calido, profesional y argentino (voseo)
- Haces una pregunta por vez

INFORMACION DE ATENCION:
- Dra. Lucia Chahin atiende:
  - Martes en CIMEL Lanus (Tucuman 1314, Lanus): consulta cardiologica y ecocardiograma
  - Viernes en Swiss Medical Lomas: consulta cardiologica y ecocardiograma
- Para pedir turno: comunicarse con la institucion y solicitar turno con la Dra. Lucia Chahin
- La app NO reserva turnos ni confirma horarios

DETECCION DE URGENCIAS:
Si el usuario menciona dolor de pecho actual, falta de aire, desmayo, perdida de fuerza,
dificultad para hablar, dolor irradiado a brazo o mandibula, palpitaciones con mareo intenso,
presion muy alta con sintomas, o cualquier sintoma de alarma:
Responder: "Por lo que contas, esto no deberia resolverse por este canal. Te recomiendo buscar atencion medica inmediata o concurrir a una guardia. Este canal solo sirve para orientar como pedir turno, no para urgencias."`

// ---------------------------------------------------------------------------
// Exported AI functions
// ---------------------------------------------------------------------------

const MANUAL_CLASSIFY_DEFAULT: ClassifyResult = {
  intent: "otro",
  requested_service: "no_definido",
  suggested_location: "preguntar",
  suggested_day: "preguntar",
  priority_score: 5,
  requires_human: true,
  possible_emergency: false,
  reply_suggestion: "Gracias por escribirnos. Revisamos tu consulta y te respondemos a la brevedad.",
  next_action: "escalar",
}

export async function classifyMessage(message: string): Promise<ClassifyResult> {
  if (getAiMode() === "manual") return MANUAL_CLASSIFY_DEFAULT

  const text = await generateText({
    maxTokens: 1024,
    json: true,
    purpose: "classify",
    system: `${SYSTEM_PROMPT}

Analiza el mensaje del usuario y devolve SOLO un JSON valido con esta estructura exacta:
{
  "intent": "turno | consulta_cardiologia | ecocardiograma | cobertura | lugar_atencion | consulta_medica | urgencia | spam | otro",
  "requested_service": "consulta_cardiologia | ecocardiograma | no_definido",
  "suggested_location": "cimel_lanus | swiss_lomas | preguntar",
  "suggested_day": "martes | viernes | preguntar",
  "priority_score": 1,
  "requires_human": false,
  "possible_emergency": false,
  "reply_suggestion": "texto de respuesta en espanol",
  "next_action": "responder | pedir_preferencia | derivar_cimel | derivar_swiss | escalar | descartar"
}`,
    messages: [{ role: "user", content: message }],
  })
  return parseJson<ClassifyResult>(text)
}

export async function generateReply(
  message: string,
  leadContext: string,
  conversationHistory: AiMessage[]
): Promise<string> {
  if (getAiMode() === "manual") {
    throw new Error("Modo manual activo: la generación automática de respuestas está deshabilitada.")
  }
  return generateText({
    maxTokens: 512,
    purpose: "reply",
    system: `${SYSTEM_PROMPT}

Contexto del lead: ${leadContext}
Genera una respuesta apropiada. Solo el texto de la respuesta, sin JSON ni formato extra.`,
    messages: [...conversationHistory, { role: "user", content: message }],
  })
}

export async function generateInstagramContent(
  category: string,
  type: "reel" | "historia" | "carrusel" | "post",
  cta: string
): Promise<{ caption: string; hook: string; hashtags: string }> {
  if (getAiMode() === "manual") {
    throw new Error("Modo manual activo: usá Generar propuesta completa para obtener el prompt.")
  }
  const text = await generateText({
    maxTokens: 1024,
    json: true,
    purpose: "instagram_content",
    system: `Sos especialista en marketing medico para la Dra. Lucia Chahin, cardiologa.
Generas contenido para Instagram en tono profesional, calido y argentino.
NUNCA prometes resultados medicos, nunca das diagnosticos, nunca asumis condiciones del lector.
El objetivo es informar y captar personas que quieran pedir turno.
Devolve SOLO un JSON con: { "caption": "...", "hook": "...", "hashtags": "..." }`,
    messages: [{ role: "user", content: `Genera un ${type} sobre: ${category}. CTA sugerido: ${cta}` }],
  })
  return parseJson(text)
}

export async function generateContentPlan(input: {
  topic: string
  category: string
  format: "reel" | "historia" | "carrusel" | "post"
  cta: string
  appointment_link?: string | null
  source?: ContentSource | null
}): Promise<{
  hook: string
  caption: string
  google_text: string
  hashtags: string
  visual_headline: string
  visual_subtitle: string
  visual_style: "rose" | "blue" | "teal"
  image_prompt: string
  image_alt_text: string
  slides?: Array<{ headline: string; text: string }>
}> {
  const sourceContext = input.source
    ? `Fuente para contextualizar:
Titulo: ${input.source.title}
Publicacion: ${input.source.publication}
Fecha: ${input.source.published_at}
Resumen disponible: ${input.source.summary || "No disponible"}

No inventes resultados que no esten en el resumen. Menciona la fuente de forma general, sin presentar el post como consejo medico.`
    : "No hay fuente reciente seleccionada. Trata el tema como contenido evergreen y no menciones novedades ni estudios recientes."

  const slidesSchema = input.format === "carrusel"
    ? `,
  "slides": [
    {"headline": "Slide 1 — titulo, max 40 chars", "text": "1-2 oraciones del contenido."},
    {"headline": "Slide 2", "text": "..."},
    {"headline": "Slide 3", "text": "..."},
    {"headline": "Slide 4", "text": "..."}
  ]`
    : ""

  const userContent = `${input.topic.trim()
    ? `Tema o enfoque sugerido: ${input.topic}`
    : "No se definio un tema. Elegi de forma autonoma el enfoque mas atractivo, util y concreto dentro de la categoria."}
Categoria: ${input.category}
Formato Instagram: ${input.format}
CTA: ${input.cta}

${sourceContext}

${input.format === "carrusel" ? "Es un CARRUSEL: generá 4-5 slides con headline y texto corto para cada slide, ademas de la portada.\n\n" : ""}Devolve:
{
  "hook": "...",
  "caption": "...",
  "google_text": "...",
  "hashtags": "...",
  "visual_headline": "...",
  "visual_subtitle": "...",
  "image_prompt": "...",
  "image_alt_text": "..."${slidesSchema}
}`

  const text = await generateText({
    maxTokens: 2200,
    json: true,
    purpose: "content_plan",
    system: `Sos responsable de contenido de la Dra. Lucia Chahin, cardiologa.
Creas una propuesta editorial lista para revision humana, adaptada a Instagram y Google Business.

Reglas:
- Escribi todo el contenido final en espanol.
- No diagnostiques, no indiques tratamientos y no interpretes estudios.
- No hagas afirmaciones medicas personalizadas ni promesas.
- No uses mensajes alarmistas ni asumas que el lector tiene una condicion.
- Ante sintomas de alarma, indica guardia o atencion medica inmediata.
- El objetivo es educar y explicar como pedir turno por canales oficiales.
- Lucia atiende martes en CIMEL Lanus y viernes en Swiss Medical Lomas.
- Gemini resolvera despues la placa final e integrara el titular y subtitulo.
${IMAGE_PROMPT_RULES}
${PATIENT_ACQUISITION_RULES}
- El texto de Google debe tener maximo 1500 caracteres.
- Si un texto necesita comillas, escapalas como \\\" o usa comillas simples para no romper el JSON.
- Devolve SOLO JSON valido.`,
    messages: [{ role: "user", content: userContent }],
  })

  const parsed = parseJson<Record<string, unknown>>(text)
  const required = ["hook", "caption", "google_text", "hashtags", "visual_headline", "visual_subtitle", "image_prompt", "image_alt_text"]
  if (required.some(key => typeof parsed[key] !== "string")) throw new Error("Plan de contenido incompleto.")

  const rawSlides = parsed.slides
  const slides = Array.isArray(rawSlides)
    ? (rawSlides as Array<Record<string, unknown>>)
        .filter(s => typeof s.headline === "string" && typeof s.text === "string")
        .map(s => ({ headline: (s.headline as string).slice(0, 60), text: (s.text as string).slice(0, 300) }))
    : undefined

  return {
    hook: parsed.hook as string,
    caption: parsed.caption as string,
    google_text: (parsed.google_text as string).slice(0, 1500),
    hashtags: parsed.hashtags as string,
    visual_headline: (parsed.visual_headline as string).slice(0, 90),
    visual_subtitle: (parsed.visual_subtitle as string).slice(0, 90),
    visual_style: ["rose", "blue", "teal"].includes(parsed.visual_style as string)
      ? parsed.visual_style as "rose" | "blue" | "teal"
      : "blue",
    image_prompt: (parsed.image_prompt as string).slice(0, 2400),
    image_alt_text: (parsed.image_alt_text as string).slice(0, 180),
    slides: slides && slides.length > 0 ? slides : undefined,
  }
}

export async function generateContentVisual(input: {
  category: string
  topic: string
  format: "reel" | "historia" | "carrusel" | "post"
  visual_headline: string
  visual_subtitle: string
  image_prompt: string
}): Promise<{ mime_type: string; image_data: string }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("GEMINI_API_KEY no esta configurada.")

  const dailyLimit = Number(process.env.DAILY_AI_REQUEST_LIMIT ?? 20)
  if (await getDailyRequestCount() >= dailyLimit) {
    throw new Error(`DAILY_LIMIT_EXCEEDED:${dailyLimit}`)
  }

  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image"
  const aspectRatio = input.format === "historia" ? "9:16" : "4:5"
  const prompt = `Create the final publish-ready Instagram ${input.format} visual for a cardiology practice.

CONTENT:
- Category: ${input.category}
- Topic: ${input.topic}
- Exact Spanish headline: "${input.visual_headline}"
- Exact Spanish subtitle: "${input.visual_subtitle}"

CREATIVE DIRECTION:
${input.image_prompt}

FINAL ART DIRECTION:
- Produce one polished ${aspectRatio} composition, not a mockup or template preview.
- The visual must stop the scroll, communicate one idea in under three seconds and feel trustworthy to an adult patient in Argentina.
- Use a clear focal point, strong visual hierarchy, high text/background contrast and generous breathing room.
- Render the exact Spanish headline and subtitle once, with correct accents and no spelling changes.
- Headline must dominate; subtitle must remain readable on a small phone screen.
- ${input.format === "historia"
    ? "Keep all text and essential elements inside the central Story safe zone, away from the top and bottom interface areas."
    : "Use a 4:5 feed composition. For a carousel, make this an irresistible but medically responsible cover."}
- No diagnosis, treatment claim, urgency marketing, fear, logos, watermark or extra text.
- Do not depict the real doctor or invent her likeness.`
  const promptHash = hashPrompt(prompt)

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
      }
    )
    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{
        inlineData?: { mimeType?: string; data?: string }
        inline_data?: { mime_type?: string; data?: string }
      }> } }>
      error?: { message?: string }
    }
    if (!response.ok) throw new Error(data.error?.message || `Gemini respondio con estado ${response.status}.`)

    const part = data.candidates?.[0]?.content?.parts?.find(candidate => candidate.inlineData?.data || candidate.inline_data?.data)
    const imageData = part?.inlineData?.data || part?.inline_data?.data
    const mimeType = part?.inlineData?.mimeType || part?.inline_data?.mime_type || "image/png"
    if (!imageData) throw new Error("Gemini no devolvio una imagen.")

    await logRequest("gemini", model, promptHash, "content_visual", true)
    return { mime_type: mimeType, image_data: imageData }
  } catch (error) {
    await logRequest("gemini", model, promptHash, "content_visual", false,
      error instanceof Error ? error.message : String(error))
    throw error
  }
}

export async function generateGooglePost(topic: string): Promise<string> {
  if (getAiMode() === "manual") {
    throw new Error("Modo manual activo: la generación automática está deshabilitada.")
  }
  return generateText({
    maxTokens: 512,
    purpose: "google_post",
    system: `Generas publicaciones para Google Business Profile de la Dra. Lucia Chahin, cardiologa.
Tono profesional y claro. Maximo 1500 caracteres. Sin promesas medicas.
Siempre inclui donde atiende (CIMEL Lanus los martes, Swiss Medical Lomas los viernes).
Solo devolve el texto de la publicacion.`,
    messages: [{ role: "user", content: `Publicacion sobre: ${topic}` }],
  })
}

export async function generateReviewReply(starRating: string, comment: string): Promise<string> {
  if (getAiMode() === "manual") {
    throw new Error("Modo manual activo: la generación automática está deshabilitada.")
  }
  const stars = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[starRating] ?? 3
  const sentiment = stars >= 4 ? "positiva" : stars === 3 ? "neutral" : "negativa"
  return generateText({
    maxTokens: 256,
    purpose: "review_reply",
    system: `Sos la Dra. Lucia Chahin y respondes resenas de Google en primera persona.
Tono calido, profesional y breve (maximo 3 oraciones). Nunca hagas promesas medicas.
Solo devolve el texto de la respuesta, sin comillas ni formato extra.`,
    messages: [{ role: "user", content: `Resena ${sentiment} (${stars} estrellas): "${comment || "Sin comentario"}"\nGenera una respuesta apropiada.` }],
  })
}

export async function generateFollowupMessage(leadName: string | null, location: string): Promise<string> {
  const name = leadName ? `, ${leadName}` : ""
  return `Hola${name}, te escribo para saber si pudiste pedir turno con la Dra. Lucia Chahin en ${location}. Si tuviste algun problema para ubicarla, avisame y te paso nuevamente las indicaciones.\n\nPudiste pedir turno?\n1. Ya pedi turno\n2. No pude pedir\n3. Necesito los datos de nuevo\n4. Ya no me interesa`
}

export async function generateFollowupSuggestion(
  leadContext: string,
  conversationHistory: AiMessage[]
): Promise<string> {
  if (getAiMode() === "manual") {
    throw new Error("Modo manual activo: la generación automática está deshabilitada.")
  }
  const historyContext = conversationHistory.length > 0
    ? `Historial de conversación:\n${conversationHistory.map(m => `${m.role === "user" ? "Lead" : "Nosotros"}: ${m.content}`).join("\n")}`
    : "Sin mensajes previos."

  return generateText({
    maxTokens: 400,
    purpose: "followup_suggestion",
    system: `${SYSTEM_PROMPT}

Tu tarea es redactar el próximo mensaje que el equipo enviará al lead para hacer seguimiento.
Generá un mensaje cálido, breve y en español rioplatense que:
- Pregunte si pudo pedir turno con la Dra. Lucía Chahin
- Ofrezca ayuda concreta si no pudo
- No sea repetitivo si ya hubo conversación previa
- Cierre con opciones simples (Ya pedí turno / No pude / Necesito los datos de nuevo)
Solo devolvé el texto del mensaje, sin comillas ni formato extra.`,
    messages: [
      {
        role: "user",
        content: `${leadContext}\n\n${historyContext}\n\nRedactá el próximo mensaje de seguimiento.`,
      },
    ],
  })
}
