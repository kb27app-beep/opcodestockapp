// providers/base.js — shared helpers + the provider-interface contract.
//
// A provider module exports an object shaped like:
//   {
//     id: string,                       // 'claude' | 'codex' | 'agy' | 'api'
//     label: string,                    // human label for the UI
//     webCapable: boolean | (settings) => boolean,   // only true ones join the cascade
//     isAvailable(settings) -> Promise<boolean>,      // CLI on PATH+authed, or API key set
//     run(symbol, context, onText, opts) -> Promise<{ text, durationMs }>  // typed-error .code
//   }
// The shared typed-error `.code` taxonomy: cli_missing, not_authenticated, timeout,
// rate_limited, exit_<n>, no_output, busy, spawn_error (capacity failures fall through
// in the orchestrator); plus all_providers_exhausted (orchestrator-level).

// The single research prompt builder — every provider asks the same question so reports
// are comparable across providers. (Moved verbatim from the original ai-research.js.)
function buildPrompt(symbol, context = {}) {
  const facts = [];
  if (context.name) facts.push(`Name: ${context.name}`);
  if (context.currentPrice != null) facts.push(`Current price: ${context.currentPrice}`);
  if (context.dayChangePct != null) facts.push(`Day change: ${context.dayChangePct}%`);
  if (context.pe != null) facts.push(`P/E: ${context.pe}`);
  if (context.marketCap != null) facts.push(`Market cap: ${context.marketCap}`);
  if (context.sector) facts.push(`Sector: ${context.sector}`);
  const grounding = facts.length
    ? `\nKnown data for grounding (verify if stale):\n${facts.join('\n')}\n` : '\n';

  return `You are a senior US-equity research analyst. Produce a current, well-sourced research report on the US-listed stock ${symbol}.
${grounding}
Use web search for anything time-sensitive. For every factual claim, cite the source and date inline.
Write in Markdown with exactly these sections, in order:

1. News and catalysts (recent, each dated)
2. Latest earnings and next earnings date (include guidance)
3. Analyst sentiment and price targets
4. Bull case
5. Bear case
6. Key risks
7. Bottom-line verdict

Be concise and specific. Do not invent numbers. If data is unavailable, say so.`;
}

// Strip injected CLAUDE*/ANTHROPIC* context vars so a CLI run starts in a neutral context;
// keep PATH/HOME so the CLI and its auth resolve normally. `src` is injectable for tests.
function cleanEnv(src = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (/^(CLAUDE|ANTHROPIC)/.test(k)) continue;
    out[k] = v;
  }
  return out;
}

// Split a buffer on newlines into complete lines plus the trailing remainder (incomplete line).
function splitLines(buf) {
  const parts = String(buf).split('\n');
  const rest = parts.pop();
  return { lines: parts, rest };
}

// Build an Error carrying a typed `.code` from the shared taxonomy.
function typedError(message, code) {
  return Object.assign(new Error(message), { code });
}

module.exports = { buildPrompt, cleanEnv, splitLines, typedError };
