import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { parseJsonBody } from "@/lib/api-validation"
import { mergeWhatsAppSettings, whatsAppSettingsSchema } from "@/lib/whatsapp-settings"
import { whatsappLocationsSchema } from "@/lib/whatsapp-location-config"
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const map: Record<string, unknown> = {}
  data?.forEach((row: { key: string; value: unknown }) => {
    map[row.key] = row.value
  })
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

  if (key === "whatsapp_settings") {
    const settings = whatsAppSettingsSchema.safeParse(value)
    if (!settings.success) {
      return NextResponse.json({ error: "Configuración de WhatsApp inválida" }, { status: 400 })
    }
    value = mergeWhatsAppSettings(settings.data)
  }

  if (key === "locations") {
    const locations = whatsappLocationsSchema.safeParse(value)
    if (!locations.success) {
      return NextResponse.json({ error: "Configuración de sedes inválida" }, { status: 400 })
    }

    // Guardar el documento completo desde esta ruta restringida constituye la verificación
    // operativa. El servidor firma la identidad/fecha: el navegador no puede atribuirlas.
    const verifiedAt = new Date().toISOString()
    value = locations.data.map(location => ({
      ...location,
      active: location.active ?? true,
      verified_at: verifiedAt,
      verified_by: auth.user.id,
      valid_from: location.valid_from ?? verifiedAt,
    }))
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
