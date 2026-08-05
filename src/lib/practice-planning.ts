export const WEEK_DAYS = [
  { key: "monday", label: "Lunes", shortLabel: "Lun", weekday: 1 },
  { key: "tuesday", label: "Martes", shortLabel: "Mar", weekday: 2 },
  { key: "wednesday", label: "Miércoles", shortLabel: "Mié", weekday: 3 },
  { key: "thursday", label: "Jueves", shortLabel: "Jue", weekday: 4 },
  { key: "friday", label: "Viernes", shortLabel: "Vie", weekday: 5 },
  { key: "saturday", label: "Sábado", shortLabel: "Sáb", weekday: 6 },
  { key: "sunday", label: "Domingo", shortLabel: "Dom", weekday: 0 },
] as const

export type WeekDayKey = (typeof WEEK_DAYS)[number]["key"]

export const ACTIVITY_KEYS = [
  "INVESTIGACION",
  "ALMUERZO",
  "CONSULTORIO CIMEL",
  "ECOCARDIOGRAMA HB LANUS",
  "CONSULTORIO HB CENTRAL",
  "CONSULTORIO SMG",
  "CERAMICA",
  "LIBRE",
] as const

export type ActivityKey = (typeof ACTIVITY_KEYS)[number]

export const ACTIVITY_META: Record<
  ActivityKey,
  { label: string; shortLabel: string; color: string }
> = {
  INVESTIGACION: {
    label: "Investigación",
    shortLabel: "Investigación",
    color: "blue",
  },
  ALMUERZO: { label: "Almuerzo", shortLabel: "Almuerzo", color: "orange" },
  "CONSULTORIO CIMEL": {
    label: "Consultorio CIMEL",
    shortLabel: "CIMEL",
    color: "green",
  },
  "ECOCARDIOGRAMA HB LANUS": {
    label: "Ecocardiogramas · HB Lanús",
    shortLabel: "Eco HB Lanús",
    color: "yellow",
  },
  "CONSULTORIO HB CENTRAL": {
    label: "Consultorio · HB Central",
    shortLabel: "HB Central",
    color: "amber",
  },
  "CONSULTORIO SMG": {
    label: "Consultorio · Swiss Medical",
    shortLabel: "Swiss Medical",
    color: "violet",
  },
  CERAMICA: { label: "Cerámica", shortLabel: "Cerámica", color: "stone" },
  LIBRE: { label: "Libre", shortLabel: "Libre", color: "gray" },
}

export interface PracticeRules {
  minutesPerPatient: number
  privateConsultationValue: number
  coveredConsultationValue: number
  echocardiogramValue: number
  monthlyResearchValue: number
  privatePatientsPerDay: number
  averageWeeksPerMonth: number
}

export const DEFAULT_PRACTICE_RULES: PracticeRules = {
  minutesPerPatient: 15,
  privateConsultationValue: 60_000,
  coveredConsultationValue: 15_000,
  echocardiogramValue: 20_000,
  monthlyResearchValue: 0,
  privatePatientsPerDay: 1,
  averageWeeksPerMonth: 4.33,
}

interface ScheduleInterval {
  day: WeekDayKey
  start: string
  end: string
  activity: ActivityKey
}

export interface ScheduleSlot {
  start: string
  end: string
  activities: Record<WeekDayKey, ActivityKey | null>
}

export interface ScheduleBlock extends ScheduleInterval {
  slots: number
  hours: number
}

const BASE_INTERVALS: ScheduleInterval[] = [
  ...(["monday", "tuesday", "wednesday", "thursday", "friday"] as WeekDayKey[]).flatMap(
    day => [
      { day, start: "09:00", end: "12:00", activity: "INVESTIGACION" as const },
      { day, start: "12:00", end: "13:00", activity: "ALMUERZO" as const },
      { day, start: "13:00", end: "20:30", activity: "LIBRE" as const },
    ]
  ),
  { day: "saturday", start: "09:00", end: "13:00", activity: "CERAMICA" },
]

const WORK_INTERVALS: ScheduleInterval[] = [
  { day: "tuesday", start: "13:00", end: "15:00", activity: "CONSULTORIO CIMEL" },
  {
    day: "tuesday",
    start: "16:00",
    end: "19:30",
    activity: "ECOCARDIOGRAMA HB LANUS",
  },
  {
    day: "wednesday",
    start: "17:00",
    end: "19:45",
    activity: "CONSULTORIO HB CENTRAL",
  },
  { day: "thursday", start: "13:00", end: "16:00", activity: "CONSULTORIO CIMEL" },
  { day: "friday", start: "13:00", end: "16:00", activity: "CONSULTORIO CIMEL" },
  { day: "friday", start: "17:00", end: "20:00", activity: "CONSULTORIO SMG" },
]

function minutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number)
  return hour * 60 + minute
}

function timeFromMinutes(value: number): string {
  const hour = Math.floor(value / 60)
  const minute = value % 60
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function activityAt(day: WeekDayKey, time: string): ActivityKey | null {
  const minute = minutes(time)
  const matchingWork = WORK_INTERVALS.find(
    interval =>
      interval.day === day && minute >= minutes(interval.start) && minute < minutes(interval.end)
  )
  if (matchingWork) return matchingWork.activity

  return (
    BASE_INTERVALS.find(
      interval =>
        interval.day === day && minute >= minutes(interval.start) && minute < minutes(interval.end)
    )?.activity ?? null
  )
}

export function buildScheduleSlots(): ScheduleSlot[] {
  const result: ScheduleSlot[] = []
  for (let start = minutes("09:00"); start < minutes("20:30"); start += 15) {
    const startTime = timeFromMinutes(start)
    result.push({
      start: startTime,
      end: timeFromMinutes(start + 15),
      activities: Object.fromEntries(
        WEEK_DAYS.map(day => [day.key, activityAt(day.key, startTime)])
      ) as Record<WeekDayKey, ActivityKey | null>,
    })
  }
  return result
}

export function buildScheduleBlocks(slots = buildScheduleSlots()): ScheduleBlock[] {
  const blocks: ScheduleBlock[] = []

  for (const day of WEEK_DAYS) {
    for (const slot of slots) {
      const activity = slot.activities[day.key]
      if (!activity) continue
      const previous = blocks.at(-1)
      if (
        previous &&
        previous.day === day.key &&
        previous.activity === activity &&
        previous.end === slot.start
      ) {
        previous.end = slot.end
        previous.slots += 1
        previous.hours = previous.slots / 4
      } else {
        blocks.push({
          day: day.key,
          start: slot.start,
          end: slot.end,
          activity,
          slots: 1,
          hours: 0.25,
        })
      }
    }
  }

  return blocks
}

export const INSTITUTIONS = [
  {
    key: "cimel",
    name: "CIMEL",
    activity: "Consultorio",
    scheduleLabel: "CONSULTORIO CIMEL",
  },
  {
    key: "hb-lanus",
    name: "Hospital Británico Lanús",
    activity: "Ecocardiograma",
    scheduleLabel: "ECOCARDIOGRAMA HB LANUS",
  },
  {
    key: "hb-central",
    name: "Hospital Británico Central",
    activity: "Consultorio",
    scheduleLabel: "CONSULTORIO HB CENTRAL",
  },
  {
    key: "swiss",
    name: "Swiss Medical",
    activity: "Consultorio",
    scheduleLabel: "CONSULTORIO SMG",
  },
  {
    key: "research",
    name: "Investigación",
    activity: "Investigación",
    scheduleLabel: "INVESTIGACION",
  },
] as const

export interface InstitutionSummary {
  key: (typeof INSTITUTIONS)[number]["key"]
  name: string
  activity: string
  scheduleLabel: ActivityKey
  slotsPerWeek: number
  hoursPerWeek: number
  servicesPerWeek: number
  privatePerWeek: number
  coveredPerWeek: number
  weeklyIncome: number
  averageMonthlyIncome: number
}

function firstConsultationByDay(slots: ScheduleSlot[]): Partial<Record<WeekDayKey, ActivityKey>> {
  return Object.fromEntries(
    WEEK_DAYS.map(day => {
      const first = slots
        .map(slot => slot.activities[day.key])
        .find(activity => activity?.startsWith("CONSULTORIO"))
      return [day.key, first]
    }).filter((entry): entry is [WeekDayKey, ActivityKey] => Boolean(entry[1]))
  )
}

export function summarizeInstitutions(
  slots = buildScheduleSlots(),
  rules = DEFAULT_PRACTICE_RULES
): InstitutionSummary[] {
  const firstConsultations = firstConsultationByDay(slots)

  return INSTITUTIONS.map(institution => {
    const scheduleLabel = institution.scheduleLabel as ActivityKey
    const slotsPerWeek = slots.reduce(
      (total, slot) =>
        total + WEEK_DAYS.filter(day => slot.activities[day.key] === scheduleLabel).length,
      0
    )
    const isConsultation = institution.activity === "Consultorio"
    const privateDays = isConsultation
      ? Object.values(firstConsultations).filter(activity => activity === scheduleLabel).length
      : 0
    const privatePerWeek = Math.min(slotsPerWeek, privateDays * rules.privatePatientsPerDay)
    const servicesPerWeek = institution.activity === "Investigación" ? 0 : slotsPerWeek
    const coveredPerWeek = isConsultation ? servicesPerWeek - privatePerWeek : 0

    let weeklyIncome = 0
    if (isConsultation) {
      weeklyIncome =
        privatePerWeek * rules.privateConsultationValue +
        coveredPerWeek * rules.coveredConsultationValue
    } else if (institution.activity === "Ecocardiograma") {
      weeklyIncome = servicesPerWeek * rules.echocardiogramValue
    } else {
      weeklyIncome = rules.monthlyResearchValue / rules.averageWeeksPerMonth
    }

    return {
      key: institution.key,
      name: institution.name,
      activity: institution.activity,
      scheduleLabel,
      slotsPerWeek,
      hoursPerWeek: slotsPerWeek / 4,
      servicesPerWeek,
      privatePerWeek,
      coveredPerWeek,
      weeklyIncome,
      averageMonthlyIncome:
        institution.activity === "Investigación"
          ? rules.monthlyResearchValue
          : weeklyIncome * rules.averageWeeksPerMonth,
    }
  })
}

export interface MonthProjection {
  year: number
  month: number
  label: string
  businessDays: number
  attentionDays: Record<"tuesday" | "wednesday" | "thursday" | "friday", number>
  institutions: Record<"cimel" | "hb-lanus" | "hb-central" | "swiss" | "research", number>
  total: number
}

export const PROJECTION_MONTHS = [
  { year: 2026, month: 9, label: "Septiembre 2026" },
  { year: 2026, month: 10, label: "Octubre 2026" },
  { year: 2026, month: 11, label: "Noviembre 2026" },
  { year: 2026, month: 12, label: "Diciembre 2026" },
] as const

export const PROJECTION_HOLIDAYS = new Set([
  "2026-10-12",
  "2026-11-23",
  "2026-12-07",
  "2026-12-08",
  "2026-12-25",
])

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

export function projectMonth(
  year: number,
  month: number,
  label: string,
  rules = DEFAULT_PRACTICE_RULES,
  holidays = PROJECTION_HOLIDAYS,
  slots = buildScheduleSlots()
): MonthProjection {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  let businessDays = 0
  const attentionDays = { tuesday: 0, wednesday: 0, thursday: 0, friday: 0 }
  const institutions = { cimel: 0, "hb-lanus": 0, "hb-central": 0, swiss: 0, research: 0 }
  const firstConsultations = firstConsultationByDay(slots)

  for (let day = 1; day <= daysInMonth; day += 1) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    const isHoliday = holidays.has(isoDate(year, month, day))
    if (weekday >= 1 && weekday <= 5 && !isHoliday) businessDays += 1
    if (weekday === 0 || weekday === 6 || isHoliday) continue

    const dayDefinition = WEEK_DAYS.find(candidate => candidate.weekday === weekday)
    if (!dayDefinition) continue
    const dayKey = dayDefinition.key
    if (dayKey in attentionDays) attentionDays[dayKey as keyof typeof attentionDays] += 1

    const dayActivities = slots.map(slot => slot.activities[dayKey])
    const firstConsultation = firstConsultations[dayKey]

    for (const institution of INSTITUTIONS) {
      const count = dayActivities.filter(activity => activity === institution.scheduleLabel).length
      if (count === 0 || institution.activity === "Investigación") continue

      if (institution.activity === "Consultorio") {
        const privateCount =
          firstConsultation === institution.scheduleLabel
            ? Math.min(count, rules.privatePatientsPerDay)
            : 0
        institutions[institution.key] +=
          privateCount * rules.privateConsultationValue +
          (count - privateCount) * rules.coveredConsultationValue
      } else {
        institutions[institution.key] += count * rules.echocardiogramValue
      }
    }
  }

  institutions.research = rules.monthlyResearchValue

  return {
    year,
    month,
    label,
    businessDays,
    attentionDays,
    institutions,
    total: Object.values(institutions).reduce((sum, income) => sum + income, 0),
  }
}

export function buildMonthlyProjections(): MonthProjection[] {
  return PROJECTION_MONTHS.map(month => projectMonth(month.year, month.month, month.label))
}

