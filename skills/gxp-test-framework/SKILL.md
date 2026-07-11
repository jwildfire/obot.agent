---
name: gxp-test-framework
description: "Use when designing or reviewing tests for nextgen renderer work. Defines the required test layers (unit, integration, browser, visual regression, traceability), evidence-first principles, and a review checklist tying requirement IDs to test evidence."
---

# GxP Test Framework Skill

Use when designing or reviewing tests for nextgen renderer work.

## Principles

- Tests are evidence, not decoration.
- Every functional requirement should map to automated evidence or a documented manual/deferred status.
- Prefer deterministic data fixtures.
- Preserve legacy behavior before refactoring internals.
- Browser tests should cover user workflows, not only page load.

## Required test layers

1. Unit tests for pure data/statistics logic.
2. Integration tests for renderer lifecycle.
3. Browser tests for controls and interactions.
4. Visual regression tests for rendered chart states.
5. Traceability checks mapping requirements to evidence.

## Review checklist

- Are requirement IDs present in test names or metadata?
- Does the test fail for the expected reason if behavior regresses?
- Does the test avoid brittle implementation details where possible?
- Is manual evidence clearly marked when automation is not practical?
