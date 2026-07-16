// Guardrail médico compartido. Es determinístico a propósito: tiene que funcionar aunque la IA
// esté deshabilitada, falle o reciba un intento de prompt injection.

export type EmergencyAssessment = "none" | "ambiguous" | "strong"

function normalizeMedicalText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Conserva separadores de cláusula para que negación y temporalidad tengan alcance local.
    .replace(/[^a-z0-9/.,;!?\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Quita solamente negaciones explícitas y locales. No se elimina un `no` genérico porque frases
 * como "no puedo respirar", "no puede hablar" o "no reacciona" son señales positivas.
 */
function removeNegatedAlarmPhrases(text: string): string {
  return text
    .replace(/\bno tengo (?:ningun )?dolor (?:de|en el) pecho\s+(?:ni|y)\s+(?:tengo )?falta de aire\b/g, " ")
    .replace(/\bsin dolor (?:de|en el) pecho\s+(?:ni|y)\s+falta de aire\b/g, " ")
    .replace(/\bno tengo (?:ningun )?(?:dolor (?:de|en el) pecho|falta de aire|palpitaciones|mareos?)\b/g, " ")
    .replace(/\byo no tengo (?:dolor (?:de|en el) pecho|falta de aire|palpitaciones|mareos?)\b/g, " ")
    .replace(/\bno (?:tengo|siento|tiene|siente) (?:ningun )?(?:dolor (?:de|en el) pecho|opresion en el pecho|presion en el pecho|falta (?:de )?aire|dificultad para respirar)\b/g, " ")
    .replace(/\bnunca (?:tuve|senti|tuvimos) (?:dolor (?:de|en el) pecho|falta de aire|un desmayo|perdida de conocimiento)\b/g, " ")
    .replace(/\bno me (?:duele (?:(?:en )?el )?pecho|falta (?:el )?aire|quedo sin aire)\b/g, " ")
    .replace(/\bno me cuesta respirar\b/g, " ")
    .replace(/\bno (?:siento|tengo) (?:un )?(?:dolor|opresion|presion|peso)(?: \w+){0,2} (?:de|en el) pecho\b/g, " ")
    .replace(/\bsin (?:dolor (?:de|en el) pecho|falta de aire|dificultad para respirar)\b/g, " ")
    .replace(/\bno tuve (?:perdida de conocimiento|un desmayo|convulsiones?)\b/g, " ")
    .replace(/\bno (?:me desmaye|se desmayo|perdi el conocimiento)\b/g, " ")
    .replace(/\bno (?:esta|quedo) inconsciente\b/g, " ")
    .replace(/\bno creo que me esta dando un infarto\b/g, " ")
    .replace(/\b(?:sin|ni) (?:desmayo|perdida de conocimiento)\b/g, " ")
    .replace(/\bno estoy (?:maread[oa]|con falta de aire)\b/g, " ")
    .replace(/\bni me (?:duele (?:(?:en )?el )?pecho|falta (?:el )?aire)\b/g, " ")
    .replace(/\bno es (?:una )?(?:urgencia|emergencia)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const NON_CURRENT_CLAUSE_PATTERNS = [
  /\bhace (?:\w+\s+){0,2}(?:anos?|meses?|semanas?|dias?)\b/,
  /\bantecedentes? de\b/,
  /\b(?:la )?semana pasada\b/,
  /\b(?:el )?(?:ano|mes) pasado\b/,
  /\bantes (?:tenia|tuve|sentia|presentaba)\b/,
  /\bya se me paso\b/,
  /\blei sobre\b/,
  /\bpersonas? con antecedentes\b/,
  /\bayer\b/,
] as const

const CURRENT_CONTEXT_PATTERN =
  /\b(?:ahora|recien|hoy|en este momento|actualmente|de repente|subit[oa]|desde|me duele|me falta|no puedo|no puede|estoy con|tengo (?:la )?presion)\b/

function splitMedicalClauses(text: string): string[] {
  return text
    .split(/(?:[.!?;]+|,\s*|\b(?:pero|aunque|sin embargo|porque|y)\b)/)
    .map(clause => clause.trim())
    .filter(Boolean)
}

const CURRENT_ALARM_PATTERNS = [
  /\bme duele(?: (?:mucho|fuerte|muchisimo|intenso|insoportable))? (?:(?:en )?el )?pecho\b/,
  /\b(?:(?:siento|tengo|estoy con) (?:un )?)?(?:dolor|opresion|presion|peso)(?: (?:muy )?(?:fuerte|intenso|insoportable))? (?:de |en (?:el )?)pecho\b/,
  /\b(?:no puedo respirar|no puede respirar|me cuesta(?: mucho)? respirar|dificultad para respirar|me falta (?:el )?aire|falta de aire|me quedo sin aire|me estoy ahogando|ahogo)\b/,
  /\b(?:me desmaye|se desmayo|perdi el conocimiento|perdida de conocimiento|esta inconsciente|quedo inconsciente|no reacciona)\b/,
  /\b(?:se me (?:duerme|durmio) un lado|un lado (?:caido|dormido)|debilidad (?:subita )?(?:de un lado|en un brazo)|no puedo mover (?:el |un )?brazo|no puede mover (?:el |un )?brazo|se le torcio la boca|boca torcida)\b/,
  /\b(?:no puedo hablar(?: bien)?|no puede hablar|dificultad para hablar|se me traba la lengua|hablo raro)\b/,
  /\b(?:emergencia cardiaca|paro cardiaco|creo que estoy teniendo un infarto|estoy teniendo un infarto|creo que me esta dando un infarto|me esta dando un infarto)\b/,
  /\bpalpitaciones (?:muy )?(?:fuertes|intensas)\b.*\b(?:desmayo|mareo|maread[oa])\b/,
] as const

const PRESSURE_ALARM_SYMPTOM_PATTERN =
  /\b(?:dolor (?:de |en (?:el )?)pecho|falta de aire|no puedo respirar|me cuesta respirar|dificultad para respirar|debilidad|adormecimiento|veo borroso|vision borrosa|dificultad para hablar|no puedo hablar)\b/

function extractBloodPressure(text: string): { systolic: number | null; diastolic: number | null } {
  const pair = text.match(/\b(?:presion[^0-9]{0,15})?(\d{2,3})\s*(?:\/|\s)\s*(\d{2,3})\b/)
  if (pair && (text.includes("presion") || pair[0].includes("/"))) {
    return { systolic: Number(pair[1]), diastolic: Number(pair[2]) }
  }

  const after = text.match(/\bpresion[^0-9]{0,20}(\d{2,3})\b/)
  if (after) return { systolic: Number(after[1]), diastolic: null }

  const before = text.match(/\b(\d{2,3})[^0-9]{0,20}presion\b/)
  if (before) return { systolic: Number(before[1]), diastolic: null }

  return { systolic: null, diastolic: null }
}

/**
 * Clasifica señales para cortar el flujo administrativo; nunca diagnostica.
 *
 * - `strong`: señal actual de alta precisión o presión >180/>120 junto con otra señal de alarma.
 * - `ambiguous`: valor >180/>120 o descripción de presión muy alta sin otra señal inequívoca.
 * - `none`: no hay señal actual; incluye negaciones, antecedentes e información ya resuelta.
 */
export function assessEmergencyMessage(text: string): EmergencyAssessment {
  const normalized = normalizeMedicalText(text)
  const withoutNegations = removeNegatedAlarmPhrases(normalized)

  // Mantiene el referente cuando la segunda cláusula omite repetir "pecho".
  if (
    /\b(?:dolor|opresion|presion|peso)(?: \w+){0,2} (?:de|en el) pecho\b.{0,80}\b(?:todavia|aun)\s+(?!no\b)(?:me duele|me sigue doliendo|sigue doliendo|continua|lo tengo)\b/.test(withoutNegations)
  ) {
    return "strong"
  }

  // La temporalidad tiene alcance local. Un antecedente en una cláusula nunca puede ocultar una
  // señal actual en otra ("tuve un infarto hace años y no puedo respirar").
  const activeClauses = splitMedicalClauses(withoutNegations).filter(clause => {
    const nonCurrent = NON_CURRENT_CLAUSE_PATTERNS.some(pattern => pattern.test(clause))
    return !nonCurrent || CURRENT_CONTEXT_PATTERN.test(clause)
  })

  if (activeClauses.length === 0) return "none"

  // Se recombinan únicamente cláusulas actuales para conservar señales compuestas como
  // "palpitaciones intensas y mareo", sin reactivar antecedentes descartados.
  const activeText = activeClauses.join(" y ")
  const currentAlarm = CURRENT_ALARM_PATTERNS.some(pattern => pattern.test(activeText))
  const aboveReviewThreshold = activeClauses.some(clause => {
    const pressure = extractBloodPressure(clause)
    return (pressure.systolic !== null && pressure.systolic > 180) ||
      (pressure.diastolic !== null && pressure.diastolic > 120)
  })

  if (currentAlarm) return "strong"
  if (aboveReviewThreshold && PRESSURE_ALARM_SYMPTOM_PATTERN.test(activeText)) return "strong"
  if (aboveReviewThreshold || /\b(?:presion muy alta|pico de presion)\b/.test(activeText)) return "ambiguous"
  return "none"
}

/** Compatibilidad con los callers actuales: tanto una señal fuerte como una ambigua corta el bot. */
export function isEmergencyMessage(text: string): boolean {
  return assessEmergencyMessage(text) !== "none"
}

const MEDICATION_OR_TREATMENT_PATTERN =
  /\b(?:medicacion|medicamento|remedio|pastilla|dosis|tratamiento|recetame|recetar|suspender|dejar de tomar|duplicar la dosis|(?:puedo|debo|tengo que) (?:seguir )?tomar)\b/
const TEST_INTERPRETATION_PATTERN =
  /\b(?:electro(?:cardiograma)?|ecocardiograma|estudio|resultado|analisis)\b.*\b(?:significa|interpret|normal|esta bien|esta mal|vea|revis)\w*\b|\b(?:significa|interpret|te mando|es normal|esta bien|esta mal)\b.*\b(?:electro(?:cardiograma)?|ecocardiograma|estudio|resultado|analisis)\b/
const DIAGNOSIS_OR_SYMPTOM_ADVICE_PATTERN =
  /\b(?:diagnosticame|actua como cardiologo|tengo una arritmia|que puede ser|es peligros[oa]|este valor es normal|la presion \d{2,3} es)\b|\b\d{2,3}\s*\/\s*\d{2,3}\b.*\b(?:que hago|es normal|es peligros[oa])\b/
const POST_CONSULTATION_PATTERN = /\b(?:despues de la consulta|despues de atenderme|indicaciones medicas)\b/

/** Detecta preguntas clínicas que solo pueden recibir el límite fijo del canal. */
export function isMedicalBoundaryMessage(text: string): boolean {
  const normalized = normalizeMedicalText(text)
  return MEDICATION_OR_TREATMENT_PATTERN.test(normalized) ||
    TEST_INTERPRETATION_PATTERN.test(normalized) ||
    DIAGNOSIS_OR_SYMPTOM_ADVICE_PATTERN.test(normalized) ||
    POST_CONSULTATION_PATTERN.test(normalized)
}

// Broader than `isMedicalBoundaryMessage`: this is a privacy classifier, not a clinical
// assessment. It prevents symptom/condition statements from being stored or sent to an LLM even
// when the person did not phrase them as a question. Administrative service names by themselves
// (for example, "consulta cardiológica" or "ecocardiograma") deliberately do not match.
const SENSITIVE_MEDICAL_CONTENT_PATTERN =
  /\b(?:palpitaciones?|mareos?|maread[oa]|desmay\w*|dolor (?:de |en (?:el )?)?pecho|opresion (?:de |en (?:el )?)?pecho|falta (?:de )?aire|dificultad para respirar|presion (?:arterial )?(?:alta|baja|de )|hipertension|hipotension|arritmia|taquicardia|bradicardia|infarto|accidente cerebrovascular|acv|convulsiones?|edema|hinchazon (?:de |en )?(?:las )?(?:piernas?|tobillos?)|fatiga|sintomas?)\b|\b(?:presion[^0-9]{0,20})?\d{2,3}\s*\/\s*\d{2,3}\b/

export function containsSensitiveMedicalContent(text: string): boolean {
  const normalized = normalizeMedicalText(text)
  return isEmergencyMessage(text) ||
    isMedicalBoundaryMessage(text) ||
    SENSITIVE_MEDICAL_CONTENT_PATTERN.test(normalized)
}

export const EMERGENCY_REPLY =
  "Por lo que mencionás, este canal administrativo no es adecuado para evaluar la situación. Si el síntoma está ocurriendo ahora o es intenso, buscá atención médica inmediata en una guardia o llamá al servicio de emergencias de tu zona. No esperes una respuesta por WhatsApp."

export const MEDICAL_BOUNDARY_REPLY =
  "Este canal sirve únicamente para orientación administrativa y no puede evaluar síntomas, medicación ni estudios. Si hay síntomas actuales o intensos, buscá atención médica inmediata. Para una consulta clínica, podemos indicarte cómo pedir turno o derivarte con una persona del equipo."

export const SENSITIVE_MEDICAL_CONTENT_REPLY =
  "Para proteger tu privacidad, este canal administrativo no registra ni evalúa síntomas o antecedentes. Si querés gestionar un turno, escribí solamente el servicio, tu cobertura y la sede que preferís. Si hay síntomas actuales o intensos, buscá atención médica inmediata."
