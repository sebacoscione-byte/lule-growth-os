-- ============================================================
-- Migración 006: bucket publico para placas generadas + publicacion en Instagram
-- Ejecutar en Supabase SQL Editor
-- ============================================================

insert into storage.buckets (id, name, public)
values ('content-media', 'content-media', true)
on conflict (id) do nothing;

-- Solo el service role (usado por las rutas API del servidor) puede escribir.
create policy "service_role_write_content_media"
  on storage.objects for all to service_role
  using (bucket_id = 'content-media')
  with check (bucket_id = 'content-media');

-- Lectura publica: Instagram Graph API necesita bajar la imagen por URL publica.
create policy "public_read_content_media"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'content-media');
