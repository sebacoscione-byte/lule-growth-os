import type { Metadata } from "next"
import Link from "next/link"
import { AlertTriangle, ShieldAlert } from "lucide-react"
import { GoogleAnalytics } from "@/components/google-analytics"
import { EcgDivider } from "@/components/ecg-divider"
import { buildWhatsAppUrl } from "@/lib/public-landings"

export const metadata: Metadata = {
  title: "Política de privacidad — Dra. Lucía Chahin",
  description: "Qué datos recolecta este sitio, para qué se usan, con quién se comparten y cómo pedir acceso, corrección o eliminación.",
  alternates: { canonical: "/privacidad" },
}

const CONTACT_MESSAGE = "Hola, quiero hacer una consulta sobre mis datos personales (acceso, corrección o eliminación)."

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <h2 className="font-display text-xl font-semibold text-ink mb-3">{title}</h2>
        <div className="text-sm leading-6 text-ink-soft space-y-3">{children}</div>
      </div>
    </section>
  )
}

export default function PrivacidadPage() {
  return (
    <main className="min-h-screen bg-white">
      <GoogleAnalytics />

      <section className="bg-paper px-4 pb-6 pt-14">
        <div className="max-w-2xl mx-auto">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-soft/70 mb-2">
            <Link href="/dra-lucia-chahin" className="hover:underline">← Volver al sitio</Link>
          </p>
          <h1 className="font-display text-3xl font-semibold text-ink">Política de privacidad</h1>
          <p className="mt-2 text-sm text-ink-soft">
            Última actualización: 11 de julio de 2026.
          </p>

          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4">
            <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
            <div className="text-sm text-orange-800">
              <p className="font-medium mb-1">Este texto es un borrador</p>
              <p>
                Describe con precisión cómo funciona el sitio y la app hoy, pero todavía no fue
                revisado por un asesor legal — al tratarse de datos de salud, esa revisión es
                necesaria antes de considerarlo definitivo. Si tenés dudas puntuales sobre tus
                datos, escribinos directamente (ver la sección &quot;Cómo ejercer tus derechos&quot;
                más abajo).
              </p>
            </div>
          </div>
        </div>
      </section>

      <EcgDivider />

      <Section title="Quién es responsable de estos datos">
        <p>
          Este sitio y el sistema de mensajería de WhatsApp asociado son operados por el
          consultorio de la <strong>Dra. Lucía Chahin</strong>, médica cardióloga, para gestionar
          consultas de pacientes que quieren pedir turno o conocer los servicios ofrecidos en
          CIMEL Lanús, Hospital Británico o Swiss Medical Lomas.
        </p>
      </Section>

      <Section title="Qué datos recolectamos">
        <p>Según cómo nos contactes, podemos recolectar:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Nombre, teléfono y obra social/prepaga, si los compartís.</li>
          <li>Motivo de consulta, edad y estudios o síntomas previos, si los mencionás.</li>
          <li>El contenido de la conversación de WhatsApp, si nos escribís por ese canal.</li>
          <li>
            Sede/institución elegida, canal de origen (Google Maps, Instagram, búsqueda,
            WhatsApp) y parámetros de campaña (UTM), si llegaste desde un link de una
            publicación o anuncio.
          </li>
          <li>
            Datos de navegación agregados de este sitio (páginas vistas, clics en los botones
            de &quot;Pedir turno&quot;/&quot;Llamar&quot;/&quot;WhatsApp&quot;) — no incluyen tu nombre ni tu teléfono.
          </li>
        </ul>
        <p>
          <strong>No recolectamos ni pedimos</strong> resultados de estudios médicos, historia
          clínica completa, ni ningún dato de salud más allá de lo que decidas contarnos vos
          mismo para que podamos derivarte a la sede correcta.
        </p>
      </Section>

      <Section title="Para qué usamos estos datos">
        <ul className="list-disc pl-5 space-y-1">
          <li>Contactarte y ayudarte a elegir la sede/institución más conveniente.</li>
          <li>Hacer seguimiento hasta que nos confirmes que ya pediste el turno.</li>
          <li>
            Clasificar automáticamente el motivo de tu consulta (por ejemplo, distinguir un
            pedido de turno de una urgencia) para poder responderte más rápido.
          </li>
          <li>Medir qué canales (Google Maps, Instagram, búsqueda) generan más consultas.</li>
        </ul>
        <p>
          <strong>Este sitio y el bot de WhatsApp no dan diagnósticos, no interpretan estudios, no
          reservan turnos ni confirman disponibilidad</strong> — solo te orientan sobre cómo
          pedirlo vos mismo en la institución elegida. Ante una emergencia médica, siempre te
          vamos a indicar que llames al 107 o vayas a una guardia.
        </p>
      </Section>

      <Section title="Con quién compartimos estos datos">
        <p>
          No vendemos tus datos. Los compartimos únicamente con los proveedores que hacen
          funcionar el sitio y la mensajería:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Meta (WhatsApp Business Platform)</strong>, para poder enviarte y recibir
            mensajes de WhatsApp.
          </li>
          <li>
            <strong>Anthropic (Claude) y/o Google (Gemini)</strong>, proveedores de inteligencia
            artificial que usamos para clasificar automáticamente tu consulta y sugerir
            respuestas — no toman ninguna decisión médica, solo ayudan a dirigir tu mensaje al
            flujo correcto.
          </li>
          <li>
            <strong>Supabase</strong>, donde se almacena la base de datos de la aplicación.
          </li>
          <li>
            <strong>Vercel</strong>, donde se aloja el sitio y la aplicación.
          </li>
          <li>
            <strong>Google Analytics</strong>, para medir visitas y uso del sitio de forma
            agregada (ver la sección de cookies más abajo).
          </li>
        </ul>
      </Section>

      <Section title="Cuánto tiempo conservamos tus datos">
        <p>
          Hoy no tenemos un plazo automático de eliminación — tus datos se conservan mientras
          sigas siendo paciente o mientras el consultorio los necesite para el seguimiento de tu
          consulta. Estamos trabajando en definir plazos de conservación por tipo de dato y en
          automatizar el proceso de eliminación; hasta que esté implementado, cualquier pedido de
          borrado se procesa a mano (ver la sección siguiente).
        </p>
      </Section>

      <Section title="Cómo ejercer tus derechos (acceso, corrección o eliminación)">
        <p>
          Podés pedirnos en cualquier momento que te digamos qué datos tenemos tuyos, que
          corrijamos algo incorrecto, o que eliminemos tus datos de nuestros sistemas. Hoy este
          proceso es manual: escribinos por WhatsApp explicando tu pedido y lo resolvemos
          directamente.
        </p>
        <a
          href={buildWhatsAppUrl(CONTACT_MESSAGE)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink/90 transition-colors"
        >
          Escribinos por WhatsApp
        </a>
      </Section>

      <Section title="Cookies y analítica">
        <p>
          Este sitio usa una cookie propia (<code>lule_hero_variant</code>) para mostrarte siempre
          la misma versión de la página principal durante un test A/B interno, y el script de
          Google Analytics (cuando está configurado) para medir visitas de forma agregada. Ninguna
          de las dos incluye tu nombre, teléfono ni el contenido de tu consulta. Estas cookies solo
          se cargan en las páginas públicas de este sitio, nunca en el sistema de gestión interno.
        </p>
      </Section>

      <Section title="Datos de salud">
        <p>
          Entendemos que el motivo de consulta o los síntomas que compartís son datos sensibles.
          Se usan exclusivamente para ayudarte a elegir la sede correcta y agilizar tu atención —
          nunca se publican, ni se comparten con fines comerciales, ni se usan para ningún
          propósito distinto al que motivó tu consulta.
        </p>
      </Section>

      <footer className="py-10 px-4 text-center text-xs text-ink-soft/70 border-t border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-center gap-2">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
          <p>Dra. Lucía Chahin — Médica Cardióloga y Ecocardiografista</p>
        </div>
        <p className="mt-2">
          <Link href="/dra-lucia-chahin" className="hover:underline">Volver al sitio principal</Link>
        </p>
      </footer>
    </main>
  )
}
