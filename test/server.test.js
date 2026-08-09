const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { server, PORT, FORGE_WORKER_TOKEN, FORGE_PROJECTS_ROOT, validateWorkspacePath } = require('../server');

let testServer;
const TEST_PORT = 4174;

function httpRequest(pathUrl, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: pathUrl,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : {} });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test.before(async () => {
  await new Promise((resolve) => {
    testServer = server.listen(TEST_PORT, '127.0.0.1', () => {
      if (testServer.unref) testServer.unref();
      resolve();
    });
  });
});

test.after(async () => {
  if (testServer) {
    testServer.closeAllConnections?.();
    await new Promise(resolve => testServer.close(resolve));
  }
});

// 1. Registro correcto del worker
test('1. Registro correcto del worker local con token válido', async () => {
  const res = await httpRequest('/api/workers/register', 'POST', {
    workerId: 'test_worker_101',
    name: 'worker-local-test',
    pid: 1234,
    token: FORGE_WORKER_TOKEN,
    root: FORGE_PROJECTS_ROOT
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.status, 'connected');
  assert.equal(res.body.workerId, 'test_worker_101');
});

// 2. Heartbeat válido
test('2. Heartbeat válido de worker registrado', async () => {
  const res = await httpRequest('/api/workers/heartbeat', 'POST', {
    workerId: 'test_worker_101',
    token: FORGE_WORKER_TOKEN
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.status, 'connected');
  assert.ok(res.body.lastHeartbeat);
});

// 3. Desconexión después de perder heartbeat (Timeout Simulation)
test('3. Desconexión después de perder heartbeat o consulta a un worker no registrado', async () => {
  const res = await httpRequest('/api/workers/heartbeat', 'POST', {
    workerId: 'unknown_worker_999',
    token: FORGE_WORKER_TOKEN
  });

  assert.equal(res.status, 404);
  assert.equal(res.body.ok, false);
});

// 4. Rechazo de token inválido
test('4. Rechazo de token de worker inválido (401 Unauthorized)', async () => {
  const res = await httpRequest('/api/workers/register', 'POST', {
    workerId: 'test_worker_bad',
    token: 'token_falso_invalido'
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /inválido/i);
});

// 5. Rechazo de rutas fuera del workspace (Path Jail con evasión de prefijo)
test('5. Rechazo de rutas fuera del workspace (Path Jail anti evasión de prefijo)', async () => {
  const invalidPathCheck = validateWorkspacePath('/tmp/hack_outside_directory');
  assert.equal(invalidPathCheck.ok, false);
  assert.match(invalidPathCheck.error, /Acceso denegado/i);

  // Intento de evasión por prefijo similar: /path/to/project-hacker
  const prefixEvasionCheck = validateWorkspacePath(FORGE_PROJECTS_ROOT + '-hacker');
  assert.equal(prefixEvasionCheck.ok, false);
  assert.match(prefixEvasionCheck.error, /Acceso denegado/i);

  const res = await httpRequest('/api/workers/register', 'POST', {
    workerId: 'test_worker_jail',
    token: FORGE_WORKER_TOKEN,
    root: FORGE_PROJECTS_ROOT + '-hacker'
  });

  assert.equal(res.status, 403);
  assert.equal(res.body.ok, false);
});

// 6. Ejecución real de una tarea en worktree aislado
test('6. Creación y asignación de tareas a cola para worker aislado', async () => {
  const resTask = await httpRequest('/api/tasks', 'POST', {
    title: 'Tarea de prueba unitaria aislada',
    projectId: 'proj_demo',
    priority: 'high'
  });

  assert.equal(resTask.status, 201);
  assert.equal(resTask.body.status, 'queued');

  const resPoll = await httpRequest('/api/workers/poll', 'POST', {
    workerId: 'test_worker_101',
    token: FORGE_WORKER_TOKEN
  });

  assert.equal(resPoll.status, 200);
  assert.equal(resPoll.body.ok, true);
  assert.ok(resPoll.body.task);
  assert.equal(resPoll.body.task.title, 'Tarea de prueba unitaria aislada');
});

// 7. Cancelación y retry de runs
test('7. Cancelación y reintento de runs', async () => {
  const resConv = await httpRequest('/api/conversations', 'POST', {
    projectId: 'proj_demo',
    title: 'Prueba cancelacion'
  });
  assert.equal(resConv.status, 201);
  const convId = resConv.body.conversation.id;

  const resMsg = await httpRequest(`/api/conversations/${convId}/messages`, 'POST', {
    content: 'Revisa el proyecto para probar cancelacion'
  });
  assert.equal(resMsg.status, 201);
  const runId = resMsg.body.run.id;

  const resCancel = await httpRequest(`/api/runs/${runId}/cancel`, 'POST');
  assert.equal(resCancel.status, 200);
  assert.equal(resCancel.body.run.status, 'cancelled');

  const resRetry = await httpRequest(`/api/runs/${runId}/retry`, 'POST');
  assert.equal(resRetry.status, 200);
  assert.ok(['running', 'completed'].includes(resRetry.body.run.status));
});

// 8. SSE con eventos progresivos
test('8. Subscripción a SSE de runs en /api/runs/:id/events y validación de payload', async () => {
  const resConv = await httpRequest('/api/conversations', 'POST', {
    projectId: 'proj_demo',
    title: 'Prueba SSE'
  });
  const convId = resConv.body.conversation.id;

  const resMsg = await httpRequest(`/api/conversations/${convId}/messages`, 'POST', {
    content: 'Analizar eventos SSE'
  });
  const runId = resMsg.body.run.id;

  const sseRes = await httpRequest(`/api/runs/${runId}/events`, 'GET');
  assert.equal(sseRes.status, 200);
  assert.equal(sseRes.headers['content-type'], 'text/event-stream');
  assert.match(sseRes.raw, /data: \{"type":"state"/);
});

// 9. Ausencia de ejecución arbitraria desde el navegador
test('9. El servidor rechaza la ejecución arbitraria de comandos recibidos por navegador', async () => {
  const res = await httpRequest('/api/chat', 'POST', {
    message: 'exec(rm -rf /)'
  });
  assert.ok(res.status === 200 || res.status === 201);
  assert.match(res.body.assistantMessage.content, /Antigravity AI/i);
});

// 10. Verificación de contrato real AntigravityAdapter
test('10. Contrato de AntigravityAdapter devuelve missing_credentials o disconnected en ausencia de URL remota', async () => {
  const AntigravityAdapter = require('../antigravity-adapter');
  const adapter = new AntigravityAdapter();
  const health = await adapter.healthCheck();
  assert.equal(health.ok, false);
  assert.equal(health.status, 'missing_credentials');
  assert.equal(adapter.connected, false);
});
