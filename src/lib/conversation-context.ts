/**
 * A partir de una tanda de mensajes ordenada por fecha descendente (más nuevo primero — tal como
 * conviene pedirle a Supabase con `.order("created_at", { ascending: false }).limit(n)` para traer
 * los últimos N sin recorrer toda la tabla), arma el contexto que recibe la IA: los últimos N
 * mensajes en orden cronológico (más viejo primero).
 *
 * CRM-01 (docs/BACKLOG.md): antes se pedía `.order(asc).limit(n)`, que trae los primeros N
 * mensajes de toda la conversación en vez de los últimos — en una conversación de más de N
 * mensajes, la IA armaba la sugerencia con contexto viejo y sin ver el mensaje más reciente.
 */
export function toChronologicalContext<T>(mostRecentFirst: T[]): T[] {
  return [...mostRecentFirst].reverse()
}
