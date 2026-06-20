import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Heart, MapPin, Clock, AlertTriangle } from "lucide-react"
import { LANDING_DATA } from "@/lib/public-landings"
import { LandingInteractions } from "./landing-interactions"

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const data = LANDING_DATA[slug]
  if (!data) return { title: "No encontrado" }
  return {
    title: data.title,
    description: data.description,
    alternates: {
      canonical: `/${slug}`,
    },
  }
}

export default async function LandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const data = LANDING_DATA[slug]
  if (!data) notFound()

  const isMain = slug === "dra-lucia-chahin"

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
          {isMain && (
            <p className="text-sm text-gray-500 mt-3">
              Consultas cardiológicas y ecocardiogramas · Lanús y Lomas de Zamora
            </p>
          )}
        </div>
      </section>

      {isMain && (
        <>
          <section className="px-4 py-12">
            <div className="mx-auto max-w-2xl">
              <h2 className="mb-4 text-center text-xl font-bold text-gray-900">Sobre la Dra. Lucía Chahin</h2>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-sm leading-6 text-gray-700">
                <p>
                  La Dra. Lucía Chahin es médica cardióloga. Atiende pacientes que buscan consulta cardiológica,
                  controles cardiovasculares y ecocardiogramas en Lanús y Lomas de Zamora.
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
                {data.locations.map((loc) => (
                  <div key={loc.name} className="rounded-lg border border-gray-200 bg-white p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <MapPin className="h-5 w-5 text-blue-600" />
                      <h3 className="font-semibold text-gray-900">{loc.name}</h3>
                    </div>
                    <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
                      <Clock className="h-4 w-4" />
                      <span>Atención los {loc.day}</span>
                    </div>
                    {loc.address && <p className="text-sm text-gray-500">{loc.address}</p>}
                    <p className="mt-4 rounded-lg bg-blue-50 p-3 text-sm font-medium text-blue-900">
                      {loc.instruction}
                    </p>
                  </div>
                ))}
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
                <Heart className="h-4 w-4 text-rose-400 shrink-0" />
                <span className="text-sm font-medium text-gray-800">{service}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Interacciones para /dra-lucia-chahin: CTAs expandibles + formulario */}
      {isMain ? (
        <LandingInteractions slug={slug} />
      ) : (
        /* Instrucciones estáticas para landings SEO */
        <section className="py-12 px-4 bg-blue-50">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-6 text-center">Cómo pedir turno</h2>
            <div className="space-y-4">
              {data.locations.map((loc) => (
                <div key={loc.name} className="bg-white rounded-lg border border-blue-200 p-6">
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
                  <p className="mt-3 text-sm text-gray-500">
                    Para más información,{" "}
                    <Link href="/dra-lucia-chahin" className="text-blue-600 underline underline-offset-2">
                      visitá la página de la Dra. Lucía Chahin
                    </Link>.
                  </p>
                  <p className="mt-3 text-xs text-gray-500">
                    No se otorgan turnos desde esta web. Para pedir turno, comunicarse con CIMEL o Swiss Medical y solicitar a la Dra. Lucía Chahin.
                  </p>
                </div>
              ))}
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
