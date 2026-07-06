# Corrección de publicación de contenido (Instagram / Google / Hashtags)

Rama: `claude/ai-post-publish-bug-xfq42m`

## Contexto del problema

Al generar una publicación con la IA en el Estudio de contenido y aprobarla, solo
aparecía la opción de publicar en Google (que además tiraba error) y no la de
Instagram. Además, la IA generaba demasiados hashtags sin ningún control.

## Diagnóstico

**1. Instagram no aparecía**
El selector "Formato" arrancaba por default en "Reel", y ese formato no soporta
publicación directa a Instagram (la API de Meta requiere video para reels o
varias imágenes para carruseles — no implementado). El botón "Publicar en
Instagram" solo se mostraba para formato Post/Historia, y como quedaba oculto
para Reel/Carrusel, parecía que la opción no existía.

**2. Error al publicar en Google**
No es un bug nuevo: esta cuenta de Google Business no expone el `Account ID`
vía API (limitación conocida de Google, ya documentada). El Estudio de
contenido no tenía ningún camino alternativo cuando esto pasaba — el item
quedaba "aprobado" sin poder avanzar.

**3. Demasiados hashtags**
El prompt le pedía a la IA "10-15 hashtags" sin ningún control real en el
código. En el modo de generación directa (API) ni siquiera había esa
instrucción — la IA decidía la cantidad libremente.

## Corrección aplicada

| # | Qué se cambió | Archivo |
|---|---|---|
| 1 | Default de "Formato" pasa de "Reel" a "Post estático" + aviso visible junto al selector cuando se elige Reel/Carrusel. El botón de Instagram ya no se oculta: queda visible pero deshabilitado con el motivo explicado. | `src/app/(app)/contenido/instagram/page.tsx` |
| 2 | Cuando falla la publicación en Google por falta de Account ID, se copia el texto al portapapeles automáticamente y aparece un cuadro con link al panel oficial (business.google.com) + botón "Marcar como publicado" manualmente. | `src/app/(app)/contenido/instagram/page.tsx` |
| 3 | Rango de hashtags bajado de 10-15 a 3-5 en ambos prompts (modo API y modo manual/copiar-pegar), más una validación dura (`capHashtags`) que trunca a 5 hashtags reales sin importar lo que devuelva la IA. | `src/lib/ai.ts`, `src/app/(app)/contenido/instagram/page.tsx` |

## Validación hecha

- `npm run build` → compiló sin errores.
- `npm test` → 61 tests, todos pasaron.
- **No probado en navegador real**: este entorno no tiene `.env.local` con
  credenciales de Supabase, así que no se pudo hacer login ni el click-through
  completo (generar → aprobar → publicar).

## Pendiente / próximos pasos

1. Probar en producción o local con credenciales reales: generar una pieza
   nueva, confirmar que el formato "Post estático" queda seleccionado por
   default y que aparece "Publicar en Instagram".
2. Probar el fallback de Google: aprobar una pieza y confirmar que, al fallar
   por Account ID, aparece el cuadro azul con el botón de copiar + "Marcar
   como publicado".
3. Revisar el conteo de hashtags en la próxima pieza generada — debería verse
   3 a 5, no más.
4. Si todo funciona bien, mergear la rama a `main` (o desde el PR ya creado en
   GitHub).
