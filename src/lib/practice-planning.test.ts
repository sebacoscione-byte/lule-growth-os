import {
  DEFAULT_PLANNING_CONFIG,
  buildMonthlyProjections,
  buildScheduleBlocks,
  buildScheduleSlots,
  summarizeInstitutions,
  planningConfigSchema,
} from "./practice-planning"

describe("practice planning", () => {
  test("reproduce las 46 franjas de 15 minutos del horario", () => {
    const slots = buildScheduleSlots()

    expect(slots).toHaveLength(46)
    expect(slots[0]).toMatchObject({ start: "09:00", end: "09:15" })
    expect(slots.at(-1)).toMatchObject({ start: "20:15", end: "20:30" })
    expect(slots.find(slot => slot.start === "16:00")?.activities.tuesday).toBe(
      "ECOCARDIOGRAMA HB LANUS"
    )
    expect(slots.find(slot => slot.start === "19:45")?.activities.friday).toBe(
      "CONSULTORIO SMG"
    )
  })

  test("agrupa las franjas consecutivas sin alterar su duración", () => {
    const blocks = buildScheduleBlocks()

    expect(
      blocks.find(
        block => block.day === "tuesday" && block.activity === "CONSULTORIO CIMEL"
      )
    ).toMatchObject({ start: "13:00", end: "15:00", slots: 8, hours: 2 })
    expect(
      blocks.find(
        block => block.day === "wednesday" && block.activity === "CONSULTORIO HB CENTRAL"
      )
    ).toMatchObject({ start: "17:00", end: "19:45", slots: 11, hours: 2.75 })
  })

  test("reproduce el resumen semanal y mensual promedio del Sheet", () => {
    const summaries = summarizeInstitutions()
    const cimel = summaries.find(row => row.key === "cimel")
    const hbLanus = summaries.find(row => row.key === "hb-lanus")
    const hbCentral = summaries.find(row => row.key === "hb-central")
    const swiss = summaries.find(row => row.key === "swiss")

    expect(cimel).toMatchObject({
      slotsPerWeek: 32,
      hoursPerWeek: 8,
      privatePerWeek: 3,
      coveredPerWeek: 29,
      weeklyIncome: 615_000,
      averageMonthlyIncome: 2_662_950,
    })
    expect(hbLanus).toMatchObject({ slotsPerWeek: 14, weeklyIncome: 280_000 })
    expect(hbCentral).toMatchObject({
      slotsPerWeek: 11,
      privatePerWeek: 1,
      coveredPerWeek: 10,
      weeklyIncome: 210_000,
    })
    expect(swiss).toMatchObject({ slotsPerWeek: 12, weeklyIncome: 180_000 })

    expect(summaries.reduce((sum, row) => sum + row.hoursPerWeek, 0)).toBe(32.25)
    expect(summaries.reduce((sum, row) => sum + row.weeklyIncome, 0)).toBe(1_285_000)
    expect(summaries.reduce((sum, row) => sum + row.averageMonthlyIncome, 0)).toBe(5_564_050)
  })

  test("reproduce la proyección calendario septiembre-diciembre de 2026", () => {
    const projections = buildMonthlyProjections()

    expect(projections.map(month => month.businessDays)).toEqual([22, 21, 20, 20])
    expect(projections.map(month => month.attentionDays)).toEqual([
      { tuesday: 5, wednesday: 5, thursday: 4, friday: 4 },
      { tuesday: 4, wednesday: 4, thursday: 5, friday: 5 },
      { tuesday: 4, wednesday: 4, thursday: 4, friday: 4 },
      { tuesday: 4, wednesday: 5, thursday: 5, friday: 3 },
    ])
    expect(projections.map(month => month.institutions.cimel)).toEqual([
      2_625_000,
      2_910_000,
      2_460_000,
      2_460_000,
    ])
    expect(projections.map(month => month.total)).toEqual([
      5_795_000,
      5_770_000,
      5_140_000,
      5_170_000,
    ])
  })

  test("recalcula ingresos y meses cuando cambia la configuración", () => {
    const edited = {
      ...DEFAULT_PLANNING_CONFIG,
      rules: { ...DEFAULT_PLANNING_CONFIG.rules, privateConsultationValue: 70_000 },
      projectionStartMonth: "2027-01",
      projectionMonths: 2,
      holidays: [],
    }
    const summaries = summarizeInstitutions(buildScheduleSlots(edited.intervals), edited.rules)
    const projections = buildMonthlyProjections(edited)

    expect(summaries.find(row => row.key === "cimel")?.weeklyIncome).toBe(645_000)
    expect(projections).toHaveLength(2)
    expect(projections.map(month => [month.year, month.month])).toEqual([[2027, 1], [2027, 2]])
  })

  test("rechaza bloques superpuestos y feriados repetidos", () => {
    const parsed = planningConfigSchema.safeParse({
      ...DEFAULT_PLANNING_CONFIG,
      intervals: [
        ...DEFAULT_PLANNING_CONFIG.intervals,
        { day: "friday", start: "13:15", end: "14:00", activity: "CONSULTORIO SMG" },
      ],
      holidays: ["2026-10-12", "2026-10-12"],
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.map(issue => issue.message)).toEqual(expect.arrayContaining([
        "Hay bloques superpuestos en el mismo día",
        "El feriado está repetido",
      ]))
    }
  })
})
