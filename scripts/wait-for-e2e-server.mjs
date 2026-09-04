import { setTimeout } from "node:timers/promises"

// No descarga paquetes en el arranque de CI. El límite cubre también cada request.
const timeoutMs = Number(process.argv[2] ?? 60_000)
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error("El tiempo de espera debe ser un número positivo de milisegundos.")
  process.exit(1)
}

const deadline = Date.now() + timeoutMs
while (Date.now() < deadline) {
  try {
    const response = await fetch("http://localhost:3000", {
      method: "HEAD",
      signal: AbortSignal.timeout(Math.max(1, Math.min(2_000, deadline - Date.now()))),
    })
    if (response.ok) {
      console.log("Servidor E2E listo.")
      process.exit(0)
    }
  } catch {
    // El servidor todavía puede estar arrancando; reintentar dentro del mismo límite.
  }
  await setTimeout(Math.max(0, Math.min(500, deadline - Date.now())))
}

console.error("El servidor E2E no respondió correctamente dentro del tiempo de espera.")
process.exit(1)
