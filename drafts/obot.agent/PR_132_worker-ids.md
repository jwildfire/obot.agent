<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/132 on 2026-08-16 07:42 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Assignee: jwildfire, Labels: enhancement -->

## What this does

Every worker agent now claims a permanent `W0042` before it spawns and carries it in its own name, so a write can finally name the agent that made it. Ids are allocated inside an exclusive lock, come from an append-only journal rather than from scraped text, and are **never recycled — not even when a worker dies**.

Closes #130

You asked for this in one line: *"I also want each worker to get a unique ID moving forward W000x"*. The reason it matters is that GitHub cannot help here at all — every issue, PR, comment and commit an agent writes is authored by the same `obotclaw[bot]` identity, and no field separates one agent from another. With 33 workers started in the last day and six live at the peak, "which one did this" had no answer.

## Roadmap context

Implements [obot.roadmap#194](https://github.com/jwildfire/obot.roadmap/issues/194) (filed before this branch existed, per your rule that every ask should change the roadmap concretely), which sits under [goal #73 — increased autonomy](https://github.com/jwildfire/obot.roadmap/issues/73). Design calls I1–I4 are recorded there with their costs.

Prerequisite for [obot.roadmap#184](https://github.com/jwildfire/obot.roadmap/issues/184), the worker closeout check: that requirement's design concluded the only sound way to attribute a write is a stamp applied **at write time**, which is impossible until each worker knows what to stamp.

## Evidence

- <a href="https://github.com/jwildfire/obot.roadmap/issues/194">Requirement #194</a> — business case, measurements, and the four design calls
- <a href="https://github.com/jwildfire/obot.agent/issues/130">Task issue #130</a> — the build spec this PR implements
- <a href="https://github.com/jwildfire/obot.agent/blob/worker-ids/NEWS.md">NEWS.md</a> — the v0.5.0 (Upcoming) entry
- <a href="https://github.com/jwildfire/obot.agent/blob/worker-ids/tools/navigator/test/worker-id.test.mjs">worker-id.test.mjs</a> — 19 new tests
- **271 tests pass** (248 on `main`), `obot-policy validate` clean, policy verdict sweep identical to the baseline — the full CI gate, run locally
- **The concurrency test was proved to have teeth**: with the `flock` disabled it fails on 3 of 3 runs and passes on 3 of 3 with it restored. The test is not passing by luck.

## Technical briefing

**The mechanism is shared, not copied.** `tools/lib/blockers_ledger.py` already had the right pattern (#127/#129) — locked allocation, append-only journal, ids from the high-water mark, verdict-first reporting. That moves to `tools/lib/id_ledger.py` parameterised by id scheme, and the blockers module becomes a thin specialisation binding `c`/4. Its public API is unchanged, so `blocker-log`, the sweep and all 12 of its existing tests are untouched and still pass.

**What did not generalise, and why I stopped there.** Each ledger's *audit* stays in its own module. The two check against different realities: the config list compares its journal against a markdown file you hand-edit, the worker ledger compares it against the harness's job records. Only the mechanism is common — what counts as a finding is not — and forcing one audit to cover both needed a parameter meaning "which kind of truth is this", which is where a shared abstraction starts costing more than it saves.

**There is deliberately no `workers.md`.** The roster renders from the journal on demand. A stored copy would be a second source that can drift — the shape of the decision registry's `status` field, which everything writes and nothing reads while the Index row is the real authority.

**The audit's fourth check is the one that earns its place.** Three checks ask whether the ledger is internally sound (an id issued twice, a hole in the sequence, one id on two live workers). The fourth asks whether *anyone is using it*: a worker that spawned with no id is a finding. Without it, this could ship, be wired into the sweep, report success every run and never once be called by a spawn — indistinguishable from working. It checks the harness's own job records, so it is reality rather than self-report.

Same reason an unarmed ledger reports **NOT ARMED** rather than "nothing to check", and fails outright when workers are running behind it. That hole was open in my first draft and is closed here.

**The name shape is a function, not a line in a doc** (`worker-id name`), so the convention and the check that enforces it cannot drift. The six other files that spelled out the old shape are updated with it.

**Subagents** take the parent's id with a `.n` suffix (`W0042.1`). The skill states plainly what degrades for them — no harness job row, so no terminal detection and no unstamped check; the id must ride in the prompt because `Agent` has no name; and the claim is voluntary. Accepted because that lane measures at zero use in this workspace.

**Deviations from the task issue**, both simplifications: the tests live in `tools/navigator/test/` (following `blocker-log`'s precedent of testing beside its consumer), so the CI glob already covers them and `.github/workflows/test.yml` needed no change; and `obot-auto`'s integration is not unit-tested — it has no existing test harness and heavy preconditions, so only the pure name-shape piece is covered. Saying so rather than implying coverage.

**No guardrail paths touched.** The `PostToolUse` write-time mutation hook that #184's design wants would touch `hooks/` and needs your attestation; it is left to #184 on purpose, which keeps this on the standard lane and keeps the requirement to one release.

## Next steps

1. **Merge on the standard lane** (`main`, `auto` profile, no guardrail paths), then `worker-id init` to arm the ledger and stamp the epoch, then verify the audit fires on the live launchd sweep. I will do all three and confirm the live reading, not just the wiring.
2. **Expect findings for a while.** Long-running leads still hold the old skill in context, so workers they spawn will show as unstamped until they pick it up. That is the check working, not breaking — the finding text says exactly what to do.
3. Forward-only, as you asked. Last night's 33 workers are not in the ledger and will not be: three of them left no recoverable trace at all, so a backfill could never be complete, and a partial one that looked complete would be worse than a clean start.

---

This PR was drafted by Claude Code using Opus 5 in an unattended sibling session (👯🤖 workerids) and reviewed by @jwildfire
