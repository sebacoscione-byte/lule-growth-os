import { buildReferralLandingFunnels } from "@/lib/referral-funnel"

describe("referral funnel", () => {
  it("muestra las visitas de una landing una sola vez y desglosa el avance por sede", () => {
    const rows = buildReferralLandingFunnels([
      { slug: "dra-lucia-chahin", location_key: null, event_type: "page_view", event_count: 152 },
      { slug: "dra-lucia-chahin", location_key: "britanico", event_type: "click_whatsapp", event_count: 2 },
      { slug: "dra-lucia-chahin", location_key: "swiss", event_type: "click_whatsapp", event_count: 1 },
    ], [
      { utm_content: "CABA-GRAL-01", confirmed_booked: false },
    ])

    const general = rows.find(row => row.landingSlug === "dra-lucia-chahin")
    expect(general).toMatchObject({ visits: 152, whatsappClicks: 3, leads: 1, confirmed: 0 })
    expect(general?.destinations).toHaveLength(3)
    expect(general?.destinations.find(row => row.code === "CABA-GRAL-01")).toMatchObject({
      whatsappClicks: 2,
      leads: 1,
    })
  })

  it("normaliza los códigos de leads antes de atribuirlos", () => {
    const rows = buildReferralLandingFunnels([], [
      { utm_content: "lan-card-01", confirmed_booked: true },
    ])
    expect(rows.find(row => row.landingSlug === "cardiologa-lanus")).toMatchObject({
      leads: 1,
      confirmed: 1,
    })
  })
})
