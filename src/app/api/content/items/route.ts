import { NextRequest, NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { readContentItems, writeContentItems } from "@/lib/content-pipeline"
import type { ContentItem } from "@/types"
import { authorizeStaff } from "@/lib/staff-authz"

const INTERACTION_EVENT_TYPES = new Set(["click_booking", "click_call", "click_whatsapp", "click_maps"])
const CONTENT_ROLES = ["owner", "doctor"] as const

class ContentAuthorizationError extends Error {
  constructor(
    readonly status: 401 | 403 | 503,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

async function readAttribution(supabase: SupabaseClient, itemIds: string[]) {
  const attribution: Record<string, { visits: number; interactions: number }> = {}
  if (itemIds.length === 0) return attribution
  const { data } = await supabase
    .from("landing_events")
    .select("utm_content, event_type")
    .in("utm_content", itemIds)
  for (const row of data ?? []) {
    if (!row.utm_content) continue
    const entry = attribution[row.utm_content] ?? { visits: 0, interactions: 0 }
    if (row.event_type === "page_view") entry.visits += 1
    else if (INTERACTION_EVENT_TYPES.has(row.event_type)) entry.interactions += 1
    attribution[row.utm_content] = entry
  }
  return attribution
}

function errorResponse(error: unknown) {
  if (error instanceof ContentAuthorizationError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }
  console.error(`[content/items] ${error instanceof Error ? error.message : String(error)}`)
  return NextResponse.json({ error: "No se pudo completar la operación de contenido" }, { status: 500 })
}

async function authenticatedClient() {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: CONTENT_ROLES })
  if (!auth.ok) throw new ContentAuthorizationError(auth.status, auth.code, auth.error)
  return supabase
}

export async function GET() {
  try {
    const supabase = await authenticatedClient()
    const items = await readContentItems(supabase)
    const attribution = await readAttribution(supabase, items.map(item => item.id))
    const itemsWithAttribution = items.map(item => ({
      ...item,
      tracked_visits: attribution[item.id]?.visits ?? 0,
      tracked_interactions: attribution[item.id]?.interactions ?? 0,
    }))
    return NextResponse.json({ items: itemsWithAttribution })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await authenticatedClient()
    const incoming = await request.json() as ContentItem
    const topic = [incoming.topic, incoming.visual_headline, incoming.hook, incoming.category]
      .find(value => typeof value === "string" && value.trim())?.trim() || "Contenido generado"
    const category = typeof incoming.category === "string" && incoming.category.trim()
      ? incoming.category.trim()
      : "Contenido generado"
    const item = { ...incoming, topic: topic.slice(0, 200), category: category.slice(0, 160) }
    if (!item.id || typeof item.caption !== "string") {
      return NextResponse.json({ error: "Falta el id de la pieza." }, { status: 400 })
    }
    const items = await readContentItems(supabase)
    await writeContentItems(supabase, [item, ...items.filter(existing => existing.id !== item.id)].slice(0, 100))
    return NextResponse.json({ item })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await authenticatedClient()
    const body = await request.json() as Partial<ContentItem> & { id: string }
    const items = await readContentItems(supabase)
    const current = items.find(item => item.id === body.id)
    if (!current) return NextResponse.json({ error: "Borrador no encontrado" }, { status: 404 })

    const textFields: Array<keyof ContentItem> = [
      "hook", "caption", "google_text", "hashtags", "visual_headline", "visual_subtitle",
      "image_prompt", "image_alt_text", "visual_url",
    ]
    if (textFields.some(field => body[field] !== undefined && typeof body[field] !== "string")) {
      return NextResponse.json({ error: "Hay campos de texto invalidos" }, { status: 400 })
    }
    if (body.status && !["draft", "approved", "published", "archived"].includes(body.status)) {
      return NextResponse.json({ error: "Estado invalido" }, { status: 400 })
    }
    if (body.archived_from_status && !["draft", "approved", "published"].includes(body.archived_from_status)) {
      return NextResponse.json({ error: "Estado previo invalido" }, { status: 400 })
    }
    if (body.visual_style && !["rose", "blue", "teal"].includes(body.visual_style)) {
      return NextResponse.json({ error: "Estilo visual invalido" }, { status: 400 })
    }
    if (body.format && !["reel", "historia", "carrusel", "post"].includes(body.format)) {
      return NextResponse.json({ error: "Formato invalido" }, { status: 400 })
    }
    if (body.repeat_interval_days != null && (typeof body.repeat_interval_days !== "number" || body.repeat_interval_days < 1 || body.repeat_interval_days > 365)) {
      return NextResponse.json({ error: "Intervalo de repeticion invalido" }, { status: 400 })
    }
    if (body.repeat_limit != null && (typeof body.repeat_limit !== "number" || body.repeat_limit < 1 || body.repeat_limit > 365)) {
      return NextResponse.json({ error: "Limite de repeticiones invalido" }, { status: 400 })
    }
    if ((body.google_text?.length ?? 0) > 1500 || (body.visual_headline?.length ?? 0) > 90 ||
      (body.visual_subtitle?.length ?? 0) > 90 || (body.image_prompt?.length ?? 0) > 2400 ||
      (body.image_alt_text?.length ?? 0) > 180) {
      return NextResponse.json({ error: "Uno o mas campos superan el limite permitido" }, { status: 400 })
    }
    if (body.slides && (!Array.isArray(body.slides) || body.slides.some(slide =>
      typeof slide?.headline !== "string" || typeof slide?.text !== "string" ||
      slide.headline.length > 60 || slide.text.length > 300 ||
      (slide.visual_url !== undefined && typeof slide.visual_url !== "string") ||
      (slide.image_prompt !== undefined && (typeof slide.image_prompt !== "string" || slide.image_prompt.length > 2400))
    ))) {
      return NextResponse.json({ error: "Slides invalidos" }, { status: 400 })
    }
    if (body.scenes && (!Array.isArray(body.scenes) || body.scenes.length > 6 || body.scenes.some(scene =>
      typeof scene?.onScreenText !== "string" || typeof scene?.shot !== "string" ||
      scene.onScreenText.length > 140 || scene.shot.length > 300
    ))) {
      return NextResponse.json({ error: "Escenas invalidas" }, { status: 400 })
    }
    if (body.reel_duration_seconds != null && (typeof body.reel_duration_seconds !== "number" || body.reel_duration_seconds < 1 || body.reel_duration_seconds > 60)) {
      return NextResponse.json({ error: "Duracion de reel invalida" }, { status: 400 })
    }
    if (body.auto_publish_result !== undefined) {
      const validKeys = ["instagram", "google_business"]
      const validValues = ["published", "error"]
      const valid = typeof body.auto_publish_result === "object" && body.auto_publish_result !== null &&
        Object.entries(body.auto_publish_result).every(([key, value]) => validKeys.includes(key) && validValues.includes(value as string))
      if (!valid) return NextResponse.json({ error: "Resultado de publicacion invalido" }, { status: 400 })
    }

    const now = new Date().toISOString()
    const editableFields: Array<keyof ContentItem> = [
      "status",
      "format",
      "hook",
      "caption",
      "google_text",
      "hashtags",
      "visual_headline",
      "visual_subtitle",
      "visual_style",
      "image_prompt",
      "image_alt_text",
      "slides",
      "scenes",
      "reel_duration_seconds",
      "visual_url",
      "auto_publish_result",
      "archived_from_status",
      "repeat_interval_days",
      "repeat_limit",
    ]
    const changes = Object.fromEntries(
      editableFields
        .filter(field => body[field] !== undefined)
        .map(field => [field, body[field]])
    ) as Partial<ContentItem>
    // visual_url, auto_publish_result y archived_from_status no cuentan como "edicion de contenido":
    // adjuntar la placa generada, limpiar el resultado de publicacion (deshacer) o registrar el
    // estado previo al archivar no debe resetear a borrador. repeat_interval_days es config de
    // cronograma, no contenido -- cambiarla tampoco debe tirar la pieza de vuelta a borrador.
    const nonContentFields = new Set(["status", "visual_url", "auto_publish_result", "archived_from_status", "repeat_interval_days", "repeat_limit"])
    const hasContentChanges = editableFields.some(field => !nonContentFields.has(field) && body[field] !== undefined)
    const resetApproval = hasContentChanges && !body.status && ["approved", "published"].includes(current.status)
    // Al re-activar la repeticion (off -> on), arrancar el contador de cero para que el limite cuente
    // desde esta activacion y no arrastre reposteos de una tanda anterior. repeat_count lo maneja el
    // sistema (cron), nunca el cliente directo.
    const enablingRepeat = body.repeat_interval_days != null && body.repeat_interval_days > 0 && !current.repeat_interval_days
    const nextItem = {
      ...current,
      ...changes,
      ...(enablingRepeat ? { repeat_count: 0 } : {}),
      ...(resetApproval ? { status: "draft" as const } : {}),
      updated_at: now,
      approved_at: body.status === "approved" ? now : resetApproval ? null : current.approved_at,
      // El orden manual de la cola solo tiene sentido mientras esta aprobada -- si vuelve a borrador
      // (por edicion o a mano) y se reaprueba mas adelante, que entre al final de la cola de nuevo.
      queue_rank: resetApproval || body.status === "draft" ? null : current.queue_rank,
    }
    // Instagram no soporta caption en historias (asStory descarta el texto en publishImageToInstagram),
    // asi que hook/caption no son obligatorios para ese formato.
    if (nextItem.status === "approved" && (
      (nextItem.format !== "historia" && [nextItem.hook, nextItem.caption].some(value => !value.trim())) ||
      (!nextItem.visual_headline.trim() && !nextItem.visual_url)
    )) {
      const message = nextItem.format === "historia"
        ? "Agregá un titular visual o subí una imagen propia antes de aprobar"
        : "Completá hook y caption, y agregá un titular visual o subí una imagen propia antes de aprobar"
      return NextResponse.json({ error: message }, { status: 400 })
    }
    // Un carrusel se publica con una imagen real por slide (no alcanza con el titular de texto como en
    // post/historia): exigirlas todas antes de aprobar evita publicar despues un carrusel incompleto.
    if (nextItem.status === "approved" && nextItem.format === "carrusel" && (
      !nextItem.visual_url ||
      !nextItem.slides || nextItem.slides.length === 0 ||
      nextItem.slides.some(slide => !slide.visual_url)
    )) {
      return NextResponse.json({ error: "Para aprobar un carrusel, generá la placa de la portada y de cada slide." }, { status: 400 })
    }

    const updated = items.map(item => item.id === body.id ? nextItem : item)
    await writeContentItems(supabase, updated)
    return NextResponse.json({ item: nextItem })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await authenticatedClient()
    const id = request.nextUrl.searchParams.get("id")
    const status = request.nextUrl.searchParams.get("status")
    if (!id && !status) return NextResponse.json({ error: "id o status requerido" }, { status: 400 })
    // Borrado en lote solo se permite para archivadas -- borrar en lote borradores/aprobadas/publicadas
    // a ciegas es mucho mas riesgoso y no tiene un caso de uso real hoy.
    if (status && status !== "archived") {
      return NextResponse.json({ error: "Solo se puede eliminar en lote el estado archivado" }, { status: 400 })
    }
    const items = await readContentItems(supabase)
    const remaining = status
      ? items.filter(item => item.status !== "archived")
      : items.filter(item => item.id !== id)
    const deletedCount = items.length - remaining.length
    await writeContentItems(supabase, remaining)
    return NextResponse.json({ ok: true, deletedCount })
  } catch (error) {
    return errorResponse(error)
  }
}
