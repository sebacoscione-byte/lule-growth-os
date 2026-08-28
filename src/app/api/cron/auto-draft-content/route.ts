import { handleCronRequest } from "@/lib/cron-runner"
import { runAutoDraftGeneration } from "@/lib/content-auto-draft"

export const maxDuration = 180

// La IA queda separada del mantenimiento para conservar presupuesto de tiempo y dejar margen de
// revisión antes de las ventanas editoriales. El ledger permite reintentar un fallo transitorio sin
// generar de más: cada reintento vuelve a calcular únicamente los huecos que todavía faltan.
export async function GET(request: Request) {
  return handleCronRequest(request, {
    jobName: "auto-draft-content",
    task: async (supabase, now) => {
      const result = await runAutoDraftGeneration(supabase, now)
      const quotaBlocked = Boolean(result.error && /l[ií]mite diario/i.test(result.error))
      return {
        status: result.error ? (quotaBlocked ? "warning" : "failed") : "succeeded",
        payload: result,
        summary: result.error ?? `Borradores generados: ${result.generated}/${result.planned}`,
      }
    },
  })
}
