# Every surface that reads local state, and what it says on a machine with none

Requirement: [jwildfire/obot.roadmap#223](https://github.com/jwildfire/obot.roadmap/issues/223).
Task: [jwildfire/obot.agent#306](https://github.com/jwildfire/obot.agent/issues/306). Worker W0105, 2026-08-21.

The inventory is the deliverable, not a by-product of one. A pass that decides from
memory which surfaces matter leaves exactly the defect this requirement is about — the
original was found by accident in CI, after the local suite had passed hundreds of times
resting on this workstation's history.

Kept here rather than only in a pull request because the next pass needs to know which
surfaces were already honest as much as it needs to know which were not. Re-auditing
sixteen clean surfaces is the cheapest way for this work to look done twice and be done
neither time.

## How to reproduce the machine

Not a fixture and not a mock. A real one:

```bash
FRESH=$(mktemp -d)/home
mkdir -p "$FRESH/Documents/obot2"
git clone <obot.agent> "$FRESH/Documents/obot2/obot.agent"
git clone <obot.roadmap> "$FRESH/Documents/obot2/obot.roadmap"
mkdir -p "$FRESH/../ghconfig"

env HOME="$FRESH" GH_CONFIG_DIR="$FRESH/../ghconfig" GH_TOKEN= GITHUB_TOKEN= \
    OBOT_WORKSPACE="$FRESH/Documents/obot2" OBOT_DASHBOARD_PORT=7997 \
    <the surface>
```

That is the whole trick: no `~/.claude/jobs`, no `~/.claude.json`, no `.claude/` in the
workspace, clones whose remotes have never been fetched, and a `gh` that is not
authenticated. Give the dashboard an explicit `--port` so it does not claim this
machine's serve marker.

**Run it twice.** Two of the twelve defects below only appeared on the second reading,
because the first sweep creates directories that a reader then mistakes for records.

Two cautions learned the expensive way while doing this:

- `tools/config-count` and `tools/config-card` resolve the workspace from `process.cwd()`,
  and `config-count` ignores `OBOT_WORKSPACE` entirely. Run them with an explicit
  `--workspace` or they will read — and write to — the real one.
- The harness resets the shell's working directory between calls, so pass absolute paths
  and explicit flags rather than relying on a `cd`.

## The surfaces

`✓` was already honest and was left alone. `✗` was fixed under #306.

| Surface | On a machine with nothing | |
|---|---|---|
| `spend-guard check` | `**SPEND READING BROKEN**`, every figure `—`, refuses with exit 4 | ✓ |
| sweep — spend section | the same reading, `meter: NOT READ`, `artifact: NOT READ` | ✓ |
| sweep — RC queue | `**RC queue: UNREAD** — … This is not an empty queue` | ✓ |
| sweep — wake | `**NO READING** — there is no job ledger on this machine` | ✓ |
| sweep — checkout | names the unmeasured position rather than reporting one | ✓ |
| sweep — commit identity | `**COMMIT IDENTITY READING BROKEN**` per unscanned clone | ✓ |
| sweep — recent events | `- (none recorded yet)` | ✓ |
| sweep — constraints | `No constraint has been recorded on this machine yet` | ✓ |
| sweep — dispatch | `0 worker(s) in flight … no two are on the same one` | ✗ |
| sweep — admiral | `nothing to act on — no session past the bar, no idle operational PR…` | ✗ |
| sweep — carve-out routing | `nothing to route — 0 lane(s) checked, none forced the attested lane` | ✗ |
| sweep — local-only work | `local-only work: clean`, under its own `Nothing below is a clean bill of health` | ✗ |
| sweep — voice | `none unrouted — every sentence dictated into the lane reached a decision` | ✗ |
| sweep — claim currency | `**PREMISE BROKEN** … (checked just now)` for two premises nobody checked | ✗ |
| sweep — decision answers | `answers: no store on this machine yet` | ✓ |
| `tools/config-count` | refuses, names the path, `the last published count stands` | ✓ |
| `tools/config-card` | refused, naming neither the path nor what would create one | ✗ |
| `tools/premise-status` | every reading `state: unknown` with a `why` | ✓ |
| `tools/worker-id --audit` | `NOT ARMED`, names the path and `worker-id init` | ✓ |
| `tools/blocker-log --audit` | `no config list at … - nothing to check` | ✓ |
| `tools/delivery-log --audit` / `render` | `not armed` / `**NO RECORD**` | ✓ |
| `tools/landing-log list` | `**NO RECORD**`, names what writes the first | ✓ |
| `tools/serve-marker` | `state: none — no marker` | ✓ |
| `tools/ops-answers pending` | `every answer he has recorded has been applied` | ✗ |
| `tools/constraint-log brief` — constraints | `No constraint has been recorded on this machine yet` | ✓ |
| `tools/constraint-log brief` — siblings | `Nobody else is in flight right now` | ✗ |
| `tools/prime-rehydrate` | honest, except it carries `ops-answers` whole | ✗ (via `ops-answers`) |
| `tools/fold` queue line | `0 RC · 4 decisions · 0 todos · ? config items` | ✗ |
| `tools/session-init/handoff.sh` | two blank sections; a 3-day-old diary stamped `age: 10m` | ✗ |
| `tools/statusline` | falls back to the deployed hub link; `$0.00` is the harness's own figure | ✓ |
| `tools/session-hub` | `degraded`, each reason named | ✓ |
| `tools/rankviz` | honest per card; `0 on the bench` in the stat strip | ✗ |
| dashboard `/` | `— release candidates`, `— config`, each source named | ✓ |
| dashboard `/wire.html` | `Nothing recorded yet. None of the four sources…` | ✓ |
| dashboard `/session`, `/session/log` | keeps its feed and its record link | ✓ |
| dashboard `/navigator`, `/navigator/record` | `The sweep is failing`, `No numbers yet` | ✓ |
| dashboard `/session/frame` | 404 naming the command that creates it | ✓ |
| dashboard `/queue.json` | carries `sources[].read` and `why` | ✓ |
| dashboard `/config/{id}` | `c0002 is not an open item on the config list` | ✗ |
| dashboard `/healthz` | about the process, not about history | ✓ |

## The rule every fix applies

From [`tools/ops-dashboard/lib/absent.mjs`](../tools/ops-dashboard/lib/absent.mjs), which
owns the vocabulary while each surface keeps its own placement:

> A surface may print a figure only when it read the file the figure comes from.

Two things the rehearsal added to it, both learned here rather than reasoned out:

- **A store a READER creates is not a record.** The Navigator sweep makes `.claude/ops/`
  on its first pass, so keying "has this ever been answered" on the directory existing
  was true again five minutes into the machine's life. Ask whether anything was ever
  written, not whether a folder is present.
- **mtime is meaningless on a fresh clone.** Every file arrives stamped with the moment
  it was cloned, so any staleness guard reading mtime is blind on exactly the machine
  where everything is stale. Where a file's own name carries its date, that is the
  reading; where the two disagree, the older wins.

## What is deliberately not covered

- Anything about how a surface reads when the data IS present. Each fix has a test for
  the populated case beside the empty one, and none of those readings changed.
- The published hub site. It is built from committed data, so a fresh clone changes
  nothing about what it shows.
- Two things this pass surfaced and did not act on: `.claude/session-hub/cache/gh-sweep.json`
  is committed to this repository though the session-hub README says that cache is
  "derived, never committed" (it is on no read path, but removing it is a deletion and
  wants approval); and the style census produces byte-identical output whether or not
  `safety.viz`, `open.gismo` and `open.csr` are cloned, which means it is not measuring
  those surfaces at all.
