import type { VideoGenerationVersion } from "@/types"

const V1_REQUIRED_STYLE_PATTERN = /(?:motion graphic|illustration|flat|semi-flat)/i
const V2_CAMERA_PATTERN = /(?:locked camera|locked tripod|slow controlled push-in|slow lateral slider|gentle handheld drift)/i
const V2_REQUIRED_SECTIONS = ["Human action:", "Camera motion:", "Environment motion:", "Continuity:", "Audio:"]
const V2_DIRECT_REQUIRED_SECTIONS = ["Subject and setting:", "Human action:", "Camera and composition:", "Light and palette:", "Continuity:", "Audio:"]

const COMMON_VEO_PARAMETERS = {
  aspectRatio: "9:16",
  resolution: "720p",
  durationSeconds: 8,
} as const

/** Lista de elementos no deseados. Google recomienda describirlos sin instrucciones negativas. */
export const VEO_V2_NEGATIVE_PROMPT = [
  "on-screen text", "letters", "numbers", "captions", "logos", "watermarks", "phone interface",
  "incorrect stethoscope placement on abdomen", "stethoscope on belly", "stethoscope on stomach",
  "distorted anatomy", "extra fingers", "missing fingers", "fused hands", "duplicated limbs", "asymmetric eyes",
  "plastic skin", "beauty retouching", "glamorous makeup", "fashion advertising", "posed stock photography",
  "fictional doctor addressing camera", "luxury clinic", "American hospital aesthetic", "cold fluorescent light",
  "invented medical interface", "fake ECG", "invented medical device", "anatomical errors",
  "paper-cut art", "layered paper", "flat vector", "illustration", "3D render", "CGI", "hologram", "neon",
  "warped geometry", "duplicated objects", "morphing objects", "floating objects", "unnatural motion",
  "fast camera", "dramatic zoom", "multiple scenes", "montage", "scene transition", "over-saturated colors",
].join(", ")

export function getVeoRequestParameters(version: VideoGenerationVersion) {
  return version === "v2" || version === "v2_direct"
    ? { ...COMMON_VEO_PARAMETERS, personGeneration: "allow_adult", negativePrompt: VEO_V2_NEGATIVE_PROMPT }
    : COMMON_VEO_PARAMETERS
}

export function getVeoRequestInstance(
  prompt: string,
  referenceImage?: { mime_type: string; image_data: string },
) {
  return {
    prompt,
    ...(referenceImage ? {
      image: { inlineData: { mimeType: referenceImage.mime_type, data: referenceImage.image_data } },
    } : {}),
  }
}

/** V1 se conserva deliberadamente igual al motor historico ilustrado. */
export const VIDEO_PROMPT_RULES_V1 = `DIRECCION DE VIDEO PARA VEO (fondo animado de una microinfografia medica, reel generado con IA):
- Inclui "video_prompt": el prompt final que se manda directo al modelo de video, en ingles para maximizar precision, sin instrucciones conversacionales ni explicaciones.
- Describe UN SOLO plano continuo de 4 a 8 segundos. El texto se agrega despues por edicion, nunca lo genera Veo.
- Usa una ilustracion o motion graphic medico simple y moderno que refuerce el tema puntual y deje respirar el texto.
- Evita consultorios vacios, estetoscopios decorativos, maquinas ficticias, personas hablando a camara, interfaces inventadas, futurismo, hologramas, neon, anatomia deformada y publicidad de clinica de lujo.
- Fondo claro; paleta sobria de azul profundo, verde azulado o neutros calidos; nunca rosa dominante.
- Sonido ambiente solamente, sin dialogo, voz en off ni movimiento de labios.
- Sin texto, subtitulos, logos, marcas de agua, numeros, telefono, app, barra de estado o marco de dispositivo.
- Aspecto vertical 9:16.
- Termina reforzando: "Clean modern medical motion graphic / illustration style, full-bleed illustration filling the entire frame, not a phone or app screenshot, no phone mockup or device frame, no status bar, no clock or time display, no notification/signal/battery icons, no fake app name or logo, light background, no people speaking or looking at camera, no on-screen text, logos or watermark, ambient sound only, no dialogue, no voiceover."`

export const VIDEO_VISUAL_IDENTITY_RULES = `IDENTIDAD VISUAL OBLIGATORIA DE V2:
- Sistema visual constante: editorial documentary healthcare photography. No cambiar de estetica segun el tema.
- Paleta: crema calido, blanco natural, azul petroleo oscuro, azul marino, turquesa apagado y acentos pequenos terracota/coral suave. Mostaza solo como acento minimo. Evitar neon, blanco hospital frio, azul medico saturado, rosa dominante y futurismo.
- Luz natural lateral calida, contraste suave, saturacion moderada/baja, piel y materiales reales, imperfecciones naturales, espacios ordenados pero habitados, profundidad de campo moderada, camara a altura humana.
- Personas cuando aporten significado: pacientes argentinos/latinos adultos, mujeres adultas de distintas edades cuando corresponda, ropa cotidiana, maquillaje discreto o inexistente, cuerpos y rasgos naturales, expresion tranquila o reflexiva. Identidad parcial o fuera de cuadro es valida.
- Nunca inventar a la Dra. Lucia ni recrear su rostro desde texto. Nunca una medica ficticia mirando o hablando a camara.
- El espacio seguro para texto ocupa 25-35% del cuadro y nunca mas de la mitad. No generar texto, logos, carteles, interfaces ni letras.
- Familias visuales: DOCUMENTAL_HUMANO, CONTROL_PREVENCION, CONSULTA_ACOMPANAMIENTO, DETALLE_MEDICO_EDITORIAL. La cuarta solo cuando una persona completa eleve demasiado el riesgo de artefactos.
- Sintomas: reaccion corporal cotidiana y sutil, sin dolor intenso. Prevencion: control concreto. Hipertension: medicion correcta de presion o registro del resultado. Colesterol: conversacion medica, revision de habitos o preparacion realista de alimentos, nunca ensalada perfecta de stock. Palpitaciones: pausa, respiracion o percepcion del latido, sin dolor intenso. Ecocardiograma: preparacion realista, transductor sobre torax/pecho, camilla y equipo correcto, sin interfaces inventadas. Cardio-oncologia: acompanamiento, conversacion o monitoreo cardiovascular de una paciente en tratamiento, no un corazon o cinta aislados. Turnos/sedes: usar grafica de marca o fotos reales de la doctora/sede; no inventar una escena medica.
- Objetos genericos como agenda, taza, anteojos o plantas no pueden ser el centro si una accion humana no les da significado. Es inaceptable agenda cerrada + anteojos + cortina moviendose.
- FALLA CRITICA: un estetoscopio apoyado en abdomen, panza o estomago invalida el fotograma y obliga a regenerar. Cuando se represente auscultacion cardiaca, el cabezal debe estar sobre el torax/pecho.
- Evitar estetica stock generica, anuncio prepago, clinica estadounidense de lujo, Pinterest animado, Canva o una escena intercambiable con cualquier profesional.`

export const VIDEO_REFERENCE_FRAME_RULES = `${VIDEO_VISUAL_IDENTITY_RULES}

FOTOGRAMA INICIAL V2:
- Generar una fotografia vertical 9:16 que ya resuelva sujeto, accion, encuadre, luz, paleta y espacio seguro.
- Elegir una composicion: A sujeto en dos tercios y aire editorial lateral; B plano medio humano con identidad parcial; C detalle de accion medica real; D plano ambiental habitado con una accion humana inequívoca.
- Debe comprenderse sin el texto superpuesto y estar semanticamente conectado con el tema.
- No pedir movimiento: este prompt define un fotograma fijo. La animacion se especifica aparte.
- Cero texto, letras, numeros, logos, marcas de agua o interfaces legibles.`

/** V2 anima un fotograma ya aprobado: no debe volver a inventar la escena. */
export const VIDEO_PROMPT_RULES_V2 = `${VIDEO_VISUAL_IDENTITY_RULES}

DIRECCION V2 IMAGE-TO-VIDEO PARA VEO:
- Inclui "video_prompt" en ingles y empieza exactamente con "Animate the approved 9:16 first frame for 8 seconds."
- El fotograma inicial ya define persona, escena, encuadre, luz y estilo. No los redisenes ni agregues sujetos u objetos.
- Usa exactamente estas secciones: "Human action:", "Camera motion:", "Environment motion:", "Continuity:", "Audio:".
- Human action: una sola accion adulta, pequena, natural y semanticamente relevante (respirar, pausar, acomodar correctamente un manguito, anotar un resultado sin mostrar numeros, escuchar o conversar sin dialogo audible).
- Camera motion: un solo movimiento como maximo: locked camera, slow controlled push-in, slow lateral slider o gentle handheld drift. Sin montaje ni cambio de angulo.
- Environment motion: minimo y fisicamente creible; no usar cortina, vapor o luz como accion principal.
- Continuity: preservar exactamente anatomia, identidad, ropa, ubicacion, utileria medica, composicion, luz y paleta del primer fotograma. Ningun objeto aparece, desaparece, se duplica o se transforma.
- Audio: ambiente real suave, sin dialogo, narracion ni palabras.
- El prompt positivo describe lo que sucede; las exclusiones se envian aparte como negativePrompt.
- Nunca pedir texto, logos, interfaces, multiples escenas, transiciones, gestos teatrales ni una persona mirando a camara.`

/** V2 Directa conserva la identidad, pero Veo inventa la escena completa desde texto. */
export const VIDEO_PROMPT_RULES_V2_DIRECT = `${VIDEO_VISUAL_IDENTITY_RULES}

DIRECCION V2 DIRECTA TEXT-TO-VIDEO PARA VEO:
- Inclui "video_prompt" en ingles y empezá exactamente con "An 8-second vertical 9:16 editorial documentary healthcare video."
- Veo debe resolver UNA sola toma continua. No uses montaje, secuencia, transiciones ni cambio de lugar.
- Usa exactamente estas secciones: "Subject and setting:", "Human action:", "Camera and composition:", "Light and palette:", "Continuity:", "Audio:".
- Subject and setting: una persona adulta argentina/latina realista o una gráfica editorial de marca cuando el tema sea turnos/sedes. Define edad aproximada, ropa cotidiana, ubicación concreta y un único elemento médico correcto si aporta significado.
- Human action: una sola acción pequeña, natural y directamente conectada con el tema. La acción humana debe ser el movimiento principal; nunca cortinas, vapor, hojas o luz como recurso central.
- Camera and composition: un único encuadre a altura humana y un solo movimiento como máximo: locked camera, locked tripod, slow controlled push-in, slow lateral slider o gentle handheld drift. Reserva 25-35% lateral para texto real agregado después.
- Light and palette: luz natural lateral cálida, contraste suave, saturación moderada/baja, crema cálido, petróleo oscuro, marino, turquesa apagado y un acento terracota mínimo.
- Continuity: anatomía, rostro, manos, ropa y objetos permanecen consistentes; nada aparece, desaparece, se duplica, flota o se transforma.
- Audio: ambiente real suave, sin diálogo, narración ni palabras.
- Nunca inventar el rostro de la Dra. Lucía. Nunca una médica ficticia mirando o hablando a cámara. Cero texto, letras, números, logos, marcas de agua o interfaces legibles.
- FALLA CRÍTICA PREVENTIVA: si aparece estetoscopio en auscultación cardíaca, describí explícitamente el cabezal sobre pecho/tórax; nunca abdomen, panza o estómago.
- Evita estética stock, publicidad prepaga, clínica estadounidense de lujo, pose perfecta, piel plástica, CGI, Canva, anatomía estilizada y utilería médica decorativa.`

export const PUBLISHABLE_VIDEO_PROMPT_RULES = VIDEO_PROMPT_RULES_V2

export function getVideoPromptRules(version: VideoGenerationVersion): string {
  if (version === "v1") return VIDEO_PROMPT_RULES_V1
  return version === "v2_direct" ? VIDEO_PROMPT_RULES_V2_DIRECT : VIDEO_PROMPT_RULES_V2
}

function normalizedTopic(topic: string): string {
  return topic.replace(/[\r\n\t"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180) || "cardiovascular prevention"
}

export function buildFallbackVideoReferencePrompt(topic: string): string {
  const safeTopic = normalizedTopic(topic)
  if (/(?:turno|lanus|lanús|lomas|britanico|británico|cimel|sede|ubicacion|ubicación)/i.test(safeTopic)) {
    return `Warm 9:16 editorial brand graphic for an Argentine cardiology profile about ${safeTopic}, built from tactile cream paper, one restrained dark-petrol route, a muted turquoise appointment marker and a tiny soft-terracotta accent. The graphic communicates access and a simple next step without inventing a doctor, patient, clinic interior, building or medical procedure. Refined editorial composition with the meaningful graphic occupying about two thirds and a quiet 25-35 percent lateral safe area for later real typography. Natural paper texture, soft lateral daylight, moderate-low saturation, consistent profile palette, not Canva, not a phone or app interface. No visible text, letters, numbers, logos, watermarks or fictional signage.`
  }
  return `Editorial documentary healthcare photograph for an Argentine cardiology profile about ${safeTopic}. A realistic adult Latina patient in everyday clothing performs one concrete, medically credible preventive action directly related to the topic, observed at human eye level in a warm, inhabited but tidy Argentine home or consultation setting. Her identity is partial and she is not looking at camera. Warm lateral window light, soft contrast, moderate-low saturation, true skin texture, natural hands, warm cream, dark petrol, navy and muted turquoise palette with a tiny soft terracotta accent. One meaningful focal action occupies about two thirds of the 9:16 frame; preserve a quiet 25-35 percent lateral safe area for later editorial text. Editorial documentary healthcare photography, not stock advertising. No visible text, letters, numbers, logos, watermarks or invented interfaces. No fictional doctor facing camera. If a stethoscope appears during cardiac auscultation its chestpiece is correctly placed on the upper chest/thorax, never on abdomen, belly or stomach.`
}

export function buildFallbackVideoPrompt(topic: string, version: VideoGenerationVersion = "v2"): string {
  const safeTopic = normalizedTopic(topic)
  if (version === "v1") {
    return `An 8-second vertical 9:16 clean medical motion graphic about ${safeTopic}. A single simplified deep-blue heart symbol sits on a light warm background, connected to one muted teal circular path and a small burgundy marker. One dot follows the path once while the heart gives one restrained pulse, then the shapes settle smoothly. Flat or semi-flat illustration, clean edges, simple composition and generous low-detail space for editorial overlays. Clean modern medical motion graphic / illustration style, light background, no on-screen text, logos or watermark, ambient sound only, no dialogue, no voiceover.`
  }
  if (version === "v2_direct") {
    if (/(?:turno|lanus|lanús|lomas|britanico|británico|cimel|sede|ubicacion|ubicación)/i.test(safeTopic)) {
      return `An 8-second vertical 9:16 editorial documentary healthcare video. Subject and setting: a tactile warm-cream editorial brand graphic about ${safeTopic}, with one restrained dark-petrol route, a muted turquoise appointment marker and a tiny soft-terracotta accent; no invented clinic, doctor, patient or building. Human action: no human is introduced; the existing route marker completes one subtle purposeful movement along its path. Camera and composition: locked camera, graphic grouped across two thirds of the frame with a quiet 25-35 percent lateral safe area. Light and palette: soft natural lateral light over real paper texture, warm cream, dark petrol, muted turquoise and minimal terracotta, moderate-low saturation. Continuity: every shape keeps its exact form, count and position except for the single route-marker movement; nothing appears, disappears or transforms. Audio: very soft paper movement and room tone only, without dialogue, narration or spoken words.`
    }
    return `An 8-second vertical 9:16 editorial documentary healthcare video. Subject and setting: a realistic adult Latina patient in everyday clothing performs one concrete preventive action directly connected to ${safeTopic}, in a warm inhabited Argentine home or credible consultation setting, identity partial and never addressing camera. Human action: she completes one small natural movement central to the topic, with realistic breathing, hands and restrained expression. Camera and composition: slow controlled push-in at human eye level with a normal 50 mm perspective, one continuous shot, subject across two thirds and a quiet 25-35 percent lateral safe area. Light and palette: warm lateral window light, soft contrast, moderate-low saturation, warm cream, dark petrol, navy, muted turquoise and a tiny terracotta accent, natural skin and material texture. Continuity: preserve exact anatomy, face, hands, clothing and object placement throughout; everything remains grounded, singular and unchanged. Audio: faint authentic room tone only, without dialogue, narration or spoken words.`
  }
  if (/(?:turno|lanus|lanús|lomas|britanico|británico|cimel|sede|ubicacion|ubicación)/i.test(safeTopic)) {
    return "Animate the approved 9:16 first frame for 8 seconds. Human action: no human figure is introduced; the approved branded route marker completes one subtle, purposeful movement along its existing path. Camera motion: locked camera. Environment motion: a barely perceptible natural paper shadow shift adds depth without becoming the main action. Continuity: preserve the exact tactile graphic, shapes, composition, warm cream, dark petrol, muted turquoise and soft terracotta palette of the first frame; no new symbol appears and every element keeps its form. Audio: very soft natural paper movement and room tone only, without dialogue, narration or spoken words."
  }
  return "Animate the approved 9:16 first frame for 8 seconds. Human action: the adult subject completes one small, calm and natural movement already implied by the approved scene, with realistic breathing and hands. Camera motion: slow controlled push-in, subtle and steady. Environment motion: only minimal natural room movement secondary to the human action. Continuity: preserve the exact person, anatomy, clothing, objects, medical placement, composition, warm lateral light, moderate-low saturation and editorial documentary healthcare finish of the first frame; all objects remain grounded and unchanged. Audio: faint authentic room tone only, without dialogue, narration or spoken words."
}

export function getVeoPromptQualityIssues(prompt: string, version: VideoGenerationVersion = "v2"): string[] {
  const value = prompt.trim()
  const issues: string[] = []
  if (version === "v1") {
    if (value.length < 160) issues.push("la direccion visual V1 es demasiado breve para controlar el resultado")
    if (!/8-second/i.test(value) || !/9:16/i.test(value)) issues.push("no define el clip V1 vertical de 8 segundos")
    if (!V1_REQUIRED_STYLE_PATTERN.test(value)) issues.push("no conserva el estilo ilustrado clasico de V1")
    return issues
  }
  if (version === "v2_direct") {
    if (value.length < 520) issues.push("la dirección V2 Directa es demasiado breve para controlar una escena inventada por Veo")
    if (!/^An 8-second vertical 9:16 editorial documentary healthcare video\./i.test(value)) issues.push("no usa el contrato documental de V2 Directa")
    for (const section of V2_DIRECT_REQUIRED_SECTIONS) if (!value.includes(section)) issues.push(`falta la sección V2 Directa ${section.replace(":", "")}`)
    if (!V2_CAMERA_PATTERN.test(value)) issues.push("no limita la cámara a un único movimiento fiable")
    if (!/(?:25-35|25 to 35) percent/i.test(value)) issues.push("no reserva el área editorial de texto")
    if (!/(?:continuity|preserve|keeps? (?:its|their) exact)/i.test(value)) issues.push("no controla la continuidad de anatomía y objetos")
    if (/(?:multiple scenes|montage|cut to|transition to|3d render|cgi|hologram)/i.test(value)) issues.push("pide montaje o una estética sintética incompatible con V2 Directa")
    return issues
  }
  if (value.length < 360) issues.push("la animacion V2 es demasiado breve para preservar el fotograma")
  if (!/^Animate the approved 9:16 first frame for 8 seconds\./i.test(value)) issues.push("no usa el flujo V2 de fotograma aprobado")
  for (const section of V2_REQUIRED_SECTIONS) if (!value.includes(section)) issues.push(`falta la seccion V2 ${section.replace(":", "")}`)
  if (!V2_CAMERA_PATTERN.test(value)) issues.push("no limita la camara a un unico movimiento fiable")
  if (!/preserve/i.test(value)) issues.push("no exige preservar la composicion e identidad del fotograma")
  if (/(?:multiple scenes|montage|cut to|transition to|paper[- ]cut|motion graphic|3d render|cgi)/i.test(value)) issues.push("pide montaje o una estetica sintetica incompatible con V2")
  if (/(?:on-screen text|caption|logo|interface)/i.test(value)) issues.push("pide elementos graficos que deben agregarse solo en postproduccion")
  return issues
}

export function isPublishableVeoPrompt(prompt: string, version: VideoGenerationVersion = "v2"): boolean {
  return getVeoPromptQualityIssues(prompt, version).length === 0
}
