# ARYA'S Stocks Pro — Comprehensive Application Summary

**Main file:** `index.html` (~3,050 lines)
**Supporting files:** `server.js`, `server.ps1`, `start.bat`, `package.json`

**Run:** `npm install` then `npm start` (or `node server.js`), open http://localhost:3000

---

## 1. App Identity

| Attribute | Detail |
|---|---|
| **Title** | ARYA'S Stocks Pro |
| **Tagline** | Research Platform |
| **Target Users** | Retail investors analyzing Indian (NSE/BSE) and US stocks |
| **Primary Use Case** | Enter a stock symbol, receive 10 analysis modules, set alerts, manage watchlist, generate PDF reports |
| **Market Coverage** | India (NSE `.NS` / BSE `.BO`) and US stocks (NASDAQ, NYSE) |

---

## 2. Tech Stack

### Frontend Libraries (CDN)

| Library | Version | Purpose |
|---|---|---|
| Chart.js | 4.4.1 | Interactive charts (price, financial ratios, PE comparison) |
| sql.js | 1.10.2 | SQLite database in-browser (WebAssembly) |
| html2pdf.js | 0.10.1 | Client-side PDF report generation |
| Font Awesome | 6.5.0 | UI icons |

### Backend (Proxy Server)

| File | Language | Port | Purpose |
|---|---|---|---|
| `server.js` | Node.js | 3000 | Serves static files + proxies Yahoo Finance API (CORS bypass) |
| `server.ps1` | PowerShell | 8080 | Alternative HTTP server + proxy |
| `start.bat` | Batch | Auto | Launcher (Node > Python > PS fallback) |

### CSS Architecture
- Custom properties under `:root` for full theming
- Cream/light-brown default theme
- Dark mode via JS toggling all CSS variables
- Responsive at 768px breakpoint

---

## 3. Features

### 3.1 Ten Analysis Modules

| # | Page | Coverage |
|---|---|---|
| 1 | Full Stock Analysis | Business model, revenue streams, competitive advantages, industry trends, financial health, promoter/FII holding, key risks, valuation vs peers, outlook |
| 2 | Deep Financial Breakdown | 5-year revenue/PAT/FCF trends, operating margins, debt/equity, ROE, ROCE, bar + line charts |
| 3 | Competitive Moat Analysis | Brand strength, distribution, switching costs, cost advantage, technology moat, peer comparison, moat gauge (0-10) |
| 4 | Stock Valuation Analysis | P/E, EV/EBITDA, EPS, DCF range, historical P/E range, sector comparison chart |
| 5 | Risk Analysis | 7 ranked risks (regulatory, economic, competition, disruption, management, debt, governance) with severity badges |
| 6 | Growth Potential Analysis | Market opportunity, industry growth, expansion areas, government tailwinds, AI/tech advantages, 5-10yr CAGR |
| 7 | Institutional Perspective | FII/DII rationale, catalysts, red flags, verdict (ACCUMULATE/HOLD) |
| 8 | Bull vs Bear Debate | Side-by-side arguments, target prices, ratio bar, phased entry recommendation |
| 9 | Management Quality Analysis | Promoter background, capital allocation, governance, related parties, pledging, execution track record |
| 10 | Should I Buy This Stock? | 1/3/6/12-month + 3/5yr outlooks, catalysts, risks, final verdict (BUY/HOLD/AVOID) |

### 3.2 Dashboard
- Welcome card with quick-start instructions
- After analysis: live summary with name, sector, market cap, price, day change, day/52W range, volume, P/E, price chart

### 3.3 Smart Watchlist (11th Section)
- Add via search or right-click context menu
- Columns: Date, Name, Ticker, Price, Ind. PE, Stk PE, Target, Stop Loss, Status, Notes, Actions
- Status tracks progress toward target or hit indicators
- Inline editing of target/stop/notes via dialog
- Per-stock alert rules with period/threshold/channel config
- Refresh prices from Yahoo Finance

### 3.4 Custom & Real-Time Alerts (3 Tabs)
- **Portfolio Alerts**: 45+ predefined conditions with enable/disable toggles
- **Smart Watchlist**: 38+ predefined conditions
- **Delivery Channels**: WhatsApp (phone), Telegram (bot token + chat ID), Push (browser notification), Email (address)

### 3.5 Sent Alerts History
- Chronological log of all triggered alerts
- Recent (<7 days) and older sections with opacity dimming
- Per-entry delete, max 200 entries

### 3.6 Settings
- Perplexity AI API Key
- Dark mode toggle
- Custom CORS proxy URL
- Test connection button

### 3.7 Full Report Generator (PDF)
- Iterates all 10 sections, saves to SQLite
- Builds branded HTML report with key metrics table
- Converts to PDF via html2pdf.js (A4, 0.5" margins, 2x scale)
- Saves to SQLite `reports` table

### 3.8 Right-Click Context Menu
- Detects stock symbols in clicked text or uses current analyzed stock
- Actions: Add to Watchlist, Analyze Stock, Copy Symbol

### 3.9 US/India Market Toggle
- Sidebar switch changes currency (`$`/`₹`), labels (`B`/`Cr`), symbol resolution, geography-specific analysis text

### 3.10 Dark Mode Toggle
- Swaps all CSS variables between cream and dark palettes
- Synced between top bar and Settings page, persisted in localStorage

---

## 4. Data Flow

```
User enters symbol → resolveSymbol() → auto-detect exchange
    ↓
fetchStockData() → fetchYfJson() → HTTP GET /yf?symbol=X&range=Y&interval=Z
    ↓
server.js proxies to Yahoo Finance v8 chart API
    ↓
extractAnalysisData() parses meta, indicators, timestamps
    ↓
runAllAnalyses() calls all 10 render*() functions
    ↓
Optionally enhanceWithPerplexity() if API key configured
```

### Symbol Resolution
- `.NS` suffix → NSE
- `.BO` suffix → BSE
- US toggle or known US ticker → US market (no suffix)
- Default → `.NS` (NSE) with BSE fallback on failure

### Data Estimation
Since Yahoo Finance only provides price data, the app synthesizes sector, P/E, financials, and peer data via hardcoded maps (`SECTOR_PE`, `PEERS`, `guessSector()`, `estimatePE()`).

---

## 5. Persistence (SQLite via sql.js)

| Table | Purpose |
|---|---|
| `settings` | API keys, notification config, proxy URL |
| `stock_analyses` | All 10 analysis sections per stock per date |
| `alerts` | Toggle states for alert rules |
| `reports` | Generated PDF report HTML |
| `watchlist` | Full watchlist with targets, stops, notes, alert rules |

Database is base64-encoded and stored in `localStorage` (key `stockAppDb`), surviving page refreshes.

---

## 6. UI Layout

```
+-------------------+----------------------------------------+
| SIDEBAR (240px)   | TOP BAR (sticky)                        |
| fixed             | [Search] [Period] [Analyze] [PDF] [☀️] |
|                   +----------------------------------------+
| ARYA'S Stocks Pro | CONTENT AREA (padding: 24px)            |
| [IN] / [US] toggle|                                        |
|                   | Dynamic pages via showPage()            |
| Dashboard         |                                        |
| 1-10 Analysis     |                                        |
| Watchlist         |                                        |
| Alerts / Settings |                                        |
+-------------------+----------------------------------------+
```

### Color Palette (Cream Theme)
| Variable | Value |
|---|---|
| `--bg-primary` | `#faf6ef` |
| `--bg-secondary` | `#f5efe7` |
| `--bg-card` | `#ffffff` |
| `--text-primary` | `#3d3229` |
| `--accent` | `#b8860b` |
| `--success` | `#2d8a4e` |
| `--danger` | `#c0392b` |
| `--border` | `#e8ddd0` |

---

## 7. Project Files

| File | Lines | Role |
|---|---|---|
| `index.html` | ~2,950 | Single-page application (all HTML/CSS/JS inline) |
| `server.js` | ~140 | Node.js HTTP server + Yahoo Finance proxy |
| `server.ps1` | ~100 | PowerShell alternative server |
| `start.bat` | ~85 | Auto-launcher (Node > Python > PowerShell) |
| `ARYA.md` | this | Documentation |

The proxy depends on `nodemailer` (for SMTP email alerts), so run `npm install` once before `npm start`. The frontend itself is self-contained (all HTML/CSS/JS inline, libraries from CDN).

---

## 8. State Object

```javascript
state = {
  stockSymbol: '', stockData: null, historicalData: null,
  currentPage: 'dashboard', alerts: {},
  perplexityKey: '', whatsappNumber: '',
  telegramToken: '', telegramChatId: '',
  emailAddress: '', market: 'IN' | 'US'
}
```

---

## 8a-3. Changelog (v1.6.0) — on-demand AI Research panel (claude -p, streamed)

- **AI Research panel**: per US stock, an "AI Research" button streams a live, web-searched
  research report (News & catalysts, latest + next earnings, analyst sentiment/targets, bull,
  bear, key risks, verdict) into a panel, rendered as markdown as it arrives.
- New server-side module `ai-research.js` (reusable, HTTP/Telegram-agnostic): `buildPrompt`,
  `parseStreamJsonLine`, `runResearch(symbol, context, onText, opts)`. It spawns the local
  `claude` CLI in print mode with `--output-format stream-json --include-partial-messages`,
  parses text deltas, and resolves with the final report. The future Telegram bot reuses this.
- **Runs on your Claude subscription, not paid tokens**: `cleanEnv` strips `ANTHROPIC_API_KEY`/
  `ANTHROPIC*` so the CLI uses the logged-in session. Default model is `sonnet`; override per
  request with `?model=haiku` to conserve quota.
- **Skill/workflow-hijack guard** (found via live testing): without it, headless `claude -p`
  picks up the user's global `~/.claude` skills and forks a background "deep-research" workflow
  instead of answering. Fixed with `--disallowedTools Skill Task Workflow TodoWrite` + an inline
  directive, keeping the run synchronous. (Cannot use `CLAUDE_CONFIG_DIR` to isolate — that dir
  holds the subscription credentials.)
- New endpoint `GET /ai-research?symbol=SYMBOL[&fresh=1][&model=...]` streams SSE
  (`data:{delta}` ... `event: done`/`error`). Symbol is validated `^[A-Z.]{1,8}$`; the CLI is
  spawned with an args array (no shell), 240s timeout, max 2 concurrent runs.
- **Caching**: final reports cached `airesearch-v1-<SYM>` (60-min TTL) via `cache.js`; the panel
  replays instantly and offers a "Re-run" (`&fresh=1`). Browser sends price/sector grounding.
- Tests: +6 (parser, prompt builder, runResearch stream + ENOENT + hijack-guard, SSE endpoint).
  `npm test` 24, `npm run test:e2e` 9. Verified live: real AAPL report streamed to `done` in
  ~81s on haiku with cited sources; cached replay 0ms.
- Spec + plan: `docs/superpowers/specs/2026-06-20-ai-research-panel-design.md`,
  `docs/superpowers/plans/2026-06-20-ai-research-panel.md`.

## 8a-2. Changelog (v1.5.0) — optional paid fundamentals fallback

- **Feature B — paid fundamentals fallback (FMP)**: when the free Yahoo path fails (no local
  Chrome, a 503, or a persistent 429) and a `FMP_API_KEY` is configured **server-side**, the
  `/yf-fundamentals` endpoint falls back to **Financial Modeling Prep** and returns the same
  normalized shape, so the dashboard still renders genuine live numbers (no `(est.)` markers).
- New module `fundamentals-fallback.js`: `getFromProvider(symbol)` fetches FMP profile / ratios-ttm
  / income / cash-flow / balance-sheet and `normalizeFmp(...)` maps them to the exact
  `yahoo-auth.normalize` keys. Units are reconciled to Yahoo's conventions — notably FMP's
  `debtEquityRatioTTM` is a ratio (0.36) and is scaled ×100 to Yahoo's percent (36). `source: 'fmp'`.
- Fallback results are cached the same way (`fund-<sym>`); a stale cache entry is served as a last
  resort if FMP also fails. The frontend's "is real" checks (`js/data.js`) now treat both
  `yahoo-quoteSummary` and `fmp` as live via a shared `isRealSource()` helper.
- **Config:** set `FMP_API_KEY` in the server environment only (never sent from the client, never
  returned). `/yf-status` exposes `fallbackConfigured` as a **boolean** so the UI can show whether a
  fallback is available without leaking the key. Feature stays fully off when the var is unset.
- Tests: +2 unit (`normalizeFmp` shape + debt/equity ×100; missing sections degrade to null),
  `/yf-status` now asserts `fallbackConfigured:false` when unset. `npm test` 15, `npm run test:e2e` 8.

## 8a-1. Changelog (v1.4.0) — real-time alert polling

- **Feature A — background alert polling**: while the tab is open, watchlist prices refresh on a
  timer (default every 2 min, configurable 1–60) and target / stop-loss alerts fire through a new
  unified `dispatchAlert(message, channels)` fan-out. Channels: browser **push**, **email** (SMTP),
  and **Telegram** (delivered via the server `/proxy`, with `api.telegram.org` added to the SSRF
  allowlist). WhatsApp has no free server path and is reported `unsupported` — never faked.
- Re-crossing logic: a fired target/stop re-arms once price moves back >1% across the threshold,
  so repeated crossings fire again instead of staying silent.
- New Settings card (Alerts → Delivery Channels): master on/off toggle + interval, persisted via
  `dbSet('alertPollEnabled' | 'alertPollMins')`; poller managed in `js/main.js`
  (`startAlertPolling`/`stopAlertPolling`/`restartAlertPolling`).
- Tests: +1 server test (Telegram host passes the allowlist), +2 e2e (firing path logs a sent
  alert; `dispatchAlert` reports whatsapp `unsupported`). `npm test` 13, `npm run test:e2e` 8.

## 8a0. Changelog (v1.3.0) — modular rebuild

- **Batch 0 — modules**: `app.js` split into ordered `js/{state,data,analysis,alerts,watchlist,report,main}.js`
  (classic scripts, shared globals, `main.js` init last). No build step.
- **Batch 1 — backend resilience**: new `cache.js` (disk-backed TTL cache). Fundamentals and
  the authenticated browser session now persist to `.cache/` across restarts; stale data is
  served as a fallback; Yahoo hits are serialized through a rate-limit queue. New `/healthz`
  and `/yf-status`. `/send-email` hardened (validation, body cap, per-IP throttle). Graceful
  shutdown closes the headless browser.
- **Batch 2 — tests**: `tests/` with `node:test`. `npm test` (unit + server, offline) and
  `npm run test:e2e` (Playwright browser). 18 tests.
- **Batch 3 — a11y + design**: skip link, ARIA roles/labels, `aria-current`, focus-visible
  rings, `prefers-reduced-motion`, mobile sidebar backdrop, print stylesheet, skeleton utility.
- **Batch 4 — real financials in modules**: Financial Breakdown, Valuation, and Full Analysis
  now use live TTM figures (ROE, margins, revenue & earnings growth, D/E, EPS, beta, P/B,
  forward P/E, FCF) when available, with honest LIVE/ESTIMATED labeling.
- **Batch 5 — UX**: debounced search autocomplete (typeahead via `/yf-search`), sortable
  watchlist columns, and watchlist target/stop alerts that actually fire (deduped) on refresh.

File layout now: `index.html`, `styles.css`, `js/*.js`, `server.js`, `yahoo-auth.js`,
`cache.js`, `tests/*.js`, `package.json`.

## 8a. Changelog (v1.2.0)

- **Real fundamentals are now LIVE** (market cap, P/E, sector, ROE, margins, revenue, debt).
  `yahoo-auth.js` drives a headless system Chrome (via `playwright-core`) to clear Yahoo's
  consent wall, obtain the A1/A3 cookies + crumb, and fetch `quoteSummary` from inside the
  authenticated page — the only path that returns HTTP 200 for free. Results are cached per
  symbol (10 min), the browser closes after 5 min idle, and any failure degrades to the
  estimate-based fallback. Exposed via `server.js` `/yf-fundamentals?symbol=`. The dashboard
  drops the `(est.)` marker whenever live data is present and the status bar says
  "live fundamentals" vs "estimated fundamentals".
- **Front-end split for maintainability**: the single `index.html` is now `index.html` (markup)
  + `styles.css` + `app.js`, served as-is (no build step). Fixed a pre-existing bug where 9
  unevaluated `${...}` template expressions in the static body rendered as literal text.
- **Visual redesign ("editorial fintech terminal")**: Fraunces display serif + Spline Sans body
  + JetBrains Mono for figures; warm-paper light theme and warm-ink dark theme; layered
  background atmosphere + grain; refined cards/buttons/nav with micro-interactions; charts
  recolored to the gold accent and theme-aware. Currency-correct market-cap formatting
  (`₹ Cr` / `$ B`) and a Yahoo-sector → industry-P/E map for sensible comparisons.
- Requires a local Chrome/Chromium for live fundamentals; without one the app still runs on
  estimates. `npm install` now also pulls `playwright-core`.

## 8b. Changelog (v1.1.0)

- **Real-data field fixes**: the app now reads the correct Yahoo `chart` meta keys —
  `longName`/`shortName` (real company name, previously always fell back to the ticker),
  `chartPreviousClose` (correct day-change, previously silently zeroed), and
  `fiftyTwoWeekHigh`/`Low` (real 52-week range instead of a slice of recent closes).
- **Honesty labeling**: values Yahoo's free endpoint does not provide (market cap, P/E,
  sector) now render with a `(est.)` marker so users aren't misled by fabricated precision.
- **Security**: the generic `/proxy` endpoint in `server.js` is now restricted to an
  allowlist of public finance hosts (closing an open-proxy / SSRF hole). `/yf` and
  `/yf-search` were already Yahoo-only.
- **Cleanup**: removed a duplicate `curLabel()` definition; added a real `package.json`
  with `npm start`.
- **Why fundamentals stay estimated**: Yahoo's richer `quoteSummary`/`v7/quote` endpoints
  now require a crumb+cookie that the consent flow blocks for unauthenticated/free use,
  so real market cap / P/E / financials are not freely reachable. A paid fundamentals
  feed (or a working crumb flow) would be needed to make those live.

## 9. Limitations

1. **No real financial data** — P/E, revenue, PAT, margins, ROE/ROCE, FCF are estimated using hardcoded values + random extrapolation from market cap (now flagged `(est.)` in the UI)
2. **Limited sector detection** — Hardcoded mapping for ~120 stocks; unknown stocks default to sector "DEFAULT" (PE 22x)
3. **No real peer comparison** — Only ~15 stocks have explicit peer lists
4. **No real institutional data** — FII/DII analysis is template text
5. **Delayed data** — Yahoo Finance provides ~20-minute delayed data
6. **Synthetic analysis** — Templates personalize with stock name, sector, price, and estimated P/E

The app is a polished **presentation framework** — a beautiful, organized research dashboard simulating professional analysis, combined with a powerful watchlist and alert configuration system.

---

## 10. Related Projects (Evaluated)

These projects were reviewed for potential integration but have fundamentally different tech stacks and purposes. They remain as standalone references:

| Project | Stars | Stack | Purpose | Why Not Integrated |
|---|---|---|---|---|
| [AutoHedge](https://github.com/The-Swarm-Corporation/AutoHedge) | 3.4k | Python AI agents + Solana | Autonomous crypto hedge fund | Crypto-only, Python stack, autonomous execution |
| [Vibe-Trading](https://github.com/HKUDS/Vibe-Trading) | 12.5k | Python + FastAPI + React | AI quant research & backtesting | Python/React stack, heavy LLM deps, Docker |
| [FinceptTerminal](https://github.com/Fincept-Corporation/FinceptTerminal) | 27.1k | C++20 + Qt6 + Python | Full financial terminal (Bloomberg-style) | Compiled native app, massive build deps, maintenance-mode |
