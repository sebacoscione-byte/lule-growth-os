-- ============================================================
-- Migración: especializaciones y enfermedades tratadas de la doctora
-- Ejecutar en Supabase SQL Editor (o via npm run migrate)
-- ============================================================

-- Si ya existe la fila 'doctor', le agrega los campos nuevos sin pisar el resto.
update app_config
set value = value || jsonb_build_object(
  'specializations', '["Ecocardiografía", "Electrocardiografía", "Cardiología Adulto"]'::jsonb,
  'conditions_treated', '[
    "Angina de pecho", "Arritmias", "Desmayo", "Embolismo pulmonar", "Endocarditis",
    "Enfermedad de Chagas", "Enfermedad coronaria", "Enfermedad valvular",
    "Enfermedad de las arterias carótidas", "Espasmo arterial", "Hipertensión arterial",
    "Insuficiencia cardiaca", "Soplo cardiaco", "Infarto"
  ]'::jsonb
)
where key = 'doctor';

-- Si todavía no existe (instalación nueva), la crea con los datos completos.
insert into app_config (key, value) values
  ('doctor', '{
    "name": "Dra. Lucía Chahin",
    "specialty": "Cardiología",
    "services": ["Consulta cardiológica", "Ecocardiograma"],
    "specializations": ["Ecocardiografía", "Electrocardiografía", "Cardiología Adulto"],
    "conditions_treated": [
      "Angina de pecho", "Arritmias", "Desmayo", "Embolismo pulmonar", "Endocarditis",
      "Enfermedad de Chagas", "Enfermedad coronaria", "Enfermedad valvular",
      "Enfermedad de las arterias carótidas", "Espasmo arterial", "Hipertensión arterial",
      "Insuficiencia cardiaca", "Soplo cardiaco", "Infarto"
    ]
  }')
on conflict (key) do nothing;
