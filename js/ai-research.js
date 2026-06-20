// ai-research.js (browser) -- on-demand AI research panel.
// Opens an SSE stream to /ai-research and renders streamed markdown for the current stock.
let _aiSource = null;

function aiResearchContext() {
  const d = (typeof extractAnalysisData === 'function' && state.stockData)
    ? extractAnalysisData(state.stockData) : {};
  return { symbol: state.stockSymbol, name: d.name, currentPrice: d.currentPrice,
    pe: d.pe, sector: d.sector, marketCap: d.marketCap };
}

function startAiResearch(force) {
  const symbol = (state.stockSymbol || '').toUpperCase().replace(/\.(NS|BO)$/, '');
  if (!symbol) return;
  if (_aiSource) { _aiSource.close(); _aiSource = null; }

  const panel = document.getElementById('aiResearchPanel');
  const body = document.getElementById('aiResearchBody');
  const meta = document.getElementById('aiResearchMeta');
  const rerun = document.getElementById('aiResearchRerun');
  panel.hidden = false; rerun.hidden = true;
  body.innerHTML = ''; meta.textContent = 'Researching...';
  const t0 = Date.now();
  let raw = '';

  const proxy = localServer || window.location.origin;
  // Pass the price/fundamentals the app already has so the report is grounded (the engine's
  // buildPrompt folds these in). EventSource is GET-only, so context rides as query params.
  const ctx = aiResearchContext();
  const params = new URLSearchParams({ symbol });
  if (force) params.set('fresh', '1');
  if (ctx.name) params.set('name', ctx.name);
  if (ctx.currentPrice != null) params.set('price', ctx.currentPrice);
  if (ctx.pe != null) params.set('pe', ctx.pe);
  if (ctx.sector) params.set('sector', ctx.sector);
  if (ctx.marketCap != null) params.set('mcap', ctx.marketCap);
  const es = new EventSource(`${proxy}/ai-research?${params.toString()}`);
  _aiSource = es;

  es.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.cached) meta.textContent = 'Cached';
      if (typeof msg.delta === 'string') { raw += msg.delta; body.innerHTML = renderAiMarkdown(raw); }
    } catch (_) {}
  };
  es.addEventListener('done', (e) => {
    es.close(); _aiSource = null;
    let info = {}; try { info = JSON.parse(e.data); } catch (_) {}
    meta.textContent = info.cached ? 'Cached' : `Done in ${Math.round((Date.now() - t0) / 1000)}s`;
    rerun.hidden = false;
  });
  es.addEventListener('error', (e) => {
    es.close(); _aiSource = null;
    let info = {}; try { info = JSON.parse(e.data); } catch (_) {}
    meta.textContent = 'Error';
    body.innerHTML = `<p class="ai-error">&#x26a0;&#xfe0f; ${info.message || 'AI research failed.'}</p>`;
    rerun.hidden = false;
  });
}

// Minimal, safe-ish markdown: escape HTML, then a few block/inline rules. Good enough for
// streamed reports; can be swapped for a full renderer later.
function renderAiMarkdown(md) {
  const esc = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/^### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^## (.*)$/gm, '<h3>$1</h3>')
    .replace(/^# (.*)$/gm, '<h2>$1</h2>')
    .replace(/^\d+\.\s+(.*)$/gm, '<li>$1</li>')
    .replace(/^[-*]\s+(.*)$/gm, '<li>$1</li>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\n{2,}/g, '<br><br>');
}
