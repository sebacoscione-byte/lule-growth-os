# En progreso - Diagnostico de Gemini Image

## Objetivo

Explicar y manejar correctamente los fallos de generacion automatica de placas.

## Brechas encontradas

- La clave configurada devuelve cuota gratuita `0` para los modelos de imagen de Gemini.
- La interfaz oculta ese dato bajo un error generico de proveedor.
- El payload agrega configuracion innecesaria frente al ejemplo REST oficial.

## Plan

- [x] Alinear la llamada REST con el flujo oficial de Gemini Image.
- [x] Mostrar un error especifico y accionable cuando no hay cuota de imagenes.
- [x] Verificar, documentar, commitear y pushear.

## Resultado

- Se probo la clave configurada contra `gemini-3.1-flash-image` y `gemini-2.5-flash-image`.
- Ambos modelos respondieron `429 RESOURCE_EXHAUSTED` porque la cuota gratuita de imagenes de la clave es `0`.
- La llamada REST usa ahora el payload basico recomendado por la documentacion oficial.
- La interfaz explica que falta cuota o billing y ofrece un acceso directo para revisarlo.
- `npm run lint` y `npm run build` finalizaron correctamente.
