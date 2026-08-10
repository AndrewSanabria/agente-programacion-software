const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.FORGE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-state-'));
process.env.FORGE_PROJECTS_ROOT = path.dirname(__dirname);
process.env.FORGE_WORKER_TOKEN = 'forge_test_token_0123456789abcdef0123456789';

const {
  server,
  activeWorkers,
  adapters,
  FORGE_WORKER_TOKEN,
  FORGE_PROJECTS_ROOT,
  validateWorkspacePath,
  runRepositoryTests
} = require('../server');

const TEST_PORT = 4174;
let browserCookie;
let csrfToken;

function request(requestPath, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: requestPath,
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers
      }
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const contentType = String(res.headers['content-type'] || '');
        let bodyValue = data;
        if (contentType.includes('application/json')) {
          try { bodyValue = JSON.parse(data); } catch (_) { bodyValue = null; }
        }
        resolve({ status: res.statusCode, headers: res.headers, body: bodyValue });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function browserHeaders(extra = {}) {
  return { Cookie: browserCookie, 'X-CSRF-Token': csrfToken, ...extra };
}

function workerHeaders(workerId) {
  return { Authorization: `Bearer ${FORGE_WORKER_TOKEN}`, 'X-Worker-ID': workerId };
}

function parseSse(raw) {
  return raw.split('\n\n').filter(Boolean).map(block => JSON.parse(block.replace(/^data:\s*/, '')));
}

test.before(async () => {
  await new Promise(resolve => server.listen(TEST_PORT, '127.0.0.1', resolve));
  const page = await request('/');
  browserCookie = page.headers['set-cookie'][0].split(';', 1)[0];
  csrfToken = browserCookie.split('=', 2)[1];
});

test.after(async () => {
  activeWorkers.clear();
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
});

test('1. Las mutaciones del navegador requieren CSRF y las válidas pasan', async () => {
  const blocked = await request('/api/projects', 'POST', { name: 'Sin CSRF' }, { Cookie: browserCookie });
  assert.equal(blocked.status, 403);

  const valid = await request('/api/projects', 'POST', { name: 'Proyecto seguro', localPath: FORGE_PROJECTS_ROOT }, browserHeaders());
  assert.equal(valid.status, 201);
  assert.equal(valid.body.localPath, fs.realpathSync(FORGE_PROJECTS_ROOT));
});

test('2. Registra el worker con bearer token válido y rechaza el token en el body', async () => {
  const rejected = await request('/api/workers/register', 'POST', {
    workerId: 'body_only_worker', token: FORGE_WORKER_TOKEN, root: FORGE_PROJECTS_ROOT
  });
  assert.equal(rejected.status, 401);

  const registered = await request('/api/workers/register', 'POST', {
    workerId: 'test_worker_101', name: 'worker-local-test', pid: 1234, root: FORGE_PROJECTS_ROOT
  }, workerHeaders('test_worker_101'));
  assert.equal(registered.status, 200);
  assert.equal(registered.body.status, 'connected');
});

test('3. Acepta heartbeat y solo entrega tareas a workers registrados', async () => {
  const heartbeat = await request('/api/workers/heartbeat', 'POST', { workerId: 'test_worker_101' }, workerHeaders('test_worker_101'));
  assert.equal(heartbeat.status, 200);
  assert.ok(heartbeat.body.lastHeartbeat);

  const task = await request('/api/tasks', 'POST', { title: 'Tarea aislada', projectId: 'proj_demo' }, browserHeaders());
  assert.equal(task.status, 201);

  const poll = await request('/api/workers/poll', 'POST', { workerId: 'test_worker_101' }, workerHeaders('test_worker_101'));
  assert.equal(poll.status, 200);
  assert.equal(poll.body.task.id, task.body.id);

  const unknownPoll = await request('/api/workers/poll', 'POST', { workerId: 'unknown_worker' }, workerHeaders('unknown_worker'));
  assert.equal(unknownPoll.status, 404);
});

test('4. Desconecta el worker después de perder heartbeat', async () => {
  const workerId = 'timeout_worker';
  const registered = await request('/api/workers/register', 'POST', { workerId, root: FORGE_PROJECTS_ROOT }, workerHeaders(workerId));
  assert.equal(registered.status, 200);
  await new Promise(resolve => setTimeout(resolve, 9500));
  const health = await request('/api/health');
  assert.equal(health.body.status, 'offline');
  assert.equal(activeWorkers.get(workerId).status, 'disconnected');
});

test('5. Rechaza token inválido y rutas fuera del workspace, incluido el bypass por prefijo', async () => {
  const badAuth = await request('/api/workers/register', 'POST', { workerId: 'bad', root: FORGE_PROJECTS_ROOT }, {});
  assert.equal(badAuth.status, 401);

  assert.equal(validateWorkspacePath(FORGE_PROJECTS_ROOT + '-hacker').ok, false);
  const outside = await request('/api/workers/register', 'POST', { workerId: 'outside', root: os.tmpdir() }, workerHeaders('outside'));
  assert.equal(outside.status, 403);
});

test('6. La revisión no ejecuta scripts arbitrarios por defecto', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-project-'));
  const marker = path.join(projectDir, 'should-not-exist');
  const result = runRepositoryTests(projectDir, { scripts: { test: `node -e "require('fs').writeFileSync('${marker}', 'executed')"` } });
  assert.equal(result.status, 'not_run');
  assert.equal(fs.existsSync(marker), false);
});

test('7. Cancela y reintenta un run con estado verificable', async () => {
  const conversation = await request('/api/conversations', 'POST', { projectId: 'proj_demo', title: 'Run test' }, browserHeaders());
  const message = await request(`/api/conversations/${conversation.body.conversation.id}/messages`, 'POST', { content: 'Revisa el proyecto' }, browserHeaders());
  const runId = message.body.run.id;
  const cancelled = await request(`/api/runs/${runId}/cancel`, 'POST', null, browserHeaders());
  assert.equal(cancelled.body.run.status, 'cancelled');
  const retried = await request(`/api/runs/${runId}/retry`, 'POST', null, browserHeaders());
  assert.ok(['running', 'completed'].includes(retried.body.run.status));
});

test('8. SSE entrega eventos JSON parseables y termina con done', async () => {
  const conversation = await request('/api/conversations', 'POST', { projectId: 'proj_demo', title: 'SSE test' }, browserHeaders());
  const message = await request(`/api/conversations/${conversation.body.conversation.id}/messages`, 'POST', { content: 'Analiza SSE' }, browserHeaders());
  const response = await request(`/api/runs/${message.body.run.id}/events`);
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'text/event-stream');
  const events = parseSse(response.body);
  assert.equal(events[0].type, 'state');
  assert.equal(events.at(-1).type, 'done');
});

test('9. Un mensaje que contiene comandos no dispara ejecución de shell', async () => {
  const marker = path.join(process.env.FORGE_DATA_DIR, 'shell-marker');
  const response = await request('/api/chat', 'POST', { message: `exec(require('fs').writeFileSync('${marker}', 'bad'))` }, browserHeaders());
  assert.equal(response.status, 201);
  assert.equal(fs.existsSync(marker), false);
});

test('10. /api/user no expone secretos y refleja conexión real', async () => {
  const response = await request('/api/user');
  assert.equal(response.status, 200);
  assert.equal(response.body.authenticated, false);
  assert.equal('sessionToken' in response.body, false);
  assert.equal('sessionSignature' in response.body, false);
  assert.equal(response.body.antigravityConnected, false);
});

test('11. AntigravityAdapter requiere URL y no afirma conexión sin health check', async () => {
  const AntigravityAdapter = require('../antigravity-adapter');
  const adapter = new AntigravityAdapter();
  const health = await adapter.healthCheck();
  assert.equal(health.status, 'missing_credentials');
  assert.equal(adapter.connected, false);
});

test('12. AntigravityAdapter realiza handshake, envío y cancelación HTTP reales', async () => {
  const AntigravityAdapter = require('../antigravity-adapter');
  const calls = [];
  const remote = http.createServer((req, res) => {
    calls.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    if (req.url === '/health') return res.end(JSON.stringify({ ok: true }));
    if (req.method === 'POST' && req.url === '/api/tasks') return res.end(JSON.stringify({ ok: true, taskId: 'remote-1' }));
    if (req.method === 'POST' && req.url === '/api/tasks/remote-1/cancel') return res.end(JSON.stringify({ ok: true, status: 'cancelled' }));
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false }));
  });
  await new Promise(resolve => remote.listen(0, '127.0.0.1', resolve));
  try {
    const port = remote.address().port;
    const adapter = new AntigravityAdapter({ url: `http://127.0.0.1:${port}`, token: 'remote-token' });
    assert.equal((await adapter.healthCheck()).ok, true);
    assert.deepEqual(await adapter.sendTask({ title: 'remote task' }), { ok: true, taskId: 'remote-1' });
    assert.deepEqual(await adapter.cancelTask('remote-1'), { ok: true, status: 'cancelled' });
    assert.ok(calls.every(call => call.auth === 'Bearer remote-token'));
  } finally {
    await new Promise(resolve => remote.close(resolve));
  }
});

test('13. Configura OpenAI, valida la clave y enruta el chat por Responses API sin exponerla', async () => {
  const calls = [];
  const remote = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && req.url === '/v1/models') return res.end(JSON.stringify({ object: 'list', data: [] }));
      if (req.method === 'POST' && req.url === '/v1/responses') return res.end(JSON.stringify({ output_text: 'Respuesta real de OpenAI simulada' }));
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: 'not found' } }));
    });
  });
  await new Promise(resolve => remote.listen(0, '127.0.0.1', resolve));
  const previousBaseUrl = adapters.openai.baseUrl;
  try {
    adapters.openai.baseUrl = `http://127.0.0.1:${remote.address().port}/v1/`;
    const configured = await request('/api/adapters/openai/configure', 'POST', { apiKey: 'sk-test-openai-key' }, browserHeaders());
    assert.equal(configured.status, 200);
    assert.equal(configured.body.ok, true);
    assert.equal(configured.body.adapter.configured, true);
    assert.equal('apiKey' in configured.body.adapter, false);

    const agents = await request('/api/agents');
    const openaiAgent = agents.body.agents.find(agent => agent.id === 'gpt-5.6-luna');
    assert.equal(openaiAgent.status, 'connected');
    assert.equal('apiKey' in openaiAgent, false);

    const chat = await request('/api/chat', 'POST', { message: 'Responde usando OpenAI', model: 'GPT-5.6 Luna' }, browserHeaders());
    assert.equal(chat.status, 201);
    assert.equal(chat.body.assistantMessage.content, 'Respuesta real de OpenAI simulada');
    assert.ok(calls.some(call => call.method === 'POST' && call.url === '/v1/responses' && call.auth === 'Bearer sk-test-openai-key'));
  } finally {
    await request('/api/adapters/openai/configure', 'DELETE', null, browserHeaders());
    adapters.openai.baseUrl = previousBaseUrl;
    await new Promise(resolve => remote.close(resolve));
  }
});

test('14. Z.ai fue retirado del registro y de sus rutas API', async () => {
  const agents = await request('/api/agents');
  assert.equal(agents.status, 200);
  assert.equal(agents.body.agents.some(agent => agent.id === 'zai-glm'), false);

  const removedRoute = await request('/api/adapters/zai/test');
  assert.equal(removedRoute.status, 404);
});

test('15. OpenAI devuelve un plan estructurado y lo encola para Antigravity', async () => {
  let structuredRequest = false;
  const remote = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && req.url === '/v1/models') return res.end(JSON.stringify({ object: 'list', data: [] }));
      if (req.method === 'POST' && req.url === '/v1/responses') {
        const body = JSON.parse(raw);
        structuredRequest = body.text?.format?.name === 'antigravity_execution_plan';
        return res.end(JSON.stringify({ output_text: JSON.stringify({
          summary: 'Plan de ejecución verificable',
          objective: 'Corregir el módulo de prueba',
          instructions: ['Inspeccionar el archivo', 'Aplicar el parche y validar sintaxis'],
          files: [{ path: 'server.js', action: 'modify', reason: 'Aplicar la corrección solicitada' }],
          patch: 'diff --git a/ORCHESTRATION_TEST.txt b/ORCHESTRATION_TEST.txt\nnew file mode 100644\n--- /dev/null\n+++ b/ORCHESTRATION_TEST.txt\n@@ -0,0 +1 @@\n+test plan\n',
          verification: ['syntax'],
          acceptanceCriteria: ['La sintaxis debe ser válida'],
          riskNotes: [],
          requiresReview: false
        }) }));
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: 'not found' } }));
    });
  });
  await new Promise(resolve => remote.listen(0, '127.0.0.1', resolve));
  const previousBaseUrl = adapters.openai.baseUrl;
  try {
    adapters.openai.baseUrl = `http://127.0.0.1:${remote.address().port}/v1/`;
    const configured = await request('/api/adapters/openai/configure', 'POST', { apiKey: 'sk-test-orchestrator' }, browserHeaders());
    assert.equal(configured.status, 200);

    const response = await request('/api/chat', 'POST', {
      message: 'Corrige el módulo de prueba y ejecuta la verificación',
      model: 'GPT-5.6 Luna'
    }, browserHeaders());
    assert.equal(response.status, 201);
    assert.equal(response.body.run.intent, 'orchestration');
    let stateResponse;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      stateResponse = await request('/api/state');
      const currentRun = stateResponse.body.runs.find(item => item.id === response.body.run.id);
      if (currentRun?.orchestration && currentRun?.status === 'queued') break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const currentRun = stateResponse.body.runs.find(item => item.id === response.body.run.id);
    assert.equal(currentRun.orchestration.objective, 'Corregir el módulo de prueba');
    assert.equal(currentRun.status, 'queued');
    const task = stateResponse.body.tasks.find(item => item.id === currentRun.taskId);
    assert.equal(task.agent, 'OpenAI Orchestrator');
    assert.equal(task.intent, 'orchestrate');
    assert.equal(structuredRequest, true);

    let cancelPromise;
    const streamEvents = await new Promise((resolve, reject) => {
      const stream = http.get({ hostname: '127.0.0.1', port: TEST_PORT, path: `/api/runs/${response.body.run.id}/events` }, res => {
        let raw = '';
        let cancelSent = false;
        res.on('data', chunk => {
          raw += chunk;
          if (!cancelSent && raw.includes('"type":"state"')) {
            cancelSent = true;
            cancelPromise = request(`/api/runs/${response.body.run.id}/cancel`, 'POST', null, browserHeaders());
          }
        });
        res.on('end', () => resolve(parseSse(raw)));
      });
      stream.on('error', reject);
    });
    await cancelPromise;
    assert.ok(streamEvents.some(item => item.type === 'state' && item.run.activity?.length > 0));
    assert.equal(streamEvents.at(-1).type, 'done');
  } finally {
    await request('/api/adapters/openai/configure', 'DELETE', null, browserHeaders());
    adapters.openai.baseUrl = previousBaseUrl;
    await new Promise(resolve => remote.close(resolve));
  }
});
