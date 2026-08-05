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
    const results = await runAutoPublishFormats(getServiceDb(), ["historia"], new Date())
    const result = results.historia?.last_run_result ?? "skipped_unknown"
    if (result.includes("(error:")) await sendCronFailureAlert("publish-stories", `Historias: ${result}`)
    return NextResponse.json({ historia: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await sendCronFailureAlert("publish-stories", `Excepción no controlada: ${message}`)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
