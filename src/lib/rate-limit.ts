import { getServiceDb } from "@/lib/supabase/service"

export interface RateLimitResult {
  allowed: boolean
  remaining: number
}

/**
 * Límite compartido entre instancias de Vercel (SEC-01): antes vivía en un Map en memoria por
 * proceso, que se reseteaba por instancia serverless — con más de una instancia activa a la vez
 * el límite real terminaba siendo maxRequests * instancias, no maxRequests. Ahora el contador vive
 * en Postgres (RPC `check_rate_limit`, ventana fija con UPSERT atómico) para que todas las
 * instancias compartan el mismo estado.
 *
 * Fail-open a propósito: si la consulta a la base falla, no bloquea el endpoint público completo
 * por un límite de anti-abuso caído — mismo criterio que el resto de las guardas no críticas del
 * proyecto (ver CLAUDE.md).
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<RateLimitResult> {
  const db = getServiceDb()
  const { data, error } = await db.rpc("check_rate_limit", {
    p_key: key,
    p_window_ms: windowMs,
    p_max: maxRequests,
  })

  if (error) {
    console.error(`[rate-limit] error consultando límite para "${key}": ${error.message}`)
    return { allowed: true, remaining: maxRequests }
  }

  const row = Array.isArray(data) ? data[0] : data
  return { allowed: Boolean(row?.allowed), remaining: Number(row?.remaining ?? 0) }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0].trim()
  return "unknown"
}
