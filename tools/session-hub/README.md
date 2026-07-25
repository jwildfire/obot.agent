# session-hub

One-page **live dashboard** and frozen **wrapup report** for obot working sessions.
Requirement: [jwildfire/obot.roadmap#24](https://github.com/jwildfire/obot.roadmap/issues/24) ·
design: [24_design.html](https://jwildfire.github.io/obot.roadmap/requirements/design/24_design.html).

Zero dependencies (Node ≥ 18, stdlib only). Read-only over sources the session
framework already maintains — the only writes are the rendered HTML and a
gh-sweep cache.

## Usage

From the **workspace root** (`~/Documents/obot2`):

```bash
node obot.agent/tools/session-hub/session-hub.mjs                 # one live render
node obot.agent/tools/session-hub/session-hub.mjs --watch --open  # live mode: regenerate ~60s, print file:// URL
node obot.agent/tools/session-hub/session-hub.mjs --report        # frozen wrapup report
```

| Option | Meaning |
|---|---|
| `--watch` | regenerate on an interval (live mode only) |
| `--interval <sec>` | watch interval, default 60 |
| `--report` | report mode: freeze semantics, output into the hub |
| `--workspace <dir>` | workspace root (default: cwd) |
| `--hub <dir>` | obot.roadmap clone (default: `<workspace>/obot.roadmap`) |
| `--out <file>` | override the output path |
| `--slug <slug>` | override the report slug (default: derived from the session marker) |
| `--open` | print the `file://` URL after the first render |
| `--emit-state <file>` | also write the compact session-state JSON (below) |

Outputs: live → `<workspace>/.claude/session-hub/live.html` (open in Chrome from
`file://`; the page auto-refreshes with scroll restore). Report →
`<hub>/reports/sessions/<slug>.html`, where the slug mirrors the diary entry
(`2026-07-11`, `2026-07-11-2`, …) — committed by the `session-wrapup` report step.

## Session state (`--emit-state`)

`--emit-state <file>` writes a small JSON projection of the model beside the
normal render, for the roadmap page's session indicator
([obot.roadmap#57](https://github.com/jwildfire/obot.roadmap/issues/57), D5):

```json
{
  "state": "working",            // working | needs-input | idle
  "name": "obot session 2026-07-24-3",
  "detail": "5 agents · 2 working",
  "agents": { "total": 5, "working": 2, "needsInput": 0 },
  "slug": "2026-07-24-3",
  "updatedAt": "2026-07-24T13:40:18.926Z"
}
```

Aggregate counts only — deliberately. The hub site is public and agent-authored
`detail` strings are free text, so this publishes what a session *is doing at
what scale*, not whatever a running agent wrote about itself.

`scripts/obot-session-state` renders the payload and publishes it to the hub's
orphan `session-state` branch through the contents API (as `obotclaw[bot]`),
skipping the write when nothing but the timestamp changed:

```bash
obot.agent/scripts/obot-session-state --dry-run   # print the payload
obot.agent/scripts/obot-session-state             # publish if changed
```

**Cadence: the Stop hook** (@jwildfire, 2026-07-24) — it reuses the heartbeat the
session framework already runs, so the pill is current within a turn.
`tools/session-hub/hooks/session-state-publish.sh` is the hook; install it by
copying to `<workspace>/.claude/hooks/` and adding it to the `Stop` array in the
workspace `settings.json`, next to `scratchpad-heartbeat.sh`.

Because it fires for every turn of every agent in the workspace, the hook is
silent (stdout is a Stop *decision*, so it must print nothing), detaches the
publish so a slow API cannot delay a turn ending, and holds an atomic lock with a
60-second floor so concurrent siblings produce one publisher and one commit
rather than a write race. Publishing itself retries once on a 409. Every failure
is swallowed: a stale pill is cosmetic and must never surface as a session error.

The page reads the file from `raw.githubusercontent.com`, which is CORS-enabled
and caches for ~5 minutes; the indicator renders the payload's own timestamp so
it never claims to be fresher than it is. A path under `site/` was rejected for
this: every path the site deploy watches triggers a full Pages rebuild, R
toolchain included.

## Data contract (pinned)

Collectors are independent and fallible: each returns data or a degradation
notice, and a failed collector renders as a per-panel notice line — never a
crash (design §4; `test/` exercises every degradation path).

| Source | Pinned fields / shape |
|---|---|
| `~/.claude/jobs/<id>/state.json` | `name`, `color`, `state`, `detail`, `tempo`, `tokens`, `children[] {kind,href,id}`, `output.result`, `createdAt`, `firstTerminalAt`, `updatedAt`, `cwd`, `respawnFlags` (model), `intent` — everything else is ignored as opaque. **Internal Claude Code format, not a documented API**: re-verify after CLI upgrades. |
| `claude agents --json --cwd <ws>` | `kind`, `name`, `status`, `state`, `startedAt`, `sessionId`, `id`, `cwd` — interactive sessions + liveness of background ones |
| `.claude/session-notes/YYYY-MM-DD.md` | sections `## Overview` / `## Todo` / `## Notes` / `## Scaffold`; the `<!-- session-init … -->` marker is the session-boundary anchor (D4: marker time → anchor job's `createdAt` → local midnight) |
| memory + diary | `next-session-todo` memory; newest diary entry's "Next session" section |
| `gh search issues/prs` + releases | batched sweep (`updated ≥ session start`, labels included) plus one releases call per `ACTIVE_REPOS` repo, cached at `.claude/session-hub/cache/gh-sweep.json` (~5 min TTL) — derived, never committed. Event labels (`opened`/`merged`/`closed`/`updated`) are best-effort from search fields; Gilead-BioStats repos excluded (SAML). Feeds the Accomplishments panel (releases + `requirement`-labeled hub issues + closures). |

Not shown: cost in USD — no persisted per-session cost source exists; `tokens`
is the effort metric (design §2 note).

## Tests

```bash
cd obot.agent/tools/session-hub && node --test
```
