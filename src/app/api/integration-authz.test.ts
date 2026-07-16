import { readFileSync } from "node:fs"
import { join } from "node:path"

function source(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), "utf8")
}

describe("autorización de integraciones y contenido", () => {
  const ownerSensitiveRoutes = [
    "src/app/api/google-business/auth/route.ts",
    "src/app/api/google-business/callback/route.ts",
    "src/app/api/google-business/disconnect/route.ts",
    "src/app/api/google-business/select-location/route.ts",
    "src/app/api/instagram-business/auth/route.ts",
    "src/app/api/instagram-business/callback/route.ts",
    "src/app/api/instagram-business/disconnect/route.ts",
  ]

  it.each(ownerSensitiveRoutes)("restringe OAuth/configuración a owner con MFA: %s", route => {
    const code = source(route)
    expect(code).toContain("authorizeStaff")
    expect(code).toMatch(/allowedRoles:\s*(GOOGLE|INSTAGRAM)_OAUTH_ROLES,\s*sensitive:\s*true/)
    expect(code).not.toContain("auth.getUser()")
  })

  const staffReadRoutes = [
    "src/app/api/google-business/status/route.ts",
    "src/app/api/google-business/locations/route.ts",
    "src/app/api/google-business/reviews/route.ts",
    "src/app/api/google-business/posts/route.ts",
    "src/app/api/google-business/profile/route.ts",
    "src/app/api/instagram-business/status/route.ts",
    "src/app/api/checklist/route.ts",
    "src/app/api/content/items/route.ts",
    "src/app/api/content/reorder/route.ts",
  ]

  it.each(staffReadRoutes)("autoriza por rol firmado a owner/doctor: %s", route => {
    const code = source(route)
    expect(code).toContain('const ')
    expect(code).toContain('["owner", "doctor"] as const')
    expect(code).toContain("authorizeStaff")
    expect(code).not.toContain("auth.getUser()")
  })

  const externalMutationRoutes = [
    "src/app/api/google-business/posts/route.ts",
    "src/app/api/google-business/posts/[postId]/route.ts",
    "src/app/api/google-business/profile/route.ts",
    "src/app/api/google-business/reviews/[reviewId]/reply/route.ts",
    "src/app/api/instagram-business/publish/route.ts",
    "src/app/api/content/publish-now/route.ts",
  ]

  it.each(externalMutationRoutes)("exige MFA para mutaciones externas: %s", route => {
    expect(source(route)).toMatch(/allowedRoles:\s*[A-Z_]+,\s*sensitive:\s*true/)
  })

  it("mantiene CRUD y orden del pipeline limitado a owner/doctor", () => {
    for (const route of [
      "src/app/api/content/items/route.ts",
      "src/app/api/content/reorder/route.ts",
    ]) {
      const code = source(route)
      expect(code).toContain('const CONTENT_ROLES = ["owner", "doctor"] as const')
      expect(code).toContain("allowedRoles: CONTENT_ROLES")
    }
  })
})
