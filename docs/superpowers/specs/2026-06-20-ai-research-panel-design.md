# Spec: On-demand AI Research panel (claude -p, streamed)

Date: 2026-06-20
Branch: upgrade/site-overhaul
Status: Approved (design) — ready for implementation plan

## Goal

Add an on-demand "AI Research" panel that, for the currently-loaded US stock,
runs the local `claude` CLI (`claude -p`) with web search and streams a full
research report into the UI. This is the first vertical slice of a larger AI
layer; it is intentionally built as a reusable server-side module so a future
Telegram bot can call the exact same engine.

## Context

- The app is a browser front end (`index.html` + ordered `js/*.js` modules) served
  by a Node `server.js` (default port 3000) that also proxies Yahoo Finance.
- Browser JS cannot spawn processes; only `server.js` can run `claude -p`. Therefore
  the AI capability is a new server-side endpoint, and the browser is a client.
- Existing "Perplexity" hook (`js/analysis.js:enhanceWithPerplexity`) is a stub; there
  is no real AI calling today. The 10 analysis modules are template/heuristic based and
  are left untouched by this slice.
- Verified on this machine: `claude` 2.1.183 at `~/.local/bin/claude`; `claude -p`
  runs headlessly using the logged-in session (smoke test returned in ~3s). `codex`,
  `agy`, `ollama` also present but OUT of scope for this slice.
- Existing infra to reuse: `cache.js` (disk/memory cache with TTL), the SSE-free request
  patterns in `server.js`, the loader UI pattern in `js/data.js`.

## Scope

In scope:
- One "AI Research" button for the current US stock.
- Streamed, web-searched full research report rendered as markdown in a panel.
- 60-minute result caching with a visible "Re-run" control.
- claude CLI only.

Out of scope (later subprojects, by design):
- codex / agy / Ollama / API-key providers (OpenRouter, OpenAI, Anthropic API, Google).
- UI redesign / theming.
- Telegram bot. (The `ai-research.js` module boundary is what lets these slot in later.)

## Architecture

Three units, each independently testable:

1. `ai-research.js` (NEW, server-side, no HTTP/Telegram knowledge)
   - `buildPrompt(symbol, context) -> string` — pure; produces the US-market report prompt.
   - `runResearch(symbol, context, onText) -> Promise<{ text, durationMs }>` — spawns the
     CLI, parses streamed output, invokes `onText(delta)` per chunk, resolves with the full
     text. Throws typed errors (`cli_missing`, `not_authenticated`, `timeout`, `exit_<n>`).
   - Exposes `MAX_CONCURRENT` in-flight guard (<=2) and a 240s per-run timeout.

2. `server.js` (MODIFY) — new route `GET /ai-research?symbol=SYMBOL`
   - Validates `symbol` against `^[A-Z.]{1,8}$` (else 400).
   - If a fresh cached report exists (`airesearch-<SYMBOL>`, TTL 60 min) and `?fresh=1`
     is NOT set: stream it back immediately, flagged as cached, then `done`.
   - Else set SSE headers (`text/event-stream`), call `runResearch(...)`, forward each
     delta as an SSE `data:` event, cache the final text, emit a final `done` event with
     `{ cached:false, durationMs }`. On thrown error emit an `error` event then close.

3. Browser (NEW `js/ai-research.js` + small `index.html`/`styles.css` additions)
   - "AI Research" button near the stock header; disabled until a US stock is loaded.
   - Opens `EventSource('/ai-research?symbol=...')`; appends streamed text into a panel,
     renders markdown progressively, shows elapsed time, and a "Re-run" button
     (adds `&fresh=1`). Renders typed errors with actionable text.

Data flow:
`button -> EventSource(/ai-research?symbol) -> server -> runResearch -> spawn claude -p
 (stream-json) -> deltas -> SSE -> panel (markdown)`.

## The claude invocation

```
spawn('claude', ['-p', prompt,
  '--output-format','stream-json','--include-partial-messages','--verbose',
  '--model', model,                       // default 'sonnet' (cost/limit control)
  '--allowedTools','WebSearch','WebFetch',
  '--disallowedTools','Skill','Task','Workflow','TodoWrite',
  '--append-system-prompt','Respond directly and inline ... no skills/subagents/workflows.',
  '--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
  '--exclude-dynamic-system-prompt-sections'],
  { cwd: os.tmpdir(), env: cleanEnv })
```

- **Skill/workflow-hijack guard (verified, critical):** the local CLI loads the user's global
  `~/.claude` config (CLAUDE.md + superpowers skills). Without guards, headless `claude -p`
  reaches for the `Skill`/`Task`/`Workflow` tools and forks a background "deep-research"
  workflow, so `-p` returns "I'll notify you when done" and never streams the report.
  `--disallowedTools Skill Task Workflow TodoWrite` plus an inline directive keeps the run
  synchronous and inline. NOTE: we cannot isolate via `CLAUDE_CONFIG_DIR` (a fresh dir breaks
  auth — the subscription credentials live in the config dir), so we keep the real config dir
  and constrain behavior with tool flags instead.
- **Subscription, not paid tokens:** `cleanEnv` strips `ANTHROPIC_API_KEY`/`ANTHROPIC*`, forcing
  the CLI to use the logged-in subscription session rather than billing a paid API key.

- Args array only — never a shell string. `symbol` is regex-validated upstream. No
  shell-injection surface.
- **Isolated environment (critical, verified):** running `claude -p` from the project dir
  picked up the project CLAUDE.md, fired SessionStart hooks 4x (injecting unrelated skill
  text), loaded every MCP server, defaulted to opus, and cost ~$0.12 for a trivial prompt.
  To keep research clean, cheap, and deterministic: run with `cwd: os.tmpdir()` (no project
  `.claude`), `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` (load no MCP servers),
  `--exclude-dynamic-system-prompt-sections` (drop cwd/env/memory/git sections), and a
  `cleanEnv` that strips `CLAUDE*`/`ANTHROPIC*` injected context vars while keeping PATH/HOME.
- **Model defaults to `sonnet`** for cost/limit control (opus is overkill for this and the
  account shows `out_of_credits` for overage). Override via `?model=` later.
- Web search enabled; all other tools implicitly denied (print mode auto-denies without
  prompting). No `--dangerously-skip-permissions`.
- **stream-json parsing (verified event shapes):**
  - text delta: `{type:'stream_event', event:{type:'content_block_delta',
    delta:{type:'text_delta', text:'...'}}}` -> emit `delta.text` via `onText`.
  - final text (authoritative): `{type:'result', subtype:'success', is_error:false,
    result:'<full text>', duration_ms, total_cost_usd}` -> resolve with `result.result`
    (fall back to concatenated deltas if absent).
  - errors: `{type:'result', is_error:true, subtype:'error_max_turns'|...}` -> typed error.
  - `{type:'rate_limit_event', rate_limit_info:{status, resetsAt, overageDisabledReason}}`
    -> if status !== 'allowed' or `out_of_credits`, surface a `rate_limited` error with the
    reset time.
  - All other event types (system/hook/assistant/stream_event message_start etc.) ignored.
  A captured JSONL fixture (saved during Task 1) is the unit-test input.
- Process killed (SIGTERM then SIGKILL) at 240s -> `timeout` error.

## Prompt (shape)

System/instruction content:
- Role: senior US-equity research analyst.
- Produce a structured report with sections: (1) News & catalysts (recent, dated),
  (2) Latest earnings + next earnings date + guidance, (3) Analyst sentiment & price
  targets, (4) Bull case, (5) Bear case, (6) Key risks, (7) Bottom-line verdict.
- Use web search for anything time-sensitive; cite source + date per factual claim.
- Ground with the price/context the app already has (current price, day change, P/E,
  market cap, sector) passed in `context`.
- US market framing; output in markdown.

## Error handling

Typed errors from `runResearch` map to user-facing SSE `error` messages:
- `cli_missing` -> "Claude CLI not found on the server host."
- `not_authenticated` -> "Claude CLI not logged in — run `claude` once to authenticate."
- `timeout` -> "Research timed out after 240s. Try again or narrow the request."
- `rate_limited` -> "Claude usage limit reached (resets at <time>) — try later." (from
  `rate_limit_event` / `result.is_error` with an out-of-credits reason).
- `exit_<n>` / parse failure -> generic "AI research failed (details in server log)."
The panel never renders blank; a button returns to the idle state for retry.

## Testing

- Unit (offline, no real CLI):
  - `buildPrompt` includes the symbol and all 7 section headers; US framing present.
  - `runResearch` parses a captured stream-json fixture into the expected full text and
    fires `onText` deltas in order. CLI spawn is stubbed/injected so `npm test` stays
    offline and fast.
- Server:
  - `/ai-research?symbol=@@` -> 400.
  - `/ai-research?symbol=NVDA` (CLI stubbed) -> correct SSE content-type + a `done` event.
- Manual / e2e:
  - Real `claude -p` run on NVDA streams into the panel and renders a cited report.

## Risks / open items

- stream-json partial-delta field name must be verified against a live capture (handled in
  step 1 of implementation via a saved fixture).
- Long runs hold an SSE connection open; the 240s timeout + concurrency guard bound this.
- Caching key is per-symbol only (not per-prompt-version); a prompt change should bump a
  cache-version suffix to avoid serving stale-format reports.

## Reuse note (future)

`ai-research.js` deliberately excludes HTTP and Telegram concerns. The future provider
abstraction (codex/agy/API keys) becomes an internal strategy inside `runResearch` or a
sibling module with the same signature; the Telegram bot imports `runResearch` directly.
