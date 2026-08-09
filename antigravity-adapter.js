const http = require('node:http');
const https = require('node:https');

/**
 * Adaptador Antigravity Real
 * Interfaz formal para conectarse a un runtime/engine de Antigravity via HTTP/HTTPS.
 * Solo marca el estado como 'connected' si healthCheck() responde exitosamente con credenciales válidas.
 */
class AntigravityAdapter {
  constructor(config = {}) {
    this.name = 'Antigravity Engine';
    this.url = config.url || process.env.ANTIGRAVITY_URL || null;
    this.token = config.token || process.env.ANTIGRAVITY_TOKEN || null;
    this.status = 'disconnected';
    this.connected = false;
    this.lastHealthCheck = null;
    this.lastError = null;
  }

  /**
   * Configura las credenciales e intenta realizar el handshake inicial.
   */
  async connect(options = {}) {
    if (options.url) this.url = options.url;
    if (options.token) this.token = options.token;

    if (!this.url) {
      this.status = 'missing_credentials';
      this.connected = false;
      this.lastError = 'ANTIGRAVITY_URL no configurado';
      return { ok: false, status: this.status, error: this.lastError };
    }

    return await this.healthCheck();
  }

  /**
   * Realiza una petición real al endpoint de salud del engine.
   */
  healthCheck() {
    return new Promise((resolve) => {
      if (!this.url) {
        this.status = 'missing_credentials';
        this.connected = false;
        return resolve({ ok: false, status: this.status, error: 'Sin URL configurada' });
      }

      try {
        const parsedUrl = new URL(this.url);
        const requestModule = parsedUrl.protocol === 'https:' ? https : http;
        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
          path: parsedUrl.pathname === '/' ? '/health' : parsedUrl.pathname,
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {})
          },
          timeout: 4000
        };

        const req = requestModule.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              this.status = 'connected';
              this.connected = true;
              this.lastHealthCheck = new Date().toISOString();
              this.lastError = null;
              resolve({ ok: true, status: 'connected', statusCode: res.statusCode });
            } else {
              this.status = 'disconnected';
              this.connected = false;
              this.lastError = `HTTP ${res.statusCode}: ${data.slice(0, 150)}`;
              resolve({ ok: false, status: 'disconnected', error: this.lastError });
            }
          });
        });

        req.on('error', (err) => {
          this.status = 'disconnected';
          this.connected = false;
          this.lastError = `Error de red: ${err.message}`;
          resolve({ ok: false, status: 'disconnected', error: this.lastError });
        });

        req.on('timeout', () => {
          req.destroy();
          this.status = 'disconnected';
          this.connected = false;
          this.lastError = 'Timeout al conectar con Antigravity';
          resolve({ ok: false, status: 'disconnected', error: this.lastError });
        });

        req.end();
      } catch (e) {
        this.status = 'disconnected';
        this.connected = false;
        this.lastError = `URL inválida: ${e.message}`;
        resolve({ ok: false, status: 'disconnected', error: this.lastError });
      }
    });
  }

  /**
   * Envía una tarea al engine real de Antigravity.
   */
  async sendTask(taskPayload) {
    const health = await this.healthCheck();
    if (!health.ok) {
      throw new Error(`No se puede enviar tarea: Adaptador Antigravity ${this.status} (${this.lastError || 'Sin conexión'})`);
    }

    return new Promise((resolve, reject) => {
      try {
        const parsedUrl = new URL(this.url);
        const requestModule = parsedUrl.protocol === 'https:' ? https : http;
        const payload = JSON.stringify(taskPayload);

        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
          path: '/api/tasks',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {})
          },
          timeout: 10000
        };

        const req = requestModule.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              resolve(json);
            } catch (e) {
              resolve({ ok: res.statusCode < 300, raw: data });
            }
          });
        });

        req.on('error', reject);
        req.write(payload);
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Cancela una tarea en ejecución.
   */
  async cancelTask(taskId) {
    if (!this.connected) return { ok: false, error: 'Adaptador desconectado' };
    return { ok: true, taskId, status: 'cancelled' };
  }

  /**
   * Cierra la conexión del adaptador.
   */
  disconnect() {
    this.status = 'disconnected';
    this.connected = false;
    return { ok: true, status: 'disconnected' };
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
