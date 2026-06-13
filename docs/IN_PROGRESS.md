# En progreso - Brief flexible y placa final con Gemini

## Objetivo

Permitir generar contenido sin escribir un tema y hacer que Gemini resuelva la placa visual final.

## Brechas encontradas

- El tema o enfoque bloquea la generacion aunque la categoria ya define un punto de partida.
- La IA entrega un prompt visual, pero la app delega en Lucia la composicion final de la placa.
- La maqueta descargable de gradiente no refleja una direccion visual atractiva para carrusel o historia.

## Plan

- [x] Hacer opcional el tema y adaptar prompts, validaciones y busqueda.
- [x] Agregar generacion de placa final con Gemini Image segun el formato.
- [x] Simplificar la revision visual para que Lucia no tenga que disenar la placa.
- [x] Verificar, documentar, commitear y pushear.

## Resultado

- El brief queda listo con una categoria; el tema o enfoque es opcional.
- Si no hay tema, la IA elige un enfoque concreto dentro de la categoria.
- Gemini define la direccion visual y genera una placa final 4:5 o 9:16 desde el editor.
- La placa integra titular y subtitulo con jerarquia, contraste y zonas seguras segun el formato.
- Lucia revisa y descarga el resultado, sin tener que armar la composicion visual.
- `npm run lint` y `npm run build` finalizaron correctamente.
