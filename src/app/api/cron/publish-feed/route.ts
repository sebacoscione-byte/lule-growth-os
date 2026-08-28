import { runAutoPublishFormats } from "@/lib/content-auto-publish"
import { handleCronRequest } from "@/lib/cron-runner"

export const maxDuration = 180

export async function GET(request: Request) {
  return handleCronRequest(request, {
    jobName: "publish-feed",
    task: async (supabase, now) => {
      const results = await runAutoPublishFormats(supabase, ["post", "carrusel", "reel"], now)
      const payload = {
        post: results.post?.last_run_result ?? "skipped_unknown",
        carrusel: results.carrusel?.last_run_result ?? "skipped_unknown",
        reel: results.reel?.last_run_result ?? "skipped_unknown",
      }
      const failures = Object.entries(payload)
        .filter(([, result]) => result.includes("(error:") || result === "skipped_unknown" || result === "skipped_outside_window")
        .map(([format, result]) => `${format}: ${result}`)
      const warnings = Object.entries(payload)
        .filter(([, result]) => result.includes("quota_exceeded"))
        .map(([format, result]) => `${format}: ${result}`)
      return {
        status: failures.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "succeeded",
        payload,
        summary: [...failures, ...warnings].join("\n") || "Feed procesado sin errores",
      }
    },
  })
}
