import { NextResponse } from "next/server"
import { getServiceDb } from "@/lib/supabase/service"
import { runWhatsAppFollowup } from "@/lib/whatsapp-followup"

export const maxDuration = 60

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false // fail-closed: sin secreto configurado, no se ejecuta nada
  return request.headers.get("authorization") === `Bearer ${secret}`
}

// No está registrado en vercel.json a propósito: daily-maintenance es el respaldo diario del
// worker frecuente de Supabase. Esta ruta queda
// disponible para disparar el seguimiento a mano (curl con CRON_SECRET) al probar el template.
export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = getServiceDb()
  const result = await runWhatsAppFollowup(supabase, new Date())
  return NextResponse.json(result)
}
