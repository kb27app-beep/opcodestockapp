const { test } = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const settings = require('../settings');
function tmpStore() { return path.join(os.tmpdir(), 'secrets-test-' + process.pid + '-' + Math.floor(Math.random()*1e9) + '.json'); }

test('writeSettings round-trips and readSettings reflects it', () => {
  const p = tmpStore();
  settings.writeSettings({ apiKey: 'sk-secret', apiBaseUrl: 'https://openrouter.ai/api/v1', apiModel: 'x:online' }, { _path: p });
  const s = settings.readSettings({ _path: p });
  assert.strictEqual(s.apiKey, 'sk-secret');
  assert.strictEqual(s.apiModel, 'x:online');
  fs.unlinkSync(p);
});

test('publicView never leaks a key value, only booleans + non-secret config', () => {
  const view = settings.publicView({ apiKey: 'sk-secret', fmpKey: 'fmp-secret', apiBaseUrl: 'https://b', apiModel: 'x:online' });
  const json = JSON.stringify(view);
  assert.ok(!json.includes('sk-secret'), 'must not contain apiKey value');
  assert.ok(!json.includes('fmp-secret'), 'must not contain fmpKey value');
  assert.strictEqual(view.configured.api, true);
  assert.strictEqual(view.configured.fmp, true);
  assert.strictEqual(view.apiBaseUrl, 'https://b');
});

test('FMP_API_KEY env is honored when the store has no fmpKey', () => {
  const p = tmpStore();
  process.env.FMP_API_KEY = 'env-fmp';
  const s = settings.readSettings({ _path: p });
  assert.strictEqual(settings.getFmpKey(s), 'env-fmp');
  delete process.env.FMP_API_KEY;
});
