-- Guarda el correo profesional como parte de la configuración interna de la doctora.
-- No lo publica en la landing ni lo vincula con las cuentas de acceso de Supabase Auth.

update app_config
set value = jsonb_set(
  coalesce(value, '{}'::jsonb),
  '{email}',
  to_jsonb('draluciachahin@gmail.com'::text),
  true
)
where key = 'doctor';

insert into app_config (key, value)
values ('doctor', jsonb_build_object('email', 'draluciachahin@gmail.com'))
on conflict (key) do nothing;
