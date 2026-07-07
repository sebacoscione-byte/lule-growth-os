import { computeChecklistAutoStatus, type GoogleLocationProfile } from "@/lib/google-business"

function loc(overrides: Partial<GoogleLocationProfile>): GoogleLocationProfile {
  return {
    title: "Dra. Lucía Chahin",
    profile: { description: "Cardióloga con más de 15 años de experiencia atendiendo en Lanús." },
    regularHours: { periods: [{ openDay: "TUESDAY", openTime: "09:00", closeTime: "18:00" }] },
    websiteUri: "https://draluciachahin.ar/dra-lucia-chahin",
    phoneNumbers: { primaryPhone: "+54 11 1234-5678" },
    ...overrides,
  }
}

describe("computeChecklistAutoStatus", () => {
  it("marca todo como completo cuando el perfil real está bien cargado", () => {
    const result = computeChecklistAutoStatus(loc({}))
    expect(result).toEqual({
      nombre_correcto: true,
      descripcion_cargada: true,
      horario_real: true,
      link_landing: true,
      telefono_configurado: true,
    })
  })

  it("nombre_correcto es false si el título tiene keyword stuffing", () => {
    const result = computeChecklistAutoStatus(loc({ title: "Dra. Lucía Chahin - Cardióloga en CIMEL Lanús" }))
    expect(result.nombre_correcto).toBe(false)
  })

  it("nombre_correcto es false si no menciona a Lucía Chahin", () => {
    const result = computeChecklistAutoStatus(loc({ title: "Consultorio Médico" }))
    expect(result.nombre_correcto).toBe(false)
  })

  it("descripcion_cargada es false si la descripción está vacía o es muy corta", () => {
    expect(computeChecklistAutoStatus(loc({ profile: undefined })).descripcion_cargada).toBe(false)
    expect(computeChecklistAutoStatus(loc({ profile: { description: "Cardióloga" } })).descripcion_cargada).toBe(false)
  })

  it("horario_real es false si no hay horario cargado para el martes", () => {
    const result = computeChecklistAutoStatus(loc({ regularHours: { periods: [{ openDay: "FRIDAY", openTime: "09:00", closeTime: "18:00" }] } }))
    expect(result.horario_real).toBe(false)
  })

  it("link_landing es false si el sitio web no apunta a la landing principal", () => {
    const result = computeChecklistAutoStatus(loc({ websiteUri: "https://instagram.com/dra.luciachahin" }))
    expect(result.link_landing).toBe(false)
  })

  it("telefono_configurado es false si no hay teléfono primario", () => {
    const result = computeChecklistAutoStatus(loc({ phoneNumbers: undefined }))
    expect(result.telefono_configurado).toBe(false)
  })
})
