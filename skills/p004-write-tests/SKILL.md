---
name: p004-write-tests
description: Use when writing actual P004 Vitest or Playwright tests for reviewed renderer requirements after setup is complete or explicitly assigned, keeping tests/evidence separate from implementation commits.
---
# P004 Write Tests

## Purpose

Write executable tests for reviewed P004 renderer requirements. This is the test-writing phase, not a planning-only review.

## Inputs

- Renderer repo path.
- Target requirement IDs and matrix rows.
- Existing or planned fixtures.
- Existing or planned selectors/demo route.

## Boundaries

- Write tests, fixtures, and test-only demo harnesses.
- Do not change product implementation unless explicitly assigned.
- Do not rewrite requirements.
- Do not include `blocked` or `needs-jeremy-review` rows in passing acceptance tests.
- Keep test commits separate with `test-driver:` prefix until the dedicated GitHub App exists.

## Workflow

1. Confirm working tree and branch.
2. Verify setup: Vitest/Playwright scripts exist or are part of the assigned patch.
3. Create deterministic fixtures for target rows.
4. Write Vitest tests for pure/config/data behavior.
5. Write Playwright tests for rendered controls/interactions/listings/console output.
6. Include requirement IDs in every test name.
7. Run the narrow tests first, then broader relevant scripts.
8. Record failures honestly. Do not weaken tests to pass.
9. Commit only test/evidence changes with `test-driver:` prefix if publishing.

## Preferred file layout

- `test/fixtures/<renderer>.<scenario>.js` or `.json`
- `test/<renderer>.requirements.test.js`
- `tests/browser/<renderer>.requirements.spec.js`
- `test-page/requirements.html` or equivalent deterministic demo route

## Playwright defaults

- Chromium viewport: 1440x900.
- Capture console errors and unexpected warnings.
- Prefer semantic roles where stable; otherwise add/use `data-testid` only in test harness or after implementation approval.
- Screenshot only stable baseline states or known visual-regression checkpoints.

## Output checklist

- Files changed.
- Requirement IDs covered.
- Commands run and results.
- Expected failures, if tests are intentionally red.
- Implementation handoff notes.
