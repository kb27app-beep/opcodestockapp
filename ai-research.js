// ai-research.js — pure engine for on-demand stock research via the local `claude` CLI.
// No HTTP/Telegram knowledge: callers adapt runResearch's onText callback to their transport.

// Parse one line of `claude -p --output-format stream-json` output into a normalized event.
// Returns null for event types we ignore (system/hook/assistant/message lifecycle) or junk.
function parseStreamJsonLine(line) {
  let ev;
  try { ev = JSON.parse(line); } catch (_) { return null; }
  if (!ev || typeof ev !== 'object') return null;

  if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta'
      && ev.event.delta?.type === 'text_delta') {
    return { kind: 'delta', text: ev.event.delta.text || '' };
  }
  if (ev.type === 'rate_limit_event') {
    const info = ev.rate_limit_info || {};
    if (info.status && info.status !== 'allowed') {
      return { kind: 'rate_limited', text: rateLimitMessage(info) };
    }
    return null;
  }
  if (ev.type === 'result') {
    if (ev.is_error) return { kind: 'error', text: ev.subtype || 'result_error' };
    return { kind: 'final', text: typeof ev.result === 'string' ? ev.result : '' };
  }
  return null;
}

function rateLimitMessage(info) {
  const when = info.resetsAt ? new Date(info.resetsAt * 1000).toLocaleTimeString() : 'later';
  return `Claude usage limit reached (resets at ${when}).`;
}

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

  // Why: a single self-contained instruction; print mode has no separate system channel
  // we rely on here, so role + format + sourcing rules all live in the prompt.
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

const os = require('os');
const childProcess = require('child_process');

const MAX_CONCURRENT = 2;
let _inflight = 0;

function cleanEnv() {
  // Strip injected CLAUDE*/ANTHROPIC* context vars so research runs in a neutral context;
  // keep PATH/HOME so the CLI and its auth resolve normally.
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDE|ANTHROPIC)/.test(k)) continue;
    out[k] = v;
  }
  return out;
}

function runResearch(symbol, context, onText, opts = {}) {
  // Default haiku to conserve subscription quota; callers pass a stronger model when wanted.
  const { model = 'haiku', timeoutMs = 240000, _spawn = childProcess.spawn } = opts;
  if (_inflight >= MAX_CONCURRENT) {
    return Promise.reject(Object.assign(new Error('Too many concurrent research runs'), { code: 'busy' }));
  }
  _inflight++;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    // Why disallowedTools + the inline directive: the user's global ~/.claude config
    // (CLAUDE.md, superpowers skills) otherwise makes headless claude reach for the
    // Skill/Task/Workflow tools and fork a background "deep-research" workflow, so `-p`
    // returns "I'll notify you when done" instead of the report. Blocking those tools and
    // telling it to answer inline keeps the run synchronous. We cannot isolate via
    // CLAUDE_CONFIG_DIR because the subscription credentials live in that dir.
    const args = ['-p', buildPrompt(symbol, context),
      '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
      '--model', model,
      '--allowedTools', 'WebSearch', 'WebFetch',
      '--disallowedTools', 'Skill', 'Task', 'Workflow', 'TodoWrite',
      '--append-system-prompt',
      'Respond directly and inline as plain markdown. Do not use skills, subagents, or background workflows.',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--exclude-dynamic-system-prompt-sections'];
    const proc = _spawn('claude', args, { cwd: os.tmpdir(), env: cleanEnv() });

    let finalText = '';
    const acc = [];
    let settled = false;
    let stderrBuf = '';
    const finish = (fn) => { if (settled) return; settled = true; _inflight--; clearTimeout(timer); fn(); };

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 2000).unref?.();
      finish(() => reject(Object.assign(new Error('Research timed out'), { code: 'timeout' })));
    }, timeoutMs);

    let buf = '';
    proc.stdout.on('data', chunk => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const p = parseStreamJsonLine(line);
        if (!p) continue;
        if (p.kind === 'delta') { acc.push(p.text); onText(p.text); }
        else if (p.kind === 'final') { finalText = p.text; }
        else if (p.kind === 'rate_limited') {
          try { proc.kill('SIGTERM'); } catch (_) {}
          finish(() => reject(Object.assign(new Error(p.text), { code: 'rate_limited' })));
        } else if (p.kind === 'error') {
          try { proc.kill('SIGTERM'); } catch (_) {}
          finish(() => reject(Object.assign(new Error(`AI research failed (${p.text})`), { code: 'exit_error' })));
        }
      }
    });
    proc.stderr.on('data', d => { stderrBuf += d.toString(); });

    proc.on('error', err => {
      const code = err.code === 'ENOENT' ? 'cli_missing' : 'spawn_error';
      finish(() => reject(Object.assign(new Error(err.message), { code })));
    });

    proc.on('close', codeNum => {
      const text = finalText || acc.join('');
      if (codeNum === 0 && text) {
        finish(() => resolve({ text, durationMs: Date.now() - started }));
      } else if (codeNum === 0 && !text) {
        finish(() => reject(Object.assign(new Error('No output from CLI'), { code: 'no_output' })));
      } else {
        // A login problem usually surfaces here; surface stderr hint in the log.
        const code = /not.*logg|auth|login/i.test(stderrBuf) ? 'not_authenticated' : `exit_${codeNum}`;
        finish(() => reject(Object.assign(new Error(stderrBuf.slice(0, 300) || `claude exited ${codeNum}`), { code })));
      }
    });
  });
}

module.exports = { parseStreamJsonLine, buildPrompt, runResearch, MAX_CONCURRENT };
