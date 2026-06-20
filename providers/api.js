// providers/api.js — generic OpenAI-compatible streaming HTTP provider.
// Covers OpenRouter / OpenAI / Perplexity and any other OpenAI-compatible endpoint.

const { buildPrompt, typedError } = require('./base');

// Parse Server-Sent Events data line.
// If dataStr is '[DONE]' return null.
// Otherwise JSON.parse in try/catch, return null on error.
// Return obj.choices?.[0]?.delta?.content || null.
function parseSseData(dataStr) {
  if (dataStr === '[DONE]') return null;
  try {
    const obj = JSON.parse(dataStr);
    return obj.choices?.[0]?.delta?.content || null;
  } catch (_) {
    return null;
  }
}

// Check if the model supports web search.
// Returns true only if the model ends with ':online', starts with 'sonar', or apiWebSearch is explicitly true.
function webCapable(settings) {
  if (!settings) return false;
  const m = settings.apiModel || '';
  return /:online$/.test(m) || /^sonar/i.test(m) || (settings.apiWebSearch === true);
}

// Check if the provider is available.
// Requires apiKey, apiBaseUrl, and apiModel all to be set.
function isAvailable(settings) {
  return !!(settings && settings.apiKey && settings.apiBaseUrl && settings.apiModel);
}

// Main run function: stream content deltas from an OpenAI-compatible API.
function run(symbol, context, onText, opts = {}) {
  const settings = opts.settings || {};
  const _fetch = opts._fetch || fetch;
  const timeoutMs = opts.timeoutMs || 240000;
  const started = Date.now();

  // Fail fast if not fully configured. The orchestrator already filters via isAvailable(),
  // but a direct caller could reach here — avoid POSTing to `undefined/chat/completions`.
  if (!settings.apiKey || !settings.apiBaseUrl || !settings.apiModel) {
    return Promise.reject(typedError('API provider not configured', 'not_authenticated'));
  }

  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(typedError('Request timed out', 'timeout'));
    }, timeoutMs);

    const prompt = buildPrompt(symbol, context);
    const requestBody = {
      model: settings.apiModel,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    };

    _fetch(`${settings.apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
      .then(async (resp) => {
        clearTimeout(timer);

        if (!resp.ok) {
          if (resp.status === 401 || resp.status === 403) {
            reject(typedError('Authentication failed', 'not_authenticated'));
          } else if (resp.status === 429) {
            reject(typedError('Rate limited', 'rate_limited'));
          } else {
            reject(typedError(`HTTP ${resp.status}`, `exit_${resp.status}`));
          }
          return;
        }

        try {
          const accumulator = [];
          const handleLine = (line) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) return;
            const piece = parseSseData(trimmed.slice(5).trim());
            if (piece !== null) { onText(piece); accumulator.push(piece); }
          };
          // Buffer across chunk boundaries: a single SSE line can be split across
          // network chunks, so we can't split each chunk independently.
          let sseBuf = '';
          for await (const chunk of resp.body) {
            sseBuf += String(chunk);
            let nl;
            while ((nl = sseBuf.indexOf('\n')) >= 0) {
              handleLine(sseBuf.slice(0, nl));
              sseBuf = sseBuf.slice(nl + 1);
            }
          }
          if (sseBuf) handleLine(sseBuf);   // flush any trailing partial line

          const text = accumulator.join('');
          if (!text) {
            reject(typedError('No output', 'no_output'));
          } else {
            resolve({ text, durationMs: Date.now() - started });
          }
        } catch (err) {
          reject(typedError(err.message || 'Stream read failed', 'spawn_error'));
        }
      })
      .catch((err) => {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          reject(typedError('Request timed out', 'timeout'));
        } else {
          reject(typedError(err.message || 'Fetch failed', 'spawn_error'));
        }
      });
  });
}

module.exports = {
  id: 'api',
  label: 'Manual API key',
  webCapable,
  isAvailable,
  run,
  parseSseData,
};
