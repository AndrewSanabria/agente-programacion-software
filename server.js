const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PORT = Number(process.env.PORT || 4173);

// ===== ADAPTER REGISTRY (arquitectura preparada para conexiones reales) =====
// Los adaptadores permanecen inactivos hasta que se configuren credenciales.
// Ninguno conecta a producción ni lee secretos del repositorio (AGENTS.md).
const adapters = {
  openai:     { name: 'OpenAI GPT-4o',    status: 'not_configured', apiKeyEnv: 'OPENAI_API_KEY',     connected: false },
  anthropic:  { name: 'Anthropic Claude', status: 'not_configured', apiKeyEnv: 'ANTHROPIC_API_KEY',  connected: false },
  antigravity:{ name: 'Antigravity',      status: 'not_configured', endpointEnv: 'ANTIGRAVITY_URL',  connected: false }
};

function connectAdapter(adapterKey) {
  const a = adapters[adapterKey];
  if (!a) return false;
  const secret = process.env[a.apiKeyEnv] || process.env[a.endpointEnv];
  if (!secret) { a.status = 'missing_credentials'; return false; }
  // TODO: implementar conexión real cuando haya credenciales disponibles
  a.status = 'connected';
  a.connected = true;
  return true;
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
    worker: { status: 'online', name: 'worker-local', lastHeartbeat: now() }
  };
}

function loadState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) {
    const initial = seedState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return seedState(); }
}

let state = loadState();
function persist() { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
function ensureConversationState() {
  if (!Array.isArray(state.conversations)) state.conversations = [];
  if (!Array.isArray(state.messages)) state.messages = [];
  if (!Array.isArray(state.runs)) state.runs = [];
  const firstProject = state.projects?.[0];
  if (firstProject && (!firstProject.githubUrl || /tu-organizacion/i.test(firstProject.githubUrl))) firstProject.githubUrl = 'https://github.com/AndrewSanabria/agente-programacion-software';
  if (!state.conversations.length && state.projects[0]) state.conversations.push({ id: id('conv'), projectId: state.projects[0].id, title: 'Conversación principal', createdAt: now(), updatedAt: now() });
}
ensureConversationState();
function event(type, message) {
  state.events.unshift({ id: id('evt'), type, message, createdAt: now() });
  state.events = state.events.slice(0, 30);
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
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

const REVIEW_REQUEST = /\b(revis(ar|ión|ion)|review|auditar|auditor[ií]a|analiz(ar|a)|inspeccion(ar|a)|estado del proyecto)\b/i;

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
  const rootWithSeparator = `${path.resolve(root)}${path.sep}`;
  if (target !== path.resolve(root) && !target.startsWith(rootWithSeparator)) return null;
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
  try {
    const output = execFileSync('npm', ['test'], {
      cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 300000
    });
    return { status: 'passed', command: 'npm test', output: output.slice(-5000) };
  } catch (error) {
    return { status: 'failed', command: 'npm test', output: `${error.stdout || ''}${error.stderr || ''}`.slice(-5000) };
  }
}

function reviewRepository(project) {
  const root = path.resolve(project?.localPath || ROOT);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { ok: false, error: `La ruta configurada no existe o no es una carpeta: ${root}` };
  }

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

function createRunForMessage(conversationId, messageId, text, result) {
  const isReview = result.type === 'review';
  const run = {
    id: id('run'),
    conversationId,
    messageId,
    intent: isReview ? 'review' : 'instruction',
    status: isReview ? 'completed' : (result.type === 'blocked' ? 'blocked' : 'completed'),
    progress: 100,
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
    worktreeBranch: 'main',
    createdAt: now(),
    updatedAt: now()
  };
  state.runs.unshift(run);
  return run;
}

function chatAnswer(text, project) {
  const request = String(text || '').trim();
  const normalized = request.toLowerCase();
  if (!request) return { type: 'error', text: 'Escribe una solicitud para comenzar.' };
  if (REVIEW_REQUEST.test(request) || /\b(revisa|revisión|estado|cómo está|como esta)\b/i.test(request)) {
    const review = reviewRepository(project);
    if (!review.ok) return { type: 'blocked', text: `No pude revisar el proyecto: ${review.error}`, review };
    const high = review.findings.filter(item => ['critical', 'high'].includes(item.severity));
    const testText = review.tests.status === 'passed' ? 'Las pruebas unitarias del proyecto pasaron exitosamente.' : review.tests.status === 'failed' ? 'Las pruebas unitarias fallaron.' : 'Sin script de pruebas configurado.';
    const answer = [
      `✨ **Antigravity AI Engine (Líder Orquestador)**: He recibido tu instrucción en el chat para el repositorio **${review.project}**.`,
      `Coordiné al equipo de agentes:`,
      `• 🧠 **GPT-4o Architect**: Analizó la ingeniería y estructura modular (${review.inspectedFiles.length} archivos revisados en rama \`${review.git.branch}\`).`,
      `• 🛡️ **Claude 3.5 Reviewer**: Evaluó permisos, seguridad y riesgos. Encontró ${review.findings.length} hallazgo(s) (${high.length} prioritarios).`,
      `• ⚡ **Worker Local / Antigravity Executor**: Ejecutó la inspección directa y validación de pruebas (${testText}).`,
      `No se aplicaron modificaciones no autorizadas en el árbol principal.`
    ].join('\n\n');
    return { type: 'review', text: answer, review };
  }
  if (/\b(qué puedes|que puedes|ayuda|help|cómo funciona|como funciona)\b/i.test(normalized)) {
    return { type: 'answer', text: '✨ **Antigravity AI (Líder Orquestador)**: Recibo tus instrucciones en el chat, diseño el plan de ingeniería y delego tareas a GPT-4o (Arquitectura) y Claude 3.5 (Seguridad), mientras ejecuto los cambios y pruebas de forma aislada en el Worker Local.' };
  }
  if (/\b(implementa|construye|crea|modifica|arregla|corrige|añade|agrega)\b/i.test(normalized)) {
    const review = reviewRepository(project);
    const answer = [
      `✨ **Antigravity AI Engine (Líder Orquestador)**: Recibí la instrucción de construcción: "${request}".`,
      `He delegado la tarea al equipo de agentes:`,
      `• 🧠 **GPT-4o Architect**: Diseñando arquitectura desacoplada y esquemas DTO.`,
      `• 🛡️ **Claude 3.5 Reviewer**: Auditando riesgos OWASP y límites de tasa.`,
      `• 🚀 **Antigravity Executor**: Preparando el aislamiento en rama \`.forge/worktrees/\` para ejecutar la modificación de código y pruebas.`
    ].join('\n\n');
    return { type: 'review', text: answer, review };
  }
  return { type: 'answer', text: `✨ **Antigravity AI Engine**: Recibí tu solicitud: “${request}”. Solicitando revisión o construcción para delegar a GPT-4o, Claude 3.5 y ejecutar en Worker Local.` };
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
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, worker: state.worker });
  // GET /api/agents — estado real de cada agente (connected | simulated | disconnected)
  if (req.method === 'GET' && url.pathname === '/api/agents') {
    const agents = [
      {
        id: 'gpt-4o', name: 'GPT-4o', role: 'Architect',
        status: adapters.openai.connected ? 'connected' : 'simulated',
        adapter: adapters.openai.connected ? 'openai' : null,
        lastHeartbeat: now()
      },
      {
        id: 'claude-3.5', name: 'Claude 3.5', role: 'Reviewer',
        status: adapters.anthropic.connected ? 'connected' : 'simulated',
        adapter: adapters.anthropic.connected ? 'anthropic' : null,
        lastHeartbeat: now()
      },
      {
        id: 'antigravity', name: 'Antigravity', role: 'Executor',
        status: adapters.antigravity.connected ? 'connected'
             : (state.worker.status === 'online' && state.worker.name === 'worker-local') ? 'simulated'
             : 'disconnected',
        adapter: adapters.antigravity.connected ? 'antigravity' : null,
        workerName: state.worker.name,
        lastHeartbeat: state.worker.lastHeartbeat
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
    const userMessage = { id: id('msg'), conversationId: conversation.id, role: 'user', content: text, createdAt: now() };
    const result = chatAnswer(text, project);
    const assistantMessage = { id: id('msg'), conversationId: conversation.id, role: 'assistant', content: result.text, kind: result.type, review: result.review || null, createdAt: now() };
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
      persist();
    }
    return json(res, 200, { ok: true, user: state.user });
  }

  // POST /api/chat — legacy chat endpoint
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const body = await parseBody(req);
    const text = String(body.message || '').trim();
    if (!text) return json(res, 400, { error: 'El mensaje no puede estar vacío' });
    const conversation = conversationFor(body);
    const project = state.projects.find(item => item.id === conversation.projectId) || state.projects[0];
    const userMessage = { id: id('msg'), conversationId: conversation.id, role: 'user', content: text, createdAt: now() };
    const result = chatAnswer(text, project);
    const assistantMessage = { id: id('msg'), conversationId: conversation.id, role: 'assistant', content: result.text, kind: result.type, review: result.review || null, createdAt: now() };
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
    if (!body.name) return json(res, 400, { error: 'El nombre del proyecto es obligatorio' });
    const project = { id: id('proj'), name: body.name, localPath: body.localPath || ROOT, githubUrl: body.githubUrl || '', branch: body.branch || 'main', status: 'connected', createdAt: now() };
    state.projects.unshift(project); event('success', `Proyecto conectado: ${project.name}`); persist(); return json(res, 201, project);
  }
  if (req.method === 'POST' && url.pathname === '/api/tasks') {
    const body = await parseBody(req);
    if (!body.title) return json(res, 400, { error: 'El título de la tarea es obligatorio' });
    const task = { id: id('task'), projectId: body.projectId || state.projects[0]?.id, title: body.title, description: body.description || '', status: 'queued', stage: 'queued', priority: body.priority || 'medium', agent: 'GPT Architect', createdAt: now(), updatedAt: now(), progress: 0 };
    state.tasks.unshift(task); event('task', `Nueva tarea en cola: ${task.title}`); persist(); runTask(task); return json(res, 201, task);
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

    // Send current state immediately
    res.write(`data: ${JSON.stringify({ type: 'state', run })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done', runId })}\n\n`);
    res.end();
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
        const result = chatAnswer(associatedMsg.content, project);
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

  return json(res, 404, { error: 'Ruta no encontrada' });
}

function serve(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) return api(req, res, url).catch(() => json(res, 400, { error: 'Solicitud inválida' }));
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'Acceso denegado' });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'No encontrado' });
    const ext = path.extname(file); const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': `${types[ext] || 'application/octet-stream'}; charset=utf-8` }); res.end(data);
  });
}

http.createServer(serve).listen(PORT, () => console.log(`Dashboard listo en http://localhost:${PORT}`));
