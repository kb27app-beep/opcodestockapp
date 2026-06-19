# HANDOFF PLAN — next session (read this first)

This is a self-contained brief for a fresh Claude session. Two features to build:
**(A) real-time background alert polling** and **(B) optional paid fundamentals fallback**.
Everything you need to start is here; the codebase is already modular and tested.

## Ground rules (from the user)
- **Do NOT create a GitHub PR** and **never push to `main`**.
- Work continues on branch **`upgrade/site-overhaul`** (already pushed; `main` is the old base).
- Commit each feature separately and `git push origin upgrade/site-overhaul`.
- Commit message footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Keep it cheap: implement inline yourself, no parallel agents/workflows.

## Project state (as of this handoff)
Buildless app. Layout:
- `index.html` (markup), `styles.css`, `js/{state,data,analysis,alerts,watchlist,report,main}.js`
  (ordered classic scripts, shared globals, `main.js` runs init in DOMContentLoaded — load LAST).
- `server.js` (HTTP + Yahoo proxy + endpoints), `yahoo-auth.js` (headless-Chrome fundamentals),
  `cache.js` (disk TTL cache), `tests/{unit.test.js,server.test.js,browser.e2e.js}`.
- Tests: `npm test` (offline unit+server, 12) and `npm run test:e2e` (Playwright browser, 6). All green.

### Verification recipe (use this, it works here)
- Syntax: `node -c <file>` on any js file/module.
- Live/browser checks: spawn `PORT=3000 node server.js`, drive with `playwright-core`
  `chromium.launch({channel:'chrome',headless:true})`, run Bash with
  `dangerouslyDisableSandbox: true` for outbound network. Use `waitUntil:'commit'` + a sleep
  (CDN/wasm stall `networkidle`/`domcontentloaded`).
- Screenshots: `page.screenshot({path:'/tmp/x.png'})` then Read the PNG.

### Known gotchas
- Yahoo 429-throttles rapid repeated hits; `yahoo-auth.js` already serializes + backs off and
  caches to `.cache/` (gitignored). Space out live tests.
- `sql.js` WASM fails to init in headless Chrome (LinkError) — harmless, localStorage fallback;
  the e2e test already whitelists it.
- Live fundamentals need local Chrome; without it `/yf-fundamentals` returns 503 and the app
  falls back to estimates.

---

## Feature A — Real-time background alert polling
**Goal:** while the app tab is open, periodically refresh prices and FIRE configured alerts
through the enabled channels (browser push, email, telegram, whatsapp), not just log them.

### Current alert plumbing (already present)
- `js/watchlist.js`: `evaluateWatchlistAlerts(item)` checks target/stop and calls
  `logSentAlert(...)` (deduped via the `_wlAlerted` Set). `refreshWatchlist()` fetches each
  symbol's price and calls it. `getSentAlerts/saveSentAlerts/logSentAlert/renderSentAlerts`.
- `js/alerts.js`: channel config `saveWhatsApp/saveTelegram/saveEmail/saveSmtp`,
  `sendEmailAlert(to,subject,text)` (POSTs `/send-email`), `enablePushNotifications()`
  (browser Notification API), `renderAlerts/toggleAlert`. State keys via `dbGet/dbSet`
  (`whatsappNumber`, `telegramToken`, `telegramChatId`, `emailAddress`, smtp*).
- Per-row custom rules live on `item._alertRules` (period/threshold/channels).

### Build steps
1. **Dispatch layer** (new, in `js/alerts.js`): `dispatchAlert(message, channels)` that, for
   each enabled channel, delivers:
   - `push` → `new Notification(...)` (guard `Notification.permission==='granted'`).
   - `email` → `sendEmailAlert(state.emailAddress, 'ARYA Alert', message)` if SMTP configured.
   - `telegram` → POST to `https://api.telegram.org/bot<token>/sendMessage` (chat_id, text);
     route via the server `/proxy` allowlist OR add `api.telegram.org` to `PROXY_ALLOWED_HOSTS`
     in `server.js` (it currently only allows Yahoo/Stooq — telegram will be BLOCKED otherwise).
   - `whatsapp` → there's no free server path; log + note as unsupported, or use a click-to-send
     `wa.me` link in the sent-alerts entry. Don't fake delivery.
   Make `evaluateWatchlistAlerts` call `dispatchAlert` (in addition to `logSentAlert`).
2. **Poller** (new, in `js/main.js` or a small `js/poller.js` added to the script list BEFORE
   `main.js`): `startAlertPolling()` using `setInterval` to call `refreshWatchlist()` (which now
   dispatches). Default interval ~2 min; expose it in Settings (persist via `dbSet('alertPollMins', n)`).
   Start it from the DOMContentLoaded init in `js/main.js`. Use `setInterval(...).unref?` n/a in
   browser; store the id on a module var so a settings change can clear/restart it.
3. **Settings UI** (in `index.html` Settings page + handler in `js/alerts.js`): a number input
   for poll interval and a master on/off toggle (`dbSet('alertPollEnabled', ...)`). Wire
   `enablePushNotifications()` to a button if not already surfaced.
4. **Dedupe/reset:** `_wlAlerted` dedupes within a session. Consider resetting a symbol's key
   when price moves back across the threshold so re-crossings re-fire. Keep it simple: clear the
   key when `price < target*0.99` (target) / `price > stop*1.01` (stop).

### Verify A
- Unit: extend `tests/unit.test.js`? Hard (browser globals). Prefer an e2e test in
  `tests/browser.e2e.js`: seed a watchlist item with a target below current price + `alert_target`,
  grant Notification via `context.grantPermissions(['notifications'])`, call `refreshWatchlist()`,
  assert a Sent Alerts entry appears. Add a `npm test` server test if telegram goes via `/proxy`.
- Manual: screenshot Settings showing the interval control + a fired alert in Sent Alerts.

---

## Feature B — Optional paid fundamentals fallback
**Goal:** when `yahoo-auth.getFundamentals` fails (no Chrome / 503), fall back to a paid API if a
key is configured, returning the SAME normalized shape so the UI treats it as live.

### Build steps
1. **New module** `fundamentals-fallback.js`: `getFromProvider(symbol)` reading an env key.
   Recommended provider: **Financial Modeling Prep (FMP)** — single key, has the needed fields.
   - `FMP_API_KEY` from `process.env`. If absent, throw/return null (feature stays off).
   - Fetch `/api/v3/profile/{sym}` (mktCap, sector, industry, companyName, beta, price, currency)
     + `/api/v3/ratios-ttm/{sym}` (peRatioTTM, returnOnEquityTTM, netProfitMarginTTM,
     operatingProfitMarginTTM, priceToBookRatioTTM, debtEquityRatioTTM, dividendYielTTM) +
     `/api/v3/key-metrics-ttm/{sym}` (revenuePerShareTTM*shares or use income-statement for revenue),
     `/api/v3/income-statement/{sym}?limit=1` for revenue + FCF via cash-flow-statement.
   - **Normalize to EXACTLY the `yahoo-auth.normalize` output shape** (see its return object):
     keys `marketCap, trailingPE, forwardPE, eps, beta, dividendYield, priceToBook, sector,
     industry, longName, returnOnEquity, profitMargins, operatingMargins, totalRevenue,
     revenueGrowth, earningsGrowth, debtToEquity, totalCash, totalDebt, freeCashflow, currency`.
   - **Units:** Yahoo gives ratios as fractions (0.09 = 9%) and `debtToEquity` as a PERCENT (36.6).
     FMP gives margins/ROE as fractions already, but debtEquityRatioTTM as a RATIO (0.36) — so
     **multiply FMP debt/equity by 100** to match the Yahoo convention the UI expects
     (UI does `d.debtToEquity/100`). Verify each unit against the Yahoo path so numbers match.
   - Set `source: 'fmp'` (NOT 'yahoo-quoteSummary').
2. **Wire into the server** (`server.js` `/yf-fundamentals` handler): try `yahoo-auth.getFundamentals`;
   on throw, if `process.env.FMP_API_KEY`, try `require('./fundamentals-fallback').getFromProvider`,
   cache via `cache.js` (key `fund-<sym>`), return. Keep graceful 503 if both fail.
   Consider caching fallback results the same way yahoo-auth does.
3. **CRITICAL frontend gotcha — broaden the "is real" checks** (they currently hardcode the Yahoo
   source string, so an `fmp` source would render as ESTIMATED and keep `(est.)` markers):
   - `js/data.js:144` `const real = state._extraData && state._extraData.source === 'yahoo-quoteSummary';`
   - `js/data.js:383` `const fundamentalsReal = f.source === 'yahoo-quoteSummary';`
   Change both to treat any known real source as live, e.g.
   `['yahoo-quoteSummary','fmp'].includes(source)` or `source && source !== 'estimate'`.
   `fetchFundamentals` in `js/data.js` already passes `f.source` through to `state._extraData.source`.
4. **Settings/docs:** document `FMP_API_KEY` (server-side env var — do NOT take the key from the
   client to avoid exposing it). Mention in `ARYA.md`. `/yf-status` could expose whether a
   fallback key is configured (boolean only, never the key).

### Verify B
- Unit (`tests/unit.test.js`): test the fallback normalizer with a mocked FMP payload → asserts
  the output shape + debt/equity *100 conversion + `source:'fmp'`.
- Integration: hard without a real key. Gate behind `FMP_API_KEY`; if unset, the endpoint path is
  unchanged (yahoo only). Add a server test that `/yf-status` reports `fallbackConfigured:false`
  when the env var is absent.
- Manual: if a key is available, stop Chrome (or force yahoo failure) and confirm the dashboard
  still shows live numbers with NO `(est.)` markers and a sensible source.

---

## Suggested order
1. Feature B normalizer + server wiring + the two `js/data.js` source-check fixes (small, testable).
2. Feature A dispatch + poller + settings (larger, needs browser verify).
3. Update `ARYA.md` changelog (v1.4.0), `TASK_QUEUE.md`, `CHECKPOINT_LAST.md`. Commit + push each.
4. Run `npm test` and `npm run test:e2e` as the gate before each commit.
