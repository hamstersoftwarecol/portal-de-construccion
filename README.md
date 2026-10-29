# Portal de Construcción

Portal para conectar y relacionar a **administrador, supervisor, colaborador, arquitecto, ingeniero civil, topógrafo, plomero, electricista y soldador** alrededor de una obra: equipos, tareas, agenda de visitas, documentos con versiones, topografía, no conformidades, avance y reportes.

- **Frontend:** Nuxt 3 (SPA instalable como PWA)
- **API:** Hono + TypeScript + Zod
- **Datos:** SQLite local (`data/portal.db`) y archivos en `data/uploads/`
- **Agendamiento:** módulo propio. Calendly queda como integración futura, detrás de la interfaz `SchedulingProvider`.

Funciona 100 % en local: no necesita cuentas ni servicios externos.

## Arranque rápido

Requisitos: **Node.js 22.13 o superior**.

```bash
npm install
npm run dev        # desarrollo: http://localhost:3000
# o bien
npm start          # producción local (compila la primera vez)
```

La primera ejecución crea la base de datos y carga un proyecto de demostración. Todos los usuarios tienen la contraseña `Demo1234!`:

| Rol | Correo |
| --- | --- |
| Administrador del portal | admin@demo.local |
| Supervisor | supervisor@demo.local |
| Colaborador | colaborador@demo.local |
| Arquitecto | arquitecto@demo.local |
| Ingeniero civil | ingeniero@demo.local |
| Topógrafo | topografo@demo.local |
| Plomero | plomero@demo.local |
| Electricista | electricista@demo.local |
| Soldador | soldador@demo.local |

Con Docker: `docker compose up` (datos en el volumen `portal-data`).

Comandos útiles: `npm test` (55 pruebas de API), `npm run backup` (copia de la base en `data/backups/`), `npm run seed -w server -- --force` (reinicia la demo).

## Cómo se relacionan los roles

Un usuario puede tener **un rol distinto en cada proyecto**. El administrador del portal (marca `is_admin`) ve todo. El servidor aplica una matriz única de permisos (`server/src/rbac.ts`); la interfaz solo oculta controles.

| Rol | Ve | Puede |
| --- | --- | --- |
| Administrador | Todo | Proyectos, equipo y roles, invitaciones, tipos de cita, verificar certificaciones, auditoría, reportes |
| Supervisor | Todo el proyecto | Fases, tareas, asignar, aprobar/rechazar, agendar visitas e inspecciones, dashboard |
| Colaborador | Sus tareas | Registrar avances, agendar visitas |
| Arquitecto | Proyecto, planos | Subir/aprobar planos y documentos, agendar visitas |
| Ingeniero civil | Proyecto | Aprobar documentos, no conformidades, resultado de inspecciones |
| Topógrafo | Sus tareas, documentos de su especialidad | Registrar levantamientos y replanteos |
| Plomero, electricista, soldador | Sus tareas y documentos de su especialidad | Cambiar estado, avances con fotos, certificados, declarar dependencias, definir su disponibilidad |

## Historias de usuario implementadas

| Historias | Dónde |
| --- | --- |
| US-01 a US-05 acceso, RBAC, recuperación e invitaciones | `routes/auth.ts`, `rbac.ts`, `util.ts`; pantallas `login`, `registro`, `restablecer` |
| US-06 a US-09 proyectos, equipo, fases | `routes/projects.ts`; pestañas Resumen, Equipo y Tareas |
| US-10 a US-12 perfiles, directorio, certificaciones | `routes/people.ts`; `perfil`, `profesionales`, Administración |
| US-13 a US-18 tareas, avances, revisión, dependencias | `routes/tasks.ts`; `tareas/[id]`, `mis-tareas` |
| US-19 a US-24 agendamiento local y `SchedulingProvider` | `providers/scheduling.ts`, `routes/schedule.ts`; pestaña Agenda y `agenda` |
| US-25 a US-28 documentos y evidencias | `routes/docs.ts`; pestaña Documentos |
| US-29 a US-31 topografía, no conformidades, inspecciones | `routes/docs.ts`, `routes/schedule.ts`; pestañas Topografía y Calidad |
| US-32, US-33 notificaciones, comentarios y menciones | `notify.ts`, `maintenance.ts`, `routes/misc.ts` |
| US-34 a US-36 dashboard, carga de trabajo, reportes PDF/Excel | `routes/misc.ts`; pestaña Avance |
| US-37 PWA con caché y sincronización | `web/public/sw.js`, `web/composables/useApi.ts` |
| US-38, US-39 arranque con un comando, pruebas | `scripts/`, `Dockerfile`, `server/test/` |
| US-40 auditoría | tabla `audit_log`, Administración → Auditoría |
| US-41 a US-43 integraciones futuras | ver abajo |

## Integraciones futuras (opcionales)

Todo se activa con variables de entorno (ver `.env.example`) y desde Administración → Integraciones; sin ellas el portal usa la agenda propia y las notificaciones dentro del portal.

- **Calendly (US-41, US-42):** `CalendlyProvider` implementa la misma interfaz que la agenda local (disponibilidad, reserva, cancelación), con OAuth y un webhook firmado en `POST /api/webhooks/calendly`. Cada tipo de cita admite su URI de evento de Calendly. La API de Calendly depende del plan de cada cuenta.
- **Correo y WhatsApp (US-43):** adaptadores `Notifier`. Escriben en una bandeja de salida local y envían si defines `SMTP_URL` o `WHATSAPP_TOKEN`.
- **Base de datos:** todo el acceso a datos pasa por `server/src/db.ts` (`q.all`, `q.get`, `q.run`, `q.tx`). Para migrar a PostgreSQL hay que escribir un adaptador con esas funciones y traducir el esquema.

## Estado de verificación

- 55 pruebas automáticas de API (permisos por rol en cada endpoint, aislamiento entre proyectos, flujos completos, webhooks firmados).
- Pruebas de navegador con Chromium: inicio de sesión por rol, crear y asignar tareas, reservar y cancelar citas, subir documentos, topografía, no conformidades, invitaciones, restablecer contraseña, descargas, modo sin conexión.
- **No verificado contra servicios reales:** Calendly, SMTP y WhatsApp (el código sigue sus APIs, pero no se probó con credenciales). Tampoco se probó `docker compose up`.

## Abrir sin instalar nada
`ABRIR-PORTAL.html` (o `Abrir-Portal/index.html`) ejecuta el backend completo (Hono + SQLite en WebAssembly) dentro del navegador, con los datos demo; se guardan en el propio navegador. Se regenera con `npm run build:browser`.
