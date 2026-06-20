# CHECKPOINT — ARYA'S Stocks Pro

## STATUS: Features A and B both DONE
Both planned features are complete on branch `upgrade/site-overhaul`. Feature A (v1.4.0,
real-time alert polling) and Feature B (v1.5.0, paid fundamentals fallback) are implemented,
tested, and ready. Commit + push Feature B next (see below).

User rules: no GitHub PR, never push to `main`, continue on `upgrade/site-overhaul`,
commit + push each feature.

## Feature B (v1.5.0) — what was built this session
- New `fundamentals-fallback.js`: `getFromProvider(symbol)` (FMP profile/ratios-ttm/income/
  cash-flow/balance-sheet) + pure `normalizeFmp(...)` mapping to the exact yahoo-auth.normalize
  shape with `source:'fmp'`. Debt/equity ratio ×100 to match Yahoo's percent convention. Key
  read from `process.env.FMP_API_KEY` only; `isConfigured()` helper.
- `server.js` `/yf-fundamentals`: on Yahoo throw, if `FMP_API_KEY` set, try FMP, cache as
  `fund-<sym>`, serve; stale cache as last resort; else original 503/429. `/yf-status` now
  reports `fallbackConfigured` (boolean, never the key).
- `js/data.js`: added `isRealSource()` (treats `yahoo-quoteSummary` + `fmp` as live); replaced
  the two hardcoded `source === 'yahoo-quoteSummary'` checks (analyze status line + extract).
- Tests: +2 unit (`normalizeFmp` shape/×100/null-degrade), `/yf-status` asserts
  `fallbackConfigured:false`. `npm test` 15 green, `npm run test:e2e` 8 green.
- Docs: ARYA.md changelog v1.5.0, TASK_QUEUE.md updated.

## Next action
`git add -A && git commit` Feature B (footer: Co-Authored-By: Claude Opus 4.8
<noreply@anthropic.com>) and `git push origin upgrade/site-overhaul`.

## Verify commands
- `npm test` (offline, 15) and `npm run test:e2e` (Chrome, 8). Both green.
- FMP path needs a real `FMP_API_KEY` + a forced Yahoo failure to exercise live; unset = feature off.
