# AI Research Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand "AI Research" panel that runs the local `claude` CLI with web search and streams a full US-stock research report into the browser.

**Architecture:** A pure server-side module (`ai-research.js`) spawns `claude -p` in an isolated environment, parses its stream-json output, and emits text deltas via a callback. A thin `server.js` SSE endpoint adapts that callback to the browser over Server-Sent Events. A small browser module opens an `EventSource` and renders streamed markdown into a panel. The module is HTTP/Telegram-agnostic so the future Telegram bot reuses `runResearch` directly.

**Tech Stack:** Node.js (no new deps — built-in `child_process`, `http`, `os`), vanilla browser JS (classic ordered scripts), existing `cache.js`, `node:test` + Playwright for tests.

## Global Constraints

- No new runtime dependencies (project pins only `nodemailer`, `playwright-core`).
- No em dashes in user-facing copy or comments (project rule).
- Comments explain why, not what.
- Server runs on port 3000 by default; tests set an explicit `PORT` and must not open browser tabs.
- `claude -p` must run isolated: `cwd: os.tmpdir()`, `--strict-mcp-config --mcp-config '{"mcpServers":{}}'`, `--exclude-dynamic-system-prompt-sections`, default model `sonnet`.
- Spawn with an args array only — never a shell string. Validate `symbol` against `^[A-Z.]{1,8}$`.
- `npm test` stays fully offline: no task may call the real `claude` CLI in unit/server tests (inject/stub the spawner).
- Per-run timeout 240s; max 2 concurrent research runs.

## File Structure

- `ai-research.js` (NEW) — pure engine: `buildPrompt`, `parseStreamJsonLine`, `runResearch`. No HTTP.
- `server.js` (MODIFY) — add `GET /ai-research` SSE route; reuse `cache.js`.
- `js/ai-research.js` (NEW) — browser: button handler, `EventSource` client, markdown render into panel.
- `index.html` (MODIFY) — AI Research button + panel container; load `js/ai-research.js`.
- `styles.css` (MODIFY) — panel styling.
- `tests/unit.test.js` (MODIFY) — unit tests for `buildPrompt` + `parseStreamJsonLine` + `runResearch` (stubbed spawn).
- `tests/server.test.js` (MODIFY) — `/ai-research` validation + SSE headers (stubbed engine).
- `tests/fixtures/claude-stream.jsonl` (NEW) — captured stream-json sample for parser tests.

---

### Task 1: Capture a stream-json fixture + parser

**Files:**
- Create: `tests/fixtures/claude-stream.jsonl`
- Create: `ai-research.js`
- Test: `tests/unit.test.js` (append)

**Interfaces:**
- Produces: `parseStreamJsonLine(line: string) -> { kind, text } | null` where `kind` is one of `'delta' | 'final' | 'rate_limited' | 'error'`; `text` is the delta text (kind `delta`) or full result text (kind `final`) or a message (kind `rate_limited`/`error`). Returns `null` for ignored event types or unparseable lines.
- Exports from `ai-research.js`: `module.exports = { parseStreamJsonLine }` (more added later).

- [ ] **Step 1: Create the fixture file** (a minimal but representative captured sequence)

`tests/fixtures/claude-stream.jsonl`:
```
{"type":"system","subtype":"init","session_id":"x"}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}}
{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1781934600}}
{"type":"result","subtype":"success","is_error":false,"result":"Hello world.","duration_ms":2174}
```

- [ ] **Step 2: Write the failing test**

Append to `tests/unit.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/unit.test.js`
Expected: FAIL — `Cannot find module '../ai-research'`.

- [ ] **Step 4: Implement `parseStreamJsonLine` in `ai-research.js`**

```js
// ai-research.js — pure engine for on-demand stock research via the local `claude` CLI.
// No HTTP/Telegram knowledge: callers adapt runResearch's onText callback to their transport.

// Parse one line of `claude -p --output-format stream-json` output into a normalized event.
// Returns null for event types we ignore (system/hook/assistant/message lifecycle) or junk.
function parseStreamJsonLine(line) {
  let ev;
  try { ev = JSON.parse(line); } catch (_) { return null; }
  if (!ev || typeof ev !== 'object') return null;

  if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta'
      && ev.event.delta?.type === 'text_delta') {
    return { kind: 'delta', text: ev.event.delta.text || '' };
  }
  if (ev.type === 'rate_limit_event') {
    const info = ev.rate_limit_info || {};
    if (info.status && info.status !== 'allowed') {
      return { kind: 'rate_limited', text: rateLimitMessage(info) };
    }
    return null;
  }
  if (ev.type === 'result') {
    if (ev.is_error) return { kind: 'error', text: ev.subtype || 'result_error' };
    return { kind: 'final', text: typeof ev.result === 'string' ? ev.result : '' };
  }
  return null;
}

function rateLimitMessage(info) {
  const when = info.resetsAt ? new Date(info.resetsAt * 1000).toLocaleTimeString() : 'later';
  return `Claude usage limit reached (resets at ${when}).`;
}

module.exports = { parseStreamJsonLine };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/unit.test.js`
Expected: PASS (all existing + 2 new tests).

- [ ] **Step 6: Commit**

```bash
git add ai-research.js tests/unit.test.js tests/fixtures/claude-stream.jsonl
git commit -m "feat(ai-research): stream-json line parser + fixture"
```

---

### Task 2: Prompt builder

**Files:**
- Modify: `ai-research.js`
- Test: `tests/unit.test.js` (append)

**Interfaces:**
- Produces: `buildPrompt(symbol: string, context?: object) -> string`. `context` may carry `{ currentPrice, dayChangePct, pe, marketCap, sector, name }` (all optional). Added to `module.exports`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit.test.js`
Expected: FAIL — `buildPrompt is not a function`.

- [ ] **Step 3: Implement `buildPrompt`**

Add to `ai-research.js` (and export it):
```js
function buildPrompt(symbol, context = {}) {
  const facts = [];
  if (context.name) facts.push(`Name: ${context.name}`);
  if (context.currentPrice != null) facts.push(`Current price: ${context.currentPrice}`);
  if (context.dayChangePct != null) facts.push(`Day change: ${context.dayChangePct}%`);
  if (context.pe != null) facts.push(`P/E: ${context.pe}`);
  if (context.marketCap != null) facts.push(`Market cap: ${context.marketCap}`);
  if (context.sector) facts.push(`Sector: ${context.sector}`);
  const grounding = facts.length
    ? `\nKnown data for grounding (verify if stale):\n${facts.join('\n')}\n` : '\n';

  // Why: a single self-contained instruction; print mode has no separate system channel
  // we rely on here, so role + format + sourcing rules all live in the prompt.
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
```
Update exports: `module.exports = { parseStreamJsonLine, buildPrompt };`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ai-research.js tests/unit.test.js
git commit -m "feat(ai-research): US-market research prompt builder"
```

---

### Task 3: runResearch (spawn + stream, injectable spawner)

**Files:**
- Modify: `ai-research.js`
- Test: `tests/unit.test.js` (append)

**Interfaces:**
- Produces: `runResearch(symbol, context, onText, opts?) -> Promise<{ text, durationMs }>`.
  - `onText(deltaString)` called per text delta.
  - `opts` (all optional): `{ model='sonnet', timeoutMs=240000, _spawn=child_process.spawn }`. `_spawn` is the seam for tests (inject a fake), so unit tests never touch the real CLI.
  - Rejects with `Error` whose `.code` is one of `'cli_missing' | 'not_authenticated' | 'timeout' | 'rate_limited' | 'exit_<n>' | 'no_output'`.
- Also exports `MAX_CONCURRENT = 2` and an internal in-flight counter guard that rejects with code `'busy'` when exceeded.

- [ ] **Step 1: Write the failing test** (fake spawn emits the fixture, no real CLI)

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit.test.js`
Expected: FAIL — `runResearch is not a function`.

- [ ] **Step 3: Implement `runResearch`**

Add to `ai-research.js`:
```js
const os = require('os');
const childProcess = require('child_process');

const MAX_CONCURRENT = 2;
let _inflight = 0;

function cleanEnv() {
  // Strip injected CLAUDE*/ANTHROPIC* context vars so research runs in a neutral context;
  // keep PATH/HOME so the CLI and its auth resolve normally.
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDE|ANTHROPIC)/.test(k)) continue;
    out[k] = v;
  }
  return out;
}

function runResearch(symbol, context, onText, opts = {}) {
  const { model = 'sonnet', timeoutMs = 240000, _spawn = childProcess.spawn } = opts;
  if (_inflight >= MAX_CONCURRENT) {
    return Promise.reject(Object.assign(new Error('Too many concurrent research runs'), { code: 'busy' }));
  }
  _inflight++;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const args = ['-p', buildPrompt(symbol, context),
      '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
      '--model', model,
      '--allowedTools', 'WebSearch', 'WebFetch',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--exclude-dynamic-system-prompt-sections'];
    const proc = _spawn('claude', args, { cwd: os.tmpdir(), env: cleanEnv() });

    let finalText = '';
    const acc = [];
    let settled = false;
    let stderrBuf = '';
    const finish = (fn) => { if (settled) return; settled = true; _inflight--; clearTimeout(timer); fn(); };

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 2000).unref?.();
      finish(() => reject(Object.assign(new Error('Research timed out'), { code: 'timeout' })));
    }, timeoutMs);

    let buf = '';
    proc.stdout.on('data', chunk => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const p = parseStreamJsonLine(line);
        if (!p) continue;
        if (p.kind === 'delta') { acc.push(p.text); onText(p.text); }
        else if (p.kind === 'final') { finalText = p.text; }
        else if (p.kind === 'rate_limited') {
          try { proc.kill('SIGTERM'); } catch (_) {}
          finish(() => reject(Object.assign(new Error(p.text), { code: 'rate_limited' })));
        } else if (p.kind === 'error') {
          try { proc.kill('SIGTERM'); } catch (_) {}
          finish(() => reject(Object.assign(new Error(`AI research failed (${p.text})`), { code: 'exit_error' })));
        }
      }
    });
    proc.stderr.on('data', d => { stderrBuf += d.toString(); });

    proc.on('error', err => {
      const code = err.code === 'ENOENT' ? 'cli_missing' : 'spawn_error';
      finish(() => reject(Object.assign(new Error(err.message), { code })));
    });

    proc.on('close', codeNum => {
      const text = finalText || acc.join('');
      if (codeNum === 0 && text) {
        finish(() => resolve({ text, durationMs: Date.now() - started }));
      } else if (codeNum === 0 && !text) {
        finish(() => reject(Object.assign(new Error('No output from CLI'), { code: 'no_output' })));
      } else {
        // A login problem usually surfaces here; surface stderr hint in the log.
        const code = /not.*logg|auth|login/i.test(stderrBuf) ? 'not_authenticated' : `exit_${codeNum}`;
        finish(() => reject(Object.assign(new Error(stderrBuf.slice(0, 300) || `claude exited ${codeNum}`), { code })));
      }
    });
  });
}

module.exports = { parseStreamJsonLine, buildPrompt, runResearch, MAX_CONCURRENT };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ai-research.js tests/unit.test.js
git commit -m "feat(ai-research): runResearch spawns isolated claude -p and streams deltas"
```

---

### Task 4: `/ai-research` SSE endpoint in server.js

**Files:**
- Modify: `server.js` (add route before the static-file handler at `server.js:259`)
- Test: `tests/server.test.js` (append)

**Interfaces:**
- Consumes: `ai-research.js` `runResearch`; `cache.js` (confirmed API: `const cache = require('./cache')`, `cache.read(key, ttlMs) -> {data, ts, fresh}|null`, `cache.write(key, data)`). Add the require at the top of `server.js` (it is currently required locally inside the `/yf-fundamentals` handler at line 171; promote to a top-level require or add one in this route).
- Produces: HTTP `GET /ai-research?symbol=SYMBOL[&fresh=1][&model=...]` returning `text/event-stream` with events: repeated `data: {"delta":"..."}`, optional `data: {"cached":true}` first when served from cache, and a terminal `event: done\ndata: {...}` or `event: error\ndata: {"code":"...","message":"..."}`.
- Honors an injectable engine via `server.js` reading from a module-level `_engine = require('./ai-research')` so tests can monkeypatch (set `process.env.AI_RESEARCH_FAKE=1` to route to a built-in stub). Keep the stub tiny and offline.

- [ ] **Step 1: Write the failing test**

Append to `tests/server.test.js` (mirror existing server-spawn harness in that file; set `AI_RESEARCH_FAKE=1` in the spawned server env):
```js
test('/ai-research rejects an invalid symbol with 400', async () => {
  const res = await fetch(`${BASE}/ai-research?symbol=@@bad`);
  assert.strictEqual(res.status, 400);
});

test('/ai-research streams SSE and ends with done (fake engine)', async () => {
  const res = await fetch(`${BASE}/ai-research?symbol=NVDA`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
  const body = await res.text();
  assert.match(body, /event: done/);
});
```
Note: in this file's `before()` server spawn, add `AI_RESEARCH_FAKE: '1'` to the child env.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/server.test.js`
Expected: FAIL — 404/no SSE (route missing).

- [ ] **Step 3: Implement the route**

In `server.js`, near the other route checks (before `let filePath = ...` at line 259), add:
```js
if (url.pathname === '/ai-research') {
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
  if (!/^[A-Z.]{1,8}$/.test(symbol)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid symbol' }));
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const send = (obj, event) => {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  const fresh = url.searchParams.get('fresh') === '1';
  const model = url.searchParams.get('model') || 'sonnet';
  const cacheKey = `airesearch-v1-${symbol}`;

  // Offline test seam: deterministic SSE without touching the real CLI.
  if (process.env.AI_RESEARCH_FAKE === '1') {
    send({ delta: 'Fake research for ' + symbol });
    send({ cached: false, durationMs: 1 }, 'done');
    res.end();
    return;
  }

  if (!fresh) {
    const hit = cache.read(cacheKey, 60 * 60 * 1000); // {data, ts, fresh} | null
    if (hit && hit.fresh && hit.data) {
      send({ cached: true });
      send({ delta: hit.data });
      send({ cached: true, durationMs: 0 }, 'done');
      res.end();
      return;
    }
  }

  const { runResearch } = require('./ai-research');
  runResearch(symbol, {}, delta => send({ delta }), { model })
    .then(({ text, durationMs }) => {
      cache.write(cacheKey, text);
      send({ cached: false, durationMs }, 'done');
      res.end();
    })
    .catch(err => {
      console.error('ai-research error:', err.code, err.message);
      send({ code: err.code || 'error', message: friendlyError(err) }, 'error');
      res.end();
    });
  return;
}
```
Add a `friendlyError(err)` helper near the top of `server.js`:
```js
function friendlyError(err) {
  switch (err.code) {
    case 'cli_missing': return 'Claude CLI not found on the server host.';
    case 'not_authenticated': return 'Claude CLI not logged in — run `claude` once to authenticate.';
    case 'timeout': return 'Research timed out after 240s. Try again or narrow the request.';
    case 'rate_limited': return err.message;
    case 'busy': return 'Another research run is in progress. Try again shortly.';
    default: return 'AI research failed. See server log for details.';
  }
}
```
While implementing: open `cache.js`, confirm the real exported function names and signatures, and replace `cacheGet`/`cacheSet` + the TTL argument shape to match. Require them at the top of `server.js` alongside existing requires.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/server.test.js`
Expected: PASS.

- [ ] **Step 5: Run full offline suite (no regressions)**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add server.js tests/server.test.js
git commit -m "feat(server): /ai-research SSE endpoint with cache + fake test seam"
```

---

### Task 5: Browser panel + EventSource client

**Files:**
- Create: `js/ai-research.js`
- Modify: `index.html` (add button + panel container; add `<script src="js/ai-research.js">` in the existing ordered list, before `js/main.js`)
- Modify: `styles.css` (panel styles)
- Test: `tests/browser.e2e.js` (append a wiring assertion)

**Interfaces:**
- Consumes: global `state` (for current symbol + `state._extraData`/price context), existing markdown rendering if present (else a minimal renderer), `localServer || window.location.origin`.
- Produces: globals `startAiResearch(force?)` and `renderAiMarkdown(md)`; a button `#aiResearchBtn` and panel `#aiResearchPanel` in the DOM.

- [ ] **Step 1: Write the failing wiring test**

Append to `tests/browser.e2e.js` (this suite already loads the page and checks globals/DOM):
```js
test('AI research panel is wired (button, panel, handler)', async () => {
  // page already loaded by this suite's harness; reuse its `page` handle.
  const ok = await page.evaluate(() =>
    !!document.getElementById('aiResearchBtn') &&
    !!document.getElementById('aiResearchPanel') &&
    typeof window.startAiResearch === 'function');
  assert.strictEqual(ok, true);
});
```
(Match the variable names/harness this file already uses for the loaded page.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/browser.e2e.js`
Expected: FAIL — elements/handler missing.

- [ ] **Step 3: Add DOM in `index.html`**

Near the stock header/action area (same row as Analyze/Full Report), add:
```html
<button id="aiResearchBtn" class="btn btn-ai" onclick="startAiResearch()" disabled>
  AI Research
</button>
```
After the dashboard content area, add the panel container:
```html
<section id="aiResearchPanel" class="ai-panel" hidden>
  <div class="ai-panel-head">
    <h2>AI Research</h2>
    <span id="aiResearchMeta" class="ai-meta"></span>
    <button id="aiResearchRerun" class="btn btn-sm" onclick="startAiResearch(true)" hidden>Re-run</button>
  </div>
  <div id="aiResearchBody" class="ai-panel-body"></div>
</section>
```
And in the ordered script list, before `js/main.js`:
```html
<script src="js/ai-research.js"></script>
```

- [ ] **Step 4: Implement `js/ai-research.js`**

```js
// ai-research.js (browser) — on-demand AI research panel.
// Opens an SSE stream to /ai-research and renders streamed markdown for the current stock.
let _aiSource = null;

function aiResearchContext() {
  const d = (typeof extractAnalysisData === 'function' && state.stockData)
    ? extractAnalysisData(state.stockData) : {};
  return { symbol: state.stockSymbol, name: d.name, currentPrice: d.currentPrice,
    pe: d.pe, sector: d.sector, marketCap: d.marketCap };
}

function startAiResearch(force) {
  const symbol = (state.stockSymbol || '').toUpperCase().replace(/\.(NS|BO)$/, '');
  if (!symbol) return;
  if (_aiSource) { _aiSource.close(); _aiSource = null; }

  const panel = document.getElementById('aiResearchPanel');
  const body = document.getElementById('aiResearchBody');
  const meta = document.getElementById('aiResearchMeta');
  const rerun = document.getElementById('aiResearchRerun');
  panel.hidden = false; rerun.hidden = true;
  body.innerHTML = ''; meta.textContent = 'Researching…';
  const t0 = Date.now();
  let raw = '';

  const proxy = localServer || window.location.origin;
  const qs = `symbol=${encodeURIComponent(symbol)}${force ? '&fresh=1' : ''}`;
  const es = new EventSource(`${proxy}/ai-research?${qs}`);
  _aiSource = es;

  es.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.cached) meta.textContent = 'Cached';
      if (typeof msg.delta === 'string') { raw += msg.delta; body.innerHTML = renderAiMarkdown(raw); }
    } catch (_) {}
  };
  es.addEventListener('done', (e) => {
    es.close(); _aiSource = null;
    let info = {}; try { info = JSON.parse(e.data); } catch (_) {}
    meta.textContent = info.cached ? 'Cached' : `Done in ${Math.round((Date.now() - t0) / 1000)}s`;
    rerun.hidden = false;
  });
  es.addEventListener('error', (e) => {
    es.close(); _aiSource = null;
    let info = {}; try { info = JSON.parse(e.data); } catch (_) {}
    meta.textContent = 'Error';
    body.innerHTML = `<p class="ai-error">⚠️ ${info.message || 'AI research failed.'}</p>`;
    rerun.hidden = false;
  });
}

// Minimal, safe-ish markdown: escape HTML, then a few block/inline rules. Good enough for
// streamed reports; can be swapped for a full renderer later.
function renderAiMarkdown(md) {
  const esc = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/^### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^## (.*)$/gm, '<h3>$1</h3>')
    .replace(/^# (.*)$/gm, '<h2>$1</h2>')
    .replace(/^\d+\.\s+(.*)$/gm, '<li>$1</li>')
    .replace(/^[-*]\s+(.*)$/gm, '<li>$1</li>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\n{2,}/g, '<br><br>');
}
```

- [ ] **Step 5: Enable the button when a stock loads**

In `js/data.js`, in `searchStock`'s success path (after `renderDashboard()` near line 150), add:
```js
const aiBtn = document.getElementById('aiResearchBtn');
if (aiBtn) aiBtn.disabled = false;
```

- [ ] **Step 6: Add panel styles to `styles.css`**

```css
.ai-panel { margin-top: 1.5rem; border: 1px solid var(--border, #e5e0d8); border-radius: 12px; padding: 1.25rem; background: var(--card, #fff); }
.ai-panel-head { display: flex; align-items: center; gap: .75rem; }
.ai-panel-head h2 { margin: 0; font-size: 1.1rem; }
.ai-meta { color: var(--muted, #888); font-size: .85rem; }
.ai-panel-body { margin-top: .75rem; line-height: 1.55; }
.ai-panel-body h2, .ai-panel-body h3, .ai-panel-body h4 { margin: 1rem 0 .35rem; }
.ai-error { color: #b00020; }
.btn-ai { background: #5b4bd6; color: #fff; }
```

- [ ] **Step 7: Run the wiring test**

Run: `node --test tests/browser.e2e.js`
Expected: PASS (8 existing + 1 new).

- [ ] **Step 8: Commit**

```bash
git add js/ai-research.js js/data.js index.html styles.css tests/browser.e2e.js
git commit -m "feat(ui): streamed AI Research panel wired to /ai-research"
```

---

### Task 6: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start the server**

Run: `npm start`
Expected: serves on http://localhost:3000 and opens a tab.

- [ ] **Step 2: Run a real research stream**

In the browser: switch market to US, search `NVDA`, click **AI Research**.
Expected: text streams into the panel within a few seconds; finishes with a cited, 7-section markdown report; meta shows "Done in Ns".

- [ ] **Step 3: Verify caching + re-run**

Click away and click **AI Research** again (or reload + search NVDA): panel shows "Cached" instantly. Click **Re-run**: a fresh stream starts.

- [ ] **Step 4: Verify error path**

Temporarily rename the claude binary (or set PATH without it) and trigger research.
Expected: panel shows "Claude CLI not found…" not a blank panel. Restore PATH after.

- [ ] **Step 5: Update docs + checkpoint**

Update `ARYA.md` changelog and `CHECKPOINT_LAST.md`/`TASK_QUEUE.md`. Commit:
```bash
git add ARYA.md CHECKPOINT_LAST.md TASK_QUEUE.md
git commit -m "docs: AI Research panel (slice 1) changelog + checkpoint"
```

---

## Self-Review

**Spec coverage:**
- AI Research panel for current US stock -> Tasks 5, 6. ✓
- Reusable server-side engine (`ai-research.js`) -> Tasks 1-3. ✓
- `/ai-research` SSE endpoint -> Task 4. ✓
- Streamed rendering -> Task 5. ✓
- 60-min caching + Re-run -> Task 4 (cache), Task 5 (Re-run). ✓
- Isolated/cheap claude invocation (tmpdir, no MCP, sonnet, exclude dynamic sections) -> Task 3. ✓
- stream-json parsing of verified event shapes -> Task 1. ✓
- Typed errors incl. rate_limited/cli_missing/not_authenticated/timeout -> Tasks 3, 4. ✓
- Symbol validation / no shell injection -> Tasks 3 (args array), 4 (regex). ✓
- Offline tests (no real CLI) -> Tasks 1-4 use fixture/fake/seam. ✓

**Placeholder scan:** No TBD/TODO. cache.js API confirmed (`cache.read`/`cache.write`). One implementation-time confirmation remains (e2e harness var names in Task 5) — a "match existing code" check, not unwritten logic.

**Type consistency:** `parseStreamJsonLine -> {kind,text}` used consistently (Tasks 1,3). `runResearch(symbol,context,onText,opts) -> {text,durationMs}` consistent (Tasks 3,4). SSE event names `done`/`error` + `{delta}`/`{cached}` payloads consistent (Tasks 4,5). `buildPrompt(symbol,context)` consistent (Tasks 2,3).
