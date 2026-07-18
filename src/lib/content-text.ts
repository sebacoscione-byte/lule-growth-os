/**
 * Corta un texto para usarlo como subtítulo dentro de una placa generada por IA — Gemini dibuja el
 * texto tal cual se le pasa, sin resumir por su cuenta, así que un corte ciego (slice(0, N)) puede
 * partir una palabra o una oración a la mitad. Preferí cortar en el límite de una oración completa
 * que entre en el límite; si ni la primera oración entra, corta en el último espacio antes del
 * límite para no partir una palabra.
 */
export function truncateForImagePlate(text: string, limit = 120): string {
  const trimmed = text.trim()
  if (trimmed.length <= limit) return trimmed
  const sentenceEnds = [...trimmed.matchAll(/[.!?](?:\s|$)/g)].map(m => (m.index ?? 0) + 1)
  const lastSentenceEnd = [...sentenceEnds].reverse().find(end => end <= limit)
  if (lastSentenceEnd && lastSentenceEnd >= 20) return trimmed.slice(0, lastSentenceEnd).trim()
  const cut = trimmed.slice(0, limit)
  const lastSpace = cut.lastIndexOf(" ")
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim()
}
