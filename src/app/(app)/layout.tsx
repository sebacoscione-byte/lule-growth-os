import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Sidebar } from "@/components/sidebar"
import { SecurityUnavailable } from "@/components/auth/security-unavailable"
import { StaffAccessPending } from "@/components/auth/staff-access-pending"
import { getStaffSecurityPolicy, roleFromAppMetadata } from "@/lib/staff-authz"
import { getMfaGateDecision } from "@/lib/staff-mfa"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  let securityCheck: Awaited<ReturnType<typeof getStaffSecurityPolicy>>
  let assuranceCheck: Awaited<ReturnType<typeof supabase.auth.mfa.getAuthenticatorAssuranceLevel>>
  try {
    ;[securityCheck, assuranceCheck] = await Promise.all([
      getStaffSecurityPolicy(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ])
  } catch {
    return <SecurityUnavailable />
  }

  if (assuranceCheck.error) return <SecurityUnavailable />
  if (securityCheck.enforce_roles && !roleFromAppMetadata(user)) {
    return <StaffAccessPending />
  }
  const decision = getMfaGateDecision(
    assuranceCheck.data
      ? { currentLevel: assuranceCheck.data.currentLevel, nextLevel: assuranceCheck.data.nextLevel }
      : null,
    securityCheck.require_mfa_for_sensitive_actions
  )

  if (decision === "step_up" || decision === "setup") {
    redirect("/seguridad/mfa?next=/dashboard")
  }
  if (decision === "unavailable") return <SecurityUnavailable />

  return (
    <div className="flex h-dvh overflow-hidden bg-gray-50">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        {children}
      </main>
    </div>
  )
}
