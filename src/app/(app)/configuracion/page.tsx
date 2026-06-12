"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MapPin, Heart, MessageSquare, Settings, Pencil, Check, X, Plus, Trash2, Loader2 } from "lucide-react"

type Doctor = {
  name: string
  specialty: string
  services: string[]
}

type Location = {
  id: string
  name: string
  address: string
  day: string
  services: string[]
  booking_instruction: string
}

export default function ConfiguracionPage() {
  const [doctor, setDoctor] = useState<Doctor | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [editingDoctor, setEditingDoctor] = useState(false)
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  // Draft states
  const [doctorDraft, setDoctorDraft] = useState<Doctor | null>(null)
  const [locationDraft, setLocationDraft] = useState<Location | null>(null)

  useEffect(() => {
    fetch("/api/config")
      .then(r => r.json())
      .then(data => {
        setDoctor(data.doctor ?? null)
        setLocations(data.locations ?? [])
        setLoading(false)
      })
  }, [])

  async function saveConfig(key: string, value: unknown) {
    setSaving(true)
    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    })
    setSaving(false)
    setSaved(key)
    setTimeout(() => setSaved(null), 2000)
  }

  function startEditDoctor() {
    setDoctorDraft(doctor ? { ...doctor, services: [...(doctor.services ?? [])] } : { name: "", specialty: "", services: [] })
    setEditingDoctor(true)
  }

  async function saveDoctor() {
    if (!doctorDraft) return
    setDoctor(doctorDraft)
    setEditingDoctor(false)
    await saveConfig("doctor", doctorDraft)
  }

  function startEditLocation(loc: Location) {
    setLocationDraft({ ...loc, services: [...loc.services] })
    setEditingLocationId(loc.id)
  }

  async function saveLocation() {
    if (!locationDraft) return
    const updated = locations.map(l => l.id === locationDraft.id ? locationDraft : l)
    setLocations(updated)
    setEditingLocationId(null)
    await saveConfig("locations", updated)
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-gray-700" />
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Configuración</h1>
          <p className="text-sm text-gray-500">Datos de la doctora e instituciones</p>
        </div>
      </div>

      {/* Datos de la doctora */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Heart className="h-4 w-4 text-rose-500" />
              Datos de la doctora
            </CardTitle>
            {!editingDoctor && (
              <Button variant="ghost" size="sm" onClick={startEditDoctor}>
                <Pencil className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {editingDoctor && doctorDraft ? (
            <>
              <Field label="Nombre">
                <Input
                  value={doctorDraft.name}
                  onChange={e => setDoctorDraft({ ...doctorDraft, name: e.target.value })}
                  placeholder="Dra. Lucía Chahin"
                />
              </Field>
              <Field label="Especialidad">
                <Input
                  value={doctorDraft.specialty}
                  onChange={e => setDoctorDraft({ ...doctorDraft, specialty: e.target.value })}
                  placeholder="Cardiología"
                />
              </Field>
              <Field label="Servicios">
                <div className="space-y-2">
                  {doctorDraft.services.map((s, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={s}
                        onChange={e => {
                          const services = [...doctorDraft.services]
                          services[i] = e.target.value
                          setDoctorDraft({ ...doctorDraft, services })
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const services = doctorDraft.services.filter((_, j) => j !== i)
                          setDoctorDraft({ ...doctorDraft, services })
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-red-400" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDoctorDraft({ ...doctorDraft, services: [...doctorDraft.services, ""] })}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Agregar servicio
                  </Button>
                </div>
              </Field>
              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={saveDoctor} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                  Guardar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditingDoctor(false)}>
                  <X className="h-4 w-4 mr-1" /> Cancelar
                </Button>
              </div>
            </>
          ) : doctor ? (
            <>
              <Row label="Nombre" value={doctor.name} />
              <Row label="Especialidad" value={doctor.specialty} />
              <div className="text-sm">
                <span className="text-gray-500">Servicios: </span>
                <span className="text-gray-900">{doctor.services?.join(", ")}</span>
              </div>
              {saved === "doctor" && <p className="text-xs text-green-600">Guardado</p>}
            </>
          ) : (
            <p className="text-sm text-gray-400">Sin datos. Hacé clic en editar para cargar.</p>
          )}
        </CardContent>
      </Card>

      {/* Instituciones */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-gray-700 flex items-center gap-2">
          <MapPin className="h-4 w-4 text-blue-500" />
          Instituciones de atención
        </h2>

        {locations.map((loc) => (
          <Card key={loc.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{loc.name}</CardTitle>
                {editingLocationId !== loc.id && (
                  <Button variant="ghost" size="sm" onClick={() => startEditLocation(loc)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {editingLocationId === loc.id && locationDraft ? (
                <>
                  <Field label="Nombre institución">
                    <Input
                      value={locationDraft.name}
                      onChange={e => setLocationDraft({ ...locationDraft, name: e.target.value })}
                    />
                  </Field>
                  <Field label="Dirección">
                    <Input
                      value={locationDraft.address}
                      onChange={e => setLocationDraft({ ...locationDraft, address: e.target.value })}
                    />
                  </Field>
                  <Field label="Día de atención">
                    <Input
                      value={locationDraft.day}
                      onChange={e => setLocationDraft({ ...locationDraft, day: e.target.value })}
                      placeholder="Ej: martes"
                    />
                  </Field>
                  <Field label="Servicios">
                    <div className="space-y-2">
                      {locationDraft.services.map((s, i) => (
                        <div key={i} className="flex gap-2">
                          <Input
                            value={s}
                            onChange={e => {
                              const services = [...locationDraft.services]
                              services[i] = e.target.value
                              setLocationDraft({ ...locationDraft, services })
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const services = locationDraft.services.filter((_, j) => j !== i)
                              setLocationDraft({ ...locationDraft, services })
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-red-400" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setLocationDraft({ ...locationDraft, services: [...locationDraft.services, ""] })}
                      >
                        <Plus className="h-4 w-4 mr-1" /> Agregar servicio
                      </Button>
                    </div>
                  </Field>
                  <Field label="Instrucción para pedir turno">
                    <textarea
                      value={locationDraft.booking_instruction}
                      onChange={e => setLocationDraft({ ...locationDraft, booking_instruction: e.target.value })}
                      rows={3}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Ej: Para pedir turno en CIMEL Lanús llamá al..."
                    />
                  </Field>
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" onClick={saveLocation} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                      Guardar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingLocationId(null)}>
                      <X className="h-4 w-4 mr-1" /> Cancelar
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  {loc.address && <Row label="Dirección" value={loc.address} />}
                  <Row label="Día de atención" value={loc.day} />
                  <div className="text-sm">
                    <span className="text-gray-500">Servicios: </span>
                    <span className="text-gray-900">{loc.services?.join(", ")}</span>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1 flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" /> Instrucción para pedir turno
                    </p>
                    <p className="text-sm text-gray-800 bg-gray-50 rounded p-3">{loc.booking_instruction}</p>
                  </div>
                  {saved === "locations" && <p className="text-xs text-green-600">Guardado</p>}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-gray-900 font-medium text-right">{value}</span>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm text-gray-500">{label}</label>
      {children}
    </div>
  )
}
