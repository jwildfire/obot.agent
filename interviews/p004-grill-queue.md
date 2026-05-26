# P004 grill-me queue

This queue is generated from the agentic AI review of harvested requirements. Ask one question at a time in Telegram using the grill-me format.

## Recommended first renderer

Start with **safety-histogram** because it is the first migration target and exposes reusable policy decisions: legacy API compatibility, Webcharts settings compatibility, CAT/viz-library evidence, and statistical method parity.

## Cross-renderer policy questions

### Q-P004-001 — Legacy API compatibility

Should nextgen renderer packages preserve legacy factories like `safetyHistogram(element, settings).init(data)`, or can they expose a new API if rendered behavior and htmlwidget integration are preserved?

Recommendation: preserve a thin compatibility wrapper for vX.0.0 where practical, but design internals around a nextgen API. This limits migration friction while keeping the refactor clean.

### Q-P004-002 — Webcharts config compatibility

Should nextgen renderers accept legacy Webcharts configuration objects, translate a supported subset, or drop Webcharts config compatibility entirely?

Recommendation: translate a documented subset for core data mapping/controls and explicitly mark unsupported Webcharts-only settings as replaced/deferred. Full compatibility would preserve too much legacy surface area.

### Q-P004-003 — CAT/viz-library test scope

Should CAT/viz-library-specific regression tests be preserved as requirements, or rewritten as standalone demo/browser tests?

Recommendation: rewrite them as standalone demo/browser tests unless they describe a behavior still needed by gsm.safety/htmlwidgets. CAT itself should be evidence context, not the required runtime.

### Q-P004-004 — Visual acceptance criteria

What viewport/browser target should define vague visual requirements like “fits on one page” or “looks good”?

Recommendation: use a documented desktop viewport for baseline QA, e.g. Chromium 1440x900, and explicitly allow page scrolling unless the source behavior requires single-screen layout.

### Q-P004-005 — Statistical parity

For histogram p-values and grouped comparisons, should nextgen reproduce the exact legacy method/precision/disclaimer, or define a new documented method?

Recommendation: preserve the legacy method only if we can identify it exactly and test fixture outputs; otherwise define a new method with explicit disclaimers and manual review before calling it production-ready.

## safety-histogram

### Q-SH-001 — Normal range behavior split

Should `SH-FUNC-004` be split into separate requirements for normal-range band rendering, default hidden checkbox behavior, and missing LLN/ULN control hiding?

Recommendation: yes. These are separately testable behaviors and should map to separate tests.

### Q-SH-002 — X-axis limit controls

Should `SH-FUNC-005` be split into lower/upper x-domain inputs, stepper behavior, blur-to-apply behavior, and chart redraw behavior?

Recommendation: yes. This avoids one giant test with ambiguous failure diagnosis.

### Q-SH-003 — Linked-table lead-in

Can `SH-FUNC-009` be dropped if `SH-FUNC-010` through `SH-FUNC-012` cover the three linked-table actions?

Recommendation: yes. Keep the child behavior rows and drop the lead-in.

### Q-SH-004 — Histogram p-value method

Should nextgen reproduce the legacy normality test exactly? If yes, what test name, precision, and fixture expected values should be used?

Recommendation: require exact method/precision before implementation. If unavailable, mark p-value rows blocked and implement the rest first.

### Q-SH-005 — External info links

Should histogram info icons continue linking to external pages like Wikipedia, or should nextgen use inline help text?

Recommendation: prefer inline help text plus optional docs links. External navigation from renderer UI is brittle and harder to validate.

### Q-SH-006 — Validation disclaimer text

Should the legacy disclaimer text “thoroughly tested, but is not validated” be preserved exactly?

Recommendation: preserve exact legacy wording until Jeremy approves a replacement; disclaimer wording is compliance-sensitive.

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
