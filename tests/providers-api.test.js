const { test } = require('node:test'); const assert = require('node:assert');
const { Readable } = require('stream');
const api = require('../providers/api');

function sseResponse(chunks) {
  const body = chunks.map(c => 'data: ' + JSON.stringify({ choices: [{ delta: { content: c } }] }) + '\n\n').join('') + 'data: [DONE]\n\n';
  return { ok: true, status: 200, body: Readable.from([body]) };
}

test('parseSseData extracts content deltas and ignores [DONE]', () => {
  assert.strictEqual(api.parseSseData(JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })), 'hi');
  assert.strictEqual(api.parseSseData('[DONE]'), null);
  assert.strictEqual(api.parseSseData('garbage'), null);
});

test('webCapable is true only in a web-search mode', () => {
  assert.strictEqual(api.webCapable({ apiModel: 'openai/gpt-4o:online' }), true);
  assert.strictEqual(api.webCapable({ apiModel: 'sonar-pro' }), true);
  assert.strictEqual(!!api.webCapable({ apiModel: 'openai/gpt-4o' }), false);
});

test('isAvailable requires key + baseUrl + model', () => {
  assert.strictEqual(api.isAvailable({ apiKey: 'k', apiBaseUrl: 'b', apiModel: 'm' }), true);
  assert.strictEqual(api.isAvailable({ apiKey: 'k' }), false);
});

test('run streams content deltas and resolves with the full text', async () => {
  const got = [];
  const res = await api.run('NVDA', {}, d => got.push(d), {
    _fetch: async () => sseResponse(['Hello', ' world']),
    settings: { apiKey: 'k', apiBaseUrl: 'https://openrouter.ai/api/v1', apiModel: 'openai/gpt-4o:online' },
  });
  assert.deepStrictEqual(got, ['Hello', ' world']);
  assert.strictEqual(res.text, 'Hello world');
});

test('run maps 401 to not_authenticated', async () => {
  await assert.rejects(api.run('NVDA', {}, () => {}, {
    _fetch: async () => ({ ok: false, status: 401, body: null }),
    settings: { apiKey: 'bad', apiBaseUrl: 'https://openrouter.ai/api/v1', apiModel: 'x:online' },
  }), e => e.code === 'not_authenticated');
});

test('run fails fast (no fetch) when settings are incomplete', async () => {
  let fetched = false;
  await assert.rejects(api.run('NVDA', {}, () => {}, {
    _fetch: async () => { fetched = true; return { ok: true, status: 200, body: Readable.from(['']) }; },
    settings: { apiKey: 'k' },   // missing baseUrl + model
  }), e => e.code === 'not_authenticated');
  assert.strictEqual(fetched, false, 'must not POST when unconfigured');
});
