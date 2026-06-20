// ai-research.js — multi-provider research orchestrator.
//
// runResearch builds a provider cascade (free local CLIs first, paid API last), filters to
// providers that are web-capable AND available, and tries each in order: capacity failures
// (rate limit / not logged in / CLI missing) fall through to the next provider; a genuine
// content error stops the cascade. Keeps the original signature + exports so the running
// server, the existing engine tests, and the future Telegram bot all keep working unchanged.
const { buildPrompt } = require('./providers/base');
const claude = require('./providers/claude');
const codex = require('./providers/codex');
const agy = require('./providers/agy');
const api = require('./providers/api');
const settingsMod = require('./settings');

const MAX_CONCURRENT = 2;
const DEFAULT_ORDER = ['claude', 'codex', 'agy', 'api'];
// Only these "can't serve right now" codes fall through to the next provider. Everything
// else (no_output, spawn_error, exit_<n>, content errors) is a real failure we surface
// rather than masking it by silently trying a different provider.
const CAPACITY = new Set(['rate_limited', 'not_authenticated', 'cli_missing', 'busy']);
const REGISTRY = { claude, codex, agy, api };
let _inflight = 0;

const webOf = (p, s) => (typeof p.webCapable === 'function' ? p.webCapable(s) : p.webCapable);

// Report each provider's availability + web-capability (for a Settings UI / API route).
async function listProviders(settings) {
  const s = settings || settingsMod.readSettings();
  return Promise.all(Object.values(REGISTRY).map(async p => ({
    id: p.id,
    label: p.label,
    webCapable: !!webOf(p, s),
    available: await Promise.resolve(p.isAvailable(s)).catch(() => false),
  })));
}

async function runResearch(symbol, context, onText, opts = {}) {
  // Back-compat test seam: an injected spawn means "run claude with this" — no cascade.
  if (opts._spawn) {
    const r = await claude.run(symbol, context, onText, opts);
    return { ...r, provider: 'claude' };
  }
  if (_inflight >= MAX_CONCURRENT) {
    throw Object.assign(new Error('Too many concurrent research runs'), { code: 'busy' });
  }
  _inflight++;
  try {
    const s = opts.settings || settingsMod.readSettings();
    const reg = opts._providers
      ? Object.fromEntries(opts._providers.map(p => [p.id, p]))
      : REGISTRY;
    const order = opts.provider ? [opts.provider] : (opts._order || s.cascadeOrder || DEFAULT_ORDER);

    const tried = [];
    for (const id of order) {
      const p = reg[id];
      if (!p) { tried.push(`${id}: unknown`); continue; }
      let isWeb;
      try { isWeb = webOf(p, s); } catch (_) { isWeb = false; }
      if (!isWeb) { tried.push(`${id}: not web-capable`); continue; }
      const available = await Promise.resolve(p.isAvailable(s)).catch(() => false);
      if (!available) { tried.push(`${id}: unavailable`); continue; }
      try {
        const r = await p.run(symbol, context, onText, { ...opts, settings: s });
        return { ...r, provider: id };
      } catch (e) {
        if (CAPACITY.has(e.code)) { tried.push(`${id}: ${e.code}`); continue; }
        throw e;   // genuine content error -> stop the cascade and surface it
      }
    }
    throw Object.assign(
      new Error(`No AI provider could run this research. ${tried.join('; ') || 'none configured'}`),
      { code: 'all_providers_exhausted' });
  } finally {
    _inflight--;
  }
}

module.exports = {
  runResearch,
  listProviders,
  buildPrompt,
  parseStreamJsonLine: claude.parseStreamJsonLine,
  MAX_CONCURRENT,
};
