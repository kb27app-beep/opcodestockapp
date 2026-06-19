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

## Open / future
- Anchor the multi-year financial trend charts to real data (Yahoo gives TTM only — would
  need a fundamentals-timeseries source).
- Background alert polling (currently evaluated on watchlist refresh).
- Optional paid fundamentals fallback (FMP/Alpha Vantage) for machines without local Chrome.

## Notes
- Live fundamentals need a local Chrome (channel:'chrome'); falls back to estimates otherwise.
- `npm test` is offline; `npm run test:e2e` needs Chrome.
