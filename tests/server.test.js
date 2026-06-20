// Integration tests for the HTTP server: health, status, SSRF allowlist, validation.
// Spawns the real server on a throwaway port. Avoids hitting live Yahoo so it runs offline.
// Run: node --test
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const PORT = 3900 + (process.pid % 90);
const BASE = `http://localhost:${PORT}`;
let srv;

function get(p) {
  return new Promise((resolve, reject) => {
    http.get(BASE + p, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve({ status: r.statusCode, body: d })); }).on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

before(async () => {
  srv = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  // Wait for the server to answer /healthz.
  for (let i = 0; i < 30; i++) {
    try { if ((await get('/healthz')).status === 200) return; } catch (_) {}
    await sleep(200);
  }
  throw new Error('server did not start');
});

after(() => { if (srv) srv.kill('SIGKILL'); });

test('/healthz returns ok', async () => {
  const r = await get('/healthz');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(JSON.parse(r.body).ok, true);
});

test('/yf-status returns state shape', async () => {
  const r = await get('/yf-status');
  assert.strictEqual(r.status, 200);
  const body = JSON.parse(r.body);
  assert.ok('loaded' in body);
  // Fallback key is unset in the test environment — reported as a boolean false, never the key.
  assert.strictEqual(body.fallbackConfigured, false);
});

test('/proxy blocks SSRF to private/metadata hosts', async () => {
  for (const target of ['http://169.254.169.254/latest/meta-data/', 'http://localhost:22/', 'file:///etc/passwd']) {
    const r = await get('/proxy?url=' + encodeURIComponent(target));
    assert.strictEqual(r.status, 403, `expected 403 for ${target}`);
  }
});

test('/proxy requires a url param', async () => {
  assert.strictEqual((await get('/proxy')).status, 400);
});

test('/proxy allows api.telegram.org (alert dispatch host)', async () => {
  // Allowlisted host must pass the SSRF guard. Whether the upstream call
  // succeeds (200/4xx passthrough) or fails offline (502), it must NOT be the
  // 403 the guard returns for blocked hosts, nor the 400 for a missing url.
  const url = 'https://api.telegram.org/bot0:TEST/getMe';
  const r = await get('/proxy?url=' + encodeURIComponent(url));
  assert.notStrictEqual(r.status, 403, 'telegram host should be allowed');
  assert.notStrictEqual(r.status, 400);
});

test('/yf and /yf-fundamentals require a symbol', async () => {
  assert.strictEqual((await get('/yf')).status, 400);
  assert.strictEqual((await get('/yf-fundamentals')).status, 400);
});

test('static index.html and js modules are served', async () => {
  assert.strictEqual((await get('/')).status, 200);
  assert.strictEqual((await get('/js/main.js')).status, 200);
  assert.strictEqual((await get('/styles.css')).status, 200);
});
