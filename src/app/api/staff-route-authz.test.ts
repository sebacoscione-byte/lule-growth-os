import { NextRequest } from "next/server"

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/staff-authz", () => ({ authorizeStaff: jest.fn() }))
jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/ai", () => ({
  classifyMessage: jest.fn(),
  generateContentVisual: jest.fn(),
  generateContentPlan: jest.fn(),
  buildContentPlanPrompt: jest.fn(),
  generateInstagramContent: jest.fn(),
  generateGooglePost: jest.fn(),
  generateReviewReply: jest.fn(),
  getAiMode: jest.fn(),
  getAiConfiguration: jest.fn(),
  regenerateImageDirection: jest.fn(),
  generateImageAltText: jest.fn(),
  getPublicAiError: jest.fn(() => "error de IA"),
}))

import { createClient } from "@/lib/supabase/server"
import { authorizeStaff } from "@/lib/staff-authz"
import { getServiceDb } from "@/lib/supabase/service"
import {
  classifyMessage,
  generateContentVisual,
  getAiMode,
  regenerateImageDirection,
  generateImageAltText,
  getAiConfiguration,
} from "@/lib/ai"
import { POST as classify } from "./classify/route"
import { PATCH as updatePricing } from "./whatsapp/pricing/[id]/route"
import { PATCH as updateTemplate } from "./whatsapp/templates/[id]/route"
import { POST as generateVisual } from "./content/visual/route"
import { POST as uploadImage } from "./content/upload-image/route"
import { POST as generateContent } from "./content/route"
import { POST as regenerateDirection } from "./content/image-direction/route"
import { POST as generateAltText } from "./content/alt-text/route"
import { GET as getAiStatus } from "./ai/status/route"
import { GET as getSources } from "./content/sources/route"
import { GET as getPricing } from "./whatsapp/pricing/route"
import { GET as getTemplates } from "./whatsapp/templates/route"

const rejected = {
  ok: false,
  status: 403,
  code: "mfa_required",
  error: "MFA requerido",
}

function jsonRequest(path: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("autorización fail-closed de rutas internas restantes", () => {
  const from = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockResolvedValue({ from })
    ;(authorizeStaff as jest.Mock).mockResolvedValue(rejected)
  })

  it("bloquea clasificación antes de leer/escribir el lead o invocar IA", async () => {
    const response = await classify(jsonRequest("/api/classify", "POST", {
      message: "texto privado del paciente",
      lead_id: "lead-1",
    }))

    expect(response.status).toBe(403)
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner", "doctor", "reception"],
      sensitive: true,
    })
    expect(from).not.toHaveBeenCalled()
    expect(classifyMessage).not.toHaveBeenCalled()
  })

  it("reserva mutaciones de precios y plantillas a owner con MFA", async () => {
    const pricingResponse = await updatePricing(
      jsonRequest("/api/whatsapp/pricing/rule-1", "PATCH", { cost_amount: 1 }),
      { params: Promise.resolve({ id: "rule-1" }) }
    )
    const templateResponse = await updateTemplate(
      jsonRequest("/api/whatsapp/templates/template-1", "PATCH", { status: "aprobado" }),
      { params: Promise.resolve({ id: "template-1" }) }
    )

    expect(pricingResponse.status).toBe(403)
    expect(templateResponse.status).toBe(403)
    expect(authorizeStaff).toHaveBeenCalledTimes(2)
    expect(authorizeStaff).toHaveBeenNthCalledWith(1, expect.anything(), {
      allowedRoles: ["owner"],
      sensitive: true,
    })
    expect(authorizeStaff).toHaveBeenNthCalledWith(2, expect.anything(), {
      allowedRoles: ["owner"],
      sensitive: true,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it("bloquea generación y upload antes de IA o service_role", async () => {
    const visualResponse = await generateVisual(jsonRequest("/api/content/visual", "POST", {
      category: "educación",
      topic: "tema",
      format: "post",
      visual_headline: "titular",
      visual_subtitle: "bajada",
      image_prompt: "prompt",
    }))
    const uploadResponse = await uploadImage(jsonRequest("/api/content/upload-image", "POST", {
      itemId: "item-1",
      imageDataUrl: "data:image/png;base64,aGVsbG8=",
    }))

    expect(visualResponse.status).toBe(403)
    expect(uploadResponse.status).toBe(403)
    expect(authorizeStaff).toHaveBeenCalledTimes(2)
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner", "doctor"],
      sensitive: true,
    })
    expect(generateContentVisual).not.toHaveBeenCalled()
    expect(getServiceDb).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it("bloquea generadores de contenido antes de seleccionar modo o invocar IA", async () => {
    const contentResponse = await generateContent(jsonRequest("/api/content", "POST", {
      type: "google_post",
      topic: "tema",
    }))
    const directionResponse = await regenerateDirection(jsonRequest("/api/content/image-direction", "POST", {
      category: "educación",
      topic: "tema",
      format: "post",
      visual_headline: "titular",
      visual_subtitle: "bajada",
      caption: "texto",
    }))
    const altTextResponse = await generateAltText(jsonRequest("/api/content/alt-text", "POST", {
      topic: "tema",
      visual_headline: "titular",
      visual_subtitle: "bajada",
      image_prompt: "prompt",
    }))

    expect(contentResponse.status).toBe(403)
    expect(directionResponse.status).toBe(403)
    expect(altTextResponse.status).toBe(403)
    expect(authorizeStaff).toHaveBeenCalledTimes(3)
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner", "doctor"],
      sensitive: true,
    })
    expect(getAiMode).not.toHaveBeenCalled()
    expect(regenerateImageDirection).not.toHaveBeenCalled()
    expect(generateImageAltText).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it("restringe lecturas internas de configuración y fuentes antes de DB o red", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(new Response())

    const responses = await Promise.all([
      getAiStatus(),
      getSources(new NextRequest("http://localhost/api/content/sources?topic=Colesterol")),
      getPricing(),
      getTemplates(),
    ])

    expect(responses.every(response => response.status === 403)).toBe(true)
    expect(authorizeStaff).toHaveBeenCalledTimes(4)
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner", "doctor"],
    })
    expect(getAiConfiguration).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
