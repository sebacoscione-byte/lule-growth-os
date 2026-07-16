import { redirect } from "next/navigation"
import { MfaFlow } from "@/components/auth/mfa-flow"
import { getStaffSecurityPolicy, roleFromAppMetadata } from "@/lib/staff-authz"
import { safeMfaNextPath, staffRoleLabel } from "@/lib/staff-mfa"
import { createClient } from "@/lib/supabase/server"

export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; manage?: string | string[] }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const params = await searchParams
  const nextValue = Array.isArray(params.next) ? params.next[0] : params.next
  const manageValue = Array.isArray(params.manage) ? params.manage[0] : params.manage
  let policyRequiresMfa = true
  let policyAvailable = true

  try {
    const policy = await getStaffSecurityPolicy()
    policyRequiresMfa = policy.require_mfa_for_sensitive_actions
  } catch {
    policyAvailable = false
  }

  return (
    <MfaFlow
      email={user.email ?? "Cuenta autenticada"}
      roleLabel={staffRoleLabel(roleFromAppMetadata(user))}
      nextPath={safeMfaNextPath(nextValue)}
      manage={manageValue === "1"}
      policyRequiresMfa={policyRequiresMfa}
      policyAvailable={policyAvailable}
    />
  )
}
