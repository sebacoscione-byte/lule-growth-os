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
import { getServiceDb } from "@/lib/supabase/service"
import { getGooglePlaceReviews } from "@/lib/google-places"
import { GoogleAnalytics } from "@/components/google-analytics"
import { EcgDivider } from "@/components/ecg-divider"
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
  whatsapp?: string
}

type ConfigDoctor = {
  bio?: string
  specializations?: string[]
  conditions_treated?: string[]
  matricula?: string
}

// Fallback: cargado desde la ficha profesional (LinkedIn) de la Dra. Lucía Chahin.
// Se usa solo si todavía no se cargó nada en Configuración > Datos de la doctora.
const FALLBACK_BIO = "Médica cardióloga con formación en ecocardiografía avanzada y especial interés en imágenes cardiovasculares, cardio-oncología e insuficiencia cardíaca. Combina la atención centrada en el paciente con la participación activa en investigación clínica y actividades académicas."
const FALLBACK_SPECIALIZATIONS = ["Ecocardiografía", "Ecocardiografía Transesofágica", "Prueba de Estrés (Ergometría)", "Imágenes cardiovasculares", "Cardio-oncología", "Electrocardiografía", "Cardiología Adulto"]
const FALLBACK_CONDITIONS_TREATED = [
  "Angina de pecho", "Arritmias", "Desmayo", "Embolismo pulmonar", "Endocarditis",
  "Enfermedad de Chagas", "Enfermedad coronaria", "Enfermedad valvular",
  "Enfermedad de las arterias carótidas", "Espasmo arterial", "Hipertensión arterial",
  "Insuficiencia cardiaca", "Soplo cardiaco", "Infarto",
]

const PREFERRED_LOCATION_BY_KEY: Record<string, "cimel_lanus" | "swiss_lomas" | "hospital_britanico" | "sin_definir"> = {
  cimel: "cimel_lanus",
  swiss: "swiss_lomas",
  britanico: "hospital_britanico",
  general: "sin_definir",
}

const SEDE_COLOR: Record<string, "blue" | "teal" | "britanico"> = { cimel: "blue", swiss: "teal", britanico: "britanico", general: "blue" }

const SEDE_ACCENT_TEXT: Record<"blue" | "teal" | "britanico", string> = {
  blue: "text-blue-600",
  teal: "text-teal-600",
  britanico: "text-britanico",
}
const SEDE_ACCENT_BG: Record<"blue" | "teal" | "britanico", string> = {
  blue: "bg-blue-600",
  teal: "bg-teal-600",
  britanico: "bg-britanico",
}
// Nombres de clase completos y literales a propósito: Tailwind no genera CSS para
// clases armadas con template strings en runtime (necesita verlas enteras en el código fuente).
const SEDE_ACCENT_HOVER_TEXT: Record<"blue" | "teal" | "britanico", string> = {
  blue: "hover:text-blue-600",
  teal: "hover:text-teal-600",
  britanico: "hover:text-britanico",
}

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
    a: "La Dra. Lucía Chahin atiende en tres sedes: CIMEL Lanús (Tucumán 1314, Lanús) los martes, Hospital Británico (Central) (Perdriel 74, CABA) los miércoles, y Swiss Medical Lomas de Zamora (Oliden 141) los viernes.",
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
    q: "¿Qué días atiende en el Hospital Británico?",
    a: "Atiende los miércoles en el Hospital Británico (Central), Perdriel 74, CABA.",
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
    q: "¿Cómo pido turno en el Hospital Británico?",
    a: "Llamá al 4309-6400 (atención telefónica 24hs) o a la Central de Turnos 0810-222-2748 / 11-3015-9749, o pedí turno desde la app del Hospital Británico (Central), y solicitá turno con la Dra. Lucía Chahin en cardiología.",
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
    a: "Realizó su residencia de cardiología en el Hospital Británico de Buenos Aires (2020-2024), donde hoy continúa como cardióloga de planta. Tiene formación avanzada en ecocardiografía (Sociedad Argentina de Cardiología) y diplomaturas de posgrado en hipertensión arterial y cardiometabolismo (Pontificia Universidad Católica Argentina).",
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
    const supabase = getServiceDb()
    const { data } = await supabase.from("app_config").select("value").eq("key", "locations").single()
    return Array.isArray(data?.value) ? (data.value as ConfigLocation[]) : []
  } catch {
    return []
  }
}

async function getConfigDoctor(): Promise<ConfigDoctor> {
  try {
    const supabase = getServiceDb()
    const { data } = await supabase.from("app_config").select("value").eq("key", "doctor").single()
    const value = (data?.value ?? {}) as ConfigDoctor
    return {
      bio: value.bio || FALLBACK_BIO,
      specializations: value.specializations?.length ? value.specializations : FALLBACK_SPECIALIZATIONS,
      conditions_treated: value.conditions_treated?.length ? value.conditions_treated : FALLBACK_CONDITIONS_TREATED,
      matricula: value.matricula || undefined,
    }
  } catch {
    return { bio: FALLBACK_BIO, specializations: FALLBACK_SPECIALIZATIONS, conditions_treated: FALLBACK_CONDITIONS_TREATED }
  }
}

function matchConfigLocation(locName: string, configLocations: ConfigLocation[]): ConfigLocation | undefined {
  const lower = locName.toLowerCase()
  return configLocations.find(c => {
    const cName = (c.name ?? "").toLowerCase()
    if (lower.includes("cimel") && cName.includes("cimel")) return true
    if (lower.includes("swiss") && cName.includes("swiss")) return true
    if ((lower.includes("británico") || lower.includes("britanico")) && (cName.includes("británico") || cName.includes("britanico"))) return true
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
      whatsapp: cfg?.whatsapp || undefined,
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

  const isMain = slug === "dra-lucia-chahin"
  const [configLocations, configDoctor, placeReviews] = await Promise.all([
    getConfigLocations(),
    getConfigDoctor(),
    isMain ? getGooglePlaceReviews() : Promise.resolve(null),
  ])
  const specializations = configDoctor.specializations ?? []
  const conditionsTreated = configDoctor.conditions_treated ?? []
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
    "description": configDoctor.bio || "Médica cardióloga con formación en ecocardiografía avanzada, egresada de la residencia de cardiología del Hospital Británico de Buenos Aires, donde hoy continúa como cardióloga de planta. Atiende en CIMEL Lanús los martes, en el Hospital Británico (Central) los miércoles y en Swiss Medical Lomas de Zamora los viernes.",
    "medicalSpecialty": "Cardiology",
    "image": `${base}/lucia-chahin.jpg`,
    ...(configDoctor.matricula ? { "identifier": configDoctor.matricula } : {}),
    "alumniOf": [
      {
        "@type": "MedicalOrganization",
        "name": "Hospital Británico de Buenos Aires"
      },
      {
        "@type": "CollegeOrUniversity",
        "name": "Pontificia Universidad Católica Argentina"
      }
    ],
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
        "name": "Hospital Británico (Central)",
        "telephone": "4309-6400",
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "Perdriel 74",
          "addressLocality": "Ciudad Autónoma de Buenos Aires",
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
      <GoogleAnalytics />
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
        <nav className="sticky top-0 z-40 hidden border-b border-line bg-paper/90 backdrop-blur sm:block">
          <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 text-sm">
            <span className="font-display text-base font-semibold text-ink">Dra. Lucía Chahin</span>
            <div className="flex items-center gap-5 text-ink-soft">
              <a href="#servicios" className="hover:text-cardiac">Servicios</a>
              <a href="#sedes" className="hover:text-cardiac">Sedes</a>
              <a href="#obras-sociales" className="hover:text-cardiac">Obras sociales</a>
              <a href="#faq" className="hover:text-cardiac">FAQ</a>
              <a href="#pedir-turno" className="rounded-full bg-ink px-4 py-1.5 font-medium text-paper hover:bg-ink-soft">
                Pedir turno
              </a>
            </div>
          </div>
        </nav>
      )}

      {/* Hero */}
      {isMain ? (
        <section className="bg-paper px-4 pb-2 pt-14">
          <div className="mx-auto max-w-3xl">
            <div className="flex flex-col gap-10 sm:flex-row sm:items-center">
              <div className="shrink-0 self-center">
                <div className="relative h-56 w-48 overflow-hidden rounded-2xl shadow-[0_18px_40px_-16px_rgba(22,36,44,0.35)] sm:h-64 sm:w-56">
                  <Image
                    src="/lucia-chahin.jpg"
                    alt="Dra. Lucía Chahin — Cardióloga"
                    fill
                    className="object-cover object-top"
                    priority
                  />
                </div>
              </div>
              <div className="w-full min-w-0 text-center sm:text-left">
                <p className="font-display text-sm font-medium italic text-cardiac">Cardióloga y Ecocardiografista</p>
                <h1 className="font-display mt-1 text-4xl font-semibold leading-[1.1] text-ink sm:text-5xl">{data.h1.replace(" — Cardióloga", "")}</h1>
                {configDoctor.matricula && (
                  <p className="mt-2 text-xs text-ink-soft">Matrícula {configDoctor.matricula}</p>
                )}
                <p className="mt-4 leading-relaxed text-ink-soft sm:max-w-md">{data.intro}</p>
                <p className="mt-2 text-sm text-ink-soft/80">
                  Consultas cardiológicas y ecocardiogramas · {isMain ? "Lanús, CABA y Lomas de Zamora" : "Lanús y Lomas de Zamora"}
                </p>

                <div className="mt-6 flex flex-wrap justify-center gap-3 sm:justify-start">
                  <a
                    href="#pedir-turno"
                    className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
                  >
                    <CalendarCheck className="h-4 w-4" />
                    Pedir turno
                  </a>
                  <a
                    href="#sedes"
                    className="inline-flex items-center gap-2 rounded-full border border-line px-6 py-3 text-sm font-semibold text-ink transition-colors hover:bg-paper-dim"
                  >
                    Ver sedes y horarios
                  </a>
                </div>

                <div className="mt-5 flex flex-wrap justify-center gap-2 sm:justify-start">
                  {["Hospital Británico", "CIMEL Lanús", "Swiss Medical Lomas", "Ecocardiograma"].map(chip => (
                    <span key={chip} className="rounded-full border border-line bg-white px-3 py-1 text-xs font-medium text-ink-soft">
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <EcgDivider animated className="mx-auto mt-10 max-w-3xl" />
        </section>
      ) : (
        <section className="bg-paper px-4 pb-2 pt-16">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="font-display text-3xl font-semibold text-ink mb-4">{data.h1}</h1>
            <p className="text-lg text-ink-soft mb-6">{data.intro}</p>
            <div className="flex flex-wrap justify-center gap-3">
              <a
                href="#pedir-turno"
                className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
              >
                <CalendarCheck className="h-4 w-4" />
                Pedir turno
              </a>
            </div>
          </div>
          <EcgDivider animated className="mx-auto mt-8 max-w-2xl" />
        </section>
      )}

      {isMain && (
        <section className="px-4 py-12">
          <div className="mx-auto max-w-2xl">
            <h2 className="font-display mb-4 text-center text-2xl font-semibold text-ink">Sobre la Dra. Lucía Chahin</h2>
            <div className="rounded-2xl border border-line bg-paper p-6 text-sm leading-6 text-ink-soft space-y-3">
              {configDoctor.bio && <p>{configDoctor.bio}</p>}
              <p>
                La Dra. <strong>Lucía Chahin</strong> es médica cardióloga con formación avanzada en
                ecocardiografía. Realizó su residencia de cardiología en el <strong>Hospital Británico de
                Buenos Aires</strong> (2020-2024) y hoy continúa allí como cardióloga de planta, atendiendo
                los miércoles, además de atender en <strong>Swiss Medical</strong> desde 2025.
              </p>
              <p>
                Es subinvestigadora de ensayos clínicos en <strong>CIMEL Lanús</strong>, con trayectoria en
                estudios sobre lípidos, cardiometabolismo, diabetes, obesidad e insuficiencia cardíaca. Cuenta
                con diplomaturas de posgrado en hipertensión arterial y cardiometabolismo de la
                <strong> Pontificia Universidad Católica Argentina</strong>, y formación continua en
                ecocardiografía y Doppler cardíaco de la <strong>Sociedad Argentina de Cardiología</strong>.
              </p>
              <p>
                Atiende pacientes en <strong>CIMEL Lanús</strong> — centro médico de larga trayectoria en
                Lanús —, en el <strong>Hospital Británico (Central)</strong> los miércoles y en{" "}
                <strong>Swiss Medical Lomas de Zamora</strong>. Realiza consultas cardiológicas,
                ecocardiogramas y controles cardiovasculares.
              </p>
              {configDoctor.matricula && (
                <p className="text-xs text-ink-soft/80">Matrícula profesional: {configDoctor.matricula}</p>
              )}
              <p className="text-xs text-ink-soft/80">
                Esta web reúne la información para elegir sede, conocer los días de atención y pedir turno por
                los canales oficiales de cada institución.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Dónde atiende — cards comparables */}
      <section id="sedes" className="scroll-mt-16 bg-paper-dim px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h2 className="font-display mb-6 text-center text-2xl font-semibold text-ink">Dónde atiende</h2>
          <div className={`grid gap-4 ${sedeActions.length > 1 ? "sm:grid-cols-2" : ""}`}>
            {sedeActions.map((sede) => (
              <div key={sede.key} className="rounded-2xl border border-line bg-white p-5">
                <div className="mb-3 flex items-center gap-2">
                  <MapPin className={`h-5 w-5 ${SEDE_ACCENT_TEXT[sede.color]}`} />
                  <h3 className="font-semibold text-ink">{sede.name}</h3>
                </div>

                {sede.hours ? (
                  <div className={`mb-3 rounded-md px-3 py-2 text-sm font-semibold text-white whitespace-pre-line ${SEDE_ACCENT_BG[sede.color]}`}>
                    <Clock className="mb-0.5 inline h-3.5 w-3.5 mr-1" />
                    {sede.hours}
                  </div>
                ) : (
                  <div className="mb-3 flex items-center gap-2 text-sm text-ink-soft">
                    <Clock className="h-4 w-4" />
                    <span>Atención los {sede.day}</span>
                  </div>
                )}

                {sede.address && <p className="text-sm text-ink-soft">{sede.address}</p>}
                {sede.phone && (
                  <a
                    href={`tel:${sede.phone.replace(/[\s-]/g, "")}`}
                    className={`mt-1 flex items-center gap-1.5 text-sm text-ink-soft ${SEDE_ACCENT_HOVER_TEXT[sede.color]}`}
                  >
                    <Phone className="h-3.5 w-3.5" />
                    {sede.phone}
                  </a>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <a
                    href={`#sede-${sede.key}`}
                    className={`inline-flex items-center gap-1.5 text-sm font-medium ${SEDE_ACCENT_TEXT[sede.color]} hover:opacity-80`}
                  >
                    <CalendarCheck className="h-4 w-4" />
                    Pedir turno en esta sede →
                  </a>
                  {sede.mapsUrl && (
                    <a
                      href={sede.mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-ink"
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
          <h2 className="font-display text-2xl font-semibold text-ink mb-6 text-center">Servicios</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.services.map((service) => {
              const Icon = SERVICE_ICONS[service] ?? Heart
              return (
                <div key={service} className="p-4 rounded-2xl border border-line bg-paper">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cardiac-soft">
                      <Icon className="h-4 w-4 text-cardiac" />
                    </div>
                    <span className="text-sm font-semibold text-ink">{service}</span>
                  </div>
                  {SERVICE_MICROCOPY[service] && (
                    <p className="mt-2 text-xs leading-relaxed text-ink-soft">{SERVICE_MICROCOPY[service]}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <EcgDivider className="mx-auto max-w-2xl px-4" />

      {/* Especialidad y enfermedades tratadas */}
      {(specializations.length > 0 || conditionsTreated.length > 0) && (
        <section className="py-12 px-4 bg-paper-dim">
          <div className="mx-auto max-w-2xl">
            <h2 className="font-display mb-4 text-center text-2xl font-semibold text-ink">Especialidad y enfermedades que trata</h2>
            <div className="space-y-6 rounded-2xl border border-line bg-white p-6">
              {specializations.length > 0 && (
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-soft/70">Especialista en</p>
                  <div className="flex flex-wrap gap-2">
                    {specializations.map((s) => (
                      <span key={s} className="bg-cardiac-soft text-cardiac text-xs font-medium px-3 py-1 rounded-full">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {conditionsTreated.length > 0 && (
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-soft/70">
                    Enfermedades y condiciones que trata
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {conditionsTreated.map((c) => (
                      <span key={c} className="bg-paper-dim text-ink-soft text-xs px-2.5 py-1 rounded-full">{c}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Opiniones — reseñas reales de Google, sin testimonios inventados */}
      {isMain && (
        <section className="py-12 px-4">
          <div className="mx-auto max-w-2xl">
            <h2 className="font-display mb-3 text-center text-2xl font-semibold text-ink">Opiniones de pacientes</h2>
            {placeReviews && placeReviews.reviews.length > 0 ? (
              <>
                {placeReviews.rating && (
                  <div className="mb-6 flex items-center justify-center gap-2 text-sm text-ink-soft">
                    <span className="flex">
                      {[1, 2, 3, 4, 5].map(i => (
                        <Star
                          key={i}
                          className={`h-4 w-4 ${i <= Math.round(placeReviews.rating!) ? "fill-amber-400 text-amber-400" : "text-line"}`}
                        />
                      ))}
                    </span>
                    <span className="font-semibold text-ink">{placeReviews.rating.toFixed(1)}</span>
                    {placeReviews.reviewCount != null && (
                      <span>· {placeReviews.reviewCount} reseñas en Google</span>
                    )}
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  {placeReviews.reviews.map((review, i) => (
                    <div key={i} className="rounded-2xl border border-line bg-paper p-5">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-ink">{review.authorName}</p>
                        <span className="flex shrink-0">
                          {[1, 2, 3, 4, 5].map(i => (
                            <Star key={i} className={`h-3.5 w-3.5 ${i <= review.rating ? "fill-amber-400 text-amber-400" : "text-line"}`} />
                          ))}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed text-ink-soft">{review.text}</p>
                      {review.relativeTime && <p className="mt-2 text-xs text-ink-soft/70">{review.relativeTime}</p>}
                    </div>
                  ))}
                </div>
                <p className="mt-5 text-center text-xs text-ink-soft/70">
                  Reseñas de Google
                  {placeReviews.mapsUrl && (
                    <>
                      {" · "}
                      <a href={placeReviews.mapsUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-cardiac hover:underline">
                        Ver todas en Google Maps
                      </a>
                    </>
                  )}
                </p>
              </>
            ) : (
              <div className="mx-auto flex max-w-md flex-col items-center gap-2 rounded-2xl border border-line bg-paper p-6 text-center">
                <Star className="h-6 w-6 text-amber-400" />
                <p className="text-sm font-medium text-ink">Opiniones verificadas próximamente</p>
                <p className="text-sm text-ink-soft">
                  Estamos incorporando un módulo de reseñas verificadas para que puedas conocer la experiencia
                  de otros pacientes con la Dra. Lucía Chahin.
                </p>
              </div>
            )}
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
          <section id="obras-sociales" className="scroll-mt-16 bg-paper-dim px-4 py-12">
            <div className="mx-auto max-w-2xl">
              <h2 className="font-display mb-6 text-center text-2xl font-semibold text-ink">Obras sociales y formas de atención</h2>
              {withCoverage.length > 0 ? (
                <div className="space-y-4">
                  {withCoverage.map(s => (
                    <div key={s.name} className="rounded-2xl border border-line bg-white p-4">
                      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
                        <Shield className="h-4 w-4 text-cardiac" />
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
                <p className="mx-auto max-w-md text-center text-sm text-ink-soft">
                  Cada sede acepta distintas coberturas médicas. Para confirmar si tu obra social o prepaga tiene
                  convenio, comunicate directamente con la sede elegida o{" "}
                  <a
                    href={buildWhatsAppUrl(WHATSAPP_MESSAGES.general)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-cardiac hover:underline"
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
              <Link key={relSlug} href={`/${relSlug}`} className="font-medium text-cardiac hover:underline">
                {LANDING_DATA[relSlug].h1} →
              </Link>
            ))}
            <Link href="/dra-lucia-chahin" className="font-medium text-cardiac hover:underline">
              Ver perfil completo de la Dra. Lucía Chahin →
            </Link>
          </div>
        </section>
      )}

      <EcgDivider className="mx-auto max-w-2xl px-4" />

      {/* FAQ */}
      <section id="faq" className="scroll-mt-16 py-12 px-4 bg-paper-dim">
        <div className="max-w-2xl mx-auto">
          <h2 className="font-display text-2xl font-semibold text-ink mb-6 text-center">Preguntas frecuentes</h2>
          <div className="space-y-4">
            {faq.map(({ q, a }) => (
              <details key={q} className="group rounded-2xl border border-line bg-white">
                <summary className="flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-medium text-ink marker:hidden list-none">
                  {q}
                  <span className="ml-4 shrink-0 text-ink-soft/70 group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <p className="px-5 pb-4 text-sm text-ink-soft leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Aviso */}
      <section className="py-8 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4">
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

      <footer className="py-6 px-4 text-center text-xs text-ink-soft/70 border-t border-line">
        <p>
          Dra. Lucía Chahin — Médica Cardióloga y Ecocardiografista
          {configDoctor.matricula && ` · Matrícula ${configDoctor.matricula}`}
        </p>
        <p className="mt-1">Este sitio tiene carácter informativo y no reserva turnos ni confirma disponibilidad.</p>
      </footer>

      {/* CTA sticky mobile */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] sm:hidden">
        <a
          href="#pedir-turno"
          className="flex w-full items-center justify-center gap-2 rounded-full bg-ink py-3 text-sm font-semibold text-paper"
        >
          <CalendarCheck className="h-4 w-4" />
          Pedir turno con la Dra. Chahin
        </a>
      </div>
    </main>
  )
}
