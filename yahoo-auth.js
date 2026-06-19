// yahoo-auth.js — Real Yahoo Finance fundamentals via an automated, authenticated browser.
//
// Why a browser: Yahoo's quoteSummary / v7 quote endpoints now require a per-session
// "crumb" plus A1/A3 cookies that are only handed out after the consent flow. A plain
// server-side fetch gets "Invalid Cookie" / "Unauthorized". A headless Chrome navigates
// the consent wall, collects the cookies, and the in-page fetch (which carries those
// cookies as first-party credentials) returns HTTP 200 with real data — this is the path
// proven to work, so all fundamentals fetches run *inside* the authenticated page.
//
// The browser is launched lazily on first request, kept alive across requests, and closed
// after an idle timeout. Results are cached per symbol. Any failure degrades gracefully:
// callers get null and the app falls back to its existing estimates.

const { chromium } = require('playwright-core');
const cache = require('./cache');

const QUOTE_SUMMARY_MODULES = [
  'price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile',
].join(',');

const CACHE_TTL_MS = 10 * 60 * 1000;     // fundamentals change slowly; 10 min is plenty
const STALE_MAX_MS = 24 * 60 * 60 * 1000;// serve cached data up to a day old if Yahoo fails
const IDLE_CLOSE_MS = 5 * 60 * 1000;     // free the browser after 5 min of no requests
const MIN_INTERVAL_MS = 1500;            // min gap between Yahoo hits (429 avoidance)
const NAV_TIMEOUT_MS = 30000;
const SESSION_KEY = 'yahoo-session';     // persisted storageState (cookies) on disk
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let browser = null;
let context = null;
let page = null;
let launching = null;          // in-flight launch promise (dedupes concurrent launches)
let idleTimer = null;
let lastError = null;
const memCache = new Map();     // symbol -> { ts, data } (hot, in-process)

// Serialize Yahoo hits through a single queue with a minimum interval. Concurrent
// /yf-fundamentals requests therefore can't stampede Yahoo into a 429.
let queueTail = Promise.resolve();
let lastHit = 0;
function enqueue(fn) {
  const run = queueTail.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastHit);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    try { return await fn(); } finally { lastHit = Date.now(); }
  });
  queueTail = run.catch(() => {});
  return run;
}

function scheduleIdleClose() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { close().catch(() => {}); }, IDLE_CLOSE_MS);
  if (idleTimer.unref) idleTimer.unref();
}

async function launchBrowser() {
  // Prefer the system Chrome (no extra download); fall back to a bundled Chromium if present.
  const attempts = [
    { channel: 'chrome', headless: true },
    { headless: true },
  ];
  let err;
  for (const opts of attempts) {
    try { return await chromium.launch(opts); }
    catch (e) { err = e; }
  }
  throw new Error('Could not launch a browser for Yahoo auth: ' + (err && err.message));
}

async function ensureSession() {
  if (page && !page.isClosed()) return;
  if (launching) return launching;
  launching = (async () => {
    browser = await launchBrowser();
    // Reuse a previously saved session (cookies) so cold starts skip the consent dance.
    const saved = cache.read(SESSION_KEY, null);
    const ctxOpts = { locale: 'en-US', userAgent: UA };
    if (saved && saved.data) ctxOpts.storageState = saved.data;
    context = await browser.newContext(ctxOpts);
    page = await context.newPage();
    // Speed/robustness: we only need cookies + the ability to fetch JSON, not a rendered
    // page. Abort heavy subresources so navigation commits in well under the timeout.
    await page.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'media' || t === 'font' || t === 'stylesheet') return route.abort();
      return route.continue();
    });
    // 'commit' resolves as soon as the response (and its Set-Cookie headers) lands — far
    // faster and more reliable than waiting for the full DOM of Yahoo's heavy quote page.
    try {
      await page.goto('https://finance.yahoo.com/quote/AAPL', { waitUntil: 'commit', timeout: NAV_TIMEOUT_MS });
    } catch (_) {
      // Even a timeout often still set the cookies; proceed and let the crumb poll decide.
    }
    await dismissConsent();
    // Poll until the crumb endpoint hands back a real token (cookies propagated).
    const crumb = await waitForCrumb();
    // Persist the authenticated cookies for the next cold start.
    if (crumb) { try { cache.write(SESSION_KEY, await context.storageState()); } catch (_) {} }
  })();
  try { await launching; }
  finally { launching = null; }
}

// Retries getcrumb until it returns a non-error token, giving cookies time to settle.
async function waitForCrumb() {
  for (let i = 0; i < 8; i++) {
    try {
      const crumb = await page.evaluate(async () =>
        (await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { credentials: 'include' })).text()
      );
      if (crumb && crumb.length < 40 && !/Unauthorized|Invalid|<|\{/.test(crumb)) return crumb;
    } catch (_) {}
    await page.waitForTimeout(1000);
  }
  return null;
}

async function dismissConsent() {
  try {
    const btn = page.locator('button[name="agree"], button:has-text("Accept all"), button.accept-all').first();
    if (await btn.isVisible({ timeout: 4000 })) {
      await btn.click();
      await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT_MS });
    }
  } catch (_) { /* no consent wall in this region */ }
}

// Run a quoteSummary fetch from inside the authenticated page so cookies are sent as
// first-party credentials. Returns { status, json }.
async function fetchSummaryInPage(symbol) {
  return page.evaluate(async ({ sym, modules }) => {
    async function getCrumb() {
      const r = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { credentials: 'include' });
      return (await r.text()).trim();
    }
    let crumb = await getCrumb();
    const url = (c) => `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${modules}&crumb=${encodeURIComponent(c)}`;
    let r = await fetch(url(crumb), { credentials: 'include' });
    if (r.status === 401 || r.status === 403) {
      // crumb may be stale — refetch once
      crumb = await getCrumb();
      r = await fetch(url(crumb), { credentials: 'include' });
    }
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { status: r.status, json };
  }, { sym: symbol, modules: QUOTE_SUMMARY_MODULES });
}

// Flatten Yahoo's {raw,fmt} value objects into the small set of fields the app needs.
function normalize(result) {
  if (!result) return null;
  const price = result.price || {};
  const sd = result.summaryDetail || {};
  const ks = result.defaultKeyStatistics || {};
  const fd = result.financialData || {};
  const ap = result.assetProfile || {};
  const raw = (o, k) => (o && o[k] && typeof o[k].raw === 'number' ? o[k].raw : null);
  return {
    marketCap: raw(price, 'marketCap'),
    trailingPE: raw(sd, 'trailingPE') ?? raw(price, 'trailingPE'),
    forwardPE: raw(sd, 'forwardPE') ?? raw(ks, 'forwardPE'),
    eps: raw(ks, 'trailingEps'),
    beta: raw(sd, 'beta') ?? raw(ks, 'beta'),
    dividendYield: raw(sd, 'dividendYield'),
    priceToBook: raw(ks, 'priceToBook'),
    sector: ap.sector || null,
    industry: ap.industry || null,
    longName: price.longName || price.shortName || null,
    returnOnEquity: raw(fd, 'returnOnEquity'),
    profitMargins: raw(fd, 'profitMargins'),
    operatingMargins: raw(fd, 'operatingMargins'),
    totalRevenue: raw(fd, 'totalRevenue'),
    revenueGrowth: raw(fd, 'revenueGrowth'),
    earningsGrowth: raw(fd, 'earningsGrowth'),
    debtToEquity: raw(fd, 'debtToEquity'),
    totalCash: raw(fd, 'totalCash'),
    totalDebt: raw(fd, 'totalDebt'),
    freeCashflow: raw(fd, 'freeCashflow'),
    currency: price.currency || sd.currency || null,
    source: 'yahoo-quoteSummary',
    fetchedAt: Date.now(),
  };
}

const cacheKey = (s) => 'fund-' + s;

// Read fresh cache (memory first, then disk). Returns data or null.
function readFresh(symbol) {
  const m = memCache.get(symbol);
  if (m && Date.now() - m.ts < CACHE_TTL_MS) return m.data;
  const d = cache.read(cacheKey(symbol), CACHE_TTL_MS);
  if (d && d.fresh) { memCache.set(symbol, { ts: d.ts, data: d.data }); return d.data; }
  return null;
}

// Read any cache entry up to STALE_MAX_MS old — last-resort fallback when Yahoo fails.
function readStale(symbol) {
  const m = memCache.get(symbol);
  if (m && Date.now() - m.ts < STALE_MAX_MS) return m.data;
  const d = cache.read(cacheKey(symbol), STALE_MAX_MS);
  return d ? d.data : null;
}

async function getFundamentals(symbol) {
  if (!symbol) throw new Error('symbol required');

  const fresh = readFresh(symbol);
  if (fresh) return fresh;

  // Single Yahoo hit per symbol, serialized through the rate-limit queue.
  return enqueue(async () => {
    // Re-check inside the queue: a concurrent request may have just filled the cache.
    const again = readFresh(symbol);
    if (again) return again;

    try {
      await ensureSession();
      scheduleIdleClose();

      let resp;
      try {
        resp = await fetchSummaryInPage(symbol);
      } catch (e) {
        await close().catch(() => {});   // page may have died; rebuild once
        await ensureSession();
        resp = await fetchSummaryInPage(symbol);
      }

      if (resp.status === 429) { lastError = 'rate-limited'; const e = new Error('Yahoo rate-limited (429)'); e.code = 429; throw e; }
      const result = resp.json && resp.json.quoteSummary && resp.json.quoteSummary.result && resp.json.quoteSummary.result[0];
      if (resp.status !== 200 || !result) { const e = new Error('quoteSummary failed: HTTP ' + resp.status); e.code = resp.status; throw e; }

      const data = normalize(result);
      memCache.set(symbol, { ts: Date.now(), data });
      cache.write(cacheKey(symbol), data);
      lastError = null;
      return data;
    } catch (err) {
      // Degrade to stale cache rather than failing outright when possible.
      const stale = readStale(symbol);
      if (stale) { lastError = (err.message || 'error') + ' (served stale)'; return { ...stale, stale: true }; }
      throw err;
    }
  });
}

async function close() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  const b = browser;
  browser = context = page = null;
  if (b) { try { await b.close(); } catch (_) {} }
}

module.exports = {
  getFundamentals, close,
  _state: () => ({ alive: !!page, cacheSize: memCache.size, lastError, minIntervalMs: MIN_INTERVAL_MS }),
};
