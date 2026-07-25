<!-- STATUS: Posted to https://github.com/jwildfire/safety.viz/pull/110 on 2026-07-24 23:36 EDT; body updated 2026-07-24 23:40 EDT -->
<!-- GITHUB_PROPERTIES: Assignee: @me, Reviewers: @jwildfire -->

## Summary

Six commits against the hepExplorer follow-up requirement ([obot.roadmap#88](https://github.com/jwildfire/obot.roadmap/issues/88)): the shipped hep-waterfall prototype's flanking box panels get the legend and hover a user asked for, and the eDISH scatter regains four sets of features deferred from the v1.3 coordinated-core port — direct manipulation of the cut-lines, marginal distributions, the labels and legends that say what the chart means, and traceable data handling.

Closes #45
Closes #47
Closes #50
Refs jwildfire/obot.roadmap#88, jwildfire/obot.roadmap#83, #54, #55

**#54 and #55 are partial** — 5 of 9 and 3 of 6 items respectively, itemized under Next steps — so they stay open rather than closing here.

## Reviewer notes

**UAT — what to click.** Preview: **https://jwildfire.github.io/safety.viz/pr/110/**

[hep-explorer demo](https://jwildfire.github.io/safety.viz/pr/110/hep-explorer/index.html) (eDISH scatter):

- Put the pointer on either dashed cut-line: the cursor becomes a resize cursor. **Drag it.** The quadrant percentages, corner labels and summary table move *during* the drag, and the value lands in the matching Reference Line box. Select a participant first, then drag: the selection survives.
- The **Marginal Distributions** control drives the box plots above and to the right of the plot and the rugs along the bottom and left edges. Apply an R-Ratio filter — the boxes follow what is shown, not the whole cohort.
- The **Quadrant Labels** control turns the corner labels off; the classification and the summary table stay. The summary table now states what each quadrant means. Set **Group** to Treatment Group: the legend carries each arm's n and percent. Set **Point Size** to rRatio: the legend explains what size encodes.
- The removed-records note carries a **CSV download** naming, per row, which mapped column failed. The notes also report the one below-limit result that was imputed.
- The standing "not validated for clinical use" caution sits below the chart, in every view.

[hep-waterfall demo](https://jwildfire.github.io/safety.viz/pr/110/hep-waterfall/index.html):

- Hover either flanking box panel: a tooltip names the arm, says whether the box is baseline or the maximum on-treatment value, and puts a number on every mark. Tab to a panel and use ← / → to step between boxes, Esc to close. The panels now label their slots (`Baseline` / `Max on-tx`), title themselves with each arm's n, and the legend carries a drawn box-plot key.

**Code-review anchors.**

- `src/hep-waterfall/getPlugins.js` — `boxHitTest` / `boxTooltip` / `boxPanelDescription` / `boxHoverPlugin`. The hover backdrop draws in `beforeDatasetsDraw` deliberately: `src/box-whisker.js` carries a "the drawing body must not change" contract because results-over-time's evidence baselines are pinned to its pixels, so the hover must never repaint them.
- `src/hep-explorer/cutDrag.js` — pure drag geometry. The judgement call is at the crossing of the two cut-lines: the nearer line wins, so one gesture moves one line.
- `src/hep-explorer/views/scatter.js` — `bindCutDrag` binds **once** to the shell canvas (which outlives every redraw) in the **capture** phase, so a drag that starts on a line is claimed before Chart.js's handlers see it and anything else falls through. The drag does not re-render; see the tech briefing.
- `src/hep-explorer/imputation.js` — the below-LLOQ rules, ported from the original renderer's source, which is checked out beside this workspace. The header records exactly which upstream file each rule came from, including one that is dead code upstream.
- `src/hep-explorer/marginals.js` — the marginals reserve their strip through the chart's layout padding, so they sit outside the plot area and cannot be read as data.

**Security.** No new dependencies and no network calls. The CSV downloads are `data:` URIs built from the loaded data, with every field quoted and embedded quotes doubled; nothing is injected as HTML — the notes are now built with `createElement` / `textContent` throughout, replacing the one pre-existing `innerHTML` assignment on that path. New event surface: pointer and keyboard listeners on the two flank canvases and the scatter canvas.

**Two things to decide.**

1. **Marginals default to on** (`marginals: 'box_rug'`). That is parity with the original renderer and the reason #47 was filed, but it changes what every existing hep-explorer embed draws by default. Say the word and I will flip the default to `none`, leaving the control as the way in.
2. **The four quadrant meanings are clinical prose drafted by the agent**, not lifted from a cited source. The companion matrix row (`HEP-QUAD-008`) is marked `needs-jeremy-review` for exactly that. The requirement — that each quadrant carries its reading — is not in doubt; the wording should be confirmed before the Clinical guide cites it.

## Roadmap context

[obot.roadmap#88](https://github.com/jwildfire/obot.roadmap/issues/88) carries the eight enhancement sub-issues that stayed open when the hep-explorer migration ([#30](https://github.com/jwildfire/obot.roadmap/issues/30)) shipped, under the charts goal ([#78](https://github.com/jwildfire/obot.roadmap/issues/78)). This PR takes five of them plus [#83](https://github.com/jwildfire/obot.roadmap/issues/83), the user feedback filed against the hep-waterfall prototype released in v1.5. The requirement moved to Development on the board.

## Evidence

Requirement-keyed evidence, regenerated on the canonical Linux runner (`Update evidence baselines`, run [30142116462](https://github.com/jwildfire/safety.viz/actions/runs/30142116462)) and deployed to the PR preview:

- <a href="https://jwildfire.github.io/safety.viz/pr/110/hep-explorer/evidence.html">hep-explorer evidence page</a> — new captures `HEP-QUAD-006-cut-line-drag` (taken mid-drag, before the button is released), `HEP-MARG-001-marginal-box-plots-and-rugs`, `HEP-QUAD-008-quadrant-meanings-and-legend-counts`, `HEP-DROP-003-dropped-record-downloads`, `HEP-CTRL-015-legend-order-and-palette`
- <a href="https://jwildfire.github.io/safety.viz/pr/110/hep-waterfall/evidence.html">hep-waterfall evidence page</a> — new captures `HWF-BOX-005-summary-box-hover`, `HWF-BOX-006-panel-labels-and-anatomy-key`
- <a href="https://jwildfire.github.io/safety.viz/pr/110/hep-explorer/api.html">hep-explorer API reference</a> · <a href="https://jwildfire.github.io/safety.viz/pr/110/hep-waterfall/api.html">hep-waterfall API reference</a>
- Coverage maps: `docs/hep-explorer-coverage.md`, `docs/hep-waterfall-coverage.md`

**981 unit tests and 219 browser tests pass**; `format:check` and the dist-drift gate are clean.

Nineteen new requirement IDs — `HWF-BOX-005/006/007`, `HEP-QUAD-006/007/008`, `HEP-MARG-001/002/003`, `HEP-CTRL-013/014/015/016`, `HEP-CAUTION-001`, `HEP-DROP-001/002/003`, `HEP-IMPUTE-001/002/003` — land in the matrix repo as **[jwildfire/obot.agent#47](https://github.com/jwildfire/obot.agent/pull/47)**.

**Merge order: this PR → obot.agent#47 → regenerate the extracts** (`npm run requirements` on `dev`). Until obot.agent#47 merges, the evidence pages show those IDs without their requirement text.

## Technical briefing

**hep-waterfall: the panels now say what they are ([obot.roadmap#83](https://github.com/jwildfire/obot.roadmap/issues/83)).** The flanking box-and-whisker panels shipped in v1.5 with no legend and no hover, so a reader could see a box without knowing whether its edges were quartiles or whiskers, which box was baseline and which the peak, or what any of it measured. `HWF-BOX-005` adds the hover — the same idiom as the migration Sankey's ribbons, an absolutely-positioned HTML tooltip rather than a native one, because a native tooltip cannot appear in a screenshot and so cannot be evidenced — plus arrow-key stepping for readers without a pointer. `HWF-BOX-006` adds the slot labels, the panel titles and the drawn anatomy key. `HWF-BOX-007` gives each canvas an accessible description of its own boxes as numbers. One incidental fix travels with it: the panel titles had been configured since the first cut but never drew, because the module never registered Chart.js's `Title` plugin.

**Dragging a cut-line does not re-render ([#45](https://github.com/jwildfire/safety.viz/issues/45)).** A `render()` rebuilds the scales and clears the selection — neither of which is what moving a line means, and both of which would make the gesture feel like it fought back. Instead the drag updates the cut, the number input, the classification, the corner labels and the summary table in place, and clamps the value inside the axis so a line can never be dragged off the plot and lost. Clamping is what removes the need for a re-render at all. The click that ends a drag is suppressed, so a selection made before the drag survives it.

**The marginals summarize what is shown ([#47](https://github.com/jwildfire/safety.viz/issues/47)).** Statistics come from the shared R-7 `boxStats` over the points the filters left — so the marginals, the waterfall's flanking panels and results-over-time cannot disagree about what a quartile is. Boxes cost a reserved strip via layout padding, outside the plot area; rugs are drawn inside the plot and cost nothing, so switching to rugs alone hands the strip back to the scatter.

**Below-LLOQ imputation was ported, not invented ([#50](https://github.com/jwildfire/safety.viz/issues/50)).** RhoInc/hep-explorer is checked out beside this workspace, so the rules were read off `onInit/cleanData/imputeData.js` and `imputeData/imputeColumn.js` rather than inferred: `data-driven` takes the limit to be the smallest positive value recorded for that measure and imputes to half of it, `user-defined` takes the limit from configuration, `drop` removes non-positive records instead, and the window is `0 <= value < limit` so negatives are left alone. Read against a data-driven limit, that window contains exactly recorded zeros — which is the point: a zero has no place on a ×ULN axis and cannot be drawn on a log one at all, and dropping it loses a participant. **The original's `drop` branch is dead code upstream** — its filter references an undefined `d` and assigns an implicit global, so it throws if reached; the intent is unambiguous from the surrounding code and that intent is implemented here rather than the fault. The matrix row says so.

**Drop reasons make the counts checkable ([#50](https://github.com/jwildfire/safety.viz/issues/50)).** Every removed record now carries a reason naming the mapped column that failed, every unplottable participant a reason naming which measure was missing, and each on-page count carries a CSV of exactly those records. What gets dropped is unchanged — only the reason is newly recorded. The original additionally drops rows whose study-day column is non-numeric; this port keeps its own narrower policy and does not adopt that, because changing it would silently change every published count.

**The chart now offers only what the data supports ([#55](https://github.com/jwildfire/safety.viz/issues/55)).** mDISH is withdrawn when no participant has a derivable baseline, eDISH when no record carries a usable upper limit of normal, and the reason is stated rather than left to be noticed as a missing menu item; a dataset supporting neither renders the reason instead of an empty plot the reader would have to diagnose. Alongside it, `group_order_col` orders the legend by a numeric companion column (TRTN beside TRT), and the palette shades rather than repeats past its eight base colours.

**Evidence capture grew one capability.** `captureEvidence` now accepts a Playwright `Locator` as well as a `Page`. The hep-waterfall slot labels sit at the foot of the flank canvases and the quadrant meanings below the plot — both below the fold of a default viewport — and a screenshot that crops the thing it is evidence of is not evidence. Existing call sites are untouched.

## Next steps

1. Merge this PR, then [obot.agent#47](https://github.com/jwildfire/obot.agent/pull/47), then regenerate the requirement extracts on `dev`.
2. Settle the two decisions in Reviewer notes.
3. **Left open on #54** (4 of 9): full measure names in the drill-down lab chart (upstream #290), the R/nR reference link (#335), the log axis base option (#112), manual axis min/max inputs (#238).
4. **Left open on #55** (3 of 6): unscheduled-visit handling (#229), static / user-defined ULNs (#140), interactive axis zoom and pan (#209, low priority).
5. **Untouched on #88**: [#46](https://github.com/jwildfire/safety.viz/issues/46) (study-day animation), [#48](https://github.com/jwildfire/safety.viz/issues/48) (summary-table sparklines), [#49](https://github.com/jwildfire/safety.viz/issues/49) (exposure track — blocked until the demo bundle carries an `adex` domain).

---

*This PR was drafted by Claude Code (Opus 5) as 👯🤖 2026-07-24 hep-gaps and reviewed by @jwildfire*
