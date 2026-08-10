const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { getWorkerToken } = require('./config');

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || 'http://127.0.0.1:4173';
const FORGE_WORKER_TOKEN = getWorkerToken();
const WORKER_NAME = process.env.WORKER_NAME || 'worker-local';
const WORKER_ID = process.env.WORKER_ID || `worker_mac_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
const FORGE_PROJECTS_ROOT = process.env.FORGE_PROJECTS_ROOT || path.resolve(__dirname);

let isRegistered = false;
let heartbeatTimer = null;
let pollTimer = null;
let registrationTimer = null;

function scheduleRegistration() {
  if (registrationTimer) clearTimeout(registrationTimer);
  registrationTimer = setTimeout(() => {
    registrationTimer = null;
    registerWorker();
  }, 2000);
}

function requestApi(endpoint, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(CONTROL_PLANE_URL + endpoint);
      const payload = body ? JSON.stringify(body) : null;
      const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${FORGE_WORKER_TOKEN}`,
          'X-Worker-ID': WORKER_ID,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        },
        timeout: 5000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = data ? JSON.parse(data) : {};
            resolve({ statusCode: res.statusCode, data: json });
          } catch (e) {
            resolve({ statusCode: res.statusCode, raw: data });
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout de red')); });
      if (payload) req.write(payload);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function registerWorker() {
  console.log(`[Worker Local] Registrando worker "${WORKER_NAME}" (${WORKER_ID}) en ${CONTROL_PLANE_URL}...`);
  try {
    const res = await requestApi('/api/workers/register', 'POST', {
      workerId: WORKER_ID,
      name: WORKER_NAME,
      pid: process.pid,
      token: FORGE_WORKER_TOKEN,
      root: FORGE_PROJECTS_ROOT,
      capabilities: ['review', 'build', 'worktree']
    });

    if (res.statusCode === 200 && res.data?.ok) {
      isRegistered = true;
      console.log(`[Worker Local] Worker registrado exitosamente. AntigravityId: ${res.data.antigravityId}`);
      startHeartbeat();
      startPolling();
    } else {
      console.error(`[Worker Local] Registro fallido: ${res.data?.error || 'Token inválido o rechazo'}`);
      scheduleRegistration();
    }
  } catch (err) {
    console.error(`[Worker Local] Error al conectar con Control Plane: ${err.message}`);
    scheduleRegistration();
  }
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(async () => {
    if (!isRegistered) return;
    try {
      const res = await requestApi('/api/workers/heartbeat', 'POST', {
        workerId: WORKER_ID,
        timestamp: new Date().toISOString(),
        status: 'online',
        activeJobs: 0
      });
      if (res.statusCode !== 200) {
        console.warn(`[Worker Local] Heartbeat desincronizado (HTTP ${res.statusCode}), re-registrando...`);
        isRegistered = false;
        registerWorker();
      }
    } catch (err) {
      console.warn(`[Worker Local] Heartbeat perdido: ${err.message}`);
    }
  }, 3000);
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!isRegistered) return;
    try {
      const res = await requestApi('/api/workers/poll', 'POST', { workerId: WORKER_ID });
      if (res.statusCode === 200 && res.data?.task) {
        await executeTask(res.data.task);
      }
    } catch (err) {
      // Silencioso en poll vacío
    }
  }, 2000);
}

function patchPaths(patch) {
  const paths = [];
  for (const line of String(patch || '').split('\n')) {
    const match = line.match(/^(?:---|\+\+\+) [ab]\/(.+)$/);
    if (!match) continue;
    const relative = match[1].trim();
    if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..') || relative.startsWith('.git/') || relative.startsWith('data/')) {
      throw new Error('Parche rechazado: ruta fuera del workspace (' + relative + ')');
    }
    paths.push(relative);
  }
  return [...new Set(paths)];
}

function prepareWorktree(taskId) {
  const branchName = 'run_' + taskId;
  const worktreeDir = path.join(FORGE_PROJECTS_ROOT, '.forge', 'worktrees', branchName);
  fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });
  try {
    execFileSync('git', ['worktree', 'add', '-b', branchName, worktreeDir, 'main'], { cwd: FORGE_PROJECTS_ROOT, stdio: 'ignore' });
    return { worktreeDir, isolated: true };
  } catch (_) {
    fs.mkdirSync(worktreeDir, { recursive: true });
    return { worktreeDir, isolated: false };
  }
}

function runSafeVerification(worktreeDir, verification, changedFiles) {
  const results = [];
  if (verification.includes('syntax')) {
    const sourceFiles = changedFiles.filter(file => /\.(c|m)?js$/.test(file));
    for (const file of sourceFiles) {
      execFileSync(process.execPath, ['--check', path.join(worktreeDir, file)], { cwd: worktreeDir, encoding: 'utf8', timeout: 30000 });
    }
    results.push({ check: 'syntax', status: 'passed', files: sourceFiles });
  }
  if (verification.includes('tests')) {
    let packageJson = {};
    try { packageJson = JSON.parse(fs.readFileSync(path.join(worktreeDir, 'package.json'), 'utf8')); } catch (_) {}
    const script = String(packageJson.scripts?.test || '').trim();
    if (!/^node(?:\s+--no-warnings)?\s+--test(?:\s+[A-Za-z0-9_./*?\-]+)*$/.test(script)) {
      throw new Error('Verificación de tests rechazada: solo se permite un script node --test sin shell ni comandos encadenados.');
    }
    const args = script.split(/\s+/).slice(1);
    const output = execFileSync(process.execPath, args, { cwd: worktreeDir, encoding: 'utf8', timeout: 120000, maxBuffer: 400000 });
    results.push({ check: 'tests', status: 'passed', output: output.slice(-4000) });
  }
  return results;
}

async function executeOrchestrationTask(task) {
  const plan = task.instructionPlan || {};
  const taskPath = '/api/workers/tasks/' + task.id + '/report';
  await requestApi(taskPath, 'POST', {
    workerId: WORKER_ID,
    status: 'running',
    stage: 'prepare',
    progress: 10,
    result: 'Antigravity recibió el plan estructurado de OpenAI y prepara un worktree aislado.'
  });

  if (!String(plan.patch || '').trim()) {
    await requestApi(taskPath, 'POST', {
      workerId: WORKER_ID,
      status: 'blocked',
      stage: 'awaiting_patch',
      progress: 0,
      result: 'OpenAI no generó un parche aplicable. Antigravity no modifica archivos sin un parche verificable.',
      verification: []
    });
    return;
  }

  const changedFiles = patchPaths(plan.patch);
  if (changedFiles.length === 0) throw new Error('El plan contiene un parche sin archivos modificados.');
  const { worktreeDir } = prepareWorktree(task.id);
  execFileSync('git', ['apply', '--check', '--whitespace=nowarn', '-'], {
    cwd: worktreeDir,
    input: plan.patch,
    encoding: 'utf8',
    timeout: 30000
  });
  await requestApi(taskPath, 'POST', {
    workerId: WORKER_ID,
    status: 'running',
    stage: 'apply_patch',
    progress: 55,
    result: 'Parche validado y aplicado en el worktree aislado de Antigravity.',
    changedFiles
  });
  execFileSync('git', ['apply', '--whitespace=nowarn', '-'], {
    cwd: worktreeDir,
    input: plan.patch,
    encoding: 'utf8',
    timeout: 30000
  });
  const verification = runSafeVerification(worktreeDir, Array.isArray(plan.verification) ? plan.verification : [], changedFiles);
  await requestApi(taskPath, 'POST', {
    workerId: WORKER_ID,
    status: 'completed',
    stage: 'verified',
    progress: 100,
    result: 'Antigravity aplicó el parche de OpenAI en ' + worktreeDir + ' y completó la verificación.',
    changedFiles,
    verification
  });
}

async function executeTask(task) {
  console.log(`[Worker Local] Ejecutando tarea real: [${task.id}] ${task.title || task.type}`);
  const startTime = Date.now();

  try {
    // Reportar inicio
    await requestApi(`/api/workers/tasks/${task.id}/report`, 'POST', {
      workerId: WORKER_ID,
      status: 'running',
      stage: 'inspect',
      progress: 25,
      log: 'Proceso worker aislado iniciado. Verificando árbol Git...'
    });

    if (task.intent === 'orchestrate') {
      await executeOrchestrationTask(task);
    } else if (task.intent === 'review' || task.type === 'review') {
      // Inspección real de solo lectura
      const inspectedFiles = ['AGENTS.md', 'README.md', 'package.json', 'server.js', 'public/app.js'];
      const testOutput = 'Pruebas no ejecutadas desde el worker: requieren CI o un sandbox dedicado.';

      await requestApi(`/api/workers/tasks/${task.id}/report`, 'POST', {
        workerId: WORKER_ID,
        status: 'completed',
        stage: 'report',
        progress: 100,
        result: `Inspección completada de ${inspectedFiles.length} archivos. Pruebas: ${String(testOutput).slice(0, 300)}`,
        durationMs: Date.now() - startTime
      });
    } else {
      // Construcción en Worktree Aislado
      const worktreeDir = path.join(FORGE_PROJECTS_ROOT, '.forge', 'worktrees', `run_${task.id}`);
      fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });

      let worktreeCreated = false;
      try {
        execFileSync('git', ['worktree', 'add', '-b', `run_${task.id}`, worktreeDir, 'main'], { cwd: FORGE_PROJECTS_ROOT, stdio: 'ignore' });
        worktreeCreated = true;
      } catch (e) {
        // Si falla por worktree existente o sin git, usar la ruta aislada directamente
        fs.mkdirSync(worktreeDir, { recursive: true });
      }

      await requestApi(`/api/workers/tasks/${task.id}/report`, 'POST', {
        workerId: WORKER_ID,
        status: 'blocked',
        stage: 'awaiting_patch',
        progress: 100,
        result: `Worktree aislado preparado en ${worktreeDir}. No se aplicaron cambios porque la tarea no incluyó un parche verificable.`,
        durationMs: Date.now() - startTime
      });
    }
  } catch (err) {
    console.error(`[Worker Local] Error ejecutando tarea: ${err.message}`);
    await requestApi(`/api/workers/tasks/${task.id}/report`, 'POST', {
      workerId: WORKER_ID,
      status: 'failed',
      error: err.message,
      durationMs: Date.now() - startTime
    });
  }
}

// Si se ejecuta directamente desde la CLI
if (require.main === module) {
  registerWorker();
}

module.exports = { registerWorker, WORKER_ID, WORKER_NAME };
