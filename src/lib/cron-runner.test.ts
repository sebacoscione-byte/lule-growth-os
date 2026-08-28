import type { SupabaseClient } from "@supabase/supabase-js"
import { cronOccurrenceKey, executeCronTask } from "@/lib/cron-runner"

function supabaseWithRpc(responses: Array<{ data: unknown; error: null | { message: string } }>) {
  const rpc = jest.fn()
  for (const response of responses) rpc.mockResolvedValueOnce(response)
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

describe("cronOccurrenceKey", () => {
  it("usa el día civil argentino alrededor de medianoche UTC", () => {
    expect(cronOccurrenceKey(new Date("2026-08-28T02:30:00.000Z"))).toBe("2026-08-27")
    expect(cronOccurrenceKey(new Date("2026-08-28T03:00:00.000Z"))).toBe("2026-08-28")
  })
})
describe("executeCronTask", () => {
  const now = new Date("2026-08-28T15:00:00.000Z")

  it("reclama y completa una corrida exitosa", async () => {
    const { client, rpc } = supabaseWithRpc([
      { data: [{ claimed: true, run_status: "running", attempts: 1 }], error: null },
      { data: true, error: null },
    ])
    const task = jest.fn().mockResolvedValue({ status: "succeeded", payload: { ok: true }, summary: "ok" })

    const result = await executeCronTask(client, { jobName: "daily-maintenance", now, task })

    expect(result.claimed).toBe(true)
    expect(task).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenNthCalledWith(1, "claim_cron_run", expect.objectContaining({
      p_job_name: "daily-maintenance",
      p_occurrence_key: "2026-08-28",
    }))
    expect(rpc).toHaveBeenNthCalledWith(2, "complete_cron_run", expect.objectContaining({
      p_status: "succeeded",
      p_result_summary: "ok",
    }))
  })

  it("no ejecuta dos veces una ocurrencia ya completada", async () => {
    const { client, rpc } = supabaseWithRpc([
      { data: [{ claimed: false, run_status: "succeeded", attempts: 1 }], error: null },
    ])
    const task = jest.fn()

    const result = await executeCronTask(client, { jobName: "publish-feed", now, task })

    expect(result).toEqual(expect.objectContaining({ claimed: false, previousStatus: "succeeded" }))
    expect(task).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it("convierte una excepción en fallo reintentable y libera el lease", async () => {
    const { client, rpc } = supabaseWithRpc([
      { data: [{ claimed: true, run_status: "running", attempts: 2 }], error: null },
      { data: true, error: null },
    ])

    const result = await executeCronTask(client, {
      jobName: "auto-draft-content",
      now,
      task: async () => { throw new Error("provider_unavailable") },
    })

    expect(result.outcome).toEqual(expect.objectContaining({
      status: "failed",
      summary: expect.stringContaining("provider_unavailable"),
    }))
    expect(rpc).toHaveBeenNthCalledWith(2, "complete_cron_run", expect.objectContaining({ p_status: "failed" }))
  })

  it("no acepta que una ejecución vencida complete el claim de otra", async () => {
    const { client } = supabaseWithRpc([
      { data: [{ claimed: true, run_status: "running", attempts: 1 }], error: null },
      { data: false, error: null },
    ])

    await expect(executeCronTask(client, {
      jobName: "weekly-report",
      now,
      task: async () => ({ status: "succeeded", payload: { ok: true }, summary: "ok" }),
    })).rejects.toThrow("cron_completion_lost_lease")
  })
})
