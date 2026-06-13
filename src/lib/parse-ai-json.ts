function nextNonWhitespace(text: string, start: number) {
  let index = start
  while (index < text.length && /\s/.test(text[index])) index += 1
  return { char: text[index], index }
}

function isClosingQuote(text: string, quoteIndex: number) {
  const next = nextNonWhitespace(text, quoteIndex + 1)
  if (!next.char || next.char === ":" || next.char === "}" || next.char === "]") return true
  if (next.char !== ",") return false

  const afterComma = nextNonWhitespace(text, next.index + 1).char
  return afterComma === '"' || afterComma === "}" || afterComma === "]"
}

function repairUnescapedQuotes(text: string) {
  let repaired = ""
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (!inString) {
      repaired += char
      if (char === '"') inString = true
      continue
    }

    if (escaped) {
      repaired += char
      escaped = false
      continue
    }

    if (char === "\\") {
      repaired += char
      escaped = true
      continue
    }

    if (char === '"') {
      if (isClosingQuote(text, index)) {
        repaired += char
        inString = false
      } else {
        repaired += '\\"'
      }
      continue
    }

    if (char === "\n") {
      repaired += "\\n"
      continue
    }
    if (char === "\r") continue
    if (char === "\t") {
      repaired += "\\t"
      continue
    }

    repaired += char
  }

  return repaired
}

export function parseAiJson<T>(response: string): T {
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("No se encontró un objeto JSON en la respuesta.")

  try {
    return JSON.parse(jsonMatch[0]) as T
  } catch {
    try {
      return JSON.parse(repairUnescapedQuotes(jsonMatch[0])) as T
    } catch {
      throw new Error("La respuesta tiene un error de formato que no se pudo reparar automáticamente.")
    }
  }
}
