// End-to-end browser tests. Loads the real app in headless Chrome and exercises the
// browser-side pure functions via page.evaluate (no DOM-refactor required), plus asserts
// the page renders without literal template artifacts or unexpected JS errors.
// Requires a local Chrome/Chromium. Run: node --test tests/browser.e2e.js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

const PORT = 3700 + (process.pid % 90);
const BASE = `http://localhost:${PORT}`;
let srv, browser, page;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = p => new Promise((res, rej) => http.get(BASE + p, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(r.statusCode)); }).on('error', rej));
const pageErrors = [];

before(async () => {
  srv = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 30; i++) { try { if (await get('/healthz') === 200) break; } catch (_) {} await sleep(200); }
  browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  page = await browser.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  try { await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 30000 }); } catch (_) {}
  await sleep(3000);
});

after(async () => { if (browser) await browser.close(); if (srv) srv.kill('SIGKILL'); });

test('no literal ${...} template artifacts in the body', async () => {
  const txt = await page.evaluate(() => document.body.innerText);
  assert.ok(!txt.includes('${'), 'found unevaluated template expression in rendered body');
});

test('all module globals are wired', async () => {
  const types = await page.evaluate(() => ['showPage', 'searchStock', 'renderDashboard', 'renderAlerts', 'renderWatchlist', 'generateFullReport', 'fmtMcap', 'setTheme'].map(n => typeof window[n]));
  assert.ok(types.every(t => t === 'function'), 'a module global is missing: ' + types.join(','));
});

test('fmtMcap formats currency by market', async () => {
  const out = await page.evaluate(() => {
    state.market = 'IN'; const ind = fmtMcap(17953529528320);
    state.market = 'US'; const us = fmtMcap(4376979046400);
    const zero = fmtMcap(0);
    state.market = 'IN';
    return { ind, us, zero };
  });
  assert.match(out.ind, /₹.*Cr/);
  assert.match(out.us, /\$.*B/);
  assert.strictEqual(out.zero, 'N/A');
});

test('resolveSymbol maps tickers to exchanges', async () => {
  const out = await page.evaluate(() => {
    state.market = 'IN';
    return { reliance: resolveSymbol('RELIANCE').symbol, bse: resolveSymbol('TCS.BO').symbol };
  });
  assert.ok(out.reliance.endsWith('.NS'), 'expected NSE suffix, got ' + out.reliance);
  assert.ok(out.bse.endsWith('.BO'), 'expected BSE suffix preserved');
});

test('guessSector classifies known tickers', async () => {
  const out = await page.evaluate(() => ({ tcs: guessSector('TCS'), hdfc: guessSector('HDFCBANK'), unknown: guessSector('ZZZZ') }));
  assert.strictEqual(out.tcs, 'IT');
  assert.strictEqual(out.hdfc, 'BANKING');
  assert.strictEqual(out.unknown, 'DEFAULT');
});

test('evaluateWatchlistAlerts fires and logs a sent alert on target hit', async () => {
  await page.context().grantPermissions(['notifications'], { origin: BASE });
  const out = await page.evaluate(() => {
    state.emailAddress = ''; state.telegramToken = '';   // isolate to the push channel
    const before = getSentAlerts().length;
    const item = { symbol: 'TESTX.NS', _price: 150, target_price: 100, alert_target: 1, stop_loss: null, alert_stoploss: 0 };
    evaluateWatchlistAlerts(item);
    const alerts = getSentAlerts();
    return { before, after: alerts.length, top: alerts[0] || null, channels: activeAlertChannels() };
  });
  assert.strictEqual(out.after, out.before + 1, 'expected exactly one new sent alert');
  assert.match(out.top.message, /TESTX\.NS hit target 100/);
  assert.ok(out.channels.includes('push'), 'push channel should be active after grant');
});

test('dispatchAlert reports whatsapp as unsupported, never faked', async () => {
  const out = await page.evaluate(async () => await dispatchAlert('test', ['whatsapp', 'email']));
  assert.strictEqual(out.whatsapp, 'unsupported');
  assert.strictEqual(out.email, 'skipped');   // no SMTP configured in test
});

test('no unexpected page errors (sql.js wasm in headless is allowed)', () => {
  const unexpected = pageErrors.filter(e => !/WebAssembly|wasm|LinkError/i.test(e));
  assert.deepStrictEqual(unexpected, [], 'unexpected page errors: ' + unexpected.join(' | '));
});

test('AI research panel is wired (button, panel, handler)', async () => {
  // page already loaded by this suite's harness; reuse its `page` handle.
  const ok = await page.evaluate(() =>
    !!document.getElementById('aiResearchBtn') &&
    !!document.getElementById('aiResearchPanel') &&
    typeof window.startAiResearch === 'function');
  assert.strictEqual(ok, true);
});
