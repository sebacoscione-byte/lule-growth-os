jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/staff-authz", () => ({ authorizeStaff: jest.fn() }))
jest.mock("@/lib/security-audit", () => ({ recordSecurityAudit: jest.fn() }))

import { DELETE, PUT } from "./route"
import { createClient } from "@/lib/supabase/server"
import { authorizeStaff } from "@/lib/staff-authz"
import { recordSecurityAudit } from "@/lib/security-audit"
import { createWhatsAppLocationsVersion } from "@/lib/whatsapp-location-config"

const user = { id: "00000000-0000-4000-8000-000000000001" }
const NOW = new Date("2026-07-16T15:00:00.000Z")
const locations = [
  {
    id: "cimel_lanus",
    name: "CIMEL Lanús",
    services: ["Consulta"],
    active: true,
    verified_at: "2026-07-01T12:00:00.000Z",
    verified_by: "reviewer-old",
    valid_from: "2026-07-01T12:00:00.000Z",
  },
  {
    id: "swiss_lomas",
    name: "Swiss Medical Lomas",
    services: ["Consulta"],
    active: false,
    verified_at: "2026-06-01T12:00:00.000Z",
    verified_by: "reviewer-other",
    valid_from: "2026-06-01T12:00:00.000Z",
  },
]

function mockClient(options: {
  current?: unknown
  readError?: unknown
  updateError?: unknown
  casMiss?: boolean
} = {}) {
  const current = options.current === undefined ? locations : options.current
  let writtenValue: unknown

  const updateMaybeSingle = jest.fn(async () => ({
    data: options.casMiss ? null : { value: writtenValue },
    error: options.updateError ?? null,
  }))
  const updateBuilder = {
    eq: jest.fn(),
    filter: jest.fn(),
    select: jest.fn(),
    maybeSingle: updateMaybeSingle,
  }
  updateBuilder.eq.mockReturnValue(updateBuilder)
  updateBuilder.filter.mockReturnValue(updateBuilder)
  updateBuilder.select.mockReturnValue(updateBuilder)

  const readMaybeSingle = jest.fn().mockResolvedValue({
    data: options.readError ? null : { value: current },
    error: options.readError ?? null,
  })
  const readBuilder = {
    eq: jest.fn(),
    maybeSingle: readMaybeSingle,
  }
  readBuilder.eq.mockReturnValue(readBuilder)

  const select = jest.fn().mockReturnValue(readBuilder)
  const update = jest.fn((payload: { value: unknown }) => {
    writtenValue = payload.value
    return updateBuilder
  })
  const client = {
    auth: { getUser: jest.fn() },
    from: jest.fn(() => ({ select, update })),
  }
  ;(createClient as jest.Mock).mockResolvedValue(client)
  return { client, select, update, updateBuilder, getWrittenValue: () => writtenValue }
}

function putRequest(body: unknown) {
  return new Request("http://localhost/api/config/locations/cimel_lanus", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function deleteRequest(body: unknown) {
  return new Request("http://localhost/api/config/locations/cimel_lanus", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function params(id = "cimel_lanus") {
  return { params: Promise.resolve({ id }) }
}

function validPutBody(overrides: Record<string, unknown> = {}) {
  return {
    version: createWhatsAppLocationsVersion(locations),
    confirmed: true,
    location: {
      name: "CIMEL Lanús",
      services: ["Consulta actualizada"],
      obras_sociales: ["OSDE"],
      active: true,
    },
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers().setSystemTime(NOW)
  ;(authorizeStaff as jest.Mock).mockResolvedValue({
    ok: true, user, role: "owner", legacyCompatibility: false, assuranceLevel: "aal2",
  })
  ;(recordSecurityAudit as jest.Mock).mockResolvedValue(undefined)
})

afterEach(() => {
  jest.useRealTimers()
})

describe("PUT /api/config/locations/[id]", () => {
  it("exige owner y AAL2 antes de procesar la sede", async () => {
    mockClient()
    const response = await PUT(putRequest(validPutBody()), params())
    expect(response.status).toBe(200)
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner"],
      sensitive: true,
    })
  })

  it("rechaza IDs desconocidos y bodies con ID, evidencia o extras", async () => {
    const { select, update } = mockClient()
    const unknown = await PUT(putRequest(validPutBody()), params("inventada"))
    expect(unknown.status).toBe(404)

    for (const location of [
      { name: "CIMEL", active: true, id: "cimel_lanus" },
      { name: "CIMEL", active: true, verified_by: "forged" },
      { name: "CIMEL", active: true, secret: "extra" },
    ]) {
      const response = await PUT(putRequest(validPutBody({ location })), params())
      expect(response.status).toBe(400)
    }
    expect(select).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(recordSecurityAudit).not.toHaveBeenCalled()
  })

  it("rechaza una versión obsoleta antes de auditar o escribir", async () => {
    const { update } = mockClient()
    const response = await PUT(putRequest(validPutBody({ version: "b".repeat(64) })), params())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(expect.objectContaining({ code: "locations_version_conflict" }))
    expect(recordSecurityAudit).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it("sella solo el target, conserva evidencia ajena y hace CAS del JSON completo", async () => {
    const { update, updateBuilder, getWrittenValue } = mockClient()
    const response = await PUT(putRequest(validPutBody()), params())
    const body = await response.json()
    const written = getWrittenValue() as Array<Record<string, unknown>>

    expect(response.status).toBe(200)
    expect(written[0]).toEqual(expect.objectContaining({
      id: "cimel_lanus",
      services: ["Consulta actualizada"],
      verified_at: NOW.toISOString(),
      verified_by: user.id,
      valid_from: NOW.toISOString(),
    }))
    expect(written[1]).toEqual(expect.objectContaining({
      id: "swiss_lomas",
      verified_at: "2026-06-01T12:00:00.000Z",
      verified_by: "reviewer-other",
      valid_from: "2026-06-01T12:00:00.000Z",
    }))
    expect(updateBuilder.filter).toHaveBeenCalledWith("value", "eq", JSON.stringify(locations))
    expect((recordSecurityAudit as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan(update.mock.invocationCallOrder[0])
    expect(body.locations).toEqual(written)
    expect(body.locations_status.valid).toBe(true)
    expect(body.version).toMatch(/^[a-f0-9]{64}$/)
  })

  it("detecta una carrera en el CAS sin afirmar que guardó", async () => {
    mockClient({ casMiss: true })
    const response = await PUT(putRequest(validPutBody()), params())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(expect.objectContaining({ code: "locations_version_conflict" }))
  })

  it("falla cerrado si la auditoría no está disponible", async () => {
    const { update } = mockClient()
    ;(recordSecurityAudit as jest.Mock).mockRejectedValue(new Error("secret audit detail"))
    const response = await PUT(putRequest(validPutBody()), params())
    expect(response.status).toBe(503)
    expect(update).not.toHaveBeenCalled()
    expect(JSON.stringify(await response.json())).not.toContain("secret audit detail")
  })

  it("redacta fallas de lectura y escritura", async () => {
    mockClient({ readError: new Error("secret read detail") })
    const readFailure = await PUT(putRequest(validPutBody()), params())
    expect(readFailure.status).toBe(503)
    expect(JSON.stringify(await readFailure.json())).not.toContain("secret read detail")

    mockClient({ updateError: new Error("secret write detail") })
    const writeFailure = await PUT(putRequest(validPutBody()), params())
    expect(writeFailure.status).toBe(503)
    expect(JSON.stringify(await writeFailure.json())).not.toContain("secret write detail")
  })
})

describe("DELETE /api/config/locations/[id]", () => {
  it("elimina solo el target sin resellar las otras sedes", async () => {
    const { getWrittenValue, updateBuilder } = mockClient()
    const response = await DELETE(deleteRequest({
      version: createWhatsAppLocationsVersion(locations),
    }), params())
    const written = getWrittenValue() as Array<Record<string, unknown>>

    expect(response.status).toBe(200)
    expect(written).toEqual([expect.objectContaining({
      id: "swiss_lomas",
      verified_at: "2026-06-01T12:00:00.000Z",
      verified_by: "reviewer-other",
      valid_from: "2026-06-01T12:00:00.000Z",
    })])
    expect(updateBuilder.filter).toHaveBeenCalledWith("value", "eq", JSON.stringify(locations))
    expect(recordSecurityAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "config_update",
      resourceType: "configuration",
      resourceId: "cimel_lanus",
      metadata: { config_key: "locations" },
    }))
  })

  it("rechaza extras y no convierte una sede ausente en una operación exitosa", async () => {
    mockClient()
    const strictFailure = await DELETE(deleteRequest({
      version: createWhatsAppLocationsVersion(locations),
      id: "cimel_lanus",
    }), params())
    expect(strictFailure.status).toBe(400)

    mockClient({ current: [locations[1]] })
    const missing = await DELETE(deleteRequest({
      version: createWhatsAppLocationsVersion([locations[1]]),
    }), params())
    expect(missing.status).toBe(404)
    expect(recordSecurityAudit).not.toHaveBeenCalled()
  })
})
