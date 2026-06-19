# CHECKPOINT — ARYA'S Stocks Pro

## NEXT SESSION: read PLAN_NEXT.md first
Two features to build next: (A) real-time background alert polling and (B) optional paid
fundamentals fallback. Full step-by-step brief, file anchors, gotchas, and verify recipes are
in **PLAN_NEXT.md**. User rules: no GitHub PR, never push to main, continue on branch
`upgrade/site-overhaul`, commit + push each feature.

## State (all DONE, committed + pushed on upgrade/site-overhaul)
- Foundation + Batches 0-5 complete: live Yahoo fundamentals, SSRF lockdown, modular js/ split,
  cache.js + session persistence + rate-limit queue, /healthz + /yf-status, email hardening,
  graceful shutdown, test harness (18 tests green), a11y + redesign, real financials in modules,
  search autocomplete, sortable watchlist, firing target/stop alerts.
- 8 commits on the branch (foundation + Batch 0-5 + docs). Working tree clean.

## Verify commands
- `npm test` (offline, 12) and `npm run test:e2e` (Chrome, 6). Both green.
- Live browser checks: spawn `PORT=3000 node server.js` + playwright-core channel:'chrome',
  run with dangerouslyDisableSandbox for network; waitUntil:'commit' + sleep.

## Key gotchas for next session
- Broaden the two hardcoded `source === 'yahoo-quoteSummary'` checks (js/data.js:144 and :383)
  so an 'fmp' fallback source counts as live (Feature B).
- Telegram delivery needs api.telegram.org added to PROXY_ALLOWED_HOSTS in server.js (Feature A).
- Yahoo 429-throttles; .cache/ persists fundamentals + session. sql.js wasm fails in headless (ok).
