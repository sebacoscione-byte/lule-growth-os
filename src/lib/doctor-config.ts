import { z } from "zod"

const professionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "El correo profesional es demasiado largo")
  .email("El correo profesional no es válido")

/**
 * La configuración histórica de la doctora puede contener campos agregados por migraciones
 * anteriores. Validamos el correo nuevo sin descartar esos datos al volver a guardar el objeto.
 */
export const doctorConfigSchema = z.object({
  email: z.union([professionalEmailSchema, z.literal("")]).optional(),
}).passthrough()

export type DoctorConfig = z.infer<typeof doctorConfigSchema>
