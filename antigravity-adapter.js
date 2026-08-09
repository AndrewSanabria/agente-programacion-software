const http = require('node:http');
const https = require('node:https');

class AntigravityAdapter {
  constructor(config = {}) {
    this.name = 'Antigravity Engine';
    this.url = config.url || process.env.ANTIGRAVITY_URL || null;
    this.token = config.token || process.env.ANTIGRAVITY_TOKEN || null;
    this.status = this.url ? 'disconnected' : 'missing_credentials';
    this.connected = false;
    this.lastHealthCheck = null;
    this.lastError = null;
  }

  async connect(options = {}) {
    if (options.url) this.url = options.url;
    if (options.token) this.token = options.token;
    return this.healthCheck();
  }

  request(method, pathname, body = null, timeout = 10000) {
    return new Promise((resolve, reject) => {
      let parsed;
      try { parsed = new URL(this.url); }
      catch (error) { reject(new Error(`URL inválida: ${error.message}`)); return; }
      const requestModule = parsed.protocol === 'https:' ? https : http;
      const basePath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
      const payload = body === null ? null : JSON.stringify(body);
      const requestPath = `${basePath}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
      const headers = {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
      };
      const req = requestModule.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: requestPath,
        method,
        headers,
        timeout
      }, res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let parsedBody = null;
          try { parsedBody = data ? JSON.parse(data) : {}; } catch (_) { parsedBody = { raw: data }; }
          resolve({ statusCode: res.statusCode || 0, body: parsedBody });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Timeout al conectar con Antigravity')));
      if (payload) req.write(payload);
      req.end();
    });
  }

  async healthCheck() {
    if (!this.url) {
      this.status = 'missing_credentials';
      this.connected = false;
      this.lastError = 'ANTIGRAVITY_URL no configurado';
      return { ok: false, status: this.status, connected: false, error: this.lastError };
    }
    try {
      const response = await this.request('GET', '/health', null, 4000);
      if (response.statusCode >= 200 && response.statusCode < 300) {
        this.status = 'connected';
        this.connected = true;
        this.lastHealthCheck = new Date().toISOString();
        this.lastError = null;
        return { ok: true, status: this.status, statusCode: response.statusCode };
      }
      this.status = 'disconnected';
      this.connected = false;
      this.lastError = `HTTP ${response.statusCode}: ${JSON.stringify(response.body).slice(0, 150)}`;
      return { ok: false, status: this.status, connected: false, error: this.lastError };
    } catch (error) {
      this.status = 'disconnected';
      this.connected = false;
      this.lastError = error.message;
      return { ok: false, status: this.status, connected: false, error: this.lastError };
    }
  }

  async sendTask(taskPayload) {
    const health = await this.healthCheck();
    if (!health.ok) throw new Error(`No se puede enviar tarea: Antigravity ${this.status} (${this.lastError || 'sin conexión'})`);
    const response = await this.request('POST', '/api/tasks', taskPayload);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Antigravity rechazó la tarea con HTTP ${response.statusCode}`);
    }
    return response.body;
  }

  async cancelTask(taskId) {
    if (!this.connected) return { ok: false, error: 'Adaptador desconectado' };
    const response = await this.request('POST', `/api/tasks/${encodeURIComponent(taskId)}/cancel`);
    return { ...response.body, ok: response.statusCode >= 200 && response.statusCode < 300 };
  }

  disconnect() {
    this.status = 'disconnected';
    this.connected = false;
    return { ok: true, status: this.status };
  }

  getStatusInfo() {
    return {
      name: this.name,
      url: this.url,
      status: this.status,
      connected: this.connected,
      lastHealthCheck: this.lastHealthCheck,
      lastError: this.lastError
    };
  }
}

module.exports = AntigravityAdapter;
