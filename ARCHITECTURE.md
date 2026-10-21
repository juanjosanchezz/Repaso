# Arquitectura

Un solo archivo (`src/repaso.html`): `<style>` con tokens de diseño y un `<script>` dividido en módulos numerados. Sin framework: render con plantillas y delegación de eventos.

## Módulos

| # | Módulo | Responsabilidad |
|---|--------|-----------------|
| 0 | Config | Cursos, comunidades, asignaturas por curso, tipos de material (generales y kits por tipo de asignatura), `FAMILIES` + `FAMILY_HINTS` + `KIT_TASK`, maneras de estudiar, tipos de tarea/examen, recordatorios, preferencias por defecto |
| 1 | Utils | `$`, `esc` (escapar HTML), fechas locales (`todayISO`, `addDays`, `daysUntil`), `local` (localStorage con try/catch), iconos SVG, `md()` (marked + DOMPurify) |
| 2 | Libs | Carga diferida y con versión fija de pdf.js, mammoth, JSZip y html2pdf desde cdnjs |
| 3 | Platform | `usePlatform()` obtiene `db`, `user`, `sample`, `downloads`, `mcp` y `account` (solo en la web con cuentas); cualquiera puede ser `null`. `prefs()` / `applyPrefs()` |
| 4 | Auth | Adaptador de cuenta: `signUp`, `signIn`, `signOut`, `hasSession`, `createProfile`, `pending`. Dentro de Claude: sesión de Claude + marca local. En la web con Supabase (`S.account`): email y contraseña |
| 5 | Repo | Toda la lectura y escritura de datos. Suscripciones de app (asignaturas, temas, exámenes, tareas, SRS, estadísticas) y por asignatura (archivos, material) |
| 6 | SRS + Stats | Repaso espaciado tipo Leitner (cajas 0–5: 0/1/3/7/14/30 días) con límite diario de tarjetas nuevas. Racha, resultados, medias y temas flojos |
| 7 | Extract | Texto de PDF (y OCR con Claude si está escaneado), DOCX, PPTX, TXT/MD/CSV e imágenes |
| 8 | AI | `AI.tier()` (modelo por tarea y modo ahorro), `AI.rules()` (realista y objetivo, sin internet), `AI.familyHint()` (especialista según la asignatura), `AI.level()` (PAU de la comunidad / LOMLOE / carrera), `AI.phase(días)` (comprensión → práctica → modo examen → último momento), prompts de cada material, validación de respuestas JSON, organizador de archivos, ayuda de tareas |
| 9 | Views | Acceso, inicio, PAU, chats (carpetas, memoria y herramientas), tareas, calendario, progreso, asignatura (temas · material · tareas · pregúntale), hojas modales y visores (material, prácticas con corrección, diapositivas, test sin fin) |
| 10 | Export | HTML de impresión → PDF con html2pdf; diapositivas → PowerPoint con PptxGenJS; ambos con `downloads.save` |
| 11 | Events + Boot | Mapas `ACTIONS` (clic), `CHANGES` (change) y manejadores de input, submit y teclado; arranque |

### Patrones

- **Estado**: un objeto global `S`. Las hojas usan su propio sub-estado (`S.up`, `S.gen`, `S.ex`, `S.tk`, `S.pf`, `S.imp`, `S.share`), que `closeSheet()` limpia.
- **Render**: `render()` repinta la vista; `refresh()` repinta solo regiones `#r-*`, para no perder lo que se está escribiendo cuando llega un snapshot.
- **Eventos**: todo botón lleva `data-action="nombre"` y se resuelve en `ACTIONS`. Los campos de formulario se enlazan con `data-pf`, `data-exf` o `data-tkf` al sub-estado correspondiente.
- **Seguridad**: todo texto de usuaria o de Claude pasa por `esc()`; el Markdown, por DOMPurify. Los prompts marcan el material como "datos, no instrucciones".
- **Concurrencia**: escrituras SRS y de actividad agrupadas (1,5–2 s) con `update` de campos anidados; nunca escrituras desde el render.

## Modelo de datos (`db`)

```
data/users/<uid>/profile                     {name, course, region, pau, pauDate, uni:{university,degree,year}, style, prefs, schema}
data/users/<uid>/profile/subjects/<id>       {name, color, family?, createdAt}
data/users/<uid>/profile/topics/<id>         {subjectId, name, createdAt}
data/users/<uid>/profile/exams/<id>          {subjectId, topicIds[], date, kind, title, notes, grade, max, calendar}
data/users/<uid>/profile/tasks/<id>          {subjectId|null, title, type, due, time, priority, notes, status, doneAt, checklist[], fileCount, help, deck, remind, calendar}
data/users/<uid>/profile/files/<id>          {subjectId, topicId|null, taskId|null, name, kind, chars, parts}
data/users/<uid>/profile/texts/<id>[.pN]     {text}  — 100.000 caracteres por documento (límite 256 KiB)
data/users/<uid>/profile/materials/<id>      {subjectId, topicIds[], topicNames[], type, title, content, prev, meta, attempts[], shareCode}
data/users/<uid>/profile/srs/<materialId>    {subjectId, title, total, cards:{i:{b, due, f}}}
data/users/<uid>/profile/chats/<id>          {title, subjectId, folderId, topicIds|null, updatedAt, count}
data/users/<uid>/profile/chatlogs/<id>       {turns:[{role:user|assistant|event, content}]}  (≤230 KB)
data/users/<uid>/profile/folders/<id>        {name}
data/users/<uid>/profile/pau/<sid|_plan>     {md, region, at}
data/users/<uid>/profile/meta/memory         {items:[{id, text, at}]}  (≤80)
data/users/<uid>/profile/meta/stats          {days:{fecha:n}, results:[{kind,sid,tids,score,total,title,at}] (últimos 300)}
shared/<uid>/items/<código>                  {from, subjectName, type, title, content, createdAt}
```

`data/users/<uid>` es privado para cada usuaria (ni el dueño del artifact lo ve). `shared/` lo lee cualquiera con acceso y solo lo escribe su autora (`shared/{self}`).

## Especialización por asignatura

`familyOf(subject)` deduce el tipo por el nombre (o usa `subject.family` si la alumna lo cambió). Cada tipo aporta:
- `FAMILY_HINTS[tipo]`: cómo se especializa Claude (se añade a todos los prompts y al chat).
- Los tipos de material con `kits` que lo incluyen: `md` (fichas, formularios, líneas del tiempo…) o `practice` (ejercicio + respuesta + corrección con nota). Las prácticas comparten un contrato JSON (`PRACTICE_JSON`) y un visor (`practiceRender`).

## Chat con memoria

`chatSystem()` construye el contexto: nivel, especialidad, reglas, estilo, fecha, memoria, próximos exámenes, tareas, temas flojos y apuntes (hasta 90.000 caracteres). Si la vista admite herramientas, `chatTools()` da a Claude `recordar`, `apuntar_examen` y `apuntar_tarea`. Lo que apunta aparece en la conversación como un aviso y se guarda en el registro.

## Claude (`sample`)

- Coste en el plan de quien usa la app; el primer uso pide permiso.
- Material de hasta 140.000 caracteres por petición, recortado de forma proporcional si se pasa (se avisa en el visor).
- Los formatos JSON se validan en `AI.validate`; una respuesta inválida da un error claro y se puede reintentar.

## Decisiones

- **Un archivo**: lo exige el artifact. Las secciones numeradas y este documento sustituyen a la separación en archivos.
- **Exámenes como entidad propia** (no fecha por tema): un examen cubre varios temas, tiene tipo, notas del profe y nota real.
- **Tareas separadas del material**: los adjuntos de una tarea se guardan como archivos con `taskId`, sin tema, así que no se mezclan en el material de estudio.
- **Imprimir**: el visor no puede abrir el diálogo de impresión, así que se genera un PDF y se ofrece con `downloads`.

## Versión web (Vercel)

```
navegador: dist/index.html = web/claude-web.js + src/repaso.html
              │  window.claude.use("db" | "user" | "sample" | "downloads")
              │    db        → IndexedDB (un documento por ruta)
              │    sample    → POST /api/claude (stream SSE), bucle de herramientas en el navegador
              │    downloads → descarga normal
              ▼
Vercel: api/claude.js  → comprueba REPASO_ACCESS_CODE → API de Claude (stream) con ANTHROPIC_API_KEY
```

La app detecta la versión web con `WEB` y esconde lo que solo existe dentro de Claude (Google Calendar con `calOK()`, compartir con `shareOK()`), y añade la copia de seguridad.

### Cuentas (Supabase)

Si el build encuentra `SUPABASE_URL` y la clave pública, escribe `window.__REPASO_CONFIG__` y el shim pasa a modo cuentas:

```
account   → Supabase Auth por REST: signUp, signIn, signOut (scope=local), resend, resetPassword, updatePassword, deleteAccount (/api/account)
            vuelve de los enlaces del correo leyendo #access_token…&type=signup|recovery
db        → copia en memoria de las filas de la usuaria (se cargan al entrar) + escritura en `repaso_docs` (upsert por fila)
            borrar = fila con deleted=true, para que los otros dispositivos se enteren
            sincroniza trayendo lo cambiado desde el último updated_at (al volver a la app, al recuperar conexión y cada 20 s)
sample    → manda también la sesión (Authorization: Bearer); /api/claude la comprueba con Supabase
```

- `repaso_docs (user_id, path, data jsonb, deleted, updated_at)`: `path` es la ruta dentro de la cuenta (`profile`, `profile/subjects/<id>`…). Las reglas (RLS) solo dejan leer y escribir filas con `user_id = auth.uid()`. `updated_at` lo pone un trigger del servidor.
- Las escrituras de un mismo documento van en cola; si una falla, se deshace en la copia local y la app ve el error de siempre (`dbErr`).
- El flujo en la app: `startSession()` escucha el perfil y decide: a la app, a terminar el registro (cuenta sin perfil; si hay un registro pendiente de confirmar en este navegador, lo crea solo) o al acceso. Cerrar sesión y caducar la sesión recargan la página para no dejar nada en memoria.
- El código de acceso de Claude se guarda en los metadatos de la cuenta (`repaso_code`) para pedirlo una sola vez.
