import Anthropic from "@anthropic-ai/sdk"
import type { ClassifyResult } from "@/types"

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const SYSTEM_PROMPT = `Sos el asistente administrativo digital de la Dra. Lucía Chahin.
Tu objetivo es captar interesados y guiarlos para pedir turno.

REGLAS OBLIGATORIAS:
- No das diagnóstico
- No indicás tratamiento
- No interpretás estudios
- No das consejos médicos personalizados
- No confirmás disponibilidad
- No reservás turnos
- No hablás en nombre de CIMEL ni de Swiss Medical
- No prometés atención ni resultados
- No pedís DNI, estudios, imágenes, ECG ni historia clínica
- Solo pedís datos mínimos para seguimiento
- Usás tono claro, cálido, profesional y argentino (voseo)
- Hacés una pregunta por vez

INFORMACIÓN DE ATENCIÓN:
- Dra. Lucía Chahin atiende:
  - Martes en CIMEL Lanús (Tucumán 1314, Lanús) — consulta cardiológica y ecocardiograma
  - Viernes en Swiss Medical Lomas — consulta cardiológica y ecocardiograma
- Para pedir turno: comunicarse con la institución y solicitar turno con la Dra. Lucía Chahin
- La app NO reserva turnos ni confirma horarios

DETECCIÓN DE URGENCIAS:
Si el usuario menciona dolor de pecho actual, falta de aire, desmayo, pérdida de fuerza,
dificultad para hablar, dolor irradiado a brazo o mandíbula, palpitaciones con mareo intenso,
presión muy alta con síntomas, o cualquier síntoma de alarma:
Responder: "Por lo que contás, esto no debería resolverse por este canal. Te recomiendo buscar atención médica inmediata o concurrir a una guardia. Este canal solo sirve para orientar cómo pedir turno, no para urgencias."`

export async function classifyMessage(message: string): Promise<ClassifyResult> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: `${SYSTEM_PROMPT}

Analizá el mensaje del usuario y devolvé SOLO un JSON válido con esta estructura exacta:
{
  "intent": "turno | consulta_cardiologia | ecocardiograma | cobertura | lugar_atencion | consulta_medica | urgencia | spam | otro",
  "requested_service": "consulta_cardiologia | ecocardiograma | no_definido",
  "suggested_location": "cimel_lanus | swiss_lomas | preguntar",
  "suggested_day": "martes | viernes | preguntar",
  "priority_score": 1,
  "requires_human": false,
  "possible_emergency": false,
  "reply_suggestion": "texto de respuesta",
  "next_action": "responder | pedir_preferencia | derivar_cimel | derivar_swiss | escalar | descartar"
}`,
    messages: [{ role: "user", content: message }],
  })

  const text = response.content[0].type === "text" ? response.content[0].text : ""
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("No JSON in response")
  return JSON.parse(jsonMatch[0]) as ClassifyResult
}

export async function generateReply(
  message: string,
  leadContext: string,
  conversationHistory: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const messages = [
    ...conversationHistory,
    { role: "user" as const, content: message },
  ]

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: `${SYSTEM_PROMPT}

Contexto del lead: ${leadContext}
Generá una respuesta apropiada. Solo el texto de la respuesta, sin JSON ni formato extra.`,
    messages,
  })

  return response.content[0].type === "text" ? response.content[0].text : ""
}

export async function generateInstagramContent(
  category: string,
  type: "reel" | "historia" | "carrusel" | "post",
  cta: string
): Promise<{ caption: string; hook: string; hashtags: string }> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: `Sos especialista en marketing médico para la Dra. Lucía Chahin, cardióloga.
Generás contenido para Instagram en tono profesional, cálido y argentino.
NUNCA prometés resultados médicos, nunca das diagnósticos, nunca asumís condiciones del lector.
El objetivo es informar y captar personas que quieran pedir turno.
Devolvé SOLO un JSON con: { "caption": "...", "hook": "...", "hashtags": "..." }`,
    messages: [
      {
        role: "user",
        content: `Generá un ${type} sobre: ${category}. CTA sugerido: ${cta}`,
      },
    ],
  })

  const text = response.content[0].type === "text" ? response.content[0].text : ""
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("No JSON in response")
  return JSON.parse(jsonMatch[0])
}

export async function generateGooglePost(topic: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: `Generás publicaciones para Google Business Profile de la Dra. Lucía Chahin, cardióloga.
Tono profesional y claro. Máximo 1500 caracteres. Sin promesas médicas.
Siempre incluir dónde atiende (CIMEL Lanús los martes, Swiss Medical Lomas los viernes).
Solo devolvé el texto de la publicación.`,
    messages: [{ role: "user", content: `Publicación sobre: ${topic}` }],
  })

  return response.content[0].type === "text" ? response.content[0].text : ""
}

export async function generateReviewReply(starRating: string, comment: string): Promise<string> {
  const stars = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[starRating] ?? 3
  const sentiment = stars >= 4 ? "positiva" : stars === 3 ? "neutral" : "negativa"
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    system: `Sos la Dra. Lucía Chahin y respondés reseñas de Google en primera persona.
Tono cálido, profesional y breve (máximo 3 oraciones). Nunca hagas promesas médicas.
Solo devolvé el texto de la respuesta, sin comillas ni formato extra.`,
    messages: [
      {
        role: "user",
        content: `Reseña ${sentiment} (${stars} estrellas): "${comment || "Sin comentario"}"\nGenerá una respuesta apropiada.`,
      },
    ],
  })
  return response.content[0].type === "text" ? response.content[0].text : ""
}

export async function generateFollowupMessage(
  leadName: string | null,
  location: string
): Promise<string> {
  const name = leadName ? `, ${leadName}` : ""
  return `Hola${name}, te escribo para saber si pudiste pedir turno con la Dra. Lucía Chahin en ${location}. Si tuviste algún problema para ubicarla, avisame y te paso nuevamente las indicaciones.\n\n¿Pudiste pedir turno?\n1. Ya pedí turno ✅\n2. No pude pedir ❌\n3. Necesito los datos de nuevo 📋\n4. Ya no me interesa`
}
