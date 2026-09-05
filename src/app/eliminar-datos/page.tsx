import type { Metadata } from "next"
import { LegalPage, LegalSection } from "@/components/legal-page"
import { buildWhatsAppUrl } from "@/lib/public-landings"
import { PUBLIC_SITE_ORIGIN } from "@/lib/tracked-links"

export const metadata: Metadata = {
  title: "Eliminación de datos — Dra. Lucía Chahin",
  description: "Instrucciones para solicitar la eliminación de datos personales vinculados con el sitio, WhatsApp o Instagram.",
  robots: { index: true, follow: true },
  alternates: { canonical: `${PUBLIC_SITE_ORIGIN}/eliminar-datos` },
}

const DELETE_MESSAGE = "Hola, quiero solicitar la eliminación de mis datos personales. Mi canal de contacto fue: [Instagram/WhatsApp/sitio web]."

export default function EliminarDatosPage() {
  return (
    <LegalPage
      title="Eliminación de datos personales"
      description="Podés solicitar la eliminación de los datos asociados a tus interacciones con la Dra. Lucía Chahin en Instagram, WhatsApp o este sitio."
    >
      <LegalSection title="Cómo solicitarla">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Escribinos por WhatsApp desde el número que usaste para contactarnos o indicá el usuario
            de Instagram desde el que enviaste el mensaje o comentario.
          </li>
          <li>
            Aclar&aacute; que pedís la eliminación de tus datos y el canal por el que nos contactaste.
            No envíes síntomas, estudios ni otra información clínica para hacer este pedido.
          </li>
          <li>
            Podemos pedirte una verificación mínima para evitar que otra persona elimine datos en
            tu nombre. Una vez validado el pedido, eliminaremos los datos que corresponda y te
            informaremos el resultado por el mismo canal.
          </li>
        </ol>
        <a
          href={buildWhatsAppUrl(DELETE_MESSAGE)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
        >
          Solicitar eliminación por WhatsApp
        </a>
      </LegalSection>

      <LegalSection title="Qué datos abarca el pedido">
        <p>
          El pedido puede abarcar los datos administrativos guardados en nuestros sistemas, como
          nombre, teléfono, obra social o prepaga, sede elegida, mensajes directos y comentarios de
          Instagram, y mensajes de WhatsApp conservados para atención manual.
        </p>
        <p>
          No descargamos los adjuntos recibidos por Instagram ni guardamos la notificación técnica
          completa que envía Meta. Instagram y WhatsApp pueden conservar información en sus propios
          sistemas de acuerdo con sus políticas; este procedimiento elimina la copia controlada por
          el consultorio.
        </p>
      </LegalSection>

      <LegalSection title="Excepciones y conservación">
        <p>
          La eliminación se realizará salvo que exista una obligación legal de conservar cierta
          información. Si no podemos borrar algún dato por ese motivo, te explicaremos qué se
          conserva y por qué. Los mensajes de Instagram se eliminan de nuestra bandeja como máximo
          a los 90 días y los mensajes de atención manual de WhatsApp, a los 30 días.
        </p>
        <p>
          Para conocer todos los usos, proveedores y plazos aplicables, consultá la política de
          privacidad enlazada al pie de esta página.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
