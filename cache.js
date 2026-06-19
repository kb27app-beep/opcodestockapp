// cache.js — tiny disk-backed key/value cache with TTL.
// Used to persist Yahoo fundamentals (and the browser session) across server restarts,
// so a restart doesn't re-launch Chrome or re-hit Yahoo for data we just fetched.

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '.cache');

function ensureDir() {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (_) {}
}

function fileFor(key) {
  const safe = String(key).replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(CACHE_DIR, safe + '.json');
}

// Returns { data, ts, fresh } or null if missing/unreadable. `fresh` is false when older
// than ttlMs — callers can still use stale data as a fallback (e.g. when Yahoo 429s).
function read(key, ttlMs) {
  try {
    const o = JSON.parse(fs.readFileSync(fileFor(key), 'utf8'));
    return { data: o.data, ts: o.ts, fresh: !ttlMs || (Date.now() - o.ts < ttlMs) };
  } catch (_) { return null; }
}

function write(key, data) {
  ensureDir();
  try { fs.writeFileSync(fileFor(key), JSON.stringify({ ts: Date.now(), data })); return true; }
  catch (_) { return false; }
}

module.exports = { read, write, CACHE_DIR, ensureDir, fileFor };
