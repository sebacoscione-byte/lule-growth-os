# Estudio de contenido

## Flujo

1. Elegir categoria, formato y CTA. El tema es opcional.
2. Buscar informacion reciente cuando el contenido mencione novedades o datos clinicos.
3. Seleccionar una fuente visible o continuar sin fuente para contenido evergreen.
4. Generar una propuesta completa con IA.
5. Revisar y editar hook, caption, hashtags, slides y texto de Google.
6. Generar la placa final con Gemini desde el editor y descargarla.
7. Aprobar el borrador y copiar el contenido a Instagram o publicar en Google Business.

El brief queda listo cuando tiene categoria. Si el tema o enfoque queda vacio, la IA elige de forma autonoma el angulo mas atractivo, util y concreto dentro de esa categoria. La biblioteca permite buscar por tema, categoria o hook y filtrar por estado y formato.

## Fuentes

La busqueda usa Europe PMC y prioriza revisiones y metaanalisis publicados desde 2024 hasta la fecha actual. La fuente elegida queda guardada con el borrador y visible durante la revision.

La IA recibe el titulo, publicacion, fecha y resumen disponible. No debe inventar resultados que no aparezcan en ese contexto ni convertirlos en consejo medico.

## Persistencia

Los borradores se guardan en la clave `content_pipeline` de `app_config`. Esto permite usar el flujo sin ejecutar una migracion adicional. Se conservan hasta 100 piezas.

Estados:

- `draft`: generado y pendiente de revision.
- `approved`: revisado y aprobado por una persona.
- `published`: enviado a Google Business.
- `archived`: retirado de la biblioteca activa.

La revision humana guarda todos los campos editables de la pieza. Para aprobar se requieren hook, caption, texto de Google y titular visual. Si se edita una pieza aprobada o publicada, vuelve a borrador para requerir una nueva revision.

## Imagenes con Gemini

Cada pieza nueva incluye:

- `image_prompt`: direccion creativa en ingles decidida por la IA.
- `image_alt_text`: descripcion breve en espanol para accesibilidad.
- `visual_headline` y `visual_subtitle`: textos que Gemini integra en la placa final.

El prompt visual define una sola direccion creativa, proporcion vertical, punto focal, composicion, luz, color, jerarquia tipografica y zonas seguras. Pide una pieza editorial legible en pantalla chica y prohibe logos, marcas de agua, texto extra, collages, gradientes genericos y cliches medicos.

El editor llama a Gemini Image para generar una placa final 4:5 para feed/carrusel o 9:16 para historia. La persona revisa el resultado y lo descarga; no tiene que armar la composicion visual.

Variables:

- `GEMINI_IMAGE_MODEL`: modelo de imagen; por defecto `gemini-3.1-flash-image`.
- `GEMINI_IMAGE_SIZE`: resolucion; por defecto `1K`.

## Criterio de captacion

Cada pieza debe cumplir una secuencia:

1. Detener el scroll con un hook y una imagen que se entiendan rapido.
2. Generar identificacion con una duda, situacion cotidiana o aspiracion reconocible.
3. Entregar valor real antes de pedir una accion.
4. Facilitar un proximo paso simple para considerar una consulta por canales oficiales.

La captacion no puede usar miedo, culpa, escasez, promesas ni asumir que el lector tiene una condicion. El editor muestra este checklist antes de aprobar.

## Canales

- Instagram: generacion y descarga de placa con Gemini y copia del texto listo para publicar. La publicacion automatica requiere Instagram Graph API.
- Google Business: publicacion desde la app solo para contenido aprobado y cuando Google habilita la API para la cuenta.

## Guardrails

Todo contenido debe evitar diagnosticos, tratamientos, interpretacion de estudios, promesas y mensajes que asuman una condicion medica del lector. Los sintomas de alarma deben derivarse a guardia o atencion medica inmediata.

Estos guardrails se muestran dentro del editor antes de aprobar una pieza.

## Proveedor e idioma

El estudio usa la capa comun de IA de la app. Se puede seleccionar Google Gemini o Anthropic con `AI_PROVIDER`, y todas las propuestas se solicitan explicitamente en espanol.

Con `AI_PROVIDER=auto`, Gemini tiene prioridad cuando `GEMINI_API_KEY` esta configurada. Si un proveedor no tiene saldo o alcanza su cuota, la interfaz muestra un mensaje breve y accionable en lugar del error tecnico de la API.

En modo manual, el pegado intenta reparar automaticamente comillas internas sin escapar y saltos de linea que algunos modelos devuelven dentro de campos JSON.
