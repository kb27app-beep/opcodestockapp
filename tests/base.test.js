// Unit tests for providers/base.js shared helpers.
const { test } = require('node:test');
const assert = require('node:assert');
const base = require('../providers/base');

test('base.typedError attaches a code', () => {
  const e = base.typedError('boom', 'rate_limited');
  assert.strictEqual(e.code, 'rate_limited');
  assert.strictEqual(e.message, 'boom');
});

test('base.splitLines yields complete lines and keeps the remainder', () => {
  const { lines, rest } = base.splitLines('a\nb\npartial');
  assert.deepStrictEqual(lines, ['a', 'b']);
  assert.strictEqual(rest, 'partial');
});

test('base.cleanEnv strips CLAUDE*/ANTHROPIC* but keeps PATH/HOME', () => {
  const out = base.cleanEnv({ PATH: '/x', CLAUDE_FOO: '1', ANTHROPIC_API_KEY: 'k', HOME: '/h' });
  assert.strictEqual(out.PATH, '/x');
  assert.strictEqual(out.HOME, '/h');
  assert.ok(!('CLAUDE_FOO' in out));
  assert.ok(!('ANTHROPIC_API_KEY' in out));
});

test('base.buildPrompt includes symbol, US framing, all 7 sections, and grounding', () => {
  const p = base.buildPrompt('NVDA', { currentPrice: 170.2, sector: 'Technology' });
  assert.match(p, /NVDA/);
  assert.match(p, /US-equity|US-listed/i);
  for (const s of ['News', 'Earnings', 'Analyst', 'Bull', 'Bear', 'Risk', 'Verdict']) {
    assert.match(p, new RegExp(s, 'i'));
  }
  assert.match(p, /170\.2/);
});
