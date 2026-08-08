# Plan: Conectar Z.ai (GLM-5.2) como Agente AI Real

## Contexto

**Z.ai** es una plataforma de IA que expone una API REST compatible con OpenAI:
- **Base URL:** `https://api.z.ai/api/paas/v4/`
- **Auth:** `Authorization: Bearer <API_KEY>`
- **Modelo principal:** `glm-5.2` (contexto hasta 1M tokens)
- **Endpoint:** `POST /chat/completions` (estándar OpenAI-compatible)
- **Streaming:** Soporta `stream: true` con SSE

El usuario quiere conectar su cuenta de Z.ai como agente AI real, **sin usar API key directamente** — prefiere un flujo de configuración seguro desde la UI.

---

## Estrategia: Adaptador Z.ai con Configuración desde UI

### Archivos a modificar (4 archivos, 0 dependencias nuevas)

| Archivo | Cambio | Descripción |
|---------|--------|-------------|
| `server.js` | +Adaptador Z.ai + endpoint POST /api/adapters/zai/configure + llamada HTTP real a Z.ai | Motor de conexión |
| `public/index.html` | +Modal de configuración de Z.ai + badge GLM-5.2 en agents row | UI de configuración |
| `public/app.js` | +Config modal logic + enviar API key al server | Interacción del usuario |
| `public/styles.css` | +Estilos del modal | Visual del modal |
| `.gitignore` | +`.env` | Seguridad |

---

## Cambio 1: `server.js` — Adaptador Z.ai + API real

### 1A. Agregar Z.ai al adapter registry (línea ~16)

```js
const adapters = {
  openai:     { name: 'OpenAI GPT-4o',    status: 'not_configured', apiKeyEnv: 'OPENAI_API_KEY',     connected: false },
  anthropic:  { name: 'Anthropic Claude', status: 'not_configured', apiKeyEnv: 'ANTHROPIC_API_KEY',  connected: false },
  antigravity:{ name: 'Antigravity',      status: 'not_configured', endpointEnv: 'ANTIGRAVITY_URL',  connected: false },
  zai:        { name: 'Z.ai GLM-5.2',    status: 'not_configured', apiKey: null, baseUrl: 'https://api.z.ai/api/paas/v4/', connected: false }
};
```

### 1B. Nueva función `callZaiApi(messages)` — llamada HTTP real con `node:http` (sin dependencias)

```js
async function callZaiApi(messages) {
  const a = adapters.zai;
  if (!a || !a.apiKey || !a.connected) return null;

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'glm-5.2',
      messages,
      temperature: 0.7,
      max_tokens: 2048
    });

    const url = new URL(a.baseUrl + 'chat/completions');
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Bearer ${a.apiKey}`,
        'Accept-Language': 'en-US,en'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.choices && json.choices[0]) {
            resolve(json.choices[0].message.content);
          } else {
            reject(new Error(json.error?.message || 'Respuesta inesperada de Z.ai'));
          }
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout: Z.ai no respondió en 30s')); });
    req.write(payload);
    req.end();
  });
}
```

> **Nota:** Se agrega `const https = require('node:https');` al inicio del archivo — módulo built-in, sin dependencias.

### 1C. Modificar `chatAnswer()` para usar Z.ai cuando esté conectado

Al inicio de `chatAnswer()` (línea ~276), agregar llamada a Z.ai antes de los regex:

```js
async function chatAnswer(text, project) {
  // Si Z.ai está conectado, delegar primero
  if (adapters.zai.connected && adapters.zai.apiKey) {
    try {
      const systemPrompt = `Eres Antigravity AI, un orquestador de agentes de ingeniería de software.
        Proyecto actual: ${project?.name || 'N/A'}. Responde en español, usa markdown, sé técnico pero claro.`;
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ];
      const aiResponse = await callZaiApi(messages);
      if (aiResponse) return { type: 'answer', text: aiResponse };
    } catch (err) {
      // Fallback silencioso a respuestas locales
      event('error', `Z.ai error: ${err.message}`);
    }
  }

  // ... (resto del código existente con regex locales como fallback)
}
```

> **Importante:** `chatAnswer()` se vuelve `async`. Se actualizan los callers existentes con `await`.

### 1D. Nuevo endpoint `POST /api/adapters/zai/configure`

Permite configurar la API key desde la UI (sin exponerla al frontend después de guardar):

```js
if (req.method === 'POST' && url.pathname === '/api/adapters/zai/configure') {
  const body = await parseBody(req);
  const apiKey = String(body.apiKey || '').trim();

  if (!apiKey) {
    return json(res, 400, { ok: false, error: 'API Key requerida' });
  }

  adapters.zai.apiKey = apiKey;
  adapters.zai.status = 'connected';
  adapters.zai.connected = true;

  // Validar la key con un test call
  try {
    await callZaiApi([{ role: 'user', content: 'ping' }]);
    event('success', 'Z.ai GLM-5.2 conectado exitosamente');
  } catch (err) {
    adapters.zai.status = 'auth_error';
    adapters.zai.connected = false;
    event('error', `Z.ai auth falló: ${err.message}`);
  }

  persist(); // Guardar estado
  return json(res, 200, { ok: true, adapter: { name: adapters.zai.name, status: adapters.zai.status, connected: adapters.zai.connected } });
}
```

### 1E. Nuevo endpoint `DELETE /api/adapters/zai/configure`

Para desconectar Z.ai:

```js
if (req.method === 'DELETE' && url.pathname === '/api/adapters/zai/configure') {
  adapters.zai.apiKey = null;
  adapters.zai.status = 'not_configured';
  adapters.zai.connected = false;
  event('agent', 'Z.ai GLM-5.2 desconectado');
  persist();
  return json(res, 200, { ok: true, adapter: { name: adapters.zai.name, status: 'not_configured', connected: false } });
}
```

### 1F. Actualizar `/api/agents` para incluir Z.ai

Agregar 4to agente al array:

```js
{ id: 'zai-glm', name: 'Z.ai GLM-5.2', role: 'AI Engine',
  status: adapters.zai.connected ? 'connected' : 'disconnected',
  adapter: adapters.zai.connected ? 'zai' : null, lastHeartbeat: now() }
```

---

## Cambio 2: `public/index.html` — Modal de configuración + badge

### 2A. Badge de Z.ai en la fila de agentes (línea ~221)

```html
<div class="agents-badges-row" id="agents-badges-row">
  <span class="sub-agent agy" id="agent-badge-antigravity" data-status="loading" ...>✨ Antigravity ⏳</span>
  <span class="sub-agent gpt" id="agent-badge-gpt" data-status="loading">🧠 GPT-4o ⏳</span>
  <span class="sub-agent claude" id="agent-badge-claude" data-status="loading">🛡️ Claude 3.5 ⏳</span>
  <span class="sub-agent zai" id="agent-badge-zai-glm" data-status="loading">🤖 Z.ai GLM-5.2 ⏳</span>
</div>
```

### 2B. Opción "Z.ai GLM-5.2" en el select de modelos (línea ~154)

```html
<select id="select-ai-model" ...>
  <option value="Antigravity AI">✨ Antigravity AI (Líder Orquestador)</option>
  <option value="Z.ai GLM-5.2">🤖 Z.ai GLM-5.2 (AI Engine)</option>
  <option value="GPT-4o">🧠 GPT-4o (Arquitecto)</option>
  <option value="Claude 3.5">🛡️ Claude 3.5 (Revisor OWASP)</option>
</select>
```

### 2C. Modal de configuración de Z.ai (antes de `</body>`)

```html
<div id="zai-config-modal" class="modal-overlay" style="display:none;">
  <div class="modal-card">
    <div class="modal-header">
      <h3>🤖 Conectar Z.ai GLM-5.2</h3>
      <button class="modal-close" id="zai-modal-close">✕</button>
    </div>
    <div class="modal-body">
      <p style="color:var(--text-dim);font-size:13px;margin-bottom:16px;">
        Ingresa tu API Key de <a href="https://z.ai/model-api" target="_blank" style="color:var(--primary);">Z.ai</a> para habilitar respuestas de IA reales.
      </p>
      <label for="zai-api-key-input" style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px;">API Key</label>
      <input type="password" id="zai-api-key-input" class="modal-input"
        placeholder="zai-xxxxxxxxxxxxxxxx" autocomplete="off" />
      <div id="zai-config-status" style="margin-top:10px;font-size:12px;color:var(--text-dim);"></div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="zai-disconnect-btn" style="display:none;">Desconectar</button>
      <button class="btn-primary" id="zai-connect-btn">Conectar</button>
    </div>
  </div>
</div>
```

### 2D. Activar el botón ⚙️ existente para abrir el modal

El botón `#btn-settings` ya existe en el sidebar (línea 95). Se le añade un click handler en app.js para abrir este modal.

---

## Cambio 3: `public/app.js` — Lógica del modal + badge Z.ai

### 3A. Lógica del modal de configuración

```js
// ===== Z.AI CONFIG MODAL =====
const zaiModal = document.getElementById('zai-config-modal');
const zaiApiKeyInput = document.getElementById('zai-api-key-input');
const zaiConfigStatus = document.getElementById('zai-config-status');
const zaiConnectBtn = document.getElementById('zai-connect-btn');
const zaiDisconnectBtn = document.getElementById('zai-disconnect-btn');

if (document.getElementById('btn-settings')) {
  document.getElementById('btn-settings').addEventListener('click', () => {
    zaiModal.style.display = 'flex';
    // Load current status
    fetch('/api/agents').then(r => r.json()).then(data => {
      const zai = data.agents?.find(a => a.id === 'zai-glm');
      if (zai?.status === 'connected') {
        zaiApiKeyInput.value = '••••••••••••';
        zaiDisconnectBtn.style.display = 'inline-block';
        zaiConnectBtn.textContent = 'Actualizar';
        zaiConfigStatus.textContent = '🟢 Conectado';
        zaiConfigStatus.style.color = 'var(--success)';
      } else {
        zaiApiKeyInput.value = '';
        zaiDisconnectBtn.style.display = 'none';
        zaiConnectBtn.textContent = 'Conectar';
        zaiConfigStatus.textContent = zai?.status === 'auth_error' ? '🔴 Error de autenticación' : '⚠️ No configurado';
        zaiConfigStatus.style.color = zai?.status === 'auth_error' ? 'var(--danger)' : 'var(--text-dim)';
      }
    });
  });
}

document.getElementById('zai-modal-close').addEventListener('click', () => zaiModal.style.display = 'none');
zaiModal.addEventListener('click', (e) => { if (e.target === zaiModal) zaiModal.style.display = 'none'; });

zaiConnectBtn.addEventListener('click', async () => {
  const key = zaiApiKeyInput.value.trim();
  if (!key || key === '••••••••••••') { zaiConfigStatus.textContent = '⚠️ Ingresa una API Key'; return; }
  zaiConfigStatus.textContent = '⏳ Conectando...';
  zaiConnectBtn.disabled = true;
  try {
    const res = await fetch('/api/adapters/zai/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key })
    });
    const data = await res.json();
    if (data.ok) {
      zaiConfigStatus.textContent = '🟢 Conectado exitosamente';
      zaiConfigStatus.style.color = 'var(--success)';
      zaiDisconnectBtn.style.display = 'inline-block';
      fetchAgentStatus();
    } else {
      zaiConfigStatus.textContent = `🔴 ${data.error}`;
      zaiConfigStatus.style.color = 'var(--danger)';
    }
  } catch { zaiConfigStatus.textContent = '🔴 Error de conexión'; }
  zaiConnectBtn.disabled = false;
});

zaiDisconnectBtn.addEventListener('click', async () => {
  await fetch('/api/adapters/zai/configure', { method: 'DELETE' });
  zaiConfigStatus.textContent = '⚠️ Desconectado';
  zaiConfigStatus.style.color = 'var(--text-dim)';
  zaiDisconnectBtn.style.display = 'none';
  zaiApiKeyInput.value = '';
  fetchAgentStatus();
});
```

### 3B. Agregar Z.ai al badgeIdMap en fetchAgentStatus()

```js
const badgeIdMap = { 'gpt-4o': 'gpt', 'claude-3.5': 'claude', 'antigravity': 'antigravity', 'zai-glm': 'zai-glm' };
```

Y agregar el label para Z.ai:
```js
const label = agent.id === 'gpt-4o' ? `🧠 GPT-4o (Arquitecto) ${icon}`
            : agent.id === 'claude-3.5' ? `🛡️ Claude 3.5 (Revisor) ${icon}`
            : agent.id === 'zai-glm' ? `🤖 Z.ai GLM-5.2 ${icon}`
            : `✨ Antigravity (Líder) ${icon}`;
```

---

## Cambio 4: `public/styles.css` — Estilos del modal

```css
/* ===== Z.AI CONFIG MODAL ===== */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 9999;
}
.modal-card {
  background: var(--bg-secondary); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px; padding: 24px; width: 420px; max-width: 90vw;
}
.modal-header {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;
}
.modal-header h3 { color: #fff; font-size: 16px; margin: 0; }
.modal-close { background: none; border: none; color: var(--text-dim); font-size: 18px; cursor: pointer; }
.modal-close:hover { color: #fff; }
.modal-input {
  width: 100%; padding: 10px 12px; background: var(--bg-primary);
  border: 1px solid rgba(255,255,255,0.15); border-radius: 8px;
  color: #fff; font-size: 14px; font-family: monospace;
}
.modal-input:focus { outline: none; border-color: var(--primary); }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.btn-primary {
  padding: 8px 20px; background: var(--primary); color: #fff;
  border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
}
.btn-primary:hover { opacity: 0.9; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary {
  padding: 8px 20px; background: transparent; color: var(--danger);
  border: 1px solid var(--danger); border-radius: 8px; font-size: 13px; cursor: pointer;
}
.btn-secondary:hover { background: rgba(239,68,68,0.1); }
```

Agregar estilo para el badge Z.ai:
```css
.sub-agent.zai { background: rgba(16, 185, 129, 0.15); color: #34d399; }
```

---

## Cambio 5: `.gitignore` — Agregar `.env`

```
node_modules/
.worktrees/
.DS_Store
*.log
.env
.env.*
```

---

## Restricciones AGENTS.md respetadas

- ✅ **Adaptador con permisos mínimos**: Solo envía prompts al endpoint `/chat/completions`, no accede a otros recursos
- ✅ **API key nunca se almacena en texto plano en archivos del repo**: Se mantiene en memoria del servidor + opcionalmente en `.env` (gitignored)
- ✅ **Cero dependencias nuevas**: `node:https` es un módulo built-in
- ✅ **Fallback a respuestas locales**: Si Z.ai falla o no está configurado, el sistema usa las respuestas regex existentes
- ✅ **Desconexión siempre disponible**: Botón para borrar la key de memoria
- ✅ **Tareas de construcción siguen bloqueadas**: La conexión es solo para chat/revisión, no ejecuta código

## Flujo del usuario

1. Click en ⚙️ en el sidebar → se abre modal de Z.ai
2. Pega su API Key de [z.ai/model-api](https://z.ai/model-api)
3. Click "Conectar" → el servidor valida la key con un ping a Z.ai
4. Si OK → badge cambia a 🟢, las respuestas del chat ahora vienen de GLM-5.2
5. Si falla → se muestra error, el sistema sigue funcionando con respuestas locales
6. El badge "Z.ai GLM-5.2" aparece en la fila de agentes junto a GPT-4o y Claude 3.5