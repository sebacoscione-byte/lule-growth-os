import { ImageResponse } from "next/og"
import { LANDING_DATA } from "@/lib/public-landings"

export const alt = "Dra. Lucía Chahin — Cardióloga"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

const INK = "#16242c"
const PAPER = "#f6f4ee"
const CARDIAC = "#b23b34"

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const data = LANDING_DATA[slug]
  const isMain = slug === "dra-lucia-chahin"
  // data.h1 ya incluye "— Dra. Lucía Chahin" al final (para SEO); acá esa parte es redundante
  // porque el nombre ya aparece como título principal de la placa.
  const subtitle = isMain
    ? "Consulta cardiológica · Ecocardiograma"
    : (data?.h1.split(" — ")[0] ?? "Cardióloga")

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: INK,
          padding: "80px",
        }}
      >
        <svg width="220" height="24" viewBox="0 0 220 24" style={{ marginBottom: 36 }}>
          <path
            d="M0,12 L60,12 L68,12 L74,2 L80,20 L86,2 L92,16 L98,12 L220,12"
            fill="none"
            stroke={CARDIAC}
            strokeWidth={3}
          />
        </svg>
        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            color: PAPER,
            textAlign: "center",
            lineHeight: 1.15,
          }}
        >
          Dra. Lucía Chahin
        </div>
        <div
          style={{
            fontSize: 32,
            color: CARDIAC,
            marginTop: 24,
            textAlign: "center",
            fontWeight: 600,
          }}
        >
          {subtitle}
        </div>
        <div
          style={{
            fontSize: 24,
            color: PAPER,
            opacity: 0.7,
            marginTop: 40,
          }}
        >
          draluciachahin.ar
        </div>
      </div>
    ),
    { ...size }
  )
}
