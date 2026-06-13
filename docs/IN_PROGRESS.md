# En progreso - Guardado directo sin brief

## Objetivo

Permitir guardar una respuesta pegada aunque categoria y tema no se hayan completado en el brief.

## Brechas encontradas

- El ingreso directo construye `topic` solamente desde el brief.
- Con categoria y tema vacios, la API rechaza el borrador como incompleto.
- La interfaz reemplaza el error real de la API por un mensaje generico.

## Plan

- [x] Inferir tema y categoria desde el contenido pegado cuando falte el brief.
- [x] Mostrar el error real y conservar el contenido si guardar falla.
- [x] Verificar, documentar, commitear y pushear.

## Resultado

- El ingreso directo se puede usar con categoria y tema vacios.
- La pieza usa `visual_headline`, `hook` o un nombre generico como tema cuando falta el brief.
- La API aplica el mismo fallback para proteger clientes anteriores.
- Si guardar falla, se muestra el error real y el contenido pegado queda disponible para reintentar.
- `npm run lint` y `npm run build` finalizaron correctamente.
