# RESUME STATE — for ultracode session

Read this first, then `CHECKPOINT_LAST.md`, the spec/plan under `docs/superpowers/`, and the
memory file `telegram-bot-goal.md`. This file is the single handoff for picking the work back up.

## Where things stand (2026-06-20)

Branch: `upgrade/site-overhaul`. Last commit: `c21478c` "Feature: on-demand AI Research panel
(claude -p, streamed) + fixes". **Committed, NOT pushed.**

Tests: `npm test` 24 green, `npm run test:e2e` 9 green. App runs via `node server.js` /
`npm start` on **http://localhost:3000** only (it serves both the page and the /yf + /ai-research
proxy). Do NOT open the app on any other port — it has no proxy there.

## The big picture (3-part plan, decided with the user)

The user wants, eventually, a self-hosted **US-market Telegram bot** (daily/hourly/on-demand)
that reuses a shared AI engine. Agreed build order is a vertical slice first, then generalize:

1. ✅ **DONE — AI Research slice**: on-demand `claude -p` streamed research panel for one US stock.
2. ⬜ **NEXT — Generalize providers**: add codex / agy / Ollama / manual API keys
   (OpenRouter, OpenAI, Anthropic API, Google, plus market-data keys) behind the same engine
   interface. Use local CLIs' free limits first, fall back to API keys.
3. ⬜ **UI redo + the user's theme** (clean redesign).
4. ⬜ **Telegram bot** (reuses `ai-research.js` `runResearch`).

## What was built in part 1 (so you don't re-derive it)

- `ai-research.js` (server-side, HTTP/Telegram-agnostic — THIS is what the bot will import):
  - `buildPrompt(symbol, context)` — US-equity report prompt, 7 sections.
  - `parseStreamJsonLine(line)` -> `{kind:'delta'|'final'|'rate_limited'|'error', text}` | null.
  - `runResearch(symbol, context, onText, opts)` -> `{text, durationMs}`. opts:
    `{model='sonnet', timeoutMs=240000, _spawn}`. Typed error `.code`s: cli_missing,
    not_authenticated, timeout, rate_limited, exit_<n>, no_output, busy. MAX_CONCURRENT=2.
- `server.js` `GET /ai-research?symbol=SYMBOL[&fresh=1][&model=...][&price=&pe=&sector=&mcap=&name=]`
  — SSE: `data:{delta}` ... `event: done|error`. Symbol regex `^[A-Z.]{1,8}$`. Cache key
  `airesearch-v1-<SYM>`, 60-min TTL via `cache.js` (`cache.read(key,ttlMs)`/`cache.write`).
  Offline test seam: `AI_RESEARCH_FAKE=1`.
- `js/ai-research.js` (browser): `startAiResearch(force)`, `renderAiMarkdown(md)`, EventSource
  client; button `#aiResearchBtn`, panel `#aiResearchPanel` in index.html; styles in styles.css;
  button enabled in `js/data.js` searchStock success path.

## HARD-WON GOTCHAS (do not relearn these the hard way)

1. **Subscription vs paid tokens**: `claude -p` runs on the user's Claude subscription. The
   engine's `cleanEnv()` strips `ANTHROPIC_API_KEY`/`ANTHROPIC*` to FORCE subscription use.
   The `total_cost_usd` the CLI reports is API-equivalent accounting, not a real charge.
2. **DO NOT isolate via `CLAUDE_CONFIG_DIR`** — a fresh config dir breaks auth ("Not logged in");
   the subscription credentials live in `~/.claude`. Keep the real config dir.
3. **Skill/workflow hijack**: headless `claude -p` otherwise picks up the user's global
   `~/.claude` skills/CLAUDE.md and forks a background "deep-research" workflow, returning
   "I'll notify you when done" with NO report. Fixed with
   `--disallowedTools Skill Task Workflow TodoWrite` + `--append-system-prompt` "answer inline".
   Keep these whenever spawning claude for synchronous output. `SlashCommand` is NOT a real
   tool name (causes a warning) — do not add it.
4. **Cost**: default research model is `sonnet`; `?model=haiku` works well and is much cheaper on
   quota (live AAPL haiku run = full 7-section cited report in ~81s). User wants cheapest —
   consider making haiku the default in part 2.
5. **stream-json shape**: text = `{type:'stream_event',event:{type:'content_block_delta',
   delta:{type:'text_delta',text}}}`; final authoritative text = `{type:'result',
   subtype:'success',result}`; watch `{type:'rate_limit_event'}` for out_of_credits.
6. **App port**: always 3000. server.js auto-opens a tab only on default launch; test/scratch
   spawns set PORT and must not. Don't leave orphaned `node server.js` around.

## Decisions made (2026-06-20, by the user)

- ✅ Default research model is now **haiku** (cheapest quota). `?model=sonnet` for deeper reports.
  Done in commit `2158487`.
- ✅ Branch **pushed** to `origin/upgrade/site-overhaul` (latest pushed: `2158487`).
- ✅ Build order: **Part 2 (providers) first, THEN Part 3 (UI redo).** User asked about doing them
  in parallel — see note below; the recommendation is sequential 2 -> 3.

## NEXT UP (do these in order)

### Part 2 — Generalize providers (DO FIRST)
Goal: the AI engine should use **local CLIs' free limits first** (claude already done; add
`codex`, `agy`, optionally `ollama`), then fall back to **manual API keys** the user enters
(OpenRouter, OpenAI, Anthropic API, Google, plus any market-data keys). Keep `runResearch`'s
signature; add a provider strategy inside `ai-research.js` (or a sibling module) selected by an
option/setting. API keys are entered in the Settings UI and stored server-side (NEVER returned to
the client, NEVER in query strings) — follow the existing `FMP_API_KEY` server-only pattern and
the perplexityKey settings-input pattern. All three local CLIs are installed
(`claude` ~/.local/bin, `codex` /usr/local/bin, `agy` ~/.local/bin, `ollama` /usr/local/bin).
Start by brainstorming -> spec -> plan -> subagent workflow.

### Part 3 — UI redo + the user's theme (DO AFTER Part 2)
Clean redesign following the user's theme (ASK them to describe/show the theme — current is
"editorial fintech" / cream). Incorporates the new provider/key settings from Part 2.

### Why NOT parallel
Part 2 adds provider + API-key controls to the **Settings UI** and touches the AI panel; Part 3
rewrites `index.html` / `styles.css` / `js/*` broadly. Running both at once will conflict in those
shared files. Do Part 2 first so Part 3 redesigns a UI that already includes the new settings.
(If you must parallelize, isolate Part 3 to pure visual/CSS + layout files and freeze Settings
markup until Part 2 lands — risky; sequential is cleaner.)

## How to resume in ultracode

1. Read this file + `CHECKPOINT_LAST.md` + `docs/superpowers/specs|plans/2026-06-20-ai-research-*`
   + memory `telegram-bot-goal.md`.
2. Confirm green: `npm test` (24) and `npm run test:e2e` (9). App on http://localhost:3000 only.
3. Start **Part 2**: brainstorming skill -> spec -> writing-plans -> subagent-driven Workflow.
   Cost rule (standing): haiku for mechanical tasks, sonnet only where genuinely needed, NO opus.
4. Then **Part 3** (UI redo) — ask the user for their theme first.
