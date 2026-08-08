# Plan de Corrección: Sistema 100% Operacional

## Resumen
Se corregirán 3 archivos (`server.js`, `public/app.js`, `data/state.json`) para alinear el backend con el frontend y eliminar bugs críticos.

---

## Corrección 1: `server.js` — Agregar endpoints API faltantes

### Nuevos endpoints a implementar:

| Endpoint | Método | Respuesta |
|----------|--------|-----------|
| `/api/projects` | GET | `{ ok: true, projects }` |
| `/api/conversations?projectId=` | GET | `{ ok: true, conversations }` filtradas por proyecto |
| `/api/conversations/:id` | GET | `{ ok: true, conversation, messages, runs }` |
| `/api/conversations` | POST | `{ ok: true, conversation }` crear nueva |
| `/api/conversations/:id/messages` | POST | `{ ok: true, userMessage, assistantMessage, run }` |
| `/api/runs/:id/events` | GET | SSE stream (envía estado actual, luego cierre) |
| `/api/runs/:id/approve` | POST | Actualiza estado del run |
| `/api/runs/:id/reject` | POST | Actualiza estado del run |
| `/api/runs/:id/cancel` | POST | Actualiza estado del run |
| `/api/runs/:id/retry` | POST | Re-ejecuta la tarea asociada |

### Modelo `runs` en state:
- Cada run: `{ id, conversationId, messageId, intent, status, progress, archReasoning, claudeReasoning, toolPills, review, worktreeBranch, createdAt, updatedAt }`
- Se agregará `runs: []` al estado inicial
- Los runs se crearán automáticamente al enviar mensajes

---

## Corrección 2: `public/app.js` — Rewrite completo de `renderChatThread`

### Bug crítico a resolver (líneas 229-327):
El `.map()` callback retorna el HTML del mensaje usuario en la línea 240, y todo el código posterior (241-327) es **código muerto** que referencia variables indefinidas (`run`, `patch`, `isApproved`, etc).

### Solución:
- **Agregar branch `else if (msg.role === 'assistant')`** antes del `return ''`
- Para mensajes assistant con `kind === 'review'`: renderizar findings, evidencia, tool pills usando `msg.review`
- Para mensajes assistant con `kind === 'blocked'`/`'answer'`/`'error'`: renderizar texto simple
- **Corregir `msg.timestamp` → `msg.createdAt`** en mensaje usuario
- **Eliminar variables indefinidas**: no usar `run`, `patch`, `isApproved`, `isRejected`, `isExecuting`
- Para reviews: mostrar badge "🔍 REVISIÓN", tool pills reales del review, findings con colores de severidad, resumen
- Para blocked: mostrar badge "🚫 BLOQUEADO" con explicación
- No mostrar botones de aprobación (las revisiones son read-only per AGENTS.md)

---

## Corrección 3: Reset de `data/state.json`

- Eliminar el archivo para que `loadState()` genere un estado limpio al arrancar
- El nuevo seed no incluirá datos simulados de ejecución
- Incluirá: 1 proyecto demo, 1 conversación, sin mensajes, sin tareas

---

## Corrección 4: Verificación

- Ejecutar `npm run dev` y verificar que el servidor arranca sin errores
- Verificar que la UI carga en `http://localhost:4173`
- Verificar que el sidebar muestra el proyecto
- Verificar que se pueden enviar mensajes y recibir respuestas
- Verificar que las revisiones funcionan end-to-end

---

## Archivos modificados:
1. `server.js` — ~120 líneas nuevas (endpoints + runs model)
2. `public/app.js` — Rewrite de renderChatThread (~100 líneas cambiadas)
3. `data/state.json` — Eliminado (regenerado automáticamente)

## Archivos NO modificados:
- `public/index.html` — No requiere cambios
- `public/styles.css` — No requiere cambios
- Archivos raíz (index.html, app.js, etc.) — Son código muerto pero no se eliminan
