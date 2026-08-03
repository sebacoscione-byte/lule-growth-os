const LEGACY_OR_RISKY_PATTERNS: Array<{ pattern: RegExp; issue: string }> = [
  {
    pattern: /cinematic\s+b-?roll|doll(?:y(?:-?in)?|ies|ying)|shallow depth of field/i,
    issue: "usa lenguaje de publicidad cinematografica que suele verse generado por IA",
  },
  {
    pattern: /photorealistic|hyperrealistic|realistic organic texture|realistic texture and depth/i,
    issue: "pide fotorrealismo, que vuelve evidentes los errores de anatomia y objetos",
  },
  {
    pattern: /\b(?:doctor|physician|nurse|clinician|patient|woman|man|hands?|fingers?|face|person|people)\b/i,
    issue: "incluye personas o partes del cuerpo generadas",
  },
  {
    pattern: /clinic(?:al)? (?:office|room|practice)|consulting room|hospital corridor|stethoscope|anatomical (?:heart )?model|medical monitor|tablet screen/i,
    issue: "incluye escenarios o utileria clinica generica",
  },
]

const EDITORIAL_STYLE_PATTERN = /(?:2d|two-dimensional|flat vector|paper[- ]cut|editorial motion graphic)/i
const LOCKED_CAMERA_PATTERN = /(?:locked|static|fixed) camera/i

/** Parametros estables del clip final: el guion y las tarjetas de texto estan pensados para 8 s. */
export const VEO_REQUEST_PARAMETERS = {
  aspectRatio: "9:16",
  resolution: "720p",
  durationSeconds: 8,
} as const

/**
 * Reglas que usa el modelo de texto para escribir la direccion que luego recibe Veo.
 * La direccion positiva describe solamente lo que debe aparecer: listas largas de negaciones tienden
 * a reintroducir los mismos objetos que se quieren evitar.
 */
export const PUBLISHABLE_VIDEO_PROMPT_RULES = `DIRECCION DE VIDEO PARA VEO (fondo animado editorial de una microinfografia medica):
- Inclui "video_prompt" en ingles, autocontenido y listo para Veo. Tiene que empezar exactamente con "An 8-second vertical 9:16 2D editorial motion graphic".
- Es un UNICO plano grafico continuo. No es una filmacion, una recreacion de consultorio ni publicidad de una clinica.
- Estructura el prompt en este orden: sujeto y contexto; una accion simple; estilo; camara y composicion; paleta e iluminacion; sonido.
- SUJETO: usa una sola metafora visual reconocible y como maximo dos elementos secundarios. Para ubicacion, atencion o turnos, usa recursos graficos como un recorrido abstracto, un pin sin texto, un calendario sin letras/numeros y un simbolo cardiaco simple. Para educacion, usa un diagrama plano o una metafora cotidiana. Un organo solo aparece si es indispensable para entender el tema, como silueta 2D simplificada, nunca como replica anatomica tridimensional.
- ACCION: una sola transformacion legible y funcional durante los 8 segundos (por ejemplo, un recorrido que avanza hacia un punto, un pulso suave o dos formas que se ordenan). Maximo un movimiento secundario. El final debe poder enlazar visualmente con el inicio.
- ESTILO: ilustracion editorial 2D tipo recorte de papel o vector plano, formas deliberadamente simplificadas, textura tactil muy sutil, bordes limpios y acabado humano. Debe sentirse disenado, no intentar pasar por una filmacion real.
- CAMARA Y COMPOSICION: camara fija/locked-off, encuadre frontal o cenital, sin zoom ni travelling. Un foco visual, fondo de bajo detalle y contraste moderado para que las tarjetas reales de texto sigan siendo protagonistas. Evita detalles importantes en la franja superior, el centro exacto y el borde inferior, donde se superpone el guion.
- PALETA: fondo marfil o gris calido claro; azul profundo y verde azulado como colores principales; borgona solo como acento pequeno. Luz grafica uniforme, sin dramatismo.
- El video_prompt debe describir EXCLUSIVAMENTE los elementos visibles deseados. No menciones personas, manos, profesionales, pacientes, consultorios, hospitales, estetoscopios, pantallas, tablets, modelos anatomicos 3D ni maquinas medicas, ni siquiera para negarlos.
- No uses las palabras cinematic, B-roll, photorealistic, realistic, hyperrealistic, dolly, luxury o premium en el video_prompt.
- No debe haber tipografia generada: expresa esto como "typography-free graphic composition". El texto, la marca y el CTA se agregan despues por edicion real.
- Termina el video_prompt con: "Typography-free, entirely graphic, unpopulated frame; soft paper movement only, no speech. Fixed camera, seamless gentle loop."

EJEMPLO BUENO PARA UN TEMA DE ATENCION EN UNA SEDE:
"An 8-second vertical 9:16 2D editorial motion graphic. Subject and context: an ivory paper-cut field with one curved teal route ending at a small burgundy heart-shaped location marker, plus a blank calendar tab as a quiet secondary shape. Action: a deep-blue dot travels once along the route while the heart marker gives one restrained pulse; the shapes settle back into a loop-ready arrangement. Style: restrained editorial cut-paper animation with clean edges and subtle tactile grain. Camera and composition: locked camera, front-facing composition, one focal point in the lower-middle area, generous low-detail breathing room for real text overlays. Palette and light: ivory, deep blue, muted teal, one small burgundy accent, flat even graphic light. Typography-free, entirely graphic, unpopulated frame; soft paper movement only, no speech. Fixed camera, seamless gentle loop."

EJEMPLOS MALOS: una profesional en un consultorio; una mano senalando un corazon de plastico; un estetoscopio sobre una mesa; un monitor con ECG; cualquier escena fotorrealista o con movimiento de camara.`

function normalizedTopic(topic: string): string {
  return topic.replace(/[\r\n\t"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180) || "cardiovascular prevention"
}

/** Respaldo seguro para la UI; nunca crea el B-roll cinematografico legado. */
export function buildFallbackVideoPrompt(topic: string): string {
  const safeTopic = normalizedTopic(topic)
  return `An 8-second vertical 9:16 2D editorial motion graphic about ${safeTopic}. Subject and context: an ivory paper-cut field with one simplified deep-blue heart symbol connected to a muted teal circular path and one small burgundy marker. Action: a single dot follows the path once while the heart gives one restrained pulse, then both return smoothly to their starting arrangement. Style: restrained editorial cut-paper animation, deliberately simplified shapes, clean edges and subtle tactile grain. Camera and composition: locked camera, front-facing single scene, one focal point away from the center, generous low-detail breathing room for real text overlays. Palette and light: ivory, deep blue, muted teal and one small burgundy accent, flat even graphic light. Typography-free, entirely graphic, unpopulated frame; soft paper movement only, no speech. Fixed camera, seamless gentle loop.`
}

/**
 * Evita gastar un intento pago con prompts viejos o editados que vuelven a pedir personas/fotorrealismo.
 * Devuelve mensajes aptos para mostrar en UI o responder desde la API.
 */
export function getVeoPromptQualityIssues(prompt: string): string[] {
  const value = prompt.trim()
  const issues: string[] = []
  if (value.length < 180) issues.push("la direccion visual es demasiado breve para controlar el resultado")
  if (!/^An 8-second vertical 9:16 2D editorial motion graphic/i.test(value)) {
    issues.push("no usa el formato editorial 2D de 8 segundos definido para la cuenta")
  }
  if (!EDITORIAL_STYLE_PATTERN.test(value)) {
    issues.push("no define un estilo grafico 2D deliberadamente ilustrado")
  }
  if (!LOCKED_CAMERA_PATTERN.test(value)) {
    issues.push("no fija la camara y puede derivar en movimientos publicitarios")
  }
  for (const { pattern, issue } of LEGACY_OR_RISKY_PATTERNS) {
    if (pattern.test(value) && !issues.includes(issue)) issues.push(issue)
  }
  return issues
}

export function isPublishableVeoPrompt(prompt: string): boolean {
  return getVeoPromptQualityIssues(prompt).length === 0
}
