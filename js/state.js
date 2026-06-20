// state.js — State, constants, and SQLite/localStorage persistence
// Part of ARYA'S Stocks Pro. Loaded as an ordered classic script (shared globals).

// ============================================================
// SQLITE LOCAL DATABASE
// ============================================================
let db = null;
let SQL = null;

async function initDatabase() {
  if (!window.initSqlJs) return;
  try {
    // Pin the wasm binary to the SAME version as the JS glue loaded in index.html
    // (sql.js@1.10.2). Pointing at sql.js.org/dist served whichever build was current
    // there, and a glue/binary mismatch throws a WebAssembly LinkError ("Import ...
    // requires a callable"), forcing the localStorage fallback.
    SQL = await initSqlJs({ locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.2/dist/${file}` });
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
