<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/311 on 2026-08-21 15:30 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Assignee: @me, Parent: jwildfire/obot.roadmap#289 -->

The style census has no caller. `grep` across `.github/workflows/`, `tools/navigator/` and `scripts/` finds it named nowhere outside its own tests and its own documentation. It runs when a human types it, and at no other moment.

### Why that is worse than it sounds

[obot.roadmap#289](https://github.com/jwildfire/obot.roadmap/issues/289) says, in its own Done-when: *"A check fails if any surface reintroduces its own copy."* A check nobody invokes cannot fail. So #289 reads as delivered — the census is written, its tests pass, [#309](https://github.com/jwildfire/obot.agent/issues/309) gave it three honest run states this morning — while the property it exists to protect is unguarded.

That is this program's defining defect, and it is the third time this week: an operation that reports success while doing nothing.

It is not hypothetical. `obot.roadmap/scripts/lib/premise-status.mjs` declares six colour tokens under `.pcx` and is registered nowhere. It arrived with the premise-strip work, after the shared sheet landed, and the census names it the moment anybody runs the census. Nobody has.

### The constraint, which is why this is not one line of YAML

The two candidate homes see different things and can do different things.

- **CI** (`.github/workflows/test.yml`) gates a pull request and blocks a merge — and checks out `obot.agent` alone. It cannot see `obot.roadmap`, `safety.viz`, `open.gismo` or `open.csr` at all, so four of the nine declared roots are invisible to it and always will be.
- **The Navigator sweep** (`tools/navigator/sweep.mjs`, launchd, every five minutes) is the only place all nine roots exist on one disk. It gates nothing, and it restarts the dashboard and fast-forwards seven checkouts every pass, so it must not get slow.

Neither one alone satisfies the requirement. CI alone can never see a public site reintroduce a palette. The sweep alone can never stop the pull request that does it.

### The trap this must not fall into

The census has three run states as of [#309](https://github.com/jwildfire/obot.agent/issues/309): `clean`, `drifted`, `unknown`. `unknown` exists because a run that could not look must not say `clean`.

A caller is exactly where that distinction dies. A CI step whose green tick means "no drift among the four roots I could not read" is the same defect one layer up, wearing a check mark. Whatever is wired has to carry `unknown` through to the surface a person actually looks at.

### Done when

- The census runs without anybody typing it, on both a gate and a detector, and each does the job its vantage point allows.
- `unknown` surfaces as `unknown` at every layer — in the CI run page, not only in a log nobody opens, and in `navigator-state.md` and therefore on the Operations Dashboard.
- The sweep's cost is measured and stated rather than assumed, and bounded by something enforced rather than hoped for.
- The wired caller is watched going red on a reintroduced palette and green again when it is removed. Both directions, with the output recorded. A first run that is green because nothing was checked is indistinguishable from success.
- Whatever drift the first honest run finds is reported, not registered away. `safety.viz`, `open.gismo` and `open.csr` are registered exemptions under [#296](https://github.com/jwildfire/obot.agent/issues/296) and stay that way; anything new is a finding and belongs in the open.

---

Drafted by 👯🤖 W0108 using Opus 5. NOT reviewed by @jwildfire.
