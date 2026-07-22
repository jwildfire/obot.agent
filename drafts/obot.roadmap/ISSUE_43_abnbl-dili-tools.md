<!-- STATUS: Posted to https://github.com/jwildfire/obot.roadmap/issues/43 on 2026-07-22 16:24 EDT -->
<!-- GITHUB_PROPERTIES: Labels: requirement, safety, Milestone: 2026q3, Assignee: @me, Project: obot Roadmap (Design) -->

## Business Requirement

eDISH — the peak-ALT vs peak-bilirubin scatter with Hy's-Law quadrants that safety.viz already ships as `hep-explorer` — silently stops working when a trial enrolls patients who are already sick. Its whole design assumes participants start with normal liver tests, so that a value of 3×ULN means injury happened *on study*. In a NASH, hepatitis, cirrhosis, or oncology trial, half the population may sit in the Hy's-Law quadrant on day one, having nothing to do with the drug. The plot fills with false positives, the real drug-induced injuries are indistinguishable from baseline disease, and the reviewer is left with no usable population-level view.

This is not a hypothetical gap. FDA's Division of Hepatology and Nutrition published the problem and its proposed remedies in *Drug Safety* in 2025 (Amirzadegan et al., [PMID 39932652](https://pubmed.ncbi.nlm.nih.gov/39932652/), [PMC11982145](https://pmc.ncbi.nlm.nih.gov/articles/PMC11982145/)), and the paper is explicit that reviewers currently lack tools for these trials. Trials in populations with pre-existing liver disease are a large and growing share of development programs, and they are exactly the trials where hepatotoxicity assessment matters most.

Success means a safety scientist running an abnormal-baseline trial can answer the three questions eDISH answers for a normal-baseline trial — *is the drug arm shifting worse than placebo?*, *how severe are the shifts?*, and *which individual participants do I need to read?* — using safety.viz, without misreading baseline disease as drug injury.

## Overview

Implement the two visualizations from Amirzadegan et al. 2025 that safety.viz does not yet cover. The paper proposes four tools; we already ship two of them.

| Paper figure | Tool | Status in safety.viz |
|---|---|---|
| Figure 1 | eDISH scatter (×ULN) | Shipped — `hep-explorer` scatter view |
| Figure 2 | mDISH (×baseline) | Shipped — `display: 'relative_baseline'`. Note the paper presents this as a *negative* result: ×baseline alone destroys severity ranking |
| **Figure 3** | **Bidirectional Sankey of baseline → on-treatment quadrant shifts, with per-arm cross tables** | **To build** |
| Figure 4 | Composite ×baseline plot, marked by baseline quadrant of origin | Shipped — `hep-explorer` composite view (safety.viz#67, Tesfaldet 2024) |
| **Figure 5** | **Modified waterfall — per-participant baseline vs peak on-treatment ALT in absolute U/L** | **To build** |

**Figure 3 becomes a third view of `hep-explorer`** (`view: 'migration'`), not a separate renderer. The paper is explicit that Sankey and composite are a deliberate *two-step* replacement for the single eDISH plot: the Sankey answers "which arm is shifting worse and how severely" (eDISH functions a and b) but cannot identify individuals (function c), which the composite plot supplies. Keeping them in one module lets a reviewer click a pink ribbon and jump straight into the composite plot with exactly those participants carried over and highlighted. That hand-off is the paper's argument made executable, and it is not purchasable across a module boundary.

**Figure 5 becomes a new sibling module, `hep-waterfall`.** It is not another view of the same data: the paper's own Table 1 assigns it to a *different population* (elevated baseline ALT but **normal** baseline bilirubin) and it explicitly excludes the baseline-jaundiced participants the migration and composite views require. It also plots absolute U/L rather than a ×ULN ratio. Different population, different units, different question — a separate renderer with its own gallery card, guide, and evidence page.

Both figures are fed by a new shared `src/hep-core/` layer holding one per-participant hepatic reduction — one cohort definition, one baseline definition, one on-treatment definition — used by Figures 3, 4 and 5 alike.

**Affected repos:** `safety.viz` (implementation), `obot.agent` (requirement matrices), `gsm.safety` (future `Widget_HepWaterfall.R` binding, out of scope here).

## Data Requirement

**Required domains / tables:** a long-format lab domain — one record per participant per test per visit. Same contract as the shipped `hep-explorer`, plus a treatment-arm column.

**Required columns:**

- `id_col` (default `USUBJID`) — participant identifier
- `measure_col` (default `TEST`) — test name, mapped to ALT / AST / TB / ALP via `measure_values`
- `value_col` (default `STRESN`) — numeric result
- `normal_col_high` (default `STNRHI`) — upper limit of normal, the ×ULN divisor
- **`arm_col` (new, default `ARM`)** — treatment arm. Required by both new figures; auto-detected across `ARM` / `TRT01A` / `TRTA` / `ACTARM` when unset. This is the one genuinely new required column: the Sankey's left/right mirror and the waterfall's colour encoding are both arm-driven, and without it neither figure has meaning.
- `unit_col` (default `STRESU`) — currently unused by `hep-explorer`; **the waterfall is its first consumer**, since an absolute axis must be labelled in real units
- **`baseline_col` / `baseline_value` (new, optional)** — explicit baseline flag, e.g. ADaM `ABLFL` = `'Y'`. Without it, baseline falls back to the day-0 record, else the earliest by day-then-input-order

**Data source / system:** ADaM `ADLB` / `BDS` or equivalent. The demo runs on `pharmaverseadam` (CDISC Pilot 01) as the rest of the library does.

**Availability status:** Confirmed for the migration view — the synthetic chronic-liver-disease cohort already inside `site/data/adbds.csv` (the `CLD-` participants added for the composite view) produces a genuinely interesting shift matrix: in the drug arm 10 upward and 13 downward shifts against placebo's 12 upward and 6 downward, which is exactly the paper's Study-2 narrative shape.

**Confirmed *not* available for the waterfall.** Verified against `adbds.csv`: after applying the paper's mandated baseline-bilirubin exclusion, **zero** participants have baseline ALT ≥ 3×ULN, and the entire file contains **two** new-onset-jaundice participants — one per arm, which actively contradicts the paper's "several developed jaundice" on active drug. Figure 5's signature green bars are unrepresentable on the current demo data. A purpose-built synthetic ABN-BL cohort (`site/data/adbds-abnbl.csv`, prefix `ABL-`) is therefore required, following the precedent already set by `scripts/build-hep-composite-cohort.mjs`. This is recorded as an open judgement call, not hidden — see Design §K.

## Design

Full design document: **[`requirements/design/43_design.html`](https://jwildfire.github.io/obot.roadmap/requirements/design/43_design.html)**

Summary of the decisions the design settles:

- **Topology** — Figure 3 as `hep-explorer`'s third view; Figure 5 as the new `hep-waterfall` module; a shared non-renderer `src/hep-core/` for the common hepatic domain layer.
- **Split `src/hep-explorer.js`** — yes, and first. At 2,159 lines it is already nearly double the next-largest entry file, and its participant-selection layer branches on `state.view` in three places. Adding a third view that needs *more* from that layer (ribbon-to-id-set selection, cross-table-cell selection, and a programmatic hand-off into the composite view) makes the split a prerequisite rather than polish. It becomes internal files under `src/hep-explorer/views/` — **not** separate npm modules, since `SafetyViz.hepExplorer({view})` is a released surface and views are an implementation detail.
- **Sankey rendering: hand-rolled inline SVG**, geometry isolated in a pure `sankeyLayout.js`. Chart.js has no Sankey; `chartjs-chart-sankey` is a left-to-right layered DAG renderer and cannot express a layout mirrored about a pinned centre column, so we would write the layout algorithm anyway and pay a runtime dependency for a fill loop. SVG is already a house idiom (`ae-explorer.js`, `delta-delta/listing.js`), and it brings hover, focus, keyboard access and DOM events for free — which matters in a module whose purpose is regulatory case review.
- **Waterfall rendering: native Chart.js** — floating `[baseline, peak]` bars plus a black baseline line dataset, mirrored left/right absolute-U/L axes, arm colours with a jaundice override, and flanking per-arm box-and-whisker panels drawn by the `boxWhiskerPlugin` promoted out of `results-over-time`.
- **Severity ordering** — Hy's Law at top, Normal & Near-Normal at bottom, with Cholestasis and Temple's Corollary sharing one middle tier. Ribbon colour comes from the existing `CONCERN_MATRIX`, never from the sign of the vertical movement, so the geometry and the clinical semantics cannot contradict each other. This yields a provable correspondence: all five red transitions travel up, all five green travel down, the two yellow are lateral.

## Tasks

Implementation is a stack of three PRs in `safety.viz`, each with one job:

- [ ] **`hep-core-split`** → base `dev`. Extract `src/hep-core/`, split the entry file into `views/{scatter,composite}.js` + `selection.js` + `styles.js`, promote `boxWhiskerPlugin` to `src/box-whisker.js`, add arm plumbing. Includes one deliberate behaviour fix (below), otherwise evidence-neutral.
- [ ] **`hep-migration-view`** → base `hep-core-split`. Figure 3: SVG Sankey, per-arm cross tables, ribbon and cell selection, the two-step hand-off into the composite view, accessibility.
- [ ] **`hep-waterfall`** → base `hep-core-split`. Figure 5: the new module end to end, plus the synthetic `ABL-` cohort generator and the full renderer done-gate (gallery card, demo, guide, evidence page, API reference).

**Correctness defect found during design, fixed in the first PR.** The shipped peak computation excludes the baseline record by study day (`day > 0`) rather than by identity. Verified: **24 of 318** participants in the demo data have no day-0 ALT record and fall back to an unscheduled visit, so their own baseline is counted as an on-treatment value and their peak can never fall below baseline. That silently erases exactly the "bars dropping below baseline" signal Figure 5 is built around. Zero `CLD-` participants are affected, so the composite view's demo story is unchanged, but the composite results do change for those 24 and the PR carries per-participant proof.

Requirement matrices (85 new rows: 47 `HEP-CORE`/`HEP-MIG`/`HEP-XTAB`/`HEP-STEP`/`HEP-ARM`/`HEP-A11Y`, 38 `HWF-*`) are authored in `obot.agent/docs/requirements/` ahead of implementation so the published evidence pages carry real requirement text rather than bare IDs.

---

This Issue was drafted by Claude Code using Claude Fable 5 and reviewed by @jwildfire
