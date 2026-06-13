# Mobile-first

## Navegacion

La barra inferior mantiene accesos directos a Inicio, Leads, Inbox y Google. El boton `Mas` abre un menu con todas las secciones, incluyendo Contenido, Landings, Experimentos y Configuracion.

Ninguna ruta de desktop debe quedar inaccesible desde mobile.

## Patrones

- Padding base de `p-4` y ampliacion a `md:p-6`.
- Formularios en una columna por defecto; usar columnas desde `sm` o `md`.
- Acciones principales apiladas y de ancho completo en mobile.
- Tabs con desplazamiento horizontal cuando no entran.
- Inputs con fuente de 16 px en mobile para evitar zoom automatico.
- La barra inferior respeta `safe-area-inset-bottom`.
- El layout usa `100dvh` para adaptarse a las barras del navegador movil.

## Informacion equivalente

Las vistas mobile pueden cambiar tablas por tarjetas, pero deben conservar los datos y acciones relevantes. Las tarjetas de Leads muestran estado, canal, servicio, telefono y antiguedad.
