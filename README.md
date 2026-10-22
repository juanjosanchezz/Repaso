# Repaso

App de estudio que funciona de dos formas: como **artifact de Claude** y como **web en Vercel**. En las dos, la alumna sube lo que le manda el profe, organiza asignaturas, temas, tareas y exámenes en un calendario, y Claude le prepara el material con los criterios de su curso (PAU de su comunidad, LOMLOE en ESO/1º Bachillerato o la guía docente de su carrera).

## Qué hace

- **Enfocada en la PAU**: en 2º de Bachillerato todo sigue el modelo de la PAU de su comunidad (estructura, tipos de pregunta, criterios de corrección). Página **PAU** con cuenta atrás, plan hasta la PAU, guía de la PAU por asignatura, simulacros y datos reales de cada asignatura. En ESO/1º usa los criterios LOMLOE; en universidad, la carrera y la guía docente.
- **Especializada en cada asignatura**: detecta el tipo (Filosofía, Historia, Arte, Geografía, Lengua, idiomas, Latín y Griego, Matemáticas, Física, Química, Biología, Economía, Dibujo) y ofrece su kit: ficha de autor, relacionar autores, comentario de texto, de fuente, de obra o de mapa, análisis sintáctico, writing, reading, traducción, problemas con corrección, preguntas de razonamiento, formulario, problemas resueltos, conceptos clave, línea del tiempo… El tipo se puede cambiar a mano.
- **Material**: apuntes completos (con el modelo más capaz), esquema, mapa mental, explicación paso a paso, chuleta, flashcards con repaso espaciado, tests **sin límite** (más preguntas sin repetir y modo sin fin), modelo de examen con simulacro cronometrado, examen global y plan de estudio. "Pedir cambios" y "Deshacer" en cualquier material.
- **Presentaciones para clase**: diapositivas con lo que decir en cada una, modo presentar a pantalla completa y exportación a **PowerPoint**. También desde una tarea de tipo Presentación.
- **Chats en carpetas que se acuerdan**: conversaciones guardadas y organizadas en carpetas, por asignatura o generales. El chat conoce sus exámenes, tareas y temas flojos, y cuando le cuenta algo **lo apunta**: examen en el calendario, tarea en la lista o un recuerdo que usa siempre (visible y borrable en Personalizar).
- **Realista y objetivo**: todas las instrucciones a Claude piden notas sin regalar, errores concretos, no inventar y avisar de lo que puede estar desactualizado.
- **Tareas** con pasos, adjuntos, ayuda de Claude y recordatorios en Google Calendar (a elegir: el día antes, 2 h antes…).
- **Cada asignatura a su manera**: la manera de estudiar (apuntes y ya, visual, practicando, memorizando…) se puede elegir por asignatura; por ejemplo, Geografía con mapas mentales y Filosofía con apuntes. Se usa al preparar material y en el chat.
- **Calendario** de exámenes y entregas con nota real; **Progreso** con racha y temas flojos; **compartir** material con un código; **Personalizar** (color, letra, inicio, modo ahorro).

### Límites que no dependen de la app

- **Buscar en Google**: un artifact no puede navegar por internet. Claude responde con lo que sabe y con los apuntes, y avisa cuando algo (fechas de la PAU, cambios de este curso) hay que comprobarlo en la web oficial.
- **Ilimitado y gratis**: cada persona usa su propia cuenta de Claude. Con el plan gratuito funciona dentro de sus límites; el modo ahorro hace que dure más. Una versión propia sin cuenta de Claude tendría que pagar la API.

## Estructura

```
src/repaso.html        La app completa (un único archivo, como exige el artifact)
web/claude-web.js      Versión web: la misma interfaz de Claude en el navegador (IndexedDB, /api/claude, descargas)
api/claude.js          Función de Vercel: puente con la IA, Gemini gratis o Claude (tu clave nunca llega al navegador)
lib/gemini.js          Traduce entre el formato de Claude que usa la app y la API de Gemini
api/auth.js            Función de Vercel: cuentas (registro, entrar, salir, contraseña, borrar)
api/docs.js            Función de Vercel: guardar y leer los documentos de la cuenta
lib/                   db.js (conexión a Neon), auth.js (contraseñas y sesiones), http.js
db/schema.sql          Tablas de la base de datos (se aplican solas en cada despliegue)
scripts/migrate.js     Aplica db/schema.sql en cada despliegue
scripts/build-web.js   Genera dist/index.html para Vercel (sin dependencias)
vercel.json            Configuración de Vercel
test/mock-claude.js    Simulación del runtime de Claude: db, user, sample, downloads, mcp
test/lib-stubs.js      Sustitutos de las librerías CDN para probar sin red
test/e2e.py            Prueba end-to-end del artifact (Playwright)
test/web_smoke.py      Prueba de la versión web sin cuentas (código de acceso, streaming, herramientas, datos tras recargar)
test/web_accounts.py   Prueba de las cuentas con las funciones reales y un PostgreSQL de verdad
test/api_server.js     Sirve api/auth y api/docs en local para esa prueba (test/pg-psql.js: consultas vía psql)
test/api_test.js       Prueba de la función de Vercel
ARCHITECTURE.md      Módulos, modelo de datos y decisiones
CLAUDE.md            Instrucciones para trabajar en el repo con Claude Code
CHANGELOG.md         Historial de versiones
```

## Desplegar en Vercel

La versión web tiene **cuentas de verdad**: cada persona se registra con email y contraseña, sus datos se guardan en tu base de datos (Neon) y entra desde cualquier móvil u ordenador. Sin base de datos también funciona, pero cada navegador guarda sus propios datos.

1. En Vercel: **Add New → Project** e importa este repositorio. `vercel.json` ya dice cómo construirlo.
2. **Storage → Neon** y conéctalo al proyecto. Nada más: en cada despliegue `scripts/migrate.js` crea o pone al día las tablas (`rp_users`, `rp_sessions`, `rp_docs`). No hay que configurar nada en Neon ni mandar correos.
3. **La IA: Gemini gratis (recomendado) o Claude.** En **Settings → Environment Variables**:
   - `GEMINI_API_KEY`: clave **gratuita** de Google. En **aistudio.google.com** → *Get API key* → *Create API key*. Sin tarjeta, así que nunca te cobra. Tiene un límite de uso al día (compartido por todas); si se llega, la app avisa y vuelve a funcionar más tarde. Si un modelo llega a su límite, se prueba otro gratuito.
   - O, para más calidad pagando tú: `ANTHROPIC_API_KEY` (console.anthropic.com, prepago). Si están las dos, se usa Gemini salvo que pongas `REPASO_AI=claude`.
   - `REPASO_ACCESS_CODE`: un código que inventes y solo des a tus amigas. **Muy recomendable**: sin él, cualquiera que se registre gastaría tu límite. Se pide una vez por cuenta.
   - `REPASO_GEMINI_MODE`: `volumen` (por defecto: primero Gemma, con mucho más cupo diario; Flash de respaldo y para el chat que apunta cosas) o `calidad` (primero Flash).
   - Opcionales: `REPASO_GEMINI_MODELS` (lista de modelos de Gemini a probar, por defecto `gemini-flash-latest,gemini-flash-lite-latest,…`); con Claude, `REPASO_MODEL_COMPLEX`, `REPASO_MODEL_DEFAULT`, `REPASO_MODEL_QUICK`; `REPASO_MAX_TOKENS` (16000).
4. **Deployments → ⋯ → Redeploy**. En **Deploy Logs** tienen que salir `Base de datos: tablas de Repaso listas.` y `cuentas: sí (base de datos) · IA: Gemini (gratis)`.

Si usas Claude, pon un límite de gasto mensual en console.anthropic.com: se cobra en **tu** cuenta de la API. Con Gemini gratis no hay cobro. En el nivel gratuito, Google puede usar lo que se envía para mejorar sus productos.

### Si alguien olvida su contraseña

No hay correos, así que la pone quien administra la app. En Vercel → Storage → tu base de datos → **Open in Neon** → **SQL Editor**:

```sql
update rp_users set pass_hash = 'temp$UnaProvisional1' where email = 'su-email@ejemplo.com';
```

Le dices `UnaProvisional1`; al entrar con ella se guarda cifrada y luego la puede cambiar en Personalizar. No pierde nada.

### Diferencias con la versión de Claude
- No hay avisos de Google Calendar ni compartir con código (eso necesita estar dentro de Claude).
- Los cambios hechos en otro dispositivo aparecen al volver a la app o en unos 20 segundos.
- Las respuestas largas (apuntes completos) pueden tardar; la función admite hasta 300 s (`vercel.json`). Si tu plan de Vercel permite menos, baja `REPASO_MAX_TOKENS` o usa `REPASO_MODEL_COMPLEX=claude-sonnet-5-5`.
- Las contraseñas se guardan cifradas (scrypt). Como administrador ves en Neon los datos de todas; ninguna usuaria puede ver los de otra.

## Publicar como artifact de Claude

`src/repaso.html` se publica tal cual como artifact (la plataforma añade `<!doctype html>…<body>`). Capacidades que declara:

```json
{
  "db": {"rules": [{"path": "shared", "read": "view", "write": "owner"}, {"path": "shared/{self}", "write": "interact"}]},
  "user": {"scopes": ["profile"]},
  "sample": {"images": true},
  "downloads": true,
  "mcp": {"servers": [{"server": "Google Calendar", "tools": ["create_event"]}]}
}
```

**Cómo compartirla** (cuenta personal de Claude): invita a cada persona **por email con permiso de Editor** y no actives el enlace público. Quien entra desde fuera de tu organización con un enlace público o como Lector solo puede leer, así que no podría guardar nada. Cada usuaria ve solo sus datos (`data/users/<id>/`); el material compartido va a `shared/<id>/items/<código>`. La base de datos de un artifact admite 25.000 documentos en total: da para un grupo de amigas, no para un lanzamiento abierto.

## Probar

```bash
pip install playwright && playwright install chromium
python3 test/e2e.py          # artifact: 171 comprobaciones (E2E_OUT=carpeta para guardar las capturas)
python3 test/web_smoke.py    # versión web sin cuentas: 20 comprobaciones
python3 test/web_accounts.py # cuentas con PostgreSQL real: 48 comprobaciones (necesita PostgreSQL instalado)
node test/api_test.js        # funciones de Vercel: 18 comprobaciones
node test/gemini_test.js     # traducción a Gemini: 20 comprobaciones
node test/migrate_test.js    # migración de la base de datos: 7 comprobaciones
```

La prueba no usa red: el runtime de Claude (incluidas las herramientas del chat) y las librerías (pdf.js, mammoth, JSZip, html2pdf, PptxGenJS, marked, DOMPurify) se sustituyen por imitaciones con la misma interfaz. La lectura real de PDF/Word, la generación real de PDF y PowerPoint y Google Calendar se comprueban a mano en Claude.

## Lanzamiento abierto

Las cuentas, la base de datos y la API ya funcionan fuera de Claude. Antes de abrirlo a cualquiera:

1. **Límite de uso por persona** en `api/claude.js` (por ejemplo, N peticiones al día por cuenta, contadas en una tabla), para que nadie gaste de más.
2. **Límite de intentos de inicio de sesión** y **recuperar contraseña por correo** (con un servicio como Resend).
3. **Política de privacidad y aviso legal**: guardas datos personales de estudiantes.
