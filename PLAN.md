# PLAN — Parallel Improvement Batches

Goal: a set of medium-sized, mostly file-disjoint batches that can be orchestrated in
parallel. The only heavily shared file is `app.js`; ownership and waves below are designed
to avoid collisions.

## File ownership map
| File | Owned by |
|---|---|
| `server.js`, `yahoo-auth.js`, new `cache.js` | Batch 1 |
| new `tests/**`, `package.json` scripts only | Batch 2 |
| `styles.css`, static `index.html` markup | Batch 3 |
| `app.js` — analysis/render region | Batch 4 |
| `app.js` — search/watchlist/alerts region | Batch 5 |

## Wave structure (how to run in parallel)
- **Wave 1 — fully parallel, zero file overlap:** Batch 1, Batch 2, Batch 3.
- **Wave 2 — both touch `app.js`:** Batch 4 + Batch 5. They edit different functions, so run
  them in **separate git worktrees and merge** (low conflict), OR sequence 4 then 5. If we
  want them truly independent, do the optional `Batch 0` split first.
- **Batch 0 (optional prerequisite):** split `app.js` into modules (`db.js`, `data.js`,
  `analysis.js`, `watchlist.js`, `alerts.js`, `charts.js`, `ui.js`) loaded as ordered classic
  scripts. Makes Wave 2 collision-free at the cost of one sequential refactor up front.

---

## Batch 1 — Backend resilience & caching  (server.js, yahoo-auth.js, cache.js)
Medium. No `app.js`/`styles.css` overlap → safe in Wave 1.
- Persist Yahoo session (cookies + crumb) to `./.cache/` so server restarts reuse it instead
  of relaunching Chrome; refresh on expiry/401.
- Persist fundamentals to a disk cache (TTL) so repeats survive restarts.
- Serialize `/yf-fundamentals` through a small queue with a min-interval to avoid Yahoo 429s.
- Add `/healthz` + expose `yahoo-auth._state()` (alive, cacheSize, lastError) via an endpoint.
- Harden `/send-email`: stricter validation, per-IP throttle.
- Optional API-key fallback provider (FMP/Alpha Vantage) behind the same endpoint when no
  local browser is available.
- Graceful shutdown closes the browser.

## Batch 2 — Test & verification harness  (tests/**, package.json scripts)
Medium. New files only → safe in Wave 1.
- Unit tests (`node:test`) for pure logic: `resolveSymbol`, `getYahooSymbol`, `guessSector`,
  `estimatePE`, `fmtMcap`, and `yahoo-auth.normalize`. (Extract these into a tiny
  node-importable helper module so they're testable without a DOM.)
- Integration tests for endpoints: `/yf`, `/yf-search`, `/yf-fundamentals`, and the `/proxy`
  SSRF allowlist (assert 403 on private/metadata hosts, pass on Yahoo).
- A committed Playwright smoke/visual script: loads the app, asserts no literal `${`, checks
  the live-vs-estimated path, saves screenshots.
- `npm test` + `npm run test:e2e`.

## Batch 3 — Design system & accessibility  (styles.css, index.html)
Medium. No `app.js` logic → safe in Wave 1.
- a11y: ARIA roles on nav/tabs/switches, `aria-pressed`/`aria-live` on status+loader, labels on
  icon-only buttons, visible `:focus-visible` rings, skip-to-content, keyboard nav for nav
  items, `prefers-reduced-motion` fallback.
- UX: skeleton loaders for cards/charts, real empty states, toast-style status messages,
  a documented spacing/elevation scale.
- Deeper mobile pass (table overflow, top-bar wrap, sidebar backdrop) + a clean print
  stylesheet for PDFs.

## Batch 4 — Real financials in the 10 analysis modules  (app.js: analysis region)
Medium-large. Wave 2.
- Surface `state._fundamentals` through `extractAnalysisData` (ROE, margins, revenue,
  revenueGrowth, earningsGrowth, debtToEquity, beta, dividendYield, eps, priceToBook,
  forwardPE, freeCashflow).
- Rewrite `renderFullAnalysis`, `renderFinancialAnalysis`, `renderValuation`, `renderRisks`,
  `renderManagement`, `renderBuyDecision` to use real numbers; keep `(est.)` only where data
  is still synthetic. Be honest that Yahoo gives TTM (not a real 5-yr series) — label trend
  charts accordingly.

## Batch 5 — Search autocomplete + watchlist/alerts UX  (app.js: search/watchlist/alerts region)
Medium. Wave 2.
- Debounced typeahead using the existing `/yf-search` endpoint (keyboard-selectable dropdown).
- Watchlist: sortable/filterable columns, real fundamentals (PE, mcap) on refresh, persisted
  sort order.
- Alerts: actually evaluate rules against refreshed prices on an interval, dedupe, and log to
  Sent Alerts (currently configuration-only).

---

## Suggested orchestration
1. Run Wave 1 (Batches 1, 2, 3) in parallel — independent files.
2. Decide Batch 0: if yes, split `app.js` then run 4 + 5 in parallel cleanly. If no, run 4
   and 5 in worktrees and merge (or sequence them).
3. Re-run Batch 2's smoke/visual + endpoint tests after each wave as the gate.
