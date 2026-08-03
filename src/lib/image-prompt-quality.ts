const VISUAL_MOTIFS: Array<[name: string, patterns: RegExp[]]> = [
  ["consultation-office", [/consult(?:ation|ing) (?:office|room)/i, /medical (?:office|consultation room)/i, /clinic(?:al)? (?:office|room)/i]],
  ["clinician", [/\bdoctor(?:'s)?\b/i, /\bcardiologist(?:'s)?\b/i, /medical professional/i, /white coat/i]],
  ["partial-clinician", [/doctor(?:'s)? (?:hand|arm)/i, /cardiologist(?:'s)? (?:hand|arm)/i, /(?:hand|arm) in a white coat/i, /partially visible/i]],
  ["desk-or-table", [/\bdesk\b/i, /\btable\b/i]],
  ["wood-surface", [/\bwood(?:en)?\b/i, /wood tones?/i]],
  ["stethoscope", [/\bstethoscope\b/i]],
  ["digital-screen", [/\btablet\b/i, /\bmonitor\b/i, /screen/i, /interface/i]],
  ["medical-equipment", [/blood pressure monitor/i, /medical equipment/i, /medical chart/i]],
  ["plant", [/\bplant\b/i, /greenery/i]],
  ["patient-hand", [/patient(?:'s)? hand/i]],
]

function visualMotifs(prompt: string): Set<string> {
  // Las restricciones suelen enumerar justo los objetos prohibidos ("Do not show a stethoscope").
  // Sólo analizamos la descripción positiva anterior para no contar ausencias como parte de la escena.
  const positiveDescription = prompt.split(/\b(?:do not|never|avoid|without|no people)\b/i)[0]
  return new Set(
    VISUAL_MOTIFS
      .filter(([, patterns]) => patterns.some(pattern => pattern.test(positiveDescription)))
      .map(([name]) => name)
  )
}

export function areImagePromptsTooSimilar(prompt: string, candidate: string): boolean {
  const current = visualMotifs(prompt)
  const other = visualMotifs(candidate)
  if (current.size === 0 || other.size === 0) return false

  const shared = [...current].filter(motif => other.has(motif)).length
  const union = new Set([...current, ...other]).size
  return shared >= 4 || (shared >= 3 && shared / union >= 0.5)
}

/**
 * Detecta direcciones que suelen converger al mismo cliché de banco de imágenes. No evalúa el
 * resultado médico ni el copy: solamente decide si conviene pedir una escena nueva antes de gastar
 * un intento de generación.
 */
export function getImagePromptQualityIssues(prompt: string, recentPrompts: string[] = []): string[] {
  const motifs = visualMotifs(prompt)
  const props = ["stethoscope", "digital-screen", "medical-equipment", "plant"]
    .filter(motif => motifs.has(motif)).length
  const issues: string[] = []

  if (
    motifs.has("consultation-office") && motifs.has("clinician") &&
    motifs.has("desk-or-table") && props >= 2
  ) {
    issues.push("generic-medical-office-scene")
  }
  if (recentPrompts.some(recent => recent.trim() && areImagePromptsTooSimilar(prompt, recent))) {
    issues.push("too-similar-to-recent-content")
  }
  return issues
}

export function recentImagePrompts<T extends { id?: string; image_prompt?: string; created_at?: string }>(
  items: T[],
  currentItemId?: string,
  limit = 8
): string[] {
  return items
    .filter(item => item.id !== currentItemId && typeof item.image_prompt === "string" && item.image_prompt.trim())
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
    .slice(0, limit)
    .map(item => item.image_prompt!.trim())
}
