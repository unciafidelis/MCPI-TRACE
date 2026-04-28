# MCPI Trace · GitHub Pages Static

Aplicación web estática para seguimiento semanal de horas por CVU de estudiantes de la Maestría en Ciencias del Procesamiento de la Información.

El proyecto fue regenerado para operar únicamente con:

- HTML
- CSS
- JavaScript vanilla modular
- `localStorage` y `sessionStorage`
- archivos CSV, DAT y JSON público
- GitHub Pages como hospedaje gratuito

No usa Node.js, Express, SQLite ni backend.

## Funcionalidades principales

### Acceso por rol

- **Alumno:** consulta CVU, estatus, horas reales, meta semanal ajustada y detalle diario.
- **Coordinador:** carga archivos, administra calendario institucional, revisa incidencias y exporta reportes.

Clave local inicial de coordinación:

```txt
coordinacion
```

> Esta clave solo funciona como barrera local básica. GitHub Pages no ofrece autenticación real sin un servicio externo.

## Seguimiento semanal corregido

La versión anterior acumulaba los registros por nombre de día (`lunes`, `martes`, etc.) sin separar semanas reales. Esta versión corrige el cálculo mediante:

1. Detección automática de la semana real de cada marcaje del archivo `.dat`.
2. Agrupación por semana de lunes a domingo.
3. Cálculo de meta de lunes a sábado según la tabla CSV de referencia.
4. Selector de semana en la barra superior, alimentado exclusivamente por las semanas detectadas dentro del archivo `.dat`.
5. Reporte diario por CVU con horas reales, meta ajustada y condición del día.
6. Exportación del JSON público con reportes semanales ya calculados, sin publicar el contenido bruto del `.dat`.

La semana activa ya no se obtiene de la fecha actual del navegador. El archivo `.dat` es la fuente que marca la pauta temporal: si el `.dat` contiene registros del 20 al 26 de abril de 2026, esa será la semana evaluable; si contiene varias semanas, el selector solo mostrará esas semanas. Cuando no hay `.dat`, el sistema muestra `Sin semana DAT` y no genera una evaluación semanal artificial.

Si el `.dat` no contiene fechas u horas reconocibles, el sistema ya no oculta la tabla: conserva los CVU de referencia con estado `Sin DAT`, muestra el selector como `Sin semanas DAT` y despliega un diagnóstico con líneas válidas, inválidas y semanas detectadas. El parser acepta formatos comunes como `20/04/2026`, `2026-04-20`, `20260420`, `08:00`, `0800` y `080000`, incluso cuando el archivo trae columnas adicionales.

## Calendario institucional

El coordinador puede registrar:

- días de asueto;
- días inhábiles;
- periodos vacacionales.

Cada registro contiene:

- tipo;
- fecha inicial;
- fecha final;
- descripción.

Cuando una fecha cae dentro de la semana seleccionada, el sistema descuenta automáticamente la meta esperada de ese día para todos los CVU. Si existen marcajes en un día no laborable, se genera una incidencia de revisión.

## Archivos de entrada

### CSV de referencia

Columnas requeridas:

```txt
CVU-CONACYT,Horas por semana,Lunes,Martes,Miercoles,Jueves,Viernes,Sabado
```

Columnas opcionales:

```txt
ID Checador,Estudiante
```

Si no existe `ID Checador`, el sistema usa el CVU como identificador del checador.

### Archivo `.dat`

Cada línea debe contener al menos:

- ID de checador;
- fecha;
- hora.

El tipo de evento es opcional.

Formatos admitidos por línea:

```txt
2056275|2026-04-20|08:00|IN
2056275,2026-04-20,13:00,OUT
2056275;20/04/2026;08:00;ENTRADA
2056275 2026-04-20 13:00 SALIDA
```

Separadores aceptados:

- pipe `|`
- coma `,`
- punto y coma `;`
- tabulación
- espacios

## Publicación en GitHub Pages

1. Sube esta carpeta a un repositorio público o privado con GitHub Pages habilitado.
2. Entra como coordinador.
3. Carga el CSV de referencia.
4. Carga el archivo `.dat` activo.
5. Registra asuetos, inhábiles o vacaciones cuando aplique.
6. Revisa el selector semanal y las incidencias.
7. Usa **Exportar JSON público**.
8. Renombra el archivo descargado como:

```txt
public-state.json
```

9. Reemplaza el archivo ubicado en:

```txt
data/public-state.json
```

10. Haz commit y push al repositorio.

El alumnado verá los datos actualizados desde GitHub Pages.

## Estructura del proyecto

```txt
mcpi-github-pages/
├── 404.html
├── index.html
├── dashboard.html
├── .nojekyll
├── .gitignore
├── README.md
├── assets/
│   ├── css/
│   │   └── styles.css
│   ├── img/
│   │   ├── favicon.svg
│   │   └── logo.svg
│   └── js/
│       ├── attendanceService.js
│       ├── constants.js
│       ├── csvService.js
│       ├── dashboard.js
│       ├── datService.js
│       ├── login.js
│       ├── storage.js
│       └── utils.js
├── data/
│   ├── public-state.json
│   ├── sample-checker.dat
│   └── sample-reference.csv
└── docs/
    └── technical-notes.md
```

## Operación local sin Node.js

Abre directamente `index.html` en el navegador o sirve la carpeta con cualquier servidor estático. No se requiere instalación de dependencias.

En algunos navegadores, los módulos ES pueden requerir servidor estático local para evitar restricciones de `file://`. Alternativas simples:

- Extensión Live Server de VS Code.
- Servidor estático de tu sistema operativo.
- GitHub Pages directamente.

## Notas técnicas

- El archivo `.dat` activo se guarda solo en el navegador de coordinación.
- El JSON público exportado no incluye el contenido bruto del `.dat`.
- La comparación semanal se calcula con reportes precomputados por semana.
- El calendario institucional forma parte del JSON público para que el alumno vea metas ajustadas.
- No hay base de datos remota ni sincronización automática porque el proyecto está limitado a HTML, CSS y JavaScript estático.
