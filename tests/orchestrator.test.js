// Tests for the provider cascade orchestrator (ai-research.js runResearch).
// Hermetic: providers are injected via opts._providers / opts._order, no real CLIs or network.
const { test } = require('node:test');
const assert = require('node:assert');
const { runResearch, listProviders } = require('../ai-research');

const ok = (id) => ({ id, label: id, webCapable: true, isAvailable: async () => true, run: async () => ({ text: `from-${id}`, durationMs: 1 }) });
const cap = (id, code) => ({ id, label: id, webCapable: true, isAvailable: async () => true, run: async () => { throw Object.assign(new Error(code), { code }); } });

test('cascade falls through a capacity failure to the next provider', async () => {
  const res = await runResearch('NVDA', {}, () => {}, { _providers: [cap('claude', 'rate_limited'), ok('api')], _order: ['claude', 'api'] });
  assert.strictEqual(res.text, 'from-api');
  assert.strictEqual(res.provider, 'api');
});

test('cascade stops at the first success', async () => {
  const res = await runResearch('NVDA', {}, () => {}, { _providers: [ok('claude'), ok('api')], _order: ['claude', 'api'] });
  assert.strictEqual(res.provider, 'claude');
});

test('explicit provider override bypasses the rest of the cascade', async () => {
  const res = await runResearch('NVDA', {}, () => {}, { provider: 'api', _providers: [ok('claude'), ok('api')], _order: ['claude', 'api'] });
  assert.strictEqual(res.provider, 'api');
});

test('non-web-capable providers are excluded from the cascade', async () => {
  const noweb = { ...ok('codex'), webCapable: false };
  const res = await runResearch('NVDA', {}, () => {}, { _providers: [noweb, ok('api')], _order: ['codex', 'api'] });
  assert.strictEqual(res.provider, 'api');
});

test('all capacity failures -> all_providers_exhausted', async () => {
  await assert.rejects(
    runResearch('NVDA', {}, () => {}, { _providers: [cap('claude', 'rate_limited'), cap('api', 'not_authenticated')], _order: ['claude', 'api'] }),
    e => e.code === 'all_providers_exhausted');
});

test('a content error stops the cascade (no fall-through)', async () => {
  await assert.rejects(
    runResearch('NVDA', {}, () => {}, { _providers: [cap('claude', 'exit_2'), ok('api')], _order: ['claude', 'api'] }),
    e => e.code === 'exit_2');
});

test('listProviders reports id/label/webCapable/available for every registered provider', async () => {
  const list = await listProviders({});
  const ids = list.map(p => p.id).sort();
  assert.deepStrictEqual(ids, ['agy', 'api', 'claude', 'codex']);
  for (const p of list) {
    assert.strictEqual(typeof p.available, 'boolean');
    assert.strictEqual(typeof p.webCapable, 'boolean');
  }
});

test('an unknown provider id in the order is skipped, not fatal', async () => {
  const res = await runResearch('NVDA', {}, () => {}, { _providers: [ok('api')], _order: ['ghost', 'api'] });
  assert.strictEqual(res.provider, 'api');
});

test('all_providers_exhausted message lists the per-provider reasons tried', async () => {
  await assert.rejects(
    runResearch('NVDA', {}, () => {}, { _providers: [cap('claude', 'rate_limited')], _order: ['claude'] }),
    e => e.code === 'all_providers_exhausted' && /claude: rate_limited/.test(e.message));
});

test('cascade with no web-capable providers rejects as exhausted', async () => {
  const noweb = { ...ok('codex'), webCapable: false };
  await assert.rejects(
    runResearch('NVDA', {}, () => {}, { _providers: [noweb], _order: ['codex'] }),
    e => e.code === 'all_providers_exhausted');
});
