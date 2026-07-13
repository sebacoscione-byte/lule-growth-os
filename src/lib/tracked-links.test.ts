import {
  absoluteTrackedChannelUrl,
  isTrackedChannel,
  trackedChannelPath,
  trackedLandingDestination,
} from "@/lib/tracked-links"

describe("tracked links", () => {
  it("genera rutas cortas y estables para los perfiles", () => {
    expect(trackedChannelPath("instagram")).toBe("/go/instagram")
    expect(absoluteTrackedChannelUrl("https://draluciachahin.ar", "google"))
      .toBe("https://draluciachahin.ar/go/google")
  })

  it("atribuye cada canal con UTMs propias", () => {
    expect(trackedLandingDestination("instagram")).toContain("utm_source=instagram")
    expect(trackedLandingDestination("instagram")).toContain("utm_campaign=instagram_bio")
    expect(trackedLandingDestination("google")).toContain("utm_source=google_maps")
    expect(trackedLandingDestination("google")).toContain("utm_campaign=google_business_profile")
  })

  it("rechaza canales desconocidos", () => {
    expect(isTrackedChannel("google")).toBe(true)
    expect(isTrackedChannel("facebook")).toBe(false)
  })
})
