import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  MapPin, Clock, AlertTriangle, Phone, Map, CalendarCheck, Shield, Star,
  Stethoscope, HeartPulse, ClipboardCheck, Heart, type LucideIcon,
} from "lucide-react"
import {
  LANDING_DATA, WHATSAPP_MESSAGES, whatsAppKeyForLocation, SERVICE_MICROCOPY,
  RELATED_LANDING_SLUGS, buildWhatsAppUrl, type PublicLandingLocation,
} from "@/lib/public-landings"
import { createServiceClient } from "@/lib/supabase/server"
import { LandingInteractions, type SedeAction } from "./landing-interactions"

export const dynamic = "force-dynamic"

type ConfigLocation = {
  id: string
  name: string
  address?: string
  google_maps_link?: string
  phone?: string
  hours?: string
  booking_url?: string
  booking_instruction?: string
  obras_sociales?: string[]
  notes?: string
}

type ConfigDoctor = {
  specializations?: string[]
  conditions_treated?: string[]
  matricula?: string
}

// Fallback: cargado desde la ficha profesional de la Dra. Lucía Chahin.
// Se usa solo si todavía no se cargó nada en Configuración > Datos de la doctora.
const FALLBACK_SPECIALIZATIONS = ["Ecocardiografía", "Electrocardiografía", "Cardiología Adulto"]
const FALLBACK_CONDITIONS_TREATED = [
  "Angina de pecho", "Arritmias", "Desmayo", "Embolismo pulmonar", "Endocarditis",
  "Enfermedad de Chagas", "Enfermedad coronaria", "Enfermedad valvular",
  "Enfermedad de las arterias carótidas", "Espasmo arterial", "Hipertensión arterial",
  "Insuficiencia cardiaca", "Soplo cardiaco", "Infarto",
]

const PREFERRED_LOCATION_BY_KEY: Record<string, "cimel_lanus" | "swiss_lomas" | "sin_definir"> = {
  cimel: "cimel_lanus",
  swiss: "swiss_lomas",
  general: "sin_definir",
}

const SEDE_COLOR: Record<string, "blue" | "teal"> = { cimel: "blue", swiss: "teal", general: "blue" }

const SERVICE_ICONS: Record<string, LucideIcon> = {
  "Consulta cardiológica": Stethoscope,
  "Ecocardiograma": HeartPulse,
  "Control cardiológico": ClipboardCheck,
  "Control cardiovascular": ClipboardCheck,
  "Evaluación cardiovascular": HeartPulse,
}

const MAIN_FAQ = [
  {
    q: "¿Dónde atiende la Dra. Lucía Chahin?",
    a: "La Dra. Lucía Chahin atiende en dos sedes: CIMEL Lanús (Tucumán 1314, Lanús) los martes, y Swiss Medical Lomas de Zamora (Oliden 141) los viernes.",
  },
  {
    q: "¿Qué días atiende en CIMEL Lanús?",
    a: "Atiende los martes en CIMEL Lanús, Tucumán 1314, Lanús.",
  },
  {
    q: "¿Qué días atiende en Swiss Medical Lomas?",
    a: "Atiende los viernes en Swiss Medical Lomas de Zamora, Oliden 141.",
  },
  {
    q: "¿Qué estudios realiza la Dra. Lucía Chahin?",
    a: "Realiza consultas cardiológicas, ecocardiogramas, controles cardiológicos y evaluaciones cardiovasculares.",
  },
  {
    q: "¿Cómo pido turno por Swiss Medical?",
    a: "Podés reservar por el portal Mi Swiss Medical (turnos online), por WhatsApp con el asistente Swity, o llamando a la central de turnos.",
  },
  {
    q: "¿Cómo pido turno en CIMEL Lanús?",
    a: "Comunicate directamente con CIMEL Lanús y solicitá turno con la Dra. Lucía Chahin para cardiología.",
  },
  {
    q: "¿La Dra. Lucía Chahin atiende con obra social?",
    a: "Cada sede acepta distintas coberturas. Para confirmar tu obra social o prepaga, comunicate directamente con la institución elegida.",
  },
  {
    q: "¿Cuándo conviene consultar a una cardióloga?",
    a: "Ante palpitaciones, presión arterial alta, dolor en el pecho, antecedentes familiares de enfermedad cardiovascular, o para un control preventivo periódico.",
  },
  {
    q: "¿Necesito orden médica para un ecocardiograma?",
    a: "Depende de tu cobertura. Te recomendamos consultarlo con tu obra social o directamente con la sede elegida antes de pedir el turno.",
  },
  {
    q: "¿Dónde se formó la Dra. Lucía Chahin?",
    a: "Realizó su residencia de cardiología en el Hospital Británico de Buenos Aires y participó en presentaciones de la Sociedad Argentina de Cardiología (SAC).",
  },
  {
    q: "¿Atienden urgencias?",
    a: "No. Este sitio no atiende urgencias. Ante síntomas de alarma como dolor de pecho o falta de aire intensa, concurrí a una guardia o llamá al 107.",
  },
]

function buildSubpageFaq(data: (typeof LANDING_DATA)[string]) {
  const loc = data.locations[0]
  const otherSede = loc.name.toLowerCase().includes("cimel")
    ? "Swiss Medical Lomas de Zamora los viernes"
    : "CIMEL Lanús los martes"
  return [
    { q: `¿Cómo pido turno con la Dra. Lucía Chahin en ${loc.name}?`, a: loc.instruction },
    {
      q: "¿Atiende con obra social o prepaga?",
      a: "Cada sede acepta distintas coberturas. Consultá directamente con la institución o escribinos por WhatsApp y te ayudamos a confirmarlo.",
    },
    { q: "¿Puedo atenderme en la otra sede?", a: `Sí, la Dra. Lucía Chahin también atiende en ${otherSede}.` },
  ]
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

async function getConfigDoctor(): Promise<ConfigDoctor> {
  try {
    const supabase = await createServiceClient()
    const { data } = await supabase.from("app_config").select("value").eq("key", "doctor").single()
    const value = (data?.value ?? {}) as ConfigDoctor
    return {
      specializations: value.specializations?.length ? value.specializations : FALLBACK_SPECIALIZATIONS,
      conditions_treated: value.conditions_treated?.length ? value.conditions_treated : FALLBACK_CONDITIONS_TREATED,
      matricula: value.matricula || undefined,
    }
  } catch {
    return { specializations: FALLBACK_SPECIALIZATIONS, conditions_treated: FALLBACK_CONDITIONS_TREATED }
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

function buildSedeActions(locations: PublicLandingLocation[], configLocations: ConfigLocation[]): SedeAction[] {
  return locations.map(loc => {
    const cfg = matchConfigLocation(loc.name, configLocations)
    const key = whatsAppKeyForLocation(loc.name)
    return {
      key,
      name: loc.name,
      day: loc.day,
      hours: cfg?.hours || undefined,
      address: cfg?.address || loc.address,
      phone: cfg?.phone || loc.phone,
      mapsUrl: cfg?.google_maps_link || loc.mapsUrl,
      bookingUrl: cfg?.booking_url || undefined,
      instruction: cfg?.booking_instruction || loc.instruction,
      whatsappMessage: WHATSAPP_MESSAGES[key],
      color: SEDE_COLOR[key] ?? "blue",
      preferredLocationValue: PREFERRED_LOCATION_BY_KEY[key] ?? "sin_definir",
    }
  })
}

function getBaseUrl(): string {
  if (process.env.GOOGLE_OAUTH_BASE_URL) return process.env.GOOGLE_OAUTH_BASE_URL.replace(/\/$/, "")
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return "https://draluciachahin.ar"
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

function buildFaqJsonLd(faq: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  }
}

export default async function LandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const data = LANDING_DATA[slug]
  if (!data) notFound()

  const [configLocations, configDoctor] = await Promise.all([getConfigLocations(), getConfigDoctor()])
  const specializations = configDoctor.specializations ?? []
  const conditionsTreated = configDoctor.conditions_treated ?? []
  const isMain = slug === "dra-lucia-chahin"
  const base = getBaseUrl()

  const sedeActions = buildSedeActions(data.locations, configLocations)
  const faq = isMain ? MAIN_FAQ : buildSubpageFaq(data)
  const faqJsonLd = buildFaqJsonLd(faq)

  const personJsonLd = {
    "@context": "https://schema.org",
    "@type": "Physician",
    "name": "Dra. Lucía Belén Chahin",
    "alternateName": "Lucía Chahin",
    "jobTitle": "Médica Cardióloga y Ecocardiografista",
    "description": "Médica cardióloga y ecocardiografista egresada de la residencia de cardiología del Hospital Británico de Buenos Aires. Atiende en CIMEL Lanús los martes y en Swiss Medical Lomas de Zamora los viernes.",
    "medicalSpecialty": "Cardiology",
    "image": `${base}/lucia-chahin.jpg`,
    ...(configDoctor.matricula ? { "identifier": configDoctor.matricula } : {}),
    "alumniOf": {
      "@type": "MedicalOrganization",
      "name": "Hospital Británico de Buenos Aires"
    },
    "worksFor": [
      {
        "@type": "MedicalOrganization",
        "name": "CIMEL Lanús",
        "telephone": "011 4249-3412",
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "Tucumán 1314",
          "addressLocality": "Lanús",
          "addressRegion": "Buenos Aires",
          "addressCountry": "AR"
        }
      },
      {
        "@type": "MedicalOrganization",
        "name": "Swiss Medical Lomas de Zamora",
        "telephone": "0810-333-8876",
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "Oliden 141",
          "addressLocality": "Lomas de Zamora",
          "addressRegion": "Buenos Aires",
          "addressCountry": "AR"
        }
      }
    ],
    knowsAbout: [...specializations, ...conditionsTreated],
  }

  const breadcrumbJsonLd = !isMain ? {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Dra. Lucía Chahin", item: `${base}/dra-lucia-chahin` },
      { "@type": "ListItem", position: 2, name: data.h1, item: `${base}/${slug}` },
    ],
  } : null

  const relatedSlugs = RELATED_LANDING_SLUGS[slug] ?? []

  return (
    <main className="min-h-screen bg-white pb-20 sm:pb-0">
      {isMain && (
        <>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
        </>
      )}
      {!isMain && (
        <>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
        </>
      )}

      {/* Nav de anclas — solo en la landing principal, solo desktop */}
      {isMain && (
        <nav className="sticky top-0 z-40 hidden border-b border-gray-100 bg-white/90 backdrop-blur sm:block">
          <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 text-sm">
            <span className="font-semibold text-gray-900">Dra. Lucía Chahin</span>
            <div className="flex items-center gap-5 text-gray-500">
              <a href="#servicios" className="hover:text-blue-600">Servicios</a>
              <a href="#sedes" className="hover:text-blue-600">Sedes</a>
              <a href="#obras-sociales" className="hover:text-blue-600">Obras sociales</a>
              <a href="#faq" className="hover:text-blue-600">FAQ</a>
              <a href="#pedir-turno" className="rounded-full bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-700">
                Pedir turno
              </a>
            </div>
          </div>
        </nav>
      )}

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
                {configDoctor.matricula && (
                  <p className="text-xs text-gray-500 mt-1">Matrícula {configDoctor.matricula}</p>
                )}
                <p className="text-gray-600 mt-3 leading-relaxed">{data.intro}</p>
                <p className="text-sm text-gray-500 mt-2">
                  Consultas cardiológicas y ecocardiogramas · Lanús y Lomas de Zamora
                </p>

                <div className="mt-5 flex flex-wrap justify-center gap-3 sm:justify-start">
                  <a
                    href="#pedir-turno"
                    className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
                  >
                    <CalendarCheck className="h-4 w-4" />
                    Pedir turno
                  </a>
                  <a
                    href="#sedes"
                    className="inline-flex items-center gap-2 rounded-full border border-blue-300 px-6 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 transition-colors"
                  >
                    Ver sedes y horarios
                  </a>
                </div>

                <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
                  {["Hospital Británico", "CIMEL Lanús", "Swiss Medical Lomas", "Ecocardiograma"].map(chip => (
                    <span key={chip} className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-medium text-blue-700 shadow-sm">
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="bg-gradient-to-b from-blue-50 to-white py-16 px-4">
          <div className="max-w-2xl mx-auto text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">{data.h1}</h1>
            <p className="text-lg text-gray-600 mb-6">{data.intro}</p>
            <div className="flex flex-wrap justify-center gap-3">
              <a
                href="#pedir-turno"
                className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                <CalendarCheck className="h-4 w-4" />
                Pedir turno
              </a>
            </div>
          </div>
        </section>
      )}

      {isMain && (
        <section className="px-4 py-12">
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-4 text-center text-xl font-bold text-gray-900">Sobre la Dra. Lucía Chahin</h2>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-sm leading-6 text-gray-700 space-y-3">
              <p>
                La Dra. <strong>Lucía Belén Chahin</strong> es médica cardióloga y ecocardiografista egresada
                de la residencia de cardiología del <strong>Hospital Británico de Buenos Aires</strong>, una de
                las instituciones de mayor referencia en cardiología del país.
              </p>
              <p>
                Participó en presentaciones científicas en congresos de la <strong>Sociedad Argentina de
                Cardiología (SAC)</strong> sobre compromiso cardíaco en enfermedades sistémicas.
              </p>
              <p>
                Atiende pacientes en <strong>CIMEL Lanús</strong> — centro médico de larga trayectoria en
                Lanús — y en <strong>Swiss Medical Lomas de Zamora</strong>. Realiza consultas cardiológicas,
                ecocardiogramas y controles cardiovasculares.
              </p>
              {configDoctor.matricula && (
                <p className="text-xs text-gray-500">Matrícula profesional: {configDoctor.matricula}</p>
              )}
              <p className="text-xs text-gray-500">
                Esta web reúne la información para elegir sede, conocer los días de atención y pedir turno por
                los canales oficiales de cada institución.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Dónde atiende — cards comparables */}
      <section id="sedes" className="scroll-mt-16 bg-gray-50 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-6 text-center text-xl font-bold text-gray-900">Dónde atiende</h2>
          <div className={`grid gap-4 ${sedeActions.length > 1 ? "sm:grid-cols-2" : ""}`}>
            {sedeActions.map((sede) => (
              <div key={sede.key} className="rounded-lg border border-gray-200 bg-white p-5">
                <div className="mb-3 flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-blue-600" />
                  <h3 className="font-semibold text-gray-900">{sede.name}</h3>
                </div>

                {sede.hours ? (
                  <div className="mb-3 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white whitespace-pre-line">
                    <Clock className="mb-0.5 inline h-3.5 w-3.5 mr-1" />
                    {sede.hours}
                  </div>
                ) : (
                  <div className="mb-3 flex items-center gap-2 text-sm text-gray-500">
                    <Clock className="h-4 w-4" />
                    <span>Atención los {sede.day}</span>
                  </div>
                )}

                {sede.address && <p className="text-sm text-gray-500">{sede.address}</p>}
                {sede.phone && (
                  <a
                    href={`tel:${sede.phone.replace(/[\s-]/g, "")}`}
                    className="mt-1 flex items-center gap-1.5 text-sm text-gray-700 hover:text-blue-600"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    {sede.phone}
                  </a>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <a
                    href={`#sede-${sede.key}`}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    <CalendarCheck className="h-4 w-4" />
                    Pedir turno en esta sede →
                  </a>
                  {sede.mapsUrl && (
                    <a
                      href={sede.mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700"
                    >
                      <Map className="h-4 w-4" />
                      Ver en Google Maps
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Servicios */}
      <section id="servicios" className="scroll-mt-16 py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-gray-900 mb-6 text-center">Servicios</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.services.map((service) => {
              const Icon = SERVICE_ICONS[service] ?? Heart
              return (
                <div key={service} className="p-4 rounded-lg border border-gray-200 bg-gray-50">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100">
                      <Icon className="h-4 w-4 text-blue-600" />
                    </div>
                    <span className="text-sm font-semibold text-gray-800">{service}</span>
                  </div>
                  {SERVICE_MICROCOPY[service] && (
                    <p className="mt-2 text-xs leading-relaxed text-gray-500">{SERVICE_MICROCOPY[service]}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Especialidad y enfermedades tratadas */}
      {(specializations.length > 0 || conditionsTreated.length > 0) && (
        <section className="py-12 px-4 bg-gray-50">
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-4 text-center text-xl font-bold text-gray-900">Especialidad y enfermedades que trata</h2>
            <div className="space-y-6 rounded-lg border border-gray-200 bg-white p-6">
              {specializations.length > 0 && (
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Especialista en</p>
                  <div className="flex flex-wrap gap-2">
                    {specializations.map((s) => (
                      <span key={s} className="bg-blue-50 text-blue-700 text-xs font-medium px-3 py-1 rounded-full">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {conditionsTreated.length > 0 && (
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Enfermedades y condiciones que trata
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {conditionsTreated.map((c) => (
                      <span key={c} className="bg-gray-100 text-gray-600 text-xs px-2.5 py-1 rounded-full">{c}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Opiniones — sin testimonios inventados */}
      {isMain && (
        <section className="py-12 px-4">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="mb-3 text-xl font-bold text-gray-900">Opiniones de pacientes</h2>
            <div className="mx-auto flex max-w-md flex-col items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-6">
              <Star className="h-6 w-6 text-amber-400" />
              <p className="text-sm font-medium text-gray-700">Opiniones verificadas próximamente</p>
              <p className="text-sm text-gray-500">
                Estamos incorporando un módulo de reseñas verificadas para que puedas conocer la experiencia
                de otros pacientes con la Dra. Lucía Chahin.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Obras sociales y formas de atención */}
      {(() => {
        const withCoverage = sedeActions
          .map(sede => {
            const cfg = matchConfigLocation(sede.name, configLocations)
            const obras = (cfg?.obras_sociales ?? []).map(o => o.trim()).filter(Boolean)
            return { name: sede.name, obras }
          })
          .filter(s => s.obras.length > 0)

        return (
          <section id="obras-sociales" className="scroll-mt-16 bg-gray-50 px-4 py-12">
            <div className="mx-auto max-w-2xl">
              <h2 className="mb-6 text-center text-xl font-bold text-gray-900">Obras sociales y formas de atención</h2>
              {withCoverage.length > 0 ? (
                <div className="space-y-4">
                  {withCoverage.map(s => (
                    <div key={s.name} className="rounded-lg border border-gray-200 bg-white p-4">
                      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
                        <Shield className="h-4 w-4 text-blue-600" />
                        {s.name}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {s.obras.map(o => (
                          <span key={o} className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">{o}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mx-auto max-w-md text-center text-sm text-gray-600">
                  Cada sede acepta distintas coberturas médicas. Para confirmar si tu obra social o prepaga tiene
                  convenio, comunicate directamente con la sede elegida o{" "}
                  <a
                    href={buildWhatsAppUrl(WHATSAPP_MESSAGES.general)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-blue-600 hover:underline"
                  >
                    consultanos por WhatsApp
                  </a>.
                </p>
              )}
            </div>
          </section>
        )
      })()}

      {/* Pedir turno + formulario */}
      <LandingInteractions slug={slug} locations={sedeActions} />

      {/* Enlaces relacionados */}
      {!isMain && (
        <section className="px-4 pb-10">
          <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            {relatedSlugs.map(relSlug => LANDING_DATA[relSlug] && (
              <Link key={relSlug} href={`/${relSlug}`} className="font-medium text-blue-600 hover:underline">
                {LANDING_DATA[relSlug].h1} →
              </Link>
            ))}
            <Link href="/dra-lucia-chahin" className="font-medium text-blue-600 hover:underline">
              Ver perfil completo de la Dra. Lucía Chahin →
            </Link>
          </div>
        </section>
      )}

      {/* FAQ */}
      <section id="faq" className="scroll-mt-16 py-12 px-4 bg-gray-50">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-gray-900 mb-6 text-center">Preguntas frecuentes</h2>
          <div className="space-y-4">
            {faq.map(({ q, a }) => (
              <details key={q} className="group rounded-lg border border-gray-200 bg-white">
                <summary className="flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-medium text-gray-900 marker:hidden list-none">
                  {q}
                  <span className="ml-4 shrink-0 text-gray-400 group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <p className="px-5 pb-4 text-sm text-gray-600 leading-relaxed">{a}</p>
              </details>
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
              <p>
                Este sitio no reemplaza una consulta médica y no debe usarse para urgencias.
                Ante síntomas de alarma (dolor de pecho, falta de aire, etc.), concurrí a una guardia o llamá al 107.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="py-6 px-4 text-center text-xs text-gray-400 border-t border-gray-100">
        <p>
          Dra. Lucía Chahin — Médica Cardióloga y Ecocardiografista
          {configDoctor.matricula && ` · Matrícula ${configDoctor.matricula}`}
        </p>
        <p className="mt-1">Este sitio tiene carácter informativo y no reserva turnos ni confirma disponibilidad.</p>
      </footer>

      {/* CTA sticky mobile */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] sm:hidden">
        <a
          href="#pedir-turno"
          className="flex w-full items-center justify-center gap-2 rounded-full bg-blue-600 py-3 text-sm font-semibold text-white"
        >
          <CalendarCheck className="h-4 w-4" />
          Pedir turno con la Dra. Chahin
        </a>
      </div>
    </main>
  )
}
