# Probe: codex & agy non-interactive web-search capability (2026-06-20)

Both CLIs were probed from `/tmp` with a prompt that requires current info + a source URL.
**Both are web-capable.** Verdicts: `codex` → `webCapable: true`, `agy` → `webCapable: true`.

## codex

**Invocation (verified, web search performed, cited a real URL):**
```
codex exec --json --ephemeral --skip-git-repo-check --sandbox read-only \
  -c tools.web_search=true -o <last-message-file> "<prompt>"
```
- `--json` → JSONL events on stdout. `-o <file>` → authoritative final message written to a file.
- `--ephemeral` → no session persistence. `--skip-git-repo-check` → allow running outside a git repo.
- `-c tools.web_search=true` → enables the web_search tool (the probe emitted `web_search` items and cited nasdaq.com).
- Auth: codex's own login (`CODEX_HOME`); `cleanEnv()` (strips CLAUDE*/ANTHROPIC*) does not disturb it. Run from `os.tmpdir()`.

**stdout event shape (JSONL, one object per line):**
- `{"type":"thread.started",...}` / `{"type":"turn.started"}` / `{"type":"turn.completed"}` — lifecycle, ignored.
- `{"type":"item.completed","item":{"type":"agent_message","text":"..."}}` — assistant text. There can be
  MULTIPLE agent_message items (intermediate "thinking" + the final answer); the **last** agent_message is the answer.
- `{"type":"item.completed","item":{"type":"web_search","query":...,"action":...}}` — a web search (confirms capability).
- `{"type":"item.completed","item":{"type":"command_execution",...}}` — a shell command codex ran.

**HIJACK GOTCHA (important, analogous to claude's):** without isolation, codex loaded the user's global
agent config + skills (stderr: `failed to load skill /Users/.../.agents/skills/autoresearch/SKILL.md`,
plus an MCP transport error) and ran `command_execution` "startup" steps — extra latency/cost and noise.
The first agent_message literally said "Using the required startup skill ...". **Production codex runs MUST add
`--ignore-user-config`** (skips `$CODEX_HOME/config.toml` — skills/MCP — while auth still uses `CODEX_HOME`).
`--sandbox read-only` also bounds any command execution. Net production invocation:
```
codex exec --json --ephemeral --skip-git-repo-check --ignore-user-config --sandbox read-only \
  -c tools.web_search=true -o <file> "<prompt>"
```

**Parser plan (`parseCodexLine`):** JSON.parse each line; for `item.completed` with `item.type==='agent_message'`
return `{kind:'delta', text:item.text}`; ignore everything else (return null). The provider streams those deltas
as progress and uses the `-o` file contents as the authoritative final text (fallback: last agent_message).

## agy

**Invocation (verified, web-grounded, cited a real URL):**
```
agy --print "<prompt>"
```
- Returns the final answer as **plain markdown text on stdout** (no JSON events, no token streaming). Exit 0, clean stderr.
- Gemini models ground with Google Search automatically — no web-search flag needed. Default model is fine;
  `--model "Gemini 3.5 Flash (Low)"` (cheapest) can be set explicitly. `--print-timeout` defaults to 5m.
- Auth: agy's own login; `cleanEnv()` does not disturb it. Run from `os.tmpdir()`.

**Parser plan:** there is no event stream — accumulate stdout, optionally emit it as a single (or chunked) delta,
and resolve with the full accumulated text as the final report.

## Consequence for the engine

- Both `codex` and `agy` join the research cascade (`webCapable: true`).
- Neither streams token-by-token like claude; both are effectively "resolve with full text" providers (agy entirely,
  codex via the `-o` final-message file). The provider `run()` still calls `onText` at least once so the UI shows output.
- Cascade order stays `claude -> codex -> agy -> api` (claude is the only true token-streamer; the rest are batch).
