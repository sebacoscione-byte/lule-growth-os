import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import type { ContentSource } from "@/types"

interface EuropePmcResult {
  title?: string
  journalTitle?: string
  journalInfo?: { journal?: { title?: string } }
  firstPublicationDate?: string
  doi?: string
  pmcid?: string
  abstractText?: string
}

const TOPIC_QUERIES: Record<string, string> = {
  "Consulta cardiologica": 'TITLE_ABS:"preventive cardiology"',
  Ecocardiograma: 'TITLE_ABS:"echocardiography"',
  "Presion arterial": 'TITLE_ABS:"blood pressure" AND TITLE_ABS:"cardiovascular"',
  Colesterol: 'TITLE_ABS:"cholesterol" AND TITLE_ABS:"cardiovascular"',
  Palpitaciones: 'TITLE_ABS:"palpitations" AND TITLE_ABS:"cardiology"',
  "Chequeo cardiovascular": 'TITLE_ABS:"cardiovascular risk" AND TITLE_ABS:"screening"',
  "Factores de riesgo": 'TITLE_ABS:"cardiovascular risk factors"',
}

function cleanText(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const topic = request.nextUrl.searchParams.get("topic")?.trim()
  if (!topic) return NextResponse.json({ error: "topic required" }, { status: 400 })

  const query = TOPIC_QUERIES[topic] ?? `TITLE_ABS:"${topic.replace(/"/g, "")}"`
  const today = new Date().toISOString().slice(0, 10)
  const params = new URLSearchParams({
    query: `${query} AND (PUB_TYPE:"review" OR PUB_TYPE:"meta-analysis") AND FIRST_PDATE:[2024-01-01 TO ${today}]`,
    format: "json",
    resultType: "core",
    pageSize: "20",
    sort: "FIRST_PDATE_D desc",
  })

  try {
    const response = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params}`, {
      next: { revalidate: 21600 },
    })
    if (!response.ok) throw new Error("No se pudieron consultar las fuentes")

    const data = await response.json() as { resultList?: { result?: EuropePmcResult[] } }
    const seen = new Set<string>()
    const sources: ContentSource[] = (data.resultList?.result ?? [])
      .filter(result => result.title && (result.doi || result.pmcid))
      .filter(result => {
        const title = cleanText(result.title!).toLowerCase()
        if (seen.has(title)) return false
        seen.add(title)
        return true
      })
      .map(result => ({
        title: cleanText(result.title!),
        url: result.doi
          ? `https://doi.org/${result.doi}`
          : `https://europepmc.org/articles/${result.pmcid}`,
        publication: result.journalTitle ?? result.journalInfo?.journal?.title ?? "Europe PMC",
        published_at: result.firstPublicationDate ?? "",
        summary: cleanText(result.abstractText ?? "").slice(0, 1200),
      }))

    return NextResponse.json({ sources })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error al buscar fuentes" },
      { status: 502 }
    )
  }
}
