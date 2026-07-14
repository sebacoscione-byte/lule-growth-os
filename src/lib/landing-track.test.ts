// testEnvironment por default es "node" (ver jest.config.js) -- se simula `window` a mano en vez
// de sumar jest-environment-jsdom como dependencia nueva solo para este archivo.
describe("trackLandingEvent", () => {
  const originalWindow = (global as { window?: unknown }).window
  const originalFetch = global.fetch

  afterEach(() => {
    jest.resetModules()
    ;(global as { window?: unknown }).window = originalWindow
    global.fetch = originalFetch
  })

  function setHostname(hostname: string) {
    ;(global as unknown as { window: unknown }).window = { location: { hostname } }
  }

  it("no manda el evento cuando corre en localhost (dev/tests no deben ensuciar analytics real)", async () => {
    setHostname("localhost")
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const { trackLandingEvent } = await import("@/lib/landing-track")
    trackLandingEvent("page_view", "dra-lucia-chahin")

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("no manda el evento en 127.0.0.1", async () => {
    setHostname("127.0.0.1")
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const { trackLandingEvent } = await import("@/lib/landing-track")
    trackLandingEvent("page_view", "dra-lucia-chahin")

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sí manda el evento en un dominio real", async () => {
    setHostname("draluciachahin.ar")
    const fetchMock = jest.fn().mockResolvedValue({ ok: true })
    global.fetch = fetchMock as unknown as typeof fetch

    const { trackLandingEvent } = await import("@/lib/landing-track")
    trackLandingEvent("page_view", "dra-lucia-chahin")

    expect(fetchMock).toHaveBeenCalledWith("/api/public/click", expect.objectContaining({
      method: "POST",
      keepalive: true,
    }))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ event_type: "page_view", slug: "dra-lucia-chahin" })
  })
})
