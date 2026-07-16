import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { parseJsonBody } from "@/lib/api-validation"
import { mergeWhatsAppSettings, whatsAppSettingsSchema } from "@/lib/whatsapp-settings"
import {
  createWhatsAppLocationsVersion,
  getWhatsAppLocationsStatus,
  parseWhatsAppLocations,
} from "@/lib/whatsapp-location-config"
import { authorizeStaff } from "@/lib/staff-authz"
import { recordSecurityAudit } from "@/lib/security-audit"

const CONFIG_READ_ROLES = ["owner", "doctor"] as const
const CONFIG_WRITE_ROLES = ["owner"] as const

// Únicas claves que este endpoint (usado por la pantalla de Configuración y por el panel de
// auto-publicación del Estudio de contenido) puede leer/escribir. El resto de app_config (tokens
// de Google/Instagram, el array completo de content_pipeline, etc.) se maneja por rutas dedicadas
// y nunca debe viajar al navegador de la doctora.
const CONFIG_KEYS = ["doctor", "locations", "whatsapp_settings", "auto_publish_settings"] as const

export async function GET() {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: CONFIG_READ_ROLES })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const { data, error } = await supabase
    .from("app_config")
    .select("key, value")
    .in("key", CONFIG_KEYS)
  if (error) {
    return NextResponse.json(
      { error: "No se pudo cargar la configuración", code: "config_unavailable" },
      { status: 503 }
    )
  }

  const locationsValue = data?.find((row: { key: string }) => row.key === "locations")?.value
  const parsedLocations = parseWhatsAppLocations(locationsValue)
  if (!parsedLocations.success) {
    return NextResponse.json(
      { error: "La configuración de sedes no es válida", code: "invalid_locations_config" },
      { status: 503 }
    )
  }

  const map: Record<string, unknown> = {}
  data?.forEach((row: { key: string; value: unknown }) => {
    map[row.key] = row.value
  })
  map.locations = parsedLocations.data
  map.locations_status = getWhatsAppLocationsStatus(
    parsedLocations.data,
    parsedLocations.usedLegacyPractices
  )
  map.version = createWhatsAppLocationsVersion(locationsValue)
  return NextResponse.json(map)
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: CONFIG_WRITE_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const parsedBody = await parseJsonBody(req)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const { key } = parsedBody.data as { key?: string; value: unknown }
  let { value } = parsedBody.data as { key?: string; value: unknown }

  if (!key || value === undefined) {
    return NextResponse.json({ error: "key y value son requeridos" }, { status: 400 })
  }
  if (!CONFIG_KEYS.includes(key as (typeof CONFIG_KEYS)[number])) {
    return NextResponse.json({ error: "key no permitida" }, { status: 400 })
  }

  // Las sedes tienen una ruta por ID con confirmación, evidencia y CAS independientes.
  // Aceptar el documento completo acá permitiría volver a sellar filas que nadie revisó.
  if (key === "locations") {
    return NextResponse.json(
      { error: "Usá la ruta dedicada para modificar una sede", code: "location_route_required" },
      { status: 400 }
    )
  }

  if (key === "whatsapp_settings") {
    const settings = whatsAppSettingsSchema.safeParse(value)
    if (!settings.success) {
      return NextResponse.json({ error: "Configuración de WhatsApp inválida" }, { status: 400 })
    }
    value = mergeWhatsAppSettings(settings.data)
  }

  try {
    await recordSecurityAudit({
      actorUserId: auth.user.id,
      actorRole: auth.role,
      action: "config_update",
      resourceType: "configuration",
      resourceId: key,
      metadata: { config_key: key },
    })
  } catch {
    return NextResponse.json({ error: "No se pudo registrar la actualización de configuración" }, { status: 503 })
  }

  const { error } = await supabase
    .from("app_config")
    .upsert({ key, value }, { onConflict: "key" })

  if (error) {
    return NextResponse.json(
      { error: "No se pudo guardar la configuración", code: "config_update_failed" },
      { status: 503 }
    )
  }
  return NextResponse.json({ ok: true })
}
