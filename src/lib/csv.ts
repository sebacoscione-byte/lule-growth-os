const RISKY_LEADING_CHARS = ["=", "+", "-", "@", "\t", "\r"]

/**
 * Neutraliza inyección de fórmulas en CSV ("CSV injection" / "Excel formula injection", SEC-02):
 * si una celda empieza con =, +, -, @, tab o retorno de carro, Excel/Google Sheets/LibreOffice
 * pueden interpretarla como fórmula al abrir el archivo en vez de mostrarla como texto plano.
 * Anteponer una comilla simple fuerza texto literal sin alterar el resto del valor.
 */
export function neutralizeCsvFormula(value: string): string {
  if (RISKY_LEADING_CHARS.some(c => value.startsWith(c))) {
    return `'${value}`
  }
  return value
}

export function escapeCsvCell(value: string | null | undefined): string {
  if (value == null) return ""
  const neutralized = neutralizeCsvFormula(String(value))
  if (neutralized.includes(",") || neutralized.includes('"') || neutralized.includes("\n") || neutralized.includes("\r")) {
    return `"${neutralized.replace(/"/g, '""')}"`
  }
  return neutralized
}
