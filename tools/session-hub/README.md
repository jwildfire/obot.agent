# session-hub

One-page **live dashboard** and frozen **wrapup report** for obot working sessions.
Requirement: [jwildfire/obot.roadmap#24](https://github.com/jwildfire/obot.roadmap/issues/24) ·
design: [24_design.html](https://jwildfire.github.io/obot.roadmap/requirements/design/24_design.html).

Zero dependencies (Node ≥ 18, stdlib only). Read-only over sources the session
framework already maintains — the only writes are the rendered HTML and a
gh-sweep cache. The optional [chat lane](#chat-obotroadmap77) adds a loopback
server and one message directory.

## Usage

From the **workspace root** (`~/Documents/obot2`):

```bash
node obot.agent/tools/session-hub/session-hub.mjs                 # one live render
node obot.agent/tools/session-hub/session-hub.mjs --watch --serve # live mode: regenerate ~60s, serve on loopback
node obot.agent/tools/session-hub/session-hub.mjs --report        # frozen wrapup report
```

| Option | Meaning |
|---|---|
| `--watch` | regenerate on an interval (live mode only) |
| `--serve` | also serve the live view on `http://127.0.0.1:7325/live.html` (live mode only) |
| `--port <n>` | serve port, default 7325; rolls forward if the port is taken |
| `--interval <sec>` | watch interval, default 60 |
| `--report` | report mode: freeze semantics, output into the hub |
| `--workspace <dir>` | workspace root (default: cwd) |
| `--hub <dir>` | obot.roadmap clone (default: `<workspace>/obot.roadmap`) |
| `--out <file>` | override the output path |
| `--slug <slug>` | override the report slug (default: derived from the session marker) |
| `--open` | print the live view's URL after the first render (the served one when `--serve` is on) |
| `--emit-state <file>` | also write the compact session-state JSON (below) |

Outputs: live → `<workspace>/.claude/session-hub/live.html` (open in Chrome from
`file://`; the page auto-refreshes with scroll restore). Report →
`<hub>/reports/sessions/<slug>.html`, where the slug mirrors the diary entry
(`2026-07-11`, `2026-07-11-2`, …) — committed by the `session-wrapup` report step.

## Serving the live view (`--serve`)

`--serve` publishes the rendered file on **loopback HTTP** — `http://127.0.0.1:7325/live.html`,
or the next free port — and writes the endpoint to `.claude/session-hub/serve.json`:

```json
{ "port": 7325, "pid": 42717, "url": "http://127.0.0.1:7325/live.html", "startedAt": "…" }
```

Why serve a file that is already on disk: terminals disagree about what a `file://`
hyperlink means. Ghostty hands one to **Finder** rather than the browser, so the
[status-line link](../statusline/README.md) opened a Finder window instead of the
dashboard. An `http://` URL always lands in the default browser. The status line reads
`serve.json`, checks the pid is alive, and uses the URL when it is — falling back to
`file://` when nothing is serving, so the link never dangles.

The server is deliberately small and closed: loopback bind only (never `0.0.0.0` — the
live view carries session names, agent intents and scratchpad lines), `GET`/`HEAD` only,
no directory listings, no path escapes out of `.claude/session-hub/`, and `no-store` so a
regenerated view is never cached. `serve.json` is removed on exit; a killed process leaves
it behind, which is why readers check the pid.

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
`hooks/session-state-publish.sh` is the hook; `hooks/install.sh` puts it (and the
workspace's other hooks) in place and registers it — see [hooks/README.md](../../hooks/README.md).

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

## Chat ([obot.roadmap#77](https://github.com/jwildfire/obot.roadmap/issues/77))

> **Parked (2026-07-26).** #77 is in the backlog for a future obot release:
> @jwildfire's call that he is unlikely to use chat enough to justify standing up
> a prompt-injection lane. The code below is merged and works, but **nothing is
> armed** — the Stop hook installs only under `hooks/install.sh --with-chat`, and
> the server runs only when started by hand. Leave it that way unless #77 is
> revived.

Prototype. The live dashboard can also **send prompts to a running session and
stream the reply back** — design:
[77_design.html](https://jwildfire.github.io/obot.roadmap/requirements/design/77_design.html).
This is the one place the #24 "no server" decision (D1) is superseded, and only
for this feature: the generated pages are unchanged, and the report/static render
contains no chat markup at all.

```bash
node obot.agent/tools/session-hub/session-chat.mjs            # 127.0.0.1:4181
node obot.agent/tools/session-hub/session-chat.mjs --port 4200 --open
```

Then open `http://127.0.0.1:4181/` — the server renders the same live page (short
TTL, no separate `--watch` needed) with a Chat panel on top.

**Security.** A chat lane injects instructions into a live agent session, so the
inbox is a privilege boundary, not a message queue: the server binds `127.0.0.1`
with no flag to widen it, requires a JSON content type and a loopback `Origin` on
writes, holds no credentials, and is not a daemon — run it while you are looking
at the dashboard, stop it when you are not.

### The protocol

Everything is files under the workspace, keyed by the session's own UUID (the same
`sessionId` in `state.json` and `session_id` in the hook payload):

```
<workspace>/.claude/session-chat/<sessionId>/
  inbox/<epochMs>-<id>.json    # pending:   {id, from, text, createdAt}
  delivered/<id>.json          # claimed:   + {deliveredAt, lane: "hook"|"monitor"}
  outbox/<id>.json             # optional explicit reply: {id, text}
  log.jsonl                    # derived chat log (safe to delete)
```

Enqueue = write a file into `inbox/`. Claim = atomic `rename()` into `delivered/`,
so two claimers can never deliver the same message twice. Any producer works —
the dashboard is the first client, not the only possible one:

```bash
node obot.agent/scripts/obot-chat-wait --arm --session <sessionId>   # opt a session in
```

### Two delivery lanes, one inbox

| Lane | Reaches | Cost | How |
|---|---|---|---|
| **Stop hook** — [`hooks/chat-inbox-deliver.sh`](../../hooks/chat-inbox-deliver.sh) | a session that is *working* (delivery at its next turn boundary) | nothing; installed once | `{"decision":"block"}` whose reason is the framed message |
| **Monitor** — [`scripts/obot-chat-wait`](../../scripts/obot-chat-wait) | a session that is *idle* — within a second | one tool call per session | a persistent `Monitor` whose events wake the session |

Messages **queue, they never interrupt**: one per turn boundary, oldest first, with
queue depth shown on the page.

### How a session adopts chat

The hook is read at session start, so **chat reaches sessions started after
`hooks/install.sh` ran** — a session already running when it was installed has no
delivery lane, and the dashboard shows it as *not armed*. For the lead session,
adoption is two steps at kickoff:

```bash
obot.agent/hooks/install.sh --with-chat   # once per workspace — registers the Stop lane
```

then, in the session, arm the idle lane (this is the line `session-init` should
carry once #77's D2 is settled):

```
Monitor({ command: 'node obot.agent/scripts/obot-chat-wait --session <sessionId>',
          description: 'dashboard chat messages', persistent: true })
```

The reply half needs no adoption at all: the server tails
`~/.claude/projects/<slug>/<sessionId>.jsonl` and turns assistant `thinking` /
`tool_use` / `text` blocks into stream events, ending the turn on
`stop_reason: "end_turn"`.

## Data contract (pinned)

Collectors are independent and fallible: each returns data or a degradation
notice, and a failed collector renders as a per-panel notice line — never a
crash (design §4; `test/` exercises every degradation path).

| Source | Pinned fields / shape |
|---|---|
| `~/.claude/jobs/<id>/state.json` | `name`, `color`, `state`, `detail`, `tempo`, `tokens`, `children[] {kind,href,id}`, `output.result`, `createdAt`, `firstTerminalAt`, `updatedAt`, `cwd`, `respawnFlags` (model), `intent` — everything else is ignored as opaque. Chat additionally reads `sessionId` and `linkScanPath`. **Internal Claude Code format, not a documented API**: re-verify after CLI upgrades. |
| `~/.claude/projects/<slug>/<sessionId>.jsonl` (chat only) | `type: "assistant"`, `isSidechain`, `timestamp`, `message.content[] {type: thinking\|tool_use\|text}`, `message.stop_reason === "end_turn"` — unknown block kinds ignored, never fatal. Same harness-internal caveat. |
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
