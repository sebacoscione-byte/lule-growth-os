import { sendCronFailureAlert } from "./alert-email"

describe("sendCronFailureAlert", () => {
  const originalEnv = { ...process.env }
  const originalFetch = global.fetch

  afterEach(() => {
    process.env = { ...originalEnv }
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it("no llama a fetch (fail-open) si falta RESEND_API_KEY", async () => {
    delete process.env.RESEND_API_KEY
    process.env.ALERT_EMAIL_TO = "seba@example.com"
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(sendCronFailureAlert("publish-content", "algo falló")).resolves.toBe(false)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("no llama a fetch (fail-open) si falta ALERT_EMAIL_TO", async () => {
    process.env.RESEND_API_KEY = "re_test_key"
    delete process.env.ALERT_EMAIL_TO
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(sendCronFailureAlert("publish-content", "algo falló")).resolves.toBe(false)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("llama a la API de Resend con el asunto y destinatario correctos cuando está configurado", async () => {
    process.env.RESEND_API_KEY = "re_test_key"
    process.env.ALERT_EMAIL_TO = "seba@example.com"
    const fetchMock = jest.fn().mockResolvedValue({ ok: true })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(sendCronFailureAlert("weekly-report", "el upsert falló")).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.resend.com/emails")
    expect(init.headers.Authorization).toBe("Bearer re_test_key")
    const body = JSON.parse(init.body)
    expect(body.to).toBe("seba@example.com")
    expect(body.subject).toContain("weekly-report")
    expect(body.text).toBe("el upsert falló")
    expect(init.signal).toBeDefined()
  })

  it("no lanza si la llamada a fetch falla", async () => {
    process.env.RESEND_API_KEY = "re_test_key"
    process.env.ALERT_EMAIL_TO = "seba@example.com"
    global.fetch = jest.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch

    await expect(sendCronFailureAlert("publish-content", "algo falló")).resolves.toBe(false)
  })

  it("no confirma una alerta si Resend responde sin 2xx", async () => {
    process.env.RESEND_API_KEY = "re_test_key"
    process.env.ALERT_EMAIL_TO = "seba@example.com"
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch

    await expect(sendCronFailureAlert("publish-content", "algo falló")).resolves.toBe(false)
  })
})
