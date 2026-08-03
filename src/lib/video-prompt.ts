import type { VideoGenerationVersion } from "@/types"

const V1_REQUIRED_STYLE_PATTERN = /(?:motion graphic|illustration|flat|semi-flat)/i
const V2_CAMERA_PATTERN = /(?:locked tripod|slow lateral slider|slow controlled push-in)/i
const V2_SYNTHETIC_PATTERNS: Array<{ pattern: RegExp; issue: string }> = [
  {
    pattern: /(?:2d|two-dimensional|paper[- ]cut|cut[- ]paper|flat vector|motion graphic|3d render|cgi|illustration)/i,
    issue: "pide una estética ilustrada o sintética en vez de una toma documental real",
  },
  {
    pattern: /(?:photorealistic|hyperrealistic|cinematic b-?roll|luxury clinic|premium clinic)/i,
    issue: "usa lenguaje típico de publicidad generativa que suele producir una escena artificial",
  },
  {
    pattern: /\b(?:doctor|physician|nurse|clinician|patient|woman|man|hands?|fingers?|face|person|people)\b/i,
    issue: "incluye personas o partes del cuerpo, donde los artefactos de IA son más evidentes",
  },
  {
    pattern: /clinic(?:al)? (?:office|room|practice)|consulting room|hospital corridor|stethoscope|anatomical (?:heart )?model|medical monitor|tablet screen|ecg screen/i,
    issue: "incluye escenarios o utilería clínica genérica que suele verse falsa",
  },
]

const COMMON_VEO_PARAMETERS = {
  aspectRatio: "9:16",
  resolution: "720p",
  durationSeconds: 8,
} as const

/**
 * Google recomienda expresar el negative prompt como una lista de elementos no deseados, sin
 * instrucciones del tipo "no hagas". Se aplica solo a V2; V1 conserva el request histórico.
 */
export const VEO_V2_NEGATIVE_PROMPT = [
  "on-screen text", "letters", "numbers", "captions", "logos", "watermarks", "phone interface",
  "human figures", "faces", "hands", "fingers", "medical staff", "patients", "clinical office",
  "hospital room", "stethoscope", "anatomical heart model", "medical monitor", "invented medical device",
  "paper-cut art", "layered paper", "flat vector", "illustration", "3D render", "CGI", "plastic texture",
  "warped geometry", "duplicated objects", "morphing objects", "floating objects", "unnatural motion",
  "dramatic lighting", "neon", "glossy luxury advertising", "stock-footage aesthetic",
].join(", ")

export function getVeoRequestParameters(version: VideoGenerationVersion) {
  return version === "v2"
    ? { ...COMMON_VEO_PARAMETERS, negativePrompt: VEO_V2_NEGATIVE_PROMPT }
    : COMMON_VEO_PARAMETERS
}

/**
 * V1 recupera la dirección anterior al motor documental. Es la microinfografía ilustrada clásica:
 * Veo dibuja el fondo animado y FFmpeg agrega el texto real.
 */
export const VIDEO_PROMPT_RULES_V1 = `DIRECCION DE VIDEO PARA VEO (fondo animado de una microinfografia medica, reel generado con IA):
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
  - MOCKUP DE TELEFONO O APP: nunca encuadrar la escena como si fuera la captura de pantalla de un telefono o una app. El plano es una ilustracion full-bleed, nunca un telefono/tablet dentro del cuadro, marco de dispositivo, barra de estado, reloj, iconos de notificacion/senal/bateria ni nombre de app o marca.
- ESTILO VISUAL: fondo claro o institucional (nunca oscuro/cinematografico), paleta sobria de azul profundo, verde azulado o neutros calidos -- NUNCA rosa como color dominante. Ilustracion limpia, moderna, plana o semi-plana (no fotorealista tipo stock), anatomicamente razonable si se muestra un organo.
- Sonido: termina siempre pidiendo explicitamente "ambient sound only, no dialogue, no voiceover, no spoken words, no lip movement, no one addressing the camera".
- Consistencia de marca: manten el mismo lenguaje visual (paleta, estilo de ilustracion) entre piezas distintas.
- Si aparece una figura humana parcial (una mano, nunca el rostro real de la Dra. Lucia Chahin ni de nadie identificable), tiene que leerse inequivocamente FEMENINA si se sugiere que es la medica.
- PROHIBIDO en el plano: texto en pantalla, subtitulos, logos, marcas de agua, numeros o cifras renderizadas por el modelo.
- Aspecto vertical 9:16 siempre (es para un reel).
- Termina "video_prompt" reforzando en ingles: "Clean modern medical motion graphic / illustration style, full-bleed illustration filling the entire frame, not a phone or app screenshot, no phone mockup or device frame, no status bar, no clock or time display, no notification/signal/battery icons, no fake app name or logo, light background, no people speaking or looking at camera, no on-screen text, logos or watermark, ambient sound only, no dialogue, no voiceover."`

/**
 * V2 sigue la guía vigente de Google para clips cortos: una escena concreta, sujeto, acción física,
 * cámara, composición, lente/luz y ambiente. Las exclusiones se envían aparte como negativePrompt.
 */
export const VIDEO_PROMPT_RULES_V2 = `DIRECCION V2 PARA VEO (video editorial documental, calidad publicable):
- Inclui "video_prompt" en ingles, autocontenido y listo para Veo. Tiene que empezar exactamente con "An 8-second vertical 9:16 natural documentary video."
- Es UN SOLO momento continuo, no una secuencia de escenas. Describe un sujeto físico principal, una accion sencilla y un unico movimiento de camara como maximo.
- Estructura el prompt en este orden y usa estas etiquetas: "Subject and setting:", "Physical motion:", "Camera and composition:", "Natural light and finish:", "Ambient sound:".
- SUJETO Y ESCENA: elegi una situacion cotidiana real, sobria y reconocible que conecte con el tema sin representarlo de forma literal. Usa uno o dos objetos comunes, de geometria simple y sin letras visibles. Para turnos, controles o seguimiento, prioriza una agenda cerrada sin texto, llaves, lentes, calzado para caminar, una taza o luz de ventana. Para prevencion y habitos, elegi una accion ambiental real como luz moviendose, vapor suave, cortinas o hojas con brisa. Si el tema requeriria anatomia, personas o equipamiento medico para mostrarlo literalmente, usa una situacion cotidiana indirecta en vez de inventar una recreacion clinica.
- MOVIMIENTO: solo movimiento fisicamente plausible y sutil durante los 8 segundos. El objeto principal conserva exactamente su forma, escala y cantidad; no aparece, desaparece, se transforma ni flota. Evita metamorfosis y transiciones generativas.
- CAMARA: elegi solo una de estas opciones fiables: locked tripod, slow lateral slider o slow controlled push-in. Un solo encuadre a la altura de la mesa o cenital suave; lente normal de 50 mm o macro moderado; foco estable. Nada de orbitas, zooms dramaticos, camara rapida ni multiples angulos.
- COMPOSICION: un solo foco en el tercio derecho o inferior, con fondo tranquilo y espacio negativo real en el tercio izquierdo y el centro para las tarjetas de texto agregadas en postproduccion. No agregues carteles o superficies que parezcan reservadas para texto.
- LUZ Y ACABADO: luz natural suave de ventana, exposición normal, colores reales, materiales cotidianos con imperfecciones discretas, contraste moderado y color sobrio. Debe sentirse como una toma documental grabada en un hogar o estudio real, no como publicidad de lujo ni banco de imagenes.
- El video_prompt positivo describe EXCLUSIVAMENTE lo que debe verse y oirse. No escribas prohibiciones dentro de el: la API recibe las exclusiones por separado en negativePrompt.
- No menciones personas, manos, profesionales, pacientes, rostros, anatomia, organos, consultorios, hospitales, estetoscopios, pantallas, modelos anatomicos ni maquinas medicas dentro del video_prompt.
- No uses las palabras 2D, vector, paper-cut, illustration, motion graphic, 3D render, CGI, photorealistic, hyperrealistic, luxury o premium.
- "Ambient sound:" debe pedir solo sonido ambiente natural de la escena, sin dialogo ni narracion.

EJEMPLO V2:
"An 8-second vertical 9:16 natural documentary video. Subject and setting: a pair of well-used navy walking shoes rests beside a matte teal water bottle near a quiet apartment doorway, with a softly moving curtain in the background. Physical motion: a light morning breeze moves only the curtain edge while a narrow band of sunlight advances naturally across the floor; every object remains unchanged and grounded. Camera and composition: locked tripod at low eye level, normal 50 mm lens, shoes placed in the lower-right third, calm negative space across the left and center for editorial overlays, stable focus. Natural light and finish: soft morning window light, true-to-life color, moderate contrast, subtle everyday wear, restrained deep blue, muted teal and warm neutral tones, observational documentary finish. Ambient sound: faint room tone and a soft curtain rustle."

EJEMPLOS QUE NO SIRVEN PARA V2: recortes de papel, siluetas humanas, corazones 3D, una medica con un modelo anatomico, un estetoscopio sobre un escritorio, un consultorio, una pantalla con ECG o cualquier objeto que se transforme.`

/** Alias conservado para imports previos; el motor publicable por defecto es V2. */
export const PUBLISHABLE_VIDEO_PROMPT_RULES = VIDEO_PROMPT_RULES_V2

export function getVideoPromptRules(version: VideoGenerationVersion): string {
  return version === "v1" ? VIDEO_PROMPT_RULES_V1 : VIDEO_PROMPT_RULES_V2
}

function normalizedTopic(topic: string): string {
  return topic.replace(/[\r\n\t"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180) || "cardiovascular prevention"
}

function stableVariant(topic: string, count: number): number {
  let hash = 0
  for (const char of topic) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % count
}

const V2_FALLBACK_SCENES = [
  "a pair of well-used navy walking shoes beside a matte teal water bottle near a quiet apartment doorway",
  "a closed linen notebook with a plain burgundy ribbon marker beside reading glasses on a warm wooden table",
  "a simple ceramic cup beside a folded neutral cloth near a sunlit window, with one small leafy branch in the background",
  "a navy fabric pouch and a small ring of house keys resting on a light wood console near the front door",
]

export function buildFallbackVideoPrompt(topic: string, version: VideoGenerationVersion = "v2"): string {
  const safeTopic = normalizedTopic(topic)
  if (version === "v1") {
    return `An 8-second vertical 9:16 clean medical motion graphic about ${safeTopic}. A single simplified deep-blue heart symbol sits on a light warm background, connected to one muted teal circular path and a small burgundy marker. One dot follows the path once while the heart gives one restrained pulse, then the shapes settle smoothly. Flat or semi-flat illustration, clean edges, simple composition and generous low-detail space for editorial overlays. Clean modern medical motion graphic / illustration style, light background, no on-screen text, logos or watermark, ambient sound only, no dialogue, no voiceover.`
  }

  const scene = V2_FALLBACK_SCENES[stableVariant(safeTopic, V2_FALLBACK_SCENES.length)]
  return `An 8-second vertical 9:16 natural documentary video. Subject and setting: ${scene}, an understated everyday scene connected indirectly to ${safeTopic}. Physical motion: soft window light advances slowly across the surface while one background fabric edge moves slightly in a natural breeze; every object remains unchanged, grounded and in the same position. Camera and composition: locked tripod at table height, normal 50 mm lens, the subject grouped in the lower-right third, calm negative space across the left and center for editorial overlays, stable focus. Natural light and finish: soft morning window light, true-to-life color, moderate contrast, subtle material imperfections, restrained deep blue, muted teal, burgundy and warm neutral tones, observational documentary finish. Ambient sound: faint natural room tone and a soft fabric rustle.`
}

export function getVeoPromptQualityIssues(
  prompt: string,
  version: VideoGenerationVersion = "v2",
): string[] {
  const value = prompt.trim()
  const issues: string[] = []

  if (version === "v1") {
    if (value.length < 160) issues.push("la dirección visual V1 es demasiado breve para controlar el resultado")
    if (!/8-second/i.test(value) || !/9:16/i.test(value)) issues.push("no define el clip V1 vertical de 8 segundos")
    if (!V1_REQUIRED_STYLE_PATTERN.test(value)) issues.push("no conserva el estilo ilustrado clásico de V1")
    return issues
  }

  if (value.length < 320) issues.push("la dirección visual V2 es demasiado breve para controlar el resultado")
  if (!/^An 8-second vertical 9:16 natural documentary video\./i.test(value)) {
    issues.push("no usa el formato documental V2 de 8 segundos")
  }
  for (const section of ["Subject and setting:", "Physical motion:", "Camera and composition:", "Natural light and finish:", "Ambient sound:"]) {
    if (!value.includes(section)) issues.push(`falta la sección V2 ${section.replace(":", "")}`)
  }
  if (!V2_CAMERA_PATTERN.test(value)) issues.push("no limita la cámara a un único movimiento fiable")
  for (const { pattern, issue } of V2_SYNTHETIC_PATTERNS) {
    if (pattern.test(value) && !issues.includes(issue)) issues.push(issue)
  }
  return issues
}

export function isPublishableVeoPrompt(
  prompt: string,
  version: VideoGenerationVersion = "v2",
): boolean {
  return getVeoPromptQualityIssues(prompt, version).length === 0
}
