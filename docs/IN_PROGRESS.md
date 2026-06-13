# En progreso - Correcciones del generador de prompts

## Objetivo

Hacer que el brief editorial comience sin categoria preseleccionada, muestre todas las opciones en mobile y explique claramente por que no puede generarse un prompt.

## Brechas encontradas

- La categoria se inicializa con la primera opcion.
- El `datalist` nativo de Android muestra sugerencias de forma inconsistente.
- El boton para preparar el prompt queda deshabilitado cuando falta el tema y no muestra feedback al tocarlo.

## Plan

- [x] Auditar estado inicial y validacion del generador.
- [x] Reemplazar la categoria por un selector mobile consistente.
- [x] Agregar validacion visible para categoria y tema.
- [x] Verificar, documentar, commitear y pushear.

## Resultado

- El brief inicia con la categoria vacia.
- La categoria usa un selector que muestra todas las opciones de forma consistente en mobile.
- El boton de generacion solo se deshabilita mientras esta generando.
- Al intentar generar sin datos, categoria y tema muestran errores junto al campo correspondiente.
- `npm run lint` y `npm run build` finalizaron correctamente.
