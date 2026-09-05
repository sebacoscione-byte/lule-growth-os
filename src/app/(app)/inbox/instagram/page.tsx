"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Camera, Loader2, MessageCircle, RefreshCw, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/utils"

interface InstagramInboxItem {
  id: string
  item_type: "message" | "comment"
  direction: "inbound" | "outbound"
  participant_username: string | null
  content: string | null
  attachment_type: string | null
  occurred_at: string
  source: "webhook" | "api_backfill" | "export"
}

export default function InstagramInboxPage() {
  const [items, setItems] = useState<InstagramInboxItem[]>([])
  const [filter, setFilter] = useState<"all" | "message" | "comment">("all")
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const suffix = filter === "all" ? "" : `?type=${filter}`
    const response = await fetch(`/api/instagram-business/inbox${suffix}`, { cache: "no-store" })
    const body = await response.json()
    if (response.ok) setItems(Array.isArray(body.items) ? body.items : [])
    else setNotice(body.error ?? "No se pudo leer Instagram")
    setLoading(false)
  }, [filter])

  useEffect(() => {
    const initial = setTimeout(load, 0)
    const interval = setInterval(load, 20_000)
    return () => {
      clearTimeout(initial)
      clearInterval(interval)
    }
  }, [load])

  async function sync() {
    setSyncing(true)
    setNotice(null)
    const response = await fetch("/api/instagram-business/inbox", { method: "POST" })
    const body = await response.json()
    if (response.ok) {
      setNotice(
        `Sincronización completa: ${body.messagesFound} mensajes y ${body.commentsFound} comentarios encontrados.`
      )
      await load()
    } else {
      setNotice(body.error ?? "No se pudo sincronizar Instagram")
    }
    setSyncing(false)
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col bg-white">
      <header className="border-b border-gray-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/inbox" aria-label="Volver al Inbox" className="rounded-md p-2 hover:bg-gray-100">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="flex items-center gap-2 font-semibold text-gray-900">
                <Camera className="h-5 w-5 text-pink-600" /> Inbox de Instagram
              </h1>
              <p className="text-xs text-gray-500">Lectura de DMs y comentarios · sin respuestas automáticas</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Sincronizar
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(["all", "message", "comment"] as const).map(value => (
            <button
              type="button"
              key={value}
              onClick={() => {
                setLoading(true)
                setFilter(value)
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                filter === value ? "bg-pink-100 text-pink-800" : "bg-gray-100 text-gray-600"
              }`}
            >
              {value === "all" ? "Todo" : value === "message" ? "Mensajes" : "Comentarios"}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-1 text-xs text-gray-500">
            <ShieldCheck className="h-3.5 w-3.5" /> Retención máxima: 90 días
          </span>
        </div>
        {notice && <p role="status" className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">{notice}</p>}
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        ) : items.length === 0 ? (
          <div className="mx-auto max-w-md py-16 text-center text-gray-500">
            <MessageCircle className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-medium text-gray-700">Todavía no hay elementos disponibles</p>
            <p className="mt-1 text-sm">La sincronización trae lo que Meta permite recuperar; los nuevos eventos llegarán por webhook.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map(item => (
              <li key={item.id} className="rounded-xl border border-gray-200 p-4 shadow-sm">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-1 font-medium ${
                    item.item_type === "message" ? "bg-violet-100 text-violet-800" : "bg-sky-100 text-sky-800"
                  }`}>
                    {item.item_type === "message" ? "DM" : "Comentario"}
                  </span>
                  <span className={`rounded-full px-2 py-1 ${
                    item.direction === "inbound" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                  }`}>
                    {item.direction === "inbound" ? "Recibido" : "Enviado"}
                  </span>
                  <span className="font-medium text-gray-700">
                    {item.participant_username ? `@${item.participant_username}` : "Cuenta de Instagram"}
                  </span>
                  <time className="ml-auto text-gray-400">{formatDate(item.occurred_at)}</time>
                </div>
                <p className="whitespace-pre-wrap text-sm text-gray-900">
                  {item.content || (item.attachment_type ? `[Adjunto: ${item.attachment_type}]` : "[Sin texto]")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
