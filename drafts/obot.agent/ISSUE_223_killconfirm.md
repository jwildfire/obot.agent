<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/223 on 2026-08-18 06:44 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: bug, Assignee: @me, Parent: jwildfire/obot.roadmap#251 -->

## What this implements

[jwildfire/obot.roadmap#251](https://github.com/jwildfire/obot.roadmap/issues/251) — a kill this house reports is a kill it confirmed. The requirement carries the evidence; this issue carries the fix, plus one measurement made while reading the code that changes what the fix has to be.

## The measurement, because it decides clause 4

The requirement asks why one session reported three different pids. It is not a stale record. It is that the ledger's pid is not the session.

```
$ claude agents --json | jq '.[] | select(.id=="5ac26f5e") | {pid, startedAt}'
{ "pid": 48145, "startedAt": 1787033305282 }        # session started 02:08:25

$ ps -p 48145 -o lstart=,command=
Tue Aug 18 01:11:55 2026   claude bg-spare --bg-spare /tmp/cc-daemon-501/…/eebc11df.claim.sock
```

The process is 56 minutes older than the session it is listed under. It is a `claude bg-spare` claimed from a warm pool that `claude daemon run` (pid 17521, seven such children on this machine right now) hands out and re-hands-out. The job record carries `respawnFlags` and `resumeSessionId`, which is the daemon saying out loud what it does when a host dies: it claims another spare and resumes the session onto it.

So `process.kill(row.pid, 'SIGTERM')` terminates a pooled host, the daemon re-hosts the session on a fresh pid, and the sweep five minutes later finds the same session under a different pid and signals that one too. 67793, 67795, 74526 is not a bug in the lookup — it is the pool rotating, three times, exactly as designed.

The consequence for this fix: **a dead pid can never prove a stopped session.** Confirming the process is gone is necessary and not sufficient, and a fix that only added a liveness re-check after SIGTERM would have gone on reporting confirmed kills for sessions that were still running. Confirmation has to be read at the session level.

## What changes

- **`tools/navigator/killconfirm.mjs`, new** — one confirmed-termination primitive for every path in this house that signals a process. Resolve, verify identity, signal, wait, verify absence, escalate to SIGKILL, verify again, and then verify the *session* is no longer live. Only a confirmed absence returns a result whose words include a kill.
- **Identity before the signal.** The pid is joined on session id (already true) and then checked against the live process table: it must exist and be a `claude` process. A pid that answers to something else has been recycled and is treated as **not found** rather than signalled.
- **Respawn is a distinct outcome.** Process gone, session live again on a new pid ⇒ `respawned`, an unconfirmed kill and a finding. This is the case that was being reported as success.
- **Alarm vocabulary.** Unconfirmed outcomes render as `**ADMIRAL KILL UNCONFIRMED FINDING**` / `**ADMIRAL PID RESOLUTION FAILED**` — spellings that satisfy `ALARM_RE` in `tools/ops-dashboard/lib/navigator.mjs`, which is keyed on GAP/FINDING/BREACHED/FAILED/DOWN/BROKEN and renders anything else as grey body text.
- **The `no pid found` path loses the word killed**, in the outcome and in the log line the launcher writes around it. It is a detection failure and says so.
- **The kill gets its own log op.** `KILL` / `KILL-UNCONFIRMED` rather than the `HOLD` prefix it borrows today, so a kill can be read back out of `admiral.log` — and a session signalled before and still running is itself named as a repeat.

## Every termination path in the repo, audited

| Path | Verdict |
|---|---|
| `scripts/obot-admiral` → `killAdmiral` | The defect. Rewritten onto the primitive. |
| `tools/navigator/selfupdate.mjs` → `restartDashboard` | Already confirms: SIGTERM, wait, re-check, and on failure returns `ok:false` with "left running rather than killed". It does not escalate to SIGKILL, deliberately — a wedged server serving yesterday's page beats a killed one serving nothing. Policy kept, pinned by a regression test so the wording can never drift into success. |
| `tools/ops-dashboard/lib/serve-marker.mjs`, `tools/statusline/statusline.sh` | `kill(pid, 0)` — liveness probes, not terminations. Out of scope, correctly. |
| `lib/render.mjs` `RESTART_CMD` | A `pkill` string printed for @jwildfire to run. Advice to a human, not a path this house executes. |

## Done when

- A test drives the kill path against a process that ignores SIGTERM and the path reports a finding rather than success.
- A test drives the `no pid found` path and asserts the word killed does not appear.
- A test drives the respawn shape — process gone, session back on a new pid — and asserts it is a finding.
- The unconfirmed-kill alarm matches `ALARM_RE` and is asserted against that regex rather than against a copy of it.
- `scripts/obot-admiral`'s suite and the navigator suite are green.

---

Drafted by 👯🤖 W0048 using Opus 5, reviewed by @jwildfire
