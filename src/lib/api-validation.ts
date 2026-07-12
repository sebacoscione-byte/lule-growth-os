import type { ZodError } from "zod"

/**
 * `request.json()` lanza si el body no es JSON válido — sin este wrapper, eso se propaga como un
 * 500 genérico de Next en vez de un 400 claro. Usado por las rutas públicas (SEC-01).
 */
export async function parseJsonBody(request: Request): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await request.json() }
  } catch {
    return { ok: false, error: "JSON inválido" }
  }
}

/** Primer error de Zod en formato "campo: mensaje" — no expone la estructura completa del schema. */
export function formatZodError(error: ZodError): string {
  const first = error.issues[0]
  if (!first) return "Datos inválidos"
  const path = first.path.join(".")
  return path ? `${path}: ${first.message}` : first.message
}
