# Interview Log: P004 Open Questions

## Metadata

- Project: P004 SafetyGraphics Renderer Modernization
- Source artifact: https://github.com/obot-claw/obot-claw.github.io/blob/main/projects/004/overview.md#open-questions
- Owner: obot-claw
- Created: 2026-05-20
- Status: active

## Questions

## P004-ARCH-Q001: Repository structure

**Status:** draft  
**Source:** P004 overview open questions  
**Context:** We need to decide whether modernization work happens package-by-package or in a consolidated repo once the migration path is clearer.  
**Question:** Should each renderer remain its own npm package, or should we consolidate into a monorepo once the migration path is clear?

**Options:**

1. Keep separate npm packages.
2. Move to a monorepo for shared tooling and coordinated releases.
3. Keep separate now, revisit after Safety Histogram spike.

**Asked in Telegram:**  
**Answer:**  
**Decision:**  
**Follow-up artifacts:**  
**Notes:**

## P004-ARCH-Q002: Chart.js scope

**Status:** draft  
**Source:** P004 overview open questions  
**Context:** Chart.js is the reference pattern from `gsm.viz`, but some clinical displays may need custom SVG/Canvas layers.  
**Question:** Should Chart.js be mandatory for every renderer, or should some displays stay custom SVG/Canvas where Chart.js is not a good fit?

**Options:**

1. Chart.js is mandatory unless impossible.
2. Chart.js is preferred, but custom SVG/Canvas is allowed with justification.
3. Decide renderer-by-renderer after requirements harvesting.

**Asked in Telegram:**  
**Answer:**  
**Decision:**  
**Follow-up artifacts:**  
**Notes:**

## P004-TEST-Q003: Qualification-ready testing standard

**Status:** draft  
**Source:** P004 overview open questions  
**Context:** The new renderers should move toward GxP-oriented evidence, but we need a practical minimum standard for early migrations.  
**Question:** What is the minimum testing standard for a renderer to be considered close to qualification-ready?

**Options:**

1. Unit + integration + browser tests tied to requirement IDs.
2. Add visual regression tests for key display states as mandatory evidence.
3. Define a stricter formal validation package later; use traceable automated tests for now.

**Asked in Telegram:**  
**Answer:**  
**Decision:**  
**Follow-up artifacts:**  
**Notes:**

## P004-API-Q004: Legacy API compatibility

**Status:** draft  
**Source:** P004 overview open questions  
**Context:** Preserving the legacy API reduces migration friction, but a clean API may be better for long-term renderer quality.  
**Question:** Should the first migration preserve the legacy public API exactly, or should we introduce a new API and provide a compatibility wrapper?

**Options:**

1. Preserve the legacy API exactly.
2. Introduce a new API and provide a compatibility wrapper.
3. Introduce a new API only; document breaking changes.

**Asked in Telegram:**  
**Answer:**  
**Decision:**  
**Follow-up artifacts:**  
**Notes:**

## P004-ARCH-Q005: Static chart API location

**Status:** draft  
**Source:** P004 overview open questions  
**Context:** Future static graphics may live alongside interactive renderers or in `gsm.safety`; the boundary affects package design.  
**Question:** How much of the future static chart API should live in these renderer repos versus `gsm.safety`?

**Options:**

1. Keep static chart API in `gsm.safety`; renderer repos stay interactive.
2. Put static and interactive implementations side-by-side in renderer repos.
3. Share display contracts in renderer repos, with static orchestration in `gsm.safety`.

**Asked in Telegram:**  
**Answer:**  
**Decision:**  
**Follow-up artifacts:**  
**Notes:**
