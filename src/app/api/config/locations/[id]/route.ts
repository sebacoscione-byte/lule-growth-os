import { NextResponse } from "next/server"
import { parseJsonBody } from "@/lib/api-validation"
import { recordSecurityAudit } from "@/lib/security-audit"
import { authorizeStaff } from "@/lib/staff-authz"
import { createClient } from "@/lib/supabase/server"
import {
  createWhatsAppLocationsVersion,
  deleteWhatsAppLocation,
  getWhatsAppLocationsStatus,
  parseWhatsAppLocations,
  putWhatsAppLocation,
  WHATSAPP_LOCATION_IDS,
  whatsappLocationDeleteBodySchema,
  whatsappLocationPutBodySchema,
  type WhatsAppLocationConfig,
  type WhatsAppLocationId,
} from "@/lib/whatsapp-location-config"

const CONFIG_WRITE_ROLES = ["owner"] as const

type ServerSupabase = Awaited<ReturnType<typeof createClient>>

function isLocationId(value: string): value is WhatsAppLocationId {
  return (WHATSAPP_LOCATION_IDS as readonly string[]).includes(value)
}

function errorResponse(status: number, code: string, error: string) {
  return NextResponse.json({ error, code }, { status })
}

async function readLocations(supabase: ServerSupabase): Promise<
  | { ok: true; value: unknown; locations: WhatsAppLocationConfig[]; version: string }
  | { ok: false; response: NextResponse }
> {
  const { data, error } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "locations")
    .maybeSingle()

  if (error || !data) {
    return {
      ok: false,
      response: errorResponse(503, "locations_unavailable", "No se pudo cargar la configuración de sedes"),
    }
  }

  const parsed = parseWhatsAppLocations(data.value)
  if (!parsed.success) {
    return {
      ok: false,
      response: errorResponse(503, "invalid_locations_config", "La configuración de sedes no es válida"),
    }
  }

  return {
    ok: true,
    value: data.value,
    locations: parsed.data,
    version: createWhatsAppLocationsVersion(data.value),
  }
}

async function compareAndSwapLocations(
  supabase: ServerSupabase,
  expectedValue: unknown,
  nextValue: WhatsAppLocationConfig[]
): Promise<
  | { ok: true; value: unknown; locations: WhatsAppLocationConfig[] }
  | { ok: false; response: NextResponse }
> {
  const { data, error } = await supabase
    .from("app_config")
    .update({ value: nextValue })
    .eq("key", "locations")
    // PostgREST recibe el JSON serializado; comparar el documento completo hace el update CAS.
    .filter("value", "eq", JSON.stringify(expectedValue))
    .select("value")
    .maybeSingle()

  if (error) {
    return {
      ok: false,
      response: errorResponse(503, "location_update_failed", "No se pudo guardar la sede"),
    }
  }
  if (!data) {
    return {
      ok: false,
      response: errorResponse(409, "locations_version_conflict", "La configuración cambió; recargá los datos"),
    }
  }

  const parsed = parseWhatsAppLocations(data.value)
  if (!parsed.success) {
    return {
      ok: false,
      response: errorResponse(503, "invalid_locations_config", "La configuración de sedes no es válida"),
    }
  }
  return { ok: true, value: data.value, locations: parsed.data }
}

function successResponse(value: unknown, locations: WhatsAppLocationConfig[]) {
  return NextResponse.json({
    ok: true,
    locations,
    locations_status: getWhatsAppLocationsStatus(locations),
    version: createWhatsAppLocationsVersion(value),
  })
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, {
    allowedRoles: CONFIG_WRITE_ROLES,
    sensitive: true,
  })
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })
  }

  const { id } = await params
  if (!isLocationId(id)) {
    return errorResponse(404, "location_not_found", "Sede no encontrada")
  }

  const rawBody = await parseJsonBody(request)
  if (!rawBody.ok) return errorResponse(400, "invalid_request", "Solicitud inválida")
  const body = whatsappLocationPutBodySchema.safeParse(rawBody.data)
  if (!body.success) return errorResponse(400, "invalid_request", "Solicitud inválida")

  const current = await readLocations(supabase)
  if (!current.ok) return current.response
  if (body.data.version !== current.version) {
    return errorResponse(409, "locations_version_conflict", "La configuración cambió; recargá los datos")
  }

  const mutation = putWhatsAppLocation(
    current.value,
    id,
    body.data.location,
    auth.user.id
  )
  if (!mutation.success) {
    return errorResponse(503, "invalid_locations_config", "La configuración de sedes no es válida")
  }

  try {
    await recordSecurityAudit({
      actorUserId: auth.user.id,
      actorRole: auth.role,
      action: "config_update",
      resourceType: "configuration",
      resourceId: id,
      metadata: { config_key: "locations" },
    })
  } catch {
    return errorResponse(503, "audit_unavailable", "No se pudo registrar la actualización")
  }

  const stored = await compareAndSwapLocations(supabase, current.value, mutation.data)
  if (!stored.ok) return stored.response
  return successResponse(stored.value, stored.locations)
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, {
    allowedRoles: CONFIG_WRITE_ROLES,
    sensitive: true,
  })
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })
  }

  const { id } = await params
  if (!isLocationId(id)) {
    return errorResponse(404, "location_not_found", "Sede no encontrada")
  }

  const rawBody = await parseJsonBody(request)
  if (!rawBody.ok) return errorResponse(400, "invalid_request", "Solicitud inválida")
  const body = whatsappLocationDeleteBodySchema.safeParse(rawBody.data)
  if (!body.success) return errorResponse(400, "invalid_request", "Solicitud inválida")

  const current = await readLocations(supabase)
  if (!current.ok) return current.response
  if (body.data.version !== current.version) {
    return errorResponse(409, "locations_version_conflict", "La configuración cambió; recargá los datos")
  }

  const mutation = deleteWhatsAppLocation(current.value, id)
  if (!mutation.success) {
    if (mutation.reason === "location_not_found") {
      return errorResponse(404, "location_not_found", "Sede no encontrada")
    }
    return errorResponse(503, "invalid_locations_config", "La configuración de sedes no es válida")
  }

  try {
    await recordSecurityAudit({
      actorUserId: auth.user.id,
      actorRole: auth.role,
      action: "config_update",
      resourceType: "configuration",
      resourceId: id,
      metadata: { config_key: "locations" },
    })
  } catch {
    return errorResponse(503, "audit_unavailable", "No se pudo registrar la eliminación")
  }

  const stored = await compareAndSwapLocations(supabase, current.value, mutation.data)
  if (!stored.ok) return stored.response
  return successResponse(stored.value, stored.locations)
}
