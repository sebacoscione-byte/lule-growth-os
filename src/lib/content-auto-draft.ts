import type { SupabaseClient } from "@supabase/supabase-js"
import { generateContentPlan, getAiMode, getPublicAiError, proposeAutoDraftCategories } from "@/lib/ai"
import {
  buildDraftContentItem,
  listKnownCategories,
  mutateContentItems,
  readAutoPublishSettings,
  readContentItems,
  type AutoPublishFormat,
} from "@/lib/content-pipeline"
import type { AutoPublishSettings, ContentItem, ContentObjective } from "@/types"

// Reel queda afuera a proposito: ese formato depende de generar video con Veo (costo real por
// intento, ~USD 0.80-1 el clip) con su propio gate de revision humana (video_reference_frame_review)
// antes de poder aprobarse -- no tiene sentido dispararlo solo, sin que alguien lo pida a mano desde
// el editor. Post/historia/carrusel usan el mismo pipeline de texto+placa que "Generar propuesta
// completa" y no tienen ese costo/gate.
const AUTO_DRAFT_FORMATS: AutoPublishFormat[] = ["post", "historia", "carrusel"]
const OBJECTIVES: ContentObjective[] = ["conversion", "educacion", "confianza", "alcance"]
// Cuantas semanas de cronograma tiene que sostener la cola de "esperando revision" (borrador o
// aprobado) antes de dejar de reponer -- a pedido explicito de Seba (2026-08-12): una semana de
// colchon se sentía corta, quiere 2 semanas siempre cubiertas.
const AUTO_DRAFT_TARGET_WEEKS = 2
// Topes por corrida (no por semana): esto corre una vez al dia dentro de daily-maintenance, asi que
// un deficit grande (mas probable ahora que el objetivo es 2 semanas, no 1) se repone gradualmente
// en varios dias en vez de generar todo de una vez.
const MAX_DRAFTS_PER_FORMAT_PER_RUN = 3
const MAX_DRAFTS_PER_RUN = 6
// Cuantas piezas recientes le mostramos a la IA de propuesta de categorias como contexto de "que ya
// esta cubierto" -- alcanza de sobra para ver que categorias se repiten o quedaron sin tocar, sin
// inflar el prompt con todo el historico.
const RECENT_HISTORY_LIMIT = 20
// Cuantas piezas aprobadas/publicadas recientes le mostramos a generateContentPlan como "no repitas
// este angulo" -- mas amplio que RECENT_HISTORY_LIMIT a proposito: ese es solo para elegir la
// CATEGORIA, este es para elegir el TEMA/GANCHO puntual dentro de la categoria ya elegida, que es
// donde Seba reporto sentir repeticion real (2026-08-12) aunque la categoria variara.
const RECENT_TOPICS_LIMIT = 40

function lastUsedAt(items: ContentItem[], matches: (item: ContentItem) => boolean): number {
  const relevant = items.filter(item => item.status !== "archived" && matches(item))
  if (relevant.length === 0) return -Infinity
  return Math.max(...relevant.map(item => new Date(item.created_at).getTime()))
}

/** Pura: entre los candidatos (excluyendo los ya elegidos en `exclude`, salvo que eso vacie el pool
 * por completo), el que hace mas tiempo que no se usa -- nunca usado gana siempre. */
function pickLeastRecentlyUsed<T extends string>(
  candidates: T[],
  items: ContentItem[],
  matches: (item: ContentItem, candidate: T) => boolean,
  exclude: Set<T>
): T | null {
  const available = candidates.filter(candidate => !exclude.has(candidate))
  const pool = available.length > 0 ? available : candidates
  if (pool.length === 0) return null
  return [...pool].sort((a, b) =>
    lastUsedAt(items, item => matches(item, a)) - lastUsedAt(items, item => matches(item, b))
  )[0]
}

export interface PlannedDraft {
  format: AutoPublishFormat
  category: string
  objective: ContentObjective
}

export interface PlannedSlot {
  format: AutoPublishFormat
}

/**
 * Pura, sin I/O: cuantos borradores nuevos hace falta generar por formato para sostener
 * AUTO_DRAFT_TARGET_WEEKS de cronograma (dias programados x piezas por corrida x semanas) sin pisar
 * lo que ya espera revision (borrador o aprobado) -- a pedido de Seba (2026-08-05, ver
 * docs/BACKLOG.md "Cola de historias y carruseles aprobados en 0"; objetivo subido de 1 a 2 semanas
 * el 2026-08-12). Nunca elige "reel" (ver AUTO_DRAFT_FORMATS). Solo decide CUANTAS piezas hacen
 * falta por formato -- QUE categoria/objetivo les toca se resuelve aparte en `buildAutoDraftPlan`
 * (necesita llamar a la IA, no puede ser pura).
 */
export function planAutoDraftSlots(
  items: ContentItem[],
  autoPublishSettings: AutoPublishSettings
): PlannedSlot[] {
  const slots: PlannedSlot[] = []

  for (const format of AUTO_DRAFT_FORMATS) {
    if (slots.length >= MAX_DRAFTS_PER_RUN) break
    const track = autoPublishSettings[format]
    if (!track.enabled || track.schedule_slots.length === 0) continue

    const targetSupply = track.schedule_slots.length * track.items_per_run * AUTO_DRAFT_TARGET_WEEKS
    const currentSupply = items.filter(item =>
      item.format === format && (item.status === "draft" || item.status === "approved")
    ).length
    const deficit = targetSupply - currentSupply
    if (deficit <= 0) continue

    const toGenerate = Math.min(deficit, MAX_DRAFTS_PER_FORMAT_PER_RUN, MAX_DRAFTS_PER_RUN - slots.length)
    for (let i = 0; i < toGenerate; i++) slots.push({ format })
  }
  return slots
}

/** Pura, sin I/O: contexto de "que ya esta cubierto" para que la IA de propuesta de categorias pueda
 * distinguir un tema recien tocado de uno que hace mucho no se sube (o nunca se subio). Incluye
 * borrador/aprobada/publicada (nunca archivada, esa ya no cuenta como "vigente"), mas reciente
 * primero. */
export function buildRecentHistoryContext(
  items: ContentItem[],
  now: Date,
  limit: number = RECENT_HISTORY_LIMIT
): Array<{ category: string; topic: string; status: string; days_ago: number }> {
  return items
    .filter(item => item.status !== "archived")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit)
    .map(item => ({
      category: item.category,
      topic: item.topic,
      status: item.status,
      days_ago: Math.max(0, Math.floor((now.getTime() - new Date(item.created_at).getTime()) / 86_400_000)),
    }))
}

/** Pura, sin I/O: "no repitas esto" para generateContentPlan -- a diferencia de
 * buildRecentHistoryContext (que ayuda a elegir la CATEGORIA), esto ayuda a elegir el TEMA/GANCHO
 * puntual dentro de la categoria ya elegida. A pedido explicito de Seba (2026-08-12: "siento que hay
 * muchos temas repetidos"), solo mira lo aprobado/publicado -- un borrador todavia puede
 * descartarse o cambiar de tema, no es una repeticion real todavia (mismo criterio que
 * findRecentDuplicateTopic en content-pipeline.ts). Mas reciente primero. */
export function buildRecentTopicsContext(
  items: ContentItem[],
  limit: number = RECENT_TOPICS_LIMIT
): Array<{ category: string; topic: string; hook: string }> {
  return items
    .filter(item => item.status === "approved" || item.status === "published")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit)
    .map(item => ({ category: item.category, topic: item.topic, hook: item.hook }))
}

/** Pura, sin I/O: el mecanismo anterior a la propuesta por IA (rotacion por "hace mas tiempo que no
 * se usa" entre las categorias ya conocidas) -- se conserva como respaldo determinístico si
 * `proposeAutoDraftCategories` falla (ver project_ai_fallback_providers_unfunded en memoria), para
 * que un problema de facturación de la IA no frene la reposición de la cola por completo. */
export function pickCategoriesDeterministically(items: ContentItem[], count: number): string[] {
  const categoryPool = listKnownCategories(items)
  const usedThisRun = new Set<string>()
  const picked: string[] = []
  for (let i = 0; i < count; i++) {
    const category = pickLeastRecentlyUsed(
      categoryPool,
      items,
      (item, candidate) => item.category.trim().toLocaleLowerCase("es") === candidate.toLocaleLowerCase("es"),
      usedThisRun
    )
    if (!category) break
    usedThisRun.add(category)
    picked.push(category)
  }
  return picked
}

/**
 * Arma el plan completo (formato + categoría + objetivo) para la corrida: cuántas piezas por formato
 * (`planAutoDraftSlots`, pura) y qué categoría le toca a cada una. La categoría se le pide a la IA
 * (`proposeAutoDraftCategories`, a pedido explícito de Seba 2026-08-05: no solo rotar por antigüedad
 * entre una lista fija, también pensar categorías genuinamente nuevas mirando qué quedó cubierto o
 * hace mucho no se toca) — si esa llamada falla o devuelve menos de lo pedido, se completa con el
 * método determinístico anterior (`pickCategoriesDeterministically`) sin frenar la corrida.
 */
export async function buildAutoDraftPlan(
  items: ContentItem[],
  autoPublishSettings: AutoPublishSettings,
  now: Date
): Promise<PlannedDraft[]> {
  const slots = planAutoDraftSlots(items, autoPublishSettings)
  if (slots.length === 0) return []

  let categories: string[] = []
  try {
    categories = await proposeAutoDraftCategories({
      count: slots.length,
      established_categories: listKnownCategories(items),
      recent_history: buildRecentHistoryContext(items, now),
    })
  } catch {
    categories = []
  }

  if (categories.length < slots.length) {
    const seen = new Set(categories.map(category => category.toLocaleLowerCase("es")))
    for (const fallback of pickCategoriesDeterministically(items, slots.length)) {
      if (categories.length >= slots.length) break
      const key = fallback.toLocaleLowerCase("es")
      if (seen.has(key)) continue
      seen.add(key)
      categories.push(fallback)
    }
  }

  return slots.slice(0, categories.length).map((slot, index) => {
    const formatItems = items.filter(item => item.format === slot.format)
    const objective = pickLeastRecentlyUsed(
      OBJECTIVES,
      formatItems,
      (item, candidate) => (item.objective ?? "conversion") === candidate,
      new Set<ContentObjective>()
    ) ?? "educacion"
    return { format: slot.format, category: categories[index], objective }
  })
}

export interface AutoDraftGenerationResult {
  skipped: boolean
  planned: number
  generated: number
  error?: string
}

/**
 * Genera borradores nuevos para reponer la cola cuando el cronograma de auto-publicacion (post/
 * historia/carrusel) se queda por debajo de AUTO_DRAFT_TARGET_WEEKS semanas de piezas aprobadas o
 * borradores esperando revision -- a pedido explicito de Seba (2026-08-05, objetivo subido a 2
 * semanas el 2026-08-12). Quedan como Borrador en Biblioteca: nunca se auto-aprueban ni se
 * auto-publican, el resto del flujo (generar placa, aprobar, publicar) sigue siendo manual como
 * siempre. Cada pieza nueva evita repetir el tema/gancho de lo ya aprobado o publicado (y de lo que
 * ya se genero en esta misma corrida, ver `buildRecentTopicsContext`) -- tambien a pedido explicito
 * de Seba, que sentia el contenido repetitivo. En modo manual (sin AI_MODE=gemini_api) no hay forma
 * de generar nada solo -- se salta sin error. Un fallo puntual (error transitorio de la IA) no frena
 * los formatos restantes de la misma corrida, salvo que sea el limite diario de IA agotado -- ahi no
 * tiene sentido seguir intentando.
 */
export async function runAutoDraftGeneration(
  supabase: SupabaseClient,
  now: Date
): Promise<AutoDraftGenerationResult> {
  if (getAiMode() !== "gemini_api") return { skipped: true, planned: 0, generated: 0 }

  const [items, autoPublishSettings] = await Promise.all([
    readContentItems(supabase),
    readAutoPublishSettings(supabase),
  ])
  const plan = await buildAutoDraftPlan(items, autoPublishSettings, now)
  if (plan.length === 0) return { skipped: false, planned: 0, generated: 0 }

  // Se va actualizando a medida que se generan piezas dentro de esta misma corrida, para que la
  // pieza 2 de 6 tambien evite repetir el angulo que acaba de elegir la pieza 1 (no solo lo ya
  // aprobado/publicado antes de empezar a correr).
  const recentTopics = buildRecentTopicsContext(items)
  const newItems: ContentItem[] = []
  const errors: string[] = []
  for (const planned of plan) {
    try {
      const generated = await generateContentPlan({
        topic: "",
        category: planned.category,
        format: planned.format,
        cta: "",
        objective: planned.objective,
        avoid_recent_topics: [...recentTopics],
      })
      const draft = buildDraftContentItem({
        generated,
        topic: "",
        category: planned.category,
        format: planned.format,
        objective: planned.objective,
        source: null,
        now,
      })
      newItems.push(draft)
      recentTopics.unshift({ category: draft.category, topic: draft.topic, hook: draft.hook })
    } catch (error) {
      const message = getPublicAiError(error)
      errors.push(`${planned.format}/${planned.category}: ${message}`)
      if (message.includes("límite diario")) break
    }
  }

  if (newItems.length > 0) {
    await mutateContentItems(supabase, current => [
      ...newItems,
      ...current.filter(item => !newItems.some(created => created.id === item.id)),
    ].slice(0, 100))
  }
  return {
    skipped: false,
    planned: plan.length,
    generated: newItems.length,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  }
}
