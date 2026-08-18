<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/224 on 2026-08-18 07:00 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: bug, Assignee: @me -->

## What this does

The sweep's hard ceiling reported kills it had not made. This makes a reported kill a proven one, and makes an unproven one a finding rather than a line that reads like success.

Closes #223

The five-minute sweep is the outermost link in every liveness guarantee here — an agent can stall, a script cannot, so the regress terminates at launchd. On the night of 18 August that sentence had no mechanism behind it: `.claude/session-hub/admiral.log` recorded session `1cc6cc32` as killed five times in twenty-one minutes, at three different pids, and six lines read `killed overrunning admiral <id>: no pid found — reported only`. Four admirals ran 263 to 279 minutes against a thirty-minute budget while the log called them killed. 🎩🤖 obot-prime terminated all four by hand.

## Roadmap context

Implements [obot.roadmap#251](https://github.com/jwildfire/obot.roadmap/issues/251) via [#223](https://github.com/jwildfire/obot.agent/issues/223). Sibling of [#236](https://github.com/jwildfire/obot.roadmap/issues/236), which builds the admiral; this is the rule about what a kill has to prove before it may be called one, and it binds paths that have nothing to do with the admiral. Milestone v0.5.0.

## Evidence

Three cases driven against the real `scripts/obot-admiral`, with a real orphaned process that ignores SIGTERM, real signals, and the real process table — not stubs.

<b>Case 1 — the production shape.</b> The process is signalled and dies; the session is still in the ledger afterwards.

<pre>
STOP UNCONFIRMED for overrunning admiral mgr1: pid 75784 exited on SIGTERM then SIGKILL
but session mgr1 is still listed in the agent ledger (pid 75784), so whether it was
stopped or re-hosted is unestablished — unknown is not success

admiral.log:  KILL-UNCONFIRMED mgr1 — …
page:         **ADMIRAL STOP UNCONFIRMED FINDING** — admiral job mgr1 has run 90m …
</pre>

The old code wrote `killed overrunning admiral mgr1: SIGTERM to pid 75784` here.

<b>Case 2 — a genuine stop.</b> Session leaves the ledger; the process is confirmed gone on the process table, not on an exit code.

<pre>
STOPPED overrunning admiral mgr1: pid 76115 exited on SIGTERM then SIGKILL and session
mgr1 is no longer in the agent ledger — stop confirmed at the session, not merely at
the process

page:  **ADMIRAL KILLED ON A BREACHED BUDGET** — …
</pre>

<b>Case 3 — the line that started this.</b> No pid found.

<pre>
STOP UNCONFIRMED for overrunning admiral mgr1: no session in the agent ledger carries
the id mgr1, so nothing was signalled — this is a detection failure, not a stop

page:  **ADMIRAL PID RESOLUTION FAILED** — …
occurrences of "killed" in the record: 0
</pre>

Suite: 1028 tests, 0 failures across the full CI command. 12 new cases in `tools/navigator/test/killconfirm.test.mjs`, 4 in the launcher suite, 5 in the section/record suite, 2 pinning the second termination path.

## Technical briefing

<b>The measurement that decided the design.</b> The three pids are not a stale lookup. The pid `claude agents --json` reports for a background session is a `claude bg-spare` claimed from a warm pool that `claude daemon run` owns — measured here, the process under one session's row had started fifty-six minutes *before* the session it was listed under. The job record carries `respawnFlags` and `resumeSessionId`: when a host dies the daemon claims another spare and resumes the session onto it. So SIGTERM stopped a pooled host, the session came back on a fresh pid, and the next sweep signalled that one. 67793 → 67795 → 74526 is the pool rotating, exactly as designed.

The consequence, and the reason this is not a two-line fix: a dead pid cannot prove a stopped session. A change that only re-checked liveness after SIGTERM would have gone on reporting confirmed kills for sessions that were still running.

<b>`tools/lib/killconfirm.mjs` (new).</b> One primitive for every path here that terminates a process:

- resolve on the session id, never the name;
- verify the pid against the live process table before signalling — a pid answering to something else has been recycled and is treated as not found, never signalled;
- SIGTERM, wait, verify absence, escalate to SIGKILL, verify again;
- then re-read the ledger: session gone ⇒ confirmed; session back on a live new pid ⇒ `respawned`; session still listed ⇒ `ledger-lag`. Both are findings.

Every outcome carries its own words and its own alarm headline, and the wording rule is held as a property over the whole vocabulary rather than branch by branch — a wording rule enforced one branch at a time is one the next branch forgets.

<b>`ALARM_RE` is now exported</b> from `tools/ops-dashboard/lib/navigator.mjs`, and the two test files that had copied it now import it. A copy is a second source of truth that drifts silently, and what it costs is a finding rendered as grey text ([#129](https://github.com/jwildfire/obot.agent/issues/129)).

<b>The kill gets its own log op.</b> `KILL` / `KILL-UNCONFIRMED` rather than the `HOLD` prefix it borrowed, which had put a termination inside the launch-decision vocabulary. Read back, it lets a run know a session has been signalled before — the evidence that sat unread through five attempts on one session.

<b>Every termination path in the repo, audited.</b>

| Path | Verdict |
|---|---|
| `scripts/obot-admiral` → `killAdmiral` | The defect. Retired; the launcher calls `confirmedStop`. |
| `tools/navigator/selfupdate.mjs` → `restartDashboard` | Already confirms and already fails honestly. Policy kept — it deliberately does not escalate to SIGKILL, because a wedged server serving yesterday's page beats a killed one serving nothing — and pinned by two new cases so neither the confirmation nor the policy can drift. Its `alive` is now the shared one rather than a second copy. |
| `serve-marker.mjs`, `statusline.sh` | `kill(pid, 0)` liveness probes. Not terminations. |
| `render.mjs` `RESTART_CMD` | A `pkill` string printed for @jwildfire to run. Advice to a human. |

<b>One test detail worth knowing about.</b> The fixture that ignores SIGTERM is started through `sh -c '… & echo $!'` and waits on a readiness file. Both matter: `echo $!` returns a pid before node has run a line, so the first version of this suite signalled the fixture *before* its handler existed and the case passed as the wrong outcome; and a child of the test process could never be reaped while the module's blocking wait runs, so a zombie would answer `kill(pid, 0)` exactly like a live process.

## Next steps

- Nothing in this PR arms or disarms the ceiling — `OBOT_ADMIRAL_KILL` still defaults to armed, unchanged.
- The requirement's fourth Done-when is met at the writer's end (the headlines match the real `ALARM_RE`, asserted against the exported regex). Worth one look at the rendered Navigator panel the next time a stop actually fires.
- No carve-out path is touched, so this is on the standard tier.

---

Drafted by 👯🤖 W0048 using Opus 5, reviewed by @jwildfire
