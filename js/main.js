// main.js — App initialization (DOMContentLoaded) — must load last
// Part of ARYA'S Stocks Pro. Loaded as an ordered classic script (shared globals).

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
