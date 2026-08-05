# Agenda e ingresos

## Alcance

`/planificacion` es la fuente operativa para gestionar la agenda semanal y proyectar ingresos por
institución. Reemplaza el archivo externo: no lee, escribe ni sincroniza ningún Google Sheet.
Es una proyección interna; no agenda turnos, no confirma disponibilidad y no representa cobros
reales.

Los horarios, aranceles, feriados y meses de proyección se editan desde la propia pantalla y se
guardan en Supabase. Los valores que existían al crear la sección se usan sólo como semilla inicial;
la migración usa `ON CONFLICT DO NOTHING` y nunca vuelve a pisar una configuración guardada.

## Horario semanal

- Grilla de 46 franjas de 15 minutos, de 09:00 a 20:30.
- Investigación: lunes a viernes, 09:00–12:00 (15 horas semanales).
- Almuerzo: lunes a viernes, 12:00–13:00.
- CIMEL: martes 13:00–15:00, jueves 13:00–16:00 y viernes 13:00–16:00
  (32 prestaciones / 8 horas semanales).
- Hospital Británico Lanús: ecocardiogramas los martes 16:00–19:30
  (14 prestaciones / 3,5 horas semanales).
- Hospital Británico Central: miércoles 17:00–19:45
  (11 prestaciones / 2,75 horas semanales).
- Swiss Medical: viernes 17:00–20:00
  (12 prestaciones / 3 horas semanales).
- Cerámica: sábado 09:00–13:00. Se muestra en la agenda, pero no participa de los cálculos
  profesionales ni económicos.

La pantalla agrupa franjas consecutivas para la vista rápida y conserva la tabla completa de
15 minutos dentro del desplegable de detalle.

## Reglas económicas

- Duración por paciente: 15 minutos.
- Consulta particular: $60.000.
- Consulta por prepaga / obra social: $15.000.
- Ecocardiograma: $20.000.
- Investigación: $0 mensual en la versión relevada.
- Un paciente particular por día, asignado al primer bloque de consultorio de ese día.
- Promedio mensual: 4,33 semanas.

Con agenda completa y sin cancelaciones, el modelo deriva 69 prestaciones, $1.285.000 semanales
y $5.564.050 mensuales promedio. El cálculo vive en funciones puras y nunca depende de números
totales escritos a mano.

## Proyección calendario

La semilla inicial proyecta septiembre–diciembre de 2026 y excluye 12/10, 23/11, 07/12, 08/12 y
25/12. Tanto el período como las fechas se pueden modificar desde la pantalla. Los totales de
regresión iniciales son:

| Mes | Días hábiles | Total |
| --- | ---: | ---: |
| Septiembre 2026 | 22 | $5.795.000 |
| Octubre 2026 | 21 | $5.770.000 |
| Noviembre 2026 | 20 | $5.140.000 |
| Diciembre 2026 | 20 | $5.170.000 |

## Implementación y verificación

- `src/lib/practice-planning.ts`: horario, reglas y cálculos derivados.
- `src/lib/practice-planning.test.ts`: regresiones del cálculo y de configuraciones editadas.
- `src/app/(app)/planificacion/page.tsx`: presentación responsive y accesible.
- `src/app/api/planning/route.ts`: lectura y guardado autenticado con validación y auditoría.
- `supabase/migrations/20260805_practice_planning.sql`: almacenamiento singleton con RLS forzado.
- La sección está dentro del layout autenticado y requiere los mismos controles de rol/MFA que el
  resto del CRM.
- Sólo `owner` y `doctor` pueden leer; guardar exige MFA y cada cambio deja un evento de auditoría.
