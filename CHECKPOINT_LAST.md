# CHECKPOINT — ARYA'S Stocks Pro

## STATUS: Part 2 multi-provider AI engine (v1.7.0) — DONE, tested, reviewed

Branch `upgrade/site-overhaul`. Engine generalized from claude-only to a provider cascade.
All committed (latest: review fixes `0dc5f51`). NOT pushed yet.

## What shipped this session
1. **Brainstorm → spec → plan** for "generalize providers" (`docs/superpowers/specs|plans/2026-06-20-providers*`).
2. **Live probe**: `codex` and `agy` both web-search. Findings + fixtures saved
   (`docs/superpowers/notes/2026-06-20-codex-agy-probe.md`, `tests/fixtures/{codex-stream.jsonl,agy-stream.txt}`).
3. **Engine (Tasks 1–8)** — framework-agnostic Node, ports straight into a Next.js API route:
   - `providers/base.js` (interface + buildPrompt/cleanEnv/helpers), `providers/claude.js`
     (refactor, back-compat preserved), `providers/codex.js`, `providers/agy.js`, `providers/api.js`
     (OpenAI-compatible SSE, web-mode gating, cross-chunk buffering).
   - `settings.js` — gitignored `.secrets.json` store; `publicView` never leaks a key value;
     `FMP_API_KEY` env still honored.
   - `ai-research.js` — cascade orchestrator (`claude→codex→agy→api`, capacity-only fall-through,
     web-capable-only filter, manual `provider` override). Signature unchanged; `_spawn` seam kept.
4. **Adversarial review** (3 lenses, haiku): confirmed no secret leak; fixed CAPACITY drift,
   added `api.run` fast-fail + `webOf` guard + 4 edge tests. (Caught + rejected 2 false-positive
   "critical" findings — verified against the code.)

## Verify
- `npm test` **55 green**, `npm run test:e2e` **9 green**.
- Built largely via ultracode workflows: a haiku build-fan-out (4 modules + verify) and a haiku
  3-lens review-fan-out; sequential integration + all fixes done on the main loop.

## Build decisions this session (by the user)
- **Merge two projects**: adopt external Next.js/shadcn app `bj1960-del/stock-research-app` as the
  NEW frontend; port this engine (+ alerts, proxy) into it. This REPLACES the old "Part 3 UI redo".
  Memory: `merge-nextjs-frontend.md`.
- **Sequencing**: finish the framework-agnostic engine (Tasks 1–8) now; **hold** the vanilla-UI
  tail (server `/settings` routes + Settings card) since the merge reimplements them in React.

## Next action
- **Push** `upgrade/site-overhaul` if desired (engine is a clean stopping point).
- **Start the merge** (the new "Part 3"): brainstorm how to fold this engine + alerts + Yahoo proxy
  into the Next.js app (API routes / server actions), then Part 4 = Telegram bot (imports `runResearch`).
- Deferred-from-spec (do during the merge, not on the buildless app): `GET/POST /settings`,
  cache-key v2 (`airesearch-v2-<provider>-<sym>`), provider `&provider=` override + `friendlyError`
  cases, Settings "AI Providers" UI. All listed in `docs/superpowers/plans/2026-06-20-providers.md`
  Tasks 9–10.
