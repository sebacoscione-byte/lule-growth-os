-- ============================================================
-- Migración: límite de tamaño explícito para content-media (soporte de video de reels)
--
-- content-media (creado en 20260702_instagram_content_media.sql) nunca tuvo file_size_limit propio
-- -- alcanzaba con el default del proyecto porque solo se subían placas (imágenes, tope de 8MB del
-- lado de la app en /api/content/upload-image). Los reels ahora permiten subir un video real
-- (/api/content/upload-video, subida directa del navegador a Storage vía signed upload URL, sin pasar
-- por una función de Vercel) -- un clip corto (hasta 60s, ver reel_duration_seconds) puede pesar mucho
-- más que una imagen. Se fija un tope explícito de 100MB, con margen de sobra para un reel corto y
-- muy por debajo de cualquier límite real de Instagram, sin afectar las imágenes existentes (mucho
-- más chicas que este tope).
-- ============================================================

update storage.buckets
set file_size_limit = 104857600 -- 100 MB
where id = 'content-media';
