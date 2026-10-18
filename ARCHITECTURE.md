# Arquitectura

Un solo archivo (`src/repaso.html`): `<style>` con tokens de diseño y un `<script>` dividido en módulos numerados. Sin framework: render con plantillas y delegación de eventos.

## Módulos

| # | Módulo | Responsabilidad |
|---|--------|-----------------|
| 0 | Config | Cursos, comunidades, asignaturas por curso, tipos de material, maneras de estudiar, tipos de tarea/examen, preferencias por defecto |
| 1 | Utils | `$`, `esc` (escapar HTML), fechas locales (`todayISO`, `addDays`, `daysUntil`), `local` (localStorage con try/catch), iconos SVG, `md()` (marked + DOMPurify) |
| 2 | Libs | Carga diferida y con versión fija de pdf.js, mammoth, JSZip y html2pdf desde cdnjs |
| 3 | Platform | `usePlatform()` obtiene `db`, `user`, `sample`, `downloads`, `mcp`; cualquiera puede ser `null`. `prefs()` / `applyPrefs()` |
| 4 | Auth | Adaptador de cuenta: `signUp`, `signIn`, `signOut`, `hasSession`. Hoy, sesión de Claude + marca local de sesión |
| 5 | Repo | Toda la lectura y escritura de datos. Suscripciones de app (asignaturas, temas, exámenes, tareas, SRS, estadísticas) y por asignatura (archivos, material) |
| 6 | SRS + Stats | Repaso espaciado tipo Leitner (cajas 0–5: 0/1/3/7/14/30 días) con límite diario de tarjetas nuevas. Racha, resultados, medias y temas flojos |
| 7 | Extract | Texto de PDF (y OCR con Claude si está escaneado), DOCX, PPTX, TXT/MD/CSV e imágenes |
| 8 | AI | `AI.level()` (PAU de la comunidad / LOMLOE / carrera), `AI.phase(días)` (comprensión → práctica → modo examen → último momento), prompts de cada material, validación de respuestas JSON, organizador de archivos, ayuda de tareas |
| 9 | Views | Acceso, inicio, tareas, calendario, progreso, asignatura (temas · material · tareas · pregúntale), hojas modales y visores |
| 10 | Export | HTML de impresión → PDF con html2pdf → `downloads.save` |
| 11 | Events + Boot | Mapas `ACTIONS` (clic), `CHANGES` (change) y manejadores de input, submit y teclado; arranque |

### Patrones

- **Estado**: un objeto global `S`. Las hojas usan su propio sub-estado (`S.up`, `S.gen`, `S.ex`, `S.tk`, `S.pf`, `S.imp`, `S.share`), que `closeSheet()` limpia.
- **Render**: `render()` repinta la vista; `refresh()` repinta solo regiones `#r-*`, para no perder lo que se está escribiendo cuando llega un snapshot.
- **Eventos**: todo botón lleva `data-action="nombre"` y se resuelve en `ACTIONS`. Los campos de formulario se enlazan con `data-pf`, `data-exf` o `data-tkf` al sub-estado correspondiente.
- **Seguridad**: todo texto de usuaria o de Claude pasa por `esc()`; el Markdown, por DOMPurify. Los prompts marcan el material como "datos, no instrucciones".
- **Concurrencia**: escrituras SRS y de actividad agrupadas (1,5–2 s) con `update` de campos anidados; nunca escrituras desde el render.

## Modelo de datos (`db`)

```
data/users/<uid>/profile                     {name, course, region, pau, uni:{university,degree,year}, style, prefs, schema}
data/users/<uid>/profile/subjects/<id>       {name, color, createdAt}
data/users/<uid>/profile/topics/<id>         {subjectId, name, createdAt}
data/users/<uid>/profile/exams/<id>          {subjectId, topicIds[], date, kind, title, notes, grade, max, calendar}
data/users/<uid>/profile/tasks/<id>          {subjectId|null, title, type, due, time, priority, notes, status, doneAt, checklist[], fileCount, help, calendar}
data/users/<uid>/profile/files/<id>          {subjectId, topicId|null, taskId|null, name, kind, chars, parts}
data/users/<uid>/profile/texts/<id>[.pN]     {text}  — 100.000 caracteres por documento (límite 256 KiB)
data/users/<uid>/profile/materials/<id>      {subjectId, topicIds[], topicNames[], type, title, content, meta, attempts[], shareCode}
data/users/<uid>/profile/srs/<materialId>    {subjectId, title, total, cards:{i:{b, due, f}}}
data/users/<uid>/profile/meta/stats          {days:{fecha:n}, results:[{kind,sid,tids,score,total,title,at}] (últimos 300)}
shared/<uid>/items/<código>                  {from, subjectName, type, title, content, createdAt}
```

`data/users/<uid>` es privado para cada usuaria (ni el dueño del artifact lo ve). `shared/` lo lee cualquiera con acceso y solo lo escribe su autora (`shared/{self}`).

## Claude (`sample`)

- Coste en el plan de quien usa la app; el primer uso pide permiso.
- Material de hasta 140.000 caracteres por petición, recortado de forma proporcional si se pasa (se avisa en el visor).
- Los formatos JSON se validan en `AI.validate`; una respuesta inválida da un error claro y se puede reintentar.

## Decisiones

- **Un archivo**: lo exige el artifact. Las secciones numeradas y este documento sustituyen a la separación en archivos.
- **Exámenes como entidad propia** (no fecha por tema): un examen cubre varios temas, tiene tipo, notas del profe y nota real.
- **Tareas separadas del material**: los adjuntos de una tarea se guardan como archivos con `taskId`, sin tema, así que no se mezclan en el material de estudio.
- **Imprimir**: el visor no puede abrir el diálogo de impresión, así que se genera un PDF y se ofrece con `downloads`.
