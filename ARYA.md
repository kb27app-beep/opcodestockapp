# ARYA'S Stocks Pro — Comprehensive Application Summary

**Project directory:** `C:\Users\BHUPENDRA PATEL\Downloads\OP CODE STOCK APP`
**Main file:** `index.html` (~2,950 lines)
**Supporting files:** `server.js`, `server.ps1`, `start.bat`

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

All files are in `C:\Users\BHUPENDRA PATEL\Downloads\OP CODE STOCK APP\`. Fully self-contained — no `npm install` or `package.json` needed.

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

## 9. Limitations

1. **No real financial data** — P/E, revenue, PAT, margins, ROE/ROCE, FCF are estimated using hardcoded values + random extrapolation from market cap
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
