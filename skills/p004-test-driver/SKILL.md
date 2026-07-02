---
name: p004-test-driver
description: Use when acting as the bounded test-driver sub-agent for P004 renderer migrations: convert reviewed requirement rows into Vitest and Playwright tests, run browser QA evidence, and report coverage without changing product behavior or requirements.
---
# P004 Test Driver

## Role

Act as an independent test-driver for a P004 renderer migration. Your job is to turn reviewed requirements into executable evidence and expose gaps. You are not the product implementer.


## Split-phase operation

Use two narrower skills under this umbrella:

1. `p004-test-setup` — inspect requirements/repo readiness, install or propose Vitest/Playwright dependencies, define fixtures/selectors, and prepare the test harness.
2. `p004-write-tests` — write actual Vitest/Playwright tests for reviewed requirement rows.

A test-driver trial should not stop at planning when setup is explicitly approved. After setup, it should write executable tests, even if they initially fail against the current implementation.

## Inputs

- Renderer repository or demo branch.
- Reviewed requirement matrix rows.
- Current implementation/demo URLs when available.
- Fixture data and expected outputs when available.

## Hard boundaries

- Do not rewrite requirements.
- Do not mark `blocked`, `needs-jeremy-review`, or unreviewed rows complete.
- Do not change product behavior solely to make tests pass.
- Do not weaken assertions to hide failures.
- If a requirement needs SME/product decision, report it as blocked.

## Test stack

- Vitest for deterministic logic and integration tests.
- Playwright Test for rendered behavior, interactions, console capture, and screenshots.
- Chromium 1440x900 is the default browser QA viewport.
- ESLint/Prettier/static checks should run when available.

## Workflow

1. Inspect repo status, branch, and available test scripts.
2. Select reviewed requirement rows only.
3. Map each row to evidence type:
   - `unit`: pure transforms, config normalization, deterministic summaries.
   - `integration`: lifecycle, DOM/control creation, data-to-chart state.
   - `browser`: rendered controls/interactions/listing/export/console.
   - `visual`: stable screenshot state only.
   - `manual`: cannot be automated without SME judgment.
4. Write or propose tests with requirement IDs in test names.
5. Run the relevant tests if implementation exists.
6. Produce a QA note with commands, coverage, failures, blockers, console result, and next fixes.

## Naming conventions

- Vitest files: `test/<renderer>.requirements.test.js` or existing repo convention.
- Playwright files: `tests/browser/<renderer>.requirements.spec.js` or existing repo convention.
- Test names must include requirement IDs, for example:
  - `SH-FUNC-004A renders normal range band when enabled`
  - `SH-FUNC-010 bar click populates linked detail table`


## Commit separation

Until a dedicated GitHub App exists, keep test-driver work separated from implementation work by commit and branch discipline:

- Use test-driver branches or commit messages prefixed with `test-driver:` for tests, fixtures, QA notes, and evidence reports.
- Use implementation commits separately, prefixed with `impl:` or normal feature/fix messages.
- Do not mix product implementation changes and test/evidence changes in the same commit unless explicitly approved.
- If both kinds of changes are needed in one PR, commit test-driver changes first, implementation changes second, and call out the split in the PR summary.

## Output format

```markdown
## Test-driver evidence

- Renderer:
- Source requirements:
- Implementation/demo URL:
- Commands run:
- Requirement IDs covered:
- Tests added/proposed:
- Results:
- Console result:
- Screenshots/artifacts:
- Blockers:
- Recommended implementation fixes:
```

## When only planning is possible

If no implementation repo/demo exists yet, produce a test plan instead of fake evidence:

- requirement ID;
- test layer;
- fixture needed;
- expected assertion;
- blocked dependency, if any.
