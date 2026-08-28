import { handleCronRequest } from "@/lib/cron-runner"
import { runDailyMaintenance } from "@/lib/daily-maintenance"

export const maxDuration = 180

export async function GET(request: Request) {
  return handleCronRequest(request, {
    jobName: "daily-maintenance",
    task: async (supabase, now) => {
      const result = await runDailyMaintenance(supabase, now)
      return {
        status: result.failures.length > 0 ? "failed" : "succeeded",
        payload: result,
        summary: result.failures.length > 0 ? result.failures.join("\n") : "Mantenimiento diario completado",
      }
    },
  })
}
