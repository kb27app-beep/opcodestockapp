// watchlist.js — Right-click context menu, smart watchlist, sent-alerts history
// Part of ARYA'S Stocks Pro. Loaded as an ordered classic script (shared globals).

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
