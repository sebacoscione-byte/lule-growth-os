import { NextResponse } from "next/server"
import { sendCronFailureAlert } from "@/lib/alert-email"
import { isAuthorizedCronRequest } from "@/lib/cron-auth"
import { runDailyMaintenance } from "@/lib/daily-maintenance"
import { getServiceDb } from "@/lib/supabase/service"

export const maxDuration = 180

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    return NextResponse.json(await runDailyMaintenance(getServiceDb(), new Date()))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await sendCronFailureAlert("daily-maintenance", `Excepción no controlada: ${message}`)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
