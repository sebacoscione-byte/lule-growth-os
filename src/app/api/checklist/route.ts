import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { AUTO_CHECKLIST_KEYS, computeChecklistAutoStatus, getConnectionInfo, getLocation, getValidToken } from "@/lib/google-business"
import { NextResponse } from "next/server"

const AUTO_KEYS = new Set<string>(AUTO_CHECKLIST_KEYS)

/**
 * Trae el estado real de los items auto-detectables leyendo el perfil de Google conectado. Si
 * Google no está conectado, el token venció, o la API no responde, devuelve null y el checklist
 * cae de vuelta al valor manual guardado en la tabla — mismo comportamiento gracioso que ya usan
 * el tab de Perfil y Publicaciones ante errores de esta API.
 */
async function getAutoStatus(): Promise<Record<string, boolean> | null> {
  try {
    const serviceDb = getServiceDb()
    const info = await getConnectionInfo(serviceDb)
    if (!info?.google_location_name) return null

    const token = await getValidToken(serviceDb)
    if (!token) return null

    const location = await getLocation(token, info.google_location_name)
    return computeChecklistAutoStatus(location)
  } catch {
    return null
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await supabase
    .from("google_local_checklist")
    .select("*")
    .order("item_key")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const autoStatus = await getAutoStatus()

  const items = data.map(item => {
    if (autoStatus && AUTO_KEYS.has(item.item_key)) {
      return { ...item, completed: autoStatus[item.item_key], auto: true }
    }
    // Google no está conectado ahora mismo: se puede seguir tildando a mano como fallback.
    return { ...item, auto: false }
  })

  // Mantiene la tabla en sync con lo detectado, para que el valor persistido no quede desactualizado
  // si Google se desconecta más tarde.
  if (autoStatus) {
    const serviceDb = getServiceDb()
    await Promise.all(
      Object.entries(autoStatus).map(([item_key, completed]) =>
        serviceDb.from("google_local_checklist").update({ completed }).eq("item_key", item_key)
      )
    )
  }

  return NextResponse.json(items)
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { item_key, completed, notes } = await request.json()

  // No hace falta bloquear item_key auto-detectables acá: mientras Google esté conectado, el
  // próximo GET vuelve a sobreescribir el valor con lo real. El botón ya está deshabilitado en
  // el front para esos items mientras se puedan verificar en vivo.
  const { data, error } = await supabase
    .from("google_local_checklist")
    .upsert({ item_key, completed, notes }, { onConflict: "item_key" })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
