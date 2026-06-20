// fundamentals-fallback.js — optional paid fundamentals provider.
//
// When the free Yahoo path (yahoo-auth.js) fails — no local Chrome, a 503, or a
// persistent 429 — and a `FMP_API_KEY` is configured server-side, we fetch the same
// fundamentals from Financial Modeling Prep (FMP) and normalize them into the EXACT
// shape yahoo-auth.normalize() returns, so the frontend renders them as live data.
//
// The key is read from process.env only; it is never accepted from the client and
// never returned to it (see /yf-status, which exposes a boolean, not the key).

const BASE = 'https://financialmodelingprep.com/api/v3';

function isConfigured() {
  return !!process.env.FMP_API_KEY;
}

// Pure normalizer: takes already-unwrapped FMP objects and returns the yahoo-auth shape.
// Units are reconciled to Yahoo's conventions so downstream math is identical:
//   - margins / ROE / dividend yield: FMP already gives fractions (0.09 = 9%), like Yahoo.
//   - debtEquityRatioTTM: FMP gives a RATIO (0.36); Yahoo gives a PERCENT (36). We *100.
function normalizeFmp({ profile, ratios, income, cashflow, balance }) {
  profile = profile || {};
  ratios = ratios || {};
  income = income || {};
  cashflow = cashflow || {};
  balance = balance || {};

  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  const de = num(ratios.debtEquityRatioTTM);

  return {
    marketCap: num(profile.mktCap),
    trailingPE: num(ratios.peRatioTTM),
    forwardPE: null,                       // not available on FMP's free TTM endpoints
    eps: num(income.eps) ?? num(income.epsdiluted),
    beta: num(profile.beta),
    dividendYield: num(ratios.dividendYielTTM),   // FMP's field name carries this typo
    priceToBook: num(ratios.priceToBookRatioTTM),
    sector: profile.sector || null,
    industry: profile.industry || null,
    longName: profile.companyName || null,
    returnOnEquity: num(ratios.returnOnEquityTTM),
    profitMargins: num(ratios.netProfitMarginTTM),
    operatingMargins: num(ratios.operatingProfitMarginTTM),
    totalRevenue: num(income.revenue),
    revenueGrowth: null,                   // needs a growth endpoint; left null (UI marks est.)
    earningsGrowth: null,
    debtToEquity: de == null ? null : de * 100,   // ratio -> percent to match Yahoo
    totalCash: num(balance.cashAndCashEquivalents) ?? num(balance.cashAndShortTermInvestments),
    totalDebt: num(balance.totalDebt),
    freeCashflow: num(cashflow.freeCashFlow),
    currency: profile.currency || null,
    source: 'fmp',
    fetchedAt: Date.now(),
  };
}

async function getJson(pathWithQuery) {
  const sep = pathWithQuery.includes('?') ? '&' : '?';
  const url = `${BASE}${pathWithQuery}${sep}apikey=${encodeURIComponent(process.env.FMP_API_KEY)}`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'arya-stocks/1.0' } });
  if (resp.status !== 200) {
    const e = new Error(`FMP HTTP ${resp.status}`);
    e.code = resp.status;
    throw e;
  }
  return resp.json();
}

const first = (arr) => (Array.isArray(arr) && arr.length ? arr[0] : null);

// Fetch + normalize fundamentals for a symbol from FMP. Throws if the key is missing
// or the provider errors; returns the normalized object on success.
async function getFromProvider(symbol) {
  if (!symbol) throw new Error('symbol required');
  if (!isConfigured()) throw new Error('FMP_API_KEY not configured');

  const s = encodeURIComponent(symbol);
  const [profile, ratios, income, cashflow, balance] = await Promise.all([
    getJson(`/profile/${s}`).then(first).catch(() => null),
    getJson(`/ratios-ttm/${s}`).then(first).catch(() => null),
    getJson(`/income-statement/${s}?limit=1`).then(first).catch(() => null),
    getJson(`/cash-flow-statement/${s}?limit=1`).then(first).catch(() => null),
    getJson(`/balance-sheet-statement/${s}?limit=1`).then(first).catch(() => null),
  ]);

  if (!profile && !ratios && !income) {
    throw new Error('FMP returned no data for ' + symbol);
  }
  return normalizeFmp({ profile, ratios, income, cashflow, balance });
}

module.exports = { getFromProvider, normalizeFmp, isConfigured };
