# TASK_QUEUE — ARYA'S Stocks Pro upgrade

## Done (branch: upgrade/site-overhaul, all phases committed + pushed)
- Foundation: real Yahoo field fixes, live fundamentals (yahoo-auth.js), SSRF lockdown,
  index.html split (styles.css/app.js), "editorial fintech" redesign.
- Batch 0: split app.js into js/ modules.
- Batch 1: backend resilience — cache.js, disk/session persistence, rate-limit queue,
  /healthz + /yf-status, email hardening, graceful shutdown.
- Batch 2: test harness — tests/ (node:test + Playwright), npm test / test:e2e, 18 tests green.
- Batch 3: accessibility + design-system polish, mobile backdrop, print styles.
- Batch 4: real financials wired into Financial Breakdown, Valuation, Full Analysis.
- Batch 5: search autocomplete, sortable watchlist, firing target/stop alerts.
- Feature A (v1.4.0): real-time background alert polling — unified dispatchAlert (push/email/
  telegram, whatsapp=unsupported), setInterval poller in main.js, Settings card, re-crossing
  re-arm, api.telegram.org added to SSRF allowlist. Tests: npm test 13, test:e2e 8. Committed + pushed.
- Feature B (v1.5.0): optional paid fundamentals fallback — new fundamentals-fallback.js (FMP),
  wired into /yf-fundamentals on Yahoo failure (gated on FMP_API_KEY), debt/equity ×100 unit fix,
  source checks broadened via isRealSource() in js/data.js, /yf-status reports fallbackConfigured
  (boolean). Tests: npm test 15, test:e2e 8. Committed + pushed.

- Part 1 AI Research (v1.6.0): on-demand claude -p streamed research panel + reusable
  `ai-research.js` engine. Committed + pushed.
- Part 2 AI engine (v1.7.0): generalized to a multi-provider cascade — providers/{base,claude,
  codex,agy,api}.js + settings.js secret store + orchestrator. codex+agy probed web-capable.
  Web-capable-only cascade, capacity-only fall-through, manual override. `npm test` 55, e2e 9.
  Committed (not yet pushed). Engine only — vanilla-UI tail held for the Next.js merge.

## Merge — DONE: Slice 1 (active repo is now ../smartinvest)
- **Merge Slice 1 (DONE, local-only)**: npm-workspaces monorepo `../smartinvest` — `apps/web`
  (external Next.js app) + `packages/ai-engine` (this engine). Streaming `/api/ai-research` (SSE)
  + `/api/settings` (server-side keys) wired into the analysis card + an AI Providers card. Engine
  42 tests, routes 6 tests, build green, live claude run verified. The deferred tail below is now
  SHIPPED in smartinvest: `/api/settings`, cache v2, `&provider=` override + `friendlyError`,
  AI Providers card. See smartinvest `CHECKPOINT`-equivalent in opcodestockapp/CHECKPOINT_LAST.md.
  REMOTE BLOCKER: env GITHUB_TOKEN can't create repos — user must create the GitHub repo, then push.

## Next up (in ../smartinvest)
- Slice 2: alerts. Slice 3: Yahoo proxy/cache/FMP resilience. Slice 4: theme.
- **Slice 5 — Telegram bot** as `apps/bot` (US market, daily/hourly/on-demand) reusing
  `@smartinvest/ai-engine` `runResearch`. Memory: `telegram-bot-goal.md`.

## Later / future
- Anchor the multi-year financial trend charts to real data (Yahoo gives TTM only — needs a
  fundamentals-timeseries source).

## Notes
- Live fundamentals need a local Chrome (channel:'chrome'); falls back to estimates otherwise.
- `npm test` is offline; `npm run test:e2e` needs Chrome.
