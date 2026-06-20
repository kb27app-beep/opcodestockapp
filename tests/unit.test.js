// Unit tests for node-side pure logic (no browser/DOM needed).
// Run: node --test
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const cache = require('../cache');
const { normalize } = require('../yahoo-auth');
const { normalizeFmp } = require('../fundamentals-fallback');

test('cache: write then read returns data and freshness', () => {
  const key = 'unittest-' + process.pid;
  cache.write(key, { a: 1 });
  const hit = cache.read(key, 60000);
  assert.ok(hit, 'expected a cache hit');
  assert.deepStrictEqual(hit.data, { a: 1 });
  assert.strictEqual(hit.fresh, true);
  fs.unlinkSync(cache.fileFor(key));
});

test('cache: entries older than ttl are not fresh but still return data', () => {
  const key = 'unittest-stale-' + process.pid;
  // Write an artificially old entry so the staleness check is deterministic.
  fs.writeFileSync(cache.fileFor(key), JSON.stringify({ ts: Date.now() - 10000, data: { b: 2 } }));
  const stale = cache.read(key, 5000);   // 10s old vs 5s TTL -> stale
  assert.ok(stale);
  assert.strictEqual(stale.fresh, false);
  assert.deepStrictEqual(stale.data, { b: 2 });
  const fresh = cache.read(key, 60000);  // 10s old vs 60s TTL -> fresh
  assert.strictEqual(fresh.fresh, true);
  fs.unlinkSync(cache.fileFor(key));
});

test('cache: missing key returns null', () => {
  assert.strictEqual(cache.read('definitely-not-a-key-' + Date.now(), 1000), null);
});

test('normalize: flattens Yahoo {raw,fmt} into flat numbers/strings', () => {
  const result = {
    price: { marketCap: { raw: 4376979046400 }, longName: 'Apple Inc.', currency: 'USD' },
    summaryDetail: { trailingPE: { raw: 36.07 }, beta: { raw: 1.2 } },
    defaultKeyStatistics: { trailingEps: { raw: 6.1 }, priceToBook: { raw: 50 } },
    financialData: { returnOnEquity: { raw: 1.41 }, totalRevenue: { raw: 451442016256 }, debtToEquity: { raw: 79.5 } },
    assetProfile: { sector: 'Technology', industry: 'Consumer Electronics' },
  };
  const n = normalize(result);
  assert.strictEqual(n.marketCap, 4376979046400);
  assert.strictEqual(n.trailingPE, 36.07);
  assert.strictEqual(n.sector, 'Technology');
  assert.strictEqual(n.longName, 'Apple Inc.');
  assert.strictEqual(n.returnOnEquity, 1.41);
  assert.strictEqual(n.currency, 'USD');
  assert.strictEqual(n.source, 'yahoo-quoteSummary');
});

test('normalize: missing fields become null, not crashes', () => {
  const n = normalize({ price: {}, summaryDetail: {}, financialData: {}, assetProfile: {} });
  assert.strictEqual(n.marketCap, null);
  assert.strictEqual(n.sector, null);
  assert.strictEqual(n.trailingPE, null);
});

test('normalize: null input returns null', () => {
  assert.strictEqual(normalize(null), null);
});

test('normalizeFmp: maps FMP payload to the yahoo-auth shape with source fmp', () => {
  const n = normalizeFmp({
    profile: { mktCap: 3.4e12, sector: 'Technology', industry: 'Consumer Electronics',
               companyName: 'Apple Inc.', beta: 1.2, currency: 'USD' },
    ratios: { peRatioTTM: 36.07, returnOnEquityTTM: 1.41, netProfitMarginTTM: 0.25,
              operatingProfitMarginTTM: 0.31, priceToBookRatioTTM: 50,
              debtEquityRatioTTM: 0.795, dividendYielTTM: 0.005 },
    income: { revenue: 451442016256, eps: 6.1 },
    cashflow: { freeCashFlow: 9.9e10 },
    balance: { cashAndCashEquivalents: 3e10, totalDebt: 1.1e11 },
  });
  assert.strictEqual(n.source, 'fmp');
  assert.strictEqual(n.marketCap, 3.4e12);
  assert.strictEqual(n.trailingPE, 36.07);
  assert.strictEqual(n.longName, 'Apple Inc.');
  assert.strictEqual(n.returnOnEquity, 1.41);
  assert.strictEqual(n.profitMargins, 0.25);
  assert.strictEqual(n.totalRevenue, 451442016256);
  assert.strictEqual(n.eps, 6.1);
  assert.strictEqual(n.freeCashflow, 9.9e10);
  assert.strictEqual(n.totalCash, 3e10);
  // debtEquityRatioTTM is a ratio (0.795); Yahoo convention is a percent — expect *100.
  assert.ok(Math.abs(n.debtToEquity - 79.5) < 1e-9, 'debt/equity ratio should be scaled to percent');
});

test('normalizeFmp: missing sections degrade to null without crashing', () => {
  const n = normalizeFmp({ profile: { companyName: 'X' } });
  assert.strictEqual(n.source, 'fmp');
  assert.strictEqual(n.longName, 'X');
  assert.strictEqual(n.marketCap, null);
  assert.strictEqual(n.debtToEquity, null);
  assert.strictEqual(n.totalRevenue, null);
});

const { parseStreamJsonLine } = require('../ai-research');

test('parseStreamJsonLine: extracts text deltas, final result, ignores noise', () => {
  const lines = fs.readFileSync(path.join(__dirname, 'fixtures/claude-stream.jsonl'), 'utf8')
    .split('\n').filter(Boolean);
  const parsed = lines.map(parseStreamJsonLine);
  const deltas = parsed.filter(p => p && p.kind === 'delta').map(p => p.text);
  assert.deepStrictEqual(deltas, ['Hello', ' world']);
  const final = parsed.find(p => p && p.kind === 'final');
  assert.strictEqual(final.text, 'Hello world.');
  assert.strictEqual(parsed[0], null); // system/init ignored
});

test('parseStreamJsonLine: flags rate limit and errors', () => {
  assert.strictEqual(
    parseStreamJsonLine('{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","overageDisabledReason":"out_of_credits","resetsAt":1781934600}}').kind,
    'rate_limited');
  assert.strictEqual(
    parseStreamJsonLine('{"type":"result","is_error":true,"subtype":"error_max_turns"}').kind,
    'error');
  assert.strictEqual(parseStreamJsonLine('not json'), null);
});

const { buildPrompt } = require('../ai-research');

test('buildPrompt: includes symbol, US framing, and all 7 sections', () => {
  const p = buildPrompt('NVDA', { currentPrice: 170.2, sector: 'Technology' });
  assert.match(p, /NVDA/);
  assert.match(p, /US|United States/i);
  for (const s of ['News', 'Earnings', 'Analyst', 'Bull', 'Bear', 'Risk', 'Verdict']) {
    assert.match(p, new RegExp(s, 'i'));
  }
  assert.match(p, /170\.2/); // grounded with provided context
});

test('buildPrompt: omits context line cleanly when none given', () => {
  const p = buildPrompt('AAPL');
  assert.match(p, /AAPL/);
  assert.doesNotMatch(p, /undefined|null|NaN/);
});

const { runResearch } = require('../ai-research');
const { EventEmitter } = require('events');
const { Readable } = require('stream');

function fakeSpawnFromFixture() {
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/claude-stream.jsonl'), 'utf8');
  return () => {
    const proc = new EventEmitter();
    proc.stdout = Readable.from([fixture]);
    proc.stderr = Readable.from([]);
    proc.kill = () => {};
    // emit close after streams flush
    setImmediate(() => proc.emit('close', 0));
    return proc;
  };
}

test('runResearch: streams deltas and resolves with final text', async () => {
  const got = [];
  const res = await runResearch('NVDA', {}, d => got.push(d), { _spawn: fakeSpawnFromFixture() });
  assert.deepStrictEqual(got, ['Hello', ' world']);
  assert.strictEqual(res.text, 'Hello world.');
});

test('runResearch: maps spawn ENOENT to cli_missing', async () => {
  const fake = () => { const p = new EventEmitter(); p.stdout = Readable.from([]); p.stderr = Readable.from([]); p.kill = () => {};
    setImmediate(() => p.emit('error', Object.assign(new Error('nope'), { code: 'ENOENT' }))); return p; };
  await assert.rejects(runResearch('NVDA', {}, () => {}, { _spawn: fake }),
    err => err.code === 'cli_missing');
});

test('runResearch: blocks skill/agent/workflow hijack and enables only web tools', async () => {
  // Regression guard: a headless claude run must not be able to fork a background
  // deep-research workflow; it must answer inline with only web tools.
  let capturedArgs = null;
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/claude-stream.jsonl'), 'utf8');
  const fake = (_cmd, args) => {
    capturedArgs = args;
    const p = new EventEmitter();
    p.stdout = Readable.from([fixture]); p.stderr = Readable.from([]); p.kill = () => {};
    setImmediate(() => p.emit('close', 0));
    return p;
  };
  await runResearch('NVDA', {}, () => {}, { _spawn: fake });
  const di = capturedArgs.indexOf('--disallowedTools');
  assert.ok(di >= 0, 'must pass --disallowedTools');
  for (const t of ['Skill', 'Task', 'Workflow']) assert.ok(capturedArgs.includes(t), `must disallow ${t}`);
  const ai = capturedArgs.indexOf('--allowedTools');
  assert.ok(ai >= 0 && capturedArgs.includes('WebSearch'), 'must allow WebSearch');
  assert.ok(capturedArgs.includes('--append-system-prompt'), 'must steer inline answering');
});
