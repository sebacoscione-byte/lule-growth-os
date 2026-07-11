import { toChronologicalContext } from "./conversation-context"

describe("toChronologicalContext", () => {
  it("invierte una tanda 'más nuevo primero' a orden cronológico", () => {
    const mostRecentFirst = [{ content: "3" }, { content: "2" }, { content: "1" }]
    expect(toChronologicalContext(mostRecentFirst)).toEqual([{ content: "1" }, { content: "2" }, { content: "3" }])
  })

  it("en una conversación larga, conserva el mensaje más reciente (no lo omite)", () => {
    // Simula .order(desc).limit(20) sobre una conversación de 25 mensajes: llegan los últimos
    // 20 (ids 25..6), más nuevo primero. El contexto para la IA debe terminar en el mensaje 25,
    // no en el 20 (que es lo que pasaba pidiendo los primeros 20 con .order(asc).limit(20)).
    const last20MostRecentFirst = Array.from({ length: 20 }, (_, i) => ({ id: 25 - i }))
    const context = toChronologicalContext(last20MostRecentFirst)
    expect(context[context.length - 1]).toEqual({ id: 25 })
    expect(context[0]).toEqual({ id: 6 })
    expect(context).toHaveLength(20)
  })

  it("no muta el array original", () => {
    const original = [{ content: "b" }, { content: "a" }]
    toChronologicalContext(original)
    expect(original).toEqual([{ content: "b" }, { content: "a" }])
  })

  it("devuelve vacío si no hay mensajes", () => {
    expect(toChronologicalContext([])).toEqual([])
  })
})
