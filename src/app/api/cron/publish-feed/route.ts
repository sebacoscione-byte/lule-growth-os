import { NextResponse } from "next/server"
import { sendCronFailureAlert } from "@/lib/alert-email"
import { runAutoPublishFormats } from "@/lib/content-auto-publish"
import { isAuthorizedCronRequest } from "@/lib/cron-auth"
import { getServiceDb } from "@/lib/supabase/service"

export const maxDuration = 180

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const results = await runAutoPublishFormats(getServiceDb(), ["post", "carrusel", "reel"], new Date())
    const response = {
      post: results.post?.last_run_result ?? "skipped_unknown",
      carrusel: results.carrusel?.last_run_result ?? "skipped_unknown",
      reel: results.reel?.last_run_result ?? "skipped_unknown",
    }
    const failures = Object.entries(response)
      .filter(([, result]) => result.includes("(error:"))
      .map(([format, result]) => `${format}: ${result}`)
    if (failures.length > 0) await sendCronFailureAlert("publish-feed", failures.join("\n"))
    return NextResponse.json(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await sendCronFailureAlert("publish-feed", `Excepción no controlada: ${message}`)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
