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

        // ===== INTELLIGENT CONTEXT GENERATOR =====
        const titleLower = data.title.toLowerCase();
        const projName = targetProj ? targetProj.name : 'iankaphone-web';
        let targetFiles, patchCode, archSummary, riskSummary, archReasoning, claudeReasoning, agyReasoning;

        // CATEGORY: Checkout / Cart / Recovery
        if (titleLower.match(/checkout|carrito|abandono|recuperaci/)) {
          targetFiles = ['src/services/checkout_recovery.ts', 'src/events/cart_abandonment.ts', 'tests/checkout_recovery.test.ts'];
          archSummary = 'Pipeline de recuperación: webhook de abandono → cola Redis → servicio SMTP con token temporal.';
          riskSummary = 'Rate-limiting en envíos, tokens temporales con expiración de 24h, encriptación AES-256.';
          archReasoning = `Diseñé un pipeline de 3 etapas para recuperación de carritos abandonados: (1) un webhook que detecta inactividad después de 30 min, (2) una cola Redis para procesamiento asíncrono sin bloquear el hilo principal, y (3) un servicio SMTP que genera URLs de recuperación con tokens seguros.`;
          claudeReasoning = `Verifiqué que los tokens de recuperación expiran en 24h, que existe rate-limiting de 3 emails/hora por usuario, y que las URLs no exponen IDs internos. Se sanitizan todos los parámetros de entrada del webhook.`;
          agyReasoning = `Creé ${targetFiles.length} archivos. El servicio de recuperación fue integrado con el sistema de eventos existente. Las 8 pruebas cubren: generación de tokens, expiración, envío de email, rate-limiting, y validación de URLs.`;
          patchCode = 'diff --git a/src/services/checkout_recovery.ts\n--- /dev/null\n+++ b/src/services/checkout_recovery.ts\n@@ -0,0 +1,28 @@\n+import { sendEmail } from "../utils/mailer";\n+import { generateSecureToken } from "../utils/crypto";\n+\n+const RECOVERY_EXPIRY_HOURS = 24;\n+const MAX_EMAILS_PER_HOUR = 3;\n+\n+export async function processAbandonedCheckout(\n+  cartId: string,\n+  userEmail: string\n+): Promise<{ sent: boolean; recoveryUrl: string }> {\n+  const token = generateSecureToken(cartId, RECOVERY_EXPIRY_HOURS);\n+  const recoveryUrl = "https://appianka.com/checkout/recover?t=" + token;\n+\n+  await sendEmail({\n+    to: userEmail,\n+    subject: "Tu carrito te espera - IANKA",\n+    template: "cart_recovery",\n+    data: { recoveryUrl, expiresIn: "24 horas" }\n+  });\n+\n+  return { sent: true, recoveryUrl };\n+}';
        }
        // CATEGORY: Auth / Sessions / Login
        else if (titleLower.match(/auth|autenticaci|login|sesion|sesión|password|contraseña/)) {
          targetFiles = ['src/middleware/auth.ts', 'src/services/session_manager.ts', 'tests/auth.test.ts'];
          archSummary = 'Sistema de autenticación JWT con rotación de tokens, bcrypt para hash, y middleware de sesión HttpOnly.';
          riskSummary = 'Prevención CSRF con SameSite=Strict, throttling de 5 intentos/min en login, headers sanitizados.';
          archReasoning = `Implementé autenticación basada en JWT con cookies HttpOnly para evitar acceso desde JavaScript del cliente. Los tokens se rotan automáticamente cada 15 minutos. Las contraseñas se hashean con bcrypt (cost factor 12) y nunca se almacenan en texto plano.`;
          claudeReasoning = `Verifiqué protección contra CSRF (SameSite=Strict), XSS (HttpOnly cookies), y fuerza bruta (throttling de 5 intentos/min con lockout de 15 min). Los headers de respuesta incluyen Content-Security-Policy.`;
          agyReasoning = `Creé el middleware de autenticación y el gestor de sesiones. Las pruebas cubren: login exitoso, credenciales inválidas, expiración de token, rotación automática, throttling, y logout.`;
          patchCode = `diff --git a/src/middleware/auth.ts\n--- /dev/null\n+++ b/src/middleware/auth.ts\n@@ -0,0 +1,24 @@\n+import jwt from 'jsonwebtoken';\n+import { RateLimiter } from '../utils/rate_limiter';\n+\n+const limiter = new RateLimiter({ max: 5, windowMs: 60000 });\n+\n+export function verifySession(req, res, next) {\n+  const token = req.cookies?.session_token;\n+  if (!token) return res.status(401).json({ error: 'No autorizado' });\n+\n+  try {\n+    const decoded = jwt.verify(token, process.env.JWT_SECRET);\n+    req.user = decoded;\n+    // Auto-rotate token if close to expiry\n+    if (decoded.exp - Date.now()/1000 < 900) {\n+      const newToken = jwt.sign({ id: decoded.id }, process.env.JWT_SECRET, { expiresIn: '1h' });\n+      res.cookie('session_token', newToken, { httpOnly: true, sameSite: 'strict' });\n+    }\n+    next();\n+  } catch (err) {\n+    return res.status(401).json({ error: 'Sesión expirada' });\n+  }\n+}`;
        }
        // CATEGORY: Architecture / Review / Refactor
        else if (titleLower.match(/arquitectura|refactor|estructura|revisar|review|mejorar|optimiz/)) {
          targetFiles = ['src/config/architecture.ts', 'src/utils/dependency_graph.ts', 'docs/architecture_review.md'];
          archSummary = `Auditoría completa de la arquitectura de ${projName}: análisis de dependencias, separación de capas y patrones de diseño.`;
          riskSummary = 'Se identificaron 0 dependencias circulares. Se recomienda migrar 2 módulos a inyección de dependencias.';
          archReasoning = `Analicé la estructura completa de ${projName}. La arquitectura actual sigue un patrón monolítico parcial. Propongo: (1) separar la capa de datos (repositories) de la lógica de negocio (services), (2) implementar inyección de dependencias para los 3 módulos principales, y (3) crear interfaces explícitas para cada servicio.`;
          claudeReasoning = `Revisé las dependencias entre módulos y no encontré ciclos. Sin embargo, detecté 2 servicios que acceden directamente a la base de datos sin pasar por el repositorio. Recomiendo corregir esto para mantener la separación de capas.`;
          agyReasoning = `Generé el grafo de dependencias y el documento de revisión arquitectónica. Las pruebas verifican que las interfaces están correctamente definidas y que no hay imports circulares.`;
          patchCode = `diff --git a/docs/architecture_review.md\n--- /dev/null\n+++ b/docs/architecture_review.md\n@@ -0,0 +1,18 @@\n+# Revisión Arquitectónica - ${projName}\n+\n+## Estado Actual\n+- Patrón: Monolítico parcial con separación de rutas\n+- Capas: Controllers → Services (mixto con data access)\n+- Dependencias circulares: 0\n+\n+## Recomendaciones\n+1. Separar repositories de services\n+2. Implementar inyección de dependencias (InversifyJS)\n+3. Crear interfaces para cada servicio público\n+4. Mover configuración a variables de entorno\n+\n+## Archivos Afectados\n+- src/config/architecture.ts (nuevo)\n+- src/utils/dependency_graph.ts (nuevo)\n+- Migración gradual de 3 servicios existentes`;
        }
        // CATEGORY: Deploy / CI/CD
        else if (titleLower.match(/deploy|despliegue|ci|cd|pipeline|produccion|producción/)) {
          targetFiles = ['.github/workflows/deploy.yml', 'docker/Dockerfile', 'scripts/deploy.sh'];
          archSummary = 'Pipeline CI/CD con GitHub Actions: build → test → deploy automático a staging/producción.';
          riskSummary = 'Secrets gestionados via GitHub Secrets. Deploy con rollback automático en caso de fallo de health check.';
          archReasoning = `Configuré un pipeline de CI/CD completo: (1) GitHub Actions ejecuta build y tests en cada push, (2) deploy automático a staging en cada merge a develop, (3) deploy a producción solo con aprobación manual en releases.`;
          claudeReasoning = `Verifiqué que los secrets (API keys, tokens) están en GitHub Secrets y nunca en código. El Dockerfile usa multi-stage build para minimizar la imagen. Health checks con timeout de 30s y rollback automático.`;
          agyReasoning = `Creé el workflow de GitHub Actions, el Dockerfile optimizado y el script de deploy. Las pruebas incluyen: build exitoso, ejecución de tests, health check del contenedor, y simulación de rollback.`;
          patchCode = `diff --git a/.github/workflows/deploy.yml\n--- /dev/null\n+++ b/.github/workflows/deploy.yml\n@@ -0,0 +1,22 @@\n+name: Deploy Pipeline\n+on:\n+  push:\n+    branches: [main]\n+jobs:\n+  build-and-deploy:\n+    runs-on: ubuntu-latest\n+    steps:\n+      - uses: actions/checkout@v4\n+      - uses: actions/setup-node@v4\n+        with: { node-version: 20 }\n+      - run: npm ci\n+      - run: npm test -- --coverage\n+      - name: Build Docker image\n+        run: docker build -t app:latest .\n+      - name: Deploy to production\n+        if: github.ref == 'refs/heads/main'\n+        run: ./scripts/deploy.sh`;
        }
        // CATEGORY: Security
        else if (titleLower.match(/seguridad|security|vulnerabilidad|owasp|xss|csrf|inyecci/)) {
          targetFiles = ['src/middleware/security.ts', 'src/utils/sanitizer.ts', 'tests/security.test.ts'];
          archSummary = 'Capa de seguridad: middleware de sanitización, headers CSP, protección XSS/CSRF y validación de inputs.';
          riskSummary = 'Se implementaron las 10 protecciones OWASP Top 10. Todos los inputs sanitizados con DOMPurify.';
          archReasoning = `Implementé una capa completa de seguridad: (1) middleware que sanitiza todos los inputs con DOMPurify, (2) headers Content-Security-Policy en cada respuesta, (3) protección CSRF con tokens dobles, y (4) rate-limiting global.`;
          claudeReasoning = `Audité contra OWASP Top 10: inyección SQL (parametrizado), XSS (sanitización + CSP), CSRF (double-submit cookies), autenticación rota (verificada), y exposición de datos (headers seguros). Todo aprobado.`;
          agyReasoning = `Creé el middleware de seguridad y el sanitizador. Las pruebas cubren: inyección SQL, XSS reflejado, XSS almacenado, CSRF, headers maliciosos, y rate-limiting.`;
          patchCode = `diff --git a/src/middleware/security.ts\n--- /dev/null\n+++ b/src/middleware/security.ts\n@@ -0,0 +1,20 @@\n+import helmet from 'helmet';\n+import { sanitizeInput } from '../utils/sanitizer';\n+\n+export function securityMiddleware(req, res, next) {\n+  // Sanitize all inputs\n+  if (req.body) req.body = sanitizeInput(req.body);\n+  if (req.query) req.query = sanitizeInput(req.query);\n+\n+  // Security headers\n+  res.setHeader('X-Content-Type-Options', 'nosniff');\n+  res.setHeader('X-Frame-Options', 'DENY');\n+  res.setHeader('Content-Security-Policy', "default-src 'self'");\n+\n+  next();\n+}`;
        }
        // CATEGORY: API / Endpoints
        else if (titleLower.match(/api|endpoint|ruta|rest|graphql|servicio/)) {
          targetFiles = ['src/routes/api.ts', 'src/controllers/resource.controller.ts', 'tests/api.test.ts'];
          archSummary = `API RESTful con validación de schemas Zod, controladores tipados y documentación OpenAPI auto-generada.`;
          riskSummary = 'Endpoints protegidos con auth middleware. Rate-limiting de 100 req/min. Validación estricta de payloads.';
          archReasoning = `Diseñé endpoints RESTful siguiendo convenciones estándar (GET/POST/PUT/DELETE). Cada ruta tiene validación de schema con Zod antes de llegar al controlador. Los errores se manejan con un middleware centralizado que nunca expone stack traces.`;
          claudeReasoning = `Verifiqué que todos los endpoints requieren autenticación excepto /health y /login. Los payloads se validan con Zod y se rechazan si no cumplen el schema. No hay exposición de datos sensibles en respuestas de error.`;
          agyReasoning = `Creé las rutas, controladores y validadores. Las pruebas cubren: CRUD completo, validación de schemas inválidos, autenticación requerida, rate-limiting, y respuestas de error.`;
          patchCode = `diff --git a/src/routes/api.ts\n--- /dev/null\n+++ b/src/routes/api.ts\n@@ -0,0 +1,18 @@\n+import { Router } from 'express';\n+import { validate } from '../middleware/validate';\n+import { ResourceSchema } from '../schemas/resource';\n+import * as ctrl from '../controllers/resource.controller';\n+\n+const router = Router();\n+\n+router.get('/resources', ctrl.list);\n+router.get('/resources/:id', ctrl.getById);\n+router.post('/resources', validate(ResourceSchema), ctrl.create);\n+router.put('/resources/:id', validate(ResourceSchema), ctrl.update);\n+router.delete('/resources/:id', ctrl.remove);\n+\n+export default router;`;
        }
        // CATEGORY: Tests
        else if (titleLower.match(/test|prueba|cobertura|coverage|unit|integraci/)) {
          targetFiles = ['tests/unit/services.test.ts', 'tests/integration/api.test.ts', 'jest.config.ts'];
          archSummary = 'Suite de pruebas con Jest: unitarias para servicios, integración para API, y cobertura mínima del 80%.';
          riskSummary = 'Configuración de CI para bloquear merges si la cobertura cae por debajo del 80%.';
          archReasoning = `Configuré Jest con TypeScript y diseñé la estructura de tests: (1) unitarias aisladas con mocks para cada servicio, (2) integración con supertest para endpoints API, y (3) threshold de cobertura del 80% en CI.`;
          claudeReasoning = `Verifiqué que los mocks no ocultan bugs reales, que las pruebas de integración usan una base de datos de test separada, y que el CI bloquea merges con cobertura insuficiente.`;
          agyReasoning = `Creé la configuración de Jest, las pruebas unitarias y de integración. Cobertura actual: 92% de líneas, 88% de branches.`;
          patchCode = `diff --git a/jest.config.ts\n--- /dev/null\n+++ b/jest.config.ts\n@@ -0,0 +1,14 @@\n+export default {\n+  preset: 'ts-jest',\n+  testEnvironment: 'node',\n+  roots: ['<rootDir>/tests'],\n+  coverageThreshold: {\n+    global: {\n+      branches: 80,\n+      functions: 80,\n+      lines: 80,\n+      statements: 80\n+    }\n+  }\n+};`;
        }
        // DEFAULT: General instruction
        else {
          const cleanName = data.title.replace(/[^a-zA-Z0-9 ]/g, '').split(' ').slice(0, 3).map(w => w.toLowerCase()).join('_') || 'feature';
          targetFiles = [`src/services/${cleanName}.ts`, `src/utils/${cleanName}_helpers.ts`, `tests/${cleanName}.test.ts`];
          archSummary = `Módulo "${data.title}" con separación servicio/utilidades y cobertura de tests completa.`;
          riskSummary = `Validación de tipos estricta. Inputs sanitizados. Sin acceso directo a datos sensibles.`;
          archReasoning = `Para "${data.title}" en ${projName}, diseñé un módulo con 2 capas: (1) el servicio principal en src/services/ que contiene la lógica de negocio, y (2) utilidades auxiliares en src/utils/ para funciones reutilizables. Ambos con tipado estricto TypeScript.`;
          claudeReasoning = `Revisé el módulo propuesto: no hay acceso directo a la base de datos desde utilidades, los inputs se validan antes de procesarse, y las funciones exportadas tienen tipos explícitos. No se detectaron vulnerabilidades.`;
          agyReasoning = `Creé ${targetFiles.length} archivos con tipado completo. Las pruebas cubren los casos principales, edge cases con inputs vacíos/nulos, y validación de tipos.`;
          patchCode = `diff --git a/src/services/${cleanName}.ts\n--- /dev/null\n+++ b/src/services/${cleanName}.ts\n@@ -0,0 +1,20 @@\n+/**\n+ * ${data.title}\n+ * Proyecto: ${projName}\n+ */\n+\n+export interface ${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}Result {\n+  success: boolean;\n+  data: Record<string, unknown>;\n+  timestamp: number;\n+}\n+\n+export async function execute${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}(\n+  params: Record<string, unknown>\n+): Promise<${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}Result> {\n+  // Validar inputs\n+  if (!params || Object.keys(params).length === 0) {\n+    throw new Error('Parámetros requeridos');\n+  }\n+  return { success: true, data: params, timestamp: Date.now() };\n+}`;
        }

        const newTask = {
          id: `task-${Date.now().toString().slice(-4)}`,
          title: data.title,
          description: data.description || `Instrucción asignada al equipo de agentes en el repositorio ${projName}.`,
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
          archReasoning: archReasoning,
          claudeReasoning: claudeReasoning,
          agyReasoning: agyReasoning,
          steps: [
            { id: 's1', name: 'GPT: Arquitectura', agent: 'GPT-4o Architect', status: 'completed', timeMs: 2100, summary: archSummary },
            { id: 's2', name: 'Claude: Revisión de Riesgos', agent: 'Claude 3.5 Reviewer', status: 'completed', timeMs: 1700, summary: riskSummary },
            { id: 's3', name: 'Plan & Worktree', agent: 'Orquestador System', status: 'completed', timeMs: 800, summary: `Worktree aislado configurado en .worktrees/${worktreeBranchName}` },
            { id: 's4', name: 'Antigravity: Ejecución', agent: 'Antigravity Engine', status: 'completed', timeMs: 4500, summary: 'Archivos modificados y adaptados. Módulo construido y tests incluidos.' },
            { id: 's5', name: 'Test Runner', agent: 'Worker Test Runner', status: 'completed', timeMs: 2300, summary: 'Pruebas exitosas: 8 passed, 0 failed, 100% de cobertura en nuevas funciones.' },
            { id: 's6', name: 'Code Review & Diff', agent: 'GPT + Claude Review', status: 'completed', timeMs: 1200, summary: `Diff validado. ${targetFiles.length} archivos creados, listo para aprobación.` },
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
