<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/47 on 2026-07-24 23:30 EDT -->
<!-- GITHUB_PROPERTIES: Labels: documentation, Assignee: @me -->

## Summary

Adds the requirement-matrix rows for the hep-explorer and hep-waterfall gaps closed in [jwildfire/safety.viz#110](https://github.com/jwildfire/safety.viz/pull/110) — nineteen new rows across two matrices, so `npm run requirements` publishes real requirement text on the evidence pages rather than degrading those IDs to IDs-only.

**hep-waterfall** (`docs/requirements/hep-waterfall.md`, 54 → 57 rows) — from user feedback on the shipped v1.5 prototype, [obot.roadmap#83](https://github.com/jwildfire/obot.roadmap/issues/83):

- `HWF-BOX-005` — hover/keyboard readout of every statistic the flanking box panels draw
- `HWF-BOX-006` — slot labels, panel titles with each arm's n, and a drawn anatomy key in the legend
- `HWF-BOX-007` — the accessible description of each panel's boxes

**hep-explorer** (`docs/requirements/hep-explorer.md`, 111 → 127 rows) — parity items deferred from the v1.3 coordinated-core port, plus polish and data-handling items carried from the upstream backlog:

- `HEP-QUAD-006` — draggable Hy's-Law cut-lines, reclassifying live and syncing with the Reference Line inputs ([sv#45](https://github.com/jwildfire/safety.viz/issues/45))
- `HEP-MARG-001/002/003` — marginal box plots, axis rugs, and the control that governs them ([sv#47](https://github.com/jwildfire/safety.viz/issues/47))
- `HEP-QUAD-007/008`, `HEP-CTRL-013/014`, `HEP-CAUTION-001` — the quadrant-label toggle, each quadrant's clinical reading, legend counts, the point-size note, and the standing not-for-clinical-use caution ([sv#54](https://github.com/jwildfire/safety.viz/issues/54))
- `HEP-DROP-001/002/003`, `HEP-IMPUTE-001/002/003` — drop reasons, the CSV exports, and below-LLOQ imputation ported from the original renderer's source ([sv#50](https://github.com/jwildfire/safety.viz/issues/50))
- `HEP-DISPLAY-006`, `HEP-CTRL-015/016` — display-mode availability, legend ordering by a numeric companion column, and a palette that shades rather than repeats ([sv#55](https://github.com/jwildfire/safety.viz/issues/55))

## Merge order

**safety.viz PR → this PR → regenerate the extracts.** The safety.viz PR ships the implementation and its evidence; this PR ships the matrix text; the next `npm run requirements` run in safety.viz picks the new rows up. Until this merges, the evidence pages show those seven IDs without their requirement text — the same bootstrap the module matrices have taken before.

## Review notes

Eighteen of the nineteen rows are marked `ai-reviewed`: they describe interaction, labelling and data handling that the safety.viz PR's evidence demonstrates directly, and the ported rules cite the exact upstream file they came from.

**One row needs your eye: `HEP-QUAD-008`**, marked `needs-jeremy-review`. Its four quadrant "meaning" sentences are clinical prose drafted by the agent, not lifted from a cited source. The requirement — that each quadrant carries its clinical reading — is not in doubt; the wording, especially the Hy's-Law and Temple's-Corollary readings, should be confirmed before the Clinical guide cites it.

Two rows also record deliberate divergences from the original renderer, so a later reader does not read them as porting mistakes: `HEP-DROP-001` (this port keeps its own, narrower row-drop policy rather than adopting the original's study-day drop, because changing it would silently change every published count) and `HEP-IMPUTE-003` (the original's `drop` branch is dead code upstream — it throws if reached — so the intent is implemented rather than the fault).

The `Test/Evidence Link` column points at [safety.viz#88](https://github.com/jwildfire/safety.viz/issues/88) throughout.

---

*This PR was drafted by Claude Code (Opus 5) as 👯🤖 2026-07-24 hep-gaps and reviewed by @jwildfire*
