# CHECKPOINT — ARYA'S Stocks Pro

## STATUS: AI Research panel (v1.6.0) built, tested, verified live — ready to commit

Branch `upgrade/site-overhaul`. First slice of the AI layer is done end to end.

## What shipped this session
1. **Port/process cleanup + server hardening** (`server.js`): killed orphaned `node server.js`
   instances; auto-open browser only on default launch; EADDRINUSE exits cleanly. Use
   http://localhost:3000.
2. **SQLite wasm pin** (`js/state.js`): locateFile pinned to sql.js@1.10.2 (was a mismatched
   sql.js.org build → LinkError). Proxy-unreachable error now actionable (`js/data.js`).
3. **AI Research panel (v1.6.0)** — on-demand `claude -p` streamed research for US stocks:
   - `ai-research.js` (engine, reusable by the Telegram bot): buildPrompt, parseStreamJsonLine,
     runResearch (spawn claude, stream-json deltas, typed errors, 240s timeout, max 2 concurrent).
   - `server.js` `GET /ai-research` SSE endpoint + cache (`airesearch-v1-<SYM>`, 60 min).
   - `js/ai-research.js` + index.html/styles.css: button, streamed markdown panel, Re-run.
   - Runs on the Claude **subscription** (strips ANTHROPIC_API_KEY). Default model sonnet;
     `?model=haiku` to save quota.
   - **Hijack guard**: `--disallowedTools Skill Task Workflow TodoWrite` + inline directive so
     headless claude answers inline instead of forking a deep-research workflow.

## Verify
- `npm test` 24 green, `npm run test:e2e` 9 green.
- Live: real AAPL report (haiku) streamed all 7 sections + cited links to `event: done` in ~81s;
  cached replay 0ms. Server running on :3000.

## Next action / decisions for human
- Commit pending (per rules): new `ai-research.js`, `js/ai-research.js`, `docs/`, `tests/fixtures/`;
  modified `server.js`, `js/{data,state}.js`, `index.html`, `styles.css`, `tests/*`, `ARYA.md`.
  Push to `upgrade/site-overhaul` after commit if desired.
- Decide default research model: sonnet (quality) vs haiku (cheaper quota). Currently sonnet.

## Later (planned next subprojects)
- Generalize providers: codex / agy / Ollama / API keys (OpenRouter/OpenAI/Anthropic/Google).
- UI redo + theme.
- Telegram bot (daily/hourly/on-demand, US market) — reuses `ai-research.js` runResearch.
