import { NextResponse } from "next/server"
import { sendCronFailureAlert } from "@/lib/alert-email"
import { isAuthorizedCronRequest } from "@/lib/cron-auth"
import { runAutoDraftGeneration } from "@/lib/content-auto-draft"
import { getServiceDb } from "@/lib/supabase/service"

export const maxDuration = 180

// Repone la cola de borradores de post/historia/carrusel cuando el cronograma de auto-publicacion
// se queda sin piezas aprobadas ni borradores esperando revision -- separado de daily-maintenance a
// proposito: llamar a la IA para generar contenido puede tardar bastante mas que el resto de las
// tareas diarias, y ese mismo cron ya tuvo un problema real de presupuesto de tiempo (ver
// docs/BACKLOG.md, "Cola de historias y carruseles aprobados en 0"). Corre temprano, antes de las
// ventanas de publicacion (18:00/19:00 ART), para dejarle a Seba el resto del dia para revisar.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await runAutoDraftGeneration(getServiceDb(), new Date())
    if (result.error) await sendCronFailureAlert("auto-draft-content", result.error)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await sendCronFailureAlert("auto-draft-content", `Excepción no controlada: ${message}`)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
