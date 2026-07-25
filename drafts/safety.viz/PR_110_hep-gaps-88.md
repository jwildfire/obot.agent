<!-- STATUS: Posted to https://github.com/jwildfire/safety.viz/pull/110 on 2026-07-24 23:36 EDT -->
<!-- GITHUB_PROPERTIES: Assignee: @me, Reviewers: @jwildfire -->

## Summary

Closes the first rungs of the hepExplorer follow-up requirement ([obot.roadmap#88](https://github.com/jwildfire/obot.roadmap/issues/88)): the shipped hep-waterfall prototype's flanking box panels get the legend and hover a user asked for, and the eDISH scatter regains two interaction features deferred from the v1.3 coordinated-core port.

Closes #45
Closes #47
Refs jwildfire/obot.roadmap#88, jwildfire/obot.roadmap#83

Three commits, one per issue, all against `dev`.

## Reviewer notes

**UAT — what to click.** On the hosted preview for this PR:

- **hep-waterfall demo** — hover either flanking box panel: a tooltip names the arm, says whether the box is baseline or the maximum on-treatment value, and puts a number on every mark. Tab to a panel and use ← / → to step between its boxes, Esc to close. The panels now label their slots (`Baseline` / `Max on-tx`) and title themselves with each arm's n, and the legend carries a drawn box-plot key.
- **hep-explorer demo (eDISH scatter)** — put the pointer on either dashed cut-line: the cursor becomes a resize cursor. Drag it. The quadrant percentages, corner labels and summary table move *during* the drag, and the value lands in the matching Reference Line box. Select a participant first and drag: the selection survives. The new **Marginal Distributions** control drives the box plots above and to the right of the plot and the rugs along the bottom and left edges.

**Code-review anchors.**

- `src/hep-waterfall/getPlugins.js` — the new `boxHitTest` / `boxTooltip` / `boxPanelDescription` / `boxHoverPlugin` block. The hover backdrop draws in `beforeDatasetsDraw` deliberately: `src/box-whisker.js` carries a "the drawing body must not change" contract because results-over-time's evidence baselines are pinned to its pixels, so the hover must never repaint them.
- `src/hep-explorer/cutDrag.js` — pure drag geometry. The one judgement call is at the crossing of the two cut-lines: the nearer line wins, so one gesture moves one line.
- `src/hep-explorer/views/scatter.js` — `bindCutDrag` binds **once** to the shell canvas (which outlives every redraw) in the **capture** phase, so a drag that starts on a line is claimed before Chart.js's handlers see it and everything else falls straight through. The drag does not re-render; see the tech briefing.
- `src/hep-explorer/marginals.js` — the marginals reserve their strip through the chart's layout padding, so they are outside the plot area and cannot be read as data.

**Security.** No new dependencies, no network calls, no `innerHTML` with data-derived content (the tooltip uses `textContent`). One new event surface: pointer and keyboard listeners on the two flank canvases and the scatter canvas.

**One thing to decide.** The marginals default to **on** (`marginals: 'box_rug'`). That is parity with the original renderer and the reason #47 was filed, but it changes what every existing hep-explorer embed draws by default. Say the word and I will flip the default to `none` and leave the control as the way in.

## Roadmap context

[obot.roadmap#88](https://github.com/jwildfire/obot.roadmap/issues/88) carries the eight enhancement sub-issues that stayed open when the hep-explorer migration ([#30](https://github.com/jwildfire/obot.roadmap/issues/30)) shipped, under the charts goal ([#78](https://github.com/jwildfire/obot.roadmap/issues/78)). This PR takes the top of that list plus [#83](https://github.com/jwildfire/obot.roadmap/issues/83), the user feedback filed against the hep-waterfall prototype released in v1.5.

Still open on #88 after this: [#46](https://github.com/jwildfire/safety.viz/issues/46) (study-day animation), [#48](https://github.com/jwildfire/safety.viz/issues/48) (summary-table sparklines), [#49](https://github.com/jwildfire/safety.viz/issues/49) (exposure track — blocked on `adex` demo data), [#50](https://github.com/jwildfire/safety.viz/issues/50), [#54](https://github.com/jwildfire/safety.viz/issues/54), [#55](https://github.com/jwildfire/safety.viz/issues/55).

## Evidence

Requirement-keyed evidence, refreshed on the canonical Linux runner by this PR's CI:

- <a href="https://jwildfire.github.io/safety.viz/evidence/hep-waterfall/">hep-waterfall evidence page</a> — new captures `HWF-BOX-005-summary-box-hover` and `HWF-BOX-006-panel-labels-and-anatomy-key`
- <a href="https://jwildfire.github.io/safety.viz/evidence/hep-explorer/">hep-explorer evidence page</a> — new captures `HEP-QUAD-006-cut-line-drag` (taken mid-drag, before the button is released) and `HEP-MARG-001-marginal-box-plots-and-rugs`
- <a href="https://jwildfire.github.io/safety.viz/demos/hep-waterfall/">hep-waterfall demo</a> · <a href="https://jwildfire.github.io/safety.viz/demos/hep-explorer/">hep-explorer demo</a>
- Coverage maps: `docs/hep-waterfall-coverage.md`, `docs/hep-explorer-coverage.md`

Seven new requirement IDs — `HWF-BOX-005/006/007`, `HEP-QUAD-006`, `HEP-MARG-001/002/003` — land in the matrix repo as **[jwildfire/obot.agent#47](https://github.com/jwildfire/obot.agent/pull/47)**.

**Merge order: this PR → obot.agent#47 → regenerate the extracts** (`npm run requirements` in safety.viz). Until obot.agent#47 merges, the evidence pages show those seven IDs without their requirement text.

## Technical briefing

**hep-waterfall: the panels now say what they are ([obot.roadmap#83](https://github.com/jwildfire/obot.roadmap/issues/83)).** The flanking box-and-whisker panels shipped in v1.5 with no legend and no hover, so a reader could see a box without knowing whether its edges were quartiles or whiskers, which box was baseline and which the peak, or what any of it measured. `HWF-BOX-005` adds the hover — the same idiom as the migration Sankey's ribbons, an absolutely-positioned HTML tooltip rather than a native one, because a native tooltip cannot appear in a screenshot and so cannot be evidenced — plus arrow-key stepping for readers without a pointer. `HWF-BOX-006` adds the slot labels, the panel titles and the drawn anatomy key. `HWF-BOX-007` gives each canvas an accessible description of its own boxes as numbers.

One incidental fix travels with it: the panel titles had been configured since the first cut but never drew, because the module never registered Chart.js's `Title` plugin. Registering it is what makes "Placebo (n=3)" appear above the left panel.

**hep-explorer: dragging a cut-line does not re-render ([#45](https://github.com/jwildfire/safety.viz/issues/45)).** A `render()` rebuilds the scales and clears the selection — neither of which is what moving a line means, and both of which would make the gesture feel like it fought back. Instead the drag updates the cut, the number input, the classification, the corner labels and the summary table in place, and clamps the value inside the axis so the line can never be dragged off the plot and lost. Clamping is what removes the need for a re-render at all. The click that ends a drag is suppressed, so a selection made before the drag survives it.

**hep-explorer: the marginals summarize what is shown ([#47](https://github.com/jwildfire/safety.viz/issues/47)).** Statistics are computed over the points the filters left, not the whole cohort, on the shared R-7 `boxStats` — so the marginals, the waterfall's flanking panels and results-over-time cannot disagree about what a quartile is. Boxes cost a reserved strip (via layout padding, outside the plot area); rugs are drawn inside the plot and cost nothing, so switching to rugs alone hands the strip back to the scatter.

**Evidence capture grew one capability.** `captureEvidence` now accepts a Playwright `Locator` as well as a `Page`. The hep-waterfall slot labels sit at the foot of the flank canvases, below the fold of the default viewport, and a screenshot that crops the label is not evidence that the label exists. Existing call sites are untouched.

**Tests.** 959 unit tests (four new files or blocks: `hep-waterfall/getPlugins`, `hep-waterfall/render`, `hep-explorer/cutDrag`, `hep-explorer/marginals`) and four new browser tests. Every visual change regenerates the canonical evidence baselines on Linux.

## Next steps

1. Merge this PR, then [obot.agent#47](https://github.com/jwildfire/obot.agent/pull/47), then regenerate the requirement extracts on `dev`.
2. Decide the marginals default (see Reviewer notes).
3. Remaining #88 rungs — #50, #54, #55, #46, #48 — in a following session; #49 stays blocked until the demo bundle carries an exposure domain.

---

*This PR was drafted by Claude Code (Opus 5) as 👯🤖 2026-07-24 hep-gaps and reviewed by @jwildfire*
