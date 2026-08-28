import { runAutoPublishFormats } from "@/lib/content-auto-publish"
import { handleCronRequest } from "@/lib/cron-runner"

export const maxDuration = 180

export async function GET(request: Request) {
  return handleCronRequest(request, {
    jobName: "publish-stories",
    task: async (supabase, now) => {
      const results = await runAutoPublishFormats(supabase, ["historia"], now)
      const result = results.historia?.last_run_result ?? "skipped_unknown"
      return {
        status: result.includes("(error:") || result === "skipped_unknown" || result === "skipped_outside_window"
          ? "failed"
          : result.includes("quota_exceeded") ? "warning" : "succeeded",
        payload: { historia: result },
        summary: `Historias: ${result}`,
      }
    },
  })
}
