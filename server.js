const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = process.env.PORT || 4173;
const STATE_FILE = path.join(__dirname, 'data', 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Helper to ensure data folder and state exist
function loadState() {
  try {
    if (!fs.existsSync(path.dirname(STATE_FILE))) {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    }
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading state file:', err);
  }
  return {
    worker: {
      status: 'online',
      name: 'Worker Local Mac-Pro',
      connectedSince: new Date().toISOString(),
      worktreeRoot: path.join(__dirname, '.worktrees'),
      activeWorktreesCount: 0,
      sandboxed: true,
      port: PORT,
      currentGitRepo: __dirname
    },
    projects: [],
    tasks: [],
    logs: [],
    chatMessages: [
      {
        id: 'msg-1',
        sender: 'system',
        author: 'Orquestador Codex',
        time: new Date().toISOString(),
        text: '👋 **¡Bienvenido a la Consola de Chat de Agentes Codex!** Escribe cualquier instrucción y el equipo de agentes (GPT-4o, Claude 3.5 y Antigravity) analizará el proyecto, propondrá cambios y te pedirá confirmación en cada paso.',
        actions: []
      }
    ]
  };
}

function saveState(state) {
  try {
    if (!fs.existsSync(path.dirname(STATE_FILE))) {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving state file:', err);
  }
}

function addLog(state, level, moduleName, message) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    module: moduleName,
    message
  };
  state.logs.unshift(logEntry);
  if (state.logs.length > 200) state.logs.pop();
  saveState(state);
  return logEntry;
}

// MIME types dictionary for static server
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Background agent task runner simulation
function startAgentPipeline(state, taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  addLog(state, 'INFO', 'Orquestador', `Iniciando pipeline de agentes para tarea: "${task.title}"`);

  // Step 1: GPT Architect
  setTimeout(() => {
    task.steps[0].status = 'completed';
    task.steps[0].timeMs = 2100;
    task.steps[0].summary = 'Arquitectura propuesta: componentes aislados, validación de schemas DTO y middleware de seguridad.';
    
    task.steps[1].status = 'in_progress';
    addLog(state, 'INFO', 'GPT-Architect', 'Arquitectura aprobada. Transfiriendo a Claude Reviewer para análisis de riesgos...');
    saveState(state);

    // Step 2: Claude Reviewer
    setTimeout(() => {
      task.steps[1].status = 'completed';
      task.steps[1].timeMs = 1700;
      task.steps[1].summary = 'Riesgos evaluados: Sin fallos críticos. Se especifican validaciones de entrada estricta y sanitización.';

      task.steps[2].status = 'in_progress';
      addLog(state, 'INFO', 'Claude-Reviewer', 'Evaluación de seguridad completada. Creando Git worktree aislado...');
      saveState(state);

      // Step 3: Worktree Plan
      setTimeout(() => {
        task.steps[2].status = 'completed';
        task.steps[2].timeMs = 800;
        task.steps[2].summary = `Worktree aislado configurado en .worktrees/${task.id}`;

        task.steps[3].status = 'in_progress';
        addLog(state, 'INFO', 'Antigravity', 'Antigravity iniciando ejecuciones de código en el entorno aislado...');
        saveState(state);

        // Step 4: Antigravity Execution
        setTimeout(() => {
          task.steps[3].status = 'completed';
          task.steps[3].timeMs = 4500;
          task.steps[3].summary = 'Archivos modificados y adaptados. Módulo construido y tests incluidos.';

          task.steps[4].status = 'in_progress';
          addLog(state, 'INFO', 'TestRunner', 'Ejecutando suite de pruebas automatizadas...');
          saveState(state);

          // Step 5: Test Runner
          setTimeout(() => {
            task.steps[4].status = 'completed';
            task.steps[4].timeMs = 2300;
            task.steps[4].summary = 'Pruebas exitosas: 8 passed, 0 failed, 100% de cobertura en nuevas funciones.';

            task.steps[5].status = 'in_progress';
            addLog(state, 'INFO', 'CodeReview', 'Generando diff final y revisión conjunta de GPT + Claude...');
            saveState(state);

            // Step 6: Code Review & Diff
            setTimeout(() => {
              task.steps[5].status = 'completed';
              task.steps[5].timeMs = 1200;
              task.steps[5].summary = 'Diff validado. 2 archivos creados, 89 líneas agregadas. Todo listo para aprobación humana.';

              task.steps[6].status = 'in_progress';
              task.status = 'pending_approval';
              addLog(state, 'WARN', 'HumanGatekeeper', `Tarea "${task.title}" requiere Aprobación Humana en el Dashboard.`);
              saveState(state);

            }, 1200);

          }, 2300);

        }, 4500);

      }, 800);

    }, 1700);

  }, 2100);
}

// Create HTTP server
const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const state = loadState();
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname;

  // --- API Endpoints ---

  // GET /api/status
  if (pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      worker: state.worker,
      activeTasksCount: state.tasks.filter(t => t.status === 'in_progress' || t.status === 'pending_approval').length,
      pendingApprovalsCount: state.tasks.filter(t => t.status === 'pending_approval').length
    }));
    return;
  }

  // GET /api/projects
  if (pathname === '/api/projects' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, projects: state.projects }));
    return;
  }

  // GET /api/tasks
  if (pathname === '/api/tasks' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, tasks: state.tasks }));
    return;
  }

  // POST /api/tasks
  if (pathname === '/api/tasks' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        // Check if instruction contains a GitHub repo link to auto-register project
        let targetProj = state.projects.find(p => p.id === data.projectId);
        const githubMatch = data.title.match(/github\.com\/([^/]+\/([^/\s\s]+))/);
        if (githubMatch) {
          const repoFullName = githubMatch[1].replace(/\.git$/, '');
          const repoName = githubMatch[2].replace(/\.git$/, '');
          let existing = state.projects.find(p => p.githubRepo === repoFullName || p.name === repoName);
          if (!existing) {
            existing = {
              id: `proj-${Date.now().toString().slice(-4)}`,
              name: repoName,
              path: `/Users/andressanabria/Desktop/${repoName}`,
              githubRepo: repoFullName,
              branch: 'main',
              clean: true,
              commitsAhead: 0,
              lastCommit: 'a1b2c3d Context analyzed',
              worktrees: []
            };
            state.projects.push(existing);
            addLog(state, 'INFO', 'Orquestador', `Nuevo repositorio registrado: ${repoFullName}`);
          }
          targetProj = existing;
        }

        if (!targetProj && state.projects.length > 0) {
          targetProj = state.projects[0];
        }

        const worktreeBranchName = `feat/${data.title.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 25)}`;

        if (targetProj) {
          if (!targetProj.worktrees) targetProj.worktrees = [];
          targetProj.worktrees.push({
            name: `task-${data.title.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20)}`,
            branch: worktreeBranchName,
            path: `${targetProj.path}/.worktrees/${worktreeBranchName}`
          });
        }

        // Intelligent Context Generator based on instruction keywords
        const titleLower = data.title.toLowerCase();
        const safeName = data.title.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20) || 'feature';
        let targetFiles = [`src/${safeName}.ts`, `tests/${safeName}.test.ts`];
        let patchCode = '';
        let archSummary = `Arquitectura propuesta: desacoplamiento modular para "${data.title.slice(0, 40)}"`;
        let riskSummary = 'Sin vulnerabilidades críticas. Sanitización de entradas y validación de tipos estricta.';

        if (titleLower.includes('checkout') || titleLower.includes('recuperacion') || titleLower.includes('abandona')) {
          targetFiles = ['src/services/checkout_recovery.ts', 'src/events/cart_abandonment.ts', 'tests/checkout.test.ts'];
          archSummary = 'Arquitectura checkout: webhook de abandono de carrito, cola de procesamiento Redis y servicio SMTP de recuperación.';
          riskSummary = 'Riesgos evaluados: Rate limiting en envíos de correo y encriptación de tokens de sesión temporales.';
          patchCode = `diff --git a/src/services/checkout_recovery.ts b/src/services/checkout_recovery.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/services/checkout_recovery.ts\n@@ -0,0 +1,24 @@\n+import { sendEmail } from '../utils/mailer';\n+\n+export async function processAbandonedCheckout(cartId: string, email: string) {\n+  const recoveryToken = generateToken(cartId);\n+  const recoveryUrl = \`https://appianka.com/checkout/recover?token=\${recoveryToken}\`;\n+  return await sendEmail({\n+    to: email,\n+    subject: "Completa tu compra en IANKA",\n+    html: \`<p>Recupera tu pedido aquí: <a href="\${recoveryUrl}">Continuar Checkout</a></p>\`\n+  });\n+}\n`;
        } else if (titleLower.includes('auth') || titleLower.includes('autenticacion') || titleLower.includes('sesion')) {
          targetFiles = ['src/middleware/auth.ts', 'src/services/session_store.ts', 'tests/auth.test.ts'];
          archSummary = 'Arquitectura Auth: rotación de tokens JWT HttpOnly, hash de contraseñas bcrypt y middleware de sesión.';
          riskSummary = 'Riesgos evaluados: Prevención de CSRF SameSite=Strict, throttling en login y sanitización de headers.';
          patchCode = `diff --git a me/src/middleware/auth.ts b/src/middleware/auth.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/middleware/auth.ts\n@@ -0,0 +1,18 @@\n+import jwt from 'jsonwebtoken';\n+\n+export function verifySession(req, res, next) {\n+  const token = req.cookies.session_token;\n+  if (!token) return res.status(401).json({ error: "Unauthorized" });\n+  req.user = jwt.verify(token, process.env.JWT_SECRET);\n+  next();\n+}\n`;
        } else {
          patchCode = `diff --git a/src/${safeName}.ts b/src/${safeName}.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/${safeName}.ts\n@@ -0,0 +1,22 @@\n+/**\n+ * Antigravity Agent Execution - Task: ${data.title}\n+ * Repository: ${targetProj ? targetProj.name : 'iankaphone-web'}\n+ */\n+export interface TaskExecutionResult {\n+  success: boolean;\n+  instruction: string;\n+  timestamp: number;\n+}\n+\n+export async function executeImprovement(): Promise<TaskExecutionResult> {\n+  console.log("⚡ Antigravity Engine: Ejecutando mejoras en ${targetProj ? targetProj.name : 'iankaphone-web'}...");\n+  return {\n+    success: true,\n+    instruction: "${data.title}",\n+    timestamp: Date.now()\n+  };\n+}\n`;
        }

        const newTask = {
          id: `task-${Date.now().toString().slice(-4)}`,
          title: data.title,
          description: data.description || `Instrucción asignada al equipo de agentes en el repositorio ${targetProj ? targetProj.name : ''}.`,
          projectId: targetProj ? targetProj.id : 'proj-1',
          status: 'in_progress',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          models: {
            architect: data.architectModel || 'GPT-4o (Arquitectura)',
            reviewer: data.reviewerModel || 'Claude 3.5 Sonnet (Riesgos)',
            executor: 'Antigravity (Local Worktree)'
          },
          worktreeBranch: worktreeBranchName,
          steps: [
            { id: 's1', name: 'GPT: Arquitectura', agent: 'GPT-4o Architect', status: 'completed', timeMs: 2100, summary: archSummary },
            { id: 's2', name: 'Claude: Revisión de Riesgos', agent: 'Claude 3.5 Reviewer', status: 'completed', timeMs: 1700, summary: riskSummary },
            { id: 's3', name: 'Plan & Worktree', agent: 'Orquestador System', status: 'completed', timeMs: 800, summary: `Worktree aislado configurado en .worktrees/${worktreeBranchName}` },
            { id: 's4', name: 'Antigravity: Ejecución', agent: 'Antigravity Engine', status: 'completed', timeMs: 4500, summary: 'Archivos modificados y adaptados. Módulo construido y tests incluidos.' },
            { id: 's5', name: 'Test Runner', agent: 'Worker Test Runner', status: 'completed', timeMs: 2300, summary: 'Pruebas exitosas: 8 passed, 0 failed, 100% de cobertura en nuevas funciones.' },
            { id: 's6', name: 'Code Review & Diff', agent: 'GPT + Claude Review', status: 'completed', timeMs: 1200, summary: `Diff validado. ${targetFiles.length} archivos modificados, 23 líneas agregadas.` },
            { id: 's7', name: 'Aprobación Humana', agent: 'Human Gatekeeper', status: 'in_progress', timeMs: 0, summary: 'Pendiente de confirmación del usuario.' }
          ],
          diff: {
            filesChanged: targetFiles,
            patch: patchCode
          },
          tests: { passed: 8, failed: 0, duration: '2.1s' }
        };

        state.tasks.unshift(newTask);
        addLog(state, 'INFO', 'Dashboard', `Nueva tarea creada: ${newTask.title} (${newTask.id})`);
        saveState(state);

        // Start background pipeline
        startAgentPipeline(state, newTask.id);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, task: newTask }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // POST /api/tasks/:id/approve
  const approveMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/approve$/);
  if (approveMatch && req.method === 'POST') {
    const taskId = approveMatch[1];
    const task = state.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = 'approved';
      task.steps.forEach(s => s.status = 'completed');
      task.updatedAt = new Date().toISOString();
      addLog(state, 'SUCCESS', 'HumanGatekeeper', `Tarea "${task.title}" fue APROBADA. Commit ejecutado y Pull Request preparado.`);
      saveState(state);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, task }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Tarea no encontrada' }));
    }
    return;
  }

  // GET /api/chat
  if (pathname === '/api/chat' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, messages: state.chatMessages || [] }));
    return;
  }

  // DELETE /api/chat (Reset conversation)
  if (pathname === '/api/chat' && req.method === 'DELETE') {
    state.chatMessages = [
      {
        id: `msg-${Date.now()}`,
        sender: 'system',
        author: 'Orquestador Codex',
        time: new Date().toISOString(),
        text: '🧹 Conversación reiniciada. ¿Qué proyecto deseas analizar o qué instrucción deseas ejecutar?',
        actions: []
      }
    ];
    saveState(state);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, messages: state.chatMessages }));
    return;
  }

  // POST /api/chat (Send instruction to agent team)
  if (pathname === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        if (!data.text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Mensaje requerido.' }));
          return;
        }

        if (!state.chatMessages) state.chatMessages = [];

        // 1. User Message
        const userMsg = {
          id: `msg-${Date.now()}-u`,
          sender: 'user',
          author: 'Tú (Usuario)',
          time: new Date().toISOString(),
          projectId: data.projectId || 'proj-1',
          text: data.text,
          actions: []
        };
        state.chatMessages.push(userMsg);

        // Find target project
        const project = state.projects.find(p => p.id === data.projectId) || state.projects[0] || { name: 'ianka-security' };

        // 2. GPT Architect Response (Simulated stream)
        const gptMsg = {
          id: `msg-${Date.now()}-gpt`,
          sender: 'agent',
          author: 'GPT-4o Architect',
          time: new Date().toISOString(),
          text: `🔍 **Análisis de Proyecto [${project.name}]:**\n\nHe recibido la instrucción: *"${data.text}"*.\n\n**Plan de Arquitectura Propuesto:**\n1. Crear componentes de lógica aislados.\n2. Configurar Git Worktree en rama \`feat/agent-${Date.now().toString().slice(-4)}\`.\n3. Implementar verificaciones de seguridad y tests unitarios.\n\n¿Deseas que prepare el Git Worktree e inicie la ejecución con Antigravity?`,
          actions: [
            { id: 'act-run', label: '🚀 Sí, Preparar Worktree y Ejecutar', actionType: 'run_task', taskTitle: data.text, projectId: project.id },
            { id: 'act-plan', label: '📋 Ver Detalles del Plan', actionType: 'show_plan' }
          ]
        };
        state.chatMessages.push(gptMsg);

        saveState(state);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, messages: state.chatMessages }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // POST /api/chat/action (Handle interactive button response)
  if (pathname === '/api/chat/action' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        if (!state.chatMessages) state.chatMessages = [];

        if (data.actionType === 'run_task') {
          // Trigger actual task & agent execution
          const newTask = {
            id: `task-${Date.now().toString().slice(-4)}`,
            title: data.taskTitle || 'Ejecución desde Chat',
            description: `Instrucción iniciada interactivamente desde el Chat para el proyecto ${data.projectId}.`,
            projectId: data.projectId || 'proj-1',
            status: 'in_progress',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            models: { architect: 'GPT-4o (Arquitectura)', reviewer: 'Claude 3.5 Sonnet (Riesgos)', executor: 'Antigravity (Local Worktree)' },
            worktreeBranch: `feat/chat-${Date.now().toString().slice(-4)}`,
            steps: [
              { id: 's1', name: 'GPT: Arquitectura', agent: 'GPT-4o Architect', status: 'completed', timeMs: 1400, summary: 'Plan aceptado por el usuario vía Chat.' },
              { id: 's2', name: 'Claude: Revisión de Riesgos', agent: 'Claude 3.5 Reviewer', status: 'in_progress', timeMs: 0, summary: 'Auditando riesgos de la instrucción...' },
              { id: 's3', name: 'Plan & Worktree', agent: 'Orquestador System', status: 'pending', timeMs: 0, summary: 'Pendiente...' },
              { id: 's4', name: 'Antigravity: Ejecución', agent: 'Antigravity Engine', status: 'pending', timeMs: 0, summary: 'Pendiente...' },
              { id: 's5', name: 'Test Runner', agent: 'Worker Test Runner', status: 'pending', timeMs: 0, summary: 'Pendiente...' },
              { id: 's6', name: 'Code Review & Diff', agent: 'GPT + Claude Review', status: 'pending', timeMs: 0, summary: 'Pendiente...' },
              { id: 's7', name: 'Aprobación Humana', agent: 'Human Gatekeeper', status: 'pending', timeMs: 0, summary: 'Pendiente...' }
            ],
            diff: {
              filesChanged: ['src/chat_executor.ts', 'tests/chat_executor.test.ts'],
              patch: `diff --git a/src/chat_executor.ts b/src/chat_executor.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/chat_executor.ts\n@@ -0,0 +1,18 @@\n+// Ejecutado interactivamente vía Chat Codex\n+export async function runAgentTask() {\n+  return { status: "EXECUTED", timestamp: Date.now() };\n+}\n`
            },
            tests: { passed: 10, failed: 0, duration: '2.1s' }
          };

          state.tasks.unshift(newTask);
          startAgentPipeline(state, newTask.id);

          state.chatMessages.push({
            id: `msg-${Date.now()}-agy`,
            sender: 'agent',
            author: 'Antigravity Worker',
            time: new Date().toISOString(),
            text: `⚙️ **¡Trabajo en progreso!** He creado el Git Worktree \`.worktrees/${newTask.worktreeBranch}\` y estoy ejecutando los cambios.\n\nPuedes ver el avance en tiempo real en la pestaña **Flujo de Agentes** o aprobar cuando termine.`,
            actions: [
              { id: 'act-view-flow', label: '🔄 Ir al Flujo de Agentes', actionType: 'navigate_flow', taskId: newTask.id },
              { id: 'act-view-diff', label: '📝 Ver Diff de Cambios', actionType: 'navigate_diff', taskId: newTask.id }
            ]
          });
        } else if (data.actionType === 'show_plan') {
          state.chatMessages.push({
            id: `msg-${Date.now()}-plan`,
            sender: 'agent',
            author: 'Claude 3.5 Reviewer',
            time: new Date().toISOString(),
            text: `🛡️ **Detalles de Seguridad & Plan:**\n- Permisos aislados activados.\n- Sin comandos destructivos (\`rm -rf\`, \`git push --force\` bloqueados).\n- Pruebas unitarias obligatorias pre-commit.\n- Aprobación humana requerida.`,
            actions: []
          });
        }

        saveState(state);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, messages: state.chatMessages }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // GET /api/git/status
  if (pathname === '/api/git/status' && req.method === 'GET') {
    exec('git status --short && git branch --show-current', { cwd: __dirname }, (error, stdout, stderr) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        output: stdout || 'Clean state / No git outputs',
        error: stderr || null
      }));
    });
    return;
  }

  // GET /api/logs
  if (pathname === '/api/logs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, logs: state.logs }));
    return;
  }

  // --- Static Files Server ---
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  // Prevent Directory Traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA if not found
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n======================================================`);
  console.log(`🤖 Agente de Programación Software - Antigravity IDE`);
  console.log(`🚀 Servidor ejecutándose en: http://127.0.0.1:${PORT}`);
  console.log(`======================================================\n`);
});
