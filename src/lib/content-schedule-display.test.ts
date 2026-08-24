import {
  describeAutoPublishQueue,
  describeLastAutoPublishRun,
  describeNextWindow,
  describeWeekdaySelection,
  describeWindow,
  fromLocalInputValue,
} from "@/lib/content-schedule-display"
import type { AutoPublishTrackSettings } from "@/types"

function track(overrides: Partial<AutoPublishTrackSettings> = {}): AutoPublishTrackSettings {
  return {
    enabled: true,
    timezone: "America/Argentina/Buenos_Aires",
    schedule_slots: [{ day_of_week: 1, local_time: "19:00" }],
    items_per_run: 1,
    starts_at: null,
    last_run_at: null,
    last_run_result: null,
    last_published_at: null,
    ...overrides,
  }
}

describe("textos del cronograma editorial", () => {
  it("resume días y ventana sin depender del componente gigante", () => {
    expect(describeWeekdaySelection([1, 4])).toBe("Publica: Lun, Jue.")
    expect(describeWindow(track())).toBe("Entre 19:00 y 20:00 ART")
  })

  it("explica una cola vacía sin inventar una fecha", () => {
    expect(describeAutoPublishQueue("post", 0, track(), new Date("2026-08-24T12:00:00Z")))
      .toBe("0 posts aprobados en cola.")
  })

  it("explica el resultado parcial y su causa", () => {
    const message = describeLastAutoPublishRun(track({
      last_run_at: "2026-08-24T22:00:00.000Z",
      last_run_result: "published:1/2 (quota_exceeded)",
    }))
    expect(message).toContain("se publicaron 1 de 2 piezas")
    expect(message).toContain("límite diario")
  })

  it("calcula la próxima ventana en horario argentino", () => {
    const message = describeNextWindow(track(), new Date("2026-08-23T12:00:00.000Z"))
    expect(message).toContain("entre 19:00 y 20:00 ART")
  })

  it("convierte el input local a ISO", () => {
    expect(fromLocalInputValue("2026-08-24T19:00")).toMatch(/^2026-08-24T/)
  })
})
