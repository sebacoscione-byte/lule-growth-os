# En progreso - Prompts visuales para Gemini

## Objetivo

Mejorar la direccion visual de las piezas para que Gemini genere imagenes atractivas y utilizables, en lugar de placas genericas con texto.

## Brechas encontradas

- El prompt actual solo pide titular, subtitulo y un color.
- No existe un prompt listo para generar una imagen en Gemini.
- La IA recibe la instruccion de que la placa funcione sin fotos, lo que favorece resultados genericos.
- No se define composicion, proporcion, espacio para texto ni elementos a evitar.

## Plan

- [x] Auditar prompts, tipos y flujo visual actual.
- [x] Agregar contrato de direccion visual para Gemini.
- [x] Permitir editar y copiar el prompt desde el estudio.
- [x] Actualizar persistencia y documentacion.
- [x] Verificar, commitear y pushear.

## Resultado

- Cada propuesta nueva incluye un prompt visual en ingles listo para Gemini.
- El prompt exige una imagen editorial sin texto, con un unico foco y espacio negativo.
- Se prohiben placas, posters, collages, gradientes genericos, logos y cliches medicos.
- El editor permite ajustar y copiar el prompt, abrir Gemini y guardar texto alternativo.
- Los borradores anteriores reciben un prompt visual de respaldo.
- `npm run lint` y `npm run build` finalizaron correctamente.
