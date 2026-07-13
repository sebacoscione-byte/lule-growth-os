"use client"

import { useState } from "react"
import { Check, Copy, MousePointerClick } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { productionTrackedChannelUrl, type TrackedChannel } from "@/lib/tracked-links"

export function TrackedProfileLink({
  channel,
  title,
  description,
  onUse,
}: {
  channel: TrackedChannel
  title: string
  description: string
  onUse?: (url: string) => void
}) {
  const url = productionTrackedChannelUrl(channel)
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!url) return
    await navigator.clipboard.writeText(url).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <MousePointerClick className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
        <div>
          <p className="text-sm font-medium text-blue-950">{title}</p>
          <p className="text-xs leading-relaxed text-blue-700">{description}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={url} readOnly aria-label={title} className="bg-white text-xs" />
        <Button type="button" variant="outline" size="sm" onClick={copy} disabled={!url} className="gap-1.5 shrink-0">
          {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copiado" : "Copiar"}
        </Button>
        {onUse && (
          <Button type="button" size="sm" onClick={() => onUse(url)} disabled={!url} className="shrink-0">
            Usar enlace
          </Button>
        )}
      </div>
    </div>
  )
}
