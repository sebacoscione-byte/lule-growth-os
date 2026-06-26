import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { MapPin, Clock, AlertTriangle, Phone, Map } from "lucide-react"
import { LANDING_DATA } from "@/lib/public-landings"
import { createServiceClient } from "@/lib/supabase/server"
import { LandingInteractions } from "./landing-interactions"

export const dynamic = "force-dynamic"

type ConfigLocation = {
  id: string
  name: string
  address?: string
  google_maps_link?: string
  phone?: string
  hours?: string
  booking_instruction?: string
  notes?: string
}

async function getConfigLocations(): Promise<ConfigLocation[]> {
  try {
    const supabase = await createServiceClient()
    const { data } = await supabase.from("app_config").select("value").eq("key", "locations").single()
    return Array.isArray(data?.value) ? (data.value as ConfigLocation[]) : []
  } catch {
    return []
  }
}

function matchConfigLocation(locName: string, configLocations: ConfigLocation[]): ConfigLocation | undefined {
  const lower = locName.toLowerCase()
  return configLocations.find(c => {
    const cName = (c.name ?? "").toLowerCase()
    if (lower.includes("cimel") && cName.includes("cimel")) return true
    if (lower.includes("swiss") && cName.includes("swiss")) return true
    return cName === lower
  })
}

function getBaseUrl(): string {
  if (process.env.GOOGLE_OAUTH_BASE_URL) return process.env.GOOGLE_OAUTH_BASE_URL.replace(/\/$/, "")
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return "https://draluciachahin.com.ar"
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const data = LANDING_DATA[slug]
  if (!data) return { title: "No encontrado" }
  const base = getBaseUrl()
  const url = `${base}/${slug}`
  return {
    title: data.title,
    description: data.description,
    alternates: { canonical: url },
    openGraph: {
      title: data.title,
      description: data.description,
      url,
      type: "website",
      locale: "es_AR",
      siteName: "Dra. Lucía Chahin — Cardióloga",
    },
    twitter: {
      card: "summary",
      title: data.title,
      description: data.description,
    },
  }
}

export default async function LandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const data = LANDING_DATA[slug]
  if (!data) notFound()

  const configLocations = await getConfigLocations()
  const isMain = slug === "dra-lucia-chahin"

  return (
    <main className="min-h-screen bg-white">

      {/* Hero */}
      {isMain ? (
        <section className="bg-gradient-to-b from-blue-50 to-white py-12 px-4">
          <div className="max-w-2xl mx-auto">
            <div className="flex flex-col sm:flex-row items-center gap-8">
              <div className="shrink-0">
                <div className="relative h-44 w-44 rounded-full overflow-hidden border-4 border-white shadow-lg">
                  <Image
                    src="/lucia-chahin.jpg"
                    alt="Dra. Lucía Chahin — Cardióloga"
                    fill
                    className="object-cover object-top"
                    priority
                  />
                </div>
              </div>
              <div className="text-center sm:text-left">
                <h1 className="text-3xl font-bold text-gray-900">{data.h1}</h1>
                <p className="text-blue-600 font-medium mt-1">Cardióloga y Ecocardiografista</p>
                <p className="text-gray-600 mt-3 leading-relaxed">{data.intro}</p>
                <p className="text-sm text-gray-500 mt-2">
                  Consultas cardiológicas y ecocardiogramas · Lanús y Lomas de Zamora
                </p>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="bg-gradient-to-b from-blue-50 to-white py-16 px-4">
          <div className="max-w-2xl mx-auto text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">{data.h1}</h1>
            <p className="text-lg text-gray-600">{data.intro}</p>
          </div>
        </section>
      )}

      {isMain && (
        <>
          <section className="px-4 py-12">
            <div className="mx-auto max-w-2xl">
              <h2 className="mb-4 text-center text-xl font-bold text-gray-900">Sobre la Dra. Lucía Chahin</h2>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-sm leading-6 text-gray-700">
                <p>
                  La Dra. Lucía Chahin es médica cardióloga y ecocardiografista. Atiende pacientes que buscan
                  consulta cardiológica, controles cardiovasculares y ecocardiogramas en Lanús y Lomas de Zamora.
                </p>
                <p className="mt-3">
                  Esta web reúne la información necesaria para elegir sede, conocer los días de atención y pedir
                  turno por los canales oficiales de cada institución.
                </p>
              </div>
            </div>
          </section>

          <section className="bg-gray-50 px-4 py-12">
            <div className="mx-auto max-w-2xl">
              <h2 className="mb-6 text-center text-xl font-bold text-gray-900">Dónde atiende</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {data.locations.map((loc) => {
                  const cfg = matchConfigLocation(loc.name, configLocations)
                  const hours = cfg?.hours || null
                  const phone = cfg?.phone || loc.phone
                  const address = cfg?.address || loc.address
                  const mapsUrl = cfg?.google_maps_link || loc.mapsUrl
                  return (
                    <div key={loc.name} className="rounded-lg border border-gray-200 bg-white p-5">
                      <div className="mb-3 flex items-center gap-2">
                        <MapPin className="h-5 w-5 text-blue-600" />
                        <h3 className="font-semibold text-gray-900">{loc.name}</h3>
                      </div>

                      {/* Días y horarios — destacado */}
                      {hours ? (
                        <div className="mb-3 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white whitespace-pre-line">
                          <Clock className="mb-0.5 inline h-3.5 w-3.5 mr-1" />
                          {hours}
                        </div>
                      ) : (
                        <div className="mb-3 flex items-center gap-2 text-sm text-gray-500">
                          <Clock className="h-4 w-4" />
                          <span>Atención los {loc.day}</span>
                        </div>
                      )}

                      {address && <p className="text-sm text-gray-500">{address}</p>}
                      {phone && (
                        <a
                          href={`tel:${phone.replace(/[\s-]/g, "")}`}
                          className="mt-1 flex items-center gap-1.5 text-sm text-gray-700 hover:text-blue-600"
                        >
                          <Phone className="h-3.5 w-3.5" />
                          {phone}
                        </a>
                      )}
                      <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm font-medium text-blue-900">
                        {cfg?.booking_instruction || loc.instruction}
                      </p>
                      {mapsUrl && (
                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700"
                        >
                          <Map className="h-4 w-4" />
                          Ver en Google Maps
                        </a>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        </>
      )}

      {/* Servicios */}
      <section className="py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-gray-900 mb-6 text-center">Servicios</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.services.map((service) => (
              <div key={service} className="flex items-center gap-2 p-4 rounded-lg border border-gray-200 bg-gray-50">
                <span className="h-2 w-2 rounded-full bg-rose-400 shrink-0" />
                <span className="text-sm font-medium text-gray-800">{service}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Interacciones */}
      {isMain ? (
        <LandingInteractions slug={slug} />
      ) : (
        <section className="py-12 px-4 bg-blue-50">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-6 text-center">Cómo pedir turno</h2>
            <div className="space-y-4">
              {data.locations.map((loc) => {
                const cfg = matchConfigLocation(loc.name, configLocations)
                const hours = cfg?.hours || null
                const phone = cfg?.phone || loc.phone
                const address = cfg?.address || loc.address
                const mapsUrl = cfg?.google_maps_link || loc.mapsUrl
                return (
                  <div key={loc.name} className="bg-white rounded-lg border border-blue-200 p-6">
                    <div className="flex items-center gap-2 mb-3">
                      <MapPin className="h-5 w-5 text-blue-600" />
                      <h3 className="font-semibold text-gray-900">{loc.name}</h3>
                    </div>

                    {/* Días y horarios — destacado */}
                    {hours ? (
                      <div className="mb-3 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white whitespace-pre-line">
                        <Clock className="mb-0.5 inline h-3.5 w-3.5 mr-1" />
                        {hours}
                      </div>
                    ) : (
                      <div className="mb-3 flex items-center gap-2 text-sm text-gray-500">
                        <Clock className="h-4 w-4" />
                        <span>Atención los {loc.day}</span>
                      </div>
                    )}

                    {address && <p className="text-sm text-gray-500 mb-1">{address}</p>}
                    {phone && (
                      <a
                        href={`tel:${phone.replace(/[\s-]/g, "")}`}
                        className="mb-3 flex items-center gap-1.5 text-sm text-gray-700 hover:text-blue-600"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        {phone}
                      </a>
                    )}
                    <div className="rounded-lg bg-blue-50 p-4">
                      <p className="text-sm text-blue-900 font-medium">
                        {cfg?.booking_instruction || loc.instruction}
                      </p>
                    </div>
                    <div className="mt-4 flex flex-col sm:flex-row gap-3 flex-wrap">
                      {mapsUrl && (
                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-2 border border-blue-300 text-blue-600 hover:bg-blue-50 font-medium px-4 py-2 rounded-full text-sm transition-colors"
                        >
                          <Map className="h-4 w-4" />
                          Ver en Google Maps
                        </a>
                      )}
                      <Link
                        href="/dra-lucia-chahin"
                        className="inline-flex items-center justify-center text-sm text-blue-600 hover:underline"
                      >
                        Ver página completa de la Dra. Lucía Chahin →
                      </Link>
                    </div>
                    <p className="mt-3 text-xs text-gray-500">
                      No se otorgan turnos desde esta web. Para pedir turno, comunicarse directamente con la institución.
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* Aviso */}
      <section className="py-8 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-4">
            <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
            <div className="text-sm text-orange-800">
              <p className="font-medium mb-1">Aviso importante</p>
              <p>
                Este sitio no reemplaza una consulta médica y no debe usarse para urgencias.
                Ante síntomas de alarma (dolor de pecho, falta de aire, etc.), concurrí a una guardia o llamá al 107.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="py-6 px-4 text-center text-xs text-gray-400 border-t border-gray-100">
        <p>Dra. Lucía Chahin — Médica Cardióloga y Ecocardiografista</p>
        <p className="mt-1">Este sitio tiene carácter informativo y no reserva turnos ni confirma disponibilidad.</p>
      </footer>

    </main>
  )
}
