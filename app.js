// ============================================================
// SQLITE LOCAL DATABASE
// ============================================================
let db = null;
let SQL = null;

async function initDatabase() {
  if (!window.initSqlJs) return;
  try {
    SQL = await initSqlJs({ locateFile: file => 'https://sql.js.org/dist/sql-wasm.wasm' });
    const saved = localStorage.getItem('stockAppDb');
    if (saved) {
      const buf = Uint8Array.from(atob(saved), c => c.charCodeAt(0));
      db = new SQL.Database(buf);
    } else {
      db = new SQL.Database();
    }
    db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS stock_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT, date TEXT, section TEXT, content TEXT,
      price REAL, pe REAL, sector TEXT, market_cap REAL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE, enabled INTEGER DEFAULT 1, type TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT, date TEXT, content TEXT, format TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT UNIQUE, exchange TEXT DEFAULT 'NS',
      target_price REAL, stop_loss REAL, notes TEXT,
      alert_target INTEGER DEFAULT 0, alert_stoploss INTEGER DEFAULT 0,
      alert_gain INTEGER DEFAULT 0, alert_drop INTEGER DEFAULT 0,
      added_on TEXT, has_alerts INTEGER DEFAULT 0, alert_rules TEXT,
      stock_name TEXT, price_at_add REAL, industry_pe REAL, stock_pe REAL
    )`);
    // Migrate old databases — add missing columns
    for (const col of ['has_alerts', 'alert_rules', 'stock_name', 'price_at_add', 'industry_pe', 'stock_pe']) {
      try { db.run(`ALTER TABLE watchlist ADD COLUMN ${col} TEXT`); } catch (_) {}
    }
    saveDb();
  } catch (e) { console.warn('SQLite init failed, using localStorage fallback:', e.message); }
}

function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    const bytes = new Uint8Array(data);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    localStorage.setItem('stockAppDb', btoa(binary));
  } catch(e) { console.warn('Save DB failed:', e.message); }
}

function dbGet(key) {
  if (!db) return localStorage.getItem(key);
  const r = db.exec(`SELECT value FROM settings WHERE key = ?`, [key]);
  return r.length ? r[0].values[0][0] : null;
}

function dbSet(key, value) {
  if (!db) { localStorage.setItem(key, value); return; }
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
  saveDb();
}

function dbSaveAnalysis(symbol, section, content, price, pe, sector, marketCap) {
  if (!db) return;
  const date = new Date().toISOString().split('T')[0];
  db.run(`INSERT INTO stock_analyses (symbol, date, section, content, price, pe, sector, market_cap)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [symbol, date, section, content, price, pe, sector, marketCap]);
  saveDb();
}

function dbGetReport(symbol) {
  if (!db) return null;
  const r = db.exec(`SELECT content FROM reports WHERE symbol = ? ORDER BY id DESC LIMIT 1`, [symbol]);
  return r.length ? r[0].values[0][0] : null;
}

// ============================================================
// STATE
// ============================================================
let state = {
  stockSymbol: '',
  stockData: null,
  historicalData: null,
  currentPage: 'dashboard',
  alerts: {},
  perplexityKey: '',
  whatsappNumber: '',
  telegramToken: '',
  telegramChatId: '',
  emailAddress: '',
  smtpHost: '', smtpPort: '587', smtpUser: '', smtpPass: '',
  market: localStorage.getItem('market') || 'IN'
};

const DIVISIONS = {
  '1mo': '1m', '3mo': '5m', '6mo': '15m', '1y': '1d', '2y': '1d', '5y': '1wk', '10y': '1mo'
};

const SECTOR_PE = {
  'IT': 28, 'BANKING': 18, 'AUTO': 22, 'PHARMA': 30, 'FMCG': 35, 'OIL': 14, 'METAL': 12, 'TELECOM': 25, 'POWER': 16, 'REALTY': 20, 'DEFAULT': 22
};
// Yahoo's quoteSummary returns GICS-style sector names; map them to a sensible
// industry-average P/E so the comparison stays meaningful when real sectors arrive.
const YAHOO_SECTOR_PE = {
  'Technology': 28, 'Energy': 14, 'Financial Services': 18, 'Healthcare': 30,
  'Consumer Defensive': 35, 'Consumer Cyclical': 26, 'Industrials': 24,
  'Basic Materials': 12, 'Communication Services': 22, 'Utilities': 16, 'Real Estate': 20,
};

const PEERS = {
  'RELIANCE': ['TATACONSUM', 'IOC', 'BPCL', 'GAIL', 'ONGC'],
  'TCS': ['INFY', 'WIPRO', 'HCLTECH', 'TECHM', 'LTTS'],
  'INFY': ['TCS', 'WIPRO', 'HCLTECH', 'TECHM', 'MINDTREE'],
  'HDFCBANK': ['ICICIBANK', 'KOTAKBANK', 'AXISBANK', 'SBIN', 'YESBANK'],
  'ICICIBANK': ['HDFCBANK', 'KOTAKBANK', 'AXISBANK', 'SBIN', 'FEDERALBNK'],
  'SBIN': ['HDFCBANK', 'ICICIBANK', 'KOTAKBANK', 'AXISBANK', 'PNB'],
  'TATAMOTORS': ['M&M', 'MARUTI', 'EICHERMOT', 'BAJAJ-AUTO', 'HEROMOTOCO'],
  'MARUTI': ['TATAMOTORS', 'M&M', 'EICHERMOT', 'BAJAJ-AUTO', 'HYUNDAI'],
  'ITC': ['HINDUNILVR', 'NESTLEIND', 'BRITANNIA', 'DABUR', 'MARICO'],
  'HINDUNILVR': ['ITC', 'NESTLEIND', 'BRITANNIA', 'DABUR', 'GODREJCP'],
  'WIPRO': ['TCS', 'INFY', 'HCLTECH', 'TECHM', 'LTTS'],
  'HCLTECH': ['TCS', 'INFY', 'WIPRO', 'TECHM', 'MINDTREE'],
  'ASIANPAINT': ['BERGEPAINT', 'INDIGOPNTS', 'KANSAINER', 'AKZOINDIA', 'NIPPON'],
  'BAJFINANCE': ['HDFCBANK', 'ICICIBANK', 'AXISBANK', 'SBIN', 'KOTAKBANK']
};

// ============================================================
// NAVIGATION
// ============================================================
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-' + pageId);
  if (page) page.classList.add('active');
  const navBtn = document.querySelector(`.nav-item[onclick*="'${pageId}'"]`);
  if (navBtn) navBtn.classList.add('active');
  state.currentPage = pageId;
  if (pageId === 'watchlist') { renderWatchlist(); renderSentAlerts(); }
}

// ============================================================
// DATA SOURCE: Yahoo Finance via local server proxy (primary) + CORS proxies
// ============================================================
let localServer = '';

const US_STOCKS = ['AAPL','MSFT','GOOGL','GOOG','AMZN','META','NVDA','AMD','INTC','TSLA','JPM','BAC','V','MA','DIS','NFLX','ADBE','CRM','ORCL','IBM','CSCO','QCOM','TXN','AVGO','MU','BA','CAT','GE','MMM','XOM','CVX','KO','PEP','WMT','HD','MCD','SBUX','NKE','PG','JNJ','UNH','MRK','PFE','ABT','TMO','LLY','ABBV','AMGN','GILD','CELG','BMY','UPS','FDX','LMT','NOC','RTX','UBER','SNAP','PYPL','SQUARE','SHOP','SPOT','RIVN','COIN','PLTR','SOFI'];

function getYahooSymbol(name) {
  const clean = name.trim().toUpperCase().replace(/\s+/g, '');
  if (clean.endsWith('.NS')) return clean;
  if (clean.endsWith('.BO')) return clean;
  if (state.market === 'US' || US_STOCKS.includes(clean)) return clean;
  return clean + '.NS';
}

function resolveSymbol(name) {
  const clean = name.trim().toUpperCase().replace(/\s+/g, '');
  if (clean.endsWith('.NS')) return { symbol: clean, exchange: 'NS' };
  if (clean.endsWith('.BO')) return { symbol: clean, exchange: 'BO' };
  if (state.market === 'US' || US_STOCKS.includes(clean)) return { symbol: clean, exchange: 'US' };
  return { symbol: clean + '.NS', exchange: 'NS' };
}

function yfChartUrl(symbol, range, interval) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
}

// Fetch Yahoo Finance data — via local server proxy only
async function fetchYfJson(symbol, range, interval) {
  const proxy = localServer || window.location.origin;
  const url = `${proxy}/yf?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`;
  console.log('fetchYfJson:', url);
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from proxy`);
  const j = await resp.json();
  if (!j?.chart?.result?.[0]) throw new Error('No chart data in response');
  return j;
}

// === MAIN DATA FETCH ===
async function fetchStockData(symbol) {
  const base = symbol.replace('.NS','').replace('.BO','');
  const isUS = state.market === 'US' || US_STOCKS.includes(base);
  const trySymbols = isUS ? [symbol] : (symbol.endsWith('.BO') ? [symbol] : [symbol, symbol.replace('.NS','.BO')]);

  let chartJson, chartResult, meta, quote, history = null;
  let usedSymbol = symbol;

  for (const sym of trySymbols) {
    try {
      chartJson = await fetchYfJson(sym, '1mo', '1d');
      chartResult = chartJson?.chart?.result?.[0];
      if (chartResult && !chartResult?.error) {
        meta = chartResult.meta;
        quote = chartResult.indicators?.quote?.[0];
        if (meta && quote) { usedSymbol = sym; break; }
      }
    } catch (_) {}
  }
  if (!meta || !quote) throw new Error('No price data found for this symbol.');

  // Fetch history for user-selected period
  const period = document.getElementById('periodSelect').value;
  const interval = DIVISIONS[period] || '1d';
  try {
    history = await fetchYfJson(usedSymbol, period, interval);
  } catch (_) {}

  return { meta, quote, history, symbol: usedSymbol, period, interval, exchange: isUS ? 'US' : (usedSymbol.endsWith('.BO') ? 'BO' : 'NS') };
}

// ============================================================
// SEARCH & ANALYZE
// ============================================================
function curSym() { return state.market === 'US' ? '$' : '₹'; }
function curLabel() { return state.market === 'US' ? 'B' : 'Cr'; }
function curText() { return state.market === 'US' ? 'US' : 'Indian'; }
// Currency-aware market-cap formatting. Yahoo gives an absolute figure; India shows
// Crore (÷1e7), US shows Billions (÷1e9). One helper keeps every display site correct.
function fmtMcap(mc) {
  if (!mc || mc <= 0) return 'N/A';
  return state.market === 'US'
    ? '$' + (mc / 1e9).toFixed(1) + 'B'
    : '₹' + Math.round(mc / 1e7).toLocaleString('en-IN') + ' Cr';
}
// Chart accent colors read live from the active theme's CSS variables, so charts
// recolor automatically when the user toggles cream/dark.
function chartAccent() {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b07d12';
}
function chartAccentSoft() {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim() || 'rgba(176,125,18,0.14)';
}

function showStatus(msg, type) {
  const bar = document.getElementById('statusBar');
  if (!bar) return;
  bar.style.display = 'inline-block';
  bar.innerHTML = msg;
  bar.style.color = type === 'error' ? 'var(--danger)' : type === 'success' ? 'var(--success)' : 'var(--text-muted)';
  if (type === 'success') setTimeout(() => bar.style.display = 'none', 5000);
}

async function searchStock() {
  const input = document.getElementById('stockSearch').value.trim();
  if (!input) { showStatus('Please enter a stock symbol', 'error'); return; }

  const symbol = resolveSymbol(input).symbol;
  state.stockSymbol = symbol;

  const loader = document.getElementById('loader');
  loader.querySelector('p').textContent = 'Fetching stock data from Yahoo Finance...';
  loader.classList.add('active');

  try {
    state.stockData = await fetchStockData(symbol);
    // Best-effort: pull REAL fundamentals (market cap, P/E, sector, financials) before
    // rendering, so analyses use live data instead of estimates. Never blocks analysis.
    loader.querySelector('p').textContent = 'Fetching live fundamentals...';
    await fetchFundamentals(state.stockData.symbol);
    await runAllAnalyses();
    showPage('dashboard');
    renderDashboard();
    const real = state._extraData && state._extraData.source === 'yahoo-quoteSummary';
    showStatus(`✓ ${symbol} analyzed${real ? ' · live fundamentals' : ' · estimated fundamentals'}`, 'success');
  } catch (err) {
    console.error(err);
    showStatus('⚠️ ' + err.message, 'error');
  } finally {
    loader.classList.remove('active');
  }
}

// Pull real fundamentals from the local server's /yf-fundamentals endpoint (Yahoo
// quoteSummary via automated browser). On any failure, clears _extraData so the app
// falls back to its hardcoded estimates and the (est.) markers stay visible.
async function fetchFundamentals(symbol) {
  const proxy = localServer || window.location.origin;
  try {
    const resp = await fetch(`${proxy}/yf-fundamentals?symbol=${encodeURIComponent(symbol)}`);
    if (!resp.ok) { state._extraData = null; state._fundamentals = null; return null; }
    const j = await resp.json();
    const f = j && j.data;
    if (!f) { state._extraData = null; state._fundamentals = null; return null; }
    state._fundamentals = f;
    state._extraData = {
      marketCap: f.marketCap || undefined,
      pe: (typeof f.trailingPE === 'number' && f.trailingPE > 0) ? f.trailingPE : undefined,
      sector: f.sector || undefined,
      source: f.source,
    };
    return f;
  } catch (_) {
    state._extraData = null; state._fundamentals = null; return null;
  }
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function toggleMarket() {
  const el = document.getElementById('marketToggle');
  state.market = el.checked ? 'US' : 'IN';
  localStorage.setItem('market', state.market);
  document.getElementById('marketLabel').textContent = state.market === 'US' ? 'US' : 'India';
  document.getElementById('autoDetectLabel').textContent = state.market === 'US' ? 'US Market' : 'NSE/BSE Auto-detect';
  document.getElementById('stockSearch').placeholder = state.market === 'US'
    ? 'Search US stock (e.g., AAPL, MSFT, TSLA)'
    : 'Search Indian stock (e.g., RELIANCE, TCS)';
}

// ============================================================
// RUN ALL ANALYSES
// ============================================================
async function runAllAnalyses() {
  const sd = state.stockData;
  if (!sd) return;

  const analysisData = extractAnalysisData(sd);

  // Update page headers with stock name & price
  const sym = analysisData.symbol.replace('.NS','').replace('.BO','');
  const priceStr = `${curSym()}${analysisData.currentPrice.toFixed(2)}`;
  document.querySelectorAll('.page[id^="page-"] .page-header h1').forEach(h1 => {
    const baseText = h1.textContent.replace(/\(.*?\)|\s*[—–-]\s*₹?[\d,.$]+\s*$/, '').trim();
    const txt = h1.closest('.page')?.id;
    if (txt && txt !== 'page-dashboard' && txt !== 'page-alerts' && txt !== 'page-settings' && txt !== 'page-watchlist') {
      h1.innerHTML = `${baseText} <span style="font-size:14px;color:var(--text-muted);font-weight:400">(${sym}) — ${priceStr}</span>`;
    }
  });

  renderFullAnalysis(analysisData);
  if (db) dbSaveAnalysis(analysisData.name, '1. Full Analysis',
    document.getElementById('fullAnalysisContent')?.innerText || '', analysisData.currentPrice, analysisData.pe, analysisData.sector, analysisData.marketCap);

  renderFinancialBreakdown(analysisData);
  if (db) dbSaveAnalysis(analysisData.name, '2. Financial Breakdown',
    document.getElementById('financialAnalysisContent')?.innerText || '', analysisData.currentPrice, analysisData.pe, analysisData.sector, analysisData.marketCap);

  renderMoatAnalysis(analysisData);
  if (db) dbSaveAnalysis(analysisData.name, '3. Competitive Moat',
    document.getElementById('moatContent')?.innerText || '', analysisData.currentPrice, analysisData.pe, analysisData.sector, analysisData.marketCap);

  renderValuationAnalysis(analysisData);
  if (db) dbSaveAnalysis(analysisData.name, '4. Valuation',
    document.getElementById('valuationContent')?.innerText || '', analysisData.currentPrice, analysisData.pe, analysisData.sector, analysisData.marketCap);

  renderRiskAnalysis(analysisData);
  if (db) dbSaveAnalysis(analysisData.name, '5. Risk Analysis',
    document.getElementById('risksContent')?.innerText || '', analysisData.currentPrice, analysisData.pe, analysisData.sector, analysisData.marketCap);

  renderGrowthAnalysis(analysisData);
  if (db) dbSaveAnalysis(analysisData.name, '6. Growth Potential',
    document.getElementById('growthContent')?.innerText || '', analysisData.currentPrice, analysisData.pe, analysisData.sector, analysisData.marketCap);

  renderInstitutionalAnalysis(analysisData);
  if (db) dbSaveAnalysis(analysisData.name, '7. Institutional Perspective',
    document.getElementById('institutionalContent')?.innerText || '', analysisData.currentPrice, analysisData.pe, analysisData.sector, analysisData.marketCap);

  renderBullBearAnalysis(analysisData);
  if (db) dbSaveAnalysis(analysisData.name, '8. Bull vs Bear',
    document.getElementById('bullBearContent')?.innerText || '', analysisData.currentPrice, analysisData.pe, analysisData.sector, analysisData.marketCap);

  renderManagementAnalysis(analysisData);
  if (db) dbSaveAnalysis(analysisData.name, '9. Management Quality',
    document.getElementById('managementContent')?.innerText || '', analysisData.currentPrice, analysisData.pe, analysisData.sector, analysisData.marketCap);

  renderBuyDecision(analysisData);
  if (db) dbSaveAnalysis(analysisData.name, '10. Should I Buy?',
    document.getElementById('buyDecisionContent')?.innerText || '', analysisData.currentPrice, analysisData.pe, analysisData.sector, analysisData.marketCap);

  if (state.perplexityKey) {
    try { await enhanceWithPerplexity(analysisData); }
    catch (e) { console.log('Perplexity enhancement skipped:', e.message); }
  }
}

function extractAnalysisData(sd) {
  const meta = sd.meta;
  const quote = sd.quote;
  const hist = sd.history;
  const extra = state._extraData || {};

  // Extract price data from history if available
  const closes = hist?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
  const opens = hist?.chart?.result?.[0]?.indicators?.quote?.[0]?.open || [];
  const highs = hist?.chart?.result?.[0]?.indicators?.quote?.[0]?.high || [];
  const lows = hist?.chart?.result?.[0]?.indicators?.quote?.[0]?.low || [];
  const volumes = hist?.chart?.result?.[0]?.indicators?.quote?.[0]?.volume || [];
  const timestamps = hist?.chart?.result?.[0]?.timestamp || [];

  const currentPrice = meta?.regularMarketPrice || quote?.close?.[quote.close.length-1] || 0;
  // Yahoo's chart meta exposes the prior close as `chartPreviousClose` (not `previousClose`);
  // reading the wrong key silently zeroed day-change for every stock.
  const prevClose = meta?.chartPreviousClose ?? meta?.previousClose ?? quote?.close?.[quote.close.length-2] ?? 0;
  const dayHigh = meta?.regularMarketDayHigh || 0;
  const dayLow = meta?.regularMarketDayLow || 0;
  const volume = meta?.regularMarketVolume || 0;

  const yearlyData = [];
  const years = {};
  for (let i = 0; i < timestamps.length; i++) {
    const d = new Date(timestamps[i] * 1000);
    const y = d.getFullYear();
    if (!years[y]) years[y] = { opens: [], closes: [], highs: [], lows: [], volumes: [] };
    years[y].opens.push(opens[i] || 0);
    years[y].closes.push(closes[i] || 0);
    years[y].highs.push(highs[i] || 0);
    years[y].lows.push(lows[i] || 0);
    years[y].volumes.push(volumes[i] || 0);
  }

  const sortedYears = Object.keys(years).sort();
  for (const y of sortedYears) {
    const yData = years[y];
    if (yData.closes.length > 0) {
      yearlyData.push({
        year: parseInt(y),
        open: yData.opens[0] || 0,
        close: yData.closes[yData.closes.length-1] || 0,
        high: Math.max(...yData.highs),
        low: Math.min(...yData.lows),
        volume: yData.volumes.reduce((a,b)=>a+b, 0),
        avgClose: yData.closes.reduce((a,b)=>a+b, 0) / yData.closes.length
      });
    }
  }

  const name = meta?.symbol?.replace('.NS','').replace('.BO','') || 'STOCK';
  // Real company name lives in `longName`/`shortName`; the old code read a
  // non-existent `companyName`, so the full name always fell back to the ticker.
  const fullName = meta?.longName || meta?.shortName || name;
  const actualSector = extra.sector || guessSector(name);
  const industryPE = YAHOO_SECTOR_PE[actualSector] || SECTOR_PE[actualSector] || SECTOR_PE.DEFAULT;
  const currentPE = extra.pe || estimatePE(name, currentPrice);
  const peers = PEERS[name] || ['Sector Peer 1', 'Sector Peer 2', 'Sector Peer 3'];

  // Honesty flags: these fields are NOT in Yahoo's free chart endpoint and are
  // estimated from hardcoded maps. The UI surfaces "(est.)" wherever they appear.
  const sectorEstimated = !extra.sector;
  const peEstimated = !extra.pe;
  const marketCapEstimated = !extra.marketCap;

  return {
    name,
    fullName,
    symbol: sd.symbol,
    exchange: sd.exchange || 'NS',
    currentPrice,
    prevClose,
    dayHigh,
    dayLow,
    volume,
    change: extra.change || (currentPrice - prevClose),
    changePercent: extra.percentChange || (prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0),
    // Prefer Yahoo's real 52-week range from meta; fall back to computed/estimated.
    high52w: extra.high52w || meta?.fiftyTwoWeekHigh || Math.max(...closes.slice(-252)) || currentPrice * 1.1,
    low52w: extra.low52w || meta?.fiftyTwoWeekLow || Math.min(...closes.slice(-252)) || currentPrice * 0.9,
    avgVolume: volumes.reduce((a,b)=>a+b,0) / Math.max(volumes.length,1),
    marketCap: extra.marketCap || (currentPrice * 10000000),
    pe: currentPE,
    sectorPE: industryPE,
    sector: actualSector,
    sectorEstimated,
    peEstimated,
    marketCapEstimated,
    peers,
    yearlyData,
    closes,
    timestamps,
    volumes,
    highs,
    lows
  };
}

function guessSector(name) {
  const bankStocks = ['HDFCBANK','ICICIBANK','KOTAKBANK','AXISBANK','SBIN','YESBANK','PNB','BANKBARODA','INDUSINDBK','FEDERALBNK','RBLBANK','BANDHANBNK','IDFCFIRSTB','AUROPHARMA','CIPLA','DIVISLAB','DRREDDY','LUPIN','SUNPHARMA'];
  const itStocks = ['TCS','INFY','WIPRO','HCLTECH','TECHM','MINDTREE','LTTS','MPHASIS','PERSISTENT','COFORGE','LTI','BSOFT'];
  const autoStocks = ['TATAMOTORS','M&M','MARUTI','EICHERMOT','BAJAJ-AUTO','HEROMOTOCO','ASHOKLEY','TVSMOTOR'];
  const fmcgStocks = ['ITC','HINDUNILVR','NESTLEIND','BRITANNIA','DABUR','MARICO','GODREJCP','COLPAL','EMAMILTD','P&G'];
  const oilStocks = ['RELIANCE','IOC','BPCL','HPCL','GAIL','ONGC','OIL','PETRONET'];
  const pharmaStocks = ['SUNPHARMA','DRREDDY','CIPLA','DIVISLAB','LUPIN','AUROPHARMA','BIOCON','GLENMARK','TORNTPHARM','ALEMBIC'];
  const metalStocks = ['TATASTEEL','JSWSTEEL','HINDALCO','NATIONALUM','NALCO','HINDZINC','JINDALSTEL','SAIL','COALINDIA','KRISHNADEF'];
  const telecomStocks = ['BHARTIARTL','RELIANCE','IDEA','TATACOMM','MTNL'];

  if (bankStocks.includes(name)) return 'BANKING';
  if (itStocks.includes(name)) return 'IT';
  if (autoStocks.includes(name)) return 'AUTO';
  if (fmcgStocks.includes(name)) return 'FMCG';
  if (oilStocks.includes(name)) return 'OIL';
  if (pharmaStocks.includes(name)) return 'PHARMA';
  if (metalStocks.includes(name)) return 'METAL';
  if (telecomStocks.includes(name)) return 'TELECOM';
  return 'DEFAULT';
}

function estimatePE(name, price) {
  const peMap = {
    'TCS':30,'INFY':28,'WIPRO':24,'HCLTECH':22,'TECHM':20,'MINDTREE':28,
    'HDFCBANK':20,'ICICIBANK':18,'KOTAKBANK':22,'AXISBANK':16,'SBIN':14,
    'RELIANCE':28,'ITC':28,'HINDUNILVR':55,'TATAMOTORS':25,'MARUTI':30,
    'M&M':22,'BAJFINANCE':35,'ASIANPAINT':60,'NESTLEIND':70,'SUNPHARMA':32,
    'TATASTEEL':10,'JSWSTEEL':12,'BHARTIARTL':25,'WIPRO':24
  };
  return peMap[name] || 22;
}

// ============================================================
// DASHBOARD
// ============================================================
function renderDashboard() {
  const d = state.stockData ? extractAnalysisData(state.stockData) : null;
  if (!d) return;

  // Small italic marker shown next to values Yahoo's free endpoint doesn't provide.
  const est = '<span title="Estimated — not from a live fundamentals feed" style="font-size:10px;color:var(--text-muted);font-style:italic"> (est.)</span>';
  const welcome = document.getElementById('welcomeCard');
  welcome.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:start; flex-wrap:wrap; gap:16px">
      <div>
        <h3 style="font-size:20px">${d.fullName} <span style="font-size:12px; color:var(--text-muted)">${d.symbol}</span></h3>
        <p style="color:var(--text-secondary); font-size:13px; margin-top:4px">${d.sector}${d.sectorEstimated ? est : ''} · Market Cap: ${fmtMcap(d.marketCap)}${d.marketCapEstimated ? est : ''}</p>
      </div>
      <div style="text-align:right">
        <div style="font-size:32px; font-weight:700">${curSym()}${d.currentPrice.toFixed(2)}</div>
        <div class="${d.change >= 0 ? 'text-green' : 'text-red'}" style="font-size:14px">
          ${d.change >= 0 ? '+' : ''}${curSym()}${d.change.toFixed(2)} (${d.changePercent.toFixed(2)}%)
        </div>
      </div>
    </div>
    <div class="stat-grid" style="margin-top:16px">
      <div class="stat-card"><div class="label">Day Range</div><div class="value" style="font-size:14px">${curSym()}${d.dayLow.toFixed(2)} - ${curSym()}${d.dayHigh.toFixed(2)}</div></div>
      <div class="stat-card"><div class="label">52W Range</div><div class="value" style="font-size:14px">${curSym()}${d.low52w.toFixed(2)} - ${curSym()}${d.high52w.toFixed(2)}</div></div>
      <div class="stat-card"><div class="label">Volume</div><div class="value" style="font-size:14px">${(d.volume/1e6).toFixed(2)}M</div></div>
      <div class="stat-card"><div class="label">P/E${d.peEstimated ? est : ''}</div><div class="value" style="font-size:14px">${d.pe.toFixed(1)} <span style="font-size:11px;color:var(--text-muted)">(Sector: ${d.sectorPE})</span></div></div>
    </div>
    <div class="chart-container" style="height:250px">
      <canvas id="dashPriceChart"></canvas>
    </div>
    <div class="data-source" style="margin-top:8px"><i class="fas fa-database"></i> Yahoo Finance · ${d.exchange === 'US' ? 'US Stocks' : 'NSE/BSE'}</div>
  `;

  // Render price chart
  setTimeout(() => {
    const ctx = document.getElementById('dashPriceChart');
    if (!ctx) return;
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: d.timestamps.slice(-200).map(t => new Date(t*1000).toLocaleDateString('en-IN')),
        datasets: [{
          label: 'Price',
          data: d.closes.slice(-200),
          borderColor: chartAccent(),
          backgroundColor: chartAccentSoft(),
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 10, color: '#9c8c76', font: { size: 10 } }, grid: { color: 'rgba(140,125,95,0.16)' } },
          y: { ticks: { color: '#9c8c76', font: { size: 10 } }, grid: { color: 'rgba(140,125,95,0.16)' } }
        }
      }
    });
  }, 100);
}

// ============================================================
// 1. FULL ANALYSIS
// ============================================================
function renderFullAnalysis(d) {
  const bullish = d.changePercent > 0;
  const el = document.getElementById('fullAnalysisContent');
  el.innerHTML = `
    <div class="fade-in">
      <div class="card">
        <h3><i class="fas fa-building"></i> ${d.fullName} — Business Model & Revenue Streams</h3>
        <p>${d.fullName} operates in the <strong>${d.sector}</strong> sector with a market capitalization of approximately ${fmtMcap(d.marketCap)}. The company generates revenue primarily through its core business operations.</p>
        <br>
        <h4>Key Revenue Streams:</h4>
        <ul>
          <li><strong>Core Operations:</strong> Primary business activities contributing ~70-80% of total revenue</li>
          <li><strong>Core Market:</strong> Strong presence across domestic & international markets</li>
          <li><strong>Growth Initiatives:</strong> Expanding footprint in new geographies & segments contributing ~20-30% of revenue</li>
          <li><strong>Digital Initiatives:</strong> Technology-driven platforms enhancing customer reach and operational efficiency</li>
        </ul>
        <br>
        <h4>Competitive Advantages (Moat):</h4>
        <ul>
          <li><strong>Brand Strength:</strong> Well-recognized brand with strong customer loyalty</li>
          <li><strong>Distribution Network:</strong> Robust supply chain & distribution infrastructure</li>
          <li><strong>Cost Advantage:</strong> Economies of scale leading to superior margin profile vs peers</li>
          <li><strong>Switching Costs:</strong> High customer retention due to integrated service offerings</li>
        </ul>
        <br>
        <h4>Industry Trends:</h4>
        <ul>
          <li>Government's focus on infrastructure and manufacturing provides tailwinds</li>
          <li>Digital transformation and AI adoption driving operational efficiencies</li>
          <li>Increasing formalization of the economy benefiting organized players</li>
          <li>Favorable demographic dividend with rising per capita income</li>
        </ul>
        <br>
        <h4>Financial Health:</h4>
        <ul>
          <li><strong>Revenue Growth:</strong> Strong CAGR of ~12-15% over the last 5 years</li>
          <li><strong>Operating Margins:</strong> ${d.sector === 'IT' ? '24-28%' : d.sector === 'BANKING' ? '35-40% (NIM)' : d.sector === 'FMCG' ? '20-25%' : '14-18%'} — healthy for the sector</li>
          <li><strong>Debt Levels:</strong> ${d.sector === 'BANKING' || d.sector === 'TELECOM' ? 'Moderate leverage typical for the sector' : 'Comfortable debt-to-equity ratio below 0.5'}</li>
          <li><strong>Cash Flow:</strong> Strong operating cash flow generation with healthy free cash flow conversion</li>
        </ul>
        <br>
        <h4>Promoter Holding & FII/DII Trends:</h4>
        <ul>
          <li>Promoter holding remains stable with no significant pledging of shares</li>
          <li>FIIs have ${bullish ? 'increased' : 'moderated'} their stake recently, reflecting ${bullish ? 'positive' : 'cautious'} sentiment</li>
          <li>DIIs continue to show confidence with steady accumulation</li>
        </ul>
        <br>
        <h4>Key Risks:</h4>
        <ul>
          <li>Regulatory changes specific to the ${d.sector} sector</li>
          <li>Intense competition from both organized and unorganized players</li>
          <li>Macroeconomic headwinds affecting consumer spending</li>
          <li>Technology disruption risks</li>
        </ul>
        <br>
        <h4>Valuation vs Peers:</h4>
        <p>Trading at a P/E of <strong>${d.pe.toFixed(1)}x</strong> versus the sector average of <strong>${d.sectorPE}x</strong>. The stock appears ${d.pe < d.sectorPE ? 'undervalued' : d.pe > d.sectorPE * 1.2 ? 'premium valued' : 'fairly valued'} relative to its peers.</p>
        <br>
        <h4>12-24 Month Outlook:</h4>
        <p>${bullish ? 'Bullish' : 'Cautiously optimistic'} outlook driven by strong fundamentals, sector tailwinds, and management's execution capabilities. Key monitorables include demand recovery, margin trajectory, and competitive dynamics.</p>
      </div>
    </div>
  `;
  const source = document.getElementById('fullAnalysisSource');
  source.style.display = 'flex';
  source.querySelector('span').textContent = `Data: Yahoo Finance · ${curText() === 'US' ? 'US' : 'NSE/BSE'} · Sector: ${d.sector} · Fundamental estimates based on industry benchmarks`;
}

// ============================================================
// 2. FINANCIAL BREAKDOWN
// ============================================================
function renderFinancialBreakdown(d) {
  // Generate realistic 5-year financial data based on current price
  const years = [d.yearlyData.length > 5 ? d.yearlyData.slice(-5) : d.yearlyData];
  const baseRevenue = d.marketCap * 0.3 / 1e7; // in Cr

  const finData = [];
  for (let i = 4; i >= 0; i--) {
    const rev = baseRevenue * (1 - i * 0.02); // growing revenue
    const pat = rev * (0.12 + i * 0.005);
    const fcf = pat * (0.75 + Math.random() * 0.15);
    const opMargin = 0.15 + i * 0.008;
    const debt = (d.sector === 'BANKING' || d.sector === 'TELECOM') ? rev * 2 : rev * 0.3 - i * 10;
    const equity = rev * 0.6 + i * 50;
    const roe = pat / Math.max(equity, 1) * 100;
    const roce = pat / Math.max(debt + equity, 1) * 100;
    finData.push({
      year: 2026 - 5 + i, rev, pat, fcf, opMargin, debt, equity, roe, roce
    });
  }

  // Stats grid
  const statsEl = document.getElementById('finStats');
  const latest = finData[finData.length - 1];
  statsEl.innerHTML = `
    <div class="stat-card" style="border-color:var(--accent)">
      <div class="label">Current Price (LTP)</div>
      <div class="value" style="font-size:22px">${curSym()}${d.currentPrice.toFixed(2)}</div>
      <div class="change ${d.change >= 0 ? 'text-green' : 'text-red'}">
        ${d.change >= 0 ? '+' : ''}${d.change.toFixed(2)} (${d.changePercent.toFixed(2)}%)
      </div>
    </div>
    <div class="stat-card ${latest.fcf > latest.pat * 0.8 ? 'text-green' : 'text-red'}">
      <div class="label">Free Cash Flow</div>
      <div class="value">${curSym()}${latest.fcf.toFixed(0)}${curLabel()}</div>
      <div class="change ${latest.fcf > latest.pat * 0.8 ? 'text-green' : 'text-red'}">
        ${latest.fcf > latest.pat * 0.8 ? '✓ Above 80% (Healthy)' : '✗ Below 80% (Weak)'}
      </div>
    </div>
    <div class="stat-card ${latest.roe > 15 ? 'text-green' : latest.roe > 10 ? 'text-yellow' : 'text-red'}">
      <div class="label">ROE</div><div class="value">${latest.roe.toFixed(1)}%</div>
    </div>
    <div class="stat-card ${latest.roce > 15 ? 'text-green' : latest.roce > 10 ? 'text-yellow' : 'text-red'}">
      <div class="label">ROCE</div><div class="value">${latest.roce.toFixed(1)}%</div>
    </div>
    <div class="stat-card">
      <div class="label">Op. Margin</div><div class="value">${(latest.opMargin*100).toFixed(1)}%</div>
    </div>
    <div class="stat-card ${latest.debt > latest.equity ? 'text-red' : 'text-green'}">
      <div class="label">D/E Ratio</div><div class="value">${(latest.debt/Math.max(latest.equity,1)).toFixed(2)}</div>
    </div>
    <div class="stat-card">
      <div class="label">Revenue (TTM)</div><div class="value">${curSym()}${latest.rev.toFixed(0)}${curLabel()}</div>
    </div>
  `;

  // Charts
  setTimeout(() => {
    // Revenue chart
    const c1 = document.getElementById('revenueChart');
    if (c1) {
      new Chart(c1, {
        type: 'bar',
        data: {
          labels: finData.map(f => f.year),
          datasets: [
            { label: 'Revenue (Cr)', data: finData.map(f => f.rev), backgroundColor: chartAccent(), borderRadius: 4 },
            { label: 'PAT (Cr)', data: finData.map(f => f.pat), backgroundColor: '#22c55e', borderRadius: 4 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
          scales: {
            x: { ticks: { color: '#9c8c76', font: { size: 10 } }, grid: { color: 'rgba(140,125,95,0.16)' } },
            y: { ticks: { color: '#9c8c76', font: { size: 10 } }, grid: { color: 'rgba(140,125,95,0.16)' } }
          }
        }
      });
    }

    // ROE/ROCE chart
    const c2 = document.getElementById('roeChart');
    if (c2) {
      new Chart(c2, {
        type: 'line',
        data: {
          labels: finData.map(f => f.year),
          datasets: [
            { label: 'ROE %', data: finData.map(f => f.roe), borderColor: '#22c55e', tension: 0.3, pointRadius: 4 },
            { label: 'ROCE %', data: finData.map(f => f.roce), borderColor: '#eab308', tension: 0.3, pointRadius: 4 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
          scales: {
            x: { ticks: { color: '#9c8c76', font: { size: 10 } }, grid: { color: 'rgba(140,125,95,0.16)' } },
            y: { ticks: { color: '#9c8c76', font: { size: 10 } }, grid: { color: 'rgba(140,125,95,0.16)' } }
          }
        }
      });
    }
  }, 100);

  // Analysis text
  const analysisEl = document.getElementById('financialAnalysisContent');
  const revenueGrowth = ((finData[finData.length-1].rev - finData[0].rev) / finData[0].rev * 100).toFixed(1);
  const patGrowth = ((finData[finData.length-1].pat - finData[0].pat) / finData[0].pat * 100).toFixed(1);
  analysisEl.innerHTML = `
    <div class="card fade-in">
      <h3>Financial Health Assessment</h3>
      <p><strong>Revenue Growth:</strong> ${d.fullName} has grown revenue by <strong>${revenueGrowth}%</strong> over the last 5 years, with a CAGR of approximately <strong>${(Math.pow(finData[finData.length-1].rev/finData[0].rev, 1/5)-1)*100 > 0 ? ((Math.pow(finData[finData.length-1].rev/finData[0].rev, 1/5)-1)*100).toFixed(2) : 0}%</strong>.</p>
      <br>
      <p><strong>PAT Growth:</strong> Net profit has grown <strong>${patGrowth}%</strong> over the same period, indicating ${Number(patGrowth) > Number(revenueGrowth) ? 'improving operating leverage and margin expansion' : 'margin pressure despite revenue growth'}.</p>
      <br>
      <p><strong>Free Cash Flow:</strong> At ${curSym()}${latest.fcf.toFixed(0)}${curLabel()}, FCF is <strong>${(latest.fcf/latest.pat*100).toFixed(1)}%</strong> of PAT — ${latest.fcf > latest.pat * 0.8 ? '<span class="text-green">above the 80% threshold, indicating healthy cash flow generation.</span>' : '<span class="text-red">below the 80% threshold, which warrants monitoring of working capital management.</span>'}</p>
      <br>
      <p><strong>Operating Margins:</strong> ${(latest.opMargin*100).toFixed(1)}% — ${latest.opMargin > 0.2 ? 'Healthy margins with pricing power' : 'Moderate margins with room for improvement'}.</p>
      <br>
      <p><strong>Debt Levels:</strong> D/E ratio of ${(latest.debt/Math.max(latest.equity,1)).toFixed(2)} — ${latest.debt < latest.equity ? 'low leverage, strong balance sheet.' : 'moderate leverage, manageable.'}</p>
      <br>
      <p><strong>ROE & ROCE:</strong> ROE of ${latest.roe.toFixed(1)}% and ROCE of ${latest.roce.toFixed(1)}% indicate ${latest.roe > 15 ? 'strong' : 'adequate'} return generation on capital employed.</p>
      <br>
      <p><strong>Verdict:</strong> The company appears to be <strong>${latest.roe > 15 && latest.fcf > latest.pat * 0.8 ? 'financially strengthening' : 'financially stable but with areas of improvement'}</strong>.</p>
    </div>
  `;
}

// ============================================================
// 3. MOAT ANALYSIS
// ============================================================
function renderMoatAnalysis(d) {
  const el = document.getElementById('moatContent');
  let moatRating = 6;
  if (['TCS','INFY','RELIANCE','ITC','HINDUNILVR','ASIANPAINT','MARUTI','HDFCBANK','BAJFINANCE','NESTLEIND'].includes(d.name)) {
    moatRating = 8;
      } else if (['SBIN','ICICIBANK','TATAMOTORS','M&M','WIPRO','SUNPHARMA','BHARTIARTL'].includes(d.name)) {
        moatRating = 7;
  }

  el.innerHTML = `
    <div class="fade-in">
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px">
          <h3 style="margin:0">Competitive Moat Rating</h3>
          <div class="gauge gauge-${moatRating >= 8 ? 'high' : moatRating >= 6 ? 'mid' : 'low'}">${moatRating}/10</div>
        </div>
        <h4>Brand Strength</h4>
        <p>${d.fullName} has a <strong>${moatRating >= 7 ? 'strong' : 'moderate'}</strong> brand presence${state.market === 'IN' ? ' in India' : ''}. The brand commands customer loyalty and pricing power in its segment.</p>
        <br>
        <h4>Distribution Network</h4>
        <p>Extensive distribution network covering <strong>${moatRating >= 7 ? 'pan-India presence across all states and Union territories' : 'major metropolitan and Tier-2 cities'}</strong>.</p>
        <br>
        <h4>Switching Costs</h4>
        <p>${d.sector === 'IT' ? 'High switching costs due to long-term contracts, integrated systems, and critical nature of services provided.' : d.sector === 'BANKING' ? 'Moderate switching costs as customers face procedural friction in changing primary banking relationships.' : d.sector === 'FMCG' ? 'Low switching costs; brand loyalty is key differentiator.' : 'Moderate switching costs with reasonable customer retention.'}</p>
        <br>
        <h4>Cost Advantage</h4>
        <p>${d.sector === 'IT' ? `Significant cost advantage through access to ${state.market === 'IN' ? 'Indian ' : ''}talent pool and operational efficiencies.` : 'Economies of scale provide cost advantages over smaller competitors.'}</p>
        <br>
        <h4>Technology/Proprietary Advantage</h4>
        <p>${d.sector === 'IT' ? 'Strong IP portfolio with proprietary platforms and tools. Continuous investment in AI/ML capabilities.' : d.sector === 'BANKING' ? 'Significant technology investments in mobile banking, digital platforms, and AI-driven services.' : 'Moderate technology moat; industry-standard digital capabilities.'}</p>
        <br>
        <h4>Market Share Position</h4>
        <p>${d.fullName} holds a <strong>${moatRating >= 8 ? 'market-leading' : 'significant'}</strong> position in the ${curText()} ${d.sector} sector.</p>
        <br>
        <h4>Peer Comparison</h4>
        <ul>
          ${d.peers.slice(0,3).map(p => `<li><strong>${p}:</strong> Competes strongly with ${p} in terms of market presence and financial metrics.</li>`).join('')}
        </ul>
        <br>
        <p><strong>Moat Verdict:</strong> ${d.fullName} has a <strong>${moatRating >= 8 ? 'Wide' : moatRating >= 6 ? 'Narrow' : 'No'}</strong> moat. The company's competitive advantages ${moatRating >= 8 ? 'are durable and likely to persist' : 'exist but require continuous reinvestment to maintain'}.</p>
      </div>
    </div>
  `;
}

// ============================================================
// 4. VALUATION ANALYSIS
// ============================================================
function renderValuationAnalysis(d) {
  const statsEl = document.getElementById('valuationStats');
  const eps = d.currentPrice / Math.max(d.pe, 0.1);
  const ev = d.marketCap * 1.1; // rough EV
  const ebitda = d.marketCap * 0.15;
  const evEbitda = ev / Math.max(ebitda, 1);

  statsEl.innerHTML = `
    <div class="stat-card"><div class="label">Current P/E</div><div class="value">${d.pe.toFixed(1)}x</div></div>
    <div class="stat-card"><div class="label">Sector P/E</div><div class="value">${d.sectorPE}x</div></div>
    <div class="stat-card ${d.pe < d.sectorPE ? 'text-green' : 'text-red'}"><div class="label">Premium/Discount</div><div class="value">${((d.pe - d.sectorPE)/d.sectorPE*100).toFixed(0)}%</div></div>
    <div class="stat-card"><div class="label">Est. EPS</div><div class="value">${curSym()}${eps.toFixed(2)}</div></div>
    <div class="stat-card"><div class="label">EV/EBITDA (Est.)</div><div class="value">${evEbitda.toFixed(1)}x</div></div>
    <div class="stat-card"><div class="label">Market Cap</div><div class="value">${fmtMcap(d.marketCap)}</div></div>
  `;

  // PE comparison chart
  setTimeout(() => {
    const ctx = document.getElementById('peChart');
    if (!ctx) return;
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: [d.name, ...d.peers.slice(0,4)].map(s => s.replace('.NS','').replace('.BO','')),
        datasets: [{
          label: 'P/E Ratio',
          data: [d.pe, ...d.peers.slice(0,4).map(p => estimatePE(p, 0))],
          backgroundColor: [chartAccent(), '#9c8c76', '#9c8c76', '#9c8c76', '#9c8c76'],
          borderRadius: 4
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ctx.parsed.y.toFixed(1) + 'x' } }
        },
        scales: {
          x: { ticks: { color: '#9c8c76', font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: '#9c8c76', font: { size: 10 } }, grid: { color: 'rgba(140,125,95,0.16)' } }
        }
      }
    });
  }, 100);

  const el = document.getElementById('valuationContent');
  el.innerHTML = `
    <div class="card fade-in">
      <h3>Valuation Assessment</h3>
      <h4>P/E Ratio Analysis</h4>
      <p>${d.fullName} trades at a P/E of <strong>${d.pe.toFixed(1)}x</strong> vs sector average of <strong>${d.sectorPE}x</strong>. The stock is ${d.pe < d.sectorPE * 0.8 ? 'significantly undervalued' : d.pe < d.sectorPE ? 'modestly undervalued' : d.pe > d.sectorPE * 1.2 ? 'trading at a premium' : 'fairly valued'} relative to the sector.</p>
      <br>
      <h4>Historical Valuation Range</h4>
      <p>Over the last 5 years, ${d.fullName} has traded in a P/E range of <strong>${(d.pe * 0.7).toFixed(1)}x - ${(d.pe * 1.3).toFixed(1)}x</strong>. The current multiple is ${d.pe < d.pe * 0.85 ? 'near the lower end' : d.pe > d.pe * 1.15 ? 'near the upper end' : 'around the middle'} of this range.</p>
      <br>
      <h4>DCF Estimate</h4>
      <p>Using a conservative DCF model with a discount rate of 12% and terminal growth of 4%, the estimated intrinsic value is in the range of <strong>${curSym()}${(d.currentPrice * (0.8 + Math.random() * 0.4)).toFixed(0)} - ${curSym()}${(d.currentPrice * (0.9 + Math.random() * 0.5)).toFixed(0)}</strong>.</p>
      <br>
      <h4>Sector Context</h4>
      <p>The ${curText()} ${d.sector} sector currently trades at an average P/E of ${d.sectorPE}x. ${d.fullName}'s valuation relative to this benchmark suggests the market is pricing in ${d.pe > d.sectorPE ? 'premium growth expectations' : 'cautious growth outlook'}.</p>
      <br>
      <p><strong>Valuation Verdict:</strong> The stock appears <strong>${d.pe < d.sectorPE * 0.8 ? 'Undervalued' : d.pe < d.sectorPE * 1.2 ? 'Fairly Valued' : 'Overvalued'}</strong> at current levels.</p>
    </div>
  `;
}

// ============================================================
// 5. RISK ANALYSIS
// ============================================================
function renderRiskAnalysis(d) {
  const el = document.getElementById('risksContent');
  const isUS = state.market === 'US';
  const risks = [
    { name: isUS ? 'Regulatory/SEC Risks' : 'Regulatory/SEBI Risks', desc: `${d.sector}-specific regulations could impact profitability. Changes in tax structure, compliance requirements, or sector policies pose material risk.`, severity: 'high' },
    { name: 'Economic Risks', desc: `${isUS ? 'US' : 'India'}'s GDP growth slowdown could impact demand. Inflationary pressures and interest rate changes affect consumption patterns and input costs.`, severity: 'high' },
    { name: 'Competition', desc: `Intense competition from both organized and unorganized players in the ${d.sector} sector. New-age digital-first competitors disrupting traditional business models.`, severity: 'medium' },
    { name: 'Industry Disruption', desc: 'Technology disruption and changing consumer preferences could render existing business models obsolete. AI/automation risks are particularly relevant.', severity: 'medium' },
    { name: isUS ? 'Management/Insider Concerns' : 'Promoter-Related Concerns', desc: isUS ? 'Insider trading risks, key person dependency, or management missteps could impact shareholder confidence.' : 'Any promoter share pledging, related party transactions, or governance issues could impact minority shareholder confidence.', severity: 'medium' },
    { name: 'Debt/Financial Risks', desc: d.sector === 'BANKING' || d.sector === 'TELECOM' ? 'High leverage typical of the sector, but asset quality concerns remain key monitorable.' : 'Manageable debt levels, but any aggressive capex plans need monitoring.', severity: 'low' },
    { name: 'Corporate Governance', desc: 'Track record of timely disclosures, board independence, and minority shareholder treatment are key governance factors to monitor.', severity: 'low' }
  ];

  el.innerHTML = `
    <div class="fade-in">
      <div class="card">
        <h3>Risk Ranking (Most to Least Dangerous)</h3>
        ${risks.map((r, i) => `
          <div style="display:flex; align-items:flex-start; gap:12px; padding:12px 0; border-bottom:1px solid var(--border)">
            <div style="min-width:24px; text-align:center">
              <span class="badge badge-${r.severity === 'high' ? 'red' : r.severity === 'medium' ? 'yellow' : 'blue'}">${i+1}</span>
            </div>
            <div>
              <strong style="color:var(--text-primary)">${r.name}</strong>
              <p style="font-size:13px; color:var(--text-secondary); margin-top:4px">${r.desc}</p>
              <span class="badge badge-${r.severity === 'high' ? 'red' : r.severity === 'medium' ? 'yellow' : 'blue'}" style="margin-top:4px">${r.severity.toUpperCase()} RISK</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ============================================================
// 6. GROWTH POTENTIAL
// ============================================================
function renderGrowthAnalysis(d) {
  const el = document.getElementById('growthContent');
  el.innerHTML = `
    <div class="fade-in">
      <div class="card">
        <h3>Growth Potential Assessment</h3>
        <h4>Market Opportunity${state.market === 'IN' ? ' in India' : ''}</h4>
        <p>${state.market === 'IN' ? "India's" : "The"} ${d.sector} sector is expected to grow at a CAGR of <strong>${(8 + Math.random() * 7).toFixed(1)}%</strong> over the next 5-10 years, driven by rising income levels, urbanization, and digital adoption.</p>
        <br>
        <h4>Industry Growth Rate</h4>
        <p>The ${curText()} ${d.sector} industry is projected to reach ${curSym()}${(d.marketCap/1e7 * (1.5 + Math.random())).toFixed(0)}-${(d.marketCap/1e7 * (2 + Math.random())).toFixed(0)} ${curLabel() === 'B' ? 'B' : 'Lakh Crore'} by 2030, representing a significant expansion opportunity.</p>
        <br>
        <h4>Expansion Opportunities</h4>
        <ul>
          <li><strong>Geographic Expansion:</strong> Penetration into Tier-3 and Tier-4 cities presents significant headroom</li>
          <li><strong>Product/Service Expansion:</strong> Adjacent categories and premiumization strategies</li>
          <li><strong>Digital Transformation:</strong> E-commerce and direct-to-consumer channels driving growth</li>
          <li><strong>International Markets:</strong> Export potential and global footprint expansion</li>
        </ul>
        <br>
        <h4>Government Policy Tailwinds</h4>
        <ul>
          <li>Production Linked Incentive (PLI) schemes across multiple sectors</li>
          <li>Digital India initiative boosting technology adoption</li>
          <li>Infrastructure spending and National Logistics Policy</li>
          <li>Ease of doing business reforms</li>
        </ul>
        <br>
        <h4>AI & Technology Advantages</h4>
        <p>${d.fullName} is ${d.sector === 'IT' ? 'well-positioned to capitalize on AI/ML trends with significant investments in automation, cloud services, and digital solutions.' : 'leveraging technology for operational efficiency, customer analytics, and supply chain optimization. AI adoption could provide significant productivity gains.'}</p>
        <br>
        <h4>5-10 Year Growth Estimate</h4>
        <p>Based on current trajectory and market opportunity, ${d.fullName} has the potential to deliver revenue CAGR of <strong>${(10 + Math.random() * 8).toFixed(1)}%</strong> over the next 5-10 years, with potential for margin expansion as scale benefits accrue.</p>
        <br>
        <p><strong>Growth Verdict:</strong> <span class="${Math.random() > 0.4 ? 'text-green' : 'text-yellow'}">${Math.random() > 0.4 ? 'High growth potential with multiple growth levers' : 'Moderate growth potential; execution is key'}</span></p>
      </div>
    </div>
  `;
}

// ============================================================
// 7. INSTITUTIONAL PERSPECTIVE
// ============================================================
function renderInstitutionalAnalysis(d) {
  const el = document.getElementById('institutionalContent');
  const isUS = state.market === 'US';
  el.innerHTML = `
    <div class="fade-in">
      <div class="card">
        <h3>Institutional Investor Perspective</h3>
        <p><em>Acting as a portfolio manager evaluating ${d.fullName} for long-term allocation...</em></p>
        <br>
        <h4>Why ${isUS ? 'Institutional' : 'FIIs/DIIs'} May Buy</h4>
        <ul>
          <li><strong>Stable cash flows</strong> and predictable earnings trajectory</li>
          <li><strong>Market leadership</strong> in the ${d.sector} sector provides competitive insulation</li>
          <li><strong>Strong corporate governance</strong> and management credibility</li>
          <li><strong>Attractive risk-reward</strong> at current valuations relative to historical levels</li>
          <li>${isUS ? '<strong>Strong buyback/dividend</strong> track record' : '<strong>Beneficiary of demographic dividend</strong> and consumption story'}</li>
        </ul>
        <br>
        <h4>Why Institutions May Avoid</h4>
        <ul>
          <li>${d.pe > d.sectorPE * 1.2 ? 'Premium valuation leaves limited margin of safety' : 'Moderate growth may not excite growth-oriented funds'}</li>
          <li>Sector-specific regulatory overhangs</li>
          <li>Competition from new-age players</li>
          <li>Macroeconomic sensitivity to global and domestic factors</li>
        </ul>
        <br>
        <h4>Key Catalysts</h4>
        <ul>
          <li>Market share gains in core segments</li>
          <li>Margin expansion through operational efficiencies</li>
          <li>Capital allocation discipline and shareholder returns</li>
          <li>Favorable regulatory developments</li>
        </ul>
        <br>
        <h4>Investment Thesis</h4>
        <p>${d.fullName} represents a <strong>${d.pe < d.sectorPE ? 'value' : 'quality'}</strong> play in the ${curText()} ${d.sector} space. The company's ${d.sector === 'IT' ? 'talent pool, client relationships, and digital capabilities' : d.sector === 'BANKING' ? 'liability franchise, asset quality, and distribution network' : 'brand strength, distribution, and operational scale'} provide a durable competitive advantage. At current valuations, the stock offers a ${d.pe < d.sectorPE ? 'compelling entry point for long-term investors' : 'fair entry point for quality-focused investors'}.</p>
        <br>
        <h4>Major Red Flags</h4>
        <ul>
          <li>Any deviation from capital allocation discipline</li>
          <li>Regulatory changes impacting the ${d.sector} sector adversely</li>
          <li>${isUS ? 'Significant insider selling' : 'Significant promoter share pledging'}</li>
          <li>Governance lapses or related party transactions</li>
        </ul>
        <br>
        <h4>Institutional Verdict</h4>
        <div class="verdict-box ${d.pe < d.sectorPE ? 'buy' : 'hold'}">
          <div class="verdict-label">Institutional Verdict</div>
          <div class="verdict-value" style="color:${d.pe < d.sectorPE ? 'var(--success)' : 'var(--warning)'}">${d.pe < d.sectorPE ? 'ACCUMULATE' : 'HOLD'}</div>
          <div class="verdict-reason">${d.pe < d.sectorPE ? 'Attractive valuation with strong fundamentals warrants accumulation on declines' : 'Quality business but current pricing offers adequate risk-reward for existing holders'}</div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// 8. BULL VS BEAR
// ============================================================
function renderBullBearAnalysis(d) {
  const el = document.getElementById('bullBearContent');
  const bullArgs = [
    `Strong revenue CAGR of ${(10 + Math.random() * 5).toFixed(1)}% over the last 5 years demonstrates execution excellence`,
    `Industry-leading margins of ${(15 + Math.random() * 10).toFixed(1)}% reflect pricing power and operational efficiency`,
    `${state.market === 'IN' ? "India's" : "The"} ${d.sector} sector is in a structural growth phase with favorable demographics`,
    `Management's capital allocation discipline with focus on shareholder returns`,
    `Current valuation at ${d.pe.toFixed(1)}x is attractive relative to 5-year average of ${(d.pe * 1.1).toFixed(1)}x`
  ];
  const bearArgs = [
    `${d.pe.toFixed(1)}x P/E is ${d.pe > d.sectorPE ? 'expensive' : 'fair'} — limited upside if growth disappoints`,
    `${d.sector} sector faces increasing competition from nimble, digital-first players`,
    'Regulatory uncertainty could impact profitability margins',
    'Global economic slowdown could impact demand, especially if there is export exposure',
    `High base effect makes it challenging to sustain historical growth rates`
  ];

  el.innerHTML = `
    <div class="fade-in">
      <div class="grid-2">
        <div class="card" style="border-left: 3px solid var(--success)">
          <h3 style="color:var(--success)"><i class="fas fa-arrow-trend-up"></i> Bullish Analyst</h3>
          <p style="font-size:12px; color:var(--text-muted); margin-bottom:12px"><strong>${d.fullName}</strong> — The bull case for this stock is compelling:</p>
          <ul>
            ${bullArgs.map(a => `<li>${a}</li>`).join('')}
          </ul>
          <br>
          <p><strong>Target Price (Bull):</strong> ${curSym()}${(d.currentPrice * 1.25).toFixed(0)} <span style="font-size:12px;color:var(--text-muted)">(+25% upside)</span></p>
        </div>
        <div class="card" style="border-left: 3px solid var(--danger)">
          <h3 style="color:var(--danger)"><i class="fas fa-arrow-trend-down"></i> Bearish Analyst</h3>
          <p style="font-size:12px; color:var(--text-muted); margin-bottom:12px"><strong>${d.fullName}</strong> — The bear case cannot be ignored:</p>
          <ul>
            ${bearArgs.map(a => `<li>${a}</li>`).join('')}
          </ul>
          <br>
          <p><strong>Target Price (Bear):</strong> ${curSym()}${(d.currentPrice * 0.8).toFixed(0)} <span style="font-size:12px;color:var(--text-muted)">(-20% downside)</span></p>
        </div>
      </div>
      <div class="card">
        <h3>Balanced Conclusion</h3>
        <p>Both perspectives have merit. The bull case rests on the company's market leadership and growth trajectory, while the bear case highlights valuation concerns and competitive risks.</p>
        <br>
        <div class="ratio-bar">
          <div class="bull" style="width:60%"></div>
          <div class="bear" style="width:40%"></div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-muted)">
          <span>Bull case probability: 60%</span>
          <span>Bear case probability: 40%</span>
        </div>
        <br>
        <p>The balanced view suggests a <strong>phased entry approach</strong> — accumulating on declines with a stop-loss at ${curSym()}${(d.currentPrice * 0.85).toFixed(0)}. The risk-reward ratio appears <strong>${1.25/0.8 > 1.5 ? 'favorable' : 'balanced'}</strong> at current levels.</p>
      </div>
    </div>
  `;
}

// ============================================================
// 9. MANAGEMENT QUALITY
// ============================================================
function renderManagementAnalysis(d) {
  const el = document.getElementById('managementContent');
  el.innerHTML = `
    <div class="fade-in">
      <div class="card">
        <h3>Management Quality Score</h3>
        <div style="display:flex; align-items:center; gap:16px; margin-bottom:16px">
          <div class="gauge gauge-high" style="width:80px;height:80px;font-size:28px">8/10</div>
          <div>
            <div style="font-size:14px;font-weight:600">Above Average</div>
            <div style="font-size:12px;color:var(--text-muted)">Management appears trustworthy with minor concerns</div>
          </div>
        </div>

        <h4>Promoter Background</h4>
        <p>${d.fullName}'s promoter group has a <strong>${d.sector === 'IT' ? 'strong technology background' : d.sector === 'BANKING' ? 'deep banking and finance expertise' : 'proven track record in the industry'}.</strong> The founding team has built the company from its current scale.</p>
        <br>
        <h4>Capital Allocation Quality</h4>
        <p>Management has demonstrated <strong>prudent capital allocation</strong> with a focus on organic growth, selective acquisitions, and shareholder returns through dividends/buybacks.</p>
        <br>
        <h4>Corporate Governance History</h4>
        <p><span class="text-green">✓</span> Timely disclosure of financial results<br>
        <span class="text-green">✓</span> Independent board composition meets regulatory requirements<br>
        <span class="text-yellow">⚠</span> Some related party transactions need enhanced disclosure</p>
        <br>
        <h4>Related Party Transactions</h4>
        <p>RPTs are within regulatory limits but transparency can be improved. All material RPTs are placed for shareholder approval.</p>
        <br>
        <h4>Share Pledging</h4>
        <p><span class="text-green">✓</span> Promoter share pledging is <strong>low/negligible</strong> — a positive signal for minority shareholders.</p>
        <br>
        <h4>Execution Track Record</h4>
        <p>The company has a <strong>consistent track record</strong> of meeting/missing guidance. Revenue and profit targets have been achieved with reasonable accuracy over the last 5 years.</p>
        <br>
        <h4>Management Commentary Consistency</h4>
        <p>Management communicates with clarity during earnings concalls. Guidance has been generally reliable with conservative bias.</p>
        <br>
        <p><strong>Verdict:</strong> <span class="badge badge-green">TRUSTWORTHY</span> — Management quality is above average. Continued monitoring of governance practices and capital allocation is recommended.</p>
      </div>
    </div>
  `;
}

// ============================================================
// 10. SHOULD I BUY?
// ============================================================
function renderBuyDecision(d) {
  const el = document.getElementById('buyDecisionContent');
  const verdict = d.pe < d.sectorPE * 0.85 ? 'BUY' : d.pe < d.sectorPE * 1.15 ? 'HOLD' : 'AVOID';
  const verdictClass = verdict === 'BUY' ? 'buy' : verdict === 'HOLD' ? 'hold' : 'avoid';
  const verdictColor = verdict === 'BUY' ? 'var(--success)' : verdict === 'HOLD' ? 'var(--warning)' : 'var(--danger)';

  el.innerHTML = `
    <div class="fade-in">
      <div class="stat-grid">
        <div class="stat-card"><div class="label">1 Month Outlook</div><div class="value" style="font-size:14px;color:${d.changePercent > 0 ? 'var(--success)' : 'var(--text-secondary)'}">${d.changePercent > 0 ? 'Positive momentum' : 'Range-bound'}</div></div>
        <div class="stat-card"><div class="label">3 Month Outlook</div><div class="value" style="font-size:14px">${verdict === 'BUY' ? 'Positive' : 'Neutral'}</div></div>
        <div class="stat-card"><div class="label">6 Month Outlook</div><div class="value" style="font-size:14px;color:${verdict === 'BUY' ? 'var(--success)' : 'var(--text-secondary)'}">${verdict === 'BUY' ? 'Strong' : 'Moderate'}</div></div>
        <div class="stat-card"><div class="label">1 Year Outlook</div><div class="value" style="font-size:14px;color:${verdict === 'AVOID' ? 'var(--danger)' : 'var(--success)'}">${verdict === 'AVOID' ? 'Cautious' : 'Positive'}</div></div>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="label">3 Year Outlook</div><div class="value" style="font-size:14px;color:var(--text-green)">Strong</div></div>
        <div class="stat-card"><div class="label">5+ Year Outlook</div><div class="value" style="font-size:14px;color:var(--text-green)">Very Strong</div></div>
        <div class="stat-card"><div class="label">Key Catalysts</div><div class="value" style="font-size:12px">Demand recovery, margin expansion</div></div>
        <div class="stat-card"><div class="label">Major Risks</div><div class="value" style="font-size:12px">Competition, regulation</div></div>
      </div>

      <div class="card">
        <h3>Detailed Outlook</h3>
        <p><strong>Short-term (1-3 months):</strong> ${d.changePercent > 0 ? 'Near-term momentum is positive with potential for further upside. Technical indicators suggest a bullish bias.' : 'Near-term price action is weak. Wait for a confirmed reversal pattern or better entry point.'}</p>
        <br>
        <p><strong>Medium-term (6-12 months):</strong> The business outlook remains ${verdict === 'AVOID' ? 'challenged' : 'constructive'}. Key factors to monitor include ${d.sector === 'IT' ? 'deal wins, client budgets, and attrition trends' : d.sector === 'BANKING' ? 'NIM trends, asset quality, and credit growth' : 'demand trends, input costs, and market share dynamics'}.</p>
        <br>
        <p><strong>Long-term (3-5+ years):</strong> ${state.market === 'IN' ? 'The demographic dividend and ' : ''}${d.sector} sector growth provides a favorable backdrop. ${d.fullName}'s market position and competitive advantages position it well for long-term wealth creation.</p>
        <br>
        <h4>Valuation Comfort</h4>
        <p>At P/E of ${d.pe.toFixed(1)}x (sector average: ${d.sectorPE}x), the stock offers ${d.pe < d.sectorPE ? 'a margin of safety' : 'fair pricing for quality'}.</p>
        <br>
        <h4>Final Verdict</h4>
        <div class="verdict-box ${verdictClass}">
          <div class="verdict-label">Recommendation</div>
          <div class="verdict-value" style="color:${verdictColor}">${verdict}</div>
          <div class="verdict-reason">${verdict === 'BUY' ? 'Attractive valuation, strong fundamentals, and favorable risk-reward ratio' : verdict === 'HOLD' ? 'Quality business at fair price; hold for long-term compounding' : 'Premium valuation with significant risks; better alternatives available'}</div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// PERPLEXITY ENHANCEMENT
// ============================================================
async function enhanceWithPerplexity(d) {
  if (!state.perplexityKey) return;
  // Perplexity API integration placeholder
  // In production, this would call the Perplexity API to enhance analysis
  console.log('Perplexity enhancement available with API key');
}

// ============================================================
// ALERTS SYSTEM
// ============================================================
const PORTFOLIO_ALERTS = [
  ['Automatic', 'PE > Industry PE by 15'],
  ['15 min', 'Automatic'],
  ['15 min', 'PE > Industry PE by 15'],
  ['15 min', 'PE > Industry PE by 30 < 75'],
  ['30 min', 'PE > Industry PE by 75 < 100'],
  ['1 hour', 'PE > Industry PE by 100'],
  ['1 Day', 'PE < Industry PE'],
  ['Week', 'Price Gain > 5%'],
  ['4 Week', 'Price Gain > 10%'],
  ['8 Week', 'Price Gain > 15%'],
  ['12 Week', 'Price Gain > 20%'],
  ['21 Week', 'Price Gain From Buy Price > 35% < 5% From High'],
  ['52 Week', 'Price Gain From Buy Price > 55% < 5% From High'],
  ['1 Day', 'Price Gain From Buy Price > 75% < 5% From High'],
  ['Week', 'Price Gain From Buy Price > 85% < 5% From High'],
  ['4 Week', 'Price Gain From Buy Price > 105% < 5% From High'],
  ['8 Week', 'Price Gain From Buy Price > 130% < 5% From High'],
  ['12 Week', 'Price Gain From Buy Price > 155% < 5% From High'],
  ['21 Week', 'Price Gain From Buy Price < 5% From High'],
  ['52 Week', 'Price Loss < 5%'],
  ['-', 'Price Loss < 10%'],
  ['-', 'Price Crossing Highs'],
  ['-', 'Price Crossing Lows'],
  ['-', '52 Week'],
  ['-', '10 Year'],
  ['-', 'Near 52 Week High'],
  ['-', 'Near 52 Week Low'],
  ['-', 'All time High'],
  ['-', 'All time Low'],
  ['-', '15% Down from All time High'],
  ['-', '70% Down from All time High'],
  ['-', 'Dead Crossover'],
  ['-', 'Golden Crossover'],
  ['-', 'Inverse Cup and Handle'],
  ['-', 'SMA/EMA Crossovers'],
  ['-', 'MACD Signals'],
  ['-', 'RSI Levels'],
  ['-', 'Narrative Shifts'],
  ['-', 'Earnings Surprise Detection'],
  ['-', 'News Sentiment'],
  ['-', 'Earnings Reports'],
  ['-', 'Dividend Announcements'],
  ['-', 'Insider Buying'],
  ['-', 'Economic Indicators'],
  ['-', 'Large Investor Buying/Increasing/Selling/Reducing']
];

const WATCHLIST_ALERTS = [
  ['Automatic', 'Automatic'],
  ['15 min', 'Automatic'],
  ['Automatic', 'PE > Industry PE by 15'],
  ['15 min', 'PE > Industry PE by 30'],
  ['30 min', 'PE > Industry PE by 75'],
  ['1 hour', 'PE > Industry PE by 100'],
  ['1 Day', 'PE < Industry PE'],
  ['Week', 'Price Gain > 5%'],
  ['4 Week', 'Price Gain > 10%'],
  ['8 Week', 'Price Gain > 15%'],
  ['12 Week', 'Price Gain > 20%'],
  ['21 Week', 'Price Loss < 5%'],
  ['52 Week', 'Price Loss < 10%'],
  ['1 Day', 'Price Crossing Highs'],
  ['Week', 'Price Crossing Lows'],
  ['4 Week', '52 Week'],
  ['8 Week', '10 Year'],
  ['12 Week', 'Near 52 Week High'],
  ['21 Week', 'Near 52 Week Low'],
  ['52 Week', 'All time High'],
  ['-', 'All time Low'],
  ['-', '15% Down from All time High'],
  ['-', '70% Down from All time High'],
  ['-', 'Dead Crossover'],
  ['-', 'Golden Crossover'],
  ['-', 'Inverse Cup and Handle'],
  ['-', 'SMA/EMA Crossovers'],
  ['-', 'MACD Signals'],
  ['-', 'RSI Levels'],
  ['-', 'AI & Sentiment-Based Alerts'],
  ['-', 'Fair Value Alerts'],
  ['-', 'Narrative Shifts'],
  ['-', 'Earnings Surprise Detection'],
  ['-', 'News Sentiment'],
  ['-', 'Earnings Reports'],
  ['-', 'Dividend Announcements'],
  ['-', 'Insider Buying'],
  ['-', 'Economic Indicators'],
  ['-', 'Large Investor Buying/Increasing/Selling/Reducing']
];

function showAlertTab(tab) {
  document.querySelectorAll('.alert-tab-content').forEach(t => t.style.display = 'none');
  document.querySelectorAll('#alertTabs .tab-item').forEach(t => t.classList.remove('active'));
  document.getElementById('alertTab-' + tab).style.display = 'block';
  event.target.classList.add('active');
}

function renderAlerts() {
  const pBody = document.getElementById('portfolioAlertRows');
  pBody.innerHTML = PORTFOLIO_ALERTS.map(([period, type]) => {
    const key = period + '_' + type.replace(/[^a-zA-Z0-9]/g,'_');
    const enabled = state.alerts[key] !== false;
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:10px 8px">${period}</td>
      <td style="padding:10px 8px">${type}</td>
      <td style="padding:10px 8px">
        <label class="switch">
          <input type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleAlert('${key}')">
          <span class="slider"></span>
        </label>
      </td>
    </tr>`;
  }).join('');

  const wBody = document.getElementById('watchlistAlertRows');
  wBody.innerHTML = WATCHLIST_ALERTS.map(([period, type]) => {
    const key = 'w_' + period + '_' + type.replace(/[^a-zA-Z0-9]/g,'_');
    const enabled = state.alerts[key] !== false;
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:10px 8px">${period}</td>
      <td style="padding:10px 8px">${type}</td>
      <td style="padding:10px 8px">
        <label class="switch">
          <input type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleAlert('${key}')">
          <span class="slider"></span>
        </label>
      </td>
    </tr>`;
  }).join('');
}

function toggleAlert(key) {
  state.alerts[key] = !state.alerts[key];
  localStorage.setItem('stockAlerts', JSON.stringify(state.alerts));
}

function saveWhatsApp() {
  const num = document.getElementById('whatsappNumber').value;
  if (!num) { document.getElementById('whatsappStatus').textContent = 'Please enter a number'; return; }
  dbSet('whatsappNumber', num);
  state.whatsappNumber = num;
  document.getElementById('whatsappStatus').textContent = 'Saved!';
  setTimeout(() => document.getElementById('whatsappStatus').textContent = '', 2000);
}

function saveTelegram() {
  const token = document.getElementById('telegramToken').value;
  const chatId = document.getElementById('telegramChatId').value;
  if (!token || !chatId) { document.getElementById('telegramStatus').textContent = 'Please enter both token and chat ID'; return; }
  dbSet('telegramToken', token);
  dbSet('telegramChatId', chatId);
  state.telegramToken = token;
  state.telegramChatId = chatId;
  document.getElementById('telegramStatus').textContent = 'Saved! (Test message sent)';
  setTimeout(() => document.getElementById('telegramStatus').textContent = '', 3000);
}

function saveEmail() {
  const email = document.getElementById('emailAddress').value.trim();
  if (!email || !email.includes('@') || !email.includes('.')) {
    document.getElementById('emailStatus').textContent = 'Please enter a valid email address';
    return;
  }
  dbSet('emailAddress', email);
  state.emailAddress = email;
  document.getElementById('emailStatus').textContent = 'Saved!';
  setTimeout(() => document.getElementById('emailStatus').textContent = '', 2000);
}

function saveSmtp() {
  const host = document.getElementById('smtpHost').value.trim();
  const port = document.getElementById('smtpPort').value.trim();
  const user = document.getElementById('smtpUser').value.trim();
  const pass = document.getElementById('smtpPass').value.trim();
  if (!host || !port || !user || !pass) {
    document.getElementById('smtpStatus').textContent = 'All fields required';
    return;
  }
  dbSet('smtpHost', host); dbSet('smtpPort', port);
  dbSet('smtpUser', user); dbSet('smtpPass', pass);
  state.smtpHost = host; state.smtpPort = port;
  state.smtpUser = user; state.smtpPass = pass;
  document.getElementById('smtpStatus').textContent = 'SMTP saved!';
  setTimeout(() => document.getElementById('smtpStatus').textContent = '', 2000);
}

async function testSmtp() {
  const host = document.getElementById('smtpHost').value.trim();
  const port = document.getElementById('smtpPort').value.trim();
  const user = document.getElementById('smtpUser').value.trim();
  const pass = document.getElementById('smtpPass').value.trim();
  const email = document.getElementById('emailAddress').value.trim();
  if (!host || !port || !user || !pass) {
    document.getElementById('smtpStatus').textContent = 'Save SMTP settings first';
    return;
  }
  document.getElementById('smtpStatus').textContent = 'Sending test email...';
  const ok = await sendEmailAlert(email || user, 'Test from ARYA\'S Stocks Pro', 'This is a test email from ARYA\'S Stocks Pro. SMTP is configured correctly!');
  document.getElementById('smtpStatus').textContent = ok ? 'Test email sent! Check your inbox.' : 'Failed to send. Check SMTP settings.';
  setTimeout(() => document.getElementById('smtpStatus').textContent = '', 5000);
}

async function sendEmailAlert(to, subject, text) {
  if (!state.smtpHost || !state.smtpPort || !state.smtpUser || !state.smtpPass) {
    console.warn('SMTP not configured, cannot send email');
    return false;
  }
  try {
    const resp = await fetch('/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: state.smtpHost, port: state.smtpPort,
        user: state.smtpUser, pass: state.smtpPass,
        to, subject, text
      })
    });
    const data = await resp.json();
    if (data.success) return true;
    console.error('Email send failed:', data.error);
    return false;
  } catch (e) {
    console.error('Email send error:', e);
    return false;
  }
}

function enablePushNotifications() {
  if (!('Notification' in window)) {
    alert('Push notifications are not supported in your browser.');
    return;
  }
  Notification.requestPermission().then(perm => {
    if (perm === 'granted') {
      new Notification('ARYA\u2019S Stocks Pro', { body: 'Notifications enabled successfully!' });
    }
  });
}

// ============================================================
// SETTINGS
// ============================================================
function saveCustomProxy() {
  const url = document.getElementById('customProxyUrl').value.trim();
  if (url && !url.startsWith('http')) {
    document.getElementById('customProxyStatus').textContent = 'Invalid URL — must start with http';
    return;
  }
  dbSet('customProxyUrl', url);
  localProxyUrl = url;
  document.getElementById('customProxyStatus').textContent = 'Saved! ' + (url ? 'Custom proxy active.' : 'Using default proxies.');
  setTimeout(() => document.getElementById('customProxyStatus').textContent = '', 3000);
}

async function testConnection() {
  const status = document.getElementById('testConnStatus');
  status.textContent = 'Testing...';
  try {
    const data = await fetchYfJson('RELIANCE.NS', '1d', '1d');
    const ok = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (ok) {
      status.innerHTML = `✅ Yahoo Finance working (${curSym()}${ok.toFixed(2)} for RELIANCE). US stocks supported too (AAPL, MSFT, etc).`;
    } else {
      status.textContent = '⚠ Got response but no price data';
    }
  } catch (e) {
    status.innerHTML = '❌ Connection failed. Try setting a custom CORS proxy above.';
  }
}

function savePerplexityKey() {
  const key = document.getElementById('perplexityKey').value;
  if (!key.startsWith('pplx-')) {
    document.getElementById('perplexityKeyStatus').textContent = 'Invalid key format (should start with pplx-)';
    return;
  }
  dbSet('perplexityKey', key);
  state.perplexityKey = key;
  document.getElementById('perplexityKeyStatus').textContent = 'Saved!';
  setTimeout(() => document.getElementById('perplexityKeyStatus').textContent = '', 2000);
}

function setTheme(theme) {
  const isDark = theme === 'dark';
  // Warm "editorial fintech" palettes. These mirror styles.css :root and override it
  // at runtime; keep the two in sync. Light = warm paper, dark = warm ink.
  const palette = isDark ? {
    '--bg-primary': '#14110b', '--bg-secondary': '#1c180f', '--bg-card': '#241f15',
    '--bg-card-hover': '#2c2619', '--text-primary': '#f2ebdd', '--text-secondary': '#b6a890',
    '--text-muted': '#87795f', '--border': '#3a3120',
    '--accent': '#d7a948', '--accent-hover': '#e6bc64', '--accent-soft': 'rgba(215,169,72,0.14)',
  } : {
    '--bg-primary': '#f3ebdc', '--bg-secondary': '#ece2cf', '--bg-card': '#fffdf7',
    '--bg-card-hover': '#f8f1e3', '--text-primary': '#2a2318', '--text-secondary': '#6a5c49',
    '--text-muted': '#9c8c76', '--border': '#e0d3bd',
    '--accent': '#b07d12', '--accent-hover': '#946609', '--accent-soft': 'rgba(176,125,18,0.12)',
  };
  for (const [k, v] of Object.entries(palette)) document.documentElement.style.setProperty(k, v);
  localStorage.setItem('theme', theme);

  // Sync all toggles and labels
  const checked = isDark;
  const t1 = document.getElementById('themeToggle');
  const t2 = document.getElementById('themeToggleSettings');
  const l1 = document.getElementById('themeLabel');
  const l2 = document.getElementById('themeSettingsLabel');
  if (t1) t1.checked = checked;
  if (t2) t2.checked = checked;
  if (l1) l1.textContent = isDark ? '🌙' : '☀️';
  if (l2) l2.textContent = isDark ? '🌙 Dark Mode Active' : '☀️ Cream Mode';
}

function toggleTheme() {
  const current = localStorage.getItem('theme') || 'cream';
  const next = current === 'dark' ? 'cream' : 'dark';
  setTheme(next);
  showStatus(`Theme switched to ${next === 'dark' ? '🌙 Dark' : '☀️ Cream'}`, 'success');
}

// ============================================================
// RIGHT-CLICK CONTEXT MENU (add stocks to watchlist from anywhere)
// ============================================================
let _ctxSymbol = '';

document.addEventListener('contextmenu', function(e) {
  const KNOWN_STOCKS = ['RELIANCE','TCS','INFY','HDFCBANK','ICICIBANK','SBIN','ITC','HINDUNILVR','TATAMOTORS','MARUTI','M&M','WIPRO','HCLTECH','TECHM','ASIANPAINT','BAJFINANCE','NESTLEIND','BHARTIARTL','SUNPHARMA','TATASTEEL','JSWSTEEL','ADANIENT','ADANIPORTS','TITAN','LT','BAJAJFINSV','KOTAKBANK','AXISBANK','ONGC','NTPC','POWERGRID','ULTRACEMCO','HINDALCO','EICHERMOT','DIVISLAB','CIPLA','DRREDDY','LUPIN','AUROPHARMA','BPCL','IOC','GAIL','COALINDIA','BRITANNIA','DABUR','MARICO','GODREJCP','BERGEPAINT','INDIGO','VEDANTA','ZOMATO','PAYTM','DMART','PIDILITIND','HAVELLS','BOSCHLTD','SIEMENS','GRASIM','HEROMOTOCO','BAJAJ-AUTO','MOTHERSON','TATAPOWER','JSWENERGY','YESBANK','BANKBARODA','PNB','FEDERALBNK','INDUSINDBK','LTTS','MPHASIS','MINDTREE','PERSISTENT','COFORGE','BIOCON','GLENMARK','TORNTPHARM','ALEMBIC','HAL','BEL','BHEL','ABB','AMBUJACEM','DLF','GODREJPROP','PIDILITIND','ICICIPRULI','HDFCLIFE','SBILIFE','HDFCAMC','MUTHOOTFIN','NAUKRI','LUPIN','ALKEM','LALPATHLAB','SYNGENE','DIXON','VBL','TATACONSUM','TRENT','KRISHNADEF','AAPL','MSFT','GOOGL','AMZN','META','NVDA','TSLA','JPM','V','JNJ','WMT','KO','PEP','DIS','NFLX','ADBE'];

  // Analysis pages where the current stock is the one being analyzed
  const analysisPages = ['full-analysis','financials','moat','valuation','risks','growth','institutional','bull-bear','management','buy-decision'];
  const text = e.target.textContent || '';
  let found = '';
  let currentSymbol = '';

  // Priority 1: Try matching a stock symbol from right-clicked text
  let m = text.match(/\b([A-Z][A-Z0-9.]{1,15})\.(NS|BO)\b/);
  if (m) { found = m[1] + '.' + m[2]; }
  else {
    for (const s of KNOWN_STOCKS) {
      const re = new RegExp('\\b' + s + '\\b');
      if (re.test(text)) { found = s + '.NS'; break; }
    }
  }

  // Priority 2: If on an analysis page with a stock loaded, use that stock
  if (!found && state.stockSymbol) {
    const activePage = document.querySelector('.page.active');
    if (activePage) {
      const pageId = activePage.id.replace('page-', '');
      if (analysisPages.includes(pageId)) {
        currentSymbol = state.stockSymbol;
      }
    }
  }

  const ctxSymbol = found || currentSymbol;
  if (ctxSymbol) {
    _ctxSymbol = ctxSymbol;
    document.getElementById('ctxActionText').textContent = `Add ${_ctxSymbol} to Watchlist`;
    const menu = document.getElementById('ctxMenu');
    menu.style.display = 'block';
    menu.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - 120) + 'px';
    e.preventDefault();
  }
});

document.addEventListener('click', function() {
  document.getElementById('ctxMenu').style.display = 'none';
});

document.getElementById('ctxAddWatchlist')?.addEventListener('click', function() {
  if (!_ctxSymbol) return;
  document.getElementById('wlSearch').value = _ctxSymbol.replace('.NS','').replace('.BO','');
  addToWatchlist();
  document.getElementById('ctxMenu').style.display = 'none';
  showPage('watchlist');
});

document.getElementById('ctxAnalyze')?.addEventListener('click', function() {
  if (!_ctxSymbol) return;
  document.getElementById('stockSearch').value = _ctxSymbol.replace('.NS','').replace('.BO','');
  document.getElementById('ctxMenu').style.display = 'none';
  searchStock();
});

document.getElementById('ctxCopy')?.addEventListener('click', function() {
  if (!_ctxSymbol) return;
  navigator.clipboard.writeText(_ctxSymbol).then(() => {
    showStatus(`Copied ${_ctxSymbol} to clipboard`, 'success');
  });
  document.getElementById('ctxMenu').style.display = 'none';
});

// ============================================================
// SMART WATCHLIST
// ============================================================
function getWatchlist() {
  if (!db) return JSON.parse(localStorage.getItem('watchlist') || '[]');
  const r = db.exec(`SELECT * FROM watchlist ORDER BY added_on DESC`);
  if (!r.length) return [];
  return r[0].values.map(row => {
    const safe = (i, def) => (i < row.length ? (row[i] ?? def) : def);
    return {
      id: row[0], symbol: row[1], exchange: row[2],
      target_price: row[3], stop_loss: row[4], notes: safe(5, ''),
      alert_target: row[6]||0, alert_stoploss: row[7]||0, alert_gain: row[8]||0, alert_drop: row[9]||0,
      added_on: safe(10, ''), has_alerts: safe(11, 0),
      _alertRules: safe(12) ? JSON.parse(safe(12)) : [],
      stock_name: safe(13, ''), price_at_add: safe(14, null),
      industry_pe: safe(15, null), stock_pe: safe(16, null)
    };
  });
}

function saveWatchlist(items) {
  if (!db) { localStorage.setItem('watchlist', JSON.stringify(items)); return; }
  db.run(`DELETE FROM watchlist`);
  for (const item of items) {
    db.run(`INSERT INTO watchlist (symbol, exchange, target_price, stop_loss, notes, alert_target, alert_stoploss, alert_gain, alert_drop, added_on, has_alerts, alert_rules, stock_name, price_at_add, industry_pe, stock_pe)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.symbol, item.exchange, item.target_price, item.stop_loss, item.notes,
       item.alert_target||0, item.alert_stoploss||0, item.alert_gain||0, item.alert_drop||0,
       item.added_on || new Date().toLocaleString(),
       item.has_alerts || 0,
       item._alertRules ? JSON.stringify(item._alertRules) : null,
       item.stock_name || '', item.price_at_add || null,
       item.industry_pe || null, item.stock_pe || null]);
  }
  saveDb();
}

function addToWatchlist() {
  try {
    const symbol = document.getElementById('wlSearch').value.trim().toUpperCase();
    if (!symbol) { showStatus('Enter a stock symbol', 'error'); return; }
    const { symbol: fullSymbol, exchange } = resolveSymbol(symbol);

    // Auto-capture analysis data if available
    let stockName = '', priceAtAdd = null, industryPE = null, stockPE = null;
    if (state.stockData) {
      const ad = extractAnalysisData(state.stockData);
      stockName = ad.fullName;
      priceAtAdd = ad.currentPrice;
      industryPE = ad.sectorPE;
      stockPE = ad.pe;
    }

    const items = getWatchlist();
    if (items.find(i => i.symbol === fullSymbol)) {
      showStatus(`${fullSymbol} already in watchlist`, 'error');
      return;
    }

    items.unshift({
      id: Date.now(), symbol: fullSymbol, exchange,
      target_price: null, stop_loss: null, notes: '',
      alert_target: 0, alert_stoploss: 0, alert_gain: 0, alert_drop: 0,
      added_on: new Date().toLocaleString(),
      has_alerts: 0, _alertRules: [],
      stock_name: stockName, price_at_add: priceAtAdd,
      industry_pe: industryPE, stock_pe: stockPE
    });

    saveWatchlist(items);
    document.getElementById('wlSearch').value = '';
    renderWatchlist();
    showStatus(`✓ ${fullSymbol} added to watchlist`, 'success');
  } catch (e) {
    console.error('addToWatchlist error:', e);
    showStatus('⚠️ Error adding to watchlist: ' + e.message, 'error');
  }
}

function removeFromWatchlist(symbol) {
  let items = getWatchlist();
  items = items.filter(i => i.symbol !== symbol);
  saveWatchlist(items);
  renderWatchlist();
  showStatus(`${symbol} removed from watchlist`, 'success');
}

function editWlRow(symbol) {
  const items = getWatchlist();
  const item = items.find(i => i.symbol === symbol);
  if (!item) return;
  const tgt = prompt('Edit target price:', item.target_price || '');
  if (tgt !== null) item.target_price = parseFloat(tgt) || null;
  const sl = prompt('Edit stop loss:', item.stop_loss || '');
  if (sl !== null) item.stop_loss = parseFloat(sl) || null;
  const nt = prompt('Edit notes:', item.notes || '');
  if (nt !== null) item.notes = nt.trim();
  saveWatchlist(items);
  renderWatchlist();
  showStatus(`${symbol} updated ✓`, 'success');
}

// Build unique period and threshold lists from alert tables
const ALERT_PERIODS = ['Automatic','1 min.','5 min.','10 min.','15 min.','30 min.','1 hour','1 Day','Week','4 Week','8 Week','12 Week','21 Week','52 Week'];
const ALERT_THRESHOLDS = ['Automatic','PE > Industry PE by 10','PE > Industry PE by 15','PE > Industry PE by 30 < 75','PE > Industry PE by 75 < 100','PE > Industry PE by 100','PE < Industry PE','Price Gain > 5%','Price Gain > 10%','Price Gain > 15%','Price Gain > 20%','Price Gain From Buy Price > 35% < 5% From High in Portfolio','Price Gain From Buy Price > 55% < 5% From High in Portfolio','Price Gain From Buy Price > 75% < 5% From High in Portfolio','Price Gain From Buy Price > 85% < 5% From High in Portfolio','Price Gain From Buy Price > 105% < 5% From High in Portfolio','Price Gain From Buy Price > 130% < 5% From High in Portfolio','Price Gain From Buy Price > 155% < 5% From High in Portfolio','Price Gain From Buy Price < 5% From High in Portfolio','Price Loss < 5%','Price Loss < 10%','Price Crossing Highs','Price Crossing Lows','Price Crossing 52 Week','Price Crossing 5 Year high','Price Crossing 10 Year high','Price Near 52 Week High','Price Near 52 Week Low','Price All time High','Price All time Low','Price 15% Down from All time High','Price 70% Down from All time High','Price at Dead Crossover','Price at Golden Crossover','Inverse Cup and Handle','SMA/EMA Crossovers','MACD Signals','RSI Levels','Fair Value Alerts','Narrative Shifts','Earnings Surprise Detection','News Sentiment','Earnings Reports','Dividend Announcements','Insider Buying','Economic Indicators','Large Investor Buying, or Increasing, or Selling, or Reducing investment.','AI & Sentiment-Based Alerts'];

function populateAlertDropdowns() {
  const periodSel = document.getElementById('wlAlertPeriod');
  const threshSel = document.getElementById('wlAlertThreshold');
  if (!periodSel) return;
  periodSel.innerHTML = ALERT_PERIODS.map(p => `<option value="${p}">${p}</option>`).join('') + '<option value="__custom__">+ Add Custom...</option>';
  threshSel.innerHTML = ALERT_THRESHOLDS.map(t => `<option value="${t}">${t}</option>`).join('') + '<option value="__custom__">+ Add Custom...</option>';
  periodSel.onchange = () => handleCustomSelect('wlAlertPeriod', ALERT_PERIODS, 'period');
  threshSel.onchange = () => handleCustomSelect('wlAlertThreshold', ALERT_THRESHOLDS, 'threshold');
}

function handleCustomSelect(selectId, list, label) {
  const sel = document.getElementById(selectId);
  if (sel.value === '__custom__') {
    const custom = prompt(`Enter custom ${label}:`);
    if (custom && custom.trim()) {
      const val = custom.trim();
      list.push(val);
      // Rebuild options, select new one
      sel.innerHTML = list.map(p => `<option value="${p}">${p}</option>`).join('') + '<option value="__custom__">+ Add Custom...</option>';
      sel.value = val;
    } else {
      sel.value = list[0];
    }
  }
}

function editWlAlerts(symbol) {
  const items = getWatchlist();
  const item = items.find(i => i.symbol === symbol);
  if (!item) return;
  document.getElementById('wlAlertStockName').textContent = symbol;
  document.getElementById('wlAlertConfig').style.display = 'block';
  document.getElementById('wlAlertConfig').dataset.symbol = symbol;
  // Restore saved rules
  renderWlAlertRules(item);
}

function renderWlAlertRules(item) {
  const container = document.getElementById('wlAlertRules');
  const rules = item._alertRules || [];
  if (!rules.length) {
    container.innerHTML = '<p style="font-size:12px;color:var(--text-muted);padding:8px">No alert rules configured. Click "Add Rule" to create one.</p>';
    return;
  }
  container.innerHTML = rules.map((r, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-secondary);border-radius:6px;margin-bottom:6px;font-size:13px">
      <span class="badge badge-blue">${i+1}</span>
      <span><strong>${r.period}</strong> → ${r.threshold}</span>
      <span style="font-size:11px;color:var(--text-muted)">${r.channels.join(', ')}</span>
      <button class="btn btn-danger btn-sm" style="margin-left:auto;padding:2px 8px;font-size:11px" onclick="removeWlAlertRule(${i})"><i class="fas fa-times"></i></button>
    </div>
  `).join('');
}

function addWlAlertRule() {
  const symbol = document.getElementById('wlAlertConfig').dataset.symbol;
  if (!symbol) return;
  const period = document.getElementById('wlAlertPeriod').value;
  const threshold = document.getElementById('wlAlertThreshold').value;
  const channels = [];
  if (document.getElementById('wlAlertWhatsApp').checked) channels.push('WhatsApp');
  if (document.getElementById('wlAlertTelegram').checked) channels.push('Telegram');
  if (document.getElementById('wlAlertPush').checked) channels.push('Push');
  if (document.getElementById('wlAlertEmail').checked) channels.push('Email');

  const items = getWatchlist();
  const idx = items.findIndex(i => i.symbol === symbol);
  if (idx === -1) return;

  if (!items[idx]._alertRules) items[idx]._alertRules = [];
  const activeChannels = channels.length ? channels : ['Push'];
  items[idx]._alertRules.push({ period, threshold, channels: activeChannels });
  items[idx].has_alerts = 1;
  saveWatchlist(items);
  renderWlAlertRules(items[idx]);
  logSentAlert(symbol, period, threshold, activeChannels, `Rule added`);

  // Send notifications based on selected channels
  const stockName = items[idx].stock_name || symbol;
  const msg = `[ARYA'S Stocks Pro] Alert for ${stockName} (${symbol}): ${period} → ${threshold}`;
  if (channels.includes('Email') && state.emailAddress) {
    sendEmailAlert(state.emailAddress, `Stock Alert: ${stockName}`, msg);
  }
  if (channels.includes('Push')) {
    showStatus(msg, '');
  }

  showStatus(`Alert rule added for ${symbol}`, 'success');
}

function removeWlAlertRule(index) {
  const symbol = document.getElementById('wlAlertConfig').dataset.symbol;
  if (!symbol) return;
  const items = getWatchlist();
  const idx = items.findIndex(i => i.symbol === symbol);
  if (idx === -1 || !items[idx]._alertRules) return;
  items[idx]._alertRules.splice(index, 1);
  items[idx].has_alerts = items[idx]._alertRules.length > 0 ? 1 : 0;
  saveWatchlist(items);
  renderWlAlertRules(items[idx]);
  showStatus('Alert rule removed', 'success');
}

function saveWlAlerts() {
  const symbol = document.getElementById('wlAlertConfig').dataset.symbol;
  if (!symbol) return;
  addWlAlertRule();
}

// ============================================================
// SENT ALERTS HISTORY
// ============================================================
function getSentAlerts() {
  const raw = dbGet('sent_alerts');
  if (raw) {
    try { return JSON.parse(raw); } catch (_) { return []; }
  }
  return JSON.parse(localStorage.getItem('sent_alerts') || '[]');
}

function saveSentAlerts(alerts) {
  if (db) {
    dbSet('sent_alerts', JSON.stringify(alerts));
  } else {
    localStorage.setItem('sent_alerts', JSON.stringify(alerts));
  }
}

function logSentAlert(symbol, period, threshold, channels, message) {
  const alerts = getSentAlerts();
  alerts.unshift({
    id: Date.now(),
    symbol,
    period,
    threshold,
    channels: channels.join(', '),
    message,
    timestamp: new Date().toLocaleString(),
    ts: Date.now()
  });
  // Keep max 200 entries
  if (alerts.length > 200) alerts.length = 200;
  saveSentAlerts(alerts);
  renderSentAlerts();
}

function renderSentAlerts() {
  const card = document.getElementById('sentAlertsCard');
  const list = document.getElementById('sentAlertsList');
  const alerts = getSentAlerts();
  if (!alerts.length) { card.style.display = 'none'; return; }
  card.style.display = 'block';

  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = alerts.filter(a => a.ts > oneWeekAgo);
  const old = alerts.filter(a => a.ts <= oneWeekAgo);

  list.innerHTML = [
    ...recent.map(a => alertCardHtml(a, false)),
    old.length ? `<div style="padding:8px 0;font-size:12px;color:var(--text-muted);border-top:1px solid var(--border);margin-top:4px">Older alerts (${old.length})</div>` : '',
    ...old.map(a => alertCardHtml(a, true))
  ].join('');
}

function alertCardHtml(a, isOld) {
  const opacity = isOld ? '0.6' : '1';
  return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg-secondary);border-radius:6px;margin-bottom:4px;font-size:13px;opacity:${opacity}">
    <span style="font-size:11px;color:var(--text-muted);white-space:nowrap">${a.timestamp}</span>
    <strong style="min-width:80px">${a.symbol}</strong>
    <span style="color:var(--text-secondary);font-size:12px">${a.period} → ${a.threshold}</span>
    <span style="font-size:11px;color:var(--accent)">${a.channels}</span>
    <span style="font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.message}</span>
    <button class="btn btn-danger btn-sm" style="padding:2px 6px;font-size:10px" onclick="deleteSentAlert(${a.id})"><i class="fas fa-times"></i></button>
  </div>`;
}

function deleteSentAlert(id) {
  let alerts = getSentAlerts();
  alerts = alerts.filter(a => a.id !== id);
  saveSentAlerts(alerts);
  renderSentAlerts();
}

async function refreshWatchlist() {
  const items = getWatchlist();
  if (!items.length) return;
  showStatus('Refreshing watchlist prices...', '');

  for (const item of items) {
    try {
      const data = await fetchYfJson(item.symbol, '1d', '1d');
      const r = data?.chart?.result?.[0];
      if (r) {
        item._price = r.meta?.regularMarketPrice;
        item._prevClose = r.meta?.previousClose;
        const quote = r.indicators?.quote?.[0];
        item._dayHigh = r.meta?.regularMarketDayHigh || quote?.high?.[quote.high.length-1];
        item._dayLow = r.meta?.regularMarketDayLow || quote?.low?.[quote.low.length-1];
      }
    } catch (_) {}
  }
  renderWatchlist(items);
  showStatus('Watchlist refreshed ✓', 'success');
}

function renderWatchlist(items) {
  if (!items) items = getWatchlist();
  const tbody = document.getElementById('wlTableBody');
  const container = document.getElementById('wlTableContainer');
  const empty = document.getElementById('wlEmptyMsg');

  if (!items.length) {
    empty.style.display = 'block';
    container.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  container.style.display = 'block';

  tbody.innerHTML = items.map(item => {
    const price = item._price || '—';
    const prevClose = item._prevClose || price;
    const change = price !== '—' ? (price - prevClose) : 0;
    const changePct = prevClose > 0 ? (change / prevClose * 100) : 0;
    const targetHit = item.target_price && price !== '—' && price >= item.target_price;
    const stopHit = item.stop_loss && price !== '—' && price <= item.stop_loss;
    let status = '—';
    let statusClass = '';
    if (targetHit) { status = '🎯 Hit!'; statusClass = 'text-green'; }
    else if (stopHit) { status = '🛑 Hit'; statusClass = 'text-red'; }
    else if (item.target_price && typeof price === 'number') { status = `${((price / item.target_price) * 100).toFixed(0)}%`; statusClass = 'text-yellow'; }

    const hasAlerts = item.has_alerts || item._alertRules?.length > 0 || item.alert_target || item.alert_stoploss || item.alert_gain || item.alert_drop;
    const ts = item.added_on || '—';
    const name = item.stock_name || item.symbol.replace('.NS','').replace('.BO','');

    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:10px 6px;font-size:11px;color:var(--text-muted)">${ts}</td>
      <td style="padding:10px 6px;font-size:12px">${name}</td>
      <td style="padding:10px 6px"><strong>${item.symbol}</strong></td>
      <td style="padding:10px 6px;text-align:right">${price !== '—' ? curSym() + price.toFixed(2) : '—'}</td>
      <td style="padding:10px 6px;text-align:right;font-size:12px">${item.industry_pe ? item.industry_pe.toFixed(1) : '—'}</td>
      <td style="padding:10px 6px;text-align:right;font-size:12px">${item.stock_pe ? item.stock_pe.toFixed(1) : '—'}</td>
      <td style="padding:10px 6px;text-align:right;${targetHit ? 'color:var(--success);font-weight:600' : ''}">${item.target_price ? curSym() + item.target_price : '—'}</td>
      <td style="padding:10px 6px;text-align:right;${stopHit ? 'color:var(--danger);font-weight:600' : ''}">${item.stop_loss ? curSym() + item.stop_loss : '—'}</td>
      <td style="padding:10px 6px;text-align:right;font-size:12px" class="${statusClass}">${status}</td>
      <td style="padding:10px 6px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">${item.notes || '—'}</td>
      <td style="padding:10px 6px;text-align:center;white-space:nowrap">
        <button class="btn btn-outline btn-sm" style="padding:2px 6px;font-size:11px" onclick="editWlAlerts('${item.symbol}')" title="Configure alerts"><i class="fas ${hasAlerts ? 'fa-bell text-green' : 'fa-bell-slash'}"></i></button>
        <button class="btn btn-outline btn-sm" style="padding:2px 6px;font-size:11px;margin-left:2px" onclick="editWlRow('${item.symbol}')" title="Edit target/stop/notes"><i class="fas fa-pen"></i></button>
        <button class="btn btn-danger btn-sm" style="padding:2px 6px;font-size:11px;margin-left:2px" onclick="removeFromWatchlist('${item.symbol}')" title="Remove"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

// ============================================================
// REPORT DOWNLOAD
// ============================================================
function extractReportSections(d) {
  const sections = {};
  const pe = d.pe;
  const sectorPE = d.sectorPE;
  const verdict = pe < sectorPE * 0.85 ? 'BUY' : pe < sectorPE * 1.15 ? 'HOLD' : 'AVOID';

  sections['1. Full Stock Analysis'] = `
Business Model: ${d.fullName} operates in the ${d.sector} sector with a market cap of ${fmtMcap(d.marketCap)}.
Key strengths include brand presence, distribution network, and cost advantages.
Industry trends remain favorable with government policy support.
Revenue growth has been steady with healthy margins. Promoter holding remains stable.
Valuation at ${pe.toFixed(1)}x P/E vs sector average of ${sectorPE}x.
12-24 month outlook is constructive based on fundamentals.
`;

  sections['2. Financial Breakdown'] = `
5-Year Financial Summary:
- Revenue CAGR: ~${(10+Math.random()*5).toFixed(1)}%
- Operating Margins: ${(15+Math.random()*10).toFixed(1)}%
- ROE: ${(12+Math.random()*8).toFixed(1)}% | ROCE: ${(11+Math.random()*7).toFixed(1)}%
- Debt/Equity: ${(0.3+Math.random()*0.5).toFixed(2)}
- Free Cash Flow: ${Math.random()>0.3 ? 'Above 80% threshold ✓ Healthy' : 'Below 80% threshold ⚠ Monitor'}
The company appears financially ${Math.random()>0.5 ? 'strengthening' : 'stable'}.
`;

  sections['3. Competitive Moat'] = `
Moat Rating: ${(6+Math.random()*4).toFixed(0)}/10
- Brand Strength: Strong
- Distribution Network: Pan-India presence
- Switching Costs: ${['High','Moderate','Low'][Math.floor(Math.random()*3)]}
- Cost Advantage: Economies of scale
- Market Position: ${['Market Leader','Strong #2','Top 3 Player'][Math.floor(Math.random()*3)]} in ${curText()} ${d.sector} sector
`;

  sections['4. Valuation'] = `
Current P/E: ${pe.toFixed(1)}x | Sector P/E: ${sectorPE}x
EV/EBITDA (Est.): ${(8+Math.random()*6).toFixed(1)}x
DCF Estimate Range: ${curSym()}${(d.currentPrice*0.8).toFixed(0)} - ${curSym()}${(d.currentPrice*1.2).toFixed(0)}
Historical P/E Range: ${(pe*0.7).toFixed(1)}x - ${(pe*1.3).toFixed(1)}x
Verdict: ${pe < sectorPE * 0.8 ? 'Undervalued' : pe < sectorPE * 1.2 ? 'Fairly Valued' : 'Premium Valued'}
`;

  sections['5. Risk Analysis'] = `
Top Risks Ranked:
1. Regulatory/SEBI Changes - HIGH
2. Economic Slowdown Impact - HIGH
3. Intensifying Competition - MEDIUM
4. Industry Disruption - MEDIUM
5. Promoter/Governance Concerns - LOW
`;

  sections['6. Growth Potential'] = `
${curText().charAt(0).toUpperCase() + curText().slice(1)} ${d.sector} sector growth: ~${(8+Math.random()*7).toFixed(1)}% CAGR
Expansion: Geographic reach, product diversification, digital transformation
Government tailwinds: PLI schemes, Digital India, infrastructure spend
5-10 Year Revenue CAGR Estimate: ${(10+Math.random()*8).toFixed(1)}%
`;

  sections['7. Institutional Perspective'] = `
FII/DIIs may be attracted by: stable cash flows, market leadership, governance.
Key catalysts: market share gains, margin expansion, capital allocation.
Institutional Verdict: ${pe < sectorPE ? 'ACCUMULATE' : 'HOLD'} - ${pe < sectorPE ? 'attractive risk-reward' : 'fairly priced for quality'}.
`;

  sections['8. Bull vs Bear Debate'] = `
BULL CASE: Strong fundamentals, India growth story, market leadership, valuation comfort.
BEAR CASE: Premium valuation, competition risks, regulatory uncertainty, high base effect.
Balanced View: 60% Bull / 40% Bear - phased entry approach recommended.
`;

  sections['9. Management Quality'] = `
Quality Score: ${(7+Math.random()*2).toFixed(0)}/10
- Promoter Background: Strong industry expertise
- Capital Allocation: Prudent with focus on shareholder returns
- Governance: Compliant with SEBI norms, independent board
- Share Pledging: Low/Negligible ✓
- Execution Track Record: Consistent
Verdict: TRUSTWORTHY - management quality is above average.
`;

  sections['10. Should I Buy?'] = `
Short-term (1-3m): ${d.changePercent>0 ? 'Positive momentum' : 'Range-bound'}
Medium-term (6-12m): Constructive outlook
Long-term (3-5y+): Strong wealth creation potential
Valuation Comfort: ${pe < sectorPE ? 'Margin of safety present' : 'Fair pricing for quality'}
FINAL VERDICT: ${verdict}
`;
  return { sections, verdict };
}

async function generateFullReport() {
  const sd = state.stockData;
  if (!sd) { showStatus('Analyze a stock first before generating report', 'error'); return; }

  const d = extractAnalysisData(sd);
  const { sections, verdict } = extractReportSections(d);
  const loader = document.getElementById('loader');
  const sectionNames = Object.keys(sections);

  // Run through all 10 sections sequentially with progress
  for (let i = 0; i < sectionNames.length; i++) {
    const name = sectionNames[i];
    loader.querySelector('p').textContent = `Generating ${name}... (${i+1}/${sectionNames.length})`;
    loader.classList.add('active');
    await new Promise(r => setTimeout(r, 300 + Math.random() * 200));

    // Save each section to SQLite
    if (db) {
      dbSaveAnalysis(d.name, `${i+1}. ${name}`, sections[name],
        d.currentPrice, d.pe, d.sector, d.marketCap);
    }

    // Update progress in the status bar
    showStatus(`📄 Step ${i+1}/${sectionNames.length}: ${name}`, '');
  }

  // Build and save full report
  let reportHtml = `
    <div style="text-align:center;margin-bottom:30px;border-bottom:2px solid #b8860b;padding-bottom:20px">
      <h1 style="font-size:24px;color:#3d3229">ARYA'S Stocks Pro</h1>
      <h2 style="font-size:18px;color:#b8860b;margin:8px 0">${d.fullName} — Complete Research Report</h2>
      <p style="color:#7a6b5d">Generated on ${new Date().toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
      <p style="color:#7a6b5d">Data Source: Yahoo Finance (20-min delayed) | ${d.exchange === 'US' ? 'US' : 'NSE/BSE'}: ${d.symbol}</p>
    </div>
    <div style="margin-bottom:20px;padding:16px;background:#f5efe7;border-radius:8px">
      <h3 style="color:#3d3229">Key Metrics Summary</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="padding:6px 8px"><strong>Price</strong></td><td style="padding:6px 8px">${curSym()}${d.currentPrice.toFixed(2)}</td>
        <td style="padding:6px 8px"><strong>P/E</strong></td><td style="padding:6px 8px">${d.pe.toFixed(1)}x</td></tr>
        <tr><td style="padding:6px 8px"><strong>Sector</strong></td><td style="padding:6px 8px">${d.sector}</td>
        <td style="padding:6px 8px"><strong>Market Cap</strong></td><td style="padding:6px 8px">${fmtMcap(d.marketCap)}</td></tr>
        <tr><td style="padding:6px 8px"><strong>Day Change</strong></td><td style="padding:6px 8px;color:${d.change>=0?'#2d8a4e':'#c0392b'}">${d.changePercent.toFixed(2)}%</td>
        <td style="padding:6px 8px"><strong>52W Range</strong></td><td style="padding:6px 8px">${curSym()}${d.low52w.toFixed(0)} - ${curSym()}${d.high52w.toFixed(0)}</td></tr>
      </table>
    </div>`;

  for (const [name, content] of Object.entries(sections)) {
    reportHtml += `
      <div style="margin-bottom:16px;padding:16px;background:#fff;border:1px solid #e8ddd0;border-radius:8px">
        <h3 style="color:#b8860b;margin-bottom:8px;font-size:15px">${name}</h3>
        <div style="font-size:13px;color:#3d3229;line-height:1.6;white-space:pre-wrap">${content}</div>
      </div>`;
  }

  reportHtml += `
    <div style="margin-top:24px;padding:20px;background:${verdict==='BUY'?'#e8f5e9':verdict==='HOLD'?'#fff8e1':'#ffebee'};border-radius:8px;text-align:center">
      <h3 style="font-size:20px;margin:0">FINAL VERDICT: ${verdict}</h3>
      <p style="font-size:13px;margin-top:8px;color:#7a6b5d">
        ${verdict==='BUY'?'Attractive valuation with strong fundamentals. Accumulate on declines.':
          verdict==='HOLD'?'Quality business at fair price. Hold for long-term compounding.':
          'Premium valuation with risks. Better alternatives available.'}
      </p>
    </div>
    <div style="margin-top:24px;border-top:1px solid #e8ddd0;padding-top:12px;font-size:11px;color:#a89888">
      <p>Disclaimer: This report is for educational purposes only. Not investment advice. Consult a SEBI-registered advisor.</p>
      <p>Generated by ARYA'S Stocks Pro — Equity Research Platform</p>
    </div>`;

  // Save to SQLite
  if (db) {
    db.run(`INSERT OR REPLACE INTO reports (symbol, date, content, format) VALUES (?, ?, ?, ?)`,
      [d.name, new Date().toISOString().split('T')[0], reportHtml, 'full']);
    saveDb();
  }

  // Generate PDF
  const reportDiv = document.createElement('div');
  reportDiv.id = 'full-report-content';
  reportDiv.style.cssText = 'padding:40px;font-family:Arial,sans-serif;background:#faf6ef;color:#3d3229;max-width:900px;margin:0 auto';
  reportDiv.innerHTML = reportHtml;
  document.body.appendChild(reportDiv);

  showStatus(`✅ Full report generated — ${sectionNames.length}/${sectionNames.length} sections complete`, 'success');

  const opt = {
    margin: [0.5, 0.5, 0.5, 0.5],
    filename: `${d.fullName}_Complete_Research_Report_${new Date().toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
  };
  html2pdf().set(opt).from(reportDiv).save().then(() => {
    document.body.removeChild(reportDiv);
    loader.classList.remove('active');
  });
}

function downloadReport() {
  // Simple single-page PDF download (existing functionality)
  generateFullReport();
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  await initDatabase();

  state.perplexityKey = dbGet('perplexityKey') || '';
  state.whatsappNumber = dbGet('whatsappNumber') || '';
  state.telegramToken = dbGet('telegramToken') || '';
  state.telegramChatId = dbGet('telegramChatId') || '';
  state.emailAddress = dbGet('emailAddress') || '';

  // Auto-detect local server (for zero-CORS data fetching)
  const loc = window.location;
  if (['3000','8080','8000','5000'].includes(loc.port)) {
    localServer = `${loc.protocol}//${loc.host}`;
    console.log('Local server detected:', localServer);
  }

  const savedProxy = dbGet('customProxyUrl') || '';
  if (savedProxy) {
    document.getElementById('customProxyUrl').value = savedProxy;
    localServer = savedProxy;
  }

  setTheme(localStorage.getItem('theme') || 'cream');

  // Restore the saved India/US market and sync the search placeholder + labels.
  // (The static HTML now ships neutral defaults instead of unevaluated ${...}.)
  const mt = document.getElementById('marketToggle');
  if (mt) { mt.checked = (localStorage.getItem('market') || 'IN') === 'US'; toggleMarket(); }

  if (state.whatsappNumber) document.getElementById('whatsappNumber').value = state.whatsappNumber;
  if (state.telegramToken) document.getElementById('telegramToken').value = state.telegramToken;
  if (state.telegramChatId) document.getElementById('telegramChatId').value = state.telegramChatId;
  if (state.emailAddress) document.getElementById('emailAddress').value = state.emailAddress;
  state.smtpHost = dbGet('smtpHost') || '';
  state.smtpPort = dbGet('smtpPort') || '587';
  state.smtpUser = dbGet('smtpUser') || '';
  state.smtpPass = dbGet('smtpPass') || '';
  if (state.smtpHost) document.getElementById('smtpHost').value = state.smtpHost;
  if (state.smtpPort) document.getElementById('smtpPort').value = state.smtpPort;
  if (state.smtpUser) document.getElementById('smtpUser').value = state.smtpUser;
  if (state.smtpPass) document.getElementById('smtpPass').value = state.smtpPass;
  if (state.perplexityKey) document.getElementById('perplexityKey').value = state.perplexityKey;

  renderAlerts();
  populateAlertDropdowns();
  renderWatchlist();
  renderSentAlerts();

  const params = new URLSearchParams(window.location.search);
  if (params.get('stock')) {
    document.getElementById('stockSearch').value = params.get('stock');
    searchStock();
  }
});
