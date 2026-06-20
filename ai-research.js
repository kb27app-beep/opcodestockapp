// ai-research.js — multi-provider research orchestrator.
//
// Interim delegate: until the full cascade lands (it wires in codex/agy/api/settings),
// runResearch routes to the claude provider so the running server and the existing engine
// tests keep working. Backward-compatible exports are preserved: parseStreamJsonLine,
// buildPrompt, runResearch, MAX_CONCURRENT.
const { buildPrompt } = require('./providers/base');
const claude = require('./providers/claude');

const MAX_CONCURRENT = 2;

function runResearch(symbol, context, onText, opts = {}) {
  return claude.run(symbol, context, onText, opts);   // replaced by the cascade orchestrator
}

module.exports = {
  parseStreamJsonLine: claude.parseStreamJsonLine,
  buildPrompt,
  runResearch,
  MAX_CONCURRENT,
};
