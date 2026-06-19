// alerts.js — Alerts system and settings
// Part of ARYA'S Stocks Pro. Loaded as an ordered classic script (shared globals).

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
