# Notas técnicas · MCPI Trace Static

## Regeneración solicitada

El proyecto queda convertido a una aplicación 100% estática compatible con GitHub Pages, sin Node.js ni backend.

## Corrección del seguimiento semanal

La lógica anterior acumulaba eventos por día de la semana sin separar la semana real. La nueva lógica realiza:

- parseo del `.dat`;
- identificación de semana ISO operativa iniciando lunes;
- uso del `.dat` como fuente única para determinar las semanas evaluables;
- eliminación del respaldo automático a la semana actual del navegador;
- agrupación por `checkerId + fecha`;
- cálculo de pares entrada/salida por fecha;
- consolidación por semana seleccionada;
- generación de `weeklyReports` para publicar datos sin exponer el `.dat` bruto.

El selector de semana no usa la fecha actual del usuario. Sus opciones se construyen únicamente a partir de las fechas internas del `.dat`. Los registros del calendario institucional ajustan metas dentro de esas semanas, pero no crean semanas evaluables por sí solos.

## Calendario institucional

Se agregó la entidad local `calendar.entries` dentro del estado de la aplicación. Cada registro tiene:

```json
{
  "id": "calendar-...",
  "type": "asueto | inhabil | vacacional",
  "label": "Descripción",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "createdAt": "ISO-8601"
}
```

Si una fecha del calendario coincide con un día de lunes a sábado, la meta esperada de ese día se ajusta a cero. Si hay marcajes en esa fecha, se registra incidencia.

## Persistencia

- `localStorage`: datos de trabajo de coordinación y reportes cargados.
- `sessionStorage`: rol activo de sesión.
- `data/public-state.json`: estado público estático para consulta en GitHub Pages.

## Limitación deliberada

Al no existir backend, no hay autenticación real, base de datos centralizada ni escritura directa sobre el repositorio. La actualización institucional se realiza exportando y reemplazando manualmente `data/public-state.json`.

## Corrección de reconocimiento del selector semanal

La selección semanal quedó reforzada para no depender del estado vacío inicial ni de la semana del navegador. Si el `.dat` contiene fechas reconocibles, el selector se habilita con esas semanas. Si el `.dat` no puede leerse, la tabla de CVU permanece visible y se muestra el diagnóstico de líneas válidas, inválidas y semanas detectadas.

El parser del `.dat` acepta separadores por pipe, punto y coma, coma, tabulador o espacios; reconoce fechas `YYYY-MM-DD`, `YYYY/MM/DD`, `DD/MM/YYYY`, `DD-MM-YYYY` y `YYYYMMDD`; también reconoce horas `HH:MM`, `HH:MM:SS`, `HHMM` y `HHMMSS`. Cuando existe tabla de referencia cargada, el parser prioriza los IDs de checador presentes en esa tabla para evitar confundir números de fila con identificadores reales.
