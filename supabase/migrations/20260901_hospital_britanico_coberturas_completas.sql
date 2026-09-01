-- Sincroniza la cartilla oficial informada para Hospital Británico en la única fuente de
-- verdad consumida por Configuración, el bot administrativo y las landings públicas.
-- Las dos sedes físicas del Británico comparten esta institución/configuración.
update app_config
set value = (
  select jsonb_agg(
    case
      when location->>'id' = 'hospital_britanico' then
        jsonb_set(location, '{obras_sociales}', '[
          "AMFFA",
          "APM",
          "APSOT",
          "Asociación Argentina de Volantes",
          "Avalian (ex ACA Salud)",
          "Bristol Medicine",
          "Caja de Escribanos de Capital Federal",
          "CASA",
          "CEMIC",
          "COBER",
          "Colegio de Escribanos de la Provincia de Buenos Aires",
          "COMEI",
          "Conferencia Episcopal",
          "Corporación Médica Asistencial (General San Martín)",
          "DASU",
          "DASUTEN",
          "DOSEM",
          "Ensalud",
          "Experta ART",
          "Federación Patronal",
          "Federada Salud",
          "FEMECHACO",
          "Fideisalud – OS Capataces Estibadores Portuarios",
          "Fideisalud – OS Serenos de Buques",
          "Galeno ART",
          "Galeno",
          "Hospital Alemán",
          "Hospital Privado de la Comunidad",
          "Jerárquicos Salud",
          "La Segunda ART",
          "Medicals",
          "Medicus",
          "Medifé",
          "Meditar",
          "Ministerio de Salud del Gobierno de Chubut",
          "Obra Social de Futbolistas Agremiados",
          "Obra Social del Poder Judicial",
          "Luis Pasteur",
          "Obra Social del Personal de TV",
          "OSW Hope",
          "OS MITA",
          "OMINT",
          "OPDEA",
          "OS Personal de Farmacia",
          "OS Universidad Nacional del Sur",
          "OSDE",
          "OSDEPYM",
          "OSDIPP",
          "OSFFENTOS",
          "OSMECON Esteban Echeverría",
          "OSMECON Lomas",
          "OSMECON SAMI",
          "OSPAT (Personal de la Actividad del Turf)",
          "OSPAV",
          "OSPE",
          "OSPOCE",
          "OSPREM",
          "OSPTF",
          "PAMI (únicamente pacientes trasplantados o en lista de espera de trasplante hepático)",
          "Premedic",
          "Prevención ART",
          "Prevención Salud",
          "Programas de Salud",
          "Programas Médicos",
          "Provincia ART",
          "RAS",
          "San Francisco ART",
          "Sancor Salud",
          "Sanos Salud",
          "SEROS Chubut",
          "Solidez",
          "Swiss Medical"
        ]'::jsonb, true)
      else location
    end
    order by ordinal
  )
  from jsonb_array_elements(value) with ordinality as items(location, ordinal)
)
where key = 'locations'
  and jsonb_typeof(value) = 'array';
