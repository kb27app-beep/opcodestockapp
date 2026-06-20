const { test } = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const { EventEmitter } = require('events'); const { Readable } = require('stream');
const agy = require('../providers/agy');

test('agy provider declares the interface', () => {
  assert.strictEqual(agy.id, 'agy');
  assert.strictEqual(agy.webCapable, true);
  assert.strictEqual(typeof agy.run, 'function');
  assert.strictEqual(typeof agy.isAvailable, 'function');
});

test('extractFinal trims the streamed text', () => {
  assert.strictEqual(agy.extractFinal('  hello world  \n'), 'hello world');
});

test('run streams text and resolves with the full answer', async () => {
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/agy-stream.txt'), 'utf8');
  const fake = () => { const p = new EventEmitter(); p.stdout = Readable.from([fixture]); p.stderr = Readable.from([]); p.kill = () => {};
    setImmediate(() => p.emit('close', 0)); return p; };
  const got = [];
  const res = await agy.run('NVDA', {}, d => got.push(d), { _spawn: fake });
  assert.ok(got.length >= 1, 'onText called at least once');
  assert.match(res.text, /NVDA/);
  assert.strictEqual(res.text, fixture.trim());
});

test('run maps ENOENT to cli_missing', async () => {
  const fake = () => { const p = new EventEmitter(); p.stdout = Readable.from([]); p.stderr = Readable.from([]); p.kill = () => {};
    setImmediate(() => p.emit('error', Object.assign(new Error('nope'), { code: 'ENOENT' }))); return p; };
  await assert.rejects(agy.run('NVDA', {}, () => {}, { _spawn: fake }), e => e.code === 'cli_missing');
});
