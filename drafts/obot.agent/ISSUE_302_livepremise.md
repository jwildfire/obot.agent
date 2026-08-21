<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/302 on 2026-08-21 -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me, Parent: jwildfire/obot.roadmap#266 -->

### What this fixes

The claim-currency gate shipped on 2026-08-20 skips every artifact that is decided or closed, and says so plainly in the sweep: `18 decided or closed artifacts not re-checked`. The skip exists for a good reason — most of a settled artifact's premises are history, and re-checking history every five minutes is how a section stops being read.

But a decided artifact can still make a claim about the present. D0020 is decided and its page asserts that goal #73's rename and rewritten body are approved and **not yet applied**. That is true today and stops being true the moment somebody applies them, at which point the page tells a reader something false and nothing is looking.

So `decided` is not the same as `no longer making claims`. The skip is keyed on the wrong property. Recorded as call n0245 on [obot.roadmap#266](https://github.com/jwildfire/obot.roadmap/issues/266#issuecomment-5328309079), found by 👯🤖 W0074 while recording D0020 rather than while looking for this.

### The change

The premise decides whether it is re-checked. The artifact's state only supplies a default.

One attribute on the declaration the contract already asks authors to write:

```html
<meta name="premise" scope="live" content="goal #73 still carries its old title … | gh issue view 73 … → prints …">
<meta name="premise" scope="history" content="v1.1.0 is published, not a draft | gh release view … → prints false">
```

- `scope="live"` — a claim about the present. Re-checked forever, whatever the artifact's state.
- `scope="history"` — a claim about what was true when the decision was made. Checked at publish time, never re-checked.
- no `scope` — the artifact's state supplies the default: re-checked while the artifact is still awaiting him, **undeclared** once it settles.

Undeclared is a third state and is not history. A settled artifact's undeclared premises are not re-checked — reintroducing eighteen artifacts re-asserting history every five minutes is the regression this must not cause — but they are named with their ids in the section, so "not re-checked" can never read as "checked and fine".

A `scope` value that is neither word is a declaration error, not a default. It is refused and reported under the existing `CLAIM CHECK BROKEN` headline, because guessing which kind the author meant is the thing this change exists to stop.

### The two things that bite

- **A premise can be false the moment it is written**, because it is written by whoever wrote the artifact out of the same understanding that produced its framing. One was: a draft premise on D0021 read "v1.1.0 is still held at the tag, unpublished" — the corrected-away claim. As a checkable premise that reports broken forever with no path to green. The publish-time gate is the answer, and it does not currently work for exactly the artifacts this change adds: `checkArtifact()` reads its premises through the same filter, so on a decided artifact it reports "declares no premise" for a page that declares one. Silent success, in the mechanism built to stop it. Fixed here: publish time evaluates every premise a page declares, whatever its scope and whatever the artifact's state.
- **A live premise that cannot break is not a premise.** `judge()` honours `prints X` for a single token only; a multi-word expectation falls through to the exit code, which for a `gh … --jq` read is 0 whatever it printed. D0020's premise is one of those — it would have reported `holds` after the rename was applied. Widened to compare the whole expected output.

### Done when

- A live premise on a decided artifact is re-checked and reports correctly, in the sweep's rendered output.
- A history premise on a decided artifact is correctly not re-checked, and the section says how many and why.
- Undeclared premises on settled artifacts are named rather than silently absent.
- The publish-time gate answers for a decided artifact.

---

Drafted by 👯🤖 W0102 using Opus 5. NOT reviewed by @jwildfire.
