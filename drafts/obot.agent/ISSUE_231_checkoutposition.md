<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/231 on 2026-08-18 08:08 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: bug, Assignee: @me -->

## The Checkout section reports an operation where a reader needs a state

On a failed update the section printed:

```
**AUTO UPDATE FAILED** — the update step failed outright — alive is not defined. The checkout is untouched.
```

"The checkout is untouched" is a fixed string appended by the renderer whenever `checkout.ok` is false. The record it renders comes from `safeSelfUpdate`'s catch in `sweep.mjs`, which synthesises one out of nothing:

```js
catch (e) {
  return { at: ..., sweep: SELF, consumers: [],
           checkout: { ok: false, code: 'broken', branch: null, reason: `the update step failed outright — ${e.message}` } }
}
```

The catch discarded the real result, so it has no idea whether the fast-forward ran.

**It had.** `selfUpdate` calls `ff(root)` first and throws later, which is how the lane in [#229](https://github.com/jwildfire/obot.agent/issues/229) recovered itself — the broken sweep advanced the checkout onto its own fix and then threw. So every failed sweep on the night of 2026-08-18 asserted the checkout was untouched while it had just moved. The sentence was not misleading, it was false.

## And two different situations rendered identically

A failed update on a current checkout and a failed update on a checkout nineteen commits behind produced byte-identical output. Those are not the same situation: one is a broken reporter over healthy code, the other is a machine running code nineteen commits old with nothing saying so.

Measured on this machine the same night, after fetching: gsm.safety 31 behind, open.csr 19, safety.viz 7, demo-301 6. Those have no auto lane at all and nothing reports their position anywhere — that is [obot.roadmap#243](https://github.com/jwildfire/obot.roadmap/issues/243)'s scope. obot.agent is the one clone whose staleness is visible, so the sentence describing it carries more weight than it looks.

## What changes

Two facts instead of one: what the update attempted, and where the checkout actually stands.

- `checkoutPosition(root)` measures the checkout against `origin/main` independently of any update attempt.
- It takes the repo root and nothing else, because the caller that needs it most is the catch — the path with the least information. A measurement the catch cannot make would leave the defect in place under a new spelling.
- It never fetches. This runs on the failure path where a broken fetch may be the very thing that failed; a number obtained by going to the network answers a different question and would hide that. The sentence says "as last fetched".
- Unknown is its own answer, distinct from zero. Zero reads as "current", which is the one thing an unreadable checkout must never be able to claim — and distinct again from absent, since a long-running dashboard can read a record written before this change.
- `brokenRecord({ root, stamp, error })` builds the catch-path record where the knowledge is, position included, and cannot itself throw.

## Done when

- A failed update on a current checkout and a failed update on a stale one render differently, asserted as such.
- The word "untouched" cannot appear on a path that did not establish it.
- The position is proved not to fetch, by a case where the remote has moved and the answer is still what was last known.

## Credit

Found by 🧭🤖 obot-navigator while verifying [#230](https://github.com/jwildfire/obot.agent/pull/230). He framed it as a true sentence that reads false; it turned out to be a false one.

---

Drafted by 👯🤖 W0048 using Opus 5, reviewed by @jwildfire
