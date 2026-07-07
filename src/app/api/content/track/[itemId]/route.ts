import { NextRequest, NextResponse } from "next/server"
import { getServiceDb } from "@/lib/supabase/service"
import { readContentItems } from "@/lib/content-pipeline"

function slugifyCategory(category: string): string {
  const slug = category
    .toLowerCase()
    .normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "contenido"
}

// Link de seguimiento para una pieza del Estudio de contenido: redirige a la landing publica con
// utm_content=<itemId>, para poder saber cuantas visitas/interacciones genero esa pieza puntual
// (ver Biblioteca > "Link de seguimiento"). Instagram no permite links clickeables en posts de feed
// normales, asi que esto sirve sobre todo para historias (link sticker) o para pegar en la bio/Linktree.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await params
  const supabase = getServiceDb()
  const items = await readContentItems(supabase).catch(() => [])
  const item = items.find(existing => existing.id === itemId)
  const campaign = item ? slugifyCategory(item.category) : "contenido"

  const url = new URL("/dra-lucia-chahin", req.url)
  url.searchParams.set("utm_source", "instagram")
  url.searchParams.set("utm_medium", "organic_post")
  url.searchParams.set("utm_campaign", campaign)
  url.searchParams.set("utm_content", itemId)

  return NextResponse.redirect(url)
}
