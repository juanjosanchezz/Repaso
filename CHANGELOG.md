# Cambios

## 4.3 — 21 oct 2026
- Cuentas con **Neon** en lugar de Supabase: basta con conectar Neon en Vercel y desplegar. Sin correos de confirmación ni ajustes fuera de Vercel.
- Funciones propias `/api/auth` (registro, entrar, salir, cambiar contraseña, borrar cuenta) y `/api/docs` (documentos de la cuenta). Contraseñas con scrypt; sesiones con token cuyo hash se guarda en la base de datos.
- Cambiar la contraseña cierra las demás sesiones. Contraseña provisional del administrador desde el SQL Editor de Neon.
- Las tablas se crean solas en cada despliegue (`db/schema.sql`).
- Pruebas: 48 de cuentas contra PostgreSQL real; 18 de las funciones.

## 4.2.1 — 21 oct 2026
- La tabla de la base de datos se crea sola en cada despliegue (`scripts/migrate.js` con la conexión de la integración de Supabase): basta con conectar Supabase en Vercel y desplegar.
- La app reconoce el aviso de "tabla que falta" de las versiones nuevas de Supabase.

## 4.2 — 21 oct 2026
- Cuentas de verdad en la versión web: registro con email y contraseña, iniciar sesión desde cualquier dispositivo, confirmar email, he olvidado la contraseña, cambiar contraseña, cerrar sesión (solo en ese dispositivo) y borrar la cuenta con todos sus datos.
- Base de datos en Supabase (`supabase/schema.sql`): cada usuaria solo ve lo suyo; los cambios se sincronizan entre dispositivos.
- `/api/claude` solo atiende a quien tiene sesión; el código de acceso se pide una vez por cuenta. Nueva función `/api/account`.
- Sin Supabase configurado, la web sigue funcionando como antes (datos en el navegador).
- Pruebas: 54 de cuentas con un Supabase simulado; 15 de las funciones de Vercel.

## 4.1 — 21 oct 2026
- Versión web para Vercel: `web/claude-web.js` (base de datos en el navegador, Claude por streaming con herramientas e imágenes, descargas), función `api/claude.js` con código de acceso, `scripts/build-web.js` y `vercel.json`. Copia de seguridad en Personalizar.
- Manera de estudiar por asignatura (en la cabecera de cada asignatura, en su menú y al preparar material con "estudiar siempre así"). Se usa en el material y en el chat.
- Formularios: todos los campos miden lo mismo (fechas, horas, desplegables y texto) y los botones junto a un campo van a su altura; logo en los pasos de registro en el móvil.
- Corregido: la función de Vercel rechazaba cuerpos de petición que llegaban como texto.
- Pruebas: 171 del artifact, 15 de la web y 7 de la API.

## 4.0 — 21 oct 2026
- Página PAU: cuenta atrás, plan hasta la PAU, guía de la PAU por asignatura y comunidad, simulacros y datos reales por asignatura.
- Especialización por tipo de asignatura con kits propios (Filosofía, Historia, Arte, Geografía, Lengua, idiomas, clásicas, Matemáticas, Física, Química, Biología, Economía, Dibujo) y ejercicios de práctica con corrección y nota (también con fotos).
- Chats guardados en carpetas, con memoria y herramientas: apunta exámenes, tareas y recuerdos desde la conversación.
- Tests sin límite: más preguntas que no repiten las anteriores y modo sin fin.
- Presentaciones: diapositivas con notas del orador, modo presentar y exportar a PowerPoint (materiales y tareas).
- "Pedir cambios" y "Deshacer" en apuntes, mapas mentales y diapositivas.
- Apuntes más completos y con el modelo más capaz; reglas de realismo y objetividad en todos los prompts; aviso honesto de que no puede buscar en internet.
- Recordatorios de tareas configurables; modo ahorro de uso; fecha de la PAU en el perfil.
- Corregido: miniaturas de diapositivas desbordadas.
- Prueba end-to-end ampliada a 165 comprobaciones.

## 3.0 — 19 oct 2026
- Pantalla de acceso previa a la app: bienvenida, iniciar sesión y registro en 4 pasos.
- Tareas: deberes, trabajos, presentaciones, lecturas… con fecha y hora, prioridad, pasos, adjuntos y ayuda de Claude (dividir en pasos, guion o índice, plan de entrega). Página propia, pestaña en cada asignatura, en el inicio y en el calendario. Aviso en Google Calendar.
- Personalizar: color, tamaño de letra, secciones del inicio, racha, tarjetas nuevas al día y hora del aviso. Accesible desde el menú lateral.
- Repaso espaciado con límite diario de tarjetas nuevas.
- "Dividir en pasos" ya no borra los pasos que había escrito la usuaria.
- Arranque más robusto si alguna capacidad de Claude no responde.
- Prueba end-to-end de 102 comprobaciones con runtime de Claude simulado.

## 2.0 — 18 oct 2026
- Criterios según el curso: PAU de la comunidad (2º Bachillerato), LOMLOE (ESO y 1º) o carrera y universidad.
- Fases según la cercanía del examen.
- Maneras de estudiar; nuevos tipos de material: mapa mental, explicación y chuleta.
- Calendario de exámenes con nota real; repaso espaciado; racha y progreso; simulacro cronometrado con corrección; examen global; compartir con código.

## 1.0 — 18 oct 2026
- Asignaturas, temas y archivos; organización automática; apuntes, esquema, flashcards, test, modelo de examen y plan; chat por asignatura; PDF.
