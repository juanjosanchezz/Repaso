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
api/claude.js          Función de Vercel: puente con la API de Claude (tu clave nunca llega al navegador)
api/account.js         Función de Vercel: borrar la cuenta (usuario de Supabase y todos sus datos)
lib/supabase.js        Comprobación de la sesión de Supabase en el servidor
supabase/schema.sql    Tabla y reglas de la base de datos
scripts/migrate.js     Aplica schema.sql en cada despliegue (con POSTGRES_URL de la integración)
scripts/build-web.js   Genera dist/index.html para Vercel (sin dependencias)
vercel.json            Configuración de Vercel
test/mock-claude.js    Simulación del runtime de Claude: db, user, sample, downloads, mcp
test/lib-stubs.js      Sustitutos de las librerías CDN para probar sin red
test/e2e.py            Prueba end-to-end del artifact (Playwright)
test/web_smoke.py      Prueba de la versión web sin cuentas (código de acceso, streaming, herramientas, datos tras recargar)
test/web_accounts.py   Prueba de las cuentas con un Supabase simulado (registro, otro dispositivo, sincronización, contraseñas, borrado)
test/api_test.js       Prueba de la función de Vercel
ARCHITECTURE.md      Módulos, modelo de datos y decisiones
CLAUDE.md            Instrucciones para trabajar en el repo con Claude Code
CHANGELOG.md         Historial de versiones
```

## Desplegar en Vercel

La versión web tiene **cuentas de verdad**: cada persona se registra con email y contraseña y sus datos se guardan en una base de datos (Supabase), así que entra desde cualquier móvil u ordenador. Sin Supabase configurado también funciona, pero entonces cada navegador guarda sus propios datos y no hay cuentas.

### 1. Proyecto en Vercel

En Vercel: **Add New → Project** e importa este repositorio. `vercel.json` ya dice cómo construirlo (`node scripts/build-web.js` → `dist/`) y dónde están las funciones (`api/`).

### 2. Base de datos (Supabase)

En el proyecto de Vercel: **Storage → Supabase** y conéctalo al proyecto. Ya está: Vercel añade las variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `POSTGRES_URL`…) y en cada despliegue `scripts/migrate.js` crea o pone al día la tabla `repaso_docs` con sus reglas (cada usuaria solo lee y escribe lo suyo). En el registro del build sale `Base de datos: tabla repaso_docs lista.`

Solo si usas confirmación por correo (en Supabase viene activada):
- **Authentication → URL Configuration**: pon la dirección de tu web (`https://….vercel.app`) en *Site URL* y en *Redirect URLs*, que es adonde llevan los correos.
- El correo que trae Supabase de serie solo envía unos pocos por hora. Para un grupo de amigas lo más cómodo es desactivar *Confirm email* en **Authentication → Sign In / Providers → Email**: entran nada más crear la cuenta.

*Si creaste Supabase fuera de Vercel*, añade a mano `SUPABASE_URL`, `SUPABASE_ANON_KEY` (o la *publishable*), `SUPABASE_SERVICE_ROLE_KEY` (o la *secret*) y `POSTGRES_URL` (Project Settings → Database → Connection string). Sin `POSTGRES_URL`, pega `supabase/schema.sql` en **SQL Editor** y pulsa **Run**.

### 3. Claude

En Vercel → **Settings → Environment Variables** añade:
- `ANTHROPIC_API_KEY`: tu clave de la API de Claude (console.anthropic.com). **Obligatoria.**
- `REPASO_ACCESS_CODE`: un código que inventes y que solo darás a Julia y a sus amigas. **Muy recomendable**: con cuentas, cualquiera podría registrarse y gastar de tu clave. Se pide una vez y queda guardado en su cuenta.
- Opcionales: `REPASO_MODEL_COMPLEX`, `REPASO_MODEL_DEFAULT`, `REPASO_MODEL_QUICK` (por defecto `claude-opus-5-5`, `claude-sonnet-5-5` y `claude-haiku-5-5`) y `REPASO_MAX_TOKENS` (16000).

Pon también un límite de gasto mensual en console.anthropic.com: el uso de Claude se cobra en **tu** cuenta de la API.

### 4. Desplegar

**Deployments → ⋯ → Redeploy** (cada vez que cambies variables hay que volver a desplegar). En el registro del build aparecen `Base de datos: tabla repaso_docs lista.` y `cuentas: Supabase (…)`.

Cómo comprobar que todo va: crea una cuenta, añade una tarea, entra con la misma cuenta desde otro móvil y mira que aparece; luego pide unos apuntes. Si algo falla, **Vercel → Logs** dice qué.

### Diferencias con la versión de Claude
- No hay avisos de Google Calendar ni compartir con código (eso necesita estar dentro de Claude).
- Los cambios hechos en otro dispositivo aparecen al volver a la app o en unos 20 segundos.
- Las respuestas largas (apuntes completos) pueden tardar; la función admite hasta 300 s (`vercel.json`). Si tu plan de Vercel permite menos, baja `REPASO_MAX_TOKENS` o usa `REPASO_MODEL_COMPLEX=claude-sonnet-5-5`.
- Como administrador de Supabase puedes ver los datos de todas desde el panel; ninguna usuaria puede ver los de otra.

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
python3 test/web_smoke.py    # versión web sin cuentas: 15 comprobaciones
python3 test/web_accounts.py # cuentas con Supabase simulado: 54 comprobaciones
node test/api_test.js        # funciones de Vercel: 15 comprobaciones
node test/migrate_test.js    # migración de la base de datos: 6 comprobaciones
```

La prueba no usa red: el runtime de Claude (incluidas las herramientas del chat) y las librerías (pdf.js, mammoth, JSZip, html2pdf, PptxGenJS, marked, DOMPurify) se sustituyen por imitaciones con la misma interfaz. La lectura real de PDF/Word, la generación real de PDF y PowerPoint y Google Calendar se comprueban a mano en Claude.

## Lanzamiento abierto

Las cuentas, la base de datos y la API ya funcionan fuera de Claude. Antes de abrirlo a cualquiera:

1. **Límite de uso por persona** en `api/claude.js` (por ejemplo, N peticiones al día por cuenta, contadas en una tabla de Supabase), para que nadie gaste de más.
2. **SMTP propio** en Supabase para los correos de confirmación y de contraseña.
3. **Política de privacidad y aviso legal**: guardas datos personales de estudiantes.
4. Iniciar sesión con Google: se activa en Supabase (*Authentication → Providers → Google*) y se añade un botón en `loginPane()`.
