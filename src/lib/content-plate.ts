import sharp from "sharp"
import {
  CONTENT_PLATE_FONT_DISPLAY,
  CONTENT_PLATE_FONT_SANS,
  CONTENT_PLATE_FONT_SANS_BOLD,
} from "@/lib/runtime-assets"

type SharpOverlayOptions = Parameters<ReturnType<typeof sharp>["composite"]>[0][number]

// Paleta de marca del sitio público (ver src/app/globals.css).
const COLOR_PAPER = "#F6F4EE"
const COLOR_INK = "#16242C"
const COLOR_INK_SOFT = "#3D505C"
const COLOR_CARDIAC = "#B23B34"

// Fuentes reales bundleadas para que la composición no dependa de las instaladas en Vercel.
const FONT_DISPLAY = CONTENT_PLATE_FONT_DISPLAY
const FONT_SANS = CONTENT_PLATE_FONT_SANS
const FONT_SANS_BOLD = CONTENT_PLATE_FONT_SANS_BOLD

const BRAND_NAME = "DRA. LUCÍA CHAHÍN"
const BRAND_SPECIALTY = "C A R D I O L O G Í A"

// El corte manual conserva palabras enteras y mantiene el texto dentro de la zona segura.
function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.trim().split(/\s+/)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

function escapePangoText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function textOverlay(input: {
  text: string
  fontFile: string
  fontFamily: string
  fontSize: number
  color: string
  left: number
  top: number
  lineHeight?: number
}): SharpOverlayOptions | null {
  if (!input.text) return null
  return {
    input: {
      text: {
        text: `<span foreground="${input.color}">${escapePangoText(input.text)}</span>`,
        font: `${input.fontFamily} ${input.fontSize}px`,
        fontfile: input.fontFile,
        rgba: true,
        spacing: input.lineHeight,
        wrap: "none",
      },
    },
    left: input.left,
    top: input.top,
  }
}

const DIMENSIONS: Record<"post" | "historia" | "carrusel" | "reel", { width: number; height: number }> = {
  post: { width: 1080, height: 1350 },
  carrusel: { width: 1080, height: 1350 },
  historia: { width: 1080, height: 1920 },
  reel: { width: 1080, height: 1920 },
}

const TEXT_SAFE_WIDTH_RATIO = 0.5
const SCRIM_SOLID_END_RATIO = 0.52
const SCRIM_FADE_END_RATIO = 0.72
const SCRIM_MAX_ALPHA = 250 / 255
const PANEL_PADDING_X = 64
const PANEL_RIGHT_MARGIN = 30
const HEADLINE_CHAR_RATIO = 0.62
const SUBTITLE_CHAR_RATIO = 0.52
const HEADLINE_FONT_SIZE = 50
const SUBTITLE_FONT_SIZE = 34

/**
 * Compone la placa determinista sobre la foto generada. Sharp reemplaza a ffmpeg para imágenes
 * estáticas: conserva el mismo layout y las fuentes propias, pero evita incluir un binario de unos
 * 50 MB en cada función editorial y cron de Vercel. ffmpeg queda reservado al procesamiento de video.
 */
export async function composeContentPlate(input: {
  photoBuffer: Buffer
  headline: string
  subtitle: string
  format: "reel" | "historia" | "carrusel" | "post"
}): Promise<Buffer> {
  const { width, height } = DIMENSIONS[input.format]
  const textSafeWidth = Math.round(width * TEXT_SAFE_WIDTH_RATIO)
  const scrimSolidEnd = Math.round(width * SCRIM_SOLID_END_RATIO)
  const scrimFadeEnd = Math.round(width * SCRIM_FADE_END_RATIO)
  const availableWidth = textSafeWidth - PANEL_PADDING_X - PANEL_RIGHT_MARGIN

  const headlineCharsPerLine = Math.max(6, Math.floor(availableWidth / (HEADLINE_FONT_SIZE * HEADLINE_CHAR_RATIO)))
  const subtitleCharsPerLine = Math.max(10, Math.floor(availableWidth / (SUBTITLE_FONT_SIZE * SUBTITLE_CHAR_RATIO)))
  const headlineLines = wrapText(input.headline.toUpperCase(), headlineCharsPerLine)
  const subtitleLines = wrapText(input.subtitle, subtitleCharsPerLine)
  const headlineMainLines = headlineLines.length >= 2 ? headlineLines.slice(0, -1) : headlineLines
  const headlineAccentLine = headlineLines.length >= 2 ? headlineLines[headlineLines.length - 1] : ""

  const headlineLineHeight = HEADLINE_FONT_SIZE * 1.14
  const subtitleLineHeight = SUBTITLE_FONT_SIZE * 1.4
  const dividerGap = 26
  const dividerHeight = 4
  const subtitleGap = 26
  const brandGap = 50
  const brandBlockHeight = 64
  const headlineBlockHeight = headlineLines.length * headlineLineHeight
  const subtitleBlockHeight = subtitleLines.length * subtitleLineHeight
  const totalBlockHeight = headlineBlockHeight + dividerGap + dividerHeight + subtitleGap +
    subtitleBlockHeight + brandGap + brandBlockHeight
  const startY = Math.max(90, Math.round((height - totalBlockHeight) / 2))
  const headlineAccentY = Math.round(startY + headlineMainLines.length * headlineLineHeight)
  const dividerY = Math.round(startY + headlineBlockHeight + dividerGap)
  const subtitleY = Math.round(dividerY + dividerHeight + subtitleGap)
  const brandY = Math.round(subtitleY + subtitleBlockHeight + brandGap)
  const specialtyY = Math.round(brandY + 38)

  const scrimSvg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><linearGradient id="scrim" x1="0" x2="1" y1="0" y2="0">` +
        `<stop offset="0" stop-color="${COLOR_PAPER}" stop-opacity="${SCRIM_MAX_ALPHA}"/>` +
        `<stop offset="${scrimSolidEnd / width}" stop-color="${COLOR_PAPER}" stop-opacity="${SCRIM_MAX_ALPHA}"/>` +
        `<stop offset="${scrimFadeEnd / width}" stop-color="${COLOR_PAPER}" stop-opacity="0"/>` +
        `<stop offset="1" stop-color="${COLOR_PAPER}" stop-opacity="0"/>` +
      `</linearGradient></defs><rect width="100%" height="100%" fill="url(#scrim)"/></svg>`
  )

  const overlays: Array<SharpOverlayOptions | null> = [
    { input: scrimSvg, left: 0, top: 0 },
    {
      input: { create: { width, height: 22, channels: 4, background: COLOR_CARDIAC } },
      left: 0,
      top: height - 22,
    },
    textOverlay({
      text: headlineMainLines.join("\n"), fontFile: FONT_DISPLAY, fontFamily: "Fraunces Bold",
      fontSize: HEADLINE_FONT_SIZE, color: COLOR_INK, left: PANEL_PADDING_X, top: startY,
      lineHeight: Math.round(headlineLineHeight),
    }),
    textOverlay({
      text: headlineAccentLine, fontFile: FONT_DISPLAY, fontFamily: "Fraunces Bold",
      fontSize: HEADLINE_FONT_SIZE, color: COLOR_CARDIAC, left: PANEL_PADDING_X, top: headlineAccentY,
    }),
    {
      input: { create: { width: 110, height: dividerHeight, channels: 4, background: COLOR_CARDIAC } },
      left: PANEL_PADDING_X,
      top: dividerY,
    },
    textOverlay({
      text: subtitleLines.join("\n"), fontFile: FONT_SANS, fontFamily: "Inter",
      fontSize: SUBTITLE_FONT_SIZE, color: COLOR_INK_SOFT, left: PANEL_PADDING_X, top: subtitleY,
      lineHeight: Math.round(subtitleLineHeight),
    }),
    textOverlay({
      text: BRAND_NAME, fontFile: FONT_SANS_BOLD, fontFamily: "Inter Bold",
      fontSize: 30, color: COLOR_INK, left: PANEL_PADDING_X, top: brandY,
    }),
    textOverlay({
      text: BRAND_SPECIALTY, fontFile: FONT_SANS_BOLD, fontFamily: "Inter Bold",
      fontSize: 19, color: COLOR_CARDIAC, left: PANEL_PADDING_X, top: specialtyY,
    }),
  ]

  return sharp(input.photoBuffer)
    .rotate()
    .resize(width, height, { fit: "cover", position: "centre" })
    .ensureAlpha()
    .composite(overlays.filter((overlay): overlay is SharpOverlayOptions => overlay !== null))
    .png()
    .toBuffer()
}
