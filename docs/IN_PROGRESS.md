# En progreso - Proveedor IA configurable

## Objetivo

Permitir que toda la app use Google Gemini o Anthropic para:

- Generar contenido siempre en espanol.
- Clasificar leads y redactar respuestas administrativas.
- Generar publicaciones y respuestas para Google Business.
- Mostrar errores claros cuando falte una clave o un proveedor no tenga saldo.

## Brechas encontradas

- La app depende exclusivamente de Anthropic.
- Un saldo insuficiente de Anthropic se muestra como JSON tecnico en la interfaz.
- No hay una opcion para usar Gemini aunque ya existen integraciones de Google.
- Los prompts estan en espanol, pero no existe una instruccion global que fuerce el idioma.

## Plan

- [x] Auditar integracion IA y rutas que la utilizan.
- [x] Crear una capa IA comun con Gemini y Anthropic.
- [x] Forzar respuestas en espanol y agregar errores amigables.
- [x] Actualizar configuracion y documentacion.
- [x] Verificar, commitear y pushear.

## Resultado

- `src/lib/ai.ts` centraliza Gemini y Anthropic para contenido, clasificacion y respuestas.
- `AI_PROVIDER=auto` prioriza Gemini cuando existe `GEMINI_API_KEY` y permite fallback.
- Los prompts comparten una instruccion global de respuesta en espanol.
- Los errores de saldo, cuota, clave y modelo se muestran con mensajes accionables.
- La pantalla de Configuracion muestra el proveedor activo sin exponer secretos.
- `npm run lint` y `npm run build` finalizaron correctamente.
