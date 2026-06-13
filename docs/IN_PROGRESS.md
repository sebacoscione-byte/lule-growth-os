# En progreso - Categoria editable del generador

## Objetivo

Permitir que la categoria del brief pueda elegirse de las sugerencias o escribirse libremente.

## Brechas encontradas

- El selector actual muestra todas las categorias sugeridas, pero no permite crear una categoria nueva.

## Plan

- [x] Disenar un selector editable consistente en mobile.
- [x] Permitir escritura libre y filtrado de sugerencias.
- [x] Verificar, documentar, commitear y pushear.

## Resultado

- La categoria comienza vacia y permite escritura libre.
- Al abrir el campo sin texto se muestran todas las sugerencias.
- Al escribir se filtran las sugerencias y, si no hay coincidencias, se conserva la categoria nueva.
- La categoria se normaliza antes de enviarse al generador.
- `npm run lint` y `npm run build` finalizaron correctamente.
