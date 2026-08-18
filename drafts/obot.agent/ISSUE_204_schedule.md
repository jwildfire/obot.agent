<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/204 on 2026-08-18 01:02 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, type:task -->

Requirement: jwildfire/obot.roadmap#238 — the morning fold, and the briefing it produces.

## What schedules it

A launchd job with `StartCalendarInterval` at 07:00, running the fold script.

The choice matters more than it looks. The open readiness question — [D0019](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-16-scheduled-sessions-assessment/), answer "not yet" — asks whether a scheduled job may start an **agent** unattended, and `scripts/policy.json` says the same: autonomy is A1, and A2 is `scheduled — nightly trigger without a human launch (not yet enabled)`. Neither says anything about a scheduled script, and this machine already runs one with his acceptance: `com.obot.navigator-sweep` executes a node script under launchd every 300 seconds. The fold is that class of thing, and it is not waiting on D0019.

One correction to the requirement's own text, which should not be relayed further unqualified: "there is no clock-time scheduling primitive in use anywhere on this machine today" is true of obot's jobs only. `com.dough.backup` on this account uses `StartCalendarInterval` and has exited clean. The primitive is proven here; we simply have not used it.

## What this task does

- `tools/fold/install-launchd`, alongside the sweep's installer, writing `com.obot.morning-fold.plist` with `StartCalendarInterval` at 07:00 local.
- Absolute interpreter path and an explicit `PATH`, because launchd gives no shell profile. The sweep's plist hardcodes the current nvm node path, which means an nvm version bump silently kills the schedule while `launchctl list` still shows the label — so the installer resolves the path at install time and the fold's own preflight says which interpreter it is running under.
- Its own launchd job, not a hook off the sweep. The sweep already fast-forwards the checkout, restarts the dashboard, and blocks for up to two minutes spawning the admiral; a fold hanging off that cadence inherits that budget.
- The fold re-checks `.claude/autonomy-halt` itself. The halt file is read once at launch by `obot-auto`'s preflight and no registered hook references it, so a lane that does not route through `obot-auto` is not covered by the kill switch unless it looks.

## A fold that did not run has to be visible

This is the part that matters, because silence is load-bearing here: a quiet night and a dead fold produce identical output, which is nothing.

Two facts make that likely rather than theoretical. launchd does not defer a calendar fire missed while the machine slept — it runs once on wake, at an arbitrary hour, and D0019 measured that missed runs are lost rather than replayed. And the host does sleep: `pmset -g custom` reads `sleep 0` on both power sources, yet the power log records real sleeps on 17 August, and the sweep's own log has eight observation gaps over fifteen minutes in three days, three of them over four and a half hours.

So the fold is idempotent — it folds the window its watermark defines, never the window its wall clock implies — and the briefing page carries the fold's own `asOf`, so a briefing a day stale says so on its face. That is the in-scope version of noticing.

Arming a scheduled wake needs `sudo pmset repeat wake`, which needs an administrator prompt at his keyboard. That lands on the briefing as an ask for him, not as something an agent quietly did.

## Acceptance

- The job is loaded, and `launchctl print` shows a completed run at 07:00 with exit 0 — proven from launchd's own record, not from the fold's log.
- A fire missed to sleep does not double-fold and does not skip the window: demonstrated by holding the watermark back and firing manually.
- A stale briefing shows its age on the page.
- The installer is re-runnable and does not duplicate the job.
- The plist's interpreter path is verified to exist at install time, with a clear failure if it does not.

## Not this task

An off-machine alarm for a fold that never fired at all — that is D0019's H2, still unanswered, and building it here would answer a question in front of him. The task ships the visible-staleness version and names the gap.

---

Filed by 👯🤖 W0045 (Claude Code using Opus 5). Not reviewed by @jwildfire.
