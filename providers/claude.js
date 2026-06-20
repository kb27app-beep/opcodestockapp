// providers/claude.js — claude CLI provider.
// Subscription auth (cleanEnv strips ANTHROPIC_API_KEY), web-searched, stream-json output.
// This is the only true token-streaming provider; the others resolve with full text.
const os = require('os');
const childProcess = require('child_process');
const { buildPrompt, cleanEnv, typedError } = require('./base');

function rateLimitMessage(info) {
  const when = info.resetsAt ? new Date(info.resetsAt * 1000).toLocaleTimeString() : 'later';
  return `Claude usage limit reached (resets at ${when}).`;
}

// Parse one line of `claude -p --output-format stream-json`. Returns a normalized event or null.
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
    if (info.status && info.status !== 'allowed') return { kind: 'rate_limited', text: rateLimitMessage(info) };
    return null;
  }
  if (ev.type === 'result') {
    if (ev.is_error) return { kind: 'error', text: ev.subtype || 'result_error' };
    return { kind: 'final', text: typeof ev.result === 'string' ? ev.result : '' };
  }
  return null;
}

// Cheap availability check: is a `claude` binary on PATH? Never spawns a real run.
async function isAvailable() {
  const { existsSync } = require('fs');
  const pathMod = require('path');
  return (process.env.PATH || '').split(pathMod.delimiter)
    .some(p => p && existsSync(pathMod.join(p, 'claude')));
}

function run(symbol, context, onText, opts = {}) {
  const { model = 'haiku', timeoutMs = 240000, _spawn = childProcess.spawn } = opts;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    // Why disallowedTools + the inline directive: the user's global ~/.claude config (CLAUDE.md,
    // superpowers skills) otherwise makes headless claude reach for Skill/Task/Workflow and fork a
    // background "deep-research" workflow, so `-p` returns "I'll notify you when done" instead of a
    // report. Blocking those tools and telling it to answer inline keeps the run synchronous. We
    // cannot isolate via CLAUDE_CONFIG_DIR because the subscription credentials live in that dir.
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

    let finalText = '', settled = false, stderrBuf = '', buf = '';
    const acc = [];
    const finish = (fn) => { if (settled) return; settled = true; clearTimeout(timer); fn(); };

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 2000).unref?.();
      finish(() => reject(typedError('Research timed out', 'timeout')));
    }, timeoutMs);

    proc.stdout.on('data', chunk => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const p = parseStreamJsonLine(line);
        if (!p) continue;
        if (p.kind === 'delta') { acc.push(p.text); onText(p.text); }
        else if (p.kind === 'final') finalText = p.text;
        else if (p.kind === 'rate_limited') { try { proc.kill('SIGTERM'); } catch (_) {} finish(() => reject(typedError(p.text, 'rate_limited'))); }
        else if (p.kind === 'error') { try { proc.kill('SIGTERM'); } catch (_) {} finish(() => reject(typedError(`AI research failed (${p.text})`, 'exit_error'))); }
      }
    });
    proc.stderr.on('data', d => { stderrBuf += d.toString(); });

    proc.on('error', err => finish(() => reject(typedError(err.message, err.code === 'ENOENT' ? 'cli_missing' : 'spawn_error'))));

    proc.on('close', codeNum => {
      const text = finalText || acc.join('');
      if (codeNum === 0 && text) finish(() => resolve({ text, durationMs: Date.now() - started }));
      else if (codeNum === 0) finish(() => reject(typedError('No output from CLI', 'no_output')));
      else finish(() => reject(typedError(stderrBuf.slice(0, 300) || `claude exited ${codeNum}`,
        /not.*logg|auth|login/i.test(stderrBuf) ? 'not_authenticated' : `exit_${codeNum}`)));
    });
  });
}

module.exports = {
  id: 'claude', label: 'Claude (subscription CLI)', webCapable: true,
  isAvailable, run, parseStreamJsonLine,
};
