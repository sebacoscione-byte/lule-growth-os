import { getWindowState, detectEntryPoint } from "@/lib/whatsapp-window"

describe("getWindowState", () => {
  it("sin mensajes previos del paciente la ventana esta cerrada", () => {
    expect(getWindowState(null, "organic")).toBe("closed")
  })

  it("dentro de las 24h de un mensaje organico la ventana esta abierta", () => {
    const now = new Date("2026-07-04T12:00:00Z")
    const lastInbound = new Date("2026-07-04T00:00:00Z").toISOString()
    expect(getWindowState(lastInbound, "organic", now)).toBe("open")
  })

  it("pasadas las 24h de un mensaje organico la ventana esta cerrada", () => {
    const now = new Date("2026-07-05T01:00:00Z")
    const lastInbound = new Date("2026-07-04T00:00:00Z").toISOString()
    expect(getWindowState(lastInbound, "organic", now)).toBe("closed")
  })

  it("un entry point ctwa mantiene la ventana abierta hasta 72h (Free Entry Point)", () => {
    const now = new Date("2026-07-06T23:00:00Z")
    const lastInbound = new Date("2026-07-04T00:00:00Z").toISOString()
    expect(getWindowState(lastInbound, "ctwa", now)).toBe("open")
  })

  it("pasadas las 72h incluso el entry point ctwa cierra la ventana", () => {
    const now = new Date("2026-07-07T01:00:00Z")
    const lastInbound = new Date("2026-07-04T00:00:00Z").toISOString()
    expect(getWindowState(lastInbound, "ctwa", now)).toBe("closed")
  })
})

describe("detectEntryPoint", () => {
  it("sin referral es organico", () => {
    expect(detectEntryPoint(undefined)).toEqual({ entryPoint: "organic", ctwaClid: null })
  })

  it("referral con ctwa_clid se detecta como Click-to-WhatsApp", () => {
    const result = detectEntryPoint({ source_type: "ad", ctwa_clid: "abc123" })
    expect(result).toEqual({ entryPoint: "ctwa", ctwaClid: "abc123" })
  })

  it("referral sin ctwa_clid pero con source_type se detecta como referral generico", () => {
    const result = detectEntryPoint({ source_type: "page_cta" })
    expect(result).toEqual({ entryPoint: "referral", ctwaClid: null })
  })
})
