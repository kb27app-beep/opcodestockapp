# Spec: Generalize AI providers (local CLIs + manual API keys)

Date: 2026-06-20
Branch: upgrade/site-overhaul
Status: Approved (design) — ready for implementation plan

## Goal

Generalize the AI research engine so it is no longer hard-wired to the `claude`
CLI. Add additional **local CLI** providers (`codex`, `agy`) and one generic
**manual API-key** provider, selected by an auto-cascade that prefers free local
limits first and paid API keys last, with a manual per-run override. Keys are
entered in the Settings UI but stored server-side and never returned to the
client. This is Part 2 of the AI layer; it keeps `runResearch`'s signature so the
future Telegram bot still imports one engine.

## Context

- Part 1 shipped `ai-research.js` (`buildPrompt`, `parseStreamJsonLine`,
  `runResearch`) which spawns `claude -p` and streams a web-searched, cited
  US-equity report over SSE via `server.js` `GET /ai-research`. Default model is
  `haiku`. Hijack guard (`--disallowedTools Skill Task Workflow TodoWrite` + an
  inline `--append-system-prompt`) keeps headless claude answering inline instead
  of forking a background workflow. `cleanEnv()` strips `CLAUDE*`/`ANTHROPIC*` to
  force subscription auth and a neutral context (`cwd: os.tmpdir()`,
  `--strict-mcp-config --mcp-config '{"mcpServers":{}}'`,
  `--exclude-dynamic-system-prompt-sections`).
- Two incompatible secret-handling patterns exist today and neither matches the
  requirement:
  - `FMP_API_KEY` — server-side **env var only**, no UI.
  - `perplexityKey` / `telegramToken` / `smtpPass` — entered in Settings but
    stored **client-side** in the browser DB (`dbSet`) and POSTed per request.
  The requirement (UI-entered + server-stored + never returned to client) needs a
  **new** server-side secret store.
- Verified locally (2026-06-20): `codex` (`/usr/local/bin/codex`, has
  `codex exec` non-interactive subcommand), `agy` (`~/.local/bin/agy`, has
  `--print`/`-p` print mode, `--model`), `ollama` (`/usr/local/bin/ollama`, local
  model runner, **no web search**). `ollama` is therefore out of scope for the
  research cascade (uncited/stale output would defeat a research report).

## Decisions (locked with the user, 2026-06-20)

1. **Scope:** add `codex` + `agy` (local CLIs) + ONE generic API-key provider;
   fold `FMP_API_KEY` into the new store. Skip `ollama`.
2. **Web search:** only web-capable providers join the research cascade. A
   provider that cannot be reliably made to web-search is excluded, never run
   with citations silently disabled.
3. **Key storage:** new gitignored server-side secrets file, written via
   `POST /settings`; the server returns only booleans (`configured: true/false`),
   never a key value.
4. **Selection:** auto-cascade (free local → paid API) with a manual per-run
   override.

## Scope

In scope:
- Provider-module architecture; `ai-research.js` becomes a thin orchestrator.
- `claude` (refactored into a provider module), `codex`, `agy`, and one generic
  OpenAI-compatible `api` provider.
- Server-side secret store (`settings.js` + `.secrets.json`) and `GET`/`POST`
  `/settings`.
- Browser Settings "AI Providers" card: enter API key/base URL/model, view
  per-provider availability, set cascade order, choose a per-run override.
- Auto-cascade with capacity-failure fall-through + manual override.

Out of scope (later):
- `ollama` and any non-web-search provider.
- UI redesign / theming (Part 3).
- Telegram bot (Part 4) — it will import `runResearch` directly.
- Distinct first-class providers for each API vendor; one configurable
  OpenAI-compatible client covers OpenRouter/OpenAI/Perplexity directly and
  Anthropic/Google via OpenRouter.

## Architecture

```
ai-research.js          orchestrator: runResearch() builds + runs the cascade; keeps its signature
providers/
  base.js               shared interface contract + helpers (cleanEnv, NDJSON line splitter,
                        typed-error factory, prompt builder re-export)
  claude.js             existing claude logic moved here (stream-json parser + hijack guard)
  codex.js              `codex exec` non-interactive + its event parser
  agy.js                `agy --print` + its parser
  api.js                generic OpenAI-compatible streaming HTTP client (web-search mode)
settings.js             server-side secret store: readSettings()/writeSettings() -> .secrets.json
server.js               + GET/POST /settings; /ai-research gains optional &provider= override
js/settings.js (browser) Settings "AI Providers" card (keys, cascade order, status, override)
```

`buildPrompt` stays the single shared prompt builder (re-exported via `base.js`),
so every provider asks the same question.

## Provider interface

Each provider module exports an object implementing:

```
{
  id: string,                 // 'claude' | 'codex' | 'agy' | 'api'
  label: string,              // human label for the UI
  webCapable: boolean | (settings) => boolean,  // only true ones join the cascade
  isAvailable(settings) -> Promise<boolean>,     // CLI present+authed, or API key set
  run(symbol, context, onText, opts) -> Promise<{ text, durationMs }>  // typed-error .code
}
```

- `run` streams via `onText(delta)` and resolves with the authoritative full text,
  mirroring the current `runResearch` contract.
- Typed error `.code` taxonomy is shared across providers:
  `cli_missing`, `not_authenticated`, `timeout`, `rate_limited`, `exit_<n>`,
  `no_output`, `busy`, plus a new `not_web_capable` (provider excluded from a
  research cascade) and `all_providers_exhausted` (orchestrator-level).
- Fall-through happens only on **capacity** failures
  (`rate_limited`, `not_authenticated`, `cli_missing`, `busy`); a genuine content
  error from an available provider stops the cascade and surfaces.

## Orchestration (`runResearch`)

`runResearch(symbol, context, onText, opts)` keeps its exact signature. New
behavior:

1. Load settings (`settings.readSettings()`); resolve cascade order
   (default `['claude','codex','agy','api']`, free-local-first).
2. If `opts.provider` is set, use only that provider (manual override); else build
   the cascade list.
3. Filter to providers that are `webCapable` AND `isAvailable(settings)`.
4. Try each in order: on success resolve `{ text, durationMs, provider: id }`; on a
   capacity failure, record the reason and continue; on a content error, reject.
5. If the list is empty or every provider failed for capacity reasons, reject with
   `all_providers_exhausted` (message lists each provider tried + why skipped).
6. `MAX_CONCURRENT` (2) global in-flight guard is preserved at the orchestrator
   level.

## The generic API provider (`api.js`)

- One **OpenAI-compatible** Chat Completions streaming client: configurable
  `apiBaseUrl`, `apiModel`, and `apiKey` from the secret store.
- Covers OpenRouter, OpenAI, and Perplexity directly; Anthropic/Google models via
  OpenRouter. Default recommended config: **OpenRouter** base URL with an
  `:online` model (web search across all routed models).
- `webCapable` returns true only when configured in a web-search mode
  (OpenRouter `:online` / Perplexity `sonar`); otherwise the provider reports
  `not_web_capable` and is excluded from the research cascade.
- Streams SSE `data:` chunks -> `onText(delta)`; final text = concatenated content;
  maps HTTP 401 -> `not_authenticated`, 429 -> `rate_limited`, other non-2xx ->
  `exit_<status>`; honors the same per-run timeout.
- The existing stubbed `perplexityKey` is migrated into the new store as a valid
  `api` configuration (Perplexity base URL + a `sonar` model).

## Settings store + endpoints

- `settings.js` (server): `readSettings()` / `writeSettings(patch)` persisting to
  **`.secrets.json`** (added to `.gitignore`). `FMP_API_KEY` env var is still
  honored as a fallback when the store has no FMP key (back-compat).
- `GET /settings` returns **non-secret** config only:
  `{ providers: { claude:{available,webCapable}, codex:{...}, agy:{...}, api:{...} },
     cascadeOrder, apiBaseUrl, apiModel, configured: { api, fmp } }`.
  Never returns a key value.
- `POST /settings` accepts `{ apiKey?, apiBaseUrl?, apiModel?, fmpKey?,
  cascadeOrder? }`, validates, writes server-side, returns the same non-secret
  shape as `GET`. A key is cleared by sending an empty string.
- `/ai-research` query contract stays minimal: `symbol`, `fresh`, `model`, and a
  new optional `provider` (validated against the known provider ids). **No secret
  ever travels in a query string.**
- Cache key gains a provider/prompt-version suffix so switching providers does not
  serve another provider's cached report
  (`airesearch-v2-<PROVIDER>-<SYM>`).

## Browser Settings UI

- New "AI Providers" card in the Settings page:
  - API key input (write-only; shows "configured ✓" not the value), API base URL +
    model inputs, FMP key input (same write-only treatment).
  - Per-provider status row (available / web-capable) from `GET /settings`.
  - Cascade order control and a per-run provider override selector near the AI
    Research panel.
- Follows the existing Settings-input pattern (`js/alerts.js` save handlers) but
  POSTs to `/settings` instead of `dbSet`, and never reads a key back.

## Web-search handling

- `claude` -> `webCapable: true` (built-in WebSearch, verified in Part 1).
- `codex` / `agy` -> web-enablement flag/behavior **verified live during
  implementation** (a capability probe + captured fixture, mirroring Part 1's
  stream-json fixture). If a CLI cannot be reliably web-enabled, set
  `webCapable: false` and exclude it from the research cascade. Document the exact
  flags found.
- `api` -> `webCapable` true only in a web-search mode (see above).

## Error handling

Typed `.code`s map to user-facing SSE `error` messages (extends Part 1's table):
- existing: `cli_missing`, `not_authenticated`, `timeout`, `rate_limited`,
  `exit_<n>`, `no_output`, `busy`.
- `not_web_capable` -> internal only (provider filtered out of cascade; not shown).
- `all_providers_exhausted` -> "No AI provider could run this research right now:
  <per-provider reasons>." with actionable hints (log in / add a key / wait for
  reset).

## Testing

Offline unit/server tests (stubbed spawn + stubbed fetch, no real CLI/network):
- Provider interface conformance: each provider exposes the required shape.
- Orchestrator cascade: falls through on `rate_limited`, stops on first success,
  respects `opts.provider` override, rejects `all_providers_exhausted` when empty,
  excludes non-`webCapable` providers.
- `settings.js`: write→read round-trip; `GET /settings` shape **never** contains a
  key value (explicit assertion); `FMP_API_KEY` env fallback honored.
- Each provider parser maps a captured fixture (claude stream-json — reuse;
  codex/agy/api — new fixtures) to the expected normalized text + deltas.
- `server.js`: `/settings` GET/POST happy path + key-never-echoed assertion;
  `/ai-research?provider=bogus` -> 400.

Manual / live gates (not unit tests):
- Codex/agy web-search capability probe; capture fixtures; record exact flags.
- One real cascade run with claude forced to fall through (e.g. unavailable) to a
  configured API provider, streaming a cited report.

## Risks / open items

- **codex/agy web search is unverified.** Resolution: a live probe is the first
  implementation task; a CLI that cannot web-search is marked
  `webCapable: false` and excluded (consistent with the locked "web-capable only"
  decision). The slice still ships value via claude + the API provider even if
  both local CLIs fail the probe.
- **codex/agy auth model** (subscription vs API key) and whether `cleanEnv()` must
  be adjusted per CLI — determined during the probe; each provider owns its env
  handling in its module.
- **Secret store on disk.** `.secrets.json` is gitignored and file-permissioned by
  the OS user; this is a personal/self-hosted app, acceptable for the threat
  model. Never logged, never returned by `GET`.
- **Cache correctness.** Bumping to `airesearch-v2-<PROVIDER>-<SYM>` avoids serving
  one provider's report for another; a prompt change should bump the version again.

## Reuse note (future)

The Telegram bot (Part 4) imports `runResearch` unchanged and gets the full
cascade for free. Part 3 (UI redesign) inherits the new Settings "AI Providers"
card markup; that is why Part 2 lands first.
