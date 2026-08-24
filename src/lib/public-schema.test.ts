import { buildMedicalClinicJsonLd } from "@/lib/public-schema"

describe("buildMedicalClinicJsonLd", () => {
  it("publica una sede con datos visibles y la vincula con la doctora", () => {
    const result = buildMedicalClinicJsonLd([{
      key: "cimel",
      name: "CIMEL Lanús",
      address: "Tucumán 1314, Lanús",
      phone: "011 4249-3412",
      mapsUrl: "https://maps.example/cimel",
    }], "https://draluciachahin.ar/dra-lucia-chahin")

    expect(result["@graph"]).toEqual([expect.objectContaining({
      "@type": "MedicalClinic",
      "@id": "https://draluciachahin.ar/dra-lucia-chahin#sede-cimel",
      name: "CIMEL Lanús",
      address: "Tucumán 1314, Lanús",
      telephone: "011 4249-3412",
      hasMap: "https://maps.example/cimel",
      employee: { "@id": "https://draluciachahin.ar/dra-lucia-chahin#dra-lucia-chahin" },
    })])
  })

  it("omite datos opcionales que no están verificados", () => {
    const result = buildMedicalClinicJsonLd(
      [{ key: "sede", name: "Sede" }],
      "https://draluciachahin.ar/dra-lucia-chahin"
    )
    expect(result["@graph"][0]).not.toHaveProperty("address")
    expect(result["@graph"][0]).not.toHaveProperty("telephone")
    expect(result["@graph"][0]).not.toHaveProperty("hasMap")
  })
})
