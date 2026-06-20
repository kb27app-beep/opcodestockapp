# Spec: Merge Slice 1 — monorepo bootstrap + AI engine port

Date: 2026-06-21
Status: Approved (design) — ready for implementation plan

## Goal

Merge two projects by adopting the external Next.js app
(`github.com/bj1960-del/stock-research-app`, "SmartInvest AI") as the new frontend and
porting in the multi-provider AI engine built in opcodestockapp Parts 1–2. Slice 1 is the
first vertical slice: stand up a monorepo containing both, expose the engine's cascade as a
streaming Next.js API route, and wire the **real** web-searched/cited research into the app's
analysis card (replacing its heuristic "AI"), with a server-side provider-keys Settings UI.

## Context

- The external app is Next.js 16 (App Router) + React 18 + TypeScript + Tailwind + shadcn/Radix +
  Recharts, deployed to Firebase App Hosting. Tabs: Research / Portfolio / Ledger / Cashbook /
  Deposits. Custom localStorage-based auth (`currentUser.id`). Data via API routes
  (`yahoo-price`, `yahoo-quote`, `company-details`, `nse-bulk-deals`, `send-email`) + server
  actions (`stock-actions.ts`, `company-actions.ts`) using `yahoo-finance2`, Alpha Vantage
  (`ALPHA_VANTAGE_API_KEY` env), and screener scraping (`cheerio`).
- **The external app's "AI" is a heuristic, not an LLM.** `getStockAnalysis(stock, prompt, llm)`
  in `stock-actions.ts` ignores `prompt` and `llm` entirely and computes a deterministic report
  from Yahoo data. The "Select an LLM" picker + per-LLM `apiKey` live in `localStorage` and are
  never used server-side. Porting the real cascade is therefore the headline value of the merge.
- opcodestockapp's engine (Parts 1–2) is framework-agnostic CommonJS: `ai-research.js`
  (orchestrator `runResearch`/`listProviders`), `providers/{base,claude,codex,agy,api}.js`,
  `settings.js` (gitignored `.secrets.json` secret store, `SECRETS_PATH` env override,
  `publicView` returns booleans only). 55 node:test tests green. The cascade tries free local
  CLIs first (claude/codex/agy) then a manual-API-key `api` provider; web-capable-only; manual
  per-run override; capacity-only fall-through.

## Decisions (locked with the user, 2026-06-21)

1. **New monorepo** containing both apps + the engine as a shared package (npm workspaces).
2. **Both deploy targets**: self-hosted gets the full cascade (local CLIs available); a cloud
   build degrades automatically to the `api` provider only. No branching logic — driven by the
   engine's existing `isAvailable()` PATH checks.
3. **First slice = bootstrap + AI engine port** (this spec). Alerts, proxy/cache/FMP resilience,
   theme, and the Telegram bot are later slices.
4. GitHub remote creation + pushes are authorized.

## Scope

In scope (Slice 1):
- Monorepo scaffold (npm workspaces): `apps/web` (the Next.js app) + `packages/ai-engine` (the
  engine). New git repo + GitHub remote.
- Streaming `GET /api/ai-research` (Node runtime) backed by `runResearch`, with a 60-min cache and
  a test seam.
- `GET/POST /api/settings` (Node runtime) backed by `settings.js`; booleans only, never a key.
- Wire `analysis-card.tsx` to stream the real cascade and to select providers from `/api/settings`
  (replacing the localStorage LLM picker). Keep the heuristic as an optional "Quick snapshot".
- A provider-keys Settings card with availability badges (visibly shows cloud-degraded state).

Out of scope (later slices):
- Real-time alert polling + dispatch (push/email/telegram).
- Yahoo SSRF-proxy hardening, disk cache for market data, FMP fundamentals fallback.
- Theme / visual redesign.
- Portfolio / ledger / cashbook / deposits changes (left working as-is).
- Telegram bot (`apps/bot`) — Part 4; it will import `@smartinvest/ai-engine`.
- Market-aware research prompt (engine prompt stays US-framed; see Risks).

## Architecture

```
smartinvest/                         new repo (sibling of opcodestockapp; name changeable)
  package.json                       { "private": true, "workspaces": ["apps/*", "packages/*"] }
  .gitignore                         node_modules, .next, .secrets.json, .env*, *.log
  packages/
    ai-engine/                       lifted verbatim from opcodestockapp
      package.json                   name "@smartinvest/ai-engine", main "ai-research.js",
                                     "test": "node --test tests/*.test.js"
      ai-research.js, providers/*, settings.js, cache.js, tests/*, tests/fixtures/*
  apps/
    web/                             lifted from stock-research-app (its .git dropped)
      package.json                   depends on "@smartinvest/ai-engine": "*"
      src/app/api/ai-research/route.ts     (NEW, runtime nodejs) — SSE stream
      src/app/api/settings/route.ts        (NEW, runtime nodejs) — GET/POST keys
      src/components/research/analysis-card.tsx   (MODIFY) — provider select + streaming
      src/components/<settings card>              (NEW or extend) — provider keys + status
      .secrets.json                  gitignored (SECRETS_PATH points here)
    (bot/ later — Part 4)
```

Design rationale for the monorepo: the engine is shared by `apps/web` now and `apps/bot` later;
one package, one source of truth, imported by both.

`cache.js` moves into `packages/ai-engine` (it is a generic disk TTL cache) so the route and the
future bot can both reuse it.

## API routes (Node runtime)

Both routes set `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`
(they spawn child processes / read the secret store; never static or edge).

### `GET /api/ai-research`
- Query: `symbol` (required), `provider` (optional override, validated against known ids),
  `fresh=1` (bypass cache), `model` (optional), plus grounding params `name`, `price`, `pe`,
  `sector`, `mcap`.
- Symbol validation: accept the app's symbol formats (US tickers and `.BSE`/`.NSE` suffixes) —
  regex `^[A-Za-z.]{1,16}$`, uppercased. (Looser than Part 2's US-only `^[A-Z.]{1,8}$`.)
- Streams SSE: `data: {"delta": "..."}` per chunk; final `event: done` with
  `{cached, durationMs, provider}`; on failure `event: error` with `{code, message}` from a
  `friendlyError` map (includes `all_providers_exhausted`). Uses a `ReadableStream` returned from
  the route handler.
- Cache: `@smartinvest/ai-engine` `cache.js`, key `airesearch-v2-${provider||'auto'}-${SYMBOL}`,
  60-min TTL; `fresh=1` bypasses; the panel can re-run. Cache dir under `apps/web` (gitignored).
- Test seam: `AI_RESEARCH_FAKE=1` → deterministic SSE without spawning anything.
- Calls `runResearch(symbol, context, onText, { model, provider })`; resolves
  `{ text, durationMs, provider }`.

### `GET/POST /api/settings`
- `GET` → `{ ...publicView(readSettings()), providers: await listProviders(settings) }`. Returns
  only non-secret config + `configured: {api, fmp}` booleans + per-provider `{available,
  webCapable}`. **Never** a key value.
- `POST` (JSON body) → validate (`apiBaseUrl` must be http(s); `cascadeOrder` ⊆ known ids), call
  `writeSettings(patch)`, respond with the same non-secret shape. A key is cleared by sending an
  empty string; a key omitted is left unchanged.
- `SECRETS_PATH` is set (via `apps/web` env) to a gitignored `apps/web/.secrets.json`.

## Frontend wiring

- `analysis-card.tsx` (client component):
  - Replace the localStorage "Select LLM" picker + `AddLlmDialog` with a **provider `<Select>`**
    (`Auto (cascade)`, `claude`, `codex`, `agy`, `api`) whose options/availability come from
    `GET /api/settings`. Unavailable providers are disabled with a hint.
  - "Analyze" opens `EventSource('/api/ai-research?symbol=...&provider=...&...grounding')`, appends
    streamed deltas, and renders markdown progressively (reuse the app's existing markdown render
    or a minimal renderer). Shows elapsed time + which provider answered, and a Re-run (`fresh=1`).
  - Keep the existing heuristic `getStockAnalysis` behind a separate **"Quick snapshot"** button
    (free, instant, no quota) — it is genuinely useful and is left intact server-side.
  - Grounding: pass the quote/summary data the card already fetches (price, pe, sector, marketCap,
    name) as query params.
- **Settings card** (new component, surfaced in the app's settings/keys area): inputs for API key
  (write-only; shows "configured ✓", never the value), API base URL, API model, FMP key; a Save
  that `POST`s to `/api/settings`; and a **provider status list** (available / web-capable badges)
  from `GET /api/settings`. Replaces the insecure localStorage key entry for AI providers.

## Cloud-degraded behavior

No conditional logic. `listProviders()` reports each provider's `available` via PATH checks
(`claude`/`codex`/`agy` binaries) and `api` via configured key. On Firebase/Vercel the CLIs are
absent → they report unavailable → the cascade filters them out and uses `api` if a key is set.
The Settings status badges make this state legible to the user. Documented: a cloud deployment
needs an `api` key (OpenRouter/OpenAI/Perplexity) to do AI research; a self-hosted instance gets
the full free-local-first cascade.

## Error handling

- Engine typed `.code`s map to user-facing SSE `error` messages via a route-local `friendlyError`
  (extends Part 1's table with `all_providers_exhausted` → its actionable `err.message`).
- `/api/ai-research` validates the symbol (400 on bad input) and an unknown `provider` (400)
  before streaming. `/api/settings` POST validates body shape (400 on bad input).
- The panel never renders blank; errors return the card to an idle, re-runnable state.

## Testing

- `packages/ai-engine`: its 55 node:test tests carry over unchanged (`npm test -w
  @smartinvest/ai-engine`).
- `apps/web` route tests (light, offline): `/api/settings` GET never contains a key value (explicit
  assertion) + POST round-trips `configured` booleans; `/api/ai-research` with `AI_RESEARCH_FAKE=1`
  returns an SSE stream that ends with `event: done`. Run against the Next.js dev server or by
  importing the route handlers directly.
- Manual/live gate: one real `/api/ai-research?symbol=NVDA` self-hosted run streams a cited report;
  confirm provider availability badges reflect the host.
- Build gate: `apps/web` `next build` succeeds (note: the app ships `typescript.ignoreBuildErrors`
  and `eslint.ignoreDuringBuilds` true — new code should still typecheck cleanly).

## Risks / open items

- **Local-CLI providers require the host to have them installed + authed.** Captured by the
  deploy-target decision; `isAvailable()` already degrades gracefully. The API route MUST be Node
  runtime (not edge) to spawn them.
- **Research prompt is US-framed** (`buildPrompt` says "US-listed stock"); the merged app also
  covers Indian symbols. Slice 1 still allows AI research on any symbol (web search returns correct
  info), but a market-aware prompt is a later enhancement — changing `buildPrompt` now would churn
  the engine's existing tests for no slice-1 benefit.
- **CJS engine imported by TS/ESM Next.js**: supported via interop; the route uses
  `import { runResearch } from '@smartinvest/ai-engine'` (or `require`). Verified during bootstrap.
- **Secret store location**: `SECRETS_PATH` must resolve to a stable, gitignored path under
  `apps/web` regardless of cwd; set it explicitly in the web app's env, not via the package's
  `__dirname` default.
- **Spawning child processes from Next.js**: fine in a self-hosted Node server; on serverless the
  CLIs are simply unavailable (no spawn attempted because `isAvailable` is false).

## Reuse note (future slices)

`apps/bot` (Telegram, Part 4) imports `@smartinvest/ai-engine` `runResearch` directly and inherits
the full cascade. Alerts/proxy/theme slices build on this monorepo. The engine package is the
durable shared core.
