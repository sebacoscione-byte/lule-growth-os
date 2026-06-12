import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Heart, MapPin, Clock, AlertTriangle } from "lucide-react"

const LANDING_DATA: Record<string, {
  title: string
  description: string
  h1: string
  intro: string
  services: string[]
  locations: { name: string; address?: string; day: string; instruction: string }[]
}> = {
  "dra-lucia-chahin": {
    title: "Dra. Lucía Chahin — Cardióloga | CIMEL Lanús · Swiss Medical Lomas",
    description: "La Dra. Lucía Chahin es médica cardióloga. Atiende consultas de cardiología y realiza ecocardiogramas en CIMEL Lanús (martes) y Swiss Medical Lomas (viernes).",
    h1: "Dra. Lucía Chahin — Cardióloga",
    intro: "La Dra. Lucía Chahin es médica cardióloga especializada en consultas cardiológicas y ecocardiogramas. Atiende en Lanús y Lomas de Zamora.",
    services: ["Consulta cardiológica", "Ecocardiograma", "Control cardiológico", "Evaluación cardiovascular"],
    locations: [
      { name: "CIMEL Lanús", address: "Tucumán 1314, Lanús", day: "Martes", instruction: "Llamá a CIMEL Lanús y pedí turno con la Dra. Lucía Chahin para cardiología o ecocardiograma." },
      { name: "Swiss Medical Lomas", day: "Viernes", instruction: "Pedí turno por los canales oficiales de Swiss Medical Lomas y solicitá atención con la Dra. Lucía Chahin." },
    ],
  },
  "cardiologa-lanus": {
    title: "Cardióloga en Lanús — Dra. Lucía Chahin | CIMEL Lanús",
    description: "¿Buscás una cardióloga en Lanús? La Dra. Lucía Chahin atiende consultas de cardiología los martes en CIMEL Lanús (Tucumán 1314).",
    h1: "Cardióloga en Lanús — Dra. Lucía Chahin",
    intro: "Si buscás una cardióloga en Lanús, la Dra. Lucía Chahin atiende los martes en CIMEL Lanús. Realizá consultas cardiológicas y ecocardiogramas.",
    services: ["Consulta cardiológica", "Ecocardiograma", "Control cardiológico"],
    locations: [
      { name: "CIMEL Lanús", address: "Tucumán 1314, Lanús", day: "Martes", instruction: "Llamá a CIMEL Lanús y pedí turno con la Dra. Lucía Chahin para cardiología." },
    ],
  },
  "cardiologa-lomas": {
    title: "Cardióloga en Lomas de Zamora — Dra. Lucía Chahin | Swiss Medical",
    description: "¿Buscás una cardióloga en Lomas de Zamora? La Dra. Lucía Chahin atiende consultas de cardiología los viernes en Swiss Medical Lomas.",
    h1: "Cardióloga en Lomas de Zamora — Dra. Lucía Chahin",
    intro: "Si buscás una cardióloga en Lomas de Zamora, la Dra. Lucía Chahin atiende los viernes en Swiss Medical Lomas.",
    services: ["Consulta cardiológica", "Ecocardiograma", "Control cardiológico"],
    locations: [
      { name: "Swiss Medical Lomas", day: "Viernes", instruction: "Pedí turno por los canales oficiales de Swiss Medical Lomas y solicitá atención con la Dra. Lucía Chahin." },
    ],
  },
  "ecocardiograma-lanus": {
    title: "Ecocardiograma en Lanús — Dra. Lucía Chahin | CIMEL Lanús",
    description: "¿Necesitás un ecocardiograma en Lanús? La Dra. Lucía Chahin realiza ecocardiogramas los martes en CIMEL Lanús (Tucumán 1314).",
    h1: "Ecocardiograma en Lanús — Dra. Lucía Chahin",
    intro: "Si necesitás un ecocardiograma en Lanús, la Dra. Lucía Chahin lo realiza los martes en CIMEL Lanús.",
    services: ["Ecocardiograma", "Consulta cardiológica"],
    locations: [
      { name: "CIMEL Lanús", address: "Tucumán 1314, Lanús", day: "Martes", instruction: "Llamá a CIMEL Lanús y pedí turno con la Dra. Lucía Chahin para ecocardiograma." },
    ],
  },
  "ecocardiograma-lomas": {
    title: "Ecocardiograma en Lomas de Zamora — Dra. Lucía Chahin | Swiss Medical",
    description: "¿Necesitás un ecocardiograma en Lomas de Zamora? La Dra. Lucía Chahin realiza ecocardiogramas los viernes en Swiss Medical Lomas.",
    h1: "Ecocardiograma en Lomas de Zamora — Dra. Lucía Chahin",
    intro: "Si necesitás un ecocardiograma en Lomas de Zamora, la Dra. Lucía Chahin lo realiza los viernes en Swiss Medical Lomas.",
    services: ["Ecocardiograma", "Consulta cardiológica"],
    locations: [
      { name: "Swiss Medical Lomas", day: "Viernes", instruction: "Pedí turno por los canales oficiales de Swiss Medical Lomas y solicitá atención con la Dra. Lucía Chahin para ecocardiograma." },
    ],
  },
  "consulta-cardiologica-lanus": {
    title: "Consulta Cardiológica en Lanús — Dra. Lucía Chahin | CIMEL",
    description: "Consulta cardiológica en Lanús con la Dra. Lucía Chahin. Atiende los martes en CIMEL Lanús, Tucumán 1314.",
    h1: "Consulta Cardiológica en Lanús — Dra. Lucía Chahin",
    intro: "Para una consulta cardiológica en Lanús, la Dra. Lucía Chahin atiende los martes en CIMEL Lanús.",
    services: ["Consulta cardiológica", "Ecocardiograma", "Control cardiovascular"],
    locations: [
      { name: "CIMEL Lanús", address: "Tucumán 1314, Lanús", day: "Martes", instruction: "Llamá a CIMEL Lanús y pedí turno con la Dra. Lucía Chahin para consulta de cardiología." },
    ],
  },
  "consulta-cardiologica-lomas": {
    title: "Consulta Cardiológica en Lomas de Zamora — Dra. Lucía Chahin | Swiss Medical",
    description: "Consulta cardiológica en Lomas de Zamora con la Dra. Lucía Chahin. Atiende los viernes en Swiss Medical Lomas.",
    h1: "Consulta Cardiológica en Lomas de Zamora — Dra. Lucía Chahin",
    intro: "Para una consulta cardiológica en Lomas de Zamora, la Dra. Lucía Chahin atiende los viernes en Swiss Medical Lomas.",
    services: ["Consulta cardiológica", "Ecocardiograma", "Control cardiovascular"],
    locations: [
      { name: "Swiss Medical Lomas", day: "Viernes", instruction: "Pedí turno por los canales oficiales de Swiss Medical Lomas y solicitá atención con la Dra. Lucía Chahin." },
    ],
  },
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const data = LANDING_DATA[slug]
  if (!data) return { title: "No encontrado" }
  return {
    title: data.title,
    description: data.description,
  }
}

export default async function LandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const data = LANDING_DATA[slug]
  if (!data) notFound()

  return (
    <main className="min-h-screen bg-white">
      {/* Hero */}
      <section className="bg-gradient-to-b from-blue-50 to-white py-16 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <div className="flex justify-center mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-100">
              <Heart className="h-7 w-7 text-rose-500" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">{data.h1}</h1>
          <p className="text-lg text-gray-600">{data.intro}</p>
        </div>
      </section>

      {/* Servicios */}
      <section className="py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-gray-900 mb-6 text-center">Servicios</h2>
          <div className="grid grid-cols-2 gap-3">
            {data.services.map((service) => (
              <div key={service} className="flex items-center gap-2 p-4 rounded-lg border border-gray-200 bg-gray-50">
                <Heart className="h-4 w-4 text-rose-400 shrink-0" />
                <span className="text-sm font-medium text-gray-800">{service}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cómo pedir turno */}
      <section className="py-12 px-4 bg-blue-50">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-gray-900 mb-6 text-center">Cómo pedir turno</h2>
          <div className="space-y-4">
            {data.locations.map((loc) => (
              <div key={loc.name} className="bg-white rounded-xl border border-blue-200 p-6">
                <div className="flex items-center gap-2 mb-3">
                  <MapPin className="h-5 w-5 text-blue-600" />
                  <h3 className="font-semibold text-gray-900">{loc.name}</h3>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
                  <Clock className="h-4 w-4" />
                  <span>Atención los {loc.day}</span>
                </div>
                {loc.address && (
                  <p className="text-sm text-gray-500 mb-3">{loc.address}</p>
                )}
                <div className="rounded-lg bg-blue-50 p-4">
                  <p className="text-sm text-blue-900 font-medium">{loc.instruction}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Aviso */}
      <section className="py-8 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-4">
            <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
            <div className="text-sm text-orange-800">
              <p className="font-medium mb-1">Aviso importante</p>
              <p>Este sitio no reemplaza una consulta médica y no debe usarse para urgencias. Ante síntomas de alarma (dolor de pecho, falta de aire, etc.), concurrí a una guardia o llamá al 107.</p>
            </div>
          </div>
        </div>
      </section>

      <footer className="py-6 px-4 text-center text-xs text-gray-400 border-t border-gray-100">
        <p>Dra. Lucía Chahin — Médica Cardióloga</p>
        <p className="mt-1">Este sitio tiene carácter informativo y no reserva turnos ni confirma disponibilidad.</p>
      </footer>
    </main>
  )
}
