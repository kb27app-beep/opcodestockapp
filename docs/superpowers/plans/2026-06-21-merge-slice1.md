# Merge Slice 1 — monorepo bootstrap + AI engine port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a monorepo with the external Next.js app (`apps/web`) and the opcodestockapp engine (`packages/ai-engine`), then wire the real multi-provider cascade into the app's analysis card via streaming Node-runtime API routes, with a server-side provider-keys Settings card.

**Architecture:** npm-workspaces monorepo. The engine is a CommonJS package consumed by Next.js Node-runtime route handlers. `/api/ai-research` streams `runResearch` over SSE; `/api/settings` reads/writes the server-side secret store. The analysis card streams real reports and selects providers from `/api/settings`; the heuristic stays as a free "Quick snapshot".

**Tech Stack:** Next.js 16 (App Router, Node runtime), React 18, TypeScript, Tailwind + shadcn, npm workspaces, Node `node:test` (engine), zero new runtime deps.

## Global Constraints

- **Monorepo dir:** new sibling `../smartinvest` (name changeable). npm workspaces `["apps/*", "packages/*"]`.
- **Engine package name:** `@smartinvest/ai-engine` (CJS, `main: ai-research.js`, subpath exports `./settings`, `./cache`).
- **Secrets:** API keys live server-side only (`apps/web/.secrets.json`, gitignored, via `SECRETS_PATH`). `GET /api/settings` returns booleans only, never a key value. No secret in any query string.
- **Runtime:** both API routes set `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'` (they spawn CLIs / read the store; never edge/static).
- **Cloud-degraded:** no branching — `listProviders()` PATH checks make local CLIs drop out where absent; `api` remains.
- **Symbol validation (route):** `^[A-Z.]{1,16}$` after uppercasing (accepts US + `.BSE`/`.NSE`).
- **Provider ids:** `['claude','codex','agy','api']`.
- **Commit footer:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. GitHub remote + pushes authorized.
- **Engine test gate:** `npm test -w @smartinvest/ai-engine` stays green (currently 55) at every commit that touches the engine.
- **Don't break the external app:** leave portfolio/ledger/cashbook/deposits and the heuristic `getStockAnalysis` working.

---

### Task 1: Monorepo scaffold — lift both projects, wire workspaces, push

**Files:**
- Create: `../smartinvest/package.json`, `../smartinvest/.gitignore`, `../smartinvest/README.md`
- Create: `../smartinvest/packages/ai-engine/**` (copied engine + `package.json`)
- Create: `../smartinvest/apps/web/**` (copied Next.js app, its `.git` dropped)

**Interfaces:**
- Produces: workspace package `@smartinvest/ai-engine` importable from `apps/web`; root scripts `test`, `dev`, `build`.

- [ ] **Step 1: Create the monorepo skeleton + copy both projects**

```bash
ROOT="/Users/aryavora/Desktop/Personal Projects"
mkdir -p "$ROOT/smartinvest/apps" "$ROOT/smartinvest/packages"
# Engine -> packages/ai-engine (framework-agnostic files only)
mkdir -p "$ROOT/smartinvest/packages/ai-engine"
cp "$ROOT/opcodestockapp/ai-research.js" "$ROOT/opcodestockapp/settings.js" "$ROOT/opcodestockapp/cache.js" "$ROOT/smartinvest/packages/ai-engine/"
cp -R "$ROOT/opcodestockapp/providers" "$ROOT/smartinvest/packages/ai-engine/providers"
mkdir -p "$ROOT/smartinvest/packages/ai-engine/tests/fixtures"
cp "$ROOT/opcodestockapp/tests/base.test.js" "$ROOT/opcodestockapp/tests/orchestrator.test.js" \
   "$ROOT/opcodestockapp/tests/providers-codex.test.js" "$ROOT/opcodestockapp/tests/providers-agy.test.js" \
   "$ROOT/opcodestockapp/tests/providers-api.test.js" "$ROOT/opcodestockapp/tests/settings.test.js" \
   "$ROOT/smartinvest/packages/ai-engine/tests/"
# unit.test.js holds engine tests (parseStreamJsonLine/buildPrompt/runResearch) + cache + fmp/yahoo.
# Copy ONLY the engine-relevant tests into a new engine.test.js (see Step 3). For now copy fixtures:
cp "$ROOT/opcodestockapp/tests/fixtures/claude-stream.jsonl" "$ROOT/opcodestockapp/tests/fixtures/codex-stream.jsonl" \
   "$ROOT/opcodestockapp/tests/fixtures/agy-stream.txt" "$ROOT/smartinvest/packages/ai-engine/tests/fixtures/"
# Next.js app -> apps/web (drop its git history)
git -C "$ROOT" clone --depth 1 https://github.com/bj1960-del/stock-research-app.git "$ROOT/smartinvest/apps/web"
rm -rf "$ROOT/smartinvest/apps/web/.git"
```

- [ ] **Step 2: Root `package.json` + `.gitignore`**

`../smartinvest/package.json`:
```json
{
  "name": "smartinvest",
  "private": true,
  "version": "1.0.0",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "test": "npm test -w @smartinvest/ai-engine",
    "dev": "npm run dev -w web",
    "build": "npm run build -w web"
  }
}
```

`../smartinvest/.gitignore`:
```
node_modules/
.next/
out/
.secrets.json
.env
.env.*
!.env.example
*.log
.cache/
.DS_Store
```

- [ ] **Step 3: Engine `package.json` + consolidate engine tests**

`../smartinvest/packages/ai-engine/package.json`:
```json
{
  "name": "@smartinvest/ai-engine",
  "version": "1.0.0",
  "private": true,
  "main": "ai-research.js",
  "exports": {
    ".": "./ai-research.js",
    "./settings": "./settings.js",
    "./cache": "./cache.js"
  },
  "scripts": { "test": "node --test tests/*.test.js" }
}
```

Create `packages/ai-engine/tests/engine.test.js` containing ONLY the engine-relevant tests extracted
from opcodestockapp `tests/unit.test.js` (the `parseStreamJsonLine`, `buildPrompt`, `runResearch`,
and `cache` tests). Drop the `normalize`/`normalizeFmp` (yahoo-auth/fundamentals-fallback) tests —
those modules are not in the engine package. Copy the relevant `require('../cache')`,
`require('../ai-research')` blocks verbatim, fixing the relative paths (still `../cache`,
`../ai-research`). The base/orchestrator/providers/settings test files copied in Step 1 already use
correct relative paths.

- [ ] **Step 4: Install + verify the engine in the workspace**

```bash
cd "/Users/aryavora/Desktop/Personal Projects/smartinvest" && npm install
npm test -w @smartinvest/ai-engine
```
Expected: engine tests PASS (the same count as opcodestockapp minus the 4 yahoo/fmp tests that
weren't copied — i.e. ~51). If a copied test references a missing module, fix its path or drop it.

- [ ] **Step 5: Add `@smartinvest/ai-engine` as a dep of `apps/web` + smoke the import**

Edit `apps/web/package.json` `dependencies`: add `"@smartinvest/ai-engine": "*"`. Then:
```bash
cd "/Users/aryavora/Desktop/Personal Projects/smartinvest" && npm install
node -e "const e=require('@smartinvest/ai-engine'); console.log(typeof e.runResearch, typeof e.listProviders)"
```
Expected: `function function`.

- [ ] **Step 6: README + git init + GitHub remote + push**

Write `../smartinvest/README.md` (run instructions: `npm install`, `npm run dev` → web on :9002,
self-host vs cloud provider note, `apps/web/.secrets.json` is server-side and gitignored, set
`SECRETS_PATH`). Then:
```bash
cd "/Users/aryavora/Desktop/Personal Projects/smartinvest"
git init -b main && git add -A && git commit -m "chore: monorepo bootstrap — apps/web (Next.js) + packages/ai-engine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
gh repo create smartinvest --private --source=. --remote=origin --push
```
Expected: repo created, `main` pushed.

---

### Task 2: Engine — optional `instruction` passthrough in `buildPrompt`

Lets the app's prompt selector (Long-Term / Swing) actually shape the report, instead of being dead UI.

**Files:**
- Modify: `packages/ai-engine/providers/base.js` (`buildPrompt`)
- Test: `packages/ai-engine/tests/base.test.js` (add one case)

**Interfaces:**
- Produces: `buildPrompt(symbol, context)` honors `context.instruction` (string) by appending a focus line. Existing behavior unchanged when absent.

- [ ] **Step 1: Add the failing test** (append to `tests/base.test.js`):

```javascript
test('base.buildPrompt appends an optional instruction focus line', () => {
  const p = base.buildPrompt('NVDA', { instruction: 'Focus on swing-trade setups.' });
  assert.match(p, /Focus on swing-trade setups\./);
  const q = base.buildPrompt('NVDA', {});
  assert.doesNotMatch(q, /Additional focus/);
});
```

- [ ] **Step 2: Run to verify it fails** — `cd packages/ai-engine && node --test tests/base.test.js` → FAIL.

- [ ] **Step 3: Implement** — in `providers/base.js` `buildPrompt`, after the `grounding` line is
built and before the `return`, add:

```javascript
  const focus = context.instruction
    ? `\nAdditional focus requested by the user: ${context.instruction}\n` : '';
```
and insert `${focus}` into the template immediately after `${grounding}`.

- [ ] **Step 4: Run to verify it passes** — `node --test tests/base.test.js` → PASS; `npm test -w @smartinvest/ai-engine` still green.

- [ ] **Step 5: Commit** — `git add packages/ai-engine && git commit -m "feat(engine): optional instruction focus in buildPrompt"`

---

### Task 3: `apps/web` — `GET/POST /api/settings`

**Files:**
- Create: `apps/web/src/app/api/settings/route.ts`
- Create: `apps/web/.env` (sets `SECRETS_PATH`); add `.env` example note
- Test: `apps/web/tests/settings-route.test.mjs` (node:test, hits a dev server)

**Interfaces:**
- Consumes: `@smartinvest/ai-engine/settings` (`readSettings`, `writeSettings`, `publicView`), `@smartinvest/ai-engine` (`listProviders`).
- Produces: `GET /api/settings` → `{ apiBaseUrl, apiModel, apiWebSearch, cascadeOrder, configured:{api,fmp}, providers:[{id,label,available,webCapable}] }`. `POST /api/settings` → same shape after write.

- [ ] **Step 1: Set the secret-store path** — create `apps/web/.env` with:
```
SECRETS_PATH=./.secrets.json
```
(Next loads it server-side; resolves against the `apps/web` cwd at runtime.)

- [ ] **Step 2: Implement the route** — `apps/web/src/app/api/settings/route.ts`:

```typescript
import { readSettings, writeSettings, publicView } from '@smartinvest/ai-engine/settings';
import { listProviders } from '@smartinvest/ai-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KNOWN = ['claude', 'codex', 'agy', 'api'];

async function viewWithProviders(s: any) {
  const view: any = publicView(s);
  view.providers = await listProviders(s);
  return view;
}

export async function GET() {
  const s = readSettings();
  return Response.json(await viewWithProviders(s));
}

export async function POST(req: Request) {
  let patch: any;
  try { patch = await req.json(); } catch { return Response.json({ error: 'invalid JSON' }, { status: 400 }); }
  if (patch.apiBaseUrl && !/^https?:\/\//.test(String(patch.apiBaseUrl))) {
    return Response.json({ error: 'apiBaseUrl must be http(s)' }, { status: 400 });
  }
  if (patch.cascadeOrder && (!Array.isArray(patch.cascadeOrder) || patch.cascadeOrder.some((id: string) => !KNOWN.includes(id)))) {
    return Response.json({ error: 'cascadeOrder has unknown provider ids' }, { status: 400 });
  }
  const next = writeSettings(patch);
  return Response.json(await viewWithProviders(next));
}
```
(If the CJS named imports don't resolve under the bundler, use `import settings from '@smartinvest/ai-engine/settings'; const { readSettings, writeSettings, publicView } = settings;` and `import engine from '@smartinvest/ai-engine'; const { listProviders } = engine;`.)

- [ ] **Step 3: Write the route test** — `apps/web/tests/settings-route.test.mjs` (boots `next dev` on a
throwaway port with an isolated `SECRETS_PATH`, asserts no key leak + round-trip):

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const PORT = 9100 + (process.pid % 80);
const BASE = `http://localhost:${PORT}`;
const SECRETS = path.join(os.tmpdir(), `si-secrets-${process.pid}.json`);
let srv;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

before(async () => {
  srv = spawn('npm', ['run', 'dev', '-w', 'web', '--', '-p', String(PORT)], {
    cwd: path.join(process.cwd(), '..', '..'),
    env: { ...process.env, SECRETS_PATH: SECRETS, AI_RESEARCH_FAKE: '1' }, stdio: 'ignore',
  });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/api/settings`)).ok) return; } catch {} await sleep(500); }
  throw new Error('web did not start');
});
after(() => { srv?.kill('SIGKILL'); });

test('GET /api/settings returns booleans + providers, never a key', async () => {
  const r = await fetch(`${BASE}/api/settings`);
  const body = await r.text();
  assert.strictEqual(r.status, 200);
  const j = JSON.parse(body);
  assert.ok(Array.isArray(j.providers));
  assert.strictEqual(typeof j.configured.api, 'boolean');
  assert.ok(!body.includes('sk-'), 'must not echo a key');
});

test('POST /api/settings round-trips configured.api without leaking the key', async () => {
  const r = await fetch(`${BASE}/api/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: 'sk-TEST-123', apiBaseUrl: 'https://openrouter.ai/api/v1', apiModel: 'openai/gpt-4o:online' }),
  });
  const body = await r.text();
  assert.strictEqual(r.status, 200);
  assert.ok(!body.includes('sk-TEST-123'), 'POST response must not echo the key');
  assert.strictEqual(JSON.parse(body).configured.api, true);
});
```
Note: this test is slow (boots Next dev). It is a manual/integration gate — run it explicitly, not in a tight loop.

- [ ] **Step 4: Run the test** — `cd "/Users/.../smartinvest" && node --test apps/web/tests/settings-route.test.mjs`. Expected: both PASS.

- [ ] **Step 5: Commit** — `git add apps/web && git commit -m "feat(web): /api/settings (server-side provider keys, booleans only)"`

---

### Task 4: `apps/web` — `GET /api/ai-research` (SSE streaming)

**Files:**
- Create: `apps/web/src/app/api/ai-research/route.ts`
- Test: `apps/web/tests/ai-research-route.test.mjs`

**Interfaces:**
- Consumes: `@smartinvest/ai-engine` (`runResearch`), `@smartinvest/ai-engine/cache`.
- Produces: SSE stream — `data: {"delta":"..."}` chunks, `event: done` with `{cached,durationMs,provider}`, `event: error` with `{code,message}`.

- [ ] **Step 1: Implement the route** — `apps/web/src/app/api/ai-research/route.ts`:

```typescript
import { runResearch } from '@smartinvest/ai-engine';
import cache from '@smartinvest/ai-engine/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KNOWN = ['claude', 'codex', 'agy', 'api'];

function friendlyError(err: any): string {
  switch (err?.code) {
    case 'cli_missing': return 'That AI CLI is not installed on this host.';
    case 'not_authenticated': return 'AI provider not logged in / API key invalid.';
    case 'timeout': return 'Research timed out. Try again or narrow the request.';
    case 'rate_limited': return err.message;
    case 'all_providers_exhausted': return err.message;
    case 'busy': return 'Another research run is in progress. Try again shortly.';
    default: return 'AI research failed. See server log for details.';
  }
}

const num = (v: string | null) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : undefined; };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
  if (!/^[A-Z.]{1,16}$/.test(symbol)) return Response.json({ error: 'invalid symbol' }, { status: 400 });
  const provider = url.searchParams.get('provider') || undefined;
  if (provider && !KNOWN.includes(provider)) return Response.json({ error: 'unknown provider' }, { status: 400 });

  const fresh = url.searchParams.get('fresh') === '1';
  const model = url.searchParams.get('model') || undefined;
  const instruction = url.searchParams.get('instruction') || undefined;
  const cacheKey = `airesearch-v2-${provider || 'auto'}-${symbol}`;
  const context: any = {
    name: url.searchParams.get('name') || undefined,
    currentPrice: num(url.searchParams.get('price')),
    pe: num(url.searchParams.get('pe')),
    sector: url.searchParams.get('sector') || undefined,
    marketCap: num(url.searchParams.get('mcap')),
    instruction,
  };

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: any, event?: string) => {
        if (event) controller.enqueue(enc.encode(`event: ${event}\n`));
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      if (process.env.AI_RESEARCH_FAKE === '1') {
        send({ delta: 'Fake research for ' + symbol });
        send({ cached: false, durationMs: 1, provider: 'fake' }, 'done');
        controller.close(); return;
      }

      if (!fresh) {
        const hit = cache.read(cacheKey, 60 * 60 * 1000);
        if (hit && hit.fresh && hit.data) {
          send({ cached: true }); send({ delta: hit.data });
          send({ cached: true, durationMs: 0 }, 'done');
          controller.close(); return;
        }
      }

      runResearch(symbol, context, (delta: string) => send({ delta }), { model, provider })
        .then(({ text, durationMs, provider: used }: any) => {
          cache.write(cacheKey, text);
          send({ cached: false, durationMs, provider: used }, 'done');
          controller.close();
        })
        .catch((err: any) => {
          console.error('ai-research error:', err.code, err.message);
          send({ code: err.code || 'error', message: friendlyError(err) }, 'error');
          controller.close();
        });
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
```

- [ ] **Step 2: Write the test** — `apps/web/tests/ai-research-route.test.mjs` (reuses the dev-server
boot pattern from Task 3, with `AI_RESEARCH_FAKE=1`):

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import path from 'node:path';
const PORT = 9200 + (process.pid % 80);
const BASE = `http://localhost:${PORT}`;
let srv; const sleep = (ms) => new Promise(r => setTimeout(r, ms));
before(async () => {
  srv = spawn('npm', ['run', 'dev', '-w', 'web', '--', '-p', String(PORT)], {
    cwd: path.join(process.cwd(), '..', '..'),
    env: { ...process.env, AI_RESEARCH_FAKE: '1' }, stdio: 'ignore',
  });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/api/settings`)).ok) return; } catch {} await sleep(500); }
  throw new Error('web did not start');
});
after(() => { srv?.kill('SIGKILL'); });
test('invalid symbol -> 400', async () => {
  assert.strictEqual((await fetch(`${BASE}/api/ai-research?symbol=@@`)).status, 400);
});
test('unknown provider -> 400', async () => {
  assert.strictEqual((await fetch(`${BASE}/api/ai-research?symbol=NVDA&provider=ghost`)).status, 400);
});
test('streams SSE ending in done (fake engine)', async () => {
  const res = await fetch(`${BASE}/api/ai-research?symbol=NVDA`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
  assert.match(await res.text(), /event: done/);
});
```

- [ ] **Step 3: Run the test** — `node --test apps/web/tests/ai-research-route.test.mjs`. Expected: 3 PASS.

- [ ] **Step 4: Commit** — `git add apps/web && git commit -m "feat(web): /api/ai-research SSE streaming via the engine cascade"`

---

### Task 5: `apps/web` — wire the analysis card to the real engine

**Files:**
- Create: `apps/web/src/lib/ai-markdown.ts` (minimal markdown renderer)
- Modify: `apps/web/src/components/research/analysis-card.tsx`

**Interfaces:**
- Consumes: `GET /api/settings` (providers), `GET /api/ai-research` (SSE), existing `getStockAnalysis` action (Quick snapshot).
- Produces: a card that streams real reports and selects a provider.

- [ ] **Step 1: Add the markdown helper** — `apps/web/src/lib/ai-markdown.ts`:

```typescript
// Minimal, escape-first markdown -> HTML for streamed reports (ported from opcodestockapp).
export function renderAiMarkdown(md: string): string {
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

- [ ] **Step 2: Replace `analysis-card.tsx`** with the version below. Changes vs original:
removes the localStorage LLM picker + `AddLlmDialog`; adds a **provider `<Select>`** from
`/api/settings`; "AI Research" streams `/api/ai-research` (EventSource) and renders markdown
progressively; keeps the prompt selector (passed as `instruction`); keeps the heuristic behind a
**Quick snapshot** button. (Keep `AddPromptDialog` from the original — unchanged — at the bottom.)

```tsx
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Wand2, PlusCircle, Bot, Loader2, Sparkles } from "lucide-react";
import type { Stock } from '@/types';
import { getStockAnalysis } from '@/actions/stock-actions';
import { renderAiMarkdown } from '@/lib/ai-markdown';

const initialPrompts = [
  { name: 'Long-Term Investment', content: 'Analyze for long-term investment (5+ years). Focus on fundamentals, moat, and management quality.' },
  { name: 'Swing Trading Opportunity', content: 'Analyze for a swing trade (1-3 months). Focus on technical indicators, recent news, and short-term catalysts.' },
];

type ProviderInfo = { id: string; label: string; available: boolean; webCapable: boolean };

export function AnalysisCard({ stock, userId }: { stock: Stock, userId: string }) {
  const [prompts, setPrompts] = useState<{ name: string, content: string }[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<string>('');
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provider, setProvider] = useState<string>(''); // '' = Auto (cascade)

  const [streaming, setStreaming] = useState(false);
  const [report, setReport] = useState<string>('');
  const [meta, setMeta] = useState<string>('');
  const [snapLoading, setSnapLoading] = useState(false);
  const [snap, setSnap] = useState<{ recommendation: string; reasoning: string } | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (userId) {
      try {
        const saved = localStorage.getItem(`customPrompts_${userId}`);
        const parsed = saved ? JSON.parse(saved) : initialPrompts;
        setPrompts(parsed);
        if (parsed.length > 0) setSelectedPrompt(parsed[0].content);
      } catch { setPrompts(initialPrompts); }
    }
    fetch('/api/settings').then(r => r.json()).then(d => setProviders(d.providers || [])).catch(() => {});
    return () => { esRef.current?.close(); };
  }, [userId]);

  const handleSetPrompts = useCallback((newPrompts: { name: string, content: string }[]) => {
    if (!userId) return;
    setPrompts(newPrompts);
    try { localStorage.setItem(`customPrompts_${userId}`, JSON.stringify(newPrompts)); } catch {}
  }, [userId]);

  const startResearch = (fresh = false) => {
    if (!stock?.symbol) return;
    esRef.current?.close();
    setStreaming(true); setReport(''); setMeta('Researching…');
    const t0 = Date.now(); let raw = '';
    const p = new URLSearchParams({ symbol: stock.symbol });
    if (provider) p.set('provider', provider);
    if (fresh) p.set('fresh', '1');
    if (selectedPrompt) p.set('instruction', selectedPrompt);
    if (stock.name) p.set('name', stock.name);
    if (stock.sector) p.set('sector', stock.sector);
    const es = new EventSource(`/api/ai-research?${p.toString()}`);
    esRef.current = es;
    es.onmessage = (e) => {
      try { const m = JSON.parse(e.data); if (m.cached) setMeta('Cached'); if (typeof m.delta === 'string') { raw += m.delta; setReport(raw); } } catch {}
    };
    es.addEventListener('done', (e: MessageEvent) => {
      es.close(); esRef.current = null; setStreaming(false);
      let info: any = {}; try { info = JSON.parse(e.data); } catch {}
      setMeta(info.cached ? 'Cached' : `Done in ${Math.round((Date.now() - t0) / 1000)}s${info.provider ? ` · ${info.provider}` : ''}`);
    });
    es.addEventListener('error', (e: MessageEvent) => {
      es.close(); esRef.current = null; setStreaming(false);
      let info: any = {}; try { info = JSON.parse((e as any).data); } catch {}
      setMeta('Error'); setReport(`<p class="text-destructive">⚠️ ${info.message || 'AI research failed.'}</p>`);
    });
  };

  const handleQuickSnapshot = async () => {
    if (!stock) return;
    setSnapLoading(true); setSnap(null);
    const result = await getStockAnalysis(stock, selectedPrompt, 'heuristic');
    setSnapLoading(false);
    if (result.success && result.analysis) setSnap(result.analysis);
    else toast({ title: "Snapshot failed", description: result.error, variant: 'destructive' });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline gap-2">
          <CardTitle className="flex items-center gap-2 font-headline text-base">
            <Wand2 className="text-primary" /> AI Research
          </CardTitle>
          <CardDescription className="text-xs">Live, web-searched, cited research for {stock.name}.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex gap-4 items-end">
            <div className="flex-1 space-y-2">
              <Label>Focus</Label>
              <Select onValueChange={setSelectedPrompt} value={selectedPrompt}>
                <SelectTrigger><SelectValue placeholder="Select a focus" /></SelectTrigger>
                <SelectContent>{prompts.map(p => <SelectItem key={p.name} value={p.content}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <AddPromptDialog onAddPrompt={handleSetPrompts} currentPrompts={prompts} />
          </div>
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select onValueChange={setProvider} value={provider}>
              <SelectTrigger><SelectValue placeholder="Auto (cascade)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Auto (cascade)</SelectItem>
                {providers.map(p => (
                  <SelectItem key={p.id} value={p.id} disabled={!p.available}>
                    {p.label}{!p.available ? ' — unavailable here' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => startResearch(false)} disabled={streaming} className="flex-1">
              {streaming ? <Loader2 className="animate-spin mr-2" /> : <Bot className="mr-2" />} AI Research
            </Button>
            <Button variant="outline" onClick={handleQuickSnapshot} disabled={snapLoading}>
              {snapLoading ? <Loader2 className="animate-spin mr-2" /> : <Sparkles className="mr-2" size={16} />} Quick snapshot
            </Button>
          </div>
        </div>

        {(streaming || report) && (
          <div className="mt-6 space-y-2 animate-in fade-in duration-300">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-sm">Report</h4>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{meta}</span>
                {!streaming && report && <Button size="sm" variant="ghost" onClick={() => startResearch(true)}>Re-run</Button>}
              </div>
            </div>
            <Card className="bg-card"><CardContent className="pt-4">
              <div className="text-xs leading-relaxed" dangerouslySetInnerHTML={{ __html: renderAiMarkdown(report) }} />
            </CardContent></Card>
          </div>
        )}

        {snap && (
          <div className="mt-6 space-y-2">
            <h4 className="font-bold text-sm">Quick snapshot</h4>
            <Card className="bg-secondary/50"><CardContent className="pt-4">
              <p className="font-semibold text-primary text-sm">{snap.recommendation}</p>
              <div className="text-xs leading-relaxed whitespace-pre-wrap font-mono mt-2">{snap.reasoning}</div>
            </CardContent></Card>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddPromptDialog({ onAddPrompt, currentPrompts }: { onAddPrompt: (prompts: { name: string, content: string }[]) => void, currentPrompts: { name: string, content: string }[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const { toast } = useToast();
  const handleSave = () => {
    if (!name || !content) { toast({ title: "Error", description: "Provide a name and content.", variant: "destructive" }); return; }
    onAddPrompt([...currentPrompts, { name, content }]);
    toast({ title: "Success", description: "New focus added." });
    setName(''); setContent(''); setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="icon"><PlusCircle size={16} /></Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle className="text-base">Add focus</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          <Input placeholder="Name (e.g., Value Investing Check)" value={name} onChange={e => setName(e.target.value)} />
          <Textarea placeholder="Focus instruction…" rows={6} value={content} onChange={e => setContent(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Typecheck + build** — `cd "/Users/.../smartinvest" && npm run build -w web 2>&1 | tail -20`.
Expected: build succeeds (the app sets `ignoreBuildErrors`, but the new code should compile cleanly).

- [ ] **Step 4: Manual verify** — `npm run dev`, open the Research tab for a stock, click **AI Research**:
the report streams; **Quick snapshot** still shows the heuristic. (Self-hosted → real cascade; if no
provider available, the error message is shown.) Screenshot for the record.

- [ ] **Step 5: Commit** — `git add apps/web && git commit -m "feat(web): analysis card streams the real cascade + provider select + quick snapshot"`

---

### Task 6: `apps/web` — AI Providers settings card

**Files:**
- Create: `apps/web/src/components/research/ai-providers-card.tsx`
- Modify: `apps/web/src/components/research-dashboard.tsx` (render the card)

**Interfaces:**
- Consumes: `GET/POST /api/settings`.
- Produces: a UI to set server-side provider keys + see provider status.

- [ ] **Step 1: Implement the card** — `apps/web/src/components/research/ai-providers-card.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, Loader2 } from "lucide-react";

type View = {
  apiBaseUrl: string; apiModel: string;
  configured: { api: boolean; fmp: boolean };
  providers: { id: string; label: string; available: boolean; webCapable: boolean }[];
};

export function AiProvidersCard() {
  const [view, setView] = useState<View | null>(null);
  const [apiKey, setApiKey] = useState(''); const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiModel, setApiModel] = useState(''); const [fmpKey, setFmpKey] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const load = () => fetch('/api/settings').then(r => r.json()).then((d: View) => {
    setView(d); setApiBaseUrl(d.apiBaseUrl || ''); setApiModel(d.apiModel || '');
  }).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    const patch: any = { apiBaseUrl, apiModel };
    if (apiKey) patch.apiKey = apiKey;        // only send a key when non-empty (blank ≠ wipe)
    if (fmpKey) patch.fmpKey = fmpKey;
    const r = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    setSaving(false);
    if (r.ok) { setApiKey(''); setFmpKey(''); await load(); toast({ title: 'Saved', description: 'Provider settings updated.' }); }
    else toast({ title: 'Save failed', description: (await r.json()).error, variant: 'destructive' });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-headline text-base"><KeyRound className="text-primary" size={18} /> AI Providers</CardTitle>
        <CardDescription className="text-xs">Keys are stored on the server and never returned to the browser. Local CLIs (claude/codex/agy) work only when self-hosted.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {view?.providers.map(p => (
            <Badge key={p.id} variant={p.available ? 'default' : 'secondary'}>
              {p.label}: {p.available ? 'available' : 'unavailable'}{p.webCapable ? '' : ' (no web)'}
            </Badge>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">API key {view?.configured.api ? '✓ configured' : ''}</Label>
            <Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={view?.configured.api ? '•••• (leave blank to keep)' : 'sk-… / pplx-…'} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">API base URL</Label>
            <Input value={apiBaseUrl} onChange={e => setApiBaseUrl(e.target.value)} placeholder="https://openrouter.ai/api/v1" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">API model (use a web mode: :online / sonar)</Label>
            <Input value={apiModel} onChange={e => setApiModel(e.target.value)} placeholder="openai/gpt-4o:online" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">FMP key {view?.configured.fmp ? '✓ configured' : ''}</Label>
            <Input type="password" value={fmpKey} onChange={e => setFmpKey(e.target.value)} placeholder={view?.configured.fmp ? '•••• (leave blank to keep)' : 'FMP data key'} />
          </div>
        </div>
        <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="animate-spin mr-2" /> : null} Save providers</Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Render it** — in `apps/web/src/components/research-dashboard.tsx`, import
`AiProvidersCard` and render it once (e.g., near the top of the research dashboard, or behind a
collapsible "AI settings"). Add: `import { AiProvidersCard } from '@/components/research/ai-providers-card';`
and place `<AiProvidersCard />` in the dashboard's JSX where a settings card fits (a single instance,
not per-stock).

- [ ] **Step 3: Build + manual verify** — `npm run build -w web`; `npm run dev`, open Research, set an
API key + base URL + `:online` model, Save → badge for `api` flips to available; the value is never
shown back. Screenshot.

- [ ] **Step 4: Commit** — `git add apps/web && git commit -m "feat(web): AI Providers settings card (server-side keys, status badges)"`

---

### Task 7: Docs + verification gate + handoff

**Files:**
- Modify: `../smartinvest/README.md`
- Modify (opcodestockapp): `RESUME_ULTRACODE.md`, `CHECKPOINT_LAST.md`, `TASK_QUEUE.md` (point at the new repo; mark Slice 1 done)

- [ ] **Step 1: Finish `README.md`** — quickstart (`npm install`, `npm run dev` → :9002), self-host vs
cloud provider matrix, `.secrets.json`/`SECRETS_PATH` note, where AI Research + AI Providers live,
and that `packages/ai-engine` is shared (web now, bot later).
- [ ] **Step 2: Engine gate** — `npm test -w @smartinvest/ai-engine` green; `npm run build -w web` succeeds.
- [ ] **Step 3: Route gate** — run the two `*.test.mjs` route tests (slow; explicit run). Record pass.
- [ ] **Step 4: Live smoke (self-host)** — one real `AI Research` run on a US ticker streams a cited
report; provider badges reflect the host. Screenshot.
- [ ] **Step 5: Update opcodestockapp handoff docs** to point at `../smartinvest` as the active repo and
mark Merge Slice 1 done; commit + push opcodestockapp. Commit + push smartinvest.

---

## Self-Review

**Spec coverage:** monorepo scaffold (T1) ✓; engine package + shared (T1) ✓; instruction passthrough
enabling the prompt selector (T2, optional-but-included to avoid dead UI) ✓; `/api/settings`
GET/POST + no-key-leak test (T3) ✓; `/api/ai-research` SSE + cache v2 + fake seam + symbol/provider
validation (T4) ✓; analysis card streaming + provider select + quick snapshot (T5) ✓; AI Providers
settings card + status badges + cloud-degraded legibility (T6) ✓; cloud-degraded via isAvailable
(T3/T6) ✓; testing (engine + route tests) ✓; docs/handoff (T7) ✓.

**Placeholder scan:** every code step has full content; the only "fill-in" is T1 Step 3 (extract the
engine-relevant tests from `unit.test.js`) and T6 Step 2 (place `<AiProvidersCard/>`), both with
explicit instructions and exact paths — not vague placeholders.

**Type consistency:** provider shape `{id,label,available,webCapable}` matches `listProviders` from
the engine and is consumed identically in T5/T6; `/api/settings` view shape `{apiBaseUrl,apiModel,
apiWebSearch,cascadeOrder,configured:{api,fmp},providers}` is produced in T3 and consumed in T5/T6;
SSE event names (`done`/`error`) and payloads match between T4 (route) and T5 (card); `instruction`
flows card(T5)→route(T4)→`buildPrompt`(T2) consistently.

## Execution note

T1 (bootstrap) is foundational and sequential. T2 (engine) is independent. T3 and T4 (routes) are
disjoint new files and can be built in parallel after T1. T5 and T6 (frontend) depend on T3/T4. A
final manual/live gate (T5/T6/T7) confirms streaming end-to-end.
