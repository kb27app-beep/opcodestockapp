# CHECKPOINT — ARYA'S Stocks Pro

## NEXT SESSION: Feature B remains (see PLAN_NEXT.md)
Feature A (real-time alert polling) is DONE, committed + pushed on `upgrade/site-overhaul`.
Only **Feature B — optional paid fundamentals fallback (FMP via FMP_API_KEY)** is left.
Full step-by-step brief, file anchors, gotchas, and verify recipes are in **PLAN_NEXT.md**.
User rules: no GitHub PR, never push to main, continue on branch `upgrade/site-overhaul`,
commit + push each feature.

## State
- Foundation + Batches 0-5 done.
- Feature A (v1.4.0) DONE: unified `dispatchAlert(message, channels)` in js/alerts.js
  (push/email/telegram; whatsapp=unsupported, never faked), `sendTelegramAlert` via `/proxy`,
  `activeAlertChannels()`; `evaluateWatchlistAlerts` now dispatches + re-arms on >1% re-crossing;
  setInterval poller in js/main.js (`startAlertPolling/stopAlertPolling/restartAlertPolling`);
  Settings card (Alerts → Delivery Channels) with `saveAlertPolling`; `api.telegram.org` added to
  `PROXY_ALLOWED_HOSTS` in server.js. Tests: npm test 13, test:e2e 8 (all green).

## Verify commands
- `npm test` (offline, 13) and `npm run test:e2e` (Chrome, 8). Both green.
- Live browser checks: spawn `PORT=3000 node server.js` + playwright-core channel:'chrome',
  run with dangerouslyDisableSandbox for network; waitUntil:'commit' + sleep. Run the screenshot
  script from inside the project dir (playwright-core resolves there, not /tmp).

## Key gotchas for Feature B
- Broaden the two hardcoded `source === 'yahoo-quoteSummary'` checks (js/data.js:144 and :383)
  so an 'fmp' fallback source counts as live.
- FMP debtEquityRatioTTM is a ratio (0.36) — multiply by 100 to match Yahoo's percent convention
  (UI does `d.debtToEquity/100`). Normalize to the exact yahoo-auth.normalize output shape.
- Yahoo 429-throttles; .cache/ persists fundamentals + session. sql.js wasm fails in headless (ok).
