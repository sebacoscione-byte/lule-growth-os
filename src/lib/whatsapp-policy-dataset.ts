import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { z } from "zod"
import {
  WhatsAppIntentSchema,
} from "@/lib/whatsapp-nlu-schema"
import {
  evaluateWhatsAppPolicy,
  WhatsAppGlobalActionSchema,
  WhatsAppPolicyInputTypeSchema,
  WhatsAppPolicyStateSchema,
  WhatsAppResponseKeySchema,
} from "@/lib/whatsapp-policy"

const GoldenCaseSchema = z.object({
  id: z.string().min(1).max(120),
  group: z.string().min(1).max(120),
  initial_state: WhatsAppPolicyStateSchema,
  input_type: WhatsAppPolicyInputTypeSchema,
  user_text: z.string().max(4000),
  expected_global_action: WhatsAppGlobalActionSchema,
  expected_primary_intent: WhatsAppIntentSchema,
  expected_response_key: WhatsAppResponseKeySchema,
  expected_handoff: z.boolean(),
  notes: z.string().max(1000),
}).strict()

export type WhatsAppGoldenCase = z.infer<typeof GoldenCaseSchema>

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

/** Parser RFC 4180 pequeño: soporta comas, saltos y comillas escapadas. */
function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
      continue
    }

    if (character === '"') {
      quoted = true
    } else if (character === ",") {
      row.push(cell)
      cell = ""
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""))
      rows.push(row)
      row = []
      cell = ""
    } else {
      cell += character
    }
  }

  if (quoted) throw new Error("Malformed CSV: unclosed quoted field")
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/, ""))
    rows.push(row)
  }
  return rows.filter(fields => fields.some(field => field.length > 0))
}

export function parseWhatsAppGoldenDataset(csv: string): WhatsAppGoldenCase[] {
  const rows = parseCsvRows(csv.replace(/^\uFEFF/, ""))
  const headers = rows.shift()
  if (!headers || headers.join("|") !== EXPECTED_HEADERS.join("|")) {
    throw new Error("Unexpected WhatsApp golden dataset headers")
  }

  const seenIds = new Set<string>()
  return rows.map((fields, index) => {
    if (fields.length !== EXPECTED_HEADERS.length) {
      throw new Error(`Malformed WhatsApp golden dataset row ${index + 2}`)
    }
    const raw = Object.fromEntries(EXPECTED_HEADERS.map((header, column) => [header, fields[column]]))
    const parsed = GoldenCaseSchema.parse({
      ...raw,
      expected_handoff: raw.expected_handoff === "true"
        ? true
        : raw.expected_handoff === "false"
          ? false
          : raw.expected_handoff,
    })
    if (seenIds.has(parsed.id)) throw new Error(`Duplicate WhatsApp golden case id: ${parsed.id}`)
    seenIds.add(parsed.id)
    return parsed
  })
}

export function loadWhatsAppGoldenDataset(
  csvPath = resolve(process.cwd(), "casos_prueba_bot_whatsapp_dra_lucia.csv"),
): WhatsAppGoldenCase[] {
  return parseWhatsAppGoldenDataset(readFileSync(csvPath, "utf8"))
}

export interface WhatsAppPolicyDiscrepancy {
  id: string
  group: string
  expected: {
    action: string
    intent: string
    response_key: string
    handoff: boolean
  }
  actual: {
    action: string
    intent: string
    response_key: string
    handoff: boolean
  }
}

export interface WhatsAppPolicySimulation {
  total: number
  passed: number
  failed: number
  discrepancies: WhatsAppPolicyDiscrepancy[]
}

/**
 * Simulador offline. Los reportes contienen solo IDs sintéticos del dataset,
 * nunca el texto que eventualmente podría provenir de un paciente real.
 */
export function simulateWhatsAppPolicyDataset(cases: WhatsAppGoldenCase[]): WhatsAppPolicySimulation {
  const discrepancies: WhatsAppPolicyDiscrepancy[] = []

  for (const testCase of cases) {
    const decision = evaluateWhatsAppPolicy({
      state: testCase.initial_state,
      input_type: testCase.input_type,
      text: testCase.user_text,
      consecutive_unknown_count: 0,
    })
    const actual = {
      action: decision.global_action,
      intent: decision.nlu.primary_intent,
      response_key: decision.response_key,
      handoff: decision.handoff,
    }
    const expected = {
      action: testCase.expected_global_action,
      intent: testCase.expected_primary_intent,
      response_key: testCase.expected_response_key,
      handoff: testCase.expected_handoff,
    }
    if (
      actual.action !== expected.action ||
      actual.intent !== expected.intent ||
      actual.response_key !== expected.response_key ||
      actual.handoff !== expected.handoff
    ) {
      discrepancies.push({ id: testCase.id, group: testCase.group, expected, actual })
    }
  }

  return {
    total: cases.length,
    passed: cases.length - discrepancies.length,
    failed: discrepancies.length,
    discrepancies,
  }
}
