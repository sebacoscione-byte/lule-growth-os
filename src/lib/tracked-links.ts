export const TRACKED_CHANNELS = ["instagram", "google"] as const
export const PUBLIC_SITE_ORIGIN = "https://draluciachahin.ar"

export type TrackedChannel = typeof TRACKED_CHANNELS[number]

const TRACKING_PARAMS: Record<TrackedChannel, Record<string, string>> = {
  instagram: {
    utm_source: "instagram",
    utm_medium: "organic_profile",
    utm_campaign: "instagram_bio",
  },
  google: {
    utm_source: "google_maps",
    utm_medium: "organic_profile",
    utm_campaign: "google_business_profile",
  },
}

export function isTrackedChannel(value: string): value is TrackedChannel {
  return (TRACKED_CHANNELS as readonly string[]).includes(value)
}

export function trackedChannelPath(channel: TrackedChannel): string {
  return `/go/${channel}`
}

export function trackedLandingDestination(channel: TrackedChannel): string {
  const params = new URLSearchParams(TRACKING_PARAMS[channel])
  return `/dra-lucia-chahin?${params.toString()}`
}

export function absoluteTrackedChannelUrl(origin: string, channel: TrackedChannel): string {
  return new URL(trackedChannelPath(channel), origin).toString()
}

export function productionTrackedChannelUrl(channel: TrackedChannel): string {
  return absoluteTrackedChannelUrl(PUBLIC_SITE_ORIGIN, channel)
}
