import { PUBLIC_LANDING_SLUGS } from "@/lib/public-landings"
import LandingPage, { generateMetadata } from "../landings/[slug]/page"

export { generateMetadata }

export function generateStaticParams() {
  return PUBLIC_LANDING_SLUGS.map((slug) => ({ slug }))
}

export default LandingPage
