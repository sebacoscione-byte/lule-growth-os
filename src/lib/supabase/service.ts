import { createClient } from "@supabase/supabase-js"

/** Cliente con service role, sin cookies — para código que corre fuera de un request autenticado (webhook, cron). */
export function getServiceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
