// data.js — Navigation, Yahoo data fetch, fundamentals, symbol resolution, analysis extraction
// Part of ARYA'S Stocks Pro. Loaded as an ordered classic script (shared globals).

// ============================================================
// NAVIGATION
// ============================================================
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => { n.classList.remove('active'); n.removeAttribute('aria-current'); });
  const page = document.getElementById('page-' + pageId);
  if (page) page.classList.add('active');
  const navBtn = document.querySelector(`.nav-item[onclick*="'${pageId}'"]`);
  if (navBtn) { navBtn.classList.add('active'); navBtn.setAttribute('aria-current', 'page'); }
  state.currentPage = pageId;
  // Close the mobile sidebar after navigating.
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarBackdrop')?.classList.remove('open');
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
  const open = document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarBackdrop')?.classList.toggle('open', open);
  document.getElementById('sidebarToggle')?.setAttribute('aria-expanded', String(open));
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
