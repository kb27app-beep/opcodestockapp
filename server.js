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

async function fetchUrl(targetUrl) {
  const resp = await fetch(targetUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  const text = await resp.text();
  const contentType = resp.headers.get('content-type') || 'application/json';
  return { status: resp.status, contentType, text };
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

  // ---- GENERIC PROXY ----
  if (url.pathname === '/proxy') {
    const target = url.searchParams.get('url');
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing url' }));
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
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { host, port, user, pass, to, subject, text } = JSON.parse(body);
        if (!host || !port || !user || !pass || !to || !subject || !text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Missing required fields' }));
        }
        const transporter = nodemailer.createTransport({
          host, port: parseInt(port), secure: parseInt(port) === 465,
          auth: { user, pass }
        });
        await transporter.sendMail({ from: user, to, subject, text });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
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

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log('');
  console.log('============================================');
  console.log('  Analyze Indian Stocks like a Pro');
  console.log(`  Server running at: ${url}`);
  console.log('============================================');
  console.log('  Open this link in your browser!');
  console.log('');
  const { exec } = require('child_process');
  const platform = process.platform;
  const cmd = platform === 'win32' ? `start "" "${url}"`
    : platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd);
});
