<!-- STATUS: Drafted on 2026-07-24 23:26 EDT -->
<!-- GITHUB_PROPERTIES: Labels: documentation, Assignee: @me -->

## Summary

Adds the requirement-matrix rows for the hep-explorer and hep-waterfall gaps closed in [jwildfire/safety.viz#TBD](https://github.com/jwildfire/safety.viz/pulls) — seven new rows across two matrices, so `npm run requirements` publishes real requirement text on the evidence pages rather than degrading those IDs to IDs-only.

**hep-waterfall** (`docs/requirements/hep-waterfall.md`, 54 → 57 rows) — from user feedback on the shipped v1.5 prototype, [obot.roadmap#83](https://github.com/jwildfire/obot.roadmap/issues/83):

- `HWF-BOX-005` — hover/keyboard readout of every statistic the flanking box panels draw
- `HWF-BOX-006` — slot labels, panel titles with each arm's n, and a drawn anatomy key in the legend
- `HWF-BOX-007` — the accessible description of each panel's boxes

**hep-explorer** (`docs/requirements/hep-explorer.md`, 111 → 115 rows) — parity items deferred from the v1.3 coordinated-core port:

- `HEP-QUAD-006` — draggable Hy's-Law cut-lines, reclassifying live and syncing with the Reference Line inputs ([sv#45](https://github.com/jwildfire/safety.viz/issues/45))
- `HEP-MARG-001/002/003` — marginal box plots, axis rugs, and the control that governs them ([sv#47](https://github.com/jwildfire/safety.viz/issues/47))

## Merge order

**safety.viz PR → this PR → regenerate the extracts.** The safety.viz PR ships the implementation and its evidence; this PR ships the matrix text; the next `npm run requirements` run in safety.viz picks the new rows up. Until this merges, the evidence pages show those seven IDs without their requirement text — the same bootstrap the module matrices have taken before.

## Review notes

Every row is AI-drafted and marked `ai-reviewed`, not `needs-jeremy-review`: none of them is a judgement call about clinical meaning — they describe interaction and labelling that the safety.viz PR's browser evidence demonstrates directly. The `Test/Evidence Link` column points at [safety.viz#88](https://github.com/jwildfire/safety.viz/issues/88) for all seven.

---

*This PR was drafted by Claude Code (Opus 5) as 👯🤖 2026-07-24 hep-gaps and reviewed by @jwildfire*
