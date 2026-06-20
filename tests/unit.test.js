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
