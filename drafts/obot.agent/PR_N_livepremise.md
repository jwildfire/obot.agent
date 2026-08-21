<!-- STATUS: Drafted on 2026-08-21 -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Parent issue: #302 -->

The currency sweep skipped every artifact that was decided or closed, on the reasoning that a settled artifact's premises are history. D0020 is decided, and its page says goal #73's rename and rewritten body are approved and *not yet applied* — true today, false the moment somebody applies them, and nothing was looking. Decided is not the same as no longer claiming anything, so the premise now says which kind it is instead of the artifact's state guessing for it.

Closes #302

## Roadmap context

[obot.roadmap#266](https://github.com/jwildfire/obot.roadmap/issues/266) — a decision artifact notices when its own premise expires, rank 9. The mechanism shipped on 2026-08-20 in [#263](https://github.com/jwildfire/obot.agent/pull/263); this is the hole in it, recorded as call n0245 by 👯🤖 W0074 [on the requirement](https://github.com/jwildfire/obot.roadmap/issues/266#issuecomment-5328309079) while recording D0020 rather than while looking for it.

## What changed

One attribute, on the declaration the authoring contract already asks for:

```html
<meta name="premise" scope="live" content="goal #73 still carries its old title … | gh issue view 73 … → prints …">
<meta name="premise" scope="history" content="v1.1.0 is published, not a draft | gh release view … → prints false">
```

- `scope="live"` — a claim about the present. Re-checked whatever state the artifact is in.
- `scope="history"` — what was true when the decision was made. Measured at publish time and never again.
- Nothing declared — the artifact's state supplies the *default*: re-checked while the page is still awaiting him, **undeclared** once it settles.

Undeclared is a third state and is not history. It is not re-checked — putting eighteen settled artifacts back on a five-minute cadence is the regression this must not cause, and the section is only worth reading because it stays quiet — and it is named, with ids, so "not re-checked" can never pass for "checked and fine". A `scope` that is neither word is refused and reported under the existing `CLAIM CHECK BROKEN` headline rather than defaulted, because a checker deciding for itself which kind an author meant is precisely what the attribute replaces.

## Evidence

Both cases, from the real hub clone rather than from the suite.

**A live premise on a decided artifact, re-checked** — `tools/navigator/currency.mjs` against the real pages. `D0020.p1` is on a decided artifact and rides the cadence; `D0021.p1` is history on the same kind of page and does not:

```
premises: 22 re-checked across 5 artifacts · 19 hold · 0 expired · 3 unchecked · newest reading just now · 19 decided or closed artifacts not re-checked
  holding: D0020.p1, D0021.p2, D0021.p3, D0021.p4, D0021.p5, D0022.p1, …
  live on settled: 5 premises on 2 decided or closed artifacts declare themselves claims about today and are re-checked above. Decided is not the same as no longer claiming anything.
  history: 1 premise says it is about what was true when the decision was made — measured at publish time and deliberately not again. Not unchecked.
  no scope declared: 5 premises on decided or closed artifacts declare neither live nor history, so nothing knows whether they are still claiming something about today. Not re-checked, and not the same as history: D0023.p1, D0023.p2, D0023.p3, D0023.p4, D0023.p5.
  1 artifact still awaiting him declares no premise at all, so nothing here is watching its framing.
```

**The same premise once the world moves** — rehearsed on a copy of the decisions tree in which the rename has been applied. The sentence and the expectation are the published ones; only the world differs:

```
**PREMISE BROKEN** — D0020 states a premise that no longer holds (checked just now): "goal #73 still carries its old title, so the rewritten body and the new name are approved proposals nobody has applied yet". The evidence on that page may be sound and its framing is not.
  reports/decisions/2026-08-17-goal-73-up-to-date/ · proof: `gh issue view … --json title --jq .title` → prints Goal: increased autonomy in obot.agent
  also stated on the artifact README (…/README.md) — last changed 2026-08-18 08:36, before the premise broke — still to bring along
  also stated on the published index row (reports/decisions/README.md) — last changed 2026-08-20 20:46, before the premise broke — still to bring along
  also stated on the decision registry (reports/decisions/registry.json) — last changed 2026-08-20 20:43, before the premise broke — still to bring along
  also stated on the Q&A discussion title — on GitHub, not in the clone — nothing here has read it
premises: 5 re-checked across 2 artifacts · 4 hold · 1 expired · 0 unchecked · newest reading just now · 19 decided or closed artifacts not re-checked
```

The identical rehearsal on `main` renders this, in the same world, while the page tells a reader something false:

```
premises: 0 declared across 2 artifacts still awaiting him · 0 hold · 0 expired · 0 unchecked · 21 decided or closed artifacts not re-checked
  No artifact declares a premise yet. That is a gap in the artifacts, not a clean result: nothing here has checked anything.
```

## Two things underneath it

**The publish-time gate did not work for the artifacts this adds.** `checkArtifact()` read its premises through the cadence's filter, so on a decided page it reported "declares no premise" for a page declaring five — a clean bill of health from the gate built to stop exactly that. It now answers over every premise a page declares, whatever the scope and whatever the state. Measured on `main` and on this branch, same command, same slug:

```
main    no artifact at reports/decisions/2026-08-17-safetycensus-stay-or-go/ declares a premise
branch  holds   D0021.p1  history   v1.1.0 is published with the function in it, …
        holds   D0021.p2  live      SafetyCensus() is still exported, …
        holds   D0021.p3  live      no later gsm.safety release has shipped without the function, …
        holds   D0021.p4  live      the refactor he asked for is filed and not yet designed, …
        holds   D0021.p5  live      the commissioning requirement #229 is still open, …
```

That matters beyond tidiness. A premise can be false the moment it is written — one was, on D0021's first draft — and publish time is the only path a born-wrong premise has to green. A live premise added to an already-decided page had no gate at all.

**A live premise that cannot break is not a premise.** `judge()` honoured `prints X` for a single token; a multi-word expectation fell through to the exit code, which for a `gh … --jq` read is 0 whatever it printed. D0020's premise expects `prints Goal: increased autonomy in obot.agent` and would have reported `holds` after the rename it exists to notice. `prints` now compares the whole expectation. Two expectations in the corpus are multi-word; the other is `tmutil`, which the allowlist does not run, so it stays `unknown` either way.

## Also in this branch

Nothing. The hub side — `scope` on D0020's and D0021's premises and the authoring contract in `reports/decisions/README.md` — is on the hub's `main` as `d8ca79d`, under the standing grant for that repo.

## Next

- The five undeclared premises on D0023 are now named on the surface every five minutes until someone reads them and says which kind they are. That is the intended shape, not a defect.
- `1 artifact still awaiting him declares no premise at all` is D0019, which is partially decided and has nothing watching its framing.

---

Drafted by 👯🤖 W0102 using Opus 5. NOT reviewed by @jwildfire.
