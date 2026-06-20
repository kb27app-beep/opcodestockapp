# RESUME STATE — for ultracode session

> ⚠️ **ACTIVE REPO MOVED (2026-06-21): work now happens in `../smartinvest`** (npm-workspaces
> monorepo: `apps/web` Next.js + `packages/ai-engine`). Merge Slice 1 is DONE there (streaming
> AI Research wired into the Next.js app). This `opcodestockapp` repo is now the engine's origin +
> brainstorm/spec/plan history, frozen at Part 2. **Read `CHECKPOINT_LAST.md` first** for the
> current state + the GitHub-remote blocker. The section below is pre-merge history.

Read this first, then `CHECKPOINT_LAST.md`, the specs/plans under `docs/superpowers/`, and the
memories `merge-nextjs-frontend.md` + `telegram-bot-goal.md`. Single handoff for picking work up.

## Where things stand (2026-06-20)

Branch: `upgrade/site-overhaul`. Latest commit: `0dc5f51` (review fixes). **Committed, NOT pushed.**

Tests: `npm test` **55 green**, `npm run test:e2e` **9 green**. App still runs via `node server.js`
on **http://localhost:3000 only** (serves the page + `/yf` + `/ai-research` proxy). Don't open it on
another port — no proxy there.

## The big picture (revised 2026-06-20 — MERGE decided)

1. ✅ **Part 1 — AI Research slice** (v1.6.0): on-demand `claude -p` streamed research panel.
2. ✅ **Part 2 — Multi-provider AI engine** (v1.7.0, engine only): claude/codex/agy + generic API
   provider behind a cascade; `settings.js` server-side secret store. **DONE this session.**
3. ⬜ **MERGE (new Part 3)** — adopt the external **Next.js/shadcn app
   `github.com/bj1960-del/stock-research-app`** as the new frontend and port THIS engine
   (+ alerts, Yahoo proxy) into it. Replaces the old "UI redo". See `merge-nextjs-frontend.md`.
4. ⬜ **Part 4 — Telegram bot** (US market) reusing `runResearch`.

## What was built in Part 2 (so you don't re-derive it)

Framework-agnostic Node — imports cleanly into a Next.js API route and the Telegram bot:
- `providers/base.js` — provider interface + `buildPrompt`, `cleanEnv`, `splitLines`, `typedError`.
- `providers/claude.js` — claude CLI (subscription, stream-json). Exports `parseStreamJsonLine`.
- `providers/codex.js` — `codex exec --json --ephemeral --skip-git-repo-check --ignore-user-config
  --sandbox read-only -c tools.web_search=true -o <file>`. Parses `item.completed`/`agent_message`.
- `providers/agy.js` — `agy --print` (Gemini Google-Search grounding); plain-text stream.
- `providers/api.js` — generic OpenAI-compatible SSE client (OpenRouter/OpenAI/Perplexity; Anthropic/
  Google via OpenRouter). `webCapable(settings)` true only for `:online`/`sonar`/`apiWebSearch`.
- `settings.js` — gitignored `.secrets.json`. `readSettings/writeSettings/publicView/getFmpKey`.
  `publicView` returns booleans only (`configured:{api,fmp}`), NEVER a key value. `FMP_API_KEY` env
  still honored. `SECRETS_PATH` env override for tests.
- `ai-research.js` — orchestrator `runResearch(symbol, context, onText, opts)` (signature unchanged).
  Cascade `claude→codex→agy→api`; only `{rate_limited,not_authenticated,cli_missing,busy}` fall
  through; web-capable-only; `opts.provider` = manual override; returns `{text,durationMs,provider}`.
  Also `listProviders(settings)`. Re-exports `parseStreamJsonLine/buildPrompt/MAX_CONCURRENT`.

## HARD-WON GOTCHAS (do not relearn these the hard way)

1. **Subscription vs paid (claude)**: `cleanEnv()` strips `ANTHROPIC*` so `claude -p` uses the
   subscription. Don't isolate via `CLAUDE_CONFIG_DIR` (breaks auth).
2. **claude hijack guard**: `--disallowedTools Skill Task Workflow TodoWrite` + inline directive,
   or headless claude forks a background deep-research workflow instead of answering.
3. **codex hijack guard**: WITHOUT `--ignore-user-config`, codex loads your global `~/.agents`
   skills + MCP and runs extra "startup" shell commands (noise/cost). Use `--ignore-user-config`.
   Web search via `-c tools.web_search=true`. Final answer is written to the `-o <file>` (read that;
   fall back to the last `agent_message`).
4. **agy**: `agy --print "<prompt>"` returns final markdown directly; Gemini grounds automatically
   (no web flag). No token streaming — emit full text as one delta.
5. **Web-capable only**: only providers that actually web-search join the research cascade (keeps
   reports cited). codex+agy probed and BOTH qualify (`docs/superpowers/notes/2026-06-20-codex-agy-probe.md`).
6. **Secrets**: keys live server-side in `.secrets.json` (gitignored). NEVER return a key to the
   client; NEVER put one in a query string. `GET /settings` (when built) returns booleans only.
7. **App port**: always 3000. Test/scratch spawns set `PORT`/`NO_OPEN` and must not open tabs.
8. **macOS**: `timeout`/`gtimeout` not present by default — don't prefix commands with it.

## Deferred from the Part 2 plan (do these INSIDE the merge, on the Next.js side)

Plan Tasks 9–10 (`docs/superpowers/plans/2026-06-20-providers.md`) — intentionally NOT built on the
buildless app because the merge reimplements them in React/Next:
- `GET /settings` (publicView) + `POST /settings` (writeSettings) as Next API routes.
- Cache-key v2 `airesearch-v2-<provider>-<sym>` + `&provider=` override + `friendlyError` cases.
- A Settings "AI Providers" card (key inputs write-only, provider status, cascade order, per-run
  override). The external app already has shadcn UI — build it there.

## How to resume in ultracode

1. Read this + `CHECKPOINT_LAST.md` + memories `merge-nextjs-frontend.md` / `telegram-bot-goal.md`.
2. Confirm green: `npm test` (55), `npm run test:e2e` (9).
3. **Start the merge**: brainstorm folding the engine (+ alerts, proxy) into the Next.js app. Clone/
   inspect `bj1960-del/stock-research-app` (default branch `master`); plan API routes that import
   `ai-research.js`. Then Part 4 (Telegram bot).
4. Cost rule (standing): haiku for cheap parallel work; sonnet only where genuinely needed; no opus.
