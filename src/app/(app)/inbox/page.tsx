"use client"

import { useEffect, useState, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { Send, Loader2, Sparkles, Users, ArrowLeft, CheckCircle2, XCircle } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { STATUS_LABELS, STATUS_COLORS, type Lead, type Message } from "@/types"
import { timeAgo, formatDate } from "@/lib/utils"

export default function InboxPage() {
  const searchParams = useSearchParams()
  const initialLeadId = searchParams.get("lead_id")

  const [leads, setLeads] = useState<Lead[]>([])
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(initialLeadId)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [closingAction, setClosingAction] = useState(false)
  const [autoReply, setAutoReply] = useState(true)
  const [suggesting, setSuggesting] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function loadLeads() {
      fetch("/api/leads")
        .then(r => r.json())
        .then(data => setLeads(Array.isArray(data) ? data : []))
    }
    loadLeads()
    // Refresco periódico: nuevos leads o mensajes entrantes deben aparecer sin recargar la página.
    const interval = setInterval(loadLeads, 20_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!selectedLeadId) return
    function loadMessages() {
      fetch(`/api/messages?lead_id=${selectedLeadId}`)
        .then(r => r.json())
        .then(data => setMessages(Array.isArray(data) ? data : []))
    }
    loadMessages()
    const interval = setInterval(loadMessages, 8_000)
    return () => clearInterval(interval)
  }, [selectedLeadId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const selectedLead = leads.find(l => l.id === selectedLeadId)
  const canSendWhatsApp = !!selectedLead?.phone && selectedLead?.origin_channel === "whatsapp"

  async function closeWithStatus(newStatus: "confirmo_que_pidio_turno" | "no_pudo_pedir_turno") {
    if (!selectedLeadId) return
    setClosingAction(true)
    const extra = newStatus === "confirmo_que_pidio_turno"
      ? { confirmed_booked: true }
      : { requires_human: true }
    await fetch(`/api/leads/${selectedLeadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus, ...extra }),
    })
    setLeads(prev => prev.map(l =>
      l.id === selectedLeadId ? { ...l, status: newStatus, ...extra } : l
    ))
    setClosingAction(false)
  }

  async function suggestMessage() {
    if (!selectedLeadId) return
    setSuggesting(true)
    const res = await fetch("/api/ai/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_id: selectedLeadId }),
    })
    const data = await res.json()
    if (data.suggestion) setInput(data.suggestion)
    setSuggesting(false)
  }

  async function sendMessage() {
    if (!input.trim() || !selectedLeadId) return
    setSending(true)

    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead_id: selectedLeadId,
        content: input,
        generate_reply: autoReply,
      }),
    })
    const data = await res.json()

    if (!res.ok) {
      alert(data.error ?? "No se pudo enviar el mensaje.")
      setSending(false)
      return
    }

    setMessages(prev => [
      ...prev,
      ...(data.user_message ? [data.user_message] : []),
      ...(data.assistant_message ? [data.assistant_message] : []),
    ])
    setInput("")
    setSending(false)
  }

  // En móvil: si hay lead seleccionado, muestra conversación; si no, lista
  const showConversationOnMobile = !!selectedLeadId

  return (
    <div className="flex h-full">
      {/* Lista de leads — full width en móvil cuando no hay lead seleccionado */}
      <aside className={`
        flex flex-col border-r border-gray-200 bg-white
        ${showConversationOnMobile ? "hidden md:flex" : "flex w-full"}
        md:flex md:w-72
      `}>
        <div className="p-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Inbox</h2>
          <p className="text-xs text-gray-500">{leads.length} leads</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {leads.length === 0 && (
            <div className="p-4 text-center text-gray-400 text-sm">Sin leads todavía</div>
          )}
          {leads.map((lead) => (
            <button
              key={lead.id}
              onClick={() => setSelectedLeadId(lead.id)}
              className={`w-full text-left p-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${selectedLeadId === lead.id ? "bg-blue-50 border-l-2 border-l-blue-600" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {lead.name ?? lead.instagram_username ?? lead.phone ?? "Anónimo"}
                </p>
                <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[lead.status]}`}>
                  {STATUS_LABELS[lead.status].split(" ")[0]}
                </span>
              </div>
              {lead.last_message && (
                <p className="text-xs text-gray-400 truncate mt-0.5">{lead.last_message}</p>
              )}
              <p className="text-xs text-gray-300 mt-0.5">{timeAgo(lead.created_at)}</p>
            </button>
          ))}
        </div>
      </aside>

      {/* Conversación — full width en móvil cuando hay lead seleccionado */}
      {!selectedLead ? (
        <div className="hidden md:flex flex-1 items-center justify-center text-gray-400">
          <div className="text-center">
            <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Seleccioná un lead para ver la conversación</p>
          </div>
        </div>
      ) : (
        <div className={`
          flex-1 flex flex-col
          ${showConversationOnMobile ? "flex" : "hidden md:flex"}
        `}>
          {/* Header con botón volver en móvil */}
          <div className="p-3 md:p-4 border-b border-gray-200 flex items-center gap-2">
            <button
              onClick={() => setSelectedLeadId(null)}
              className="md:hidden p-1 rounded-md hover:bg-gray-100"
            >
              <ArrowLeft className="h-5 w-5 text-gray-600" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 truncate text-sm md:text-base">
                {selectedLead.name ?? selectedLead.instagram_username ?? selectedLead.phone ?? "Anónimo"}
              </p>
              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[selectedLead.status]}`}>
                {STATUS_LABELS[selectedLead.status]}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
              {selectedLead.status !== "confirmo_que_pidio_turno" &&
               selectedLead.status !== "no_pudo_pedir_turno" &&
               selectedLead.status !== "descartado" &&
               selectedLead.status !== "spam" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-green-300 text-green-700 hover:bg-green-50 text-xs h-7 px-2"
                    disabled={closingAction}
                    onClick={() => closeWithStatus("confirmo_que_pidio_turno")}
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Ya pidió turno
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-300 text-red-700 hover:bg-red-50 text-xs h-7 px-2"
                    disabled={closingAction}
                    onClick={() => closeWithStatus("no_pudo_pedir_turno")}
                  >
                    <XCircle className="h-3 w-3 mr-1" />
                    No pudo
                  </Button>
                </>
              )}
              {!canSendWhatsApp && (
                <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoReply}
                    onChange={e => setAutoReply(e.target.checked)}
                    className="rounded"
                  />
                  <Sparkles className="h-3 w-3 text-blue-500" />
                  <span>IA</span>
                </label>
              )}
              <Link href={`/leads/${selectedLead.id}`}>
                <Button variant="outline" size="sm" className="text-xs h-7 px-2">Ver</Button>
              </Link>
            </div>
          </div>

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-3">
            {messages.length === 0 && (
              <p className="text-center text-gray-400 text-sm py-8">Sin mensajes todavía</p>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[85%] md:max-w-[75%] rounded-lg px-3 py-2 text-sm ${msg.role === "user" ? "bg-gray-100 text-gray-900" : "bg-blue-600 text-white"}`}>
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  <p className={`text-xs mt-1 ${msg.role === "user" ? "text-gray-400" : "text-blue-200"}`}>
                    {formatDate(msg.created_at)}
                  </p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="p-3 md:p-4 border-t border-gray-200 space-y-2">
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder="Escribí un mensaje..."
                disabled={sending}
              />
              <Button onClick={sendMessage} disabled={sending || !input.trim()}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-gray-400">
              {canSendWhatsApp
                ? "Se manda directo por WhatsApp al paciente."
                : "Este lead no tiene una conversación de WhatsApp real conectada acá — el mensaje queda solo como registro interno, no se manda a ningún lado automáticamente."}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 w-full"
              onClick={suggestMessage}
              disabled={suggesting || sending}
            >
              {suggesting
                ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Generando sugerencia...</>
                : <><Sparkles className="h-3 w-3 mr-1" /> Sugerir mensaje de seguimiento</>}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
