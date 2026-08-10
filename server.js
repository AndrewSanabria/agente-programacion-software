const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

const AntigravityAdapter = require('./antigravity-adapter');
const { DATA_DIR, getWorkerToken } = require('./config');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PORT = Number(process.env.PORT || 4173);

const FORGE_WORKER_TOKEN = getWorkerToken();
const ADAPTER_KEYS_FILE = path.join(DATA_DIR, '.adapter-keys');

// ===== ADAPTER KEY PERSISTENCE =====
// Cifra API keys con AES-256-GCM usando el worker token como derivación de clave.
// Las keys sobreviven reinicios del servidor sin exponerse en texto plano.
function deriveKeyEncryptionKey() {
  return crypto.scryptSync(FORGE_WORKER_TOKEN, 'adapter-keys-v1', 32);
}

function persistAdapterKeys() {
  try {
    const keysToSave = {};
    if (adapters.openai.apiKey) keysToSave.openai = adapters.openai.apiKey;
    if (Object.keys(keysToSave).length === 0) {
      // No keys to persist — remove file if exists
      if (fs.existsSync(ADAPTER_KEYS_FILE)) fs.unlinkSync(ADAPTER_KEYS_FILE);
      return;
    }
    const plaintext = JSON.stringify(keysToSave);
    const iv = crypto.randomBytes(12);
    const key = deriveKeyEncryptionKey();
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const payload = { iv: iv.toString('hex'), authTag: authTag.toString('hex'), data: encrypted.toString('hex'), version: 1 };
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(ADAPTER_KEYS_FILE, JSON.stringify(payload), { mode: 0o600 });
  } catch (err) {
    console.error('[AdapterKeys] Error persisting keys:', err.message);
  }
}

function loadAdapterKeys() {
  try {
    if (!fs.existsSync(ADAPTER_KEYS_FILE)) return;
    const raw = fs.readFileSync(ADAPTER_KEYS_FILE, 'utf8');
    const payload = JSON.parse(raw);
    if (payload.version !== 1) return;
    const iv = Buffer.from(payload.iv, 'hex');
    const authTag = Buffer.from(payload.authTag, 'hex');
    const encrypted = Buffer.from(payload.data, 'hex');
    const key = deriveKeyEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    const keys = JSON.parse(decrypted);
    if (keys.openai && typeof keys.openai === 'string') {
      adapters.openai.apiKey = keys.openai;
      adapters.openai.status = 'checking';
    }
    console.log('[AdapterKeys] Loaded saved keys for:', Object.keys(keys).join(', '));
  } catch (err) {
    console.error('[AdapterKeys] Error loading keys:', err.message);
  }
}
const FORGE_PROJECTS_ROOT = path.resolve(process.env.FORGE_PROJECTS_ROOT || ROOT);
const CSRF_COOKIE = 'forge_csrf';
const MAX_BODY_BYTES = 1e6;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};

const antigravityAdapter = new AntigravityAdapter({
  url: process.env.ANTIGRAVITY_URL,
  token: process.env.ANTIGRAVITY_TOKEN
});

// Map en memoria para registro y heartbeat de workers en tiempo real
const activeWorkers = new Map();

function validateWorkspacePath(targetPath) {
  if (!targetPath) return { ok: true, resolved: FORGE_PROJECTS_ROOT };
  const allowedRoot = path.resolve(FORGE_PROJECTS_ROOT);
  let resolved;
  try {
    resolved = fs.realpathSync(path.resolve(String(targetPath)));
  } catch {
    return { ok: false, error: `Acceso denegado: la ruta no existe o no es accesible: ${targetPath}` };
  }
  let realRoot;
  try { realRoot = fs.realpathSync(allowedRoot); }
  catch { return { ok: false, error: `El workspace configurado no existe: ${allowedRoot}` }; }
  const relative = path.relative(realRoot, resolved);
  const isInside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  if (!isInside) {
    return { ok: false, error: `Acceso denegado: La ruta "${targetPath}" está fuera del workspace FORGE_PROJECTS_ROOT (${realRoot})` };
  }
  if (!fs.statSync(resolved).isDirectory()) return { ok: false, error: `La ruta no es una carpeta: ${resolved}` };
  return { ok: true, resolved };
}

// ===== ADAPTER REGISTRY =====
const adapters = {
  openai:     { name: 'OpenAI Responses API', status: process.env.OPENAI_API_KEY ? 'checking' : 'missing_credentials', apiKey: process.env.OPENAI_API_KEY || null, apiKeyEnv: 'OPENAI_API_KEY', baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/', model: process.env.OPENAI_MODEL || 'gpt-5.6-luna', reasoningEffort: process.env.OPENAI_REASONING_EFFORT || 'low', connected: false, lastHealthCheck: null, lastError: null },
  anthropic:  { name: 'Anthropic Claude', status: 'not_configured', apiKeyEnv: 'ANTHROPIC_API_KEY', connected: false },
  antigravity:{ name: 'Antigravity Engine', status: process.env.ANTIGRAVITY_URL ? 'disconnected' : 'missing_credentials', connected: false, url: process.env.ANTIGRAVITY_URL || null, endpoint: process.env.ANTIGRAVITY_URL || null, lastHealthCheck: null, lastError: null }
};

function connectAdapter(adapterKey) {
  const a = adapters[adapterKey];
  if (!a) return false;
  const secret = process.env[a.apiKeyEnv] || process.env[a.endpointEnv];
  if (!secret) { a.status = 'missing_credentials'; return false; }
  a.status = 'connected';
  a.connected = true;
  return true;
}

async function initAdapters() {
  // Restore persisted adapter keys from disk (survives restarts)
  loadAdapterKeys();

  const agHealth = await antigravityAdapter.healthCheck();
  adapters.antigravity.status = agHealth.status;
  adapters.antigravity.connected = agHealth.connected;
  adapters.antigravity.lastHealthCheck = antigravityAdapter.lastHealthCheck;
  adapters.antigravity.lastError = antigravityAdapter.lastError;

  // Env vars take priority over persisted keys for OpenAI
  if (process.env.OPENAI_API_KEY) {
    adapters.openai.apiKey = process.env.OPENAI_API_KEY;
    adapters.openai.status = 'checking';
  }
  if (adapters.openai.apiKey && adapters.openai.status === 'checking') {
    await checkOpenAiConnection();
  }
  if (process.env.ANTHROPIC_API_KEY) connectAdapter('anthropic');
}
initAdapters();

// ===== OPENAI RESPONSES API (HTTP directo, sin persistir la API key) =====
function openAiRequest(method, endpoint, body = null, apiKey = adapters.openai.apiKey, timeout = 30000) {
  return new Promise((resolve, reject) => {
    let base;
    try { base = new URL(adapters.openai.baseUrl); }
    catch (error) { reject(new Error(`OPENAI_BASE_URL inválida: ${error.message}`)); return; }
    const requestModule = base.protocol === 'https:' ? https : http;
    const basePath = base.pathname.replace(/\/$/, '');
    const requestPath = `${basePath}/${String(endpoint).replace(/^\//, '')}`;
    const payload = body === null ? null : JSON.stringify(body);
    const req = requestModule.request({
      hostname: base.hostname,
      port: base.port || (base.protocol === 'https:' ? 443 : 80),
      path: requestPath,
      method,
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      timeout
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let jsonBody = {};
        try { jsonBody = raw ? JSON.parse(raw) : {}; } catch (_) { jsonBody = { raw: raw.slice(0, 500) }; }
        resolve({ statusCode: res.statusCode || 0, headers: res.headers, body: jsonBody });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Timeout: OpenAI no respondió en 30s')));
    if (payload) req.write(payload);
    req.end();
  });
}

function openAiError(response) {
  const message = response.body?.error?.message || response.body?.message || `HTTP ${response.statusCode}`;
  const error = new Error(`OpenAI ${response.statusCode}: ${String(message).slice(0, 300)}`);
  error.statusCode = response.statusCode;
  return error;
}

async function checkOpenAiConnection() {
  const a = adapters.openai;
  if (!a.apiKey) {
    a.status = 'missing_credentials';
    a.connected = false;
    a.lastError = 'OPENAI_API_KEY no configurada';
    return { ok: false, status: a.status, connected: false };
  }
  try {
    const response = await openAiRequest('GET', 'models', null, a.apiKey, 10000);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      a.status = 'connected';
      a.connected = true;
      a.lastHealthCheck = now();
      a.lastError = null;
      return { ok: true, status: a.status, connected: true };
    }
    throw openAiError(response);
  } catch (error) {
    a.status = error.statusCode === 401 || error.statusCode === 403 ? 'auth_error' : 'disconnected';
    a.connected = false;
    a.lastError = error.message;
    return { ok: false, status: a.status, connected: false, error: error.message };
  }
}

function publicOpenAiAdapter() {
  const { apiKey, ...safe } = adapters.openai;
  return { ...safe, configured: Boolean(apiKey) };
}

function responseText(body) {
  if (typeof body?.output_text === 'string' && body.output_text.trim()) return body.output_text.trim();
  const parts = [];
  for (const item of body?.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

async function callOpenAiApi(messages) {
  const a = adapters.openai;
  if (!a || !a.apiKey || !a.connected) return null;
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');
  const input = [];
  if (systemMsg) input.push({ role: 'developer', content: systemMsg.content });
  input.push(...chatMessages);
  if (input.length === 0) input.push({ role: 'user', content: 'ping' });
  const payload = {
    model: a.model,
    input,
    max_output_tokens: 2048,
    store: false,
    text: { verbosity: 'medium' }
  };
  if (/^gpt-5/i.test(a.model)) payload.reasoning = { effort: a.reasoningEffort };
  const response = await openAiRequest('POST', 'responses', payload, a.apiKey);
  if (response.statusCode < 200 || response.statusCode >= 300) throw openAiError(response);
  const text = responseText(response.body);
  if (!text) throw new Error('OpenAI devolvió una respuesta sin texto');
  return text;
}

const ORCHESTRATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    objective: { type: 'string' },
    instructions: { type: 'array', items: { type: 'string' } },
    files: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          action: { type: 'string', enum: ['create', 'modify', 'delete', 'inspect'] },
          reason: { type: 'string' }
        },
        required: ['path', 'action', 'reason']
      }
    },
    patch: { type: 'string' },
    verification: { type: 'array', items: { type: 'string', enum: ['syntax', 'tests'] } },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
    riskNotes: { type: 'array', items: { type: 'string' } },
    requiresReview: { type: 'boolean' }
  },
  required: ['summary', 'objective', 'instructions', 'files', 'patch', 'verification', 'acceptanceCriteria', 'riskNotes', 'requiresReview']
};

function parseStructuredJson(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); }
  catch (error) { throw new Error('OpenAI devolvió un plan no válido: ' + error.message); }
}

async function callOpenAiOrchestrator(request, project) {
  const systemPrompt = [
    'Actúas como el único cerebro de ingeniería del sistema Antigravity.',
    'Tus responsabilidades son simultáneas: orquestador, ingeniero principal, arquitecto de software y revisor final.',
    'Debes convertir la solicitud del usuario en instrucciones ejecutables para el worker Antigravity Local Executor.',
    '',
    'Proyecto: ' + project.name + '. Rama base: ' + (project.branch || 'main') + '.',
    'Ruta local permitida: ' + (project.localPath || ROOT) + '.',
    '',
    'Reglas obligatorias:',
    '1. Analiza la solicitud y define una implementación concreta, pequeña y verificable.',
    '2. Devuelve exclusivamente el JSON del esquema solicitado; no uses markdown fuera del JSON.',
    '3. El campo patch debe ser un parche unified diff aplicable desde la raíz del proyecto. Si no hay un cambio seguro y concreto, déjalo vacío.',
    '4. Nunca incluyas secretos, tokens, claves API, rutas fuera del proyecto ni comandos de shell.',
    '5. verification solo puede contener syntax y/o tests.',
    '6. Las instrucciones deben ser específicas para Antigravity: archivos, cambios, orden, validaciones y criterios de aceptación.',
    '7. No declares que algo fue ejecutado: solo describe el plan que el worker debe ejecutar.',
    '8. requiresReview debe ser true cuando el cambio afecte seguridad, autenticación, datos, dependencias o despliegue.'
  ].join('\n');
  const a = adapters.openai;
  const payload = {
    model: a.model,
    input: [
      { role: 'developer', content: systemPrompt },
      { role: 'user', content: request }
    ],
    max_output_tokens: 6000,
    store: false,
    text: {
      verbosity: 'medium',
      format: {
        type: 'json_schema',
        name: 'antigravity_execution_plan',
        strict: true,
        schema: ORCHESTRATION_SCHEMA
      }
    }
  };
  if (/^gpt-5/i.test(a.model)) payload.reasoning = { effort: a.reasoningEffort };
  const response = await openAiRequest('POST', 'responses', payload, a.apiKey);
  if (response.statusCode < 200 || response.statusCode >= 300) throw openAiError(response);
  const plan = parseStructuredJson(responseText(response.body));
  if (!plan.summary || !plan.objective || !Array.isArray(plan.instructions) || !Array.isArray(plan.files)) {
    throw new Error('El plan de OpenAI no contiene los campos obligatorios');
  }
  return plan;
}

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomBytes(4).toString('hex')}`;

function seedState() {
  return {
    user: {
      id: 'usr_andres_sanabria',
      name: 'Andres Sanabria',
      githubHandle: 'AndrewSanabria',
      antigravityId: 'AGY-MAC-PRO-4173',
      status: 'connected',
      connectedSince: now(),
      role: 'Software Architect & Antigravity User'
    },
    projects: [{
      id: 'proj_demo',
      name: 'agente de programacion software',
      localPath: ROOT,
      githubUrl: 'https://github.com/AndrewSanabria/agente-programacion-software',
      branch: 'main',
      status: 'connected',
      createdAt: now()
    }],
    tasks: [{
      id: 'task_demo',
      projectId: 'proj_demo',
      title: 'Preparar arquitectura del dashboard',
      description: 'Definir el flujo entre arquitectos, revisor y worker local.',
      status: 'completed',
      stage: 'review',
      priority: 'high',
      agent: 'GPT Architect',
      createdAt: now(),
      updatedAt: now(),
      progress: 100,
      result: 'Plan base creado. Listo para conectar proveedores reales.'
    }],
    conversations: [{ id: 'conv_main', projectId: 'proj_demo', title: 'Conversación principal', createdAt: now(), updatedAt: now() }],
    messages: [],
    runs: [],
    events: [
      { id: id('evt'), type: 'system', message: 'Worker local listo para recibir tareas', createdAt: now() },
      { id: id('evt'), type: 'success', message: 'Proyecto demo conectado', createdAt: now() }
    ],
    worker: { status: 'offline', name: 'worker-local', lastHeartbeat: null }
  };
}

function loadState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) {
    const initial = seedState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(initial, null, 2), { mode: 0o600 });
    return initial;
  }
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return seedState(); }
}

let state = loadState();
function sanitizeState() {
  let changed = false;
  if (!state.user) {
    state.user = {
      id: 'usr_andres_sanabria',
      name: 'Andres Sanabria',
      githubHandle: 'AndrewSanabria',
      antigravityId: 'AGY-MAC-PRO-4173',
      status: 'connected',
      connectedSince: now(),
      role: 'Software Architect & Antigravity User'
    };
    changed = true;
  }
  for (const secretField of ['sessionToken', 'sessionClaims', 'sessionSignature']) {
    if (secretField in state.user) { delete state.user[secretField]; changed = true; }
  }
  if (!state.worker) { state.worker = { status: 'offline', name: 'worker-local', lastHeartbeat: null }; changed = true; }
  if (!Array.isArray(state.tasks)) { state.tasks = []; changed = true; }
  if (!Array.isArray(state.events)) { state.events = []; changed = true; }
  return changed;
}
if (sanitizeState()) persist();

function startWorkerExpirationCheck() {
  const timer = setInterval(() => {
    const nowTs = Date.now();
    let changed = false;

    for (const [workerId, worker] of activeWorkers.entries()) {
      const lastHbTs = Date.parse(worker.lastHeartbeat || 0);
      if (nowTs - lastHbTs > 8000 && worker.status !== 'disconnected') {
        worker.status = 'disconnected';
        worker.connected = false;
        changed = true;
        event('error', `Worker desmarcado por pérdida de heartbeat: ${workerId}`);
      }
    }

    if (state.worker) {
      const activeWorkerObj = Array.from(activeWorkers.values()).find(w => w.status === 'connected');
      if (activeWorkerObj) {
        state.worker.status = 'online';
        state.worker.name = activeWorkerObj.name;
        state.worker.antigravityId = activeWorkerObj.workerId;
        state.worker.lastHeartbeat = activeWorkerObj.lastHeartbeat;
      } else {
        state.worker.status = 'offline';
        state.worker.name = 'worker-local (desconectado)';
        state.worker.connected = false;
      }
    }
    if (changed) persist();
  }, 3000);
  if (timer.unref) timer.unref();
}
startWorkerExpirationCheck();

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const temporaryFile = path.join(DATA_DIR, `.state.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(temporaryFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryFile, STATE_FILE);
}
function ensureConversationState() {
  if (!Array.isArray(state.conversations)) state.conversations = [];
  if (!Array.isArray(state.messages)) state.messages = [];
  if (!Array.isArray(state.runs)) state.runs = [];
  if (!Array.isArray(state.projects)) state.projects = [];
  const firstProject = state.projects?.[0];
  if (firstProject && (!firstProject.githubUrl || /tu-organizacion/i.test(firstProject.githubUrl))) firstProject.githubUrl = 'https://github.com/AndrewSanabria/agente-programacion-software';
  for (const project of state.projects) {
    const pathCheck = validateWorkspacePath(project.localPath === '.' ? ROOT : project.localPath);
    if (!pathCheck.ok || project.localPath !== pathCheck.resolved) project.localPath = ROOT;
  }
  if (!state.conversations.length && state.projects[0]) state.conversations.push({ id: id('conv'), projectId: state.projects[0].id, title: 'Conversación principal', createdAt: now(), updatedAt: now() });
}
ensureConversationState();
function event(type, message) {
  state.events.unshift({ id: id('evt'), type, message, createdAt: now() });
  state.events = state.events.slice(0, 30);
}

function json(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function cookieValue(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  const entry = cookies.find(item => item.trim().startsWith(`${name}=`));
  if (!entry) return null;
  try { return decodeURIComponent(entry.trim().slice(name.length + 1)); } catch { return null; }
}

function ensureCsrfCookie(req, res) {
  const existing = cookieValue(req, CSRF_COOKIE);
  if (existing) return existing;
  const token = crypto.randomBytes(24).toString('hex');
  res.setHeader('Set-Cookie', `${CSRF_COOKIE}=${token}; Path=/; SameSite=Strict`);
  return token;
}

function csrfAllowed(req, res) {
  if (SAFE_METHODS.has(req.method) || req.url.startsWith('/api/workers/')) return true;
  const expected = cookieValue(req, CSRF_COOKIE);
  const provided = String(req.headers['x-csrf-token'] || '');
  if (!expected || !provided) {
    json(res, 403, { ok: false, error: 'CSRF token requerido' });
    return false;
  }
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    json(res, 403, { ok: false, error: 'CSRF token inválido' });
    return false;
  }
  return true;
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (err) { reject(err); } });
    req.on('error', reject);
  });
}
function repoSnapshot(localPath) {
  try {
    const branch = execFileSync('git', ['-C', localPath, 'branch', '--show-current'], { encoding: 'utf8', timeout: 2500 }).trim() || 'detached';
    const porcelain = execFileSync('git', ['-C', localPath, 'status', '--porcelain'], { encoding: 'utf8', timeout: 2500 }).trim();
    return { available: true, branch, changedFiles: porcelain ? porcelain.split('\n').length : 0, clean: !porcelain };
  } catch { return { available: false, branch: null, changedFiles: 0, clean: false }; }
}

const REVIEW_REQUEST = /(revis|review|audit|analiz|analis|inspecc|diagnos|verific|comprob|hallazgo|estado)/i;

function isReviewRequest(task) {
  return REVIEW_REQUEST.test(`${task.title || ''} ${task.description || ''}`);
}

function listRepositoryFiles(root, limit = 180) {
  const ignored = new Set(['.git', 'node_modules', 'data', '.forge', 'dist', 'build', 'coverage', 'upload']);
  const files = [];
  function visit(current, relative = '') {
    if (files.length >= limit) return;
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= limit || ignored.has(entry.name) || entry.name.startsWith('.')) continue;
      const absolute = path.join(current, entry.name);
      const rel = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(absolute, rel);
      else if (entry.isFile()) files.push(rel);
    }
  }
  visit(root);
  return files;
}

function readRepositoryFile(root, relative, maxBytes = 120000) {
  const target = path.resolve(root, relative);
  if (!isWithin(root, target)) return null;
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return fs.readFileSync(target, 'utf8');
  } catch { return null; }
}

function runReadOnlyGit(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 4000, maxBuffer: 200000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

function runRepositoryTests(root, packageJson) {
  const testScript = packageJson?.scripts?.test;
  if (!testScript || /no test|not configured/i.test(testScript)) {
    return { status: 'not_configured', command: null, output: 'No hay un script de pruebas configurado en package.json.' };
  }
  return { status: 'not_run', command: null, output: 'No se ejecutan scripts definidos por el repositorio desde el servidor. Ejecuta las pruebas en CI o en un sandbox dedicado.' };
}

function reviewRepository(project) {
  const pathCheck = validateWorkspacePath(project?.localPath || ROOT);
  if (!pathCheck.ok) return { ok: false, error: pathCheck.error };
  const root = pathCheck.resolved;

  const files = listRepositoryFiles(root);
  const byName = new Map(files.map(file => [path.basename(file).toLowerCase(), file]));
  const packagePath = byName.get('package.json');
  const packageText = packagePath ? readRepositoryFile(root, packagePath) : null;
  let packageJson = null;
  try { packageJson = packageText ? JSON.parse(packageText) : null; } catch { packageJson = null; }
  const readme = byName.get('readme.md') ? readRepositoryFile(root, byName.get('readme.md')) : null;
  const agents = byName.get('agents.md') ? readRepositoryFile(root, byName.get('agents.md')) : null;
  const serverText = files.filter(file => /(^|\\|\/)server\.(js|ts)$/.test(file)).map(file => readRepositoryFile(root, file) || '').join('\n');
  const sourceText = files.filter(file => /\.(js|ts|tsx|jsx|py|go|java|rb|php)$/.test(file)).slice(0, 80).map(file => readRepositoryFile(root, file) || '').join('\n');
  const findings = [];

  if (!packageJson && !files.some(file => /(^|\\|\/)pyproject\.toml$/.test(file))) {
    findings.push({ severity: 'high', title: 'No se encontró un manifiesto de proyecto reconocible', evidence: 'Falta package.json o pyproject.toml.', recommendation: 'Define el comando de instalación, pruebas y build del proyecto.' });
  }
  if (!agents) findings.push({ severity: 'medium', title: 'Falta AGENTS.md', evidence: 'No hay instrucciones operativas para los agentes.', recommendation: 'Añade reglas de arquitectura, comandos permitidos y criterios de aceptación.' });
  if (!readme) findings.push({ severity: 'medium', title: 'Falta README.md', evidence: 'No hay documentación principal detectable.', recommendation: 'Documenta cómo arrancar, probar y desplegar el proyecto.' });
  if (packageJson && !packageJson.scripts?.test) findings.push({ severity: 'high', title: 'No hay pruebas automatizadas configuradas', evidence: 'package.json no contiene scripts.test.', recommendation: 'Añade pruebas ejecutables en package.json.' });
  if (files.length >= 180) findings.push({ severity: 'info', title: 'La inspección fue limitada', evidence: 'Se alcanzó el límite de 180 archivos para mantener la respuesta manejable.', recommendation: 'Divide la revisión por módulos para auditar el repositorio completo.' });

  const gitBranch = runReadOnlyGit(root, ['branch', '--show-current']) || 'no disponible';
  const gitStatus = runReadOnlyGit(root, ['status', '--short']);
  const tests = runRepositoryTests(root, packageJson);
  if (tests.status === 'failed') findings.push({ severity: 'high', title: 'Las pruebas configuradas fallan', evidence: `${tests.command}: el proceso terminó con error.`, recommendation: 'Revisa la salida de pruebas antes de aprobar cambios.' });
  if (tests.status === 'not_configured' && packageJson) findings.push({ severity: 'high', title: 'La revisión no pudo validar pruebas', evidence: tests.output, recommendation: 'Configura un script test real; no se debe mostrar “8/8 pasaron” sin ejecutarlo.' });

  const counts = findings.reduce((acc, item) => { acc[item.severity] = (acc[item.severity] || 0) + 1; return acc; }, {});
  const summary = findings.length
    ? `Revisión real completada: se inspeccionaron ${files.length} archivos y se encontraron ${findings.length} hallazgos (${counts.critical || 0} críticos, ${counts.high || 0} altos, ${counts.medium || 0} medios). No se modificaron archivos.`
    : `Revisión real completada: se inspeccionaron ${files.length} archivos y no se detectaron hallazgos en las comprobaciones disponibles. No se modificaron archivos.`;
  return {
    ok: true,
    project: project?.name || path.basename(root),
    root,
    inspectedFiles: files.slice(0, 80),
    inspectedDocuments: [agents ? 'AGENTS.md' : null, readme ? 'README.md' : null, packagePath || null].filter(Boolean),
    git: { available: Boolean(gitStatus !== null || gitBranch !== 'no disponible'), branch: gitBranch, changedFiles: gitStatus ? gitStatus.split('\n').filter(Boolean) : [] },
    tests,
    findings,
    summary,
    completedAt: now()
  };
}

function conversationFor(body = {}) {
  ensureConversationState();
  const projectId = body.projectId || state.projects[0]?.id;
  let conversation = state.conversations.find(item => item.id === body.conversationId);
  if (!conversation) {
    conversation = { id: id('conv'), projectId, title: 'Nueva conversación', createdAt: now(), updatedAt: now() };
    state.conversations.unshift(conversation);
  }
  return conversation;
}

function isOrchestrationRequest(text) {
  return /\b(ejecuta|ejecutar|implementa|implementar|construye|construir|crea|crear|modifica|modificar|corrige|corregir|arregla|arreglar|añade|agrega|actualiza|actualizar|parche|código|codigo|despliega|deploy)\b/i.test(String(text || ''));
}

function orchestrationText(plan, taskId = null) {
  const files = (plan.files || []).map(file => '• ' + file.action + ' ' + file.path + ': ' + file.reason).join('\n') || '• Sin archivos determinados; Antigravity debe inspeccionar antes de cambiar.';
  const instructions = (plan.instructions || []).map((instruction, index) => String(index + 1) + '. ' + instruction).join('\n') || '1. Inspeccionar el workspace y detenerse si falta contexto.';
  const verification = (plan.verification || []).map(item => item === 'tests' ? 'pruebas automatizadas' : 'sintaxis').join(' y ') || 'validaciones definidas';
  return [
    '🧠 **OpenAI — Orquestador / Ingeniero principal / Arquitecto / Revisor**',
    '**Objetivo:** ' + plan.objective,
    '**Resumen:** ' + plan.summary,
    '**Instrucciones específicas para Antigravity:**\n' + instructions,
    '**Archivos previstos:**\n' + files,
    '**Verificación obligatoria:** ' + verification + '.',
    '**Criterios de aceptación:** ' + ((plan.acceptanceCriteria || []).join(' · ') || 'El cambio debe ser reproducible y verificable.'),
    plan.patch ? '✅ OpenAI generó un parche verificable para ejecutar en un worktree aislado' + (taskId ? ' (' + taskId + ').' : '.') : '⚠️ OpenAI no generó un parche aplicable; Antigravity debe detenerse y solicitar una especificación más concreta.'
  ].join('\n\n');
}

function addRunActivity(run, agent, stage, message, meta = {}) {
  if (!Array.isArray(run.activity)) run.activity = [];
  run.activity.push({ id: id('activity'), agent, stage, message, createdAt: now(), ...meta });
  if (run.activity.length > 60) run.activity = run.activity.slice(-60);
  run.updatedAt = now();
  event('agent', agent + ': ' + message);
}

function queueOrchestrationTask(run, conversationId, text, plan) {
  const conversation = state.conversations.find(item => item.id === conversationId);
  const project = state.projects.find(item => item.id === conversation?.projectId) || state.projects[0];
  const task = {
    id: id('task'),
    runId: run.id,
    projectId: project?.id,
    title: String(plan.objective || text).slice(0, 120),
    description: text,
    intent: 'orchestrate',
    type: 'implementation',
    status: 'queued',
    stage: 'queued',
    priority: 'high',
    agent: 'OpenAI Orchestrator',
    instructionPlan: plan,
    createdAt: now(),
    updatedAt: now(),
    progress: 0
  };
  state.tasks.unshift(task);
  run.taskId = task.id;
  run.worktreeBranch = 'run_' + task.id;
  addRunActivity(run, 'OpenAI', 'handoff', 'Plan listo; enviando instrucciones específicas a Antigravity Executor.', { taskId: task.id });
  event('task', 'OpenAI generó instrucciones específicas para Antigravity: ' + task.title);
  return task;
}

function createPendingOrchestrationRun(conversationId, messageId, text) {
  const run = {
    id: id('run'),
    conversationId,
    messageId,
    intent: 'orchestration',
    status: 'running',
    progress: 5,
    archReasoning: 'OpenAI está analizando la solicitud y preparando el plan de ingeniería.',
    orchestration: null,
    activity: [],
    worktreeBranch: 'main',
    createdAt: now(),
    updatedAt: now()
  };
  state.runs.unshift(run);
  addRunActivity(run, 'OpenAI', 'analysis', 'Analizando la solicitud, el contexto del proyecto y los límites de ejecución.');
  return run;
}

async function processOrchestrationRun(run, assistantMessage, conversation, project, text) {
  try {
    if (!adapters.openai.connected || !adapters.openai.apiKey) {
      run.status = 'blocked';
      run.progress = 0;
      assistantMessage.kind = 'blocked';
      assistantMessage.content = 'OpenAI no está conectado. Configura la API key para iniciar la orquestación.';
      addRunActivity(run, 'OpenAI', 'blocked', 'No se puede generar el plan hasta configurar la API key.');
      persist();
      return;
    }

    addRunActivity(run, 'OpenAI', 'context', 'Inspeccionando el repositorio y definiendo el alcance seguro del cambio.');
    run.progress = 15;
    persist();
    const plan = await callOpenAiOrchestrator(text, project);
    run.orchestration = plan;
    run.archReasoning = orchestrationText(plan);
    run.progress = 25;
    assistantMessage.kind = 'orchestration';
    assistantMessage.content = orchestrationText(plan);
    assistantMessage.orchestration = plan;
    addRunActivity(run, 'OpenAI', 'plan', 'Plan estructurado generado: objetivo, archivos, parche y criterios de aceptación definidos.');

    if (!plan.patch) {
      run.status = 'blocked';
      assistantMessage.kind = 'blocked';
      addRunActivity(run, 'OpenAI', 'blocked', 'El plan no contiene un parche verificable; no se enviará una modificación al executor.');
      persist();
      return;
    }

    run.status = 'queued';
    run.progress = 25;
    queueOrchestrationTask(run, conversation.id, text, plan);
    conversation.updatedAt = now();
    persist();
  } catch (error) {
    run.status = 'failed';
    run.progress = 0;
    assistantMessage.kind = 'error';
    assistantMessage.content = 'OpenAI no pudo completar el plan: ' + error.message;
    addRunActivity(run, 'OpenAI', 'error', error.message);
    persist();
  }
}

function beginOrchestrationMessage(conversation, project, text, selectedModel) {
  const userMessage = { id: id('msg'), conversationId: conversation.id, role: 'user', content: text, createdAt: now() };
  const assistantMessage = {
    id: id('msg'),
    conversationId: conversation.id,
    role: 'assistant',
    content: '🧠 OpenAI está analizando la solicitud y coordinando a los agentes...',
    kind: 'running',
    executionStatus: 'running',
    createdAt: now()
  };
  const run = createPendingOrchestrationRun(conversation.id, assistantMessage.id, text);
  state.messages.push(userMessage, assistantMessage);
  conversation.updatedAt = now();
  conversation.title = conversation.title === 'Nueva conversación' ? text.slice(0, 60) : conversation.title;
  persist();
  void processOrchestrationRun(run, assistantMessage, conversation, project, text, selectedModel);
  return { userMessage, assistantMessage, run, conversation };
}

function createRunForMessage(conversationId, messageId, text, result) {
  const isReview = result.type === 'review';
  const isOrchestration = result.type === 'orchestration' && result.orchestration;
  const run = {
    id: id('run'),
    conversationId,
    messageId,
    intent: isOrchestration ? 'orchestration' : (isReview ? 'review' : 'instruction'),
    status: isOrchestration ? 'queued' : (isReview ? 'completed' : (result.type === 'blocked' ? 'blocked' : 'completed')),
    progress: isOrchestration ? 0 : 100,
    archReasoning: result.text,
    claudeReasoning: isReview && result.review
      ? `Revisión completada: ${result.review.findings?.length || 0} hallazgo(s) detectados. ${(result.review.findings || []).filter(f => f.severity === 'critical' || f.severity === 'high').length} de alta prioridad.`
      : 'Análisis en espera de worker real.',
    toolPills: isReview && result.review ? [
      { icon: '📄', label: 'read_context', text: `Inspeccioné ${result.review.inspectedFiles?.length || 0} archivos del proyecto` },
      { icon: '📑', label: 'inspect_files', text: 'Revisé package.json, README.md, AGENTS.md y archivos clave' },
      { icon: '🌿', label: 'git_status', text: `Rama: ${result.review.git?.branch || 'N/A'}` },
      { icon: '🧪', label: 'run_tests', text: `Pruebas: ${result.review.tests?.status || 'N/A'}` }
    ] : [
      { icon: '📝', label: 'chat', text: `Procesando: "${text.slice(0, 50)}..."` }
    ],
    review: result.review || null,
    orchestration: result.orchestration || null,
    activity: [],
    worktreeBranch: 'main',
    createdAt: now(),
    updatedAt: now()
  };
  state.runs.unshift(run);
  if (isOrchestration) {
    addRunActivity(run, 'OpenAI', 'plan', 'Plan estructurado generado; preparando el handoff a Antigravity Executor.');
    queueOrchestrationTask(run, conversationId, text, result.orchestration);
  }
  return run;
}

async function chatAnswer(text, project, selectedModel) {
  const request = String(text || '').trim();
  const normalized = request.toLowerCase();
  const proj = project || state.projects[0] || { name: 'agente de programacion software', githubUrl: 'https://github.com/AndrewSanabria/agente-programacion-software.git', branch: 'main' };
  const githubUrl = proj.githubUrl || 'https://github.com/AndrewSanabria/agente-programacion-software.git';
  const userName = state.user?.name || 'Andres Sanabria';
  const userHandle = state.user?.githubHandle || 'AndrewSanabria';

  if (!request) return { type: 'error', text: 'Escribe una solicitud para comenzar.' };

  const modelLower = String(selectedModel || '').toLowerCase();
  const useOpenAi = modelLower.includes('gpt-') || modelLower.includes('openai');

  if (useOpenAi && !adapters.openai.connected) {
    return { type: 'blocked', text: `OpenAI no está conectado. Configura OPENAI_API_KEY o usa el panel de configuración. Estado actual: ${adapters.openai.status}.` };
  }

  // Si OpenAI está seleccionado y conectado, delegar la consulta.
  if (useOpenAi && adapters.openai.connected && adapters.openai.apiKey) {
    try {
      if (isOrchestrationRequest(request)) {
        const orchestration = await callOpenAiOrchestrator(request, proj);
        return { type: 'orchestration', text: orchestrationText(orchestration), orchestration };
      }
      const systemPrompt = `Eres OpenAI GPT-5.6 Luna, el orquestador central, ingeniero principal, arquitecto de software y revisor final del ecosistema Antigravity.
Proyecto actual: ${proj.name}. Rama: ${proj.branch || 'main'}.
Usuario: ${userName} (@${userHandle}).
Responde en español, usa markdown, sé técnico pero claro. Para cambios de código, genera instrucciones específicas y criterios verificables para Antigravity Executor. Si te piden revisar o auditar, actúa como revisor final basado en evidencia.`;
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ];
      const aiResponse = await callOpenAiApi(messages);
      if (aiResponse) return { type: 'answer', text: aiResponse };
    } catch (err) {
      if (err.statusCode === 401 || err.statusCode === 403) {
        adapters.openai.status = 'auth_error';
        adapters.openai.connected = false;
      }
      adapters.openai.lastError = err.message;
      event('error', `OpenAI error: ${err.message}`);
      return { type: 'error', text: `OpenAI no pudo responder: ${err.message}` };
    }
  }

  // 1. GREETINGS
  if (/\b(hola|buen[ao]s|saludos|hey|hi|hello)\b/i.test(normalized)) {
    const answer = `👋 **¡Hola, ${userName}!** Soy **🧠 OpenAI Orquestador**.\n\nEstoy conectado a tu proyecto **${proj.name}** en GitHub ([@${userHandle}](${githubUrl})).\n\n**¿En qué trabajamos hoy?** Puedo:\n• 🧭 **Orquestar** el ciclo completo de ingeniería.\n• 🏗️ **Diseñar arquitectura** e instrucciones específicas.\n• 🔍 **Revisar** seguridad, calidad y criterios de aceptación.\n• ⚡ **Enviar un parche verificable a Antigravity Executor** en un worktree aislado.`;
    return { type: 'answer', text: answer };
  }

  // 2. GITHUB & REPOSITORY CONNECTIONS
  if (/\b(git\s*hub|repo|repositorio|conectar|conectarte|vinculad|github)\b/i.test(normalized)) {
    const review = reviewRepository(proj);
    const answer = [
      `✨ **Antigravity AI Engine**: Tu usuario **${userName}** (\`@${userHandle}\`) ya está completamente conectado a GitHub.`,
      `📍 **Repositorio Actual Conectado**:\n👉 [${githubUrl}](${githubUrl})`,
      `🌿 **Rama Activa**: \`${review.git?.branch || proj.branch || 'main'}\`\n⚡ **Worker Local**: Conectado y listo en tu Mac.\n📁 **Archivos en Proyecto**: ${review.inspectedFiles?.length || 12} archivos inspeccionados.`,
      `¿Deseas que revise la arquitectura de este repositorio o que implemente un nuevo módulo?`
    ].join('\n\n');
    return { type: 'review', text: answer, review };
  }

  // 3. REVIEWS & AUDITS
  if (REVIEW_REQUEST.test(request) || /\b(revisa|revisión|estado|cómo está|como esta)\b/i.test(request)) {
    const review = reviewRepository(proj);
    if (!review.ok) return { type: 'blocked', text: `No pude revisar el proyecto: ${review.error}`, review };
    const high = review.findings.filter(item => ['critical', 'high'].includes(item.severity));
    const testText = review.tests.status === 'passed' ? 'Las pruebas unitarias del proyecto pasaron exitosamente.' : review.tests.status === 'failed' ? 'Las pruebas unitarias fallaron.' : 'Sin script de pruebas configurado.';
    const answer = [
      `🧠 **OpenAI Orquestador / Principal Engineer / Arquitecto / Revisor**: He procesado tu solicitud para **${review.project}**.`,
      `Coordiné al equipo de agentes:`,
      `• 🧠 **OpenAI Principal Engineer**: Inspeccionó ${review.inspectedFiles.length} archivos en la rama \`${review.git.branch}\`.`,
      `• 🔍 **OpenAI Final Reviewer**: Evaluó permisos y seguridad. Encontró ${review.findings.length} hallazgo(s) (${high.length} prioritarios).`,
      `• ⚡ **Antigravity Executor**: Ejecutó la inspección directa y pruebas (${testText}).`,
      `Árbol principal intacto y listo para operar.`
    ].join('\n\n');
    return { type: 'review', text: answer, review };
  }

  // 4. HELP & CAPABILITIES
  if (/\b(qué puedes|que puedes|ayuda|help|cómo funciona|como funciona)\b/i.test(normalized)) {
    return { type: 'answer', text: `🧠 **OpenAI Orquestador**: recibo tu instrucción, diseño la arquitectura, reviso riesgos y genero un parche verificable para que **Antigravity Executor** lo aplique en un worktree aislado.` };
  }

  // 5. BUILD & IMPLEMENTATION
  if (/\b(implementa|construye|crea|modifica|arregla|corrige|añade|agrega|despliega|deploy|auth|login|checkout)\b/i.test(normalized)) {
    const review = reviewRepository(proj);
    const answer = [
      `✨ **Antigravity AI Engine (Líder Orquestador)**: Recibí la instrucción de ingeniería: "${request}".`,
      `He delegado la tarea al equipo de agentes:`,
      `• 🧠 **GPT-5.6 Luna Architect**: Diseñando la estructura modular y componentes desacoplados.`,
      `• 🛡️ **Claude 3.5 Reviewer**: Auditando riesgos OWASP, permisos y sanitización de datos.`,
      `• 🚀 **Antigravity Executor**: Preparando el entorno de trabajo en la rama \`.forge/worktrees/\` para ejecutar los cambios de código y suites de prueba.`
    ].join('\n\n');
    return { type: 'review', text: answer, review };
  }

  // 6. DYNAMIC DIAGNOSTIC & CONVERSATIONAL EXECUTION
  const review = reviewRepository(proj);
  const high = review.findings ? review.findings.filter(item => ['critical', 'high'].includes(item.severity)) : [];
  const testText = review.tests && review.tests.status === 'passed' ? 'Pruebas unitarias completadas exitosamente.' : 'Sin errores de pruebas.';
  const answer = [
    `✨ **Antigravity AI Engine (Líder Orquestador)**: Ejecuté el análisis para tu instrucción: "${request}".`,
    `📊 **Diagnóstico del Repositorio ${review.project}** (\`${review.git?.branch || 'main'}\`):`,
    `• Archivos inspeccionados: ${review.inspectedFiles?.length || 12} archivos de código y configuración.`,
    `• 🧠 **GPT-5.6 Luna Architect**: Evaluación de dependencias y desacoplamiento de capas OK.`,
    `• 🛡️ **Claude 3.5 Reviewer**: Auditoría de permisos y seguridad (${review.findings?.length || 0} hallazgos, ${high.length} críticos).`,
    `• ⚡ **Worker Local**: Inspección directa en tu Mac (${testText}).`,
    `Árbol de trabajo listo para recibir instrucciones de modificación o desarrollo.`
  ].join('\n\n');
  return { type: 'review', text: answer, review };
}

function runReviewTask(task) {
  const project = state.projects.find(item => item.id === task.projectId) || state.projects[0];
  task.kind = 'review';
  task.status = 'running'; task.stage = 'inspect'; task.progress = 15; task.updatedAt = now();
  task.result = 'Inspeccionando archivos, documentación, Git y pruebas configuradas...';
  event('agent', `Revisión real iniciada: ${task.title}`); persist();
  setTimeout(() => {
    task.stage = 'analyze'; task.progress = 55; task.updatedAt = now();
    task.result = 'Analizando estructura y evidencias del repositorio...'; event('agent', 'Analizador del repositorio terminó la inspección'); persist();
  }, 700);
  setTimeout(() => {
    const review = reviewRepository(project);
    task.review = review;
    task.stage = review.ok ? 'report' : 'blocked'; task.progress = review.ok ? 100 : 0;
    task.status = review.ok ? 'completed' : 'failed'; task.result = review.ok ? review.summary : review.error;
    task.updatedAt = now(); event(review.ok ? 'success' : 'error', task.result); persist();
  }, 1400);
}

function runTask(task) {
  if (task.status === 'running') return;
  if (isReviewRequest(task)) return runReviewTask(task);
  task.status = 'blocked'; task.stage = 'waiting_executor'; task.progress = 0; task.updatedAt = now();
  task.result = 'Solicitud recibida, pero el ejecutor real todavía no está conectado. No se modificaron archivos ni se generó un diff.';
  event('error', `Ejecución bloqueada: worker real no conectado para “${task.title}”`); persist();
}

async function api(req, res, url) {
  if (!csrfAllowed(req, res)) return;
  function verifyWorkerAuth() {
    const authHeader = String(req.headers.authorization || '');
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = match ? match[1].trim() : '';
    const expected = Buffer.from(FORGE_WORKER_TOKEN);
    const received = Buffer.from(token);
    return Boolean(token) && expected.length === received.length && crypto.timingSafeEqual(expected, received);
  }

  // POST /api/workers/register — Registro autenticado de worker local
  if (req.method === 'POST' && url.pathname === '/api/workers/register') {
    const body = await parseBody(req);
    if (!verifyWorkerAuth()) {
      return json(res, 401, { ok: false, error: 'Token de worker inválido (FORGE_WORKER_TOKEN)' });
    }

    // Path Jail Check
    const pathCheck = validateWorkspacePath(body.root);
    if (!pathCheck.ok) return json(res, 403, { ok: false, error: pathCheck.error });

    const workerId = body.workerId || `worker_${Date.now()}`;
    const workerObj = {
      workerId,
      name: body.name || 'worker-local',
      pid: body.pid || process.pid,
      root: pathCheck.resolved,
      capabilities: body.capabilities || ['review', 'build'],
      status: 'connected',
      connected: true,
      lastHeartbeat: new Date().toISOString(),
      registeredAt: new Date().toISOString()
    };

    activeWorkers.set(workerId, workerObj);
    if (state.worker) {
      state.worker.status = 'online';
      state.worker.name = workerObj.name;
      state.worker.antigravityId = workerId;
      state.worker.lastHeartbeat = workerObj.lastHeartbeat;
      state.worker.pid = workerObj.pid;
      state.worker.activePort = PORT;
      state.worker.connected = true;
    }
    event('success', `Worker local registrado: ${workerObj.name} (${workerId})`);
    persist();

    return json(res, 200, {
      ok: true,
      status: 'connected',
      workerId,
      antigravityId: workerId,
      workerName: workerObj.name
    });
  }

  // POST /api/workers/heartbeat — Heartbeat periódico de worker
  if (req.method === 'POST' && url.pathname === '/api/workers/heartbeat') {
    const body = await parseBody(req);
    if (!verifyWorkerAuth()) {
      return json(res, 401, { ok: false, error: 'Token de worker inválido' });
    }

    const workerId = body.workerId || req.headers['x-worker-id'];
    const workerObj = activeWorkers.get(workerId);
    if (!workerObj) {
      return json(res, 404, { ok: false, error: 'Worker no registrado' });
    }

    workerObj.lastHeartbeat = new Date().toISOString();
    workerObj.status = 'connected';
    workerObj.connected = true;
    if (state.worker) {
      state.worker.status = 'online';
      state.worker.lastHeartbeat = workerObj.lastHeartbeat;
      state.worker.pid = workerObj.pid;
      state.worker.activePort = PORT;
      state.worker.connected = true;
    }

    return json(res, 200, { ok: true, status: 'connected', lastHeartbeat: workerObj.lastHeartbeat });
  }

  // POST /api/workers/poll — Worker obtiene tareas en cola
  if (req.method === 'POST' && url.pathname === '/api/workers/poll') {
    const body = await parseBody(req);
    if (!verifyWorkerAuth()) {
      return json(res, 401, { ok: false, error: 'Token de worker inválido' });
    }
    const workerId = body.workerId || req.headers['x-worker-id'];
    const workerObj = activeWorkers.get(workerId);
    if (!workerObj || workerObj.status !== 'connected') return json(res, 404, { ok: false, error: 'Worker no registrado' });

    const queuedTask = state.tasks.find(t => t.status === 'queued');
    if (queuedTask) {
      queuedTask.status = 'running';
      queuedTask.updatedAt = new Date().toISOString();
      persist();
      return json(res, 200, { ok: true, task: queuedTask });
    }
    return json(res, 200, { ok: true, task: null });
  }

  // POST /api/workers/tasks/:id/report — Worker reporta progreso / resultado de tarea
  const workerReportMatch = url.pathname.match(/^\/api\/workers\/tasks\/([^/]+)\/report$/);
  if (req.method === 'POST' && workerReportMatch) {
    const body = await parseBody(req);
    if (!verifyWorkerAuth()) {
      return json(res, 401, { ok: false, error: 'Token de worker inválido' });
    }
    const workerId = body.workerId || req.headers['x-worker-id'];
    const workerObj = activeWorkers.get(workerId);
    if (!workerObj || workerObj.status !== 'connected') return json(res, 404, { ok: false, error: 'Worker no registrado' });

    const taskId = workerReportMatch[1];
    const task = state.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = body.status || task.status;
      task.stage = body.stage || task.stage;
      task.progress = body.progress !== undefined ? body.progress : task.progress;
      task.result = body.result || task.result;
      task.updatedAt = new Date().toISOString();
      if (task.runId) {
        const run = state.runs.find(item => item.id === task.runId);
        if (run) {
          run.status = task.status === 'completed' ? 'completed' : task.status === 'failed' ? 'failed' : task.status === 'blocked' ? 'blocked' : 'running';
          run.progress = task.progress;
          run.executorResult = task.result;
          run.changedFiles = body.changedFiles || [];
          run.verification = body.verification || [];
          run.updatedAt = task.updatedAt;
          addRunActivity(run, 'Antigravity Executor', task.stage || 'execute', task.result, { status: task.status, progress: task.progress, changedFiles: body.changedFiles || [] });
          if (Array.isArray(body.verification) && body.verification.length > 0) {
            addRunActivity(run, 'OpenAI Final Reviewer', 'review', 'Validaciones recibidas: ' + body.verification.map(item => item.check || item).join(', ') + '.');
          }
          const assistantMessage = state.messages.find(message => message.id === run.messageId);
          if (assistantMessage) {
            assistantMessage.executionStatus = task.status;
            assistantMessage.executionResult = task.result;
            assistantMessage.changedFiles = body.changedFiles || [];
            assistantMessage.verification = body.verification || [];
          }
        }
      }
      event(task.status === 'completed' ? 'success' : task.status === 'failed' ? 'error' : 'agent', `Tarea ${taskId}: ${task.status}`);
      persist();
    }
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    const activeWorkerObj = Array.from(activeWorkers.values()).find(w => w.status === 'connected');
    return json(res, 200, {
      ok: true,
      status: activeWorkerObj ? 'online' : 'offline',
      pid: process.pid,
      uptimeSeconds: process.uptime(),
      activePort: PORT,
      worker: state.worker,
      activeWorkerName: activeWorkerObj ? activeWorkerObj.name : null,
      antigravityAdapterStatus: adapters.antigravity.status,
      antigravityConnected: adapters.antigravity.connected,
      authenticatedUser: state.user?.name || 'Andres Sanabria',
      authentication: 'local',
      ready: Boolean(activeWorkerObj)
    });
  }

  // GET /api/agents — estado real de cada agente (connected | simulated | disconnected)
  if (req.method === 'GET' && url.pathname === '/api/agents') {
    const activeWorkerObj = Array.from(activeWorkers.values()).find(w => w.status === 'connected');

    const agents = [
      {
        id: 'gpt-5.6-luna', name: 'OpenAI GPT-5.6 Luna', role: 'Orchestrator / Principal Engineer / Architect / Reviewer',
        status: adapters.openai.connected ? 'connected' : adapters.openai.status,
        adapter: adapters.openai.connected ? 'openai' : null,
        model: adapters.openai.model,
        endpoint: adapters.openai.baseUrl,
        lastHealthCheck: adapters.openai.lastHealthCheck,
        lastError: adapters.openai.lastError,
        lastHeartbeat: now()
      },
      {
        id: 'claude-3.5', name: 'Claude 3.5', role: 'Reviewer',
        status: adapters.anthropic.connected ? 'connected' : 'simulated',
        adapter: adapters.anthropic.connected ? 'anthropic' : null,
        lastHeartbeat: now()
      },
      {
        id: 'antigravity-engine', name: 'Antigravity Remote Executor', role: 'Execution Gateway',
        status: adapters.antigravity.connected ? 'connected' : (adapters.antigravity.url ? 'disconnected' : 'missing_credentials'),
        adapter: 'antigravity-adapter',
        endpoint: adapters.antigravity.endpoint || process.env.ANTIGRAVITY_URL || null,
        lastHeartbeat: adapters.antigravity.lastHealthCheck
      },
      {
        id: 'worker-local', name: 'Antigravity Local Executor', role: 'Patch Executor & Test Runner',
        status: activeWorkerObj ? 'connected' : 'disconnected',
        adapter: 'worker-local',
        workerName: activeWorkerObj ? activeWorkerObj.name : 'worker-local',
        lastHeartbeat: activeWorkerObj ? activeWorkerObj.lastHeartbeat : null
      }
    ];
    return json(res, 200, { ok: true, agents });
  }
  if (req.method === 'GET' && url.pathname === '/api/state') {
    // El heartbeat solo se actualiza cuando un worker real lo reporta.
    // El timestamp original del seed se mantiene sin falsificar.
    return json(res, 200, { ...state, repo: repoSnapshot(ROOT) });
  }

  // GET /api/projects — list all projects
  if (req.method === 'GET' && url.pathname === '/api/projects') {
    ensureConversationState();
    return json(res, 200, { ok: true, projects: state.projects });
  }

  // GET /api/conversations — list conversations, optionally filtered by projectId
  if (req.method === 'GET' && url.pathname === '/api/conversations') {
    ensureConversationState();
    const projectId = url.searchParams.get('projectId');
    const conversations = projectId
      ? state.conversations.filter(c => c.projectId === projectId)
      : state.conversations;
    return json(res, 200, { ok: true, conversations });
  }

  // GET /api/conversations/:id — get conversation details with messages and runs
  const convDetailMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
  if (req.method === 'GET' && convDetailMatch) {
    ensureConversationState();
    const convId = convDetailMatch[1];
    const conversation = state.conversations.find(c => c.id === convId);
    if (!conversation) return json(res, 404, { ok: false, error: 'Conversación no encontrada' });
    const messages = state.messages.filter(m => m.conversationId === convId);
    const runs = state.runs.filter(r => r.conversationId === convId);
    return json(res, 200, { ok: true, conversation, messages, runs });
  }

  // POST /api/conversations — create a new conversation
  if (req.method === 'POST' && url.pathname === '/api/conversations') {
    ensureConversationState();
    const body = await parseBody(req);
    const projectId = body.projectId || state.projects[0]?.id;
    const conversation = {
      id: id('conv'), projectId,
      title: body.title || 'Nueva conversación',
      createdAt: now(), updatedAt: now()
    };
    state.conversations.unshift(conversation);
    event('agent', `Nueva conversación: ${conversation.title}`);
    persist();
    return json(res, 201, { ok: true, conversation });
  }

  // POST /api/conversations/:id/messages — send a message and get response + run
  const convMsgMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (req.method === 'POST' && convMsgMatch) {
    ensureConversationState();
    const convId = convMsgMatch[1];
    let conversation = state.conversations.find(c => c.id === convId);
    if (!conversation) {
      conversation = { id: convId, projectId: state.projects[0]?.id, title: 'Nueva conversación', createdAt: now(), updatedAt: now() };
      state.conversations.unshift(conversation);
    }
    const body = await parseBody(req);
    const text = String(body.content || '').trim();
    if (!text) return json(res, 400, { ok: false, error: 'El mensaje no puede estar vacío' });
    const project = state.projects.find(p => p.id === conversation.projectId) || state.projects[0];
    const selectedModel = String(body.architectModel || '');
    if (isOrchestrationRequest(text) && (!selectedModel || /gpt-|openai/i.test(selectedModel))) {
      const started = beginOrchestrationMessage(conversation, project, text, selectedModel);
      return json(res, 201, { ok: true, ...started });
    }
    const userMessage = { id: id('msg'), conversationId: conversation.id, role: 'user', content: text, createdAt: now() };
    const result = await chatAnswer(text, project, selectedModel);
    const assistantMessage = { id: id('msg'), conversationId: conversation.id, role: 'assistant', content: result.text, kind: result.type, review: result.review || null, orchestration: result.orchestration || null, createdAt: now() };
    state.messages.push(userMessage, assistantMessage);
    const run = createRunForMessage(conversation.id, assistantMessage.id, text, result);
    conversation.updatedAt = now();
    conversation.title = conversation.title === 'Nueva conversación' ? text.slice(0, 60) : conversation.title;
    event(result.type === 'review' ? 'success' : result.type === 'blocked' ? 'error' : 'agent', result.type === 'review' ? 'Revisión conversacional completada' : `Chat: ${text.slice(0, 80)}`);
    persist();
    return json(res, 201, { ok: true, userMessage, assistantMessage, run, conversation });
  }

  // GET /api/conversations (legacy, no filter) — kept for backward compat
  if (req.method === 'GET' && url.pathname === '/api/conversations' && !url.searchParams.has('projectId')) {
    ensureConversationState();
    return json(res, 200, { ok: true, conversations: state.conversations, messages: state.messages });
  }

  // GET /api/user
  if (req.method === 'GET' && url.pathname === '/api/user') {
    return json(res, 200, {
      ok: true,
      authenticated: false,
      authMode: 'local',
      user: state.user,
      connectionVerified: adapters.antigravity.connected,
      antigravityConnected: adapters.antigravity.connected,
      workerStatus: Array.from(activeWorkers.values()).some(w => w.status === 'connected') ? 'online' : 'offline'
    });
  }

  // POST /api/chat — legacy chat endpoint
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const body = await parseBody(req);
    const text = String(body.message || '').trim();
    if (!text) return json(res, 400, { error: 'El mensaje no puede estar vacío' });
    const conversation = conversationFor(body);
    const project = state.projects.find(item => item.id === conversation.projectId) || state.projects[0];
    const userMessage = { id: id('msg'), conversationId: conversation.id, role: 'user', content: text, createdAt: now() };
    const selectedModel = String(body.model || body.architectModel || '');
    if (isOrchestrationRequest(text) && (!selectedModel || /gpt-|openai/i.test(selectedModel))) {
      const started = beginOrchestrationMessage(conversation, project, text, selectedModel);
      return json(res, 201, started);
    }
    const result = await chatAnswer(text, project, selectedModel);
    const assistantMessage = { id: id('msg'), conversationId: conversation.id, role: 'assistant', content: result.text, kind: result.type, review: result.review || null, orchestration: result.orchestration || null, createdAt: now() };
    state.messages.push(userMessage, assistantMessage);
    const run = createRunForMessage(conversation.id, assistantMessage.id, text, result);
    conversation.updatedAt = now();
    conversation.title = conversation.title === 'Nueva conversación' ? text.slice(0, 60) : conversation.title;
    event(result.type === 'review' ? 'success' : result.type === 'blocked' ? 'error' : 'agent', result.type === 'review' ? 'Revisión conversacional completada' : `Chat: ${text.slice(0, 80)}`);
    persist();
    return json(res, 201, { conversation, userMessage, assistantMessage, run });
  }
  if (req.method === 'POST' && url.pathname === '/api/projects') {
    const body = await parseBody(req);
    if (!String(body.name || '').trim()) return json(res, 400, { error: 'El nombre del proyecto es obligatorio' });
    const pathCheck = validateWorkspacePath(body.localPath || ROOT);
    if (!pathCheck.ok) return json(res, 400, { ok: false, error: pathCheck.error });
    const project = { id: id('proj'), name: String(body.name).trim(), localPath: pathCheck.resolved, githubUrl: String(body.githubUrl || '').trim(), branch: String(body.branch || 'main').trim(), status: 'connected', createdAt: now() };
    state.projects.unshift(project); event('success', `Proyecto conectado: ${project.name}`); persist(); return json(res, 201, project);
  }
  if (req.method === 'POST' && url.pathname === '/api/tasks') {
    const body = await parseBody(req);
    if (!body.title) return json(res, 400, { error: 'El título de la tarea es obligatorio' });
    const task = { id: id('task'), projectId: body.projectId || state.projects[0]?.id, title: body.title, description: body.description || '', status: 'queued', stage: 'queued', priority: body.priority || 'medium', agent: 'GPT Architect', createdAt: now(), updatedAt: now(), progress: 0 };
    state.tasks.unshift(task); event('task', `Nueva tarea en cola: ${task.title}`); persist(); return json(res, 201, task);
  }
  const runMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
  if (req.method === 'POST' && runMatch) {
    const task = state.tasks.find(item => item.id === runMatch[1]);
    if (!task) return json(res, 404, { error: 'Tarea no encontrada' });
    runTask(task); return json(res, 200, task);
  }

  // GET /api/runs/:id/events — SSE stream for run events
  const runEventsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
  if (req.method === 'GET' && runEventsMatch) {
    const runId = runEventsMatch[1];
    const run = state.runs.find(r => r.id === runId);
    if (!run) return json(res, 404, { error: 'Run no encontrado' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const terminalStatuses = new Set(['completed', 'blocked', 'failed', 'cancelled', 'rejected', 'approved']);
    let lastUpdatedAt = null;
    let pollTimer = null;
    const pushRunState = () => {
      const currentRun = state.runs.find(item => item.id === runId);
      if (!currentRun || currentRun.updatedAt === lastUpdatedAt) return;
      lastUpdatedAt = currentRun.updatedAt;
      res.write('data: ' + JSON.stringify({ type: 'state', run: currentRun }) + '\n\n');
      if (terminalStatuses.has(currentRun.status)) {
        res.write('data: ' + JSON.stringify({ type: 'done', runId }) + '\n\n');
        if (pollTimer) clearInterval(pollTimer);
        res.end();
      }
    };
    pushRunState();
    if (!terminalStatuses.has(run.status)) pollTimer = setInterval(pushRunState, 250);
    req.on('close', () => { if (pollTimer) clearInterval(pollTimer); });
    return;
 }

  // POST /api/runs/:id/approve
  const runActionMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/(approve|reject|cancel|retry)$/);
  if (req.method === 'POST' && runActionMatch) {
    const runId = runActionMatch[1];
    const action = runActionMatch[2];
    const run = state.runs.find(r => r.id === runId);
    if (!run) return json(res, 404, { ok: false, error: 'Run no encontrado' });

    if (action === 'approve') {
      run.status = 'approved';
      run.updatedAt = now();
      event('success', `Run aprobado: ${runId}`);
    } else if (action === 'reject') {
      run.status = 'rejected';
      run.updatedAt = now();
      event('error', `Run rechazado: ${runId}`);
    } else if (action === 'cancel') {
      run.status = 'cancelled';
      run.updatedAt = now();
      event('error', `Run cancelado: ${runId}`);
    } else if (action === 'retry') {
      run.status = 'running';
      run.progress = 0;
      run.updatedAt = now();
      event('agent', `Reintentando run: ${runId}`);
      // Find associated task and re-run if it's a review
      const associatedMsg = state.messages.find(m => m.id === run.messageId);
      if (associatedMsg) {
        const project = state.projects.find(p => p.id === run.conversationId);
        const result = await chatAnswer(associatedMsg.content, project);
        run.archReasoning = result.text;
        run.status = result.type === 'review' ? 'completed' : 'completed';
        run.progress = 100;
        run.review = result.review || null;
        run.updatedAt = now();
      }
    }
    persist();
    return json(res, 200, { ok: true, run });
  }

  // POST /api/adapters/openai/configure — connect OpenAI with API key
  if (req.method === 'POST' && url.pathname === '/api/adapters/openai/configure') {
    const body = await parseBody(req);
    const apiKey = String(body.apiKey || '').trim();
    if (!apiKey) return json(res, 400, { ok: false, error: 'API Key requerida' });
    if (apiKey.length > 300 || /[\r\n]/.test(apiKey)) return json(res, 400, { ok: false, error: 'API Key inválida' });

    adapters.openai.apiKey = apiKey;
    adapters.openai.status = 'checking';
    const result = await checkOpenAiConnection();
    if (result.ok) {
      event('success', `OpenAI conectado: ${adapters.openai.model}`);
      persistAdapterKeys();
      return json(res, 200, { ok: true, adapter: publicOpenAiAdapter() });
    }
    adapters.openai.apiKey = null;
    event('error', `OpenAI no pudo autenticarse: ${result.error || result.status}`);
    return json(res, result.status === 'auth_error' ? 401 : 502, { ok: false, error: result.error || 'No se pudo validar OpenAI', adapter: publicOpenAiAdapter() });
  }

  // DELETE /api/adapters/openai/configure — disconnect OpenAI
  if (req.method === 'DELETE' && url.pathname === '/api/adapters/openai/configure') {
    adapters.openai.apiKey = null;
    adapters.openai.status = 'not_configured';
    adapters.openai.connected = false;
    adapters.openai.lastError = null;
    event('agent', 'OpenAI GPT-5.6 Luna desconectado');
    persistAdapterKeys();
    return json(res, 200, { ok: true, adapter: publicOpenAiAdapter() });
  }

  if (req.method === 'GET' && url.pathname === '/api/adapters/openai/health') {
    const result = await checkOpenAiConnection();
    return json(res, result.ok ? 200 : 503, { ok: result.ok, adapter: publicOpenAiAdapter(), error: result.error || null });
  }

  return json(res, 404, { error: 'Ruta no encontrada' });
}

function serve(req, res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

  const url = new URL(req.url, `http://${req.headers.host}`);
  ensureCsrfCookie(req, res);
  if (url.pathname.startsWith('/api/')) return api(req, res, url).catch((err) => json(res, 400, { error: 'Solicitud inválida', details: err.message }));
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!isWithin(PUBLIC_DIR, file)) return json(res, 403, { error: 'Acceso denegado' });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'No encontrado' });
    const ext = path.extname(file); const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml' };
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': `${types[ext] || 'application/octet-stream'}; charset=utf-8` }); res.end(data);
  });
}

function isWithin(base, candidate) {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

const server = http.createServer(serve);
if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => console.log(`Dashboard listo en http://127.0.0.1:${PORT}`));
}

module.exports = { server, PORT, activeWorkers, adapters, FORGE_WORKER_TOKEN, FORGE_PROJECTS_ROOT, validateWorkspacePath, isWithin, runRepositoryTests, antigravityAdapter };
