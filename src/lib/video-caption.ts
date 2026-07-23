import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg"
import ffprobeInstaller from "@ffprobe-installer/ffprobe"
import type { ContentScene } from "@/types"

// Paleta de las tarjetas de texto de la microinfografia (2026-07-23) -- mismo azul profundo que
// VIDEO_PROMPT_RULES pide para el fondo animado, nunca rosa como color dominante (pedido explicito).
const CARD_TEXT_COLOR = "0x0F2A4A" // azul profundo, para texto sobre tarjeta clara
const CARD_BG_COLOR = "white@0.94" // tarjeta clara (gancho y mensajes)
const CTA_BG_COLOR = "0x0F2A4A@0.94" // tarjeta con acento de marca (cierre)
const CTA_TEXT_COLOR = "white"

// Credito de marca persistente (2026-07-23): quemado por edicion real, nunca generado por Veo -- a
// diferencia del texto del brief, no depende de lo que el modelo de video decida dibujar. Se agrega
// porque Veo, sin esto, puede rellenar la parte superior del cuadro con contenido inventado (llego a
// alucinar una barra de estado de telefono con un nombre de app falso) y porque una pieza medica
// necesita identificar a la profesional de forma consistente en todas las piezas, no solo en el CTA.
const BRAND_LABEL = "Dra. Lucía Chahin · Cardióloga"
const BRAND_FONT_SIZE = 24

const execFileAsync = promisify(execFile)

// DejaVu Sans Bold: fuente estatica (no variable) con buena cobertura de acentos/ñ en español,
// eleccion estandar para drawtext de ffmpeg en entornos headless (sin fontconfig del sistema).
// Licencia Bitstream Vera / DejaVu (libre, redistribuible), ver
// https://dejavu-fonts.github.io/License.html. Co-ubicada en este mismo directorio para que el
// file tracing de Next.js la incluya en el bundle de la funcion (ver next.config.mjs).
const FONT_PATH = join(__dirname, "fonts", "DejaVuSans-Bold.ttf")

// Mismo tope que el editor de guion (ver REEL_SCENE_RULES en ai.ts).
const MAX_SCENES = 6

/** ffmpeg trata ":" como separador de opciones y "\" como caracter de escape dentro del filtergraph
 * -- las rutas de Windows (unidad + backslashes) rompen el parser si no se normalizan. En Linux
 * (produccion) esto es un no-op (las rutas no tienen ":" ni "\"). */
function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/:/g, "\\:")
}

// drawtext no hace word-wrap solo -- un onScreenText de 8-10 palabras a este tamaño de fuente se
// corta contra los bordes del video (720px de ancho, formato vertical). Se ajusta a mano, cortando
// por palabra entera, nunca a mitad de una palabra. ~19 caracteres/linea es un margen conservador
// para DejaVu Sans Bold a fontsize 44 en un video de 720px de ancho.
const FONT_SIZE = 44
const MAX_CHARS_PER_LINE = 19

function wrapCaptionText(text: string, maxCharsPerLine: number = MAX_CHARS_PER_LINE): string {
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
  return lines.join("\n")
}

async function getDurationSeconds(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync(ffprobeInstaller.path, [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath,
  ])
  const seconds = Number.parseFloat(stdout.trim())
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 8
}

/**
 * Quema el texto en pantalla del guion (item.scenes) sobre un video ya generado con IA o subido a
 * mano, con ffmpeg. El texto de cada escena se pasa via un archivo aparte (textfile=), no inline
 * (text=) -- evita tener que escapar tildes/eñes/comillas/dos puntos del texto en español dentro del
 * filtergraph, que es appropiadamente delicado de hacer bien a mano.
 *
 * El guion (REEL_SCENE_RULES) esta pensado para un reel filmado a mano de hasta 25s; un clip generado
 * con Veo dura como maximo 8s (una sola generacion). Por eso se detecta la duracion real con ffprobe
 * y solo se queman las escenas cuyo "from" cae dentro de esa duracion -- las que no entran
 * simplemente no se muestran, en vez de romper el video o desbordar el clip.
 */
export async function burnCaptionsOntoVideo(input: {
  videoBuffer: Buffer
  scenes: ContentScene[]
}): Promise<Buffer> {
  const workDir = await mkdtemp(join(tmpdir(), "lule-video-caption-"))
  try {
    const inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "output.mp4")
    await writeFile(inputPath, input.videoBuffer)

    const durationSeconds = await getDurationSeconds(inputPath)

    const usableScenes = input.scenes
      .filter(scene => scene.from < durationSeconds && scene.onScreenText.trim())
      .slice(0, MAX_SCENES)
    if (usableScenes.length === 0) return input.videoBuffer

    const fontPath = escapeFilterPath(FONT_PATH)
    const drawtextFilters = await Promise.all(usableScenes.map(async (scene, index) => {
      const textPath = join(workDir, `scene-${index}.txt`)
      await writeFile(textPath, wrapCaptionText(scene.onScreenText), "utf-8")
      const to = Math.max(scene.from + 0.5, Math.min(scene.to, durationSeconds))
      const escapedTextPath = escapeFilterPath(textPath)
      return `drawtext=fontfile='${fontPath}':textfile='${escapedTextPath}':fontsize=${FONT_SIZE}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=18:x=(w-text_w)/2:y=h-240:line_spacing=8:enable='between(t\\,${scene.from}\\,${to})'`
    }))

    await execFileAsync(ffmpegInstaller.path, [
      "-y", "-i", inputPath,
      "-vf", drawtextFilters.join(","),
      // Sin esto, ffmpeg re-codifica el video con un bitrate default bajo (~380kb/s en un clip de
      // prueba real) -- suficiente para que el fondo se vea bien, pero el texto compuesto encima
      // pierde contraste/legibilidad en frames con mas movimiento (bug real encontrado en vivo,
      // 2026-07-23). CRF 18 es practicamente sin perdida visible para x264; preset "medium" no suma
      // tiempo relevante en un clip de unos pocos segundos.
      "-crf", "18",
      "-preset", "medium",
      "-codec:a", "copy",
      outputPath,
    ])

    return await readFile(outputPath)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

const CARD_FADE_SECONDS = 0.25

/** Expresion de alpha (0-1) para un fundido de entrada/salida suave dentro de [from, to] -- ffmpeg no
 * anima drawtext solo, hay que darle la expresion de opacidad en funcion de "t" a mano. Las comas
 * internas de cada if(...) se escapan porque el filtro completo se concatena con otros drawtext
 * separados por comas (ver textCardFilter). */
function fadeAlphaExpr(from: number, to: number): string {
  const fadeIn = from + CARD_FADE_SECONDS
  const fadeOut = Math.max(fadeIn, to - CARD_FADE_SECONDS)
  return (
    `if(lt(t\\,${from})\\,0\\,` +
    `if(lt(t\\,${fadeIn})\\,(t-${from})/${CARD_FADE_SECONDS}\\,` +
    `if(lt(t\\,${fadeOut})\\,1\\,` +
    `if(lt(t\\,${to})\\,(${to}-t)/${CARD_FADE_SECONDS}\\,0))))`
  )
}

function textCardFilter(opts: {
  textPath: string
  fontPath: string
  from: number
  to: number
  fontSize: number
  y: string
  boxColor: string
  fontColor: string
}): string {
  return `drawtext=fontfile='${opts.fontPath}':textfile='${opts.textPath}':fontsize=${opts.fontSize}:` +
    `fontcolor=${opts.fontColor}:box=1:boxcolor=${opts.boxColor}:boxborderw=22:x=(w-text_w)/2:y=${opts.y}:` +
    `line_spacing=10:alpha='${fadeAlphaExpr(opts.from, opts.to)}':enable='between(t\\,${opts.from}\\,${opts.to})'`
}

// Estructura obligatoria de la microinfografia (ver VIDEO_BRIEF_RULES en ai.ts): gancho 0,0-1,2s,
// mensajes 1,2-6,2s repartidos en partes iguales, CTA 6,2-8,0s. Se clampea a la duracion real del
// video (ffprobe) por si Veo entrega un clip un poco mas corto/largo que 8s.
const HOOK_END = 1.2
const MESSAGES_END = 6.2

/**
 * Compone la microinfografia completa: quema el gancho, los mensajes secundarios y el CTA de un
 * ContentVideoBrief sobre el video (fondo/animacion) generado por Veo -- Veo nunca genera este texto
 * (ver VIDEO_PROMPT_RULES), se agrega aca por edicion real para garantizar ortografia y legibilidad.
 * Tarjetas claras (gancho y mensajes) + una tarjeta de acento de marca para el CTA, con un fundido de
 * entrada/salida suave, mas un credito de marca (BRAND_LABEL) persistente durante todo el video.
 * Reemplaza, para el camino de generacion con IA, a burnCaptionsOntoVideo (que sigue vigente para el
 * guion filmado a mano, un caso de uso distinto).
 */
export async function burnVideoBrief(input: {
  videoBuffer: Buffer
  hook: string
  messages: string[]
  cta: string
}): Promise<Buffer> {
  const workDir = await mkdtemp(join(tmpdir(), "lule-video-brief-"))
  try {
    const inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "output.mp4")
    await writeFile(inputPath, input.videoBuffer)

    const durationSeconds = await getDurationSeconds(inputPath)
    const fontPath = escapeFilterPath(FONT_PATH)
    const filters: string[] = []

    const brandTextPath = join(workDir, "brand.txt")
    await writeFile(brandTextPath, BRAND_LABEL, "utf-8")
    filters.push(
      `drawtext=fontfile='${fontPath}':textfile='${escapeFilterPath(brandTextPath)}':fontsize=${BRAND_FONT_SIZE}:` +
      `fontcolor=${CARD_TEXT_COLOR}:box=1:boxcolor=${CARD_BG_COLOR}:boxborderw=14:x=(w-text_w)/2:y=26:` +
      `alpha='if(lt(t\\,0.3)\\,t/0.3\\,1)'`
    )

    if (input.hook.trim()) {
      const hookEnd = Math.min(HOOK_END, durationSeconds)
      const textPath = join(workDir, "hook.txt")
      await writeFile(textPath, wrapCaptionText(input.hook, 16), "utf-8")
      filters.push(textCardFilter({
        textPath: escapeFilterPath(textPath), fontPath, from: 0, to: hookEnd,
        fontSize: 56, y: "h*0.14", boxColor: CARD_BG_COLOR, fontColor: CARD_TEXT_COLOR,
      }))
    }

    const usableMessages = input.messages.filter(m => m.trim()).slice(0, 3)
    const messagesEnd = Math.min(MESSAGES_END, durationSeconds)
    const messageWindow = Math.max(0, messagesEnd - Math.min(HOOK_END, durationSeconds))
    const perMessage = usableMessages.length > 0 ? messageWindow / usableMessages.length : 0
    for (let index = 0; index < usableMessages.length; index++) {
      const from = Math.min(HOOK_END, durationSeconds) + index * perMessage
      const to = Math.min(from + perMessage, durationSeconds)
      if (to <= from) continue
      const textPath = join(workDir, `message-${index}.txt`)
      await writeFile(textPath, wrapCaptionText(usableMessages[index], 19), "utf-8")
      filters.push(textCardFilter({
        textPath: escapeFilterPath(textPath), fontPath, from, to,
        fontSize: 46, y: "(h-text_h)/2", boxColor: CARD_BG_COLOR, fontColor: CARD_TEXT_COLOR,
      }))
    }

    if (input.cta.trim() && durationSeconds > messagesEnd) {
      const textPath = join(workDir, "cta.txt")
      await writeFile(textPath, wrapCaptionText(input.cta, 20), "utf-8")
      filters.push(textCardFilter({
        textPath: escapeFilterPath(textPath), fontPath, from: messagesEnd, to: durationSeconds,
        fontSize: 46, y: "h-260", boxColor: CTA_BG_COLOR, fontColor: CTA_TEXT_COLOR,
      }))
    }

    await execFileAsync(ffmpegInstaller.path, [
      "-y", "-i", inputPath,
      "-vf", filters.join(","),
      // Sin esto, ffmpeg re-codifica el video con un bitrate default bajo (~380kb/s en un clip de
      // prueba real) -- suficiente para que el fondo se vea bien, pero el texto compuesto encima
      // pierde contraste/legibilidad en frames con mas movimiento (bug real encontrado en vivo,
      // 2026-07-23). CRF 18 es practicamente sin perdida visible para x264; preset "medium" no suma
      // tiempo relevante en un clip de unos pocos segundos.
      "-crf", "18",
      "-preset", "medium",
      "-codec:a", "copy",
      outputPath,
    ])

    return await readFile(outputPath)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
