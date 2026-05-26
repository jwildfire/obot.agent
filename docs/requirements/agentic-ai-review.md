# Agentic AI review of harvested requirements

This review replaces the earlier parser-driven AI review attempt. The review is intentionally agentic: each reviewer received renderer-specific requirement matrices plus local wiki/source context and reviewed rows for standalone meaning, testability, scope ambiguity, and likely line-break/settings artifacts.

## Review method

- Assign disjoint renderer groups to sub-agents.
- For each row, determine whether it is a standalone requirement, a duplicated/fragmented artifact, a legacy implementation detail, or a decision needing Jeremy.
- Capture proposed wording, split/merge/drop recommendations, and grill-me questions.
- Do not treat the review as SME approval. Rows flagged here still need Jeremy review before implementation is called complete.

## Reviewer scopes

| Scope | Renderers |
|---|---|
| Safety lab trend/shift group | safety-shift-plot, safety-delta-delta, safety-results-over-time |
| Safety histogram/outlier group | safety-histogram, safety-outlier-explorer, paneled-outlier-explorer |
| AE group | aeexplorer, ae-timelines |
| Codebook group | web-codebook |

## Cross-renderer decisions surfaced

These questions recur across multiple renderers and should be resolved before full implementation:

1. **Legacy Webcharts API compatibility** — Should nextgen packages preserve legacy factories such as `safetyHistogram(element, settings).init(data)`, or only preserve rendered behavior behind a new API?
2. **CAT/viz-library scope** — Should CAT-specific regression tests become standalone demo/browser tests, or are any CAT workflows still required?
3. **Legacy configuration compatibility** — Should Webcharts configuration objects be accepted as compatibility input, translated into nextgen settings, or dropped in favor of explicit nextgen config?
4. **Statistical method parity** — For histogram p-values and grouped comparisons, should we reproduce the exact legacy method/precision/disclaimer, or define a new documented method?
5. **Visual regression acceptance** — Several rows say “looks good,” “fits on one page,” or “functions as expected.” These need explicit viewport, interaction, and visual acceptance criteria.

## Recommended grill-me starting point

Start with **safety-histogram**. It is the first renderer already selected for migration, and its open questions drive reusable policy for API compatibility, Webcharts settings, CAT examples, and statistical parity.

## Renderer review summaries

### safety-histogram

Primary issues: compound functional rows, legacy Webcharts/API rows, CAT/viz-library evidence rows, and statistical p-value ambiguity.

Key recommendations:

- Split `SH-FUNC-004` into normal-range band rendering, default hidden checkbox behavior, and unavailable-control behavior when LLN/ULN are missing.
- Split `SH-FUNC-005` into lower/upper x-domain controls, stepper behavior, blur-to-apply behavior, and redraw behavior.
- Drop `SH-FUNC-009` as a lead-in if `SH-FUNC-010` through `SH-FUNC-012` cover the linked-table actions.
- Split `SH-REG-014` into invalid-row removal, UI removed-count note, console warning, and changed-dataset count tests.
- Clarify `SH-REG-044`, `SH-REG-047`, `SH-REG-058`, and `SH-REG-061` before implementing p-values: exact method, grouped method, precision, and expected fixture values are not yet defined.
- Clarify whether info-icon external links and the legacy validation disclaimer text are required exactly.
- Replace Webcharts implementation rows with nextgen configuration/API requirements unless compatibility is explicitly required.

### safety-outlier-explorer

Primary issues: lead-in rows, legacy `.init(data)` API references, legacy Webcharts config rows, and custom-query demo evidence.

Key recommendations:

- Drop `SOE-FUNC-011` as a lead-in if child rows cover click behavior.
- Convert `SOE-REG-043` into a requirement that custom mark settings render configured marks; keep JSON fixture as evidence/test data.
- Decide whether to preserve `safetyOutlierExplorer(element, settings).init(data)` exactly or provide equivalent nextgen API.
- Move custom-query viz-library links into evidence/demo context, or convert them into explicit filter/query-mark requirements.
- Replace Webcharts-specific config rows with nextgen configuration requirements.

### paneled-outlier-explorer

Primary issues: CSV export row is compound, checklist artifacts, legacy API/config rows, and many exploratory/performance idea rows harvested as requirements.

Key recommendations:

- Split `POE-FUNC-018` into CSV button, exported rows, sort preservation, filename convention, and export toggle requirements.
- Strip `[X]` checklist artifacts from `POE-REG-001` through `POE-REG-044`.
- Merge malformed `POE-CFG-009` regex default into `POE-CFG-008`.
- Drop or move `POE-REQ-008`, `POE-REQ-009`, `POE-REQ-016`, `POE-REQ-020`, `POE-REQ-024`, and `POE-REQ-025` to investigation/backlog unless Jeremy confirms product scope.
- Clarify whether brushing remains required, whether data-driven outlier detection is in scope, and whether nested JSON input is allowed/required.

### safety-shift-plot

Primary issues: compound brush/listing behavior, copied “histogram” wording, legacy Webcharts/API rows, and CAT-specific invalid-data workflow.

Key recommendations:

- Rewrite `SSP-COUNT-001` to refer to shift plot participants and update on filters/measure/visit selections.
- Split `SSP-REQ-003` into brush trigger, detail table content, gray brushed region, non-selected point de-emphasis, and clear behavior.
- Clarify `SSP-REG-015`: define viewport/browser and whether vertical scrolling is allowed.
- Split `SSP-REG-020` into invalid-row removal, measure retention, removed-count logging/display, and decide whether CAT upload/download workflow is dropped.
- Split `SSP-CFG-004`, `SSP-CFG-005`, and `SSP-CFG-006` into concrete x/y parameter and filter field requirements.
- Decide whether to preserve `safetyShiftPlot(element, settings)`.

### safety-delta-delta

Primary issues: compound linked-table row, copied “histogram” wording, missing TODO/code artifacts, and ambiguous visit/measure config semantics.

Key recommendations:

- Rewrite `SDD-FUNC-004` as participant count beneath controls updated by filters.
- Split `SDD-FUNC-006` into point click, one row per measure, sparkline/change values, point highlight, and detail header.
- Split `SDD-REG-008` into invalid-row removal, UI removed-count note, and console warning; decide whether manual CAT upload/edit workflow is out of scope.
- Replace `[[[TODO: ADD CODE]]]` artifacts in `SDD-REG-009` and `SDD-REG-017` with explicit expected behavior.
- Clarify `settings.measure.x/y` vs `settings.measure_col` and the semantics of `settings.visits.x/y`.
- Decide whether to preserve `safetyDeltaDelta(element, settings)` / Webcharts object compatibility.

### safety-results-over-time

Primary issues: compound y-axis controls, tooltip precision split across rows, CAT-specific settings tests, and unscheduled-visit config parsing.

Key recommendations:

- Rewrite `SROT-FUNC-003` to reference participants currently included in the chart, not histogram.
- Split `SROT-FUNC-004` into lower/upper y-limit inputs, steppers, blur-to-apply, and redraw behavior.
- Fix `SROT-REG-010` typo to 5th/95th percentile unless Jeremy says otherwise.
- Merge `SROT-REG-014` and `SROT-REG-015` into tooltip content and precision requirements.
- Move `SROT-DATA-003` into config as `settings.visits_without_data`.
- Repair `SROT-CFG-018` default regex as `/unscheduled|early termination/i` and add missing `settings.unscheduled_visits` row.
- Decide whether to preserve `safetyResultsOverTime(element, settings)`.

### aeexplorer

Primary issues: compound interaction rows, conflicts between user spec and regression tests, legacy CAT/viz-library rows, and color/style ambiguity.

Key recommendations:

- Split `AE-USER-001`; decide whether prevalence/search inputs update on Enter/blur or every keystroke, and whether prevalence accepts only numeric values.
- Split `AE-USER-007`; decide whether search highlight is yellow or bold regal orange.
- Drop aggregate `AE-USER-009` after child hover rows are confirmed.
- Merge `AE-USER-010` and `AE-USER-011` into difference-diamond tooltip behavior.
- Rewrite `AE-USER-018` to say adverse-event summary/detail data, not visit data.
- Split `AE-USER-020` into validation-enabled CSV control, filtered data export, and filename convention.
- Convert CAT-specific rows into standalone browser/demo tests where possible.
- Decide whether `webchartsDetailTable` mode is preserved or replaced by equivalent detail-table capabilities.

### ae-timelines

Primary issues: copied text from other renderers, ambiguous sorting behavior, custom marks tied to Webcharts, missing core config rows, and a bad wiki link row.

Key recommendations:

- Rewrite `AET-FUNC-005` to say AE timeline data, not visit data.
- Clarify `AET-FUNC-006`: exact sort options and direction are not clear.
- Rewrite `AET-FUNC-007` to say participant annotation, not histogram.
- Split `AET-FUNC-008` into mark hover tooltip and clickable subject ID details.
- Clarify query visual style/click detail behavior in `AET-REG-007`.
- Merge `AET-DATA-003` and `AET-DATA-006`; color stratification variable default is `AESEV` unless configured otherwise.
- Add missing config rows for `id_col`, `seq_col`, `stdy_col`, and `endy_col`.
- Decide whether custom marks preserve Webcharts `type` and `per` semantics.
- Drop `AET-REQ-003`; it is link text and points to the wrong wiki.

### web-codebook

Primary issues: very large compound rows, CAT/default-dataset-specific tests, legacy Webcharts table/chart factory API rows, and several malformed harvested enum rows.

Key recommendations:

- Clarify `WCB-FUNC-002`: shown/hidden columns update column count, not rows.
- Split `WCB-FUNC-007`, `WCB-FUNC-012`, `WCB-FUNC-020`, `WCB-FUNC-023`, and `WCB-FUNC-026` into atomic interaction requirements.
- Decide whether to keep separate header count rows or one combined row/column count requirement for `WCB-FUNC-015`.
- Clarify exact CSV button placement/filename requirements in `WCB-FUNC-025`.
- Decide whether initial charts are hidden or visible; current regression and config defaults conflict.
- Merge split settings-code artifacts such as `WCB-REG-009/010` and `WCB-REG-095`.
- Clarify whether exact type indicators `#`, `cat`, and `abc` are required, or only type classification behavior.
- Restore valid `tabs` values for `codebook`, `listing`, `chartMaker`, `settings`, and `files`.
- Decide whether webcharts table config and chart factory source-path-backed exports are in scope.
