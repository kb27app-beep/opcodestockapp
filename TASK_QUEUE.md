# TASK_QUEUE — ARYA'S Stocks Pro revision

## Done
- [A] Real-data accuracy: correct Yahoo meta fields (longName, chartPreviousClose, 52w).
- [B] Security: server.js /proxy SSRF allowlist. Verified.
- [C] Code quality: removed duplicate curLabel; (est.) labels; real package.json.
- [D] Docs: ARYA.md changelogs v1.1.0 + v1.2.0.
- [E] Real fundamentals LIVE: yahoo-auth.js (Playwright crumb automation) + /yf-fundamentals.
      Verified end-to-end (Apple/Reliance real mcap/PE/sector/ROE). Cached + graceful fallback.
- [F] File split: index.html + styles.css + app.js (buildless). Fixed 9 literal ${...} bugs.
- [G] UI modernization: Fraunces/Spline Sans/JetBrains Mono, warm light+dark themes, grain,
      micro-interactions, theme-aware gold charts, currency-correct mcap, favicon.
      Verified via Playwright screenshots (light/dark dashboard + analyzed, both themes).

## Open / optional follow-ups
- Enrich the 10 analysis modules with the now-available real financials (ROE, margins,
  revenue growth, debt) instead of template text — biggest remaining authenticity gain.
- Consider bundling Chromium (playwright install) for users without system Chrome.
- Surface a one-time data-provenance note explaining live vs estimated.

## Notes
- Live fundamentals need a local Chrome (channel:'chrome'); falls back to estimates otherwise.
- Yahoo 429-throttles rapid repeated calls; the module backs off and caches 10 min.
- Changes are NOT committed (push to main is off-limits; commit needs explicit ask).
