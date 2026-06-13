# En progreso - Reparacion de respuestas JSON de IA

## Objetivo

Aceptar respuestas de Gemini que contienen comillas sin escapar dentro de los textos.

## Brechas encontradas

- Gemini puede devolver frases como `"vuelco"` o `"raro"` sin escapar las comillas.
- Esas respuestas parecen JSON, pero `JSON.parse` las rechaza y el usuario no puede guardar el borrador.

## Plan

- [x] Implementar un parser tolerante que preserve el intento de la respuesta.
- [x] Reforzar los prompts para pedir comillas escapadas.
- [x] Verificar, documentar, commitear y pushear.

## Resultado

- El pegado acepta JSON valido sin modificarlo.
- Si Gemini deja comillas internas sin escapar o saltos de linea crudos, la app intenta repararlos antes de rechazar la respuesta.
- El mismo parser tolerante protege las respuestas recibidas por API.
- Los prompts piden explicitamente escapar comillas internas.
- Se verifico un caso equivalente con `"vuelco"` y `"raro", da...`.
- `npm run lint` y `npm run build` finalizaron correctamente.
