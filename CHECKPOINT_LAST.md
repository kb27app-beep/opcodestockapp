# CHECKPOINT — ARYA'S Stocks Pro → SmartInvest

## STATUS: Merge Slice 1 — DONE (monorepo + engine port + streaming UI), local-only

**Active repo is now `../smartinvest`** (npm-workspaces monorepo), NOT this buildless app.
This `opcodestockapp` repo is the engine's origin + brainstorm/spec/plan history; it is frozen
at Part 2 (engine v1.7.0, `upgrade/site-overhaul`, 55 tests). All new work happens in smartinvest.

## smartinvest — what shipped this session (5 commits on `main`, NOT yet on GitHub)
1. **Monorepo bootstrap** — `apps/web` (the external Next.js app, git history dropped) +
   `packages/ai-engine` (this engine, name `@smartinvest/ai-engine`, CJS, subpath exports
   `./settings` `./cache`). Root npm workspaces. Engine **42 tests** green in-workspace.
2. **Engine** — added optional `context.instruction` passthrough in `buildPrompt` (powers the
   card's Focus selector). Otherwise lifted verbatim.
3. **Routes** (`apps/web/src/app/api/`):
   - `GET/POST /api/settings` — server-side keys, booleans-only public view, never leaks a key.
   - `GET /api/ai-research` — SSE streaming the real cascade; cache v2 `airesearch-v2-<prov|auto>-<SYM>`
     (60-min TTL), `AI_RESEARCH_FAKE` seam, symbol `^[A-Z.]{1,16}$` + provider validation,
     `friendlyError` mapping. `routes.test.mjs` = **6 integration tests** green.
4. **Frontend** — `analysis-card.tsx` rewired: provider select (from /api/settings), "AI Research"
   streams real reports via EventSource w/ progressive markdown + Re-run, Focus→instruction,
   heuristic kept as free "Quick snapshot", insecure localStorage LLM-key picker removed.
   New `ai-providers-card.tsx` (key entry + status badges), `lib/ai-markdown.ts`. Mounted in
   `research-dashboard.tsx`.
5. **Bundling fix** (real bug found + fixed): Turbopack rewrites the engine's `__dirname`, which
   silently broke disk-cache writes. Fixed by pinning absolute `SECRETS_PATH` + `AI_CACHE_DIR` in
   `next.config.ts` before routes load (+ `AI_CACHE_DIR` env override in `cache.js`,
   `serverExternalPackages`). Verified: seeded-cache read hits through the route in 0.26s.

## Verify (all green)
- Engine: `npm test -w @smartinvest/ai-engine` → **42**.
- Routes: `node --test apps/web/tests/routes.test.mjs` → **6** (boots Next dev, fake seam).
- Build: `npm run build -w web` → exit 0, "Compiled successfully" (NFT trace warning is cosmetic).
- **Live**: a real claude/haiku run streamed a genuine, dated, web-searched AAPL report through
  `/api/ai-research` (provider=claude, ~93s), and the cache hit on replay.

## BLOCKER (remote only — does not block local work)
- `gh repo create` fails: the env `GITHUB_TOKEN` (AryaVora621) lacks repo-creation scope
  (`Resource not accessible by personal access token`). smartinvest is committed locally but has
  **no GitHub remote yet**. User must create an empty repo (web UI or a token with `repo` scope),
  then `git -C ../smartinvest remote add origin <url> && git push -u origin main`.

## Next actions (later slices, per the merge plan)
- Slice 2: alerts. Slice 3: Yahoo proxy/cache/FMP resilience port. Slice 4: theme.
- Slice 5: Telegram bot as `apps/bot` (imports `@smartinvest/ai-engine` `runResearch`) — see
  memory `telegram-bot-goal.md`.
- Spec/plan for Slice 1 live in this repo: `docs/superpowers/specs/2026-06-21-merge-slice1-design.md`,
  `docs/superpowers/plans/2026-06-21-merge-slice1.md`.
