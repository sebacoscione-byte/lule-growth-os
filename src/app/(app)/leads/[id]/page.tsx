import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LeadStatusEditor } from "./lead-status-editor"
import {
  STATUS_LABELS, STATUS_COLORS, CHANNEL_LABELS, SERVICE_LABELS, LOCATION_LABELS,
  type Lead, type Message
} from "@/types"
import { formatDate } from "@/lib/utils"

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: lead }, { data: messages }] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).single(),
    supabase.from("messages").select("*").eq("lead_id", id).order("created_at", { ascending: true }),
  ])

  if (!lead) notFound()

  const l = lead as Lead
  const msgs = (messages ?? []) as Message[]

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/leads">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {l.name ?? l.instagram_username ?? l.phone ?? "Anónimo"}
          </h1>
          <p className="text-sm text-gray-500">Lead desde {CHANNEL_LABELS[l.origin_channel]} · {formatDate(l.created_at)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Info del lead */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Estado</CardTitle></CardHeader>
            <CardContent>
              <LeadStatusEditor leadId={l.id} currentStatus={l.status} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Datos del paciente</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {l.name && <Row label="Nombre" value={l.name} />}
              {l.phone && <Row label="Teléfono" value={l.phone} />}
              {l.instagram_username && <Row label="Instagram" value={`@${l.instagram_username}`} />}
              {l.insurance && <Row label="Cobertura" value={l.insurance} />}
              <Row label="Canal" value={CHANNEL_LABELS[l.origin_channel]} />
              {l.searched_keyword && <Row label="Búsqueda" value={l.searched_keyword} />}
              {l.origin_campaign && <Row label="Campaña" value={l.origin_campaign} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Intención</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Servicio" value={SERVICE_LABELS[l.requested_service]} />
              <Row label="Ubicación" value={LOCATION_LABELS[l.preferred_location] ?? l.preferred_location} />
              {l.preferred_day !== "sin_definir" && <Row label="Día" value={l.preferred_day} />}
              <Row label="Prioridad" value={String(l.priority_score)} />
              {l.possible_emergency && (
                <p className="text-red-600 font-medium">⚠️ Posible emergencia</p>
              )}
              {l.requires_human && (
                <p className="text-orange-600 font-medium">👤 Requiere humano</p>
              )}
              {l.confirmed_booked && (
                <p className="text-green-600 font-medium">✅ Confirmó turno</p>
              )}
            </CardContent>
          </Card>

          {l.ai_summary && (
            <Card>
              <CardHeader><CardTitle className="text-base">Resumen IA</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600">{l.ai_summary}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Conversación */}
        <div className="lg:col-span-2">
          <Card className="h-full flex flex-col">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">Conversación</CardTitle>
              <Link href={`/inbox?lead_id=${l.id}`}>
                <Button variant="outline" size="sm">Abrir en inbox</Button>
              </Link>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto max-h-[600px] space-y-3">
              {msgs.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Sin mensajes todavía</p>
              ) : (
                msgs.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === "user" ? "justify-start" : "justify-end"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-gray-100 text-gray-900"
                          : "bg-blue-600 text-white"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      <p className={`text-xs mt-1 ${msg.role === "user" ? "text-gray-400" : "text-blue-200"}`}>
                        {formatDate(msg.created_at)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-gray-900 text-right">{value}</span>
    </div>
  )
}
