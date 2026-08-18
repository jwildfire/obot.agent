<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/229 on 2026-08-18 07:45 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: bug, Assignee: @me -->

## The checkout auto-update lane is down, and #224 took it down

The sweep has been reporting it since the merge:

```
## Checkout — the code this machine is running
**AUTO UPDATE FAILED** — the update step failed outright — alive is not defined. The checkout is untouched.
```

[#223](https://github.com/jwildfire/obot.agent/issues/223) consolidated two copies of `alive` into one, which was right. It wired the consolidation the wrong way:

```js
export { alive } from '../lib/killconfirm.mjs'   // tools/navigator/selfupdate.mjs:355
```

`export … from` is a pure re-export. It forwards the binding to consumers and creates **no local binding** in this module. Both of this module's own uses then reference a name that does not exist in its scope:

- line 367 — `isAlive = alive`, the default parameter of `restartDashboard`
- line 451 — `alive(held.pid)`, the lock-staleness check in `takeLock`

The fix is one line split into two:

```js
import { alive } from '../lib/killconfirm.mjs'   // with the other imports
export { alive }
```

## Why 1,046 tests did not catch it

This is the useful half, and it is not "the suite is thin".

A re-export is syntactically valid and the module imports cleanly — `import()` succeeds, every symbol resolves for consumers, and nothing fails until a code path *evaluates* the name. Both call sites are behind seams the suite always injects past:

- every existing `restartDashboard` case passes `isAlive` explicitly, so the default parameter is never evaluated;
- no case contends the lock, and an uncontended `takeLock` short-circuits on `held?.pid` before it reaches `alive`.

An injectable seam hides the binding it defaults to. That is the general lesson: a default parameter that every test overrides is not covered by any of them.

My first rehearsal of this fix missed it for exactly the same reason — a fresh scratch workspace neither contends the lock nor has a dashboard to restart, so the update step completed cleanly against the *broken* module too. The rehearsal only became evidence once it planted a lock held by a live pid.

## Done when

- Both call sites resolve `alive` with nothing injected at the seam under test.
- The update step is driven through `selfUpdate` under the condition that reaches the lock check, and fast-forwards a real clone.
- The sweep's Checkout section stops saying AUTO UPDATE FAILED on this machine.

## Scope note

Only the one clone with an auto lane lost it. The other repos on this machine being behind (safety.viz 7, gsm.safety 31, open.csr 19, demo-301 6) is [obot.roadmap#243](https://github.com/jwildfire/obot.roadmap/issues/243)'s scope — they have no lane at all — and is deliberately not touched here.

---

Drafted by 👯🤖 W0048 using Opus 5, reviewed by @jwildfire
