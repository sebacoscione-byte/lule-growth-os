import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MapPin, Heart, MessageSquare, Settings } from "lucide-react"

export default async function ConfiguracionPage() {
  const supabase = await createClient()
  const { data: configs } = await supabase.from("app_config").select("*")

  const configMap: Record<string, unknown> = {}
  configs?.forEach((c: { key: string; value: unknown }) => {
    configMap[c.key] = c.value
  })

  const doctor = configMap.doctor as { name: string; specialty: string; services: string[] } | null
  const locations = configMap.locations as Array<{
    id: string; name: string; address?: string; day: string
    services: string[]; booking_instruction: string
  }> | null

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-6 w-6 text-gray-700" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Configuración</h1>
          <p className="text-sm text-gray-500">Datos de la doctora e instituciones</p>
        </div>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        Para modificar la configuración, editá directamente la tabla <code className="bg-blue-100 px-1 rounded">app_config</code> en Supabase o contactá al administrador.
      </div>

      {doctor && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Heart className="h-4 w-4 text-rose-500" />
              Datos de la doctora
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Row label="Nombre" value={doctor.name} />
            <Row label="Especialidad" value={doctor.specialty} />
            <div>
              <p className="text-sm text-gray-500 mb-1">Servicios</p>
              <div className="flex gap-2 flex-wrap">
                {doctor.services?.map((s: string) => (
                  <Badge key={s} variant="secondary">{s}</Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {locations && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-gray-700 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-500" />
            Instituciones de atención
          </h2>
          {locations.map((loc) => (
            <Card key={loc.id}>
              <CardHeader>
                <CardTitle className="text-base">{loc.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {loc.address && <Row label="Dirección" value={loc.address} />}
                <Row label="Día de atención" value={loc.day} />
                <div>
                  <p className="text-sm text-gray-500 mb-1">Servicios</p>
                  <div className="flex gap-2 flex-wrap">
                    {loc.services?.map((s: string) => (
                      <Badge key={s} variant="secondary">{s}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-1 flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" /> Instrucción para pedir turno
                  </p>
                  <p className="text-sm text-gray-800 bg-gray-50 rounded p-3">{loc.booking_instruction}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium">{value}</span>
    </div>
  )
}
