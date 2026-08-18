<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/262 on 2026-08-18 07:33 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->

### What this is

One mechanism serving [obot.roadmap#264](https://github.com/jwildfire/obot.roadmap/issues/264) (a config item's claim is checked on a cadence) and [obot.roadmap#266](https://github.com/jwildfire/obot.roadmap/issues/266) (a decision artifact notices when its own premise expires).

They are the same defect in two artifact classes: an artifact states a claim on the day it is written and nothing ever checks it again. #266 says so itself and asks for one mechanism rather than two.

### The shared thing

A **claim** is a sentence plus a proof: `<what is claimed> | <read-only command> → <what its output should say>`. That grammar already exists — it is the config list's `Verify:` line — so the mechanism is the same parser, the same read-only allowlist, the same runner, the same judge, and the same append-only ledger for both halves.

What differs is only where the claims are read from and what a verdict means there:

- config item — the claim is "this is done". Holds → it leaves his queue. Does not hold → still outstanding.
- decision artifact — the claim is a load-bearing premise. Holds → the page still frames the question correctly. Does not hold → the framing has expired and the page says so before he reads it.

### Three states, never two

`holds` / `does not hold` / `unknown`. A verify that fails to RUN is not a verify that FAILED.

This is not hypothetical here: `runVerify` today turns a command that never started — a missing binary, a timeout — into `exitCode: 1` and records it as `fail`. An item nothing could check reads as an item still waiting on him, and a premise nothing could check reads as a premise that still holds. That collapse is fixed as part of this work.

### Scope

- A shared claims module: parse, plan (read-only allowlist), run, judge, record, and phrase the age of the last reading.
- The five-minute Navigator sweep runs every auto-runnable claim in both classes and records each result with a time.
- Both halves render in one section of the sweep's state file, with headlines spelled for the real `ALARM_RE`, imported from `tools/ops-dashboard/lib/navigator.mjs` rather than copied.
- Every config item and card states when its claim was last checked, and says distinctly when it could not be.
- A config item whose check passes leaves the waiting-on-you queue, visibly rather than silently.
- The premise declaration for artifact authors: one `<meta name="premise">` line beside the `<meta name="description">` the contract already requires.

### Out of scope, deliberately

- Nothing on GitHub is auto-closed. An item leaving his local queue is one thing; closing an issue because a check passed is another and is not in this.
- No writes to `.claude/blockers.md` from the sweep. The list keeps the record; the queue is a view over it.
- Config item text never reaches a public surface. Counts and ids only, in every finding this renders.

### Done when

- A real sweep run shows all three states, distinguishably, on real items.
- A claim that could not be run is reported as unknown and never as outstanding.
- Every card and row carries the age of its last reading.

---

Drafted by 👯🤖 W0072 using Opus 5. NOT reviewed by @jwildfire.
