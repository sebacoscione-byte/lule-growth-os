# En progreso - Mejora del Estudio de contenido

## Objetivo

Hacer que la creacion y revision de contenido sea mas clara, completa y operable:

- Guiar el brief y mostrar que falta antes de generar.
- Permitir revisar y guardar todos los textos de una pieza.
- Facilitar encontrar y gestionar borradores en la biblioteca.
- Mantener visibles los guardrails medicos durante la revision.

## Brechas encontradas

- El brief no comunica progreso ni valida el tema antes de generar.
- La revision humana solo guarda caption y texto de Google.
- No se pueden corregir hook, hashtags ni textos de la placa.
- La biblioteca no tiene busqueda ni filtros por estado o formato.
- Los errores no se pueden descartar desde la interfaz.

## Plan

- [x] Auditar flujo, APIs, tipos y documentacion.
- [x] Mejorar brief y estados de creacion.
- [x] Ampliar editor y persistencia.
- [x] Mejorar biblioteca.
- [x] Actualizar documentacion.
- [x] Verificar, commitear y pushear.

## Resultado

- El brief guia el flujo, exige un tema concreto y comunica si esta listo para generar.
- La busqueda de fuentes es opcional y explica cuando conviene usarla.
- La revision humana permite editar y guardar la pieza completa.
- La aprobacion exige contenido minimo y mantiene visibles los guardrails medicos.
- Editar una pieza aprobada o publicada la devuelve a borrador.
- La biblioteca permite buscar, filtrar, archivar y restaurar piezas.
- `npm run lint` y `npm run build` finalizaron correctamente.
- La ruta protegida se verifico en navegador hasta la redireccion a login; no habia una sesion de prueba disponible para revisar la pantalla autenticada.
