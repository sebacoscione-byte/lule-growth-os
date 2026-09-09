import {
  findPracticeInstitutionInText,
  findPracticeSiteInText,
  getPracticeSitesForInstitution,
  PRACTICE_SITE_BY_ID,
} from "@/lib/practice-directory"

describe("directorio compartido de lugares de atención", () => {
  it("conserva el cronograma vigente completo", () => {
    expect(PRACTICE_SITE_BY_ID.cimel_lanus.hours).toBe(
      "Martes 13:00–15:00 · Jueves y viernes 13:00–16:00"
    )
    expect(PRACTICE_SITE_BY_ID.hospital_britanico_lanus).toEqual(expect.objectContaining({
      address: "Av. Hipólito Yrigoyen 4429, Lanús",
      hours: "Martes 16:00–19:30",
      serviceNote: "Ecocardiogramas",
    }))
    expect(PRACTICE_SITE_BY_ID.hospital_britanico_central.hours).toBe("Miércoles 17:00–19:45")
    expect(PRACTICE_SITE_BY_ID.swiss_lomas.hours).toBe("Viernes 17:00–20:00")
  })

  it("separa las dos sedes físicas del Hospital Británico bajo la misma institución", () => {
    expect(getPracticeSitesForInstitution("hospital_britanico").map(site => site.id)).toEqual([
      "hospital_britanico_lanus",
      "hospital_britanico_central",
    ])
  })

  it("reconoce una sede física explícita", () => {
    expect(findPracticeSiteInText("¿Dónde queda el Hospital Británico de Lanús?")?.id)
      .toBe("hospital_britanico_lanus")
    expect(findPracticeSiteInText("Quiero atenderme en Perdriel 74")?.id)
      .toBe("hospital_britanico_central")
  })

  it("no inventa una institución a partir de días o ciudades ambiguos", () => {
    expect(findPracticeInstitutionInText("¿Atiende el martes?")).toBeNull()
    expect(findPracticeInstitutionInText("Prefiero el viernes")).toBeNull()
    expect(findPracticeInstitutionInText("Quiero atenderme en Lanús")).toBeNull()
    expect(findPracticeInstitutionInText("Tengo OSMECON Lomas")).toBeNull()
    expect(findPracticeInstitutionInText("Quiero cambiar de sede a Lomas")).toBe("swiss_lomas")
    expect(findPracticeInstitutionInText("¿Atiende el jueves?")).toBe("cimel_lanus")
    expect(findPracticeInstitutionInText("¿Atiende el miércoles?")).toBe("hospital_britanico")
  })
})
