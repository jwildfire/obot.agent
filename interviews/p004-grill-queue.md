# P004 grill-me queue

This queue is generated from the agentic AI review of harvested requirements. Ask one question at a time in Telegram using the grill-me format.

## Recommended first renderer

Start with **safety-histogram** because it is the first migration target and exposes reusable policy decisions: legacy API compatibility, Webcharts settings compatibility, CAT/viz-library evidence, and statistical method parity.

## Cross-renderer policy questions

### Q-P004-001 — Legacy API compatibility

Status: answered by Jeremy on 2026-05-26 — agreed with recommendation.

Decision: nextgen renderer packages should preserve a thin legacy factory compatibility wrapper where practical, while using a clean nextgen internal API.

Recommendation: preserve a thin compatibility wrapper for vX.0.0 where practical, but design internals around a nextgen API. This limits migration friction while keeping the refactor clean.

### Q-P004-002 — Webcharts config compatibility

Status: answered by Jeremy on 2026-05-26 — agreed with recommendation.

Decision: nextgen renderers should translate a documented subset of legacy Webcharts configuration for core data mapping, filters, controls, and display behavior. Unsupported Webcharts-only settings should be explicitly marked `replaced` or `deferred`.

Recommendation: translate a documented subset for core data mapping/controls and explicitly mark unsupported Webcharts-only settings as replaced/deferred. Full compatibility would preserve too much legacy surface area.

### Q-P004-003 — CAT/viz-library test scope

Status: answered by Jeremy on 2026-05-26 — agreed with recommendation.

Decision: CAT/viz-library-specific regression tests should be rewritten as standalone demo/browser tests unless they describe behavior still needed by gsm.safety/htmlwidgets. CAT/viz-library remains historical evidence/context, not required runtime.

Recommendation: rewrite them as standalone demo/browser tests unless they describe a behavior still needed by gsm.safety/htmlwidgets. CAT itself should be evidence context, not the required runtime.

### Q-P004-004 — Visual acceptance criteria

Status: answered by Jeremy on 2026-05-26 — agreed with recommendation.

Decision: default browser QA should use Chromium at 1440x900. Vertical scrolling is allowed unless a source requirement explicitly requires single-screen/no-scroll behavior.

Recommendation: use a documented desktop viewport for baseline QA, e.g. Chromium 1440x900, and explicitly allow page scrolling unless the source behavior requires single-screen layout.

### Q-P004-005 — Statistical parity

Status: answered by Jeremy on 2026-05-26 — agreed with recommendation.

Decision: nextgen histogram p-values and grouped comparisons should preserve the legacy method only if the exact method and fixture-level expected outputs can be identified. Otherwise, p-value rows should be marked `blocked` while non-statistical renderer work proceeds.

Recommendation: preserve the legacy method only if we can identify it exactly and test fixture outputs; otherwise define a new method with explicit disclaimers and manual review before calling it production-ready.

## safety-histogram

Current status: answered decisions have been applied to the matrix for normal-range splitting, x-axis control splitting, linked-table lead-in removal, external info links, and disclaimer removal. P-value/statistical rows are blocked until exact legacy methods and fixture outputs are identified.

### Q-SH-001 — Normal range behavior split

Status: answered by Jeremy on 2026-05-26 — yes.

Decision: split `SH-FUNC-004` into separate requirements for normal-range band rendering, default hidden checkbox behavior, and missing LLN/ULN control hiding.

Recommendation: yes. These are separately testable behaviors and should map to separate tests.

### Q-SH-002 — X-axis limit controls

Status: answered by Jeremy on 2026-05-26 — agreed with recommendation.

Decision: split `SH-FUNC-005` into lower/upper x-domain inputs, stepper behavior, blur-to-apply behavior, and chart redraw behavior.

Recommendation: yes. This avoids one giant test with ambiguous failure diagnosis.

### Q-SH-003 — Linked-table lead-in

Status: answered by Jeremy on 2026-05-26 — drop `SH-FUNC-009`; update `SH-FUNC-010` through `SH-FUNC-012` with needed context.

Decision: `SH-FUNC-009` is dropped as a non-testable lead-in. `SH-FUNC-010` through `SH-FUNC-012` retain the clicked-bar/detail-table context.

Recommendation: yes. Keep the child behavior rows and drop the lead-in.

### Q-SH-004 — Histogram p-value method

Should nextgen reproduce the legacy normality test exactly? If yes, what test name, precision, and fixture expected values should be used?

Recommendation: require exact method/precision before implementation. If unavailable, mark p-value rows blocked and implement the rest first.

### Q-SH-005 — External info links

Status: answered by Jeremy on 2026-05-26 — agreed with recommendation.

Decision: safety-histogram info icons should use inline/help-panel text inside the chart/demo. Optional external documentation links may live outside the chart UI.

Recommendation: prefer inline help text plus optional docs links. External navigation from renderer UI is brittle and harder to validate.

### Q-SH-006 — Validation disclaimer text

Status: answered by Jeremy on 2026-05-26 — remove the disclaimer.

Decision: the nextgen safety-histogram UI should remove the legacy p-value tooltip disclaimer text: `Caution: This graphic has been thoroughly tested, but is not validated.`

Recommendation was overridden: preserve exact legacy wording until replacement approval. Jeremy approved removal instead.

## safety-outlier-explorer

### Q-SOE-001 — Custom marks

Should custom marks remain a required feature, and should the JSON fixture live as test data rather than requirement prose?

Recommendation: yes. Requirement should state behavior; fixture belongs in test/evidence.

### Q-SOE-002 — Query demo scope

Should the legacy query-status viz-library example become a nextgen demo requirement, or only supporting evidence?

Recommendation: convert to explicit custom filter/query-mark requirements and use the demo as evidence, not as the requirement itself.

## paneled-outlier-explorer

### Q-POE-001 — Performance idea rows

Should exploratory performance ideas harvested from the wiki be requirements for P004, or a separate investigation backlog?

Recommendation: move exploratory ideas to backlog unless they describe current baseline behavior users depend on.

### Q-POE-002 — Brushing vs replacement interactions

Should paneled-outlier-explorer keep brushing for baseline compatibility, or replace it with a new interaction model?

Recommendation: keep baseline brushing behavior for P004 unless a replacement is explicitly approved; migration should not silently remove major interaction behavior.

### Q-POE-003 — Nested JSON input

Should nextgen paneled-outlier-explorer continue row-based CSV-style input, or support/require nested JSON?

Recommendation: keep row-based input as the primary contract; nested JSON can be a later enhancement if it simplifies performance.

## safety-shift-plot

### Q-SSP-001 — Brush details split

Should `SSP-REQ-003` be split into brush trigger, detail table content, gray brushed region, non-selected point de-emphasis, and clear behavior?

Recommendation: yes. Each behavior maps to a separate browser test.

### Q-SSP-002 — Invalid data workflow

Should CAT-specific upload/download instructions be dropped from nextgen invalid-data requirements?

Recommendation: yes. Preserve invalid record handling and logging/display, but replace CAT upload/download with standalone fixture tests.

### Q-SSP-003 — One-page layout

What viewport/browser defines “chart fits on one page,” and is vertical scrolling allowed?

Recommendation: define a desktop QA viewport and allow vertical scrolling unless Jeremy needs a stricter dashboard-style constraint.

## safety-delta-delta

### Q-SDD-001 — Details metadata placement

Where should configured `details[]` metadata appear: above the chart, above the detail table, or in the table header?

Recommendation: table header. It is tied to selected participant context and avoids cluttering the main chart.

### Q-SDD-002 — Visit config semantics

Do `settings.visits.x` and `settings.visits.y` mean baseline/comparison visits, x/y measure visits, or something else in the legacy API?

Recommendation: treat them as baseline/comparison visit selectors if that matches observed legacy behavior; document aliases clearly.

## safety-results-over-time

### Q-SROT-001 — Tooltip precision

Should `SROT-REG-014` and `SROT-REG-015` be merged into a single tooltip content/precision requirement?

Recommendation: yes. They are one behavior split by line wrapping.

### Q-SROT-002 — Missing unit column warning

If `unit_col` references a nonexistent variable, should nextgen log a console warning or silently render without units?

Recommendation: render without units and log a warning. Silent fallback hides configuration problems.

### Q-SROT-003 — Unscheduled visits config

Should `settings.unscheduled_visits` be added as a missing row alongside `settings.unscheduled_visit_pattern`?

Recommendation: yes. The pattern only matters if the display toggle exists.

## aeexplorer

### Q-AE-001 — Input update timing

Should prevalence and search filters update on Enter/blur as in the user spec, or live on every keystroke as in regression tests?

Recommendation: use Enter/blur for parity with the user spec unless legacy baseline clearly updates live. Live updates can be expensive for large AE tables.

### Q-AE-002 — Search highlight style

Should search matches be highlighted yellow or bold regal orange?

Recommendation: use the regression-test style if it reflects the newer product decision; otherwise preserve yellow. Need Jeremy decision because source conflicts.

### Q-AE-003 — webchartsDetailTable mode

Should nextgen preserve `webchartsDetailTable`, or only preserve detail-table capabilities like sort, search, pagination, and export?

Recommendation: preserve capabilities, not Webcharts-specific mode names, unless compatibility wrapper requires it.

## ae-timelines

### Q-AET-001 — Sort options

What exact AE timeline sort options and directions should nextgen support?

Recommendation: start with subject identifier alphabetical and earliest AE start day; add additional options only if baseline/demo confirms them.

### Q-AET-002 — Severe AE highlighting

Is severe-AE highlighting a required behavior or only sample configuration in the query demo?

Recommendation: treat it as configurable sample behavior unless the functional specs require it globally.

### Q-AET-003 — Custom marks API

Should nextgen custom marks retain Webcharts `type` and `per` semantics exactly, or use a new mark-extension API?

Recommendation: support a small legacy-compatible adapter, but document nextgen mark-extension behavior separately.

## web-codebook

### Q-WCB-001 — Initial chart visibility

For P004 baseline, should codebook charts be hidden or visible on initial load? Regression rows and config defaults conflict.

Recommendation: choose visible if config default says `chartVisibility: "visible"`; add a separate test proving config can start hidden.

### Q-WCB-002 — Exact type indicators

Must P004 preserve exact type indicators `#`, `cat`, and `abc`, or only preserve underlying type classification behavior?

Recommendation: preserve exact indicators in the initial migration because they are user-visible and regression-tested.

### Q-WCB-003 — CSV export placement and filename

Must nextgen preserve exact CSV button placement and `webchartsTableExport` filename prefix, or only filtered/sorted CSV export behavior?

Recommendation: preserve export behavior, but allow filename prefix to change if documented. Button placement should match baseline unless UI redesign is explicit.

### Q-WCB-004 — Webcharts table/chart factory exports

Should nextgen preserve public chart factory names only, or exact legacy source-path-backed exports?

Recommendation: preserve public names if consumed externally; do not preserve source-path-backed internals.
