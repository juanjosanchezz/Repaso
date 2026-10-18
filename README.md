# Repaso

App de estudio que vive como **artifact de Claude**: la alumna sube lo que le manda el profe, organiza asignaturas, temas, tareas y exámenes en un calendario, y Claude le prepara el material con los criterios de su curso (PAU de su comunidad, LOMLOE en ESO/1º Bachillerato o la guía docente de su carrera).

## Qué hace

- **Acceso**: pantalla de bienvenida, inicio de sesión y registro en 4 pasos (cuenta → qué estudias → asignaturas → manera de estudiar y color).
- **Asignaturas y temas**: subida de PDF (también escaneados, con OCR), Word, PowerPoint, texto y fotos. Claude reparte los archivos por temas.
- **Material**: apuntes, esquema, mapa mental, explicación paso a paso, chuleta exprés, flashcards con repaso espaciado, test, modelo de examen con simulacro cronometrado, examen global (más peso en los temas flojos) y plan de estudio.
- **Maneras de estudiar**: Apuntes y ya · Visual · Practicando · Memorizando · Que me lo expliquen · Completo · Exprés para mañana.
- **Calendario**: exámenes (tipo, temas, notas del profe) y entregas de tareas. Después del examen se apunta la nota real.
- **Tareas**: deberes, trabajos, presentaciones, lecturas… con pasos, adjuntos y ayuda de Claude (dividir en pasos, guion de presentación, índice del trabajo, plan de entrega).
- **Progreso**: racha, calendario de actividad, aciertos por asignatura, notas reales y temas que más cuestan.
- **Avisos**: en la app la víspera, y en Google Calendar si la usuaria lo tiene conectado.
- **Compartir**: un código para pasar material a compañeros.
- **Personalizar**: color, tamaño de letra, secciones del inicio, tarjetas nuevas al día y hora del aviso.

## Estructura

```
src/repaso.html      La app completa (un único archivo, como exige el artifact)
test/mock-claude.js  Simulación del runtime de Claude: db, user, sample, downloads, mcp
test/lib-stubs.js    Sustitutos de las librerías CDN para probar sin red
test/e2e.py          Prueba end-to-end de todos los flujos (Playwright)
ARCHITECTURE.md      Módulos, modelo de datos y decisiones
CLAUDE.md            Instrucciones para trabajar en el repo con Claude Code
CHANGELOG.md         Historial de versiones
```

## Publicar

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

Para usarla, hay que compartirla **por invitación de email con permiso de Colaborador**. Con Google Calendar declarado no se permite enlace público. Cada usuaria solo ve sus propios datos (`data/users/<id>/`); el material compartido va a `shared/<id>/items/<código>`.

## Probar

```bash
pip install playwright && playwright install chromium
python3 test/e2e.py          # 102 comprobaciones; capturas en una carpeta temporal (E2E_OUT para elegirla)
```

La prueba no usa red: el runtime de Claude y las librerías (pdf.js, mammoth, JSZip, html2pdf, marked, DOMPurify) se sustituyen por imitaciones con la misma interfaz. La lectura real de PDF/Word y la generación real de PDF se comprueban a mano en Claude.

## Lanzamiento fuera de Claude

La identidad la da hoy la sesión de Claude. Todo el acceso pasa por el objeto `Auth` (`src/repaso.html`, módulo 4), y los datos por `Repo` (módulo 5). Para una versión independiente:

1. Sustituye `Auth` por Supabase o Firebase (email y contraseña, Google…).
2. Implementa `Repo` sobre esa base de datos con la misma forma de documentos.
3. Cambia `AI.call` por una llamada a la API de Claude desde tu backend.
