import type { Metadata } from "next"
import { LegalPage, LegalSection } from "@/components/legal-page"
import { PUBLIC_SITE_ORIGIN } from "@/lib/tracked-links"

export const metadata: Metadata = {
  title: "Términos de uso — Dra. Lucía Chahin",
  description: "Condiciones de uso del sitio y de los canales administrativos de contacto de la Dra. Lucía Chahin.",
  robots: { index: true, follow: true },
  alternates: { canonical: `${PUBLIC_SITE_ORIGIN}/terminos` },
}

export default function TerminosPage() {
  return (
    <LegalPage
      title="Términos de uso"
      description="Estas condiciones regulan el uso del sitio y de los canales administrativos de contacto de la Dra. Lucía Chahin."
    >
      <LegalSection title="Finalidad del servicio">
        <p>
          El sitio, WhatsApp e Instagram brindan información general sobre servicios, sedes,
          coberturas y formas de pedir turno. También permiten recibir y ordenar consultas
          administrativas para derivarlas al canal correspondiente.
        </p>
        <p>
          <strong>
            Estos canales no dan diagnósticos, no indican tratamientos, no interpretan estudios,
            no reservan turnos y no confirman disponibilidad.
          </strong>
          {" "}La confirmación y las condiciones del turno dependen de cada institución.
        </p>
      </LegalSection>

      <LegalSection title="Emergencias y consultas clínicas">
        <p>
          No uses el sitio, Instagram ni WhatsApp para una emergencia médica. Ante síntomas de
          alarma o una posible urgencia, acudí inmediatamente a una guardia o comunicate con el
          servicio de emergencias de tu zona. No esperes una respuesta por estos canales.
        </p>
        <p>
          Las consultas clínicas sensibles se derivan a una persona y no reciben una respuesta
          médica automática. Evitá enviar estudios o información clínica que no sea necesaria para
          una gestión administrativa.
        </p>
      </LegalSection>

      <LegalSection title="Información sobre coberturas, precios y horarios">
        <p>
          La información publicada refleja los datos disponibles al momento de su actualización,
          pero las cartillas, aranceles, horarios y condiciones pueden cambiar. Antes de concurrir,
          verificá la cobertura, el valor y la disponibilidad directamente con la institución.
        </p>
      </LegalSection>

      <LegalSection title="Uso responsable">
        <p>
          Al usar estos canales, te comprometés a brindar información verdadera y a no utilizarlos
          para suplantar a otra persona, enviar contenido ilegal, acosar, interferir con el servicio
          o intentar acceder a datos o funciones no autorizadas.
        </p>
      </LegalSection>

      <LegalSection title="Privacidad, cambios y contacto">
        <p>
          El tratamiento de datos personales se explica en la política de privacidad. Allí también
          se indican los plazos de conservación y cómo pedir acceso, corrección o eliminación.
        </p>
        <p>
          Estos términos pueden actualizarse para reflejar cambios legales u operativos. La fecha
          publicada al inicio identifica la versión vigente. Para consultas, usá los canales de
          contacto disponibles en el sitio principal.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
