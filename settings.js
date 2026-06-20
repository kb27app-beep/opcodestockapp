// settings.js — server-side secret store at repo root.
// Persists API keys to gitignored .secrets.json and exposes a SECRET-FREE public view.

const path = require('path');
const fs = require('fs');

const SECRETS_PATH = process.env.SECRETS_PATH || path.join(__dirname, '.secrets.json');
const ALLOWED_KEYS = ['apiKey', 'apiBaseUrl', 'apiModel', 'apiWebSearch', 'fmpKey', 'cascadeOrder'];
const DEFAULT_ORDER = ['claude', 'codex', 'agy', 'api'];

// Read the secrets file, parse JSON, return merged with defaults
function readSettings(opts = {}) {
  const p = opts._path || SECRETS_PATH;
  let parsed = {};

  try {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      parsed = JSON.parse(content);
    }
  } catch (err) {
    // On missing or invalid JSON, return empty object
    parsed = {};
  }

  return {
    ...parsed,
    cascadeOrder: parsed.cascadeOrder || DEFAULT_ORDER,
  };
}

// Write settings to the secrets file, filtering to ALLOWED_KEYS
function writeSettings(patch, opts = {}) {
  const p = opts._path || SECRETS_PATH;

  let existing = {};
  try {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      existing = JSON.parse(content);
    }
  } catch (err) {
    existing = {};
  }

  const next = { ...existing };
  for (const k of ALLOWED_KEYS) {
    if (k in patch) {
      next[k] = patch[k];
    }
  }

  fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');

  return {
    ...next,
    cascadeOrder: next.cascadeOrder || DEFAULT_ORDER,
  };
}

// Return a PUBLIC view that never includes secret values (apiKey, fmpKey)
function publicView(s) {
  return {
    apiBaseUrl: s.apiBaseUrl || '',
    apiModel: s.apiModel || '',
    apiWebSearch: !!s.apiWebSearch,
    cascadeOrder: s.cascadeOrder || DEFAULT_ORDER,
    configured: {
      api: !!s.apiKey,
      fmp: !!getFmpKey(s),
    },
  };
}

// Get FMP key from settings or FMP_API_KEY environment variable
function getFmpKey(s) {
  return (s && s.fmpKey) || process.env.FMP_API_KEY;
}

module.exports = {
  SECRETS_PATH,
  ALLOWED_KEYS,
  DEFAULT_ORDER,
  readSettings,
  writeSettings,
  publicView,
  getFmpKey,
};
