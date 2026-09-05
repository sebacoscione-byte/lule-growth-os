import { INSTAGRAM_OAUTH_SCOPES } from "./instagram-oauth"

describe("Instagram OAuth scopes", () => {
  it("solicita lectura de mensajes y comentarios sin perder publicación ni insights", () => {
    expect(INSTAGRAM_OAUTH_SCOPES).toEqual([
      "instagram_business_basic",
      "instagram_business_content_publish",
      "instagram_business_manage_insights",
      "instagram_business_manage_messages",
      "instagram_business_manage_comments",
    ])
    expect(new Set(INSTAGRAM_OAUTH_SCOPES).size).toBe(INSTAGRAM_OAUTH_SCOPES.length)
  })
})
