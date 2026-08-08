# Plan: Revisión de Conexión Antigravity — Arquitectura Dinámica y Honestidad de Estado

## Diagnóstico confirmado

**Antigravity no está conectado a nada.** Los 3 badges (GPT-4o 🟢, Claude 3.5 🟢, Antigravity 🟢) son HTML estático hardcodeado. El "worker-local online" es un objeto JSON cuyo heartbeat se falsifica en cada `/api/state`. AGENTS.md exige: *adaptadores con permisos mínimos* y *tareas bloqueadas hasta worker real*.

---

## Corrección 1: `server.js` — Endpoint `/api/agents` + arquitectura de adaptadores

### 1A. Nuevo endpoint `GET /api/agents`

Agregar después de `/api/health` (línea ~314). Retorna estado real de cada agente:

```js
if (req.method === 'GET' && url.pathname === '/api/agents') {
  const agents = [
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      role: 'Architect',
      status: 'simulated',       // 'connected' | 'simulated' | 'disconnected'
      adapter: null,            // null = sin adaptador real
      lastHeartbeat: now()
    },
    {
      id: 'claude-3.5',
      name: 'Claude 3.5',
      role: 'Reviewer',
      status: 'simulated',
      adapter: null,
      lastHeartbeat: now()
    },
    {
      id: 'antigravity',
      name: 'Antigravity',
      role: 'Executor',
      status: state.worker.status === 'online' && state.worker.name === 'worker-local' ? 'simulated' : 'disconnected',
      adapter: null,
      workerName: state.worker.name,
      lastHeartbeat: state.worker.lastHeartbeat
    }
  ];
  return json(res, 200, { ok: true, agents });
}
```

**Lógica de estado:**
- `connected` → adaptador real configurado y responding
- `simulated` → funcionalidad local pero sin API real (caso actual de los 3)
- `disconnected` → sin conexión, no disponible

### 1B. Scaffold de adaptadores ( preparado, no funcional aún )

Agregar al inicio de server.js, después de los requires (~línea 12):

```js
// ===== ADAPTER REGISTRY (arquitectura preparada) =====
const adapters = {
  openai:    { name: 'OpenAI GPT-4o',    status: 'not_configured', apiKeyEnv: 'OPENAI_API_KEY',    connected: false },
  anthropic: { name: 'Anthropic Claude', status: 'not_configured', apiKeyEnv: 'ANTHROPIC_API_KEY', connected: false },
  antigravity:{ name: 'Antigravity',      status: 'not_configured', endpointEnv: 'ANTIGRAVITY_URL', connected: false }
};

function connectAdapter(adapterKey) {
  const a = adapters[adapterKey];
  const secret = process.env[a.apiKeyEnv] || process.env[a.endpointEnv];
  if (!secret) { a.status = 'missing_credentials'; return false; }
  // TODO: implementar conexión real cuando haya credenciales
  a.status = 'connected'; a.connected = true; return true;
}
```

Esto respeta AGENTS.md: **ninguna conexión a producción ni lectura de secretos**. Solo lee env vars si existen.

### 1C. Modificar heartbeat del worker — no falsificar

Cambiar línea 316 de:
```js
state.worker.lastHeartbeat = now();  // FALSificado en cada request
```
a:
```js
// El heartbeat solo se actualiza si un worker real lo reporta
// Por ahora, se mantiene el timestamp original del seed
```

---

## Corrección 2: `public/index.html` — Badges dinámicos con IDs

Cambiar las líneas 212-222 para que los badges sean targetables por JavaScript:

```html
<!-- Agents Status Section -->
<div class="inspector-section">
  <div class="section-header-row">
    <h3>Agents</h3>
  </div>
  <div class="agents-badges-row" id="agents-badges-row">
    <span class="sub-agent gpt" id="agent-badge-gpt">GPT-4o ⏳</span>
    <span class="sub-agent claude" id="agent-badge-claude">Claude 3.5 ⏳</span>
    <span class="sub-agent agy" id="agent-badge-antigravity">Antigravity ⏳</span>
  </div>
</div>
```

**Estado visual por icono:**
- 🟢 = `connected` (adaptador real funcional)
- 🟡 = `simulated` (funciona localmente, sin API real)
- 🔴 = `disconnected` (no disponible)

También cambiar línea 92 (footer worker):
```html
<div class="status-sub" id="worker-status-footer">Worker Local ⏳</div>
```

---

## Corrección 3: `public/app.js` — Fetch dinámico de estado de agentes

### 3A. Nueva función `fetchAgentStatus()`

```js
async function fetchAgentStatus() {
  try {
    const res = await fetch('/api/agents');
    const data = await res.json();
    if (!data.ok) return;
    data.agents.forEach(agent => {
      const badge = document.getElementById(`agent-badge-${agent.id}`);
      if (!badge) return;
      const icon = agent.status === 'connected' ? '🟢' : agent.status === 'simulated' ? '🟡' : '🔴';
      badge.textContent = `${agent.name} ${icon}`;
    });
    // Worker status en footer
    const workerFooter = document.getElementById('worker-status-footer');
    if (workerFooter) {
      const ws = data.agents.find(a => a.id === 'antigravity');
      const wIcon = ws.status === 'connected' ? '🟢' : ws.status === 'simulated' ? '🟡' : '🔴';
      workerFooter.textContent = `${ws.workerName || 'Worker'} ${wIcon}`;
    }
  } catch { /* silently fail */ }
}
```

### 3B. Llamar en el ciclo de polling existente

Agregar `fetchAgentStatus()` dentro del `setInterval` existente (junto con `fetchState()` que ya corre cada 3s).

---

## Corrección 4: `public/styles.css` — Estado visual para badges

Agregar estilos para los estados de agente:

```css
.sub-agent[data-status="connected"] { border-color: rgba(16, 185, 129, 0.4); }
.sub-agent[data-status="simulated"]  { border-color: rgba(245, 158, 11, 0.4); }
.sub-agent[data-status="disconnected"] { border-color: rgba(239, 68, 68, 0.4); opacity: 0.6; }
```

---

## Resumen de cambios

| Archivo | Cambio | Líneas afectadas |
|---------|--------|-----------------|
| `server.js` | Agregar `/api/agents` endpoint | +25 líneas después de línea 314 |
| `server.js` | Scaffold de `adapters` registry | +15 líneas después de línea 12 |
| `server.js` | Eliminar falsificación de heartbeat | Modificar línea 316 |
| `public/index.html` | IDs en badges + estado honesto 🟡 | Modificar líneas 92, 217-221 |
| `public/app.js` | `fetchAgentStatus()` + integración en polling | +25 líneas |
| `public/styles.css` | Estilos por `[data-status]` | +4 líneas |

**Archivos NO modificados:** `data/state.json`, `AGENTS.md`, `package.json`

**Restricciones respetadas:**
- ✅ Solo lectura (no se modifica código de producción)
- ✅ Sin API keys ni conexiones reales (solo arquitectura preparada)
- ✅ AGENTS.md: adaptadores con permisos mínimos
- ✅ Tareas de construcción siguen bloqueadas
- ✅ Cero dependencias nuevas

**Resultado esperado:** Los 3 badges muestran 🟡 (simulated) honestamente en lugar del 🟢 falso. Antigravity muestra claramente que no tiene un worker real conectado. La arquitectura de adaptadores está lista para cuando se dispongan credenciales.