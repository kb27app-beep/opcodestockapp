# Generalize AI Providers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI research engine multi-provider — local CLIs (`claude` done, `codex`, `agy`) tried first, then a generic manual-API-key provider — selected by an auto-cascade with a manual override, with keys stored server-side and never returned to the client.

**Architecture:** `ai-research.js` becomes a thin orchestrator that builds and runs a provider cascade. Each provider is a small module under `providers/` implementing a shared interface (`id`, `label`, `webCapable`, `isAvailable`, `run`). A new `settings.js` persists API keys to a gitignored `.secrets.json` and exposes a secret-free public view. `server.js` gains `GET/POST /settings` and a `&provider=` override on `/ai-research`. The browser gets an "AI Providers" Settings card.

**Tech Stack:** Node 18+ (built-in `fetch`, `node:test`), zero new dependencies. Buildless browser JS (ordered classic scripts). Playwright-core for e2e.

## Global Constraints

- **Branch:** `upgrade/site-overhaul`. Never push to `main`, never open a PR. Commit per task; push to `origin/upgrade/site-overhaul` when the user asks.
- **Commit footer:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Secrets:** API keys are entered in Settings but stored **server-side only** (`.secrets.json`, gitignored). `GET /settings` returns **booleans only**, never a key value. No secret ever travels in a query string. `/ai-research` query params remain `symbol`, `fresh`, `model`, `provider` only.
- **Web-capable only:** only providers that can actually web-search join the research cascade. A provider that can't is `webCapable:false` and excluded.
- **Cascade default order:** `['claude','codex','agy','api']` (free local first, paid API last). Fall through only on capacity failures (`rate_limited`, `not_authenticated`, `cli_missing`, `busy`); a content error stops the cascade.
- **Backward compatibility (hard):** `ai-research.js` MUST keep exporting `parseStreamJsonLine`, `buildPrompt`, `runResearch`, `MAX_CONCURRENT`. `runResearch(symbol, context, onText, {_spawn})` MUST still route to the claude provider so all 7 existing engine tests in `tests/unit.test.js` stay green untouched.
- **Test gate:** `npm test` (offline) must be green before every commit. `npm run test:e2e` (needs Chrome) before the final commit.
- **Cost rule:** subagents/CLI calls use haiku where a model is chosen; sonnet only where genuinely needed; never opus.
- **App port:** always `http://localhost:3000`. Test/scratch spawns set `PORT` and must not open a browser tab.

---

### Task 1: Live capability probe for `codex` and `agy` (web search + output shape)

This task produces ground truth the later provider tasks depend on. It is investigation + fixtures, not TDD. **No code ships from this task except fixtures and a findings note.**

**Files:**
- Create: `tests/fixtures/codex-stream.jsonl` (captured non-interactive output, trimmed/representative)
- Create: `tests/fixtures/agy-stream.txt` (or `.jsonl` if agy emits JSON)
- Create: `docs/superpowers/notes/2026-06-20-codex-agy-probe.md` (findings)

- [ ] **Step 1: Probe codex non-interactive + web search.** Run from a tmp dir, subscription auth (mirror claude's `cleanEnv` intent):

```bash
cd /tmp && codex exec --help 2>&1 | head -40
# Try a tiny web-grounded prompt non-interactively. Look for: a JSON/stream flag,
# whether it performs a web search, and the event/text shape on stdout.
cd /tmp && codex exec "In one sentence with a source URL, what is NVIDIA's stock ticker?" 2>&1 | head -60
# If codex has a structured/json output flag (e.g. --json / --output-format), capture it:
# cd /tmp && codex exec --json "..." 2>&1 | head -60
```

- [ ] **Step 2: Probe agy non-interactive + web search.**

```bash
cd /tmp && agy --print "In one sentence with a source URL, what is NVIDIA's stock ticker?" 2>&1 | head -60
cd /tmp && agy models 2>&1 | head -30   # note available models for default selection
```

- [ ] **Step 3: Record findings** in `docs/superpowers/notes/2026-06-20-codex-agy-probe.md`: for each CLI — exact non-interactive invocation, exact flags that enable web search (or "none found"), the stdout shape (plain text vs JSON events; field path to incremental text and to final text), auth model (subscription vs API key), and the resulting **`webCapable` verdict (true/false)**. If a CLI cannot be made to web-search, mark it `webCapable:false`; its provider module (Task 4/5) is still built but is excluded from the research cascade and only usable via explicit override with a clear "no live web search" label.

- [ ] **Step 4: Save representative fixtures** (a few lines, enough to unit-test the parser): the captured stdout for each CLI to the fixture paths above.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/codex-stream.jsonl tests/fixtures/agy-stream.txt docs/superpowers/notes/2026-06-20-codex-agy-probe.md
git commit -m "research: probe codex/agy non-interactive + web-search capability (fixtures + findings)"
```

---

### Task 2: `providers/base.js` — shared interface helpers + move `buildPrompt`/`cleanEnv`

**Files:**
- Create: `providers/base.js`
- Test: extend `tests/unit.test.js` (no behavior change to buildPrompt — existing buildPrompt tests must still pass after re-export)

**Interfaces:**
- Produces: `buildPrompt(symbol, context) -> string`, `cleanEnv() -> object`, `splitLines(buf) -> {lines, rest}`, `typedError(message, code) -> Error`. The provider object shape (documented, not enforced): `{ id, label, webCapable, isAvailable(settings)->Promise<bool>, run(symbol,context,onText,opts)->Promise<{text,durationMs}> }`.

- [ ] **Step 1: Write the failing test** (append to `tests/unit.test.js`):

```javascript
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
test('base.cleanEnv strips CLAUDE*/ANTHROPIC* but keeps PATH', () => {
  const out = base.cleanEnv({ PATH: '/x', CLAUDE_FOO: '1', ANTHROPIC_API_KEY: 'k', HOME: '/h' });
  assert.strictEqual(out.PATH, '/x'); assert.strictEqual(out.HOME, '/h');
  assert.ok(!('CLAUDE_FOO' in out)); assert.ok(!('ANTHROPIC_API_KEY' in out));
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test` → FAIL "Cannot find module '../providers/base'".

- [ ] **Step 3: Implement `providers/base.js`** (move `buildPrompt` verbatim from `ai-research.js`; make `cleanEnv` accept an injectable env for testability):

```javascript
// providers/base.js — shared helpers + the provider-interface contract.
// A provider is: { id, label, webCapable:boolean|(settings)=>boolean,
//   isAvailable(settings)->Promise<bool>, run(symbol,context,onText,opts)->Promise<{text,durationMs}> }

function buildPrompt(symbol, context = {}) {
  // (moved verbatim from ai-research.js — keep identical so existing buildPrompt tests pass)
  const facts = [];
  if (context.name) facts.push(`Name: ${context.name}`);
  if (context.currentPrice != null) facts.push(`Current price: ${context.currentPrice}`);
  if (context.dayChangePct != null) facts.push(`Day change: ${context.dayChangePct}%`);
  if (context.pe != null) facts.push(`P/E: ${context.pe}`);
  if (context.marketCap != null) facts.push(`Market cap: ${context.marketCap}`);
  if (context.sector) facts.push(`Sector: ${context.sector}`);
  const grounding = facts.length
    ? `\nKnown data for grounding (verify if stale):\n${facts.join('\n')}\n` : '\n';
  return `You are a senior US-equity research analyst. Produce a current, well-sourced research report on the US-listed stock ${symbol}.
${grounding}
Use web search for anything time-sensitive. For every factual claim, cite the source and date inline.
Write in Markdown with exactly these sections, in order:

1. News and catalysts (recent, each dated)
2. Latest earnings and next earnings date (include guidance)
3. Analyst sentiment and price targets
4. Bull case
5. Bear case
6. Key risks
7. Bottom-line verdict

Be concise and specific. Do not invent numbers. If data is unavailable, say so.`;
}

function cleanEnv(src = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (/^(CLAUDE|ANTHROPIC)/.test(k)) continue;
    out[k] = v;
  }
  return out;
}

function splitLines(buf) {
  const parts = String(buf).split('\n');
  const rest = parts.pop();
  return { lines: parts, rest };
}

function typedError(message, code) {
  return Object.assign(new Error(message), { code });
}

module.exports = { buildPrompt, cleanEnv, splitLines, typedError };
```

- [ ] **Step 4: Run to verify it passes** — `npm test` → the 3 new tests PASS, existing 24 still PASS.

- [ ] **Step 5: Commit** — `git add providers/base.js tests/unit.test.js && git commit -m "feat: providers/base.js shared interface helpers"`

---

### Task 3: `providers/claude.js` — move claude into a provider; keep `ai-research.js` exports green

**Files:**
- Create: `providers/claude.js`
- Modify: `ai-research.js` (re-export from the new modules; keep `runResearch` working via the orchestrator added in Task 7 — for now `ai-research.js` delegates `runResearch` to `claude.run` so existing tests stay green)
- Test: existing `tests/unit.test.js` claude tests must pass unchanged.

**Interfaces:**
- Consumes: `base.buildPrompt`, `base.cleanEnv`, `base.splitLines`, `base.typedError`.
- Produces: a provider object `claude` and `parseStreamJsonLine(line)` (moved here). `claude.run(symbol, context, onText, opts)` accepts `opts.model` (default `haiku`), `opts.timeoutMs` (default 240000), `opts._spawn` (default `child_process.spawn`).

- [ ] **Step 1: Verify current claude tests are the contract** — re-read `tests/unit.test.js` lines for `parseStreamJsonLine`, `runResearch` (streams/ENOENT/hijack-guard). These must pass after the move.

- [ ] **Step 2: Implement `providers/claude.js`** — move `parseStreamJsonLine`, `rateLimitMessage`, and the spawn/stream body of `runResearch` here as `claude.run`. Use `base.cleanEnv()`, `base.buildPrompt`. Drop the per-module `_inflight` guard (the orchestrator owns concurrency now). `run` signature `(symbol, context, onText, opts={})`:

```javascript
// providers/claude.js — claude CLI provider (subscription auth, web-searched, stream-json).
const os = require('os');
const childProcess = require('child_process');
const { buildPrompt, cleanEnv, typedError } = require('./base');

function rateLimitMessage(info) {
  const when = info.resetsAt ? new Date(info.resetsAt * 1000).toLocaleTimeString() : 'later';
  return `Claude usage limit reached (resets at ${when}).`;
}

function parseStreamJsonLine(line) {
  let ev; try { ev = JSON.parse(line); } catch (_) { return null; }
  if (!ev || typeof ev !== 'object') return null;
  if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta'
      && ev.event.delta?.type === 'text_delta') return { kind: 'delta', text: ev.event.delta.text || '' };
  if (ev.type === 'rate_limit_event') {
    const info = ev.rate_limit_info || {};
    if (info.status && info.status !== 'allowed') return { kind: 'rate_limited', text: rateLimitMessage(info) };
    return null;
  }
  if (ev.type === 'result') {
    if (ev.is_error) return { kind: 'error', text: ev.subtype || 'result_error' };
    return { kind: 'final', text: typeof ev.result === 'string' ? ev.result : '' };
  }
  return null;
}

function run(symbol, context, onText, opts = {}) {
  const { model = 'haiku', timeoutMs = 240000, _spawn = childProcess.spawn } = opts;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const args = ['-p', buildPrompt(symbol, context),
      '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
      '--model', model,
      '--allowedTools', 'WebSearch', 'WebFetch',
      '--disallowedTools', 'Skill', 'Task', 'Workflow', 'TodoWrite',
      '--append-system-prompt',
      'Respond directly and inline as plain markdown. Do not use skills, subagents, or background workflows.',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--exclude-dynamic-system-prompt-sections'];
    const proc = _spawn('claude', args, { cwd: os.tmpdir(), env: cleanEnv() });
    let finalText = '', settled = false, stderrBuf = '', buf = '';
    const acc = [];
    const finish = (fn) => { if (settled) return; settled = true; clearTimeout(timer); fn(); };
    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 2000).unref?.();
      finish(() => reject(typedError('Research timed out', 'timeout')));
    }, timeoutMs);
    proc.stdout.on('data', chunk => {
      buf += chunk.toString(); let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const p = parseStreamJsonLine(line); if (!p) continue;
        if (p.kind === 'delta') { acc.push(p.text); onText(p.text); }
        else if (p.kind === 'final') finalText = p.text;
        else if (p.kind === 'rate_limited') { try { proc.kill('SIGTERM'); } catch (_) {} finish(() => reject(typedError(p.text, 'rate_limited'))); }
        else if (p.kind === 'error') { try { proc.kill('SIGTERM'); } catch (_) {} finish(() => reject(typedError(`AI research failed (${p.text})`, 'exit_error'))); }
      }
    });
    proc.stderr.on('data', d => { stderrBuf += d.toString(); });
    proc.on('error', err => finish(() => reject(typedError(err.message, err.code === 'ENOENT' ? 'cli_missing' : 'spawn_error'))));
    proc.on('close', codeNum => {
      const text = finalText || acc.join('');
      if (codeNum === 0 && text) finish(() => resolve({ text, durationMs: Date.now() - started }));
      else if (codeNum === 0) finish(() => reject(typedError('No output from CLI', 'no_output')));
      else finish(() => reject(typedError(stderrBuf.slice(0, 300) || `claude exited ${codeNum}`,
        /not.*logg|auth|login/i.test(stderrBuf) ? 'not_authenticated' : `exit_${codeNum}`)));
    });
  });
}

async function isAvailable() {
  // Cheap PATH check; never spawns a real run.
  const { existsSync } = require('fs');
  const paths = (process.env.PATH || '').split(':');
  return paths.some(p => p && existsSync(require('path').join(p, 'claude')));
}

module.exports = { id: 'claude', label: 'Claude (subscription CLI)', webCapable: true, isAvailable, run, parseStreamJsonLine };
```

- [ ] **Step 3: Make `ai-research.js` delegate for now** (full orchestrator lands in Task 7; this interim keeps tests green):

```javascript
// ai-research.js — orchestrator (interim delegate; full cascade in Task 7).
const { buildPrompt } = require('./providers/base');
const claude = require('./providers/claude');
const MAX_CONCURRENT = 2;
function runResearch(symbol, context, onText, opts = {}) {
  return claude.run(symbol, context, onText, opts);   // replaced by cascade in Task 7
}
module.exports = { parseStreamJsonLine: claude.parseStreamJsonLine, buildPrompt, runResearch, MAX_CONCURRENT };
```

- [ ] **Step 4: Run to verify** — `npm test` → all 27 PASS (24 prior + 3 base). The `runResearch` `_spawn`, ENOENT, and hijack-guard tests pass via `claude.run`.

- [ ] **Step 5: Commit** — `git add providers/claude.js ai-research.js && git commit -m "refactor: move claude into providers/claude.js; ai-research delegates"`

---

### Task 4: `providers/codex.js` — codex CLI provider (parser grounded in Task 1 fixture)

**Files:**
- Create: `providers/codex.js`
- Test: Create `tests/providers-codex.test.js`

**Interfaces:**
- Consumes: `base` helpers, `tests/fixtures/codex-stream.jsonl` (Task 1).
- Produces: provider object `codex` with `parseCodexLine(line)->{kind,text}|null` exported for testing.

- [ ] **Step 1: Write the failing test** using the Task-1 fixture (assert the parser extracts the incremental text and final text per the **documented shape in the probe note**). Skeleton (finalize field paths against the real fixture):

```javascript
const { test } = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const codex = require('../providers/codex');
test('codex parser extracts deltas and final text from fixture', () => {
  const lines = fs.readFileSync(path.join(__dirname, 'fixtures/codex-stream.jsonl'), 'utf8').split('\n').filter(Boolean);
  const parsed = lines.map(codex.parseCodexLine).filter(Boolean);
  const deltas = parsed.filter(p => p.kind === 'delta').map(p => p.text);
  assert.ok(deltas.length >= 1, 'should yield at least one text delta');
  const final = parsed.find(p => p.kind === 'final');
  assert.ok(final && typeof final.text === 'string');
});
test('codex provider declares interface', () => {
  assert.strictEqual(codex.id, 'codex');
  assert.strictEqual(typeof codex.run, 'function');
  assert.strictEqual(typeof codex.isAvailable, 'function');
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/providers-codex.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement `providers/codex.js`** — `run` spawns `codex exec` with the web-search-enabling flags found in Task 1, parses via `parseCodexLine` (built to the documented shape), streams deltas, resolves final text, maps errors to the shared `.code` taxonomy (`cli_missing`, `not_authenticated`, `rate_limited`, `exit_<n>`, `no_output`, `timeout`). `webCapable` = the Task-1 verdict (boolean literal). `isAvailable` = PATH check for `codex`. Mirror `providers/claude.js` structure; swap the spawn args + parser. Use `cwd: os.tmpdir()`, `env: cleanEnv()`.

- [ ] **Step 4: Run to verify it passes** — `node --test tests/providers-codex.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add providers/codex.js tests/providers-codex.test.js && git commit -m "feat: providers/codex.js (codex exec provider)"`

---

### Task 5: `providers/agy.js` — agy CLI provider (parser grounded in Task 1 fixture)

**Files:**
- Create: `providers/agy.js`
- Test: Create `tests/providers-agy.test.js`

**Interfaces:**
- Consumes: `base` helpers, `tests/fixtures/agy-stream.*` (Task 1).
- Produces: provider object `agy` with a parser exported for testing (`parseAgyChunk` if agy streams text, or `parseAgyLine` if JSON — match Task 1).

- [ ] **Step 1: Write the failing test** — analogous to Task 4, asserting the parser turns the agy fixture into deltas + final text and the provider exposes `{id:'agy', run, isAvailable}`.

- [ ] **Step 2: Run to verify it fails** — `node --test tests/providers-agy.test.js` → FAIL.

- [ ] **Step 3: Implement `providers/agy.js`** — `run` spawns `agy --print` (+ `--model <default from probe>` + any web-search flag) and parses per Task 1. If agy emits plain streamed text (no JSON events), the "parser" simply forwards text chunks as deltas and uses the full accumulated text as final; still expose it as a function for a unit test. `webCapable` = Task-1 verdict. `isAvailable` = PATH check for `agy`. Same error taxonomy.

- [ ] **Step 4: Run to verify it passes** — `node --test tests/providers-agy.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add providers/agy.js tests/providers-agy.test.js && git commit -m "feat: providers/agy.js (agy print provider)"`

---

### Task 6: `providers/api.js` — generic OpenAI-compatible streaming provider

**Files:**
- Create: `providers/api.js`
- Test: Create `tests/providers-api.test.js`

**Interfaces:**
- Consumes: `base` helpers; `opts._fetch` (injectable, defaults to global `fetch`); settings `{ apiKey, apiBaseUrl, apiModel }`.
- Produces: provider object `api`. `parseSseData(dataStr)->delta|null` exported for testing. `webCapable(settings)` returns true only when configured in a web-search mode (OpenRouter `:online` model, or a Perplexity `sonar*` model, or `apiWebSearch===true`).

- [ ] **Step 1: Write the failing test** (stub `fetch` returning a streamed OpenAI-style SSE body; assert deltas + final text, and webCapable logic):

```javascript
const { test } = require('node:test'); const assert = require('node:assert');
const api = require('../providers/api');
const { Readable } = require('stream');
function sseResponse(chunks) {
  const body = chunks.map(c => `data: ${JSON.stringify({ choices:[{ delta:{ content:c } }] })}\n\n`).join('')
    + 'data: [DONE]\n\n';
  return { ok: true, status: 200, body: Readable.from([body]) };
}
test('api.parseSseData extracts content deltas, ignores [DONE]', () => {
  assert.strictEqual(api.parseSseData(JSON.stringify({ choices:[{ delta:{ content:'hi' } }] })), 'hi');
  assert.strictEqual(api.parseSseData('[DONE]'), null);
});
test('api.run streams content and resolves with full text', async () => {
  const got = [];
  const res = await api.run('NVDA', {}, d => got.push(d), {
    _fetch: async () => sseResponse(['Hello', ' world']),
    settings: { apiKey: 'k', apiBaseUrl: 'https://openrouter.ai/api/v1', apiModel: 'openai/gpt-4o:online' },
  });
  assert.deepStrictEqual(got, ['Hello', ' world']);
  assert.strictEqual(res.text, 'Hello world');
});
test('api.webCapable true only in web-search mode', () => {
  assert.strictEqual(api.webCapable({ apiModel: 'openai/gpt-4o:online' }), true);
  assert.strictEqual(api.webCapable({ apiModel: 'sonar-pro' }), true);
  assert.strictEqual(api.webCapable({ apiModel: 'openai/gpt-4o' }), false);
});
test('api.run maps 401 to not_authenticated', async () => {
  await assert.rejects(
    api.run('NVDA', {}, () => {}, { _fetch: async () => ({ ok:false, status:401, body:null }),
      settings: { apiKey:'bad', apiBaseUrl:'https://openrouter.ai/api/v1', apiModel:'x:online' } }),
    e => e.code === 'not_authenticated');
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/providers-api.test.js` → FAIL.

- [ ] **Step 3: Implement `providers/api.js`** — POST `${apiBaseUrl}/chat/completions` with `Authorization: Bearer ${apiKey}`, `{ model, stream:true, messages:[{role:'user', content: buildPrompt(symbol, context)}] }`. Read the response body stream, split SSE on `\n`, for each `data:` line call `parseSseData` and forward non-null deltas via `onText`, accumulate. On end resolve `{text, durationMs}`. Map `status===401/403 -> not_authenticated`, `429 -> rate_limited`, other non-ok -> `exit_<status>`, empty -> `no_output`. Honor `opts.timeoutMs` via `AbortController`. `isAvailable(settings)` = `!!settings.apiKey && !!settings.apiBaseUrl && !!settings.apiModel`. `webCapable(settings)` = `/:online$/.test(model) || /^sonar/i.test(model) || settings.apiWebSearch === true`.

- [ ] **Step 4: Run to verify it passes** — `node --test tests/providers-api.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add providers/api.js tests/providers-api.test.js && git commit -m "feat: providers/api.js (OpenAI-compatible web-search provider)"`

---

### Task 7: `settings.js` — server-side secret store + secret-free public view

**Files:**
- Create: `settings.js`
- Test: Create `tests/settings.test.js`

**Interfaces:**
- Produces: `readSettings()->object` (merges `.secrets.json` over env fallbacks; includes secrets, for server-internal use only), `writeSettings(patch)->object` (persists only allowed keys; returns the new merged settings), `publicView(settings)->object` (secret-free, for `GET /settings`), `getFmpKey()->string|undefined`. Constants `SECRETS_PATH`, `ALLOWED_KEYS = ['apiKey','apiBaseUrl','apiModel','apiWebSearch','fmpKey','cascadeOrder']`.

- [ ] **Step 1: Write the failing test** (use a temp `SECRETS_PATH` override via `opts`/env so the test never writes the real file; assert round-trip, env fallback, and that `publicView` contains NO key value):

```javascript
const { test } = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const settings = require('../settings');
function tmpStore() { return path.join(os.tmpdir(), `secrets-test-${process.pid}-${Math.random().toString(36).slice(2)}.json`); }

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
  assert.strictEqual(view.apiBaseUrl, 'https://b');   // non-secret config is fine to expose
});
test('FMP_API_KEY env is honored when store has no fmpKey', () => {
  const p = tmpStore();
  process.env.FMP_API_KEY = 'env-fmp';
  const s = settings.readSettings({ _path: p });
  assert.strictEqual(settings.getFmpKey(s), 'env-fmp');
  delete process.env.FMP_API_KEY;
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/settings.test.js` → FAIL.

- [ ] **Step 3: Implement `settings.js`** — `SECRETS_PATH = path.join(__dirname, '.secrets.json')`. `readSettings({_path}={})` reads+parses the file (missing/invalid → `{}`), then layers env fallbacks (`fmpKey` ← `process.env.FMP_API_KEY`), and a default `cascadeOrder`. `writeSettings(patch, {_path})` filters `patch` to `ALLOWED_KEYS`, merges over existing file content, writes pretty JSON, returns merged. `publicView(s)` returns `{ apiBaseUrl: s.apiBaseUrl||'', apiModel: s.apiModel||'', apiWebSearch: !!s.apiWebSearch, cascadeOrder: s.cascadeOrder||DEFAULT_ORDER, configured: { api: !!s.apiKey, fmp: !!getFmpKey(s) } }` — **no key values**. `getFmpKey(s)` = `s.fmpKey || process.env.FMP_API_KEY`.

- [ ] **Step 4: Run to verify it passes** — `node --test tests/settings.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add settings.js tests/settings.test.js && git commit -m "feat: settings.js server-side secret store (secret-free public view)"`

---

### Task 8: `ai-research.js` — full cascade orchestrator

**Files:**
- Modify: `ai-research.js` (replace the interim delegate from Task 3)
- Test: Create `tests/orchestrator.test.js`

**Interfaces:**
- Consumes: all provider modules, `settings.readSettings`.
- Produces: `runResearch(symbol, context, onText, opts)->Promise<{text,durationMs,provider}>`, `listProviders(settings)->[{id,label,available,webCapable}]`. Re-exports `buildPrompt`, `parseStreamJsonLine`, `MAX_CONCURRENT`.
- Cascade rules: capacity-failure codes that fall through = `['rate_limited','not_authenticated','cli_missing','busy','spawn_error']`. Any other code stops the cascade and rejects. Empty/all-exhausted → reject `typedError(summary, 'all_providers_exhausted')`.

- [ ] **Step 1: Write the failing test** (inject fake providers via `opts._providers` to keep it hermetic; cover fall-through, stop-on-success, override, exhausted, web-filter, and the `_spawn` back-compat path):

```javascript
const { test } = require('node:test'); const assert = require('node:assert');
const { runResearch } = require('../ai-research');
const ok = (id) => ({ id, label:id, webCapable:true, isAvailable: async()=>true, run: async()=>({text:`from-${id}`, durationMs:1}) });
const cap = (id, code) => ({ id, label:id, webCapable:true, isAvailable: async()=>true, run: async()=>{ throw Object.assign(new Error(code), {code}); } });

test('cascade falls through capacity failure to next provider', async () => {
  const res = await runResearch('NVDA', {}, ()=>{}, { _providers: [cap('claude','rate_limited'), ok('api')], _order:['claude','api'] });
  assert.strictEqual(res.text, 'from-api'); assert.strictEqual(res.provider, 'api');
});
test('cascade stops at first success', async () => {
  const res = await runResearch('NVDA', {}, ()=>{}, { _providers:[ok('claude'), ok('api')], _order:['claude','api'] });
  assert.strictEqual(res.provider, 'claude');
});
test('explicit provider override bypasses the rest', async () => {
  const res = await runResearch('NVDA', {}, ()=>{}, { provider:'api', _providers:[ok('claude'), ok('api')], _order:['claude','api'] });
  assert.strictEqual(res.provider, 'api');
});
test('non-web-capable providers are excluded from the cascade', async () => {
  const noweb = { ...ok('codex'), webCapable:false };
  const res = await runResearch('NVDA', {}, ()=>{}, { _providers:[noweb, ok('api')], _order:['codex','api'] });
  assert.strictEqual(res.provider, 'api');
});
test('all capacity failures -> all_providers_exhausted', async () => {
  await assert.rejects(runResearch('NVDA', {}, ()=>{}, { _providers:[cap('claude','rate_limited'), cap('api','not_authenticated')], _order:['claude','api'] }),
    e => e.code === 'all_providers_exhausted');
});
test('a content error stops the cascade (no fall-through)', async () => {
  await assert.rejects(runResearch('NVDA', {}, ()=>{}, { _providers:[cap('claude','exit_2'), ok('api')], _order:['claude','api'] }),
    e => e.code === 'exit_2');
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/orchestrator.test.js` → FAIL.

- [ ] **Step 3: Implement the orchestrator.** Keep the Task-3 `_spawn` back-compat: if `opts._spawn` is set, route directly to `claude.run(symbol, context, onText, opts)` (no cascade) and return `{...result, provider:'claude'}`. Otherwise: resolve `providers` (default registry `{claude,codex,agy,api}`, override via `opts._providers` array), resolve `order` (`opts._order` || settings.cascadeOrder || DEFAULT), build the list (single `[provider]` if `opts.provider`), filter to `webCapable(settings) && await isAvailable(settings)`, then iterate: `await p.run(...)` → resolve `{...res, provider:p.id}`; on throw, if code ∈ CAPACITY set record + continue, else rethrow. After the loop reject `all_providers_exhausted` with a per-provider reason summary. Wrap the whole thing in the `MAX_CONCURRENT` in-flight guard (reject `busy` when exceeded). `webCapable` may be a function or boolean — normalize: `typeof p.webCapable==='function' ? p.webCapable(settings) : p.webCapable`.

```javascript
// ai-research.js — multi-provider research orchestrator.
const { buildPrompt } = require('./providers/base');
const claude = require('./providers/claude');
const codex = require('./providers/codex');
const agy = require('./providers/agy');
const api = require('./providers/api');
const settingsMod = require('./settings');

const MAX_CONCURRENT = 2;
const DEFAULT_ORDER = ['claude', 'codex', 'agy', 'api'];
const CAPACITY = new Set(['rate_limited', 'not_authenticated', 'cli_missing', 'busy', 'spawn_error', 'no_output']);
const REGISTRY = { claude, codex, agy, api };
let _inflight = 0;
const webOf = (p, s) => (typeof p.webCapable === 'function' ? p.webCapable(s) : p.webCapable);

async function listProviders(settings) {
  const s = settings || settingsMod.readSettings();
  return Promise.all(Object.values(REGISTRY).map(async p => ({
    id: p.id, label: p.label, webCapable: !!webOf(p, s),
    available: await p.isAvailable(s).catch(() => false),
  })));
}

async function runResearch(symbol, context, onText, opts = {}) {
  if (opts._spawn) { const r = await claude.run(symbol, context, onText, opts); return { ...r, provider: 'claude' }; }
  if (_inflight >= MAX_CONCURRENT) throw Object.assign(new Error('Too many concurrent research runs'), { code: 'busy' });
  _inflight++;
  try {
    const s = opts.settings || settingsMod.readSettings();
    const reg = opts._providers ? Object.fromEntries(opts._providers.map(p => [p.id, p])) : REGISTRY;
    const order = opts.provider ? [opts.provider] : (opts._order || s.cascadeOrder || DEFAULT_ORDER);
    const tried = [];
    for (const id of order) {
      const p = reg[id]; if (!p) continue;
      if (!webOf(p, s)) { tried.push(`${id}: not web-capable`); continue; }
      if (!(await p.isAvailable(s).catch(() => false))) { tried.push(`${id}: unavailable`); continue; }
      try { const r = await p.run(symbol, context, onText, { ...opts, settings: s }); return { ...r, provider: id }; }
      catch (e) {
        if (CAPACITY.has(e.code)) { tried.push(`${id}: ${e.code}`); continue; }
        throw e;   // genuine content error stops the cascade
      }
    }
    throw Object.assign(new Error(`No provider could run research. ${tried.join('; ') || 'none configured'}`), { code: 'all_providers_exhausted' });
  } finally { _inflight--; }
}

module.exports = { runResearch, listProviders, buildPrompt, parseStreamJsonLine: claude.parseStreamJsonLine, MAX_CONCURRENT };
```

- [ ] **Step 4: Run to verify** — `npm test` (full suite incl. existing claude `_spawn`/ENOENT/hijack tests + new orchestrator tests) → all PASS.

- [ ] **Step 5: Commit** — `git add ai-research.js tests/orchestrator.test.js && git commit -m "feat: provider cascade orchestrator in ai-research.js"`

---

### Task 9: `server.js` — `/settings` GET/POST, `&provider=` override, cache v2, FMP via store

**Files:**
- Modify: `server.js` (add routes; extend `friendlyError`; bump cache key; route FMP key through `settings`)
- Modify: `fundamentals-fallback.js` (accept an injected key so the store can supply it; keep env default)
- Test: extend `tests/server.test.js`

**Interfaces:**
- Consumes: `settings.readSettings/writeSettings/publicView`, `ai-research.listProviders`.
- Produces: `GET /settings` → `publicView` + `providers` array. `POST /settings` (JSON body, `readBody`) → validate, `writeSettings`, return updated `publicView`. `/ai-research` accepts `&provider=` (validate against known ids; else 400).

- [ ] **Step 1: Write the failing server tests** (server already spawns with `AI_RESEARCH_FAKE=1`):

```javascript
test('GET /settings returns provider list and configured booleans, never a key', async () => {
  const r = await get('/settings');
  assert.strictEqual(r.status, 200);
  const b = JSON.parse(r.body);
  assert.ok(Array.isArray(b.providers));
  assert.ok(b.configured && typeof b.configured.api === 'boolean');
  assert.ok(!r.body.includes('sk-'), 'must never echo a key');
});
test('POST /settings accepts config and GET reflects configured=true without leaking the key', async () => {
  const body = JSON.stringify({ apiKey: 'sk-TESTKEY-123', apiBaseUrl: 'https://openrouter.ai/api/v1', apiModel: 'openai/gpt-4o:online' });
  const post = await postJson('/settings', body);   // helper added in this task
  assert.strictEqual(post.status, 200);
  assert.ok(!post.body.includes('sk-TESTKEY-123'), 'POST response must not echo the key');
  const g = await get('/settings');
  assert.ok(!g.body.includes('sk-TESTKEY-123'));
  assert.strictEqual(JSON.parse(g.body).configured.api, true);
});
test('/ai-research rejects an unknown provider with 400', async () => {
  const res = await fetch(`${BASE}/ai-research?symbol=NVDA&provider=bogus`);
  assert.strictEqual(res.status, 400);
});
```
Add a `postJson(p, body)` helper near `get(...)`. **Test isolation:** point the server's secret store at a temp file by adding `SECRETS_PATH` env support in `settings.js` (`process.env.SECRETS_PATH || default`) and pass `SECRETS_PATH` in the test `before()` spawn env so the suite never writes the real `.secrets.json`; delete it in `after()`.

- [ ] **Step 2: Run to verify it fails** — `npm test` → new server tests FAIL (routes missing).

- [ ] **Step 3: Implement** in `server.js`:
  - Add `const settings = require('./settings');` near the other requires.
  - `GET /settings`: `const s = settings.readSettings(); const view = settings.publicView(s); view.providers = await require('./ai-research').listProviders(s); res.end(JSON.stringify(view));`
  - `POST /settings`: read body via `readBody`, `JSON.parse`, call `settings.writeSettings(parsed)`, respond with the fresh `publicView` (+ providers). Validate `cascadeOrder` (array of known ids) and `apiBaseUrl` (must be `https?:`); 400 on bad input.
  - `/ai-research`: read `provider = url.searchParams.get('provider')`; if present and not in the known set (`['claude','codex','agy','api']`) → 400 before streaming. Pass `{ model, provider }` into `runResearch`.
  - Cache key: `const sel = provider || 'auto'; const cacheKey = \`airesearch-v2-${sel}-${symbol}\`;` (replaces v1).
  - Extend `friendlyError` with `all_providers_exhausted` → its `err.message` (already actionable), `not_web_capable` shouldn't surface, and a default fallback.
  - In `/yf-fundamentals`, source the FMP key from the store: have `fundamentals-fallback.isConfigured()`/`getFromProvider()` accept an injected key, and pass `settings.getFmpKey(settings.readSettings())`. Keep `process.env.FMP_API_KEY` as the default inside the module so existing behavior/tests hold.
  - Update `SECRETS_PATH` support in `settings.js` (env override) — done in Step 1's isolation note.

- [ ] **Step 4: Run to verify** — `npm test` → all PASS (including the never-echo-a-key assertions and the existing `/yf-status fallbackConfigured:false`).

- [ ] **Step 5: Commit** — `git add server.js settings.js fundamentals-fallback.js tests/server.test.js && git commit -m "feat: /settings endpoints, provider override, cache v2, FMP via secret store"`

---

### Task 10: Browser — "AI Providers" Settings card + provider override on the panel

**Files:**
- Create: `js/settings.js` (provider settings load/save against `/settings`)
- Modify: `index.html` (new Settings card; add `<script src="js/settings.js">` before `js/main.js`; add a provider `<select>` to the AI Research panel)
- Modify: `js/main.js` (call `loadProviderSettings()` in init)
- Modify: `js/ai-research.js` (include `&provider=` from the override select when set)
- Test: extend `tests/browser.e2e.js`

**Interfaces:**
- Consumes: `GET/POST /settings`. `localServer || window.location.origin` for the base.
- Produces: `loadProviderSettings()`, `saveProviderSettings()`, global `aiProviderOverride()` returning the selected provider id or ''.

- [ ] **Step 1: Write the failing e2e test** (seed nothing; assert the card renders and `GET /settings` populates the provider list + the AI panel has a provider select):

```javascript
test('Settings shows AI Providers card and provider override populated from /settings', async () => {
  // navigate to settings page, assert #aiProvidersCard exists and #aiProviderSelect has options
  await page.click('[data-page="settings"]');
  assert.ok(await page.$('#aiProvidersCard'));
  const opts = await page.$$eval('#aiProviderSelect option', els => els.map(e => e.value));
  assert.ok(opts.includes('') && opts.includes('claude'), 'auto + claude options present');
});
```
(Adapt selectors to the app's existing nav pattern; reuse the e2e harness's page-launch + sql.js whitelist.)

- [ ] **Step 2: Run to verify it fails** — `npm run test:e2e` → FAIL (card/select absent).

- [ ] **Step 3: Implement.**
  - `index.html` Settings page: add a `<div class="card" id="aiProvidersCard">` (after the Perplexity card) with: API key `<input type="password" id="apiKeyInput">` (write-only; show "configured ✓" from `configured.api`, never the value), `apiBaseUrl` + `apiModel` inputs, an FMP key input, a per-provider status list `<ul id="providerStatus">`, and a Save button → `saveProviderSettings()`. Add a provider override `<select id="aiProviderSelect">` to the `#aiResearchPanel` header with `<option value="">Auto (cascade)</option>` plus one per provider.
  - `js/settings.js`: `loadProviderSettings()` GETs `/settings`, renders `providerStatus` (available/web-capable badges), fills base URL/model inputs, sets "configured ✓" placeholders, and populates `#aiProviderSelect`. `saveProviderSettings()` POSTs the inputs to `/settings` (only sends a key field if non-empty so a blank doesn't wipe it), shows a status message, and reloads the view. `aiProviderOverride()` returns `document.getElementById('aiProviderSelect')?.value || ''`. Never reads a key back from the server.
  - `js/main.js`: in the DOMContentLoaded init, call `loadProviderSettings()` (guard if the element exists).
  - `js/ai-research.js`: in `startAiResearch`, `const prov = (typeof aiProviderOverride==='function') ? aiProviderOverride() : ''; if (prov) params.set('provider', prov);`.
  - Add `<script src="js/settings.js"></script>` immediately before `<script src="js/main.js"></script>`.

- [ ] **Step 4: Run to verify** — `npm run test:e2e` → PASS; `npm test` still green.

- [ ] **Step 5: Commit** — `git add js/settings.js js/main.js js/ai-research.js index.html tests/browser.e2e.js && git commit -m "feat: AI Providers settings card + per-run provider override"`

---

### Task 11: Docs + final verification gate

**Files:**
- Modify: `ARYA.md` (changelog entry — new version, e.g. v1.7.0), `TASK_QUEUE.md`, `CHECKPOINT_LAST.md`, `RESUME_ULTRACODE.md` (mark Part 2 done; Part 3 next).
- Create/Modify: a short "AI Providers" section in `ARYA.md` documenting `.secrets.json`, `/settings`, the cascade, and that keys are server-side only.

- [ ] **Step 1: Update `ARYA.md`** changelog + an "AI Providers" doc section (cascade order, web-capable-only rule, `.secrets.json` gitignored, `FMP_API_KEY` env still honored, `?provider=` override).
- [ ] **Step 2: Update `TASK_QUEUE.md`** (move Part 2 to Done), `CHECKPOINT_LAST.md` (state + next action = Part 3), `RESUME_ULTRACODE.md` (Part 2 ✅, Part 3 next; record codex/agy webCapable verdicts).
- [ ] **Step 3: Full gate** — `npm test` (all green) and `npm run test:e2e` (all green). Record counts.
- [ ] **Step 4: Manual live smoke** (optional, costs quota): one real `/ai-research?symbol=NVDA` auto-cascade run; if claude is rate-limited, confirm fall-through to a configured `api` provider streams a cited report. Screenshot the AI Providers card.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "docs: Part 2 providers — changelog, task queue, resume handoff"`

---

## Self-Review

**Spec coverage:** provider-module architecture (T2–T6) ✓; claude/codex/agy/api providers (T3–T6) ✓; settings store + `/settings` (T7, T9) ✓; secret-free `GET` with explicit never-leak test (T7, T9) ✓; cascade + override + exhausted (T8) ✓; web-capable-only filter (T8, probe T1) ✓; cache v2 (T9) ✓; FMP folded into store (T9) ✓; browser card + override (T10) ✓; `&provider=` validation (T9) ✓; backward-compat exports + `_spawn` route (T3, T8) ✓; docs (T11) ✓.

**Placeholder scan:** codex/agy parser bodies are intentionally grounded in the Task-1 fixture (their exact event shape can't be invented before the probe) — this is a real dependency, not a placeholder; every other task has concrete code/tests.

**Type consistency:** provider interface `{id,label,webCapable,isAvailable,run}` is identical across base/claude/codex/agy/api and consumed unchanged by the orchestrator; `webCapable` normalized (bool|fn) in T8; `runResearch` returns `{text,durationMs,provider}` everywhere; capacity-failure code set is defined once in T8 and referenced by all providers' error mapping.

## Execution note

Tasks 1, 4, 5, 6, 7 create disjoint new files and can be authored in parallel once Task 2 (base interface) is committed; Tasks 3, 8, 9, 10 touch shared files (`ai-research.js`, `server.js`, `index.html`) and are sequential. A final adversarial review pass (secret-leak, cascade-correctness, backward-compat, spec-coverage) should run after Task 10.
