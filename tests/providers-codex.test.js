const { test } = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const { EventEmitter } = require('events'); const { Readable } = require('stream');
const codex = require('../providers/codex');

test('codex provider declares the interface', () => {
  assert.strictEqual(codex.id, 'codex');
  assert.strictEqual(codex.webCapable, true);
  assert.strictEqual(typeof codex.run, 'function');
  assert.strictEqual(typeof codex.isAvailable, 'function');
});

test('parseCodexLine extracts agent_message text and ignores other items', () => {
  const lines = fs.readFileSync(path.join(__dirname, 'fixtures/codex-stream.jsonl'), 'utf8').split('\n').filter(Boolean);
  const parsed = lines.map(codex.parseCodexLine);
  const deltas = parsed.filter(p => p && p.kind === 'delta').map(p => p.text);
  assert.ok(deltas.length >= 2, 'should yield the agent_message texts');
  assert.match(deltas[deltas.length - 1], /NVDA/);
  assert.strictEqual(codex.parseCodexLine('{"type":"item.completed","item":{"type":"web_search","query":"x"}}'), null);
  assert.strictEqual(codex.parseCodexLine('{"type":"turn.completed"}'), null);
  assert.strictEqual(codex.parseCodexLine('not json'), null);
});

test('run streams agent_message deltas and resolves with the final answer', async () => {
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/codex-stream.jsonl'), 'utf8');
  const fake = () => { const p = new EventEmitter(); p.stdout = Readable.from([fixture]); p.stderr = Readable.from([]); p.kill = () => {};
    setImmediate(() => p.emit('close', 0)); return p; };
  const got = [];
  const res = await codex.run('NVDA', {}, d => got.push(d), { _spawn: fake });
  assert.ok(got.length >= 2);
  assert.match(res.text, /NVDA/);
});

test('run maps ENOENT to cli_missing', async () => {
  const fake = () => { const p = new EventEmitter(); p.stdout = Readable.from([]); p.stderr = Readable.from([]); p.kill = () => {};
    setImmediate(() => p.emit('error', Object.assign(new Error('nope'), { code: 'ENOENT' }))); return p; };
  await assert.rejects(codex.run('NVDA', {}, () => {}, { _spawn: fake }), e => e.code === 'cli_missing');
});
