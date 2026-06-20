// providers/agy.js — agy (Gemini) CLI provider.
// Emits plain text (no JSON, no token events); prints the final markdown answer to stdout.
const os = require('os');
const childProcess = require('child_process');
const { buildPrompt, cleanEnv, typedError } = require('./base');

// Extract final text by trimming whitespace.
function extractFinal(stdout) {
  return String(stdout).trim();
}

// Cheap availability check: is an `agy` binary on PATH? Never spawns a real run.
async function isAvailable() {
  const { existsSync } = require('fs');
  const pathMod = require('path');
  return (process.env.PATH || '').split(pathMod.delimiter)
    .some(p => p && existsSync(pathMod.join(p, 'agy')));
}

function run(symbol, context, onText, opts = {}) {
  const { timeoutMs = 240000, _spawn = childProcess.spawn } = opts;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const args = ['--print', buildPrompt(symbol, context)];
    const proc = _spawn('agy', args, { cwd: os.tmpdir(), env: cleanEnv() });

    let accumulated = '', settled = false, stderrBuf = '';
    const finish = (fn) => { if (settled) return; settled = true; clearTimeout(timer); fn(); };

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 2000).unref?.();
      finish(() => reject(typedError('Research timed out', 'timeout')));
    }, timeoutMs);

    proc.stdout.on('data', chunk => {
      const text = chunk.toString();
      accumulated += text;
      onText(text);
    });

    proc.stderr.on('data', d => { stderrBuf += d.toString(); });

    proc.on('error', err => {
      finish(() => reject(typedError(err.message, err.code === 'ENOENT' ? 'cli_missing' : 'spawn_error')));
    });

    proc.on('close', codeNum => {
      const text = extractFinal(accumulated);
      if (codeNum === 0 && text) {
        finish(() => resolve({ text, durationMs: Date.now() - started }));
      } else if (codeNum === 0) {
        finish(() => reject(typedError('No output from CLI', 'no_output')));
      } else {
        finish(() => reject(typedError(stderrBuf.slice(0, 300) || `agy exited ${codeNum}`,
          /not.*logg|auth|login/i.test(stderrBuf) ? 'not_authenticated' : `exit_${codeNum}`)));
      }
    });
  });
}

module.exports = {
  id: 'agy', label: 'Agy (Gemini CLI)', webCapable: true,
  isAvailable, run, extractFinal,
};
