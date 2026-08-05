import type { SupabaseClient } from "@supabase/supabase-js"
import { generateContentPlan, getAiMode, getPublicAiError } from "@/lib/ai"
import {
  buildDraftContentItem,
  listKnownCategories,
  readAutoPublishSettings,
  readContentItems,
  writeContentItems,
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
// Topes por corrida (no por semana): esto corre una vez al dia dentro de daily-maintenance, asi que
// un deficit grande se repone gradualmente en varios dias en vez de generar todo de una vez.
const MAX_DRAFTS_PER_FORMAT_PER_RUN = 3
const MAX_DRAFTS_PER_RUN = 6

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

/**
 * Pura, sin I/O: cuantos borradores nuevos hace falta generar por formato para sostener una semana
 * de cronograma (dias programados x piezas por corrida) sin pisar lo que ya espera revision
 * (borrador o aprobado) -- a pedido de Seba (2026-08-05, ver docs/BACKLOG.md "Cola de historias y
 * carruseles aprobados en 0"). Nunca elige "reel" (ver AUTO_DRAFT_FORMATS). Categoria y objetivo se
 * eligen por "hace mas tiempo que no se usa" para mantener variedad, y una categoria nunca se repite
 * dentro de la misma corrida -- mismo criterio que hubiera evitado el bug de 3 historias casi
 * identicas publicadas 11s aparte el 2026-07-31 (ver BACKLOG), aunque esa causa raiz puntual nunca
 * se confirmo del todo.
 */
export function planAutoDrafts(
  items: ContentItem[],
  autoPublishSettings: AutoPublishSettings
): PlannedDraft[] {
  const plan: PlannedDraft[] = []
  const categoryPool = listKnownCategories(items)
  const usedCategoriesThisRun = new Set<string>()

  for (const format of AUTO_DRAFT_FORMATS) {
    if (plan.length >= MAX_DRAFTS_PER_RUN) break
    const track = autoPublishSettings[format]
    if (!track.enabled || track.schedule_slots.length === 0) continue

    const weeklyNeed = track.schedule_slots.length * track.items_per_run
    const currentSupply = items.filter(item =>
      item.format === format && (item.status === "draft" || item.status === "approved")
    ).length
    const deficit = weeklyNeed - currentSupply
    if (deficit <= 0) continue

    const toGenerate = Math.min(deficit, MAX_DRAFTS_PER_FORMAT_PER_RUN, MAX_DRAFTS_PER_RUN - plan.length)
    for (let i = 0; i < toGenerate; i++) {
      const category = pickLeastRecentlyUsed(
        categoryPool,
        items,
        (item, candidate) => item.category.trim().toLocaleLowerCase("es") === candidate.toLocaleLowerCase("es"),
        usedCategoriesThisRun
      )
      if (!category) break
      usedCategoriesThisRun.add(category)

      const formatItems = items.filter(item => item.format === format)
      const objective = pickLeastRecentlyUsed(
        OBJECTIVES,
        formatItems,
        (item, candidate) => (item.objective ?? "conversion") === candidate,
        new Set<ContentObjective>()
      ) ?? "educacion"

      plan.push({ format, category, objective })
    }
  }
  return plan
}

export interface AutoDraftGenerationResult {
  skipped: boolean
  planned: number
  generated: number
  error?: string
}

/**
 * Genera borradores nuevos para reponer la cola cuando el cronograma de auto-publicacion (post/
 * historia/carrusel) se queda sin piezas aprobadas ni borradores esperando revision -- a pedido
 * explicito de Seba (2026-08-05). Quedan como Borrador en Biblioteca: nunca se auto-aprueban ni se
 * auto-publican, el resto del flujo (generar placa, aprobar, publicar) sigue siendo manual como
 * siempre. En modo manual (sin AI_MODE=gemini_api) no hay forma de generar nada solo -- se salta sin
 * error. Un fallo puntual (error transitorio de la IA) no frena los formatos restantes de la misma
 * corrida, salvo que sea el limite diario de IA agotado -- ahi no tiene sentido seguir intentando.
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
  const plan = planAutoDrafts(items, autoPublishSettings)
  if (plan.length === 0) return { skipped: false, planned: 0, generated: 0 }

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
      })
      newItems.push(buildDraftContentItem({
        generated,
        topic: "",
        category: planned.category,
        format: planned.format,
        objective: planned.objective,
        source: null,
        now,
      }))
    } catch (error) {
      const message = getPublicAiError(error)
      errors.push(`${planned.format}/${planned.category}: ${message}`)
      if (message.includes("límite diario")) break
    }
  }

  if (newItems.length > 0) await writeContentItems(supabase, [...newItems, ...items])
  return {
    skipped: false,
    planned: plan.length,
    generated: newItems.length,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  }
}
