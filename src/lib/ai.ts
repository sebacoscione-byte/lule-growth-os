import Anthropic from "@anthropic-ai/sdk"
import { createHash } from "crypto"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { parseAiJson } from "@/lib/parse-ai-json"
import { EMERGENCY_REPLY, MEDICAL_BOUNDARY_REPLY, isEmergencyMessage, isMedicalBoundaryMessage } from "@/lib/medical-safety"
import { z } from "zod"
import type { ClassifyResult, ContentObjective, ContentSource, ContentVideoBrief, ContentVideoScores, WhatsAppIntent } from "@/types"

export type AiMode = "manual" | "gemini_api"

type AiProvider = "anthropic" | "gemini"
type AiMessage = { role: "user" | "assistant"; content: string }

/**
 * Proveedores seleccionables desde Configuración para el respaldo de clasificación de intents del
 * bot de WhatsApp. Solo "gemini"/"anthropic" están implementados (reusan el proveedor global de
 * arriba); el resto son opciones de interfaz — llamarlas lanza un error explícito, a propósito, en
 * vez de sumar una dependencia/SDK nueva sin uso real todavía.
 */
export const UNIMPLEMENTED_AI_PROVIDERS = ["openai", "otro_llm", "meta_business_agent"] as const

type GenerateOptions = {
  system: string
  messages: AiMessage[]
  maxTokens: number
  json?: boolean
  purpose?: string
  /** Marcar true cuando `system` no depende de datos del request: habilita prompt caching de Anthropic. */
  cacheSystem?: boolean
  /** `none` evita leer o persistir prompts/outputs con mensajes de pacientes. */
  cacheMode?: "none" | "safe_non_personal"
  /** Permite que una configuración operativa explícita elija proveedor para esta llamada. */
  provider?: AiProvider
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

// Lee process.env en cada llamada (no memoiza) a proposito: un `npm run dev` ya corriendo NO
// recarga `.env.local` en caliente para env vars de servidor, asi que editar AI_PROVIDER sin
// reiniciar el proceso deja este valor viejo en memoria -- confirmado como causa raiz de un caso real
// donde el fallback a Anthropic no se disparo (ver docs/BACKLOG.md, caso cerrado 2026-07-20). Si el
// fallback no dispara pese a AI_PROVIDER="" en .env.local, reiniciar el dev server antes de sospechar
// un bug de logica en generateText().
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

/** `purpose` filtra el conteo a un uso puntual (ej. "content_video") -- sin el parametro, cuenta todas
 * las llamadas exitosas del dia, igual que antes. Usado para el limite general (DAILY_AI_REQUEST_LIMIT)
 * y para limites propios y mas estrictos de usos con costo real por llamada (ver DAILY_VIDEO_GENERATION_LIMIT). */
export async function getDailyRequestCount(purpose?: string): Promise<number> {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    let query = getDb()
      .from("ai_requests")
      .select("id", { count: "exact", head: true })
      .gte("created_at", today.toISOString())
      .eq("success", true)
    if (purpose) query = query.eq("purpose", purpose)
    const { count } = await query
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
- La imagen debe sentirse cercana y confiable: evita el pasillo de guardia, la luz fria fluorescente,
  el ambiente esteril-asustador o la publicidad de stock generica. Pero un consultorio medico calido y
  profesional (luz natural, materiales nobles, plantas, tonos calidos) es una ubicacion valida y en
  muchos casos la correcta -- no es lo mismo que "hospitalario" en el sentido frio/institucional que hay
  que evitar.
- Elegi una sola direccion creativa concreta segun de que habla el tema:
  - Si el tema es un estudio, procedimiento o consulta que sucede en el consultorio (ecocardiograma,
    consulta cardiologica, estudios cardiologicos, chequeo cardiovascular, atencion en una sede, como
    pedir turno), la escena TIENE que transcurrir en un consultorio o sala de estudios reconocible como
    tal (camilla, equipo correspondiente al estudio mencionado en uso o listo para usarse, ambiente
    clinico profesional pero calido) -- nunca en un living, dormitorio u otro espacio domestico generico.
    Un instrumento medico (ej. el transductor de un ecografo) apoyado sobre una mesa ratona sin ningun
    contexto clinico alrededor no comunica de que se trata el estudio y le resta credibilidad a la pieza.
    Si el estudio tiene una forma anatomica reconocible de realizarse, especificala en el prompt sin
    dejarla a la interpretacion generica del modelo: un ECOCARDIOGRAMA se hace con el transductor
    apoyado sobre el pecho/torax, cerca del corazon (NUNCA sobre el abdomen -- esa es la pose clasica de
    una ecografia obstetrica/abdominal, la confusion mas comun de la palabra generica "ecografia"), y si
    el monitor del equipo es visible tiene que mostrar una vista cardiaca (camaras del corazon), nunca
    una imagen fetal o abdominal. Un HOLTER TIENE que mostrarse puesto sobre el cuerpo del paciente:
    electrodos adhesivos chicos pegados sobre su pecho, conectados por cables finos a un grabador
    compacto que cuelga de una correa al hombro o se sujeta al cinturon (NUNCA el dispositivo solo,
    apoyado en un escritorio o sostenido en la mano sin estar conectado a un paciente -- esa toma de
    "producto en exhibicion" no comunica que es un monitoreo ambulatorio continuo de 24-48hs sobre el
    cuerpo, que es el punto central de que es un Holter). Un MAPA (monitoreo ambulatorio de presion
    arterial) TIENE que mostrarse con el manguito de presion puesto sobre el brazo del paciente (por
    encima o por debajo de la manga), conectado a un grabador portatil chico en el cinturon o en
    bandolera (NUNCA el manguito solo, exhibido o sostenido aparte sin un brazo puesto adentro -- mismo
    motivo que el Holter: sin el brazo no se entiende que es un monitoreo continuo puesto sobre el
    cuerpo). La misma logica aplica a cualquier otro estudio nombrado en la
    categoria o el tema: el posicionamiento del transductor/equipo sobre el cuerpo del paciente (cuando
    corresponda) y lo que se ve en pantalla tienen que corresponder exactamente a ESE estudio puntual,
    no a un estudio similar o mas generico, y no alcanza con un "product shot" del equipo solo si el
    estudio real requiere que este puesto sobre una persona para tener sentido.
  - Si el tema es sobre habitos, prevencion o factores de riesgo sin un procedimiento en consultorio
    (alimentacion, actividad fisica, presion tomada en casa, adherencia a un tratamiento), preferi un
    momento humano cotidiano vinculado directamente al tema (ej: preparar una comida saludable para un
    tema de colesterol, tomarse la presion en casa para hipertension, salir a caminar para sedentarismo).
  - Si en cambio elegis un objeto como metafora o una naturaleza muerta editorial, el objeto tiene que
    evocar el tema de forma inmediata sin necesitar el texto para entenderse (ej: un plato con alimentos
    altos en grasas para colesterol, una alarma de reloj para chequeos postergados) — evita metaforas
    abstractas o poeticas que solo se entienden leyendo el titular (ej: piedras acumulandose, arena
    cayendo, un nudo desatandose: no comunican "salud" ni "cardiologia" por si solas). No mezcles
    conceptos.
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
- No representar a una medica real ni inventar el rostro de la Dra. Lucia Chahin. Si la escena incluye
  una figura de medica/o (aunque sea parcial: una mano, un brazo, un guardapolvo, sin mostrar el
  rostro), esa figura TIENE que leerse inequivocamente como FEMENINA -- la Dra. Lucia Chahin es mujer y
  es la unica profesional de esta cuenta. Nunca describas ni dejes ambigua una mano, brazo, guardapolvo
  o silueta de aspecto masculino en ese rol: especifica en el prompt que es una mano/muñeca femenina
  (sin inventar el rostro real).
- PROHIBIDO dentro de la imagen: texto adicional al titular y subtitulo solicitados, logos, marcas de agua, interfaces, diagnosticos, estudios legibles, anatomia gore, personas angustiadas, corazon rojo de stock, estetoscopio flotante o ECG decorativo.
- No pedir collages, infografias, posters, flyers, marcos, placas, fondos con gradiente ni composiciones divididas.
- El prompt debe terminar reforzando, en ingles y de forma 100% GENERICA (nunca citando el titular o
  subtitulo especifico entre comillas dentro del prompt): "Render only the exact requested Spanish
  headline and subtitle exactly as provided separately. No extra text, no logos, no watermark." El
  titular y subtitulo real se van a pasar aparte al momento de generar la imagen final -- si citas el
  texto especifico dentro de esta direccion visual, esa cita puede quedar vieja/desactualizada mas
  adelante si el titular o subtitulo cambian despues sin regenerar esta misma direccion visual.
- Inclui "image_alt_text": descripcion accesible en espanol, factual y breve, maximo 180 caracteres.`

// 2026-07-15: Instagram y Google Business NO interpretan Markdown -- un post real salio publicado
// con "###", "**negrita**" y "*" de vineta literales, sin ningun formato, porque el prompt nunca
// lo prohibia explicitamente. Se suma esta regla a los tres generadores de texto publicable
// (generateContentPlan, buildContentPlanPrompt, generateInstagramContent) y ademas una limpieza
// defensiva del lado del codigo (stripMarkdownArtifacts) por si el modelo igual se escapa.
const PLAIN_TEXT_RULES = `FORMATO DE TEXTO (Instagram y Google Business NO interpretan Markdown, todo se publica como texto plano):
- NUNCA uses "#", "##" ni "###" para titulos -- esos simbolos se publican literales, tal cual.
- NUNCA uses "**texto**" para negrita ni "_texto_" para cursiva -- se publican con los asteriscos o guiones bajos incluidos, no como enfasis.
- NUNCA uses "*" ni "-" al inicio de una linea para listas -- se ve como un asterisco o guion suelto, no como una vineta.
- Para dar enfasis puntual usa MAYUSCULAS o un emoji, nunca simbolos de Markdown.
- Para listas, separa cada item con un salto de linea y un emoji o numero seguido de parentesis (ej: "1) ...", "📌 ..."), nunca con "*" ni "-".`

const PATIENT_ACQUISITION_RULES = `CRITERIO DE CAPTACION DE PACIENTES:
- Cada pieza debe seguir esta secuencia: detener el scroll, generar identificacion, entregar una idea util y facilitar el proximo paso.
- El hook y el titular deben ser especificos, faciles de entender en menos de tres segundos y abrir una brecha de curiosidad relevante.
- El hook, el titular y la imagen deben trabajar juntos: la imagen atrae e intriga; el titular aclara la promesa de valor sin repetir literalmente lo mismo.
- Habla de situaciones, dudas o decisiones cotidianas que una persona puede reconocer sin asumir que tiene una enfermedad.
- Entrega valor real antes del CTA: una explicacion clara, un mito corregido, una pregunta util o un motivo concreto para un control preventivo.
- Conecta el aprendizaje con considerar una consulta cardiologica o ecocardiograma cuando corresponda, sin presionar ni prometer resultados.
- El CTA debe reducir friccion y explicar el siguiente paso por canales oficiales. Nunca uses escasez, culpa, miedo o urgencia comercial.
- Evita hooks vagos o genericos como "cuidar tu corazon es importante", "todo lo que tenes que saber" o "la salud es lo primero".`

// 2026-07-19: un pedido con categoria "Investigacion medica" (sin tema) genero contenido sobre
// "diferencia entre electro y eco" -- un tema real, pero que no tiene nada que ver con investigacion
// clinica/evidencia cientifica. La categoria llega como texto libre (no siempre es una de las
// predefinidas) y sin esta regla el modelo puede reinterpretarla hacia un tema cardiologico generico
// que le resulte mas comodo/conocido en vez del significado literal de las palabras pedidas.
const CATEGORY_COHERENCE_RULES = `COHERENCIA CON LA CATEGORIA:
- El tema final tiene que ser una interpretacion directa y reconocible de la categoria pedida, no un tema "inspirado" o tangencialmente relacionado.
- Interpreta la categoria de forma literal segun las palabras que usa. Por ejemplo, "Investigacion medica" es sobre evidencia cientifica, estudios clinicos o avances de la medicina -- no la confundas con "Estudios cardiologicos" (electro, eco, y otros estudios diagnosticos), que es una categoria distinta.
- Si la categoria no es una de las habituales de cardiologia clinica, no la conviertas en la categoria conocida mas parecida: desarrolla el tema tal como fue pedido.
- Alguien que lea solo el hook o el titular tiene que poder reconocer sin dudar que la pieza pertenece a la categoria pedida.`

// 2026-07-22: revisando los hashtags reales de las piezas publicadas, todas caian en el mismo nivel
// (nicho cardiologico + marca: #Cardiologia, #SaludCardiovascular, #DraLuciaChahin repetidos siempre)
// y casi ninguna incluia geolocalizacion -- una mezcla de un solo nivel no ayuda a llegar a gente
// que todavia no sigue la cuenta (la guia vigente de Instagram para descubrimiento fuera de
// seguidores pide mezclar niveles de volumen, no repetir siempre el mismo combo de nicho).
const HASHTAG_RULES = `HASHTAGS (para llegar a gente que todavia no te sigue, no solo a tu audiencia actual):
- Nunca repitas siempre el mismo combo de 3-5 tags de nicho. Cada pieza necesita una mezcla de 3 niveles distintos:
  1) UNO amplio/alto volumen de salud o cardiologia en espanol (ej: #Salud, #Medicina, #CorazonSano, #VidaSaludable) -- pone la pieza al lado de contenido con mucho mas alcance que el de esta cuenta.
  2) UNO o dos de nicho, especificos del tema puntual de la pieza (ej: #Hipertension, #Colesterol, #EcocardiogramaDoppler) -- conectan con quien busca activamente ese tema.
  3) UNO o dos de geolocalizacion, eligiendo la sede mas relevante para el tema/pieza (Lanus/CIMEL, Hospital Britanico/CABA, Lomas de Zamora/Swiss Medical) -- clave para que te encuentre gente cerca buscando un cardiologo, no solo quien ya te sigue.
- No uses "#DraLuciaChahin" en cada pieza: un hashtag de marca ayuda a que te encuentren los que ya te conocen, no a sumar gente nueva. Usalo como maximo en una de cada varias piezas, nunca como tag fijo.
- Minimo 3, maximo 5 hashtags en total (tope de la plataforma).`

const OBJECTIVE_GUIDANCE: Record<ContentObjective, string> = {
  alcance: "Objetivo ALCANCE: priorizá un hook que genere curiosidad, sorpresa o identificación inmediata para maximizar alcance y comentarios. El CTA puede ser una pregunta abierta o invitar a comentar/guardar, no hace falta que invite a pedir turno.",
  educacion: "Objetivo EDUCACION: priorizá dejar un aprendizaje concreto y accionable, algo que valga la pena guardar. El CTA invita a guardar la pieza para el próximo control, no hace falta que invite a pedir turno ahora.",
  confianza: "Objetivo CONFIANZA: priorizá mostrar cercanía, criterio médico y empatía por sobre dar información nueva. El CTA invita a comentar una duda o conocer más sobre la consulta.",
  conversion: "Objetivo CONVERSION: priorizá conectar el aprendizaje con la decisión de pedir turno. El CTA invita explícitamente a pedir turno por los canales disponibles.",
}

// 2026-07-23, reescrito el mismo dia a pedido explicito de Seba: el criterio anterior (B-roll
// cinematografico de consultorio -- estetoscopio en una mesa, plantas, dolly lento) generaba clips
// que "parecen publicidad generica de IA", no contenido educativo. Nuevo criterio: Veo genera
// UNICAMENTE el fondo/elemento animado (una ilustracion o motion graphic medico simple, tipo
// microinfografia -- nunca una escena de consultorio ni personas), y el texto (gancho, mensajes,
// CTA) se agrega despues por edicion real (ver burnVideoBrief en video-caption.ts), nunca generado
// por Veo. Ver VIDEO_BRIEF_RULES para la estructura de contenido (gancho/mensajes/CTA) que se
// compone encima de este video.
const VIDEO_PROMPT_RULES = `DIRECCION DE VIDEO PARA VEO (fondo animado de una microinfografia medica, reel generado con IA):
- Inclui "video_prompt": el prompt final que se manda directo al modelo de video, en ingles para maximizar precision, sin instrucciones conversacionales ni explicaciones.
- Describe UN SOLO plano continuo de 4 a 8 segundos (Veo genera un clip corto por pedido) -- este video es solo el FONDO/elemento animado de una pieza educativa; el texto (titulo, mensajes, CTA) se agrega despues por edicion, nunca lo genera Veo.
- OBJETIVO DE LA ESCENA: una ilustracion o motion graphic medico simple y moderno que refuerce visualmente el tema puntual (ej: un corazon estilizado latiendo con una linea de ECG dibujandose, un icono de tensiometro con el manguito inflandose, una comparacion visual simple) -- no una escena fotorealista de consultorio. Tiene que poder servir de fondo detras de texto sin competir con el.
- PROHIBIDO TERMINANTE (esto generaba el problema real reportado -- se ve como publicidad generica de IA, no como contenido educativo):
  - Consultorios vacios, estetoscopios apoyados sobre una mesa, plantas de decoracion, medicos caminando por pasillos.
  - Primeros planos de "maquinas medicas" genericas o ficticias sin proposito educativo claro.
  - Camara haciendo un dolly-in/acercamiento lento y cinematografico durante los 8 segundos como unico recurso visual -- el movimiento tiene que ser sutil y funcional (un pulso, un brillo, una linea de ECG dibujandose, un leve cambio de escala), no una toma de "publicidad de clinica premium".
  - Personas hablando a camara, moviendo los labios, gesticulando como si explicaran algo, mirando fijo al lente, entrevistas o testimoniales -- se nota muchisimo como IA falsa y rompe la confianza que la pieza necesita generar.
  - Interfaces o pantallas medicas inventadas (monitores con UI ficticia, ECG decorativo sin sentido).
  - Estetica futurista, hologramas, luces neon.
  - Apariencia de publicidad de clinica privada de lujo (marmol, iluminacion dramatica, glamour).
  - Anatomia deformada o gore.
  - MOCKUP DE TELEFONO O APP: nunca encuadrar la escena como si fuera la captura de pantalla de un telefono o una app (por ejemplo, un icono de tensiometro/gauge NO tiene que dibujarse dentro de un marco de telefono). Esto esta PROHIBIDO: el plano no puede simular ser la pantalla de un dispositivo -- es una ilustracion a pantalla completa (full-bleed), nunca un telefono/tablet dentro del cuadro, nunca un marco de dispositivo, nunca una barra de estado, reloj, hora, iconos de notificacion/senal/bateria, ni ningun texto que parezca un nombre de app o marca.
- ESTILO VISUAL: fondo claro o institucional (nunca oscuro/cinematografico), paleta sobria de azul profundo, verde azulado o neutros calidos -- NUNCA rosa como color dominante. Ilustracion limpia, moderna, plana o semi-plana (no fotorealista tipo stock), anatomicamente razonable si se muestra un organo. Maximo 2-3 planos (Veo genera uno solo por pedido, esto aplica si en el futuro se encadenan varias generaciones).
- Sonido: termina siempre pidiendo explicitamente "ambient sound only, no dialogue, no voiceover, no spoken words, no lip movement, no one addressing the camera" -- Veo genera audio nativo, y sin esta instruccion puede inventar voces o dialogo falso.
- Consistencia de marca: manten el mismo lenguaje visual (paleta, estilo de ilustracion) entre piezas distintas para que se sientan parte de la misma cuenta, no generaciones sueltas sin relacion.
- Si por algun motivo aparece una figura humana parcial (una mano, nunca el rostro real de la Dra. Lucia Chahin ni de nadie identificable), tiene que leerse inequivocamente FEMENINA si se sugiere que es la medica.
- PROHIBIDO en el plano: texto en pantalla, subtitulos, logos, marcas de agua, numeros o cifras renderizadas por el modelo (esos van en la superposicion de texto real, no acá).
- Aspecto vertical 9:16 siempre (es para un reel).
- Termina "video_prompt" reforzando en ingles: "Clean modern medical motion graphic / illustration style, full-bleed illustration filling the entire frame, not a phone or app screenshot, no phone mockup or device frame, no status bar, no clock or time display, no notification/signal/battery icons, no fake app name or logo, light background, no people speaking or looking at camera, no on-screen text, logos or watermark, ambient sound only, no dialogue, no voiceover."`

// 2026-07-23: estructura y criterio de contenido para la "microinfografia medica animada" -- reglas
// de Seba, transcriptas casi literal porque son muy especificas (ejemplos exactos de ganchos buenos y
// frases vacias a evitar). Alimenta generateVideoBrief(), que genera TODO el contenido de texto de la
// pieza (gancho, mensajes, CTA) en espanol -- Veo nunca ve ni genera este texto, ver VIDEO_PROMPT_RULES.
const VIDEO_BRIEF_RULES = `MICROINFOGRAFIA MEDICA ANIMADA -- estructura obligatoria de un reel de 8 segundos:
El objetivo NO es una escena cinematografica. Es una pieza que detiene el scroll, ensena algo util y
termina con una llamada a la accion -- como una infografia que se mueve, no un video publicitario.

ESTRUCTURA (los tiempos son fijos, no los cambies):
- 0,0 a 1,2 segundos -- "hook": un gancho inmediato que se entiende sin sonido. Tiene que verse grande
  y reconocible en el primer segundo. Ejemplos de gancho que SI funcionan: "¿Sentís palpitaciones?",
  "Así cambia el ritmo de tu corazón", "¿La presión alta siempre da síntomas?", "3 señales para
  consultar al cardiólogo".
- 1,2 a 6,2 segundos -- "messages": 1 a 3 mensajes secundarios como maximo, con informacion util y
  concreta (no mas de eso -- si hay mas de 3 ideas, elegi las mas fuertes y descarta el resto).
- 6,2 a 8,0 segundos -- "cta": cierre breve. Ejemplos: "Consultá con cardiología", "Pedí turno desde
  el link de la bio", "Guardalo para recordarlo". El CTA nunca puede ser mas largo ni mas protagonico
  que la informacion -- primero se aporta valor, despues se invita a la accion.

REDACCION DEL GANCHO Y LOS MENSAJES:
- Maximo 6 a 9 palabras importantes visibles en pantalla al mismo tiempo (pensa en tarjetas de texto
  grandes y legibles, no parrafos).
- PROHIBIDAS las frases vacias/genericas -- estas frases especificas estan explicitamente prohibidas,
  nunca las generes ni una variacion cercana: "Tu corazón merece lo mejor", "Un chequeo puede
  cambiarlo todo", "Cuidarte es amarte", "La prevención es la clave". Reemplaza siempre por
  informacion especifica y verificable. Ejemplo: en vez de "Cuidá tu corazón", usa "¿Tu presión supera
  repetidamente 140/90?" o "¿Las palpitaciones vienen acompañadas de mareo?" o "¿Sabías que la
  hipertensión puede no dar síntomas?".
- Contenido a priorizar (elegi UNO como eje de la pieza, no mezcles varios): sintomas con los que una
  persona pueda identificarse: mitos y verdades; comparaciones visuales; senales para hacer una
  consulta; explicaciones simples de estudios cardiologicos; prevencion cardiovascular; situaciones
  cotidianas (subir escaleras, hacer ejercicio, sentir palpitaciones, controlar la presion).

PRECISION MEDICA (igual de estricto que el resto del contenido de esta cuenta):
- No inventes sintomas, diagnosticos, cifras ni recomendaciones -- toda cifra o dato tiene que ser
  informacion medica general validada, nunca inventada para que suene mas concreta.
- Nunca un diagnostico individual, nunca una promesa tipo "un chequeo te salvara", nunca generar miedo
  innecesario (ver tambien PATIENT_ACQUISITION_RULES: nunca escasez, culpa, miedo ni urgencia comercial).
- Nunca presentar como normal un sintoma que en realidad podria requerir atencion urgente.

CRITERIOS QUE HACEN QUE UNA PROPUESTA NO SIRVA (tenelos en cuenta al puntuarte a vos mismo mas abajo):
No entenderse en el primer segundo sin sonido; poder ser usada por cualquier medico de cualquier
especialidad (no especifica de cardiologia); mostrar solo objetos o un consultorio sin ensenar nada;
depender del audio para entenderse; un CTA que ocupa mas tiempo o espacio que la informacion; no dejar
ganas de guardarla o compartirla; sentirse como un banco de imagenes o una publicidad generica.

PUNTAJE (autoevaluate del 1 al 5 en cada dimension, honesto -- no pongas todo en 5 por default):
- scroll_stop: ¿el gancho detiene el scroll en el primer segundo?
- clarity: ¿se entiende el tema sin sonido, de un vistazo?
- utility: ¿ensena algo concreto y especifico, no una frase vacia?
- credibility: ¿es médicamente preciso, sin inventar datos ni prometer resultados?
- legibility: ¿el texto propuesto entra comodo en pantalla (maximo 6-9 palabras visibles a la vez)?
- brand_consistency: ¿coherente con el tono cercano-profesional de la cuenta, sin ser frio ni dramatico?`

export function buildContentPlanPrompt(input: {
  topic: string
  category: string
  format: string
  cta: string
  objective?: ContentObjective
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

  return `Sos la Dra. Lucía Chahin, cardióloga, y escribís vos misma el contenido de tu cuenta para Instagram y Google Business.

CONTEXTO:
- Atendés martes en CIMEL Lanús (Tucumán 1314), miércoles en Hospital Británico (Perdriel 74, CABA) y viernes en Swiss Medical Lomas
- La app NO reserva turnos ni da diagnósticos
- Objetivo: educar, generar conciencia cardiovascular e invitar a pedir turno

REGLAS OBLIGATORIAS:
- Todo en español rioplatense
- SIEMPRE en primera persona, como si vos misma estuvieras escribiendo (ej: "atiendo los martes en CIMEL", "cuando venís al consultorio te voy a preguntar..."). NUNCA hables de vos misma en tercera persona ("la Dra. Chahin", "ella", "Lucía te espera")
- Basate en conocimiento médico actualizado y evidencia general sobre el tema
- Podés incorporar datos recientes, estadísticas o avances que conozcas sobre el tema
- No diagnósticos ni tratamientos personalizados
- No afirmaciones médicas personalizadas ni promesas de resultados
- No lenguaje alarmista ni que asuma condiciones del lector
- Ante síntomas de alarma → siempre derivar a guardia
- El cierre debe invitar a pedir turno con vos, nunca con un "médico de confianza" genérico
- NUNCA inventes teléfonos, direcciones web, nombres de apps ni otros canales de contacto que no te hayan sido provistos explícitamente

${PLAIN_TEXT_RULES}

${IMAGE_PROMPT_RULES}

${PATIENT_ACQUISITION_RULES}

${CATEGORY_COHERENCE_RULES}

${HASHTAG_RULES}

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
${input.objective ? OBJECTIVE_GUIDANCE[input.objective] : ""}
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
Cada slide tiene "headline" (máx. 40 caracteres), "text" (1-2 oraciones del contenido de esa slide) e
"image_prompt" (prompt visual en inglés para esa slide puntual, siguiendo la DIRECCION VISUAL PARA GEMINI
de arriba — una escena distinta a la portada y al resto de las slides, que corresponda a lo que dice esa
slide, pero con la misma paleta y tratamiento editorial que la portada).
Usá exactamente estas claves:

{
  "hook": "frase gancho para la portada del carrusel",
  "caption": "caption completo (150-300 palabras). Estructurá con introducción + puntos clave de cada slide.",
  "google_text": "texto para Google Business, máximo 1500 caracteres",
  "hashtags": "#hashtag1 #hashtag2 (3-5, mezclando niveles según HASHTAG_RULES de arriba)",
  "visual_headline": "título de la portada, máximo 40 caracteres",
  "visual_subtitle": "subtítulo de la portada, máximo 60 caracteres",
  "visual_style": "rose",
  "image_prompt": "prompt visual detallado listo para que Gemini genere la portada final",
  "image_alt_text": "descripcion accesible breve en espanol",
  "slides": [
    {"headline": "Slide 1 — título", "text": "Contenido de esta slide en 1-2 oraciones.", "image_prompt": "escena distinta para esta slide"},
    {"headline": "Slide 2 — título", "text": "Contenido de esta slide.", "image_prompt": "escena distinta para esta slide"},
    {"headline": "Slide 3 — título", "text": "Contenido de esta slide.", "image_prompt": "escena distinta para esta slide"},
    {"headline": "Slide 4 — título", "text": "Contenido de esta slide.", "image_prompt": "escena distinta para esta slide"}
  ]
}` : `Usá exactamente estas claves:

{
  "hook": "frase gancho de 1-2 líneas para captar atención en Instagram",
  "caption": "caption completo para Instagram con emojis y párrafos (150-300 palabras)",
  "google_text": "texto para publicación en Google Business, máximo 1500 caracteres",
  "hashtags": "#hashtag1 #hashtag2 (3-5, mezclando niveles según HASHTAG_RULES de arriba)",
  "visual_headline": "titular para la placa visual, máximo 60 caracteres",
  "visual_subtitle": "subtítulo para la placa visual, máximo 80 caracteres",
  "visual_style": "rose",
  "image_prompt": "prompt visual detallado listo para que Gemini genere la placa final",
  "image_alt_text": "descripcion accesible breve en espanol"
}`}`
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
  const systemText = `${SPANISH_INSTRUCTION}\n\n${options.system}`
  const response = await getAnthropic().messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: options.maxTokens,
    system: options.cacheSystem
      ? [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }]
      : systemText,
    messages: options.messages,
  })
  return response.content.filter(b => b.type === "text").map(b => b.text).join("")
}

async function generateWithGemini(options: GenerateOptions): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("GEMINI_API_KEY no esta configurada.")
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash"
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
          thinkingConfig: { thinkingBudget: 0 },
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
  const cacheMode = options.cacheMode ?? "safe_non_personal"

  if (cacheMode === "safe_non_personal") {
    const cached = await getCachedOutput(promptHash)
    if (cached) return cached
  }

  const errors: unknown[] = []
  const providerOrder = options.provider ? [options.provider] : getProviderOrder()
  for (const provider of providerOrder) {
    const model = provider === "gemini"
      ? (process.env.GEMINI_MODEL ?? "gemini-3.5-flash")
      : (process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6")
    try {
      const text = provider === "gemini"
        ? await generateWithGemini(options)
        : await generateWithAnthropic(options)
      // Un proveedor en modo JSON puede devolver texto no vacio pero truncado/invalido (visto en vivo
      // con Gemini: finishReason "STOP" y candidatesTokenCount muy por debajo de maxOutputTokens, pero
      // el JSON corta a mitad de un string sin cerrar comillas/llaves -- intermitente, no depende del
      // prompt). generateWithGemini/generateWithAnthropic no lo detectan porque devuelven texto no
      // vacio sin error. Validar aca, ANTES de cachear y ANTES de loguear exito, para que se trate
      // como una falla real de este proveedor: dispara el fallback al proximo proveedor del loop en
      // vez de propagar un JSON invalido al caller (que antes terminaba en el mensaje generico "No se
      // pudo generar la respuesta con IA", confundiendo con un problema de configuracion) y evita
      // cachear para siempre una respuesta truncada bajo el mismo promptHash.
      if (options.json) {
        try {
          JSON.parse(text)
        } catch {
          throw new Error(`El proveedor de IA (${provider}) devolvio una respuesta JSON incompleta o invalida.`)
        }
      }
      if (cacheMode === "safe_non_personal") {
        await saveCachedOutput(promptHash, purpose, promptText, text)
      }
      await logRequest(provider, model, promptHash, purpose, true)
      return text
    } catch (error) {
      errors.push(error)
      await logRequest(
        provider,
        model,
        promptHash,
        purpose,
        false,
        cacheMode === "none" ? "patient_context_request_failed" : (error instanceof Error ? error.message : String(error))
      )
      if (options.provider || getRequestedProvider() !== "auto") break
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
  if (normalized.startsWith("daily_video_limit_exceeded:")) {
    const limit = message.split(":")[1]
    return `Se alcanzó el límite diario de ${limit} videos generados con IA (tiene costo real por generación). Esperá hasta mañana o subí un video propio.`
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
  if (normalized.includes("json incompleta") || normalized.includes("json invalida")) {
    return "El proveedor de IA devolvió una respuesta incompleta (suele ser algo puntual). Intentá de nuevo."
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
- No hablas en nombre de CIMEL, Swiss Medical ni del Hospital Britanico
- No prometes atencion ni resultados
- No pedis DNI, estudios, imagenes, ECG ni historia clinica
- Solo pedis datos minimos para seguimiento
- Usas tono claro, calido, profesional y argentino (voseo)
- Haces una pregunta por vez

DATOS OPERATIVOS:
- No inventes ni afirmes sedes, dias, horarios, coberturas, telefonos o disponibilidad.
- La clasificacion no necesita datos operativos; esos valores provienen de configuracion validada.

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

const CLASSIFY_OUTPUT_SCHEMA = z.object({
  intent: z.enum(["turno", "consulta_cardiologia", "ecocardiograma", "cobertura", "lugar_atencion", "consulta_medica", "urgencia", "spam", "otro"]),
  requested_service: z.enum(["consulta_cardiologia", "ecocardiograma", "no_definido"]),
  suggested_location: z.enum(["cimel_lanus", "swiss_lomas", "hospital_britanico", "preguntar"]),
  suggested_day: z.enum(["martes", "miercoles", "viernes", "preguntar"]),
  priority_score: z.number().int().min(1).max(10),
  requires_human: z.boolean(),
  possible_emergency: z.boolean(),
  next_action: z.enum(["responder", "pedir_preferencia", "derivar_cimel", "derivar_swiss", "derivar_britanico", "escalar", "descartar"]),
})

const EMERGENCY_CLASSIFY_RESULT: ClassifyResult = {
  ...MANUAL_CLASSIFY_DEFAULT,
  intent: "urgencia",
  priority_score: 10,
  requires_human: true,
  possible_emergency: true,
  reply_suggestion: EMERGENCY_REPLY,
  next_action: "escalar",
}

const MEDICAL_BOUNDARY_CLASSIFY_RESULT: ClassifyResult = {
  ...MANUAL_CLASSIFY_DEFAULT,
  intent: "consulta_medica",
  priority_score: 7,
  requires_human: true,
  possible_emergency: false,
  reply_suggestion: MEDICAL_BOUNDARY_REPLY,
  next_action: "escalar",
}

export async function classifyMessage(message: string): Promise<ClassifyResult> {
  // Las rutas clínicas conocidas se resuelven antes de cualquier proveedor: no se comparte el
  // texto con IA ni se permite que un modelo decida la respuesta visible.
  if (isEmergencyMessage(message)) return EMERGENCY_CLASSIFY_RESULT
  if (isMedicalBoundaryMessage(message)) return MEDICAL_BOUNDARY_CLASSIFY_RESULT
  if (getAiMode() === "manual") return MANUAL_CLASSIFY_DEFAULT

  const text = await generateText({
    maxTokens: 1024,
    json: true,
    purpose: "classify",
    cacheSystem: true,
    cacheMode: "none",
    system: `${SYSTEM_PROMPT}

Analiza el mensaje del usuario y devolve SOLO un JSON valido con esta estructura exacta:
{
  "intent": "turno | consulta_cardiologia | ecocardiograma | cobertura | lugar_atencion | consulta_medica | urgencia | spam | otro",
  "requested_service": "consulta_cardiologia | ecocardiograma | no_definido",
  "suggested_location": "cimel_lanus | swiss_lomas | hospital_britanico | preguntar",
  "suggested_day": "martes | miercoles | viernes | preguntar",
  "priority_score": 1,
  "requires_human": false,
  "possible_emergency": false,
  "next_action": "responder | pedir_preferencia | derivar_cimel | derivar_swiss | derivar_britanico | escalar | descartar"
}`,
    messages: [{ role: "user", content: message }],
  })
  const parsed = CLASSIFY_OUTPUT_SCHEMA.parse(parseJson<unknown>(text))
  if (parsed.possible_emergency || parsed.intent === "urgencia") {
    return {
      ...parsed,
      intent: "urgencia",
      priority_score: Math.max(parsed.priority_score, 9),
      requires_human: true,
      possible_emergency: true,
      reply_suggestion: EMERGENCY_REPLY,
      next_action: "escalar",
    }
  }
  if (parsed.intent === "consulta_medica") {
    return {
      ...parsed,
      requires_human: true,
      possible_emergency: false,
      reply_suggestion: MEDICAL_BOUNDARY_REPLY,
      next_action: "escalar",
    }
  }
  return {
    ...parsed,
    reply_suggestion: parsed.requires_human
      ? "Gracias por escribirnos. Una persona del equipo va a revisar tu consulta desde el Inbox."
      : "Gracias por escribirnos. Podemos orientarte sobre sedes y canales oficiales para pedir turno.",
  }
}

const WHATSAPP_INTENTS = [
  "pedir_turno", "consultar_cobertura", "derivar_protocolo", "ubicacion_horarios",
  "estudios_cardiologicos", "urgencia_medica", "cancelar_reprogramar", "hablar_con_humano",
  "turno_ya_resuelto", "otro_no_entendido",
] as const

const WHATSAPP_INTENT_OUTPUT_SCHEMA = z.object({
  intent: z.enum(WHATSAPP_INTENTS),
}).strict()

/**
 * Respaldo del clasificador determinístico del bot de WhatsApp (src/lib/whatsapp-intents.ts) cuando
 * ningún patrón de reglas matchea. Devuelve siempre uno de los 9 intents cerrados, nunca texto libre.
 */
export async function classifyWhatsAppIntent(text: string, provider?: AiProvider): Promise<WhatsAppIntent> {
  if (getAiMode() === "manual") return "otro_no_entendido"

  const raw = await generateText({
    // 2026-07-15: probado en vivo contra la API real de Gemini -- con 20 tokens la respuesta
    // siempre llega cortada a mitad del JSON (finishReason: MAX_TOKENS, ej. `{\n  "intent`) porque
    // el modo JSON de Gemini pretty-printea la salida. classifyWhatsAppIntent() nunca clasificaba
    // nada de verdad: parseJson() tiraba (JSON incompleto), el catch de classifyIntent() lo
    // absorbía en silencio y siempre devolvía "otro_no_entendido". Verificado que 60 alcanza de
    // sobra (la respuesta real más larga usó 16 tokens).
    maxTokens: 60,
    json: true,
    purpose: "whatsapp_intent",
    cacheSystem: true,
    cacheMode: "none",
    provider,
    system: `Clasificá el mensaje de un paciente de WhatsApp de una cardióloga en UNA sola de estas categorías exactas: ${WHATSAPP_INTENTS.join(", ")}.
Devolvé SOLO un JSON: {"intent": "..."}. Si no estás seguro de a cuál corresponde, devolvé "otro_no_entendido". Nunca inventes una categoría fuera de la lista.`,
    messages: [{ role: "user", content: text }],
  })
  const parsed = WHATSAPP_INTENT_OUTPUT_SCHEMA.parse(parseJson<unknown>(raw))
  return parsed.intent
}

export async function generateReply(
  message: string,
  leadContext: string,
  conversationHistory: AiMessage[]
): Promise<string> {
  const userContext = [message, ...conversationHistory.filter(item => item.role === "user").map(item => item.content)].join("\n")
  if (isEmergencyMessage(message)) return EMERGENCY_REPLY
  if (isMedicalBoundaryMessage(userContext)) return MEDICAL_BOUNDARY_REPLY

  // Fase 0A: una respuesta dirigida a una persona nunca se redacta con IA. El clasificador puede
  // interpretar mensajes, pero la salida visible siempre proviene de este catálogo fijo.
  void leadContext
  return "Gracias por escribirnos. Este canal puede ayudarte con sedes y formas de pedir turno. Si necesitás otra cosa, una persona del equipo puede revisar tu consulta."
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
    cacheSystem: true,
    system: `Sos la Dra. Lucia Chahin, cardiologa, y escribis vos misma tu contenido para Instagram en primera persona (ej: "atiendo los martes", "cuando venis al consultorio").
Nunca hables de vos misma en tercera persona ("la Dra. Chahin", "ella").
Tono profesional, calido y argentino.
NUNCA prometes resultados medicos, nunca das diagnosticos, nunca asumis condiciones del lector.
El objetivo es informar y captar personas que quieran pedir turno.
${PLAIN_TEXT_RULES}
${HASHTAG_RULES}
Devolve SOLO un JSON con: { "caption": "...", "hook": "...", "hashtags": "..." }`,
    messages: [{ role: "user", content: `Genera un ${type} sobre: ${category}. CTA sugerido: ${cta}` }],
  })
  const parsed = parseJson<{ caption: string; hook: string; hashtags: string }>(text)
  return {
    caption: stripMarkdownArtifacts(parsed.caption),
    hook: stripMarkdownArtifacts(parsed.hook),
    hashtags: parsed.hashtags,
  }
}

// Red de seguridad además de la regla del prompt (PLAIN_TEXT_RULES): si el modelo igual devuelve
// sintaxis de Markdown, se limpia acá antes de guardar/mostrar el texto. El orden importa (negrita
// antes que itálica de un solo asterisco, para no comerse la mitad de un "**texto**"). No toca "#"
// seguido directo de una palabra sin espacio -- eso es un hashtag real de Instagram, no un título.
export function stripMarkdownArtifacts(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "") // títulos "# ", "## ", "### " (con espacio -- no toca "#hashtag")
    .replace(/\*\*(.+?)\*\*/g, "$1") // **negrita**
    .replace(/__(.+?)__/g, "$1") // __negrita alternativa__
    .replace(/^[*-]\s+/gm, "• ") // "* item" / "- item" -> viñeta real
    .replace(/\*(.+?)\*/g, "$1") // *itálica* remanente
}

function capHashtags(raw: string, max = 5): string {
  const tags = raw.match(/#[\p{L}0-9_]+/gu) ?? []
  return tags.slice(0, max).join(" ")
}

export async function generateContentPlan(input: {
  topic: string
  category: string
  format: "reel" | "historia" | "carrusel" | "post"
  cta: string
  objective?: ContentObjective
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
  slides?: Array<{ headline: string; text: string; image_prompt?: string }>
}> {
  const sourceContext = input.source
    ? `Fuente para contextualizar:
Titulo: ${input.source.title}
Publicacion: ${input.source.publication}
Fecha: ${input.source.published_at}
Resumen disponible: ${input.source.summary || "No disponible"}

No inventes resultados que no esten en el resumen. Menciona la fuente de forma general, sin presentar el post como consejo medico.`
    : "No hay fuente reciente seleccionada. Trata el tema como contenido evergreen y no menciones novedades ni estudios recientes."

  const appointmentContext = input.appointment_link
    ? `Link de turnos: ${input.appointment_link}
El caption debe cerrar invitando a pedir turno con la Dra. Lucia Chahin usando ese link. NO invitar a escribir mensajes directos ni a responder al post.`
    : `No hay link de turnos disponible aun. Si el cierre menciona pedir turno, usa "link en la bio" como referencia, sin inventar telefonos, direcciones web ni otros canales de contacto.`

  const slidesSchema = input.format === "carrusel"
    ? `,
  "slides": [
    {"headline": "Slide 1 — titulo, max 40 chars", "text": "1-2 oraciones del contenido.", "image_prompt": "escena distinta a la portada para esta slide"},
    {"headline": "Slide 2", "text": "...", "image_prompt": "escena distinta a la portada y a la slide 1"},
    {"headline": "Slide 3", "text": "...", "image_prompt": "escena distinta a las anteriores"},
    {"headline": "Slide 4", "text": "...", "image_prompt": "escena distinta a las anteriores"}
  ]`
    : ""

  const userContent = `${input.topic.trim()
    ? `Tema o enfoque sugerido: ${input.topic}`
    : "No se definio un tema. Elegi de forma autonoma el enfoque mas atractivo, util y concreto dentro de la categoria."}
Categoria: ${input.category}
Formato Instagram: ${input.format}
CTA: ${input.cta}
${input.objective ? OBJECTIVE_GUIDANCE[input.objective] : ""}

${appointmentContext}

${sourceContext}

${input.format === "carrusel" ? "Es un CARRUSEL: generá 4-5 slides con headline, texto corto e image_prompt propio para cada slide, ademas de la portada. Cada image_prompt tiene que ser una escena distinta, relacionada al contenido puntual de esa slide, no una repeticion de la portada.\n\n" : ""}Devolve:
{
  "hook": "...",
  "caption": "...",
  "google_text": "...",
  "hashtags": "3 a 5, mezclando niveles segun HASHTAG_RULES (amplio + nicho + geo), separados por espacio",
  "visual_headline": "...",
  "visual_subtitle": "...",
  "image_prompt": "...",
  "image_alt_text": "..."${slidesSchema}
}`

  const text = await generateText({
    maxTokens: 2200,
    json: true,
    purpose: "content_plan",
    cacheSystem: true,
    system: `Sos la Dra. Lucia Chahin, cardiologa, y escribis vos misma el contenido de tu cuenta para Instagram y Google Business.
Creas una propuesta editorial lista para revision humana.

Reglas:
- Escribi todo el contenido final en espanol.
- SIEMPRE en primera persona, como si Lucia misma estuviera escribiendo (ej: "atiendo los martes en CIMEL", "cuando venis al consultorio te voy a preguntar..."). NUNCA hables de vos misma en tercera persona ("la Dra. Chahin", "ella", "Lucia te espera").
- No diagnostiques, no indiques tratamientos y no interpretes estudios.
- No hagas afirmaciones medicas personalizadas ni promesas.
- No uses mensajes alarmistas ni asumas que el lector tiene una condicion.
- Ante sintomas de alarma, indica guardia o atencion medica inmediata.
- El objetivo es educar e invitar puntualmente a pedir turno con vos, nunca con un "medico de confianza" generico ni derivando a otro profesional.
- Atendes martes en CIMEL Lanus, miercoles en Hospital Britanico y viernes en Swiss Medical Lomas.
- NUNCA inventes telefonos, direcciones web, nombres de apps ni otros canales de contacto que no te hayan sido provistos explicitamente en el pedido. Si no tenes un link de turnos, usa "link en la bio" nada mas.
- Gemini resolvera despues la placa final e integrara el titular y subtitulo.
${PLAIN_TEXT_RULES}
${IMAGE_PROMPT_RULES}
${PATIENT_ACQUISITION_RULES}
${CATEGORY_COHERENCE_RULES}
${HASHTAG_RULES}
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
        .map(s => ({
          headline: stripMarkdownArtifacts((s.headline as string).slice(0, 60)),
          text: stripMarkdownArtifacts((s.text as string).slice(0, 300)),
          image_prompt: typeof s.image_prompt === "string" ? s.image_prompt.slice(0, 2400) : undefined,
        }))
    : undefined

  return {
    hook: stripMarkdownArtifacts(parsed.hook as string),
    caption: stripMarkdownArtifacts(parsed.caption as string),
    google_text: stripMarkdownArtifacts((parsed.google_text as string).slice(0, 1500)),
    hashtags: capHashtags(parsed.hashtags as string),
    visual_headline: stripMarkdownArtifacts((parsed.visual_headline as string).slice(0, 90)),
    visual_subtitle: stripMarkdownArtifacts((parsed.visual_subtitle as string).slice(0, 90)),
    visual_style: ["rose", "blue", "teal"].includes(parsed.visual_style as string)
      ? parsed.visual_style as "rose" | "blue" | "teal"
      : "blue",
    image_prompt: (parsed.image_prompt as string).slice(0, 2400),
    image_alt_text: stripMarkdownArtifacts((parsed.image_alt_text as string).slice(0, 180)),
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
- The headline and subtitle to render are ONLY the ones given above under CONTENT, character for
  character. If the CREATIVE DIRECTION text above happens to mention, quote or reference any other
  headline or subtitle wording, IGNORE that wording completely -- it may be outdated. Never render
  any text that is not the exact headline and subtitle given under CONTENT.
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

/**
 * Genera la propuesta completa de un reel tipo "microinfografia medica animada" (2026-07-23,
 * reemplaza generateVideoDirection): el gancho (para item.hook), el video_prompt (fondo/animacion
 * para Veo, sin texto -- ver VIDEO_PROMPT_RULES), y el resto del brief estructurado (mensajes, CTA,
 * notas de postproduccion/validacion, autoevaluacion 1-5) segun VIDEO_BRIEF_RULES. La UI bloquea
 * generar el video real si alguna dimension del puntaje da menos de 4.
 */
export async function generateVideoBrief(input: {
  category: string
  topic: string
  objective: ContentObjective
}): Promise<{ hook: string; video_prompt: string; brief: ContentVideoBrief }> {
  if (getAiMode() === "manual") {
    throw new Error("Modo manual activo: la generación automática está deshabilitada.")
  }
  const text = await generateText({
    maxTokens: 1200,
    json: true,
    purpose: "video_brief",
    cacheSystem: true,
    system: `${VIDEO_BRIEF_RULES}

${VIDEO_PROMPT_RULES}

${PATIENT_ACQUISITION_RULES}

Con todas las reglas de arriba, generá la propuesta completa de un reel tipo microinfografía médica
animada de 8 segundos para la cuenta de Instagram de la Dra. Lucía Chahin (cardióloga), sobre la
categoría, el tema y el objetivo editorial que te paso.
Devolvé SOLO un JSON PLANO con esta forma exacta, sin ningún otro campo ni anidamiento distinto:
{
  "hook": "texto del gancho en español, tal como debe verse en pantalla en el primer segundo (0,0-1,2s)",
  "video_prompt": "el prompt en inglés para Veo, siguiendo las reglas de dirección de video de arriba",
  "objective": "una sola oración en español: el objetivo educativo específico de esta pieza puntual",
  "messages": ["mensaje secundario 1", "mensaje secundario 2 (opcional)", "mensaje secundario 3 (opcional)"],
  "cta": "texto del cierre/CTA en español (6,2-8,0s)",
  "postproduction_notes": "en español: elementos que deberían agregarse o ajustarse en postproducción",
  "validation_notes": "en español: qué debería validar puntualmente la Dra. Lucía antes de aprobar",
  "scores": { "scroll_stop": 1-5, "clarity": 1-5, "utility": 1-5, "credibility": 1-5, "legibility": 1-5, "brand_consistency": 1-5 }
}`,
    messages: [{
      role: "user",
      content: `Categoría: ${input.category}\nTema: ${input.topic}\n${OBJECTIVE_GUIDANCE[input.objective]}`,
    }],
  })
  const parsed = parseJson<{
    hook?: unknown; video_prompt?: unknown; objective?: unknown; messages?: unknown; cta?: unknown
    postproduction_notes?: unknown; validation_notes?: unknown; scores?: unknown
  }>(text)

  const messages = Array.isArray(parsed.messages)
    ? parsed.messages.filter((m): m is string => typeof m === "string" && Boolean(m.trim())).slice(0, 3)
    : []
  if (typeof parsed.hook !== "string" || !parsed.hook.trim() ||
    typeof parsed.video_prompt !== "string" || !parsed.video_prompt.trim() ||
    messages.length === 0) {
    throw new Error("La IA devolvió una propuesta de video incompleta.")
  }

  const rawScores = (parsed.scores ?? {}) as Record<string, unknown>
  const clampScore = (key: keyof ContentVideoScores) =>
    typeof rawScores[key] === "number" ? Math.min(5, Math.max(1, Math.round(rawScores[key] as number))) : 1
  const scores: ContentVideoScores = {
    scroll_stop: clampScore("scroll_stop"),
    clarity: clampScore("clarity"),
    utility: clampScore("utility"),
    credibility: clampScore("credibility"),
    legibility: clampScore("legibility"),
    brand_consistency: clampScore("brand_consistency"),
  }

  return {
    hook: parsed.hook,
    video_prompt: parsed.video_prompt,
    brief: {
      objective: typeof parsed.objective === "string" ? parsed.objective : "",
      messages,
      cta: typeof parsed.cta === "string" ? parsed.cta : "",
      postproduction_notes: typeof parsed.postproduction_notes === "string" ? parsed.postproduction_notes : "",
      validation_notes: typeof parsed.validation_notes === "string" ? parsed.validation_notes : "",
      scores,
    },
  }
}

const VEO_POLL_INTERVAL_MS = 10_000
// Deja margen debajo del maxDuration (280s) de /api/content/video: el pedido inicial + la descarga
// final tambien consumen tiempo dentro de esa misma funcion serverless.
const VEO_POLL_TIMEOUT_MS = 260_000

/**
 * Genera el UNICO plano de video de un reel con Veo (Gemini API). A diferencia de generateContentVisual
 * (respuesta sincronica en segundos), Veo es un proceso asincronico de "operacion de larga duracion":
 * se pide, se consulta el progreso cada VEO_POLL_INTERVAL_MS hasta que termina (puede tardar 1-3 min),
 * y recien ahi se descarga el archivo final (el video de Google solo esta disponible 48hs, por eso se
 * descarga y persiste en Storage de una via la ruta que llama a esta funcion, nunca se linkea directo).
 * No tiene tier gratuito (a diferencia de las placas) -- cada llamada exitosa tiene costo real, por eso
 * usa su propio limite diario mas estricto (DAILY_VIDEO_GENERATION_LIMIT), separado de
 * DAILY_AI_REQUEST_LIMIT.
 */
export async function generateContentVideo(input: {
  video_prompt: string
}): Promise<{ mime_type: string; video_data: string }> {
  if (getAiMode() === "manual") {
    throw new Error("Modo manual activo: la generación automática está deshabilitada.")
  }
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("GEMINI_API_KEY no esta configurada.")

  const dailyLimit = Number(process.env.DAILY_VIDEO_GENERATION_LIMIT ?? 3)
  if (await getDailyRequestCount("content_video") >= dailyLimit) {
    throw new Error(`DAILY_VIDEO_LIMIT_EXCEEDED:${dailyLimit}`)
  }

  const model = process.env.GEMINI_VIDEO_MODEL || "veo-3.1-fast-generate-preview"
  const promptHash = hashPrompt(input.video_prompt)
  const base = "https://generativelanguage.googleapis.com/v1beta"

  try {
    const startRes = await fetch(`${base}/models/${encodeURIComponent(model)}:predictLongRunning`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: input.video_prompt }],
        parameters: { aspectRatio: "9:16", resolution: "720p" },
      }),
    })
    const startData = await startRes.json() as { name?: string; error?: { message?: string } }
    if (!startRes.ok || !startData.name) {
      throw new Error(startData.error?.message || `Veo respondio con estado ${startRes.status}.`)
    }

    const startedAt = Date.now()
    let statusData: {
      done?: boolean
      error?: { message?: string }
      response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } }
    } = {}
    while (Date.now() - startedAt < VEO_POLL_TIMEOUT_MS) {
      await new Promise(resolve => setTimeout(resolve, VEO_POLL_INTERVAL_MS))
      const statusRes = await fetch(`${base}/${startData.name}`, { headers: { "x-goog-api-key": apiKey } })
      statusData = await statusRes.json()
      if (!statusRes.ok) throw new Error(`Veo respondio con estado ${statusRes.status} al consultar el progreso.`)
      if (statusData.done) break
    }
    if (!statusData.done) throw new Error("Veo no termino de procesar el video a tiempo. Probá de nuevo en unos minutos.")
    if (statusData.error) throw new Error(statusData.error.message || "Veo no pudo generar el video.")

    const videoUri = statusData.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
    if (!videoUri) throw new Error("Veo no devolvió ningún video.")

    const videoRes = await fetch(videoUri, { headers: { "x-goog-api-key": apiKey } })
    if (!videoRes.ok) throw new Error(`No se pudo descargar el video generado (estado ${videoRes.status}).`)
    const videoData = Buffer.from(await videoRes.arrayBuffer()).toString("base64")

    await logRequest("gemini", model, promptHash, "content_video", true)
    return { mime_type: "video/mp4", video_data: videoData }
  } catch (error) {
    await logRequest("gemini", model, promptHash, "content_video", false,
      error instanceof Error ? error.message : String(error))
    throw error
  }
}

export async function generateImageAltText(input: {
  topic: string
  visual_headline: string
  visual_subtitle: string
  image_prompt: string
}): Promise<string> {
  if (getAiMode() === "manual") {
    throw new Error("Modo manual activo: la generación automática está deshabilitada.")
  }
  return generateText({
    maxTokens: 200,
    purpose: "image_alt_text",
    cacheSystem: true,
    system: `Escribis texto alternativo (alt text) de accesibilidad en español para una imagen de una cuenta de Instagram de cardiología.
Reglas:
- Describí objetivamente la escena visual (sujeto, acción, objetos), no el titular ni el mensaje de marketing.
- Máximo 180 caracteres, una sola oración, sin punto final.
- No repitas literalmente el titular ni el subtítulo.
- No inventes texto visible en la imagen ni datos médicos.
Devolvé solo el texto alternativo, sin comillas ni explicaciones.`,
    messages: [{
      role: "user",
      content: `Tema del contenido: ${input.topic}\nTitular de la placa: "${input.visual_headline}"\nSubtítulo: "${input.visual_subtitle}"\nDescripción de la escena (dirección visual en inglés): ${input.image_prompt}`,
    }],
  })
}

/**
 * Pide una direccion visual nueva (image_prompt + image_alt_text) para una pieza ya existente, sin
 * tocar hook/caption/hashtags. Reusa las mismas IMAGE_PROMPT_RULES (incluida la regla de que un objeto
 * como metafora tiene que evocar el tema de inmediato) — sirve para descartar un concepto que no
 * convence sin tener que recrear toda la pieza desde cero.
 */
export async function regenerateImageDirection(input: {
  category: string
  topic: string
  format: "reel" | "historia" | "carrusel" | "post"
  visual_headline: string
  visual_subtitle: string
  caption: string
  previous_image_prompt?: string
}): Promise<{ image_prompt: string; image_alt_text: string }> {
  if (getAiMode() === "manual") {
    throw new Error("Modo manual activo: la generación automática está deshabilitada.")
  }
  const avoidPrevious = input.previous_image_prompt
    ? `\nLa direccion anterior fue esta, DESCARTALA y proponé un concepto visual distinto (otro sujeto/escena, no una variacion menor): """${input.previous_image_prompt}"""`
    : ""
  const text = await generateText({
    maxTokens: 700,
    json: true,
    purpose: "image_direction",
    system: `${IMAGE_PROMPT_RULES}

Te paso una pieza de contenido ya escrita (categoria, tema, titular, subtitulo y el caption completo
que va a acompañar la placa). Tu tarea es proponer una direccion visual nueva para esa UNICA imagen
puntual (la portada, o si el titular/subtitulo corresponden a una slide de un carrusel, esa slide
puntual nada mas -- nunca el carrusel completo), siguiendo las reglas de arriba. La escena tiene que
guardar correlacion concreta con lo que dice el caption (el gancho, el ejemplo o la idea central que
desarrolla), no solo con el titular corto — si el caption habla de un habito, una situacion o un dato
puntual, la imagen deberia reflejar eso mismo en vez de una escena generica de la categoria.
Devolve SOLO un JSON PLANO con esta forma exacta, sin importar el formato: { "image_prompt": "...", "image_alt_text": "..." }
Nunca devuelvas un array "slides" ni ninguna otra forma -- es SIEMPRE este unico objeto con esas dos claves.`,
    messages: [{
      role: "user",
      content: `Categoria: ${input.category}\nTema: ${input.topic}\nFormato: ${input.format}\nTitular: "${input.visual_headline}"\nSubtitulo: "${input.visual_subtitle}"\nCaption completo:\n${input.caption}${avoidPrevious}`,
    }],
  })
  const parsed = parseJson<{ image_prompt?: unknown; image_alt_text?: unknown }>(text)
  if (typeof parsed.image_prompt !== "string" || typeof parsed.image_alt_text !== "string") {
    throw new Error("La IA devolvió una respuesta incompleta para la dirección visual.")
  }
  return {
    image_prompt: parsed.image_prompt.slice(0, 2400),
    image_alt_text: parsed.image_alt_text.slice(0, 180),
  }
}

export async function generateGooglePost(topic: string): Promise<string> {
  if (getAiMode() === "manual") {
    throw new Error("Modo manual activo: la generación automática está deshabilitada.")
  }
  return generateText({
    maxTokens: 512,
    purpose: "google_post",
    cacheSystem: true,
    system: `Sos la Dra. Lucia Chahin, cardiologa, y escribis vos misma tu publicacion para Google Business Profile en primera persona (ej: "atiendo los martes", nunca "la Dra. Chahin atiende").
Tono profesional y claro. Maximo 1500 caracteres. Sin promesas medicas.
Siempre inclui donde atendes (CIMEL Lanus los martes, Hospital Britanico los miercoles, Swiss Medical Lomas los viernes).
NUNCA incluyas numeros de telefono en el texto: Google Business Profile bloquea o rechaza publicaciones que contienen telefonos. Si hay que decir como pedir turno, remiti al perfil, a la app de la institucion o al link de la bio.
${PLAIN_TEXT_RULES}
Solo devolve el texto de la publicacion.`,
    messages: [{ role: "user", content: `Publicacion sobre: ${topic}` }],
  }).then(stripMarkdownArtifacts)
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
    cacheSystem: true,
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
  const userContext = conversationHistory.filter(item => item.role === "user").map(item => item.content).join("\n")
  if (isEmergencyMessage(userContext)) return EMERGENCY_REPLY
  if (isMedicalBoundaryMessage(userContext)) return MEDICAL_BOUNDARY_REPLY

  // Igual que generateReply(): el texto visible es administrativo y aprobado, no salida libre de IA.
  void leadContext
  return "Hola, te escribimos para saber si pudiste pedir turno con la Dra. Lucía Chahin. Si tuviste algún problema, podemos volver a pasarte los canales oficiales. Respondé: 1) Ya pedí turno 2) No pude 3) Necesito los datos de nuevo."
}
