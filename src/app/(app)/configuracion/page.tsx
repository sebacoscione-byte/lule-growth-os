"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  MapPin, Heart, Settings, Pencil, Check, X, Plus, Trash2,
  Loader2, Clock, Link2, Phone, Stethoscope, Shield,
} from "lucide-react"

type Doctor = {
  name: string
  specialty: string
  bio: string
  matricula: string
}

type Location = {
  id: string
  name: string
  address: string
  google_maps_link: string
  phone: string
  hours: string
  practices: string[]
  obras_sociales: string[]
  booking_instruction: string
  notes: string
}

const DEFAULT_LOCATION: Omit<Location, "id" | "name"> = {
  address: "",
  google_maps_link: "",
  phone: "",
  hours: "",
  practices: [],
  obras_sociales: [],
  booking_instruction: "",
  notes: "",
}

export default function ConfiguracionPage() {
  const [doctor, setDoctor] = useState<Doctor | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const [editingDoctor, setEditingDoctor] = useState(false)
  const [doctorDraft, setDoctorDraft] = useState<Doctor | null>(null)

  const [editingLocationId, setEditingLocationId] = useState<string | null>(null)
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
    setTimeout(() => setSaved(null), 2500)
  }

  // ── Doctor ──────────────────────────────────────────────
  function startEditDoctor() {
    setDoctorDraft(doctor
      ? { ...doctor }
      : { name: "", specialty: "", bio: "", matricula: "" }
    )
    setEditingDoctor(true)
  }

  async function saveDoctor() {
    if (!doctorDraft) return
    setDoctor(doctorDraft)
    setEditingDoctor(false)
    await saveConfig("doctor", doctorDraft)
  }

  // ── Locations ───────────────────────────────────────────
  function startEditLocation(loc: Location) {
    setLocationDraft({
      ...DEFAULT_LOCATION,
      ...loc,
      practices: [...(loc.practices ?? [])],
      obras_sociales: [...(loc.obras_sociales ?? [])],
    })
    setEditingLocationId(loc.id)
  }

  async function saveLocation() {
    if (!locationDraft) return
    const updated = locations.map(l => l.id === locationDraft.id ? locationDraft : l)
    setLocations(updated)
    setEditingLocationId(null)
    await saveConfig("locations", updated)
  }

  function addLocation() {
    const newLoc: Location = {
      id: crypto.randomUUID(),
      name: "Nueva institución",
      ...DEFAULT_LOCATION,
    }
    const updated = [...locations, newLoc]
    setLocations(updated)
    startEditLocation(newLoc)
  }

  async function deleteLocation(id: string) {
    const updated = locations.filter(l => l.id !== id)
    setLocations(updated)
    if (editingLocationId === id) setEditingLocationId(null)
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
          <p className="text-sm text-gray-500">Datos usados para publicaciones e información a pacientes</p>
        </div>
      </div>

      {/* ── Datos de la doctora ─────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Heart className="h-4 w-4 text-rose-500" /> Datos de la doctora
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
              <Field label="Nombre completo">
                <Input value={doctorDraft.name} onChange={e => setDoctorDraft({ ...doctorDraft, name: e.target.value })} placeholder="Dra. Lucía Chahin" />
              </Field>
              <Field label="Especialidad">
                <Input value={doctorDraft.specialty} onChange={e => setDoctorDraft({ ...doctorDraft, specialty: e.target.value })} placeholder="Cardiología" />
              </Field>
              <Field label="Matrícula">
                <Input value={doctorDraft.matricula} onChange={e => setDoctorDraft({ ...doctorDraft, matricula: e.target.value })} placeholder="MP 12345 / MN 67890" />
              </Field>
              <Field label="Bio (para publicaciones)">
                <textarea
                  value={doctorDraft.bio}
                  onChange={e => setDoctorDraft({ ...doctorDraft, bio: e.target.value })}
                  rows={3}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Cardióloga con X años de experiencia, especializada en..."
                />
              </Field>
              <SaveCancel saving={saving} onSave={saveDoctor} onCancel={() => setEditingDoctor(false)} />
            </>
          ) : doctor ? (
            <div className="space-y-2">
              <Row label="Nombre" value={doctor.name} />
              <Row label="Especialidad" value={doctor.specialty} />
              {doctor.matricula && <Row label="Matrícula" value={doctor.matricula} />}
              {doctor.bio && (
                <div className="text-sm">
                  <span className="text-gray-500">Bio: </span>
                  <span className="text-gray-900">{doctor.bio}</span>
                </div>
              )}
              {saved === "doctor" && <p className="text-xs text-green-600 font-medium">Guardado</p>}
            </div>
          ) : (
            <p className="text-sm text-gray-400">Sin datos. Tocá el lápiz para cargar.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Instituciones ────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-700 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-500" /> Lugares de atención
          </h2>
          <Button variant="outline" size="sm" onClick={addLocation}>
            <Plus className="h-4 w-4 mr-1" /> Agregar lugar
          </Button>
        </div>

        {locations.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6">
            No hay lugares cargados todavía. Usá el botón para agregar.
          </p>
        )}

        {locations.map((loc) => (
          <Card key={loc.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{loc.name}</CardTitle>
                {editingLocationId !== loc.id && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => startEditLocation(loc)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteLocation(loc.id)}>
                      <Trash2 className="h-4 w-4 text-red-400" />
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {editingLocationId === loc.id && locationDraft ? (
                <div className="space-y-4">
                  {/* Datos básicos */}
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Datos básicos</p>
                    <Field label="Nombre institución">
                      <Input value={locationDraft.name} onChange={e => setLocationDraft({ ...locationDraft, name: e.target.value })} />
                    </Field>
                    <Field label="Dirección">
                      <Input value={locationDraft.address} onChange={e => setLocationDraft({ ...locationDraft, address: e.target.value })} placeholder="Tucumán 1314, Lanús" />
                    </Field>
                    <Field label="Link Google Maps">
                      <Input value={locationDraft.google_maps_link} onChange={e => setLocationDraft({ ...locationDraft, google_maps_link: e.target.value })} placeholder="https://maps.google.com/..." />
                    </Field>
                    <Field label="Teléfono para turnos">
                      <Input value={locationDraft.phone} onChange={e => setLocationDraft({ ...locationDraft, phone: e.target.value })} placeholder="011 4xxx-xxxx" />
                    </Field>
                    <Field label="Días y horarios">
                      <textarea
                        value={locationDraft.hours}
                        onChange={e => setLocationDraft({ ...locationDraft, hours: e.target.value })}
                        rows={2}
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Martes 9:00 a 13:00hs&#10;Jueves 14:00 a 18:00hs"
                      />
                    </Field>
                  </div>

                  {/* Prácticas */}
                  <div className="space-y-3 border-t pt-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
                      <Stethoscope className="h-3 w-3" /> Prácticas que se realizan
                    </p>
                    <StringList
                      items={locationDraft.practices}
                      onChange={practices => setLocationDraft({ ...locationDraft, practices })}
                      placeholder="Ej: Ecocardiograma"
                      addLabel="Agregar práctica"
                    />
                  </div>

                  {/* Obras sociales */}
                  <div className="space-y-3 border-t pt-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
                      <Shield className="h-3 w-3" /> Obras sociales / prepagas que atiende
                    </p>
                    <StringList
                      items={locationDraft.obras_sociales}
                      onChange={obras_sociales => setLocationDraft({ ...locationDraft, obras_sociales })}
                      placeholder="Ej: OSDE, Swiss Medical, PAMI..."
                      addLabel="Agregar cobertura"
                    />
                  </div>

                  {/* Instrucción y notas */}
                  <div className="space-y-3 border-t pt-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Texto para pacientes</p>
                    <Field label="Instrucción para pedir turno">
                      <textarea
                        value={locationDraft.booking_instruction}
                        onChange={e => setLocationDraft({ ...locationDraft, booking_instruction: e.target.value })}
                        rows={3}
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Para sacar turno en CIMEL Lanús llamá al..."
                      />
                    </Field>
                    <Field label="Notas adicionales (opcional)">
                      <textarea
                        value={locationDraft.notes}
                        onChange={e => setLocationDraft({ ...locationDraft, notes: e.target.value })}
                        rows={2}
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Info extra: estacionamiento, accesibilidad, etc."
                      />
                    </Field>
                  </div>

                  <SaveCancel saving={saving} onSave={saveLocation} onCancel={() => setEditingLocationId(null)} />
                </div>
              ) : (
                <div className="space-y-3 text-sm">
                  {loc.address && (
                    <InfoRow icon={<MapPin className="h-3.5 w-3.5 text-gray-400" />} label="Dirección" value={loc.address} />
                  )}
                  {loc.hours && (
                    <InfoRow icon={<Clock className="h-3.5 w-3.5 text-gray-400" />} label="Horarios" value={loc.hours} pre />
                  )}
                  {loc.phone && (
                    <InfoRow icon={<Phone className="h-3.5 w-3.5 text-gray-400" />} label="Teléfono" value={loc.phone} />
                  )}
                  {loc.google_maps_link && (
                    <div className="flex items-start gap-2">
                      <Link2 className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-gray-500">Google Maps</p>
                        <a href={loc.google_maps_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline break-all">
                          Ver en mapa
                        </a>
                      </div>
                    </div>
                  )}
                  {loc.practices?.length > 0 && (
                    <div className="flex items-start gap-2">
                      <Stethoscope className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-gray-500 mb-1">Prácticas</p>
                        <div className="flex flex-wrap gap-1">
                          {loc.practices.map(p => (
                            <span key={p} className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">{p}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {loc.obras_sociales?.length > 0 && (
                    <div className="flex items-start gap-2">
                      <Shield className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-gray-500 mb-1">Obras sociales / prepagas</p>
                        <div className="flex flex-wrap gap-1">
                          {loc.obras_sociales.map(o => (
                            <span key={o} className="bg-green-50 text-green-700 text-xs px-2 py-0.5 rounded-full">{o}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {loc.booking_instruction && (
                    <div className="bg-gray-50 rounded-md p-3 text-gray-800 text-xs">
                      {loc.booking_instruction}
                    </div>
                  )}
                  {loc.notes && (
                    <p className="text-gray-500 text-xs italic">{loc.notes}</p>
                  )}
                  {saved === "locations" && <p className="text-xs text-green-600 font-medium">Guardado</p>}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ── Componentes auxiliares ────────────────────────────────

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
      <label className="text-xs text-gray-500 font-medium">{label}</label>
      {children}
    </div>
  )
}

function InfoRow({ icon, label, value, pre }: { icon: React.ReactNode; label: string; value: string; pre?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="text-gray-500">{label}</p>
        <p className={`text-gray-900 ${pre ? "whitespace-pre-line" : ""}`}>{value}</p>
      </div>
    </div>
  )
}

function StringList({
  items, onChange, placeholder, addLabel,
}: {
  items: string[]
  onChange: (items: string[]) => void
  placeholder: string
  addLabel: string
}) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={item}
            onChange={e => {
              const next = [...items]
              next[i] = e.target.value
              onChange(next)
            }}
            placeholder={placeholder}
          />
          <Button variant="ghost" size="sm" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4 text-red-400" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...items, ""])}>
        <Plus className="h-4 w-4 mr-1" /> {addLabel}
      </Button>
    </div>
  )
}

function SaveCancel({ saving, onSave, onCancel }: { saving: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="flex gap-2 pt-2">
      <Button size="sm" onClick={onSave} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
        Guardar
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        <X className="h-4 w-4 mr-1" /> Cancelar
      </Button>
    </div>
  )
}
