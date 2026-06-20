// providers/codex.js — codex CLI provider.
// OpenAI's codex CLI with agent_message streaming, web_search enabled.
const os = require('os');
const path = require('path');
const fs = require('fs');
const childProcess = require('child_process');
const { buildPrompt, cleanEnv, typedError } = require('./base');

// Parse one line of codex JSON output.
// Returns { kind: 'delta', text: ... } for agent_message items, null otherwise.
function parseCodexLine(line) {
  let obj;
  try { obj = JSON.parse(line); } catch (_) { return null; }
  if (!obj || typeof obj !== 'object') return null;

  if (obj.type === 'item.completed' && obj.item && obj.item.type === 'agent_message') {
    return { kind: 'delta', text: obj.item.text || '' };
  }
  // Ignore all other types: web_search, command_execution, thread.started, turn.started/completed, etc.
  return null;
}

// Cheap availability check: is a `codex` binary on PATH? Never spawns a real run.
async function isAvailable() {
  const pathMod = require('path');
  return (process.env.PATH || '').split(pathMod.delimiter)
    .some(p => p && fs.existsSync(pathMod.join(p, 'codex')));
}

function run(symbol, context, onText, opts = {}) {
  const { timeoutMs = 240000, _spawn = childProcess.spawn } = opts;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const outFile = path.join(os.tmpdir(), 'codex-out-' + process.pid + '-' + Date.now() + '.txt');
    const args = [
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--sandbox', 'read-only',
      '-c', 'tools.web_search=true',
      '-o', outFile,
      buildPrompt(symbol, context)
    ];

    const proc = _spawn('codex', args, { cwd: os.tmpdir(), env: cleanEnv() });

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
        const p = parseCodexLine(line);
        if (!p) continue;
        if (p.kind === 'delta') { acc.push(p.text); onText(p.text); }
      }
    });
    proc.stderr.on('data', d => { stderrBuf += d.toString(); });

    proc.on('error', err => finish(() => reject(typedError(err.message, err.code === 'ENOENT' ? 'cli_missing' : 'spawn_error'))));

    proc.on('close', codeNum => {
      let text;
      try {
        text = fs.readFileSync(outFile, 'utf8').trim();
      } catch (_) {
        text = '';
      }
      // Fall back to accumulated text or the last agent_message
      const finalFromAcc = acc.join('');
      text = text || finalFromAcc;

      try { fs.unlinkSync(outFile); } catch (_) {}

      if (codeNum === 0 && text) finish(() => resolve({ text, durationMs: Date.now() - started }));
      else if (codeNum === 0) finish(() => reject(typedError('No output from CLI', 'no_output')));
      else finish(() => reject(typedError(stderrBuf.slice(0, 300) || `codex exited ${codeNum}`,
        /not.*logg|auth|login/i.test(stderrBuf) ? 'not_authenticated' : `exit_${codeNum}`)));
    });
  });
}

module.exports = {
  id: 'codex', label: 'Codex (OpenAI CLI)', webCapable: true,
  isAvailable, run, parseCodexLine,
};
