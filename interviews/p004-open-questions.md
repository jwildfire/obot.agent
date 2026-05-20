# Interview Log: P004 Open Questions

## Metadata

- Project: P004 SafetyGraphics Renderer Modernization
- Source artifact: https://github.com/obot-claw/obot-claw.github.io/blob/main/projects/004/overview.md#open-questions
- Owner: obot-claw
- Created: 2026-05-20
- Status: active

## Questions

## P004-ARCH-Q001: Repository structure

**Status:** decided  
**Source:** P004 overview open questions  
**Context:** We need to decide whether modernization work happens package-by-package or in a consolidated repo once the migration path is clearer.  
**Question:** Should each renderer remain its own npm package, or should we consolidate into a monorepo once the migration path is clear?

**Options:**

1. Keep separate npm packages.
2. Move to a monorepo for shared tooling and coordinated releases.
3. Keep separate now, revisit after Safety Histogram spike.

**Asked in Telegram:** 2026-05-20  
**Answer:** Option 3: keep separate packages now, revisit after Safety Histogram spike. Jeremy also requested future interview questions include obot's recommendation and short pros/cons whenever possible.  
**Decision:** Keep the current fork-per-renderer structure for P004 while using Safety Histogram as the first migration spike. Revisit monorepo consolidation after the spike clarifies shared tooling, release coupling, and common architecture needs.  
**Follow-up artifacts:** P004 overview, Safety Histogram migration plan, future repository governance docs.  
**Notes:** This avoids premature consolidation while still preserving the option to move to a monorepo once evidence exists.

## P004-ARCH-Q002: Chart.js scope

**Status:** decided  
**Source:** P004 overview open questions  
**Context:** Chart.js is the reference pattern from `gsm.viz`, but some clinical displays may need custom SVG/Canvas layers.  
**Question:** Should Chart.js be mandatory for every renderer, or should some displays stay custom SVG/Canvas where Chart.js is not a good fit?

**Options:**

1. Chart.js is mandatory unless impossible.
2. Chart.js is preferred, but custom SVG/Canvas is allowed with justification.
3. Decide renderer-by-renderer after requirements harvesting.

**Asked in Telegram:** 2026-05-20  
**Answer:** Jeremy agreed with option 2: Chart.js is preferred, but custom SVG/Canvas is allowed with justification.  
**Decision:** Use Chart.js as the default reference implementation pattern, aligned with gsm.viz. Allow custom SVG/Canvas for renderer features where Chart.js is not a good fit, but require explicit justification, tests, and design documentation for exceptions.  
**Follow-up artifacts:** Chart.js migration skill, renderer modernization plans, per-renderer design docs.  
**Notes:** This keeps consistency without forcing complex clinical display requirements into unsuitable Chart.js abstractions.

## P004-TEST-Q003: Qualification-ready testing standard

**Status:** decided  
**Source:** P004 overview open questions  
**Context:** The new renderers should move toward GxP-oriented evidence, but we need a practical minimum standard for early migrations.  
**Question:** What is the minimum testing standard for a renderer to be considered close to qualification-ready?

**Options:**

1. Unit + integration + browser tests tied to requirement IDs.
2. Add visual regression tests for key display states as mandatory evidence.
3. Define a stricter formal validation package later; use traceable automated tests for now.

**Asked in Telegram:** 2026-05-20  
**Answer:** Jeremy indicated this was already answered by the safety-agent implementation-framework spike and filed as https://github.com/obot-claw/safety-agent/issues/1.  
**Decision:** Treat qualification readiness as a traceable implementation framework: requirements harvested from legacy wikis, mapped to unit, integration, browser, visual-regression, accessibility, and review-evidence checks. The detailed minimum standard will be defined in the safety-agent spike before substantive Safety Histogram migration work proceeds.  
**Follow-up artifacts:** https://github.com/obot-claw/safety-agent/issues/1, safety-agent implementation playbook, GxP test framework docs, renderer migration templates.  
**Notes:** Do not re-ask this question unless the spike leaves a narrower unresolved testing-standard decision.

## P004-API-Q004: Legacy API compatibility

**Status:** decided  
**Source:** P004 overview open questions  
**Context:** Preserving the legacy API reduces migration friction, but a clean API may be better for long-term renderer quality.  
**Question:** Should the first migration preserve the legacy public API exactly, or should we introduce a new API and provide a compatibility wrapper?

**Options:**

1. Preserve the legacy API exactly.
2. Introduce a new API and provide a compatibility wrapper.
3. Introduce a new API only; document breaking changes.

**Asked in Telegram:** 2026-05-20  
**Answer:** Option 3: breaking changes are fine. These will ultimately be new major-version releases, or possibly entirely new packages.  
**Decision:** Do not preserve the legacy API or add compatibility wrappers by default. Design a clean nextgen API and document breaking changes. Treat compatibility wrappers as optional future work only if a concrete migration need appears.  
**Follow-up artifacts:** Safety Histogram implementation plan, package naming/versioning decisions, release notes.  
**Notes:** Nextgen packages should be allowed to release as `vX.0.0` major versions or as new packages if naming/governance points that way.

## P004-ARCH-Q005: Static chart API location

**Status:** decided  
**Source:** P004 overview open questions  
**Context:** Future static graphics may live alongside interactive renderers or in `gsm.safety`; the boundary affects package design.  
**Question:** How much of the future static chart API should live in these renderer repos versus `gsm.safety`?

**Options:**

1. Keep static chart API in `gsm.safety`; renderer repos stay interactive.
2. Put static and interactive implementations side-by-side in renderer repos.
3. Share display contracts in renderer repos, with static orchestration in `gsm.safety`.

**Asked in Telegram:** 2026-05-20  
**Answer:** Option 1: static charts are likely to be built in R using ggplot either in `gsm.safety` or in `safetyCharts`, while interactive versions are JavaScript. `gsm.safety` will continue using htmlwidgets to render the charts, possibly via `safetyCharts`.  
**Decision:** Keep static chart APIs out of the nextgen JavaScript renderer repos by default. Treat renderer repos as interactive JavaScript packages; keep static chart work in R-side packages such as `gsm.safety` or `safetyCharts`, with `gsm.safety` orchestrating htmlwidget rendering for interactive outputs.  
**Follow-up artifacts:** P004 overview, future FDA-style static chart project docs, `gsm.safety`/`safetyCharts` design notes.  
**Notes:** Revisit only if a specific static/interactive contract needs to be shared across packages.
