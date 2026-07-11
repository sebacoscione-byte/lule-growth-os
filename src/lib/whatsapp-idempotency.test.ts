import { decideClaimOutcome, classifyWebhookError } from "./whatsapp-idempotency"
import { WindowClosedError, TemplateNotApprovedError } from "@/lib/whatsapp"

describe("decideClaimOutcome", () => {
  it("reclama un wa_message_id que nunca se vio (primera entrega)", () => {
    expect(decideClaimOutcome(null)).toBe("claim")
  })

  it("permite reintentar un evento que falló de forma transitoria", () => {
    expect(decideClaimOutcome("failed_transient")).toBe("retry")
  })

  it("trata como duplicado un evento ya procesado con éxito (reenvío de Meta)", () => {
    expect(decideClaimOutcome("processed")).toBe("duplicate")
  })

  it("trata como duplicado un evento que está siendo procesado en simultáneo (concurrencia)", () => {
    expect(decideClaimOutcome("processing")).toBe("duplicate")
  })

  it("trata como duplicado un evento que falló de forma definitiva (no reintentable)", () => {
    expect(decideClaimOutcome("failed_permanent")).toBe("duplicate")
  })
})

describe("classifyWebhookError", () => {
  it("clasifica la ventana cerrada como error definitivo", () => {
    expect(classifyWebhookError(new WindowClosedError("5491100000000"))).toBe("permanent")
  })

  it("clasifica un template no aprobado como error definitivo", () => {
    expect(classifyWebhookError(new TemplateNotApprovedError("recontacto_incompleto"))).toBe("permanent")
  })

  it("clasifica un error genérico como transitorio por defecto", () => {
    expect(classifyWebhookError(new Error("fetch failed"))).toBe("transient")
  })

  it("clasifica un valor no-Error lanzado como transitorio por defecto", () => {
    expect(classifyWebhookError("algo raro")).toBe("transient")
  })
})
