<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/232 on 2026-08-18 08:14 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: bug, Assignee: @me -->

## What this does

Makes the Checkout section say what the checkout **is**, not only what the updater **tried**.

Closes #231

## Roadmap context

Found by 🧭🤖 obot-navigator while verifying [#230](https://github.com/jwildfire/obot.agent/pull/230). Same defect family as [#223](https://github.com/jwildfire/obot.agent/issues/223) one door down — a report describing an operation while a reader takes it as a state, which is what `KILL-UNCONFIRMED` separated for terminations. On the lane built by [obot.roadmap#243](https://github.com/jwildfire/obot.roadmap/issues/243). Milestone v0.5.0.

## Evidence — the two situations that used to be indistinguishable

Rendered by the real renderer against real git checkouts, one current and one nineteen commits behind. The only difference between the two runs is the state of the checkout.

<pre>
══════ failed update on a CURRENT checkout ══════

  BEFORE:
    **AUTO UPDATE FAILED** — … alive is not defined. The checkout is untouched.

  AFTER:
    **AUTO UPDATE FAILED** — … alive is not defined. The checkout is at `552e373` on
    `main`, level with `origin/main` as last fetched.

══════ failed update on a checkout 19 COMMITS BEHIND ══════

  BEFORE:
    **AUTO UPDATE FAILED** — … alive is not defined. The checkout is untouched.

  AFTER:
    **AUTO UPDATE FAILED** — … alive is not defined. The checkout is at `435ba47` on
    `main`, 19 commits behind `origin/main` as last fetched.
</pre>

Byte-identical before. Suite: 1057 tests, 0 failures.

## Technical briefing

The sentence was not merely misleading. `safeSelfUpdate`'s catch synthesised a checkout record out of nothing and the renderer appended "The checkout is untouched" as a fixed string — but `selfUpdate` calls `ff(root)` first and throws later. That is how #229's lane recovered itself: the broken sweep advanced the checkout onto its own fix and *then* threw. So every failed sweep that night asserted the checkout was untouched while it had just moved.

`checkoutPosition(root)` measures position independently of the attempt. Three properties, each of them load-bearing:

- **Root and nothing else.** The caller that needs it most is the catch — the path with the least information. A measurement the catch cannot make would leave the defect in place under a new spelling.
- **It never fetches.** This runs where a broken fetch may be exactly what failed. A number obtained by going to the network answers a different question from the one a reader on that path is asking, and it would hide the broken fetch behind a fresh-looking figure. The sentence says "as last fetched", and a case proves it: the remote moves, the clone is not fetched, and the answer is still what this machine last knew.
- **Unknown, absent and zero are three answers.** Zero reads as "current", which an unreadable checkout must never be able to claim. Absent is different again — a long-running dashboard can read a record written before this change, and an absent field is absent rather than guessed at.

`brokenRecord({ root, stamp, error })` builds the catch-path record where the knowledge lives, position included, and cannot itself throw — a catch-path builder that throws takes the sweep down.

On success the existing line already states position (`already at origin/main`, or the ref it moved to), so no second sentence is added there; the divergence only exists when the update did not do what it set out to.

## Next steps

- The live sweep is the authoritative check, on a five-minute leash.
- The other clones on this machine being behind — gsm.safety 31, open.csr 19, safety.viz 7, demo-301 6 — is obot.roadmap#243's scope. They have no lane at all and nothing reports their position anywhere; untouched here on purpose.
- No carve-out path touched; standard tier.

---

Drafted by 👯🤖 W0048 using Opus 5, reviewed by @jwildfire
