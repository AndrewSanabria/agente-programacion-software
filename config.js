const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.FORGE_DATA_DIR || path.join(ROOT, 'data'));
const WORKER_TOKEN_FILE = path.join(DATA_DIR, '.worker-token');

function createTokenFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const token = `forge_${crypto.randomBytes(24).toString('hex')}`;
  try {
    const fd = fs.openSync(WORKER_TOKEN_FILE, 'wx', 0o600);
    try { fs.writeFileSync(fd, `${token}\n`, { encoding: 'utf8' }); }
    finally { fs.closeSync(fd); }
    return token;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return readTokenFile();
  }
}

function readTokenFile() {
  try {
    const token = fs.readFileSync(WORKER_TOKEN_FILE, 'utf8').trim();
    if (token.length >= 32) return token;
  } catch (_) { /* Se crea debajo. */ }
  return createTokenFile();
}

function getWorkerToken() {
  const configured = String(process.env.FORGE_WORKER_TOKEN || '').trim();
  if (configured) return configured;
  return readTokenFile();
}

module.exports = { ROOT, DATA_DIR, WORKER_TOKEN_FILE, getWorkerToken };
