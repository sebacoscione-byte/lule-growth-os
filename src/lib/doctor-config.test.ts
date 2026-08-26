import { doctorConfigSchema } from "./doctor-config"

describe("doctorConfigSchema", () => {
  it("normaliza y conserva el correo profesional junto con campos existentes", () => {
    expect(doctorConfigSchema.parse({
      name: "Dra. Lucía Chahin",
      email: "  DraLuciaChahin@GMAIL.COM ",
      specializations: ["Ecocardiografía"],
    })).toEqual({
      name: "Dra. Lucía Chahin",
      email: "draluciachahin@gmail.com",
      specializations: ["Ecocardiografía"],
    })
  })

  it("permite dejar el correo vacío", () => {
    expect(doctorConfigSchema.parse({ email: "" })).toEqual({ email: "" })
  })

  it("rechaza un correo inválido", () => {
    expect(doctorConfigSchema.safeParse({ email: "correo-invalido" }).success).toBe(false)
  })
})
