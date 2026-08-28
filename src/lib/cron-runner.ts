import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { sendCronFailureAlert } from "@/lib/alert-email"
import { isAuthorizedCronRequest } from "@/lib/cron-auth"
import { getServiceDb } from "@/lib/supabase/service"

export const CRON_JOB_NAMES = [
  "daily-maintenance",
  "auto-draft-content",
  "publish-stories",
  "publish-feed",
  "weekly-report",
] as const

export type CronJobName = typeof CRON_JOB_NAMES[number]
export type CronOutcomeStatus = "succeeded" | "warning" | "failed"

export interface CronTaskOutcome<T extends object> {
  status: CronOutcomeStatus
  payload: T
  summary: string
}

interface ClaimRow {
  claimed: boolean
  run_status: "running" | CronOutcomeStatus
  attempts: number
}

export interface CronExecution<T extends object> {
  claimed: boolean
  occurrenceKey: string
  attempts: number
  previousStatus?: ClaimRow["run_status"]
  outcome?: CronTaskOutcome<T>
}

const CRON_TIMEZONE = "America/Argentina/Buenos_Aires"

export function cronOccurrenceKey(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CRON_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ""
  return `${value("year")}-${value("month")}-${value("day")}`
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function firstRow<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

export async function executeCronTask<T extends object>(
  supabase: SupabaseClient,
  options: {
    jobName: CronJobName
    now: Date
    leaseSeconds?: number
    task: () => Promise<CronTaskOutcome<T>>
  }
): Promise<CronExecution<T>> {
  const occurrenceKey = cronOccurrenceKey(options.now)
  const claimToken = randomUUID()
  const { data, error } = await supabase.rpc("claim_cron_run", {
    p_job_name: options.jobName,
    p_occurrence_key: occurrenceKey,
    p_claim_token: claimToken,
    p_lease_seconds: options.leaseSeconds ?? 240,
  })
  if (error) throw new Error(`cron_claim_failed: ${error.message}`)

  const claim = firstRow(data as ClaimRow | ClaimRow[] | null)
  if (!claim) throw new Error("cron_claim_missing_result")
  if (!claim.claimed) {
    return {
      claimed: false,
      occurrenceKey,
      attempts: claim.attempts,
      previousStatus: claim.run_status,
    }
  }

  let outcome: CronTaskOutcome<T>
  try {
    outcome = await options.task()
  } catch (error) {
    const message = safeError(error)
    outcome = {
      status: "failed",
      payload: { error: message } as unknown as T,
      summary: `Excepción no controlada: ${message}`,
    }
  }

  const completion = await supabase.rpc("complete_cron_run", {
    p_job_name: options.jobName,
    p_occurrence_key: occurrenceKey,
    p_claim_token: claimToken,
    p_status: outcome.status,
    p_result_summary: outcome.summary,
  })
  if (completion.error) throw new Error(`cron_completion_failed: ${completion.error.message}`)
  if (completion.data !== true) throw new Error("cron_completion_lost_lease")

  return {
    claimed: true,
    occurrenceKey,
    attempts: claim.attempts,
    outcome,
  }
}

export async function handleCronRequest<T extends object>(
  request: Request,
  options: {
    jobName: CronJobName
    leaseSeconds?: number
    task: (supabase: SupabaseClient, now: Date) => Promise<CronTaskOutcome<T>>
  }
) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  try {
    const supabase = getServiceDb()
    const execution = await executeCronTask(supabase, {
      jobName: options.jobName,
      now,
      leaseSeconds: options.leaseSeconds,
      task: () => options.task(supabase, now),
    })

    if (!execution.claimed) {
      return NextResponse.json({
        ok: true,
        cron: {
          job: options.jobName,
          occurrence: execution.occurrenceKey,
          status: execution.previousStatus === "running" ? "skipped_running" : "skipped_completed",
          attempts: execution.attempts,
        },
      })
    }

    const outcome = execution.outcome as CronTaskOutcome<T>
    if (outcome.status !== "succeeded" && (execution.attempts === 1 || outcome.status === "warning")) {
      await sendCronFailureAlert(options.jobName, outcome.summary)
    }
    return NextResponse.json({
      ...outcome.payload,
      cron: {
        job: options.jobName,
        occurrence: execution.occurrenceKey,
        status: outcome.status,
        attempts: execution.attempts,
      },
    }, { status: outcome.status === "failed" ? 500 : 200 })
  } catch (error) {
    const message = safeError(error)
    await sendCronFailureAlert(options.jobName, `Fallo del coordinador: ${message}`)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
