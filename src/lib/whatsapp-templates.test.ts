import { fillTemplateBody } from "@/lib/whatsapp-templates"
import type { WhatsAppTemplate } from "@/types"

describe("fillTemplateBody", () => {
  it("reemplaza las variables posicionales del template", () => {
    const template: WhatsAppTemplate = {
      id: "1",
      name: "confirmacion_turno",
      category: "utility",
      language: "es_AR",
      status: "aprobado",
      body_text: "Hola {{1}}, tu turno en {{2}} es el {{3}}.",
      variables: ["nombre", "sede", "fecha"],
      variable_samples: ["Juana", "CIMEL Lanús", "martes 10:00hs"],
    }

    const result = fillTemplateBody(template, ["Juana", "CIMEL Lanús", "martes 10hs"])
    expect(result).toBe("Hola Juana, tu turno en CIMEL Lanús es el martes 10hs.")
  })
})
