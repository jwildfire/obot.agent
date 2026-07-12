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

Outputs: live → `<workspace>/.claude/session-hub/live.html` (open in Chrome from
`file://`; the page auto-refreshes with scroll restore). Report →
`<hub>/reports/sessions/<slug>.html`, where the slug mirrors the diary entry
(`2026-07-11`, `2026-07-11-2`, …) — committed by the `session-wrapup` report step.

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
