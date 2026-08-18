<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/230 on 2026-08-18 07:52 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: bug, Assignee: @me -->

## What this does

Restores the checkout auto-update lane, which [#224](https://github.com/jwildfire/obot.agent/pull/224) took down.

Closes #229

The sweep has been reporting it since that merge: `**AUTO UPDATE FAILED** — the update step failed outright — alive is not defined. The checkout is untouched.` This machine has not fast-forwarded its own code since.

## Roadmap context

A regression in [#223](https://github.com/jwildfire/obot.agent/issues/223) (under [obot.roadmap#251](https://github.com/jwildfire/obot.roadmap/issues/251)), on the lane built by [obot.roadmap#243](https://github.com/jwildfire/obot.roadmap/issues/243). Found by 🧭🤖 obot-navigator, who fetched across seven clones to notice it. Milestone v0.5.0.

## The cause

Consolidating two copies of `alive` into one was right. The wiring was not:

```js
export { alive } from '../lib/killconfirm.mjs'   // selfupdate.mjs:355
```

`export … from` is a pure re-export — it forwards the binding to consumers and creates no local binding in the module. Both of this module's own uses then referenced a name absent from its scope: the `isAlive` default parameter of `restartDashboard` (line 367) and the lock-staleness check in `takeLock` (line 451). One line, split into two:

```js
import { alive } from '../lib/killconfirm.mjs'
export { alive }
```

## Evidence

Verified by effect through the real `selfUpdate` entry point, not by the suite. Same scratch clone deliberately two commits behind its origin, same scratch workspace, same rehearsal port — the only variable is which module is loaded.

<pre>
════ pre-fix, as shipped on main ════
  module under test: AS SHIPPED (live checkout)
  scratch clone at d19b8b4
  update step THREW — ReferenceError: alive is not defined
  → this is what the sweep renders as **AUTO UPDATE FAILED**

════ post-fix ════
  module under test: FIXED (worktree)
  scratch clone at d19b8b4
  update step COMPLETED — HEAD now 3b30115, moved=true
</pre>

The clone really moved two commits. Suite: 1046 tests, 0 failures.

A note on that rehearsal, because the first version of it was worthless. Run against a fresh scratch workspace it passed on the broken module too — nothing there contends the lock, and with no dashboard advertising itself there is no restart to plan, so neither call site is ever evaluated. It only became evidence once it planted a lock file held by a live pid, which is the condition that forces `takeLock` to ask whether the holder is alive.

## Technical briefing

Four new cases, and what makes them different from the thirty-seven that passed while this was broken: they inject nothing at the seam under test.

- `restartDashboard` with no `isAlive`, against a dead pid — the default has to resolve, and reads `gone`.
- The same, against a live pid — so a binding that only worked on the falsy branch cannot pass.
- `takeLock` contended by a live holder — the second call site, reached only when `held?.pid` is truthy.
- `takeLock` against a dead holder — the same site, opposite branch, proving a crashed sweep cannot hold the lock forever.

The general lesson, which is the part worth keeping: a re-export is syntactically valid, imports cleanly, and resolves for every consumer. It fails only where the name is evaluated. Both evaluations here sit behind injectable seams that every existing test supplied a value for — and a default parameter that all your tests override is covered by none of them. The lane that keeps this machine's code current is exercised by launchd and by nothing else, which is why four hours passed with a green suite.

## Next steps

- After merge, the live sweep's Checkout section is the authoritative check; it runs on a five-minute leash and will fast-forward this checkout itself.
- The other clones on this machine being behind (safety.viz 7, gsm.safety 31, open.csr 19, demo-301 6) is obot.roadmap#243's scope — they have no lane at all — and is deliberately untouched here.
- No carve-out path touched; standard tier.

---

Drafted by 👯🤖 W0048 using Opus 5, reviewed by @jwildfire
