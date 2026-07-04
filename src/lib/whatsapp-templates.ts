import { getServiceDb } from "@/lib/supabase/service"
import type { WhatsAppTemplate } from "@/types"

export async function getApprovedTemplate(name: string): Promise<WhatsAppTemplate | null> {
  const db = getServiceDb()
  const { data } = await db
    .from("templates")
    .select("*")
    .eq("name", name)
    .eq("status", "aprobado")
    .maybeSingle()
  return (data as WhatsAppTemplate | null) ?? null
}

export function fillTemplateBody(template: WhatsAppTemplate, params: string[]): string {
  return template.variables.reduce<string>(
    (body, _variable, index) => body.replace(`{{${index + 1}}}`, params[index] ?? ""),
    template.body_text
  )
}
