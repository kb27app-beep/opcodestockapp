// Analyze Indian Stocks like a Pro — Local Server + Yahoo Finance Proxy
// Usage: node server.js  (then open http://localhost:3000)
const http = require('http');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.wasm': 'application/wasm',
};

// SSRF guard: the generic /proxy endpoint may only reach a small allowlist of
// public financial-data hosts. Without this, anyone on the LAN could use this
// server to fetch internal/private URLs (cloud metadata, localhost services, etc.).
const PROXY_ALLOWED_HOSTS = [
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'finance.yahoo.com',
  'stooq.com',
  'stooq.pl',
  // Telegram Bot API — used by the client-side alert dispatcher to deliver
  // push messages through this server's /proxy (keeps the bot token off any
  // third-party CORS proxy and out of cross-origin requests).
  'api.telegram.org',
];

function isProxyTargetAllowed(targetUrl) {
  let u;
  try { u = new URL(targetUrl); } catch (_) { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  return PROXY_ALLOWED_HOSTS.some(h => host === h || host.endsWith('.' + h));
}

async function fetchUrl(targetUrl) {
  const resp = await fetch(targetUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  const text = await resp.text();
  const contentType = resp.headers.get('content-type') || 'application/json';
  return { status: resp.status, contentType, text };
}

const cache = require('./cache');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Maps typed errors from ai-research.js to user-friendly messages; keeps error copy
// in one place rather than scattered across the SSE handler.
function friendlyError(err) {
  switch (err.code) {
    case 'cli_missing': return 'Claude CLI not found on the server host.';
    case 'not_authenticated': return 'Claude CLI not logged in -- run `claude` once to authenticate.';
    case 'timeout': return 'Research timed out after 240s. Try again or narrow the request.';
    case 'rate_limited': return err.message;
    case 'busy': return 'Another research run is in progress. Try again shortly.';
    default: return 'AI research failed. See server log for details.';
  }
}
const MAX_BODY_BYTES = 256 * 1024;            // reject oversized POST bodies

// Lightweight per-IP throttle for the email endpoint (which sends real mail).
const emailHits = new Map();                  // ip -> [timestamps]
const EMAIL_WINDOW_MS = 60 * 1000, EMAIL_MAX = 5;
function emailThrottled(ip) {
  const now = Date.now();
  const hits = (emailHits.get(ip) || []).filter(t => now - t < EMAIL_WINDOW_MS);
  if (hits.length >= EMAIL_MAX) { emailHits.set(ip, hits); return true; }
  hits.push(now); emailHits.set(ip, hits);
  return false;
}

// Collect a POST body with a hard size cap.
function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let body = '', bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > limit) { reject(new Error('Body too large')); req.destroy(); return; }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // ---- HEALTH + FUNDAMENTALS STATUS ----
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()) }));
  }
  if (url.pathname === '/yf-status') {
    let state = { loaded: false };
    try { state = { loaded: true, ...require('./yahoo-auth')._state() }; } catch (_) {}
    // Boolean only — never leak whether the actual key value, just that one is set.
    try { state.fallbackConfigured = require('./fundamentals-fallback').isConfigured(); }
    catch (_) { state.fallbackConfigured = false; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(state));
  }

  // ---- YAHOO FINANCE PROXY ----
  // The browser cannot call Yahoo Finance directly (no CORS headers).
  // This endpoint fetches it server-side and returns the data.
  //
  // Usage: /yf?symbol=RELIANCE.NS&range=1y&interval=1d
  if (url.pathname === '/yf') {
    const symbol = url.searchParams.get('symbol');
    const range = url.searchParams.get('range') || '1y';
    const interval = url.searchParams.get('interval') || '1d';
    if (!symbol) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing symbol' }));
    }
    try {
      const apiUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
      const result = await fetchUrl(apiUrl);
      res.writeHead(result.status, { 'Content-Type': result.contentType });
      res.end(result.text);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ---- YAHOO SEARCH PROXY ----
  if (url.pathname === '/yf-search') {
    const q = url.searchParams.get('q');
    if (!q) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing q' }));
    }
    try {
      const apiUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&lang=en-US&region=IN`;
      const result = await fetchUrl(apiUrl);
      res.writeHead(result.status, { 'Content-Type': result.contentType });
      res.end(result.text);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ---- REAL FUNDAMENTALS (Yahoo quoteSummary via automated browser) ----
  // Returns real market cap, P/E, sector, margins, ROE, revenue, debt, etc.
  // Lazily loads yahoo-auth (and a headless browser) on first use. Any failure
  // degrades to HTTP 503 so the frontend keeps its estimate-based fallback.
  if (url.pathname === '/yf-fundamentals') {
    const symbol = url.searchParams.get('symbol');
    if (!symbol) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing symbol' }));
    }
    try {
      const yahooAuth = require('./yahoo-auth');
      const data = await yahooAuth.getFundamentals(symbol);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ symbol, data }));
    } catch (e) {
      // Yahoo failed. If a paid fallback key is configured, try FMP and serve its data
      // (normalized to the same shape) so the dashboard still shows live fundamentals.
      const cache = require('./cache');
      const FUND_TTL_MS = 6 * 60 * 60 * 1000;   // 6h, same horizon as yahoo-auth's cache
      const fallback = require('./fundamentals-fallback');
      if (fallback.isConfigured()) {
        const key = 'fund-' + symbol;
        try {
          const data = await fallback.getFromProvider(symbol);
          cache.write(key, data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ symbol, data }));
        } catch (fe) {
          // Last resort: any cached fallback/Yahoo data, even if stale.
          const hit = cache.read(key, null);
          if (hit && hit.data) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ symbol, data: { ...hit.data, stale: true } }));
          }
        }
      }
      const status = e && e.code === 429 ? 429 : 503;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message, fundamentals: null }));
    }
  }

  // ---- GENERIC PROXY ----
  if (url.pathname === '/proxy') {
    const target = url.searchParams.get('url');
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing url' }));
    }
    if (!isProxyTargetAllowed(target)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Target host not allowed' }));
    }
    try {
      const result = await fetchUrl(target);
      res.writeHead(result.status, { 'Content-Type': result.contentType });
      res.end(result.text);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ---- SEND EMAIL (via SMTP) ----
  if (url.pathname === '/send-email' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (emailThrottled(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Too many email requests, slow down' }));
    }
    (async () => {
      try {
        const body = await readBody(req);
        const { host, port, user, pass, to, subject, text } = JSON.parse(body);
        if (!host || !port || !user || !pass || !to || !subject || !text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Missing required fields' }));
        }
        const portNum = parseInt(port, 10);
        if (!EMAIL_RE.test(String(to)) || !EMAIL_RE.test(String(user))) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid email address' }));
        }
        if (!(portNum > 0 && portNum < 65536)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid SMTP port' }));
        }
        const transporter = nodemailer.createTransport({
          host, port: portNum, secure: portNum === 465,
          auth: { user, pass }
        });
        await transporter.sendMail({ from: user, to, subject, text });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        const code = e.message === 'Body too large' ? 413 : 502;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ---- AI RESEARCH SSE ----
  // Streams a claude-generated research report for a US stock symbol.
  // Uses AI_RESEARCH_FAKE=1 as a test seam so server tests stay offline.
  if (url.pathname === '/ai-research') {
    const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
    if (!/^[A-Z.]{1,8}$/.test(symbol)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid symbol' }));
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    const send = (obj, event) => {
      if (event) res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    const fresh = url.searchParams.get('fresh') === '1';
    const model = url.searchParams.get('model') || 'sonnet';
    const cacheKey = `airesearch-v1-${symbol}`;

    // Offline test seam: deterministic SSE without touching the real CLI.
    if (process.env.AI_RESEARCH_FAKE === '1') {
      send({ delta: 'Fake research for ' + symbol });
      send({ cached: false, durationMs: 1 }, 'done');
      res.end();
      return;
    }

    if (!fresh) {
      const hit = cache.read(cacheKey, 60 * 60 * 1000); // {data, ts, fresh} | null
      if (hit && hit.fresh && hit.data) {
        send({ cached: true });
        send({ delta: hit.data });
        send({ cached: true, durationMs: 0 }, 'done');
        res.end();
        return;
      }
    }

    // Optional grounding context passed from the browser (kept small; engine tolerates gaps).
    const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };
    const context = {
      name: url.searchParams.get('name') || undefined,
      currentPrice: num(url.searchParams.get('price')),
      pe: num(url.searchParams.get('pe')),
      sector: url.searchParams.get('sector') || undefined,
      marketCap: num(url.searchParams.get('mcap')),
    };

    const { runResearch } = require('./ai-research');
    runResearch(symbol, context, delta => send({ delta }), { model })
      .then(({ text, durationMs }) => {
        cache.write(cacheKey, text);
        send({ cached: false, durationMs }, 'done');
        res.end();
      })
      .catch(err => {
        console.error('ai-research error:', err.code, err.message);
        send({ code: err.code || 'error', message: friendlyError(err) }, 'error');
        res.end();
      });
    return;
  }

  // ---- STATIC FILES ----
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.join(ROOT, filePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

function openBrowser(url) {
  const { exec } = require('child_process');
  const platform = process.platform;
  const cmd = platform === 'win32' ? `start "" "${url}"`
    : platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd);
}

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log('');
  console.log('============================================');
  console.log('  Analyze Indian Stocks like a Pro');
  console.log(`  Server running at: ${url}`);
  console.log('============================================');
  console.log('  Open this link in your browser!');
  console.log('');
  // Only pop a browser tab for a normal launch (npm start / start.bat / node server.js),
  // which uses the default port. Test harnesses and scratch scripts set an explicit PORT
  // and must NOT spawn tabs (that was littering random-port tabs across sessions).
  // NO_OPEN=1 also suppresses it for headless/CI use.
  if (!process.env.PORT && !process.env.NO_OPEN) openBrowser(url);
});

// If the default port is already taken it's almost always a previous instance still
// running. Don't crash with an unhandled 'error' and don't silently climb to a random
// port — point the user at the existing server on 3000 and exit cleanly.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const url = `http://localhost:${PORT}`;
    console.error('');
    console.error(`  Port ${PORT} is already in use — a server is likely already running.`);
    console.error(`  Open ${url} in your browser (or stop the other process and retry).`);
    console.error('');
    if (!process.env.PORT && !process.env.NO_OPEN) openBrowser(url);
    process.exit(0);
  }
  throw err;
});

// Graceful shutdown: stop accepting connections and close the Yahoo browser if it was
// launched, so Ctrl-C doesn't leave an orphaned headless Chrome behind.
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => process.exit(0));
  try { require.cache[require.resolve('./yahoo-auth')] && require('./yahoo-auth').close(); } catch (_) {}
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
