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

## Next up (see PLAN_NEXT.md for the full brief)
- [ ] Feature A: real-time background alert polling (poller + channel dispatch + settings).
- [ ] Feature B: optional paid fundamentals fallback (FMP via FMP_API_KEY env var).
      Remember to broaden the source==='yahoo-quoteSummary' checks in js/data.js (:144, :383).

## Later / future
- Anchor the multi-year financial trend charts to real data (Yahoo gives TTM only — needs a
  fundamentals-timeseries source).

## Notes
- Live fundamentals need a local Chrome (channel:'chrome'); falls back to estimates otherwise.
- `npm test` is offline; `npm run test:e2e` needs Chrome.
