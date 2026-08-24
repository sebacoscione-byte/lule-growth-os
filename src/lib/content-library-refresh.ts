export const CONTENT_LIBRARY_REFRESH_INTERVAL_MS = 30_000

type RefreshSchedulerOptions = {
  intervalMs?: number
  isVisible?: () => boolean
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
}

/**
 * Ejecuta una carga inicial y luego refresca mientras la página está visible. Evita requests
 * solapados: una respuesta lenta nunca puede llegar después de otra más nueva y pisarla.
 */
export function startContentLibraryRefresh(
  load: () => Promise<void>,
  options: RefreshSchedulerOptions = {}
): () => void {
  const intervalMs = options.intervalMs ?? CONTENT_LIBRARY_REFRESH_INTERVAL_MS
  const isVisible = options.isVisible ?? (() => document.visibilityState === "visible")
  const setIntervalFn = options.setIntervalFn ?? setInterval
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval
  let inFlight = false
  let stopped = false

  const run = async (scheduled: boolean) => {
    if (stopped || inFlight || (scheduled && !isVisible())) return
    inFlight = true
    try {
      await load()
    } finally {
      inFlight = false
    }
  }

  void run(false)
  const interval = setIntervalFn(() => { void run(true) }, intervalMs)

  return () => {
    stopped = true
    clearIntervalFn(interval)
  }
}
