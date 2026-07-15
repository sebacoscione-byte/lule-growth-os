// Guardrail medico compartido: deteccion deterministica de sintomas de alarma.
// No depende de IA a proposito — tiene que funcionar incluso si el proveedor de IA esta apagado o falla.

export const EMERGENCY_KEYWORDS = [
  "dolor de pecho", "dolor en el pecho", "me duele el pecho",
  "no puedo respirar", "falta de aire", "me falta el aire", "ahogo",
  "desmayo", "desmaye", "desmayé", "me desmaye", "me desmayé",
  "perdí el conocimiento", "perdi el conocimiento",
  "convulsion", "convulsión",
  "infarto", "paro cardiaco", "paro cardíaco",
  "palpitaciones fuertes", "palpitaciones intensas", "palpitaciones con mareo",
  "urgencia", "emergencia", "911",
  "debilidad de un lado", "me flojea un lado", "se me durmió un lado", "se me duerme un lado",
  "dolor en el brazo izquierdo", "dolor brazo izquierdo", "opresión en el pecho", "opresion en el pecho",
  "presión muy alta", "presion muy alta", "presión alta con", "presion alta con",
  "pico de presión", "pico de presion",
  "dificultad para hablar", "se me traba la lengua", "hablo raro",
] as const

// Incidente real 2026-07-14 (David Portas): "tuvo pico de presion hoy ... presion de mas de 180"
// no matcheaba ninguna palabra clave de arriba -- el paciente dio un valor numérico en vez de una
// de las frases fijas. Un valor de presión reportado en el rango de crisis hipertensiva (>=140,
// cerca de la palabra "presión") es en sí mismo una señal de alarma, sin depender de que use
// alguna de esas frases exactas.
const HIGH_BLOOD_PRESSURE_PATTERN =
  /presi[oó]n[^\d]{0,20}(1[4-9]\d|2\d\d)|(1[4-9]\d|2\d\d)[^\d]{0,20}presi[oó]n/

export function isEmergencyMessage(text: string): boolean {
  const lower = text.toLowerCase()
  return EMERGENCY_KEYWORDS.some(keyword => lower.includes(keyword)) || HIGH_BLOOD_PRESSURE_PATTERN.test(lower)
}

export const EMERGENCY_REPLY =
  "🚨 Por los síntomas que mencionás, esto puede requerir atención urgente. No esperes la respuesta del bot: andá a una guardia o llamá al *107* (SAME) ahora mismo.\n\nDejamos registrado tu mensaje para que el equipo de la Dra. Lucía Chahin lo revise."
