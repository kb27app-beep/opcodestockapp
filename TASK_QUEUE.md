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

## Next up
- (none — both planned features A and B are complete.)

## Later / future
- Anchor the multi-year financial trend charts to real data (Yahoo gives TTM only — needs a
  fundamentals-timeseries source).

## Notes
- Live fundamentals need a local Chrome (channel:'chrome'); falls back to estimates otherwise.
- `npm test` is offline; `npm run test:e2e` needs Chrome.
