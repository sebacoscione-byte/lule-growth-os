import { readFileSync } from "fs"
import { join } from "path"
import {
  EMERGENCY_REPLY,
  MEDICAL_BOUNDARY_REPLY,
  isEmergencyMessage,
  isMedicalBoundaryMessage,
} from "@/lib/medical-safety"
import { UNSUPPORTED_MEDIA_REPLY } from "@/lib/whatsapp-bot"

const FIXTURE_PATH = join(process.cwd(), "casos_prueba_bot_whatsapp_dra_lucia.csv")
const EXPECTED_HEADERS = [
  "id",
  "group",
  "initial_state",
  "input_type",
  "user_text",
  "expected_global_action",
  "expected_primary_intent",
  "expected_response_key",
  "expected_handoff",
  "notes",
] as const

type FixtureRow = Record<(typeof EXPECTED_HEADERS)[number], string>

/** Parser RFC4180 mínimo: el fixture contiene comas entrecomilladas y BOM UTF-8. */
function parseCsv(source: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
      continue
    }

    if (char === '"') quoted = true
    else if (char === ",") {
      row.push(field)
      field = ""
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""))
      rows.push(row)
      row = []
      field = ""
    } else {
      field += char
    }
  }

  if (field || row.length) {
    row.push(field.replace(/\r$/, ""))
    rows.push(row)
  }
  return rows
}

function loadFixture(): { headers: string[]; rows: FixtureRow[] } {
  const parsed = parseCsv(readFileSync(FIXTURE_PATH, "utf8").replace(/^\uFEFF/, ""))
  const [headers, ...dataRows] = parsed
  return {
    headers,
    rows: dataRows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]])) as FixtureRow),
  }
}

const fixture = loadFixture()

describe("fixture dorado del bot de WhatsApp", () => {
  it("conserva el contrato y los 180 casos únicos", () => {
    expect(fixture.headers).toEqual(EXPECTED_HEADERS)
    expect(fixture.rows).toHaveLength(180)
    expect(new Set(fixture.rows.map(row => row.id)).size).toBe(180)
    expect(fixture.rows.every(row => row.expected_handoff === "true" || row.expected_handoff === "false")).toBe(true)
  })

  describe.each(fixture.rows.filter(row => row.group === "emergency_strong"))(
    "$id",
    row => {
      it("corta el flujo con una respuesta de urgencia fija", () => {
        expect(isEmergencyMessage(row.user_text)).toBe(true)
        expect(row.expected_global_action).toBe("emergency")
        expect(row.expected_response_key).toBe("possible_emergency")
        expect(EMERGENCY_REPLY).toContain("No esperes una respuesta por WhatsApp")
      })
    }
  )

  describe.each(fixture.rows.filter(row => row.group === "emergency_negation_history"))(
    "$id",
    row => {
      it("no dispara el guardrail por negación, historia o un valor bajo el umbral", () => {
        expect(isEmergencyMessage(row.user_text)).toBe(false)
        expect(row.expected_global_action).toBe("continue")
      })
    }
  )

  const medicalBoundaryRows = fixture.rows.filter(
    row => row.expected_response_key === "medical_boundary"
  )

  describe.each(medicalBoundaryRows)("$id", row => {
    it("resuelve la consulta clínica con el catálogo, sin texto generado", () => {
      expect(isEmergencyMessage(row.user_text)).toBe(false)
      expect(isMedicalBoundaryMessage(row.user_text)).toBe(true)
      expect(MEDICAL_BOUNDARY_REPLY).toContain("no puede evaluar síntomas, medicación ni estudios")
    })
  })

  const unsupportedMediaRows = fixture.rows.filter(
    row => row.expected_response_key === "unsupported_media"
  )

  describe("adjuntos no soportados", () => {
    it("cubre todos los tipos dorados sin handoff ni interpretacion clinica", () => {
      expect(unsupportedMediaRows).toHaveLength(4)
      expect(new Set(unsupportedMediaRows.map(row => row.input_type))).toEqual(
        new Set(["audio", "image", "document", "sticker"])
      )
      for (const row of unsupportedMediaRows) {
        expect(row.expected_global_action).toBe("continue")
        expect(row.expected_primary_intent).toBe("unsupported_media")
        expect(row.expected_handoff).toBe("false")
        expect(row.user_text).toMatch(/^\[[^\]]+\]$/)
      }
    })

    it("usa una respuesta fija que explica el limite y ofrece continuidad administrativa", () => {
      expect(UNSUPPORTED_MEDIA_REPLY).toMatch(/no puede revisar audios, imágenes, documentos ni estudios/i)
      expect(UNSUPPORTED_MEDIA_REPLY).toMatch(/consulta administrativa en texto/i)
      expect(UNSUPPORTED_MEDIA_REPLY).toMatch(/persona/i)
    })
  })
})
