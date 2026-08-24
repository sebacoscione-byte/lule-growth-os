export const PHYSICIAN_SCHEMA_FRAGMENT = "#dra-lucia-chahin"

type PublicClinic = {
  key: string
  name: string
  address?: string
  phone?: string
  mapsUrl?: string
}

/** Datos estructurados de sedes: usa solo información ya visible y verificada en la landing. */
export function buildMedicalClinicJsonLd(clinics: PublicClinic[], physicianUrl: string) {
  return {
    "@context": "https://schema.org",
    "@graph": clinics.map(clinic => ({
      "@type": "MedicalClinic",
      "@id": `${physicianUrl}#sede-${clinic.key}`,
      name: clinic.name,
      medicalSpecialty: "Cardiology",
      ...(clinic.address ? { address: clinic.address } : {}),
      ...(clinic.phone ? { telephone: clinic.phone } : {}),
      ...(clinic.mapsUrl ? { hasMap: clinic.mapsUrl } : {}),
      employee: { "@id": `${physicianUrl}${PHYSICIAN_SCHEMA_FRAGMENT}` },
    })),
  }
}
