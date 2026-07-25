# Workspace hooks

The Claude Code hooks the obot workspace runs, and the installer that puts them
there.

Until 2026-07-25 these lived **only** in `~/Documents/obot2/.claude/hooks/`, which
is not a git repository. The merge guard — the thing that makes `obot-merge` the
only merge lane — existed on exactly one machine, with no history, no review, and
no way to notice if it were edited or lost. This directory is now the source; the
workspace copy is still what the harness executes.

## The hooks

| Hook | Event | What it does |
|---|---|---|
| [`merge-gate-guard.sh`](merge-gate-guard.sh) | `PreToolUse` (Bash) | Denies raw PR-merge commands (`gh pr merge`, the `pulls/N/merge` and `merges` REST endpoints, the `mergePullRequest`/`mergeBranch` GraphQL mutations) so the only mechanical merge lane is `scripts/obot-merge`, which enforces branch policy and merges as `obotclaw[bot]`. Prose mentions in backticks or quotes are ignored. |
| [`scratchpad-heartbeat.sh`](scratchpad-heartbeat.sh) | `Stop` | Nudges a session to log to the shared session scratchpad when it has gone quiet for 30 minutes. Skips short sessions and rate-limits itself to one nudge per staleness window. Lean-bookends design, obot.agent#29. |
| [`session-state-publish.sh`](session-state-publish.sh) | `Stop` | Publishes session state to the hub's `session-state` branch, which drives the roadmap page's session indicator ([obot.roadmap#57](https://github.com/jwildfire/obot.roadmap/issues/57) D5). Silent, detached, lock-guarded with a 60s floor. |

## Install

```bash
obot.agent/hooks/install.sh                  # into ~/Documents/obot2
obot.agent/hooks/install.sh --workspace DIR  # elsewhere
obot.agent/hooks/install.sh --check          # report drift, change nothing
```

The installer copies each script into `<workspace>/.claude/hooks/` and registers
it in that workspace's `settings.json` under the right event, **merging** into
whatever is already configured rather than replacing it. It is idempotent, and
matches existing registrations by script basename — so a hand-tuned command
string (added `timeout`, custom `statusMessage`) survives a re-run.

`--check` diffs the installed copies against this directory and exits non-zero on
drift, which is the cheap way to catch a workspace-side edit that was never
brought back here.

## Writing a Stop hook

Two things bite, both learned the hard way:

- **stdout is a decision, not a log.** The Stop contract reads stdout as JSON; a
  stray `echo` becomes a `{"decision": ...}` parse or noise on every turn. Print
  nothing unless you mean to block.
- **It fires for every agent.** Sibling sessions stop independently and
  concurrently. Anything touching a shared resource needs a lock and a rate
  limit, or several agents will race — see `session-state-publish.sh` for the
  atomic-`mkdir` pattern.

Long or network-bound work should be backgrounded, and failures swallowed: a hook
that fails must not turn a working session into an error.
