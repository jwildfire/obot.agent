---
name: p004-test-setup
description: Use before writing P004 renderer tests to inspect the requirement matrix, verify reviewed/blocked rows, inspect the renderer repo, identify missing Vitest/Playwright dependencies/scripts/fixtures/selectors, and prepare a setup plan or dependency patch.
---
# P004 Test Setup

## Purpose

Prepare a renderer repo for requirement-linked testing before test files are written.

## Inputs

- Renderer repo path.
- Requirement matrix path.
- Target requirement IDs.

## Workflow

1. Inspect git branch, remotes, and dirty state.
2. Read target requirement rows from the matrix.
3. Confirm every target row is `reviewed`, `implemented`, or explicitly assigned for setup. Do not test `blocked` or `needs-jeremy-review` rows.
4. Inspect `package.json`, existing tests, demo files, build scripts, and source module format.
5. Identify whether Vitest, Playwright, jsdom, ESLint/Prettier, and a static/demo server are present.
6. Identify deterministic fixtures and stable selectors needed for target requirements.
7. Produce one of:
   - a setup report only, or
   - a dependency/script/fixture patch if explicitly assigned.

## Required setup decisions

- Unit/integration layer: Vitest with jsdom where DOM is needed.
- Browser layer: Playwright Test, Chromium 1440x900.
- Test names must include requirement IDs.
- Avoid `npm audit fix` as a prerequisite for evidence commands because it mutates dependencies.
- Demo/browser tests must avoid remote data/network dependencies unless explicitly testing network behavior.

## Output checklist

- Target requirement IDs and status.
- Existing scripts and dependency gaps.
- Required package additions.
- Required fixture files.
- Required selectors or accessible roles.
- Commands to run after setup.
- Blockers that require implementation or Jeremy decision.
