import { startContentLibraryRefresh } from "@/lib/content-library-refresh"

describe("startContentLibraryRefresh", () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it("carga inmediatamente y luego respeta el intervalo", async () => {
    const load = jest.fn().mockResolvedValue(undefined)
    const stop = startContentLibraryRefresh(load, { intervalMs: 1000, isVisible: () => true })

    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(1000)
    expect(load).toHaveBeenCalledTimes(2)
    stop()
  })

  it("no consulta mientras la pestaña está oculta", async () => {
    let visible = true
    const load = jest.fn().mockResolvedValue(undefined)
    const stop = startContentLibraryRefresh(load, { intervalMs: 1000, isVisible: () => visible })
    await Promise.resolve()

    visible = false
    await jest.advanceTimersByTimeAsync(2000)
    expect(load).toHaveBeenCalledTimes(1)

    visible = true
    await jest.advanceTimersByTimeAsync(1000)
    expect(load).toHaveBeenCalledTimes(2)
    stop()
  })

  it("no solapa una carga lenta con el siguiente intervalo", async () => {
    let finishFirst: (() => void) | undefined
    const load = jest.fn().mockImplementation(() => new Promise<void>(resolve => { finishFirst = resolve }))
    const stop = startContentLibraryRefresh(load, { intervalMs: 1000, isVisible: () => true })
    await Promise.resolve()

    await jest.advanceTimersByTimeAsync(3000)
    expect(load).toHaveBeenCalledTimes(1)

    finishFirst?.()
    await Promise.resolve()
    await jest.advanceTimersByTimeAsync(1000)
    expect(load).toHaveBeenCalledTimes(2)
    stop()
  })

  it("deja de refrescar al desmontar", async () => {
    const load = jest.fn().mockResolvedValue(undefined)
    const stop = startContentLibraryRefresh(load, { intervalMs: 1000, isVisible: () => true })
    await Promise.resolve()
    stop()

    await jest.advanceTimersByTimeAsync(3000)
    expect(load).toHaveBeenCalledTimes(1)
  })
})
