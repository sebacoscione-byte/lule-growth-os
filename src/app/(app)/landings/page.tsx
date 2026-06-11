import Link from "next/link"
import { ExternalLink, Copy } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

const LANDINGS = [
  {
    slug: "dra-lucia-chahin",
    title: "Dra. Lucía Chahin",
    h1: "Dra. Lucía Chahin — Cardióloga",
    description: "Landing principal de la Dra. Lucía Chahin",
    seo_keywords: ["dra lucia chahin", "cardióloga lucia chahin"],
    priority: "alta",
  },
  {
    slug: "cardiologa-lanus",
    title: "Cardióloga en Lanús",
    h1: "Cardióloga en Lanús — Dra. Lucía Chahin",
    description: "Para búsquedas de cardióloga en Lanús",
    seo_keywords: ["cardióloga lanús", "cardiólogo lanús", "cardiología lanús"],
    priority: "alta",
  },
  {
    slug: "cardiologa-lomas",
    title: "Cardióloga en Lomas de Zamora",
    h1: "Cardióloga en Lomas de Zamora — Dra. Lucía Chahin",
    description: "Para búsquedas de cardióloga en Lomas",
    seo_keywords: ["cardióloga lomas", "cardióloga lomas de zamora"],
    priority: "alta",
  },
  {
    slug: "ecocardiograma-lanus",
    title: "Ecocardiograma en Lanús",
    h1: "Ecocardiograma en Lanús — Dra. Lucía Chahin",
    description: "Para búsquedas de ecocardiograma en Lanús",
    seo_keywords: ["ecocardiograma lanús", "ecocardiograma en lanús"],
    priority: "alta",
  },
  {
    slug: "ecocardiograma-lomas",
    title: "Ecocardiograma en Lomas de Zamora",
    h1: "Ecocardiograma en Lomas de Zamora — Dra. Lucía Chahin",
    description: "Para búsquedas de ecocardiograma en Lomas",
    seo_keywords: ["ecocardiograma lomas", "ecocardiograma lomas de zamora"],
    priority: "media",
  },
  {
    slug: "consulta-cardiologica-lanus",
    title: "Consulta Cardiológica Lanús",
    h1: "Consulta Cardiológica en Lanús — Dra. Lucía Chahin",
    description: "Para búsquedas de consulta cardiológica en Lanús",
    seo_keywords: ["consulta cardiológica lanús", "consulta cardio lanús"],
    priority: "media",
  },
  {
    slug: "consulta-cardiologica-lomas",
    title: "Consulta Cardiológica Lomas",
    h1: "Consulta Cardiológica en Lomas — Dra. Lucía Chahin",
    description: "Para búsquedas de consulta cardiológica en Lomas",
    seo_keywords: ["consulta cardiológica lomas", "consulta cardio lomas"],
    priority: "media",
  },
]

export default function LandingsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Landing Pages</h1>
        <p className="text-sm text-gray-500">Páginas SEO local para captación de tráfico orgánico</p>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <p className="font-medium mb-1">Cómo funcionan las landings</p>
        <p>Cada landing está disponible en <code className="bg-blue-100 px-1 rounded">/landings/[slug]</code> y está optimizada para una búsqueda SEO local específica. Son páginas públicas que no requieren login.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {LANDINGS.map((landing) => (
          <Card key={landing.slug}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{landing.title}</CardTitle>
                <Badge variant={landing.priority === "alta" ? "default" : "secondary"}>
                  {landing.priority}
                </Badge>
              </div>
              <p className="text-xs text-gray-500">{landing.description}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded bg-gray-50 p-2">
                <p className="text-xs text-gray-500 mb-1">H1</p>
                <p className="text-sm font-medium text-gray-900">{landing.h1}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Keywords SEO</p>
                <div className="flex flex-wrap gap-1">
                  {landing.seo_keywords.map(kw => (
                    <span key={kw} className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">{kw}</span>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Link href={`/landings/${landing.slug}`} target="_blank" className="flex-1">
                  <Button variant="outline" size="sm" className="w-full">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Ver landing
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
