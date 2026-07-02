# Skills library spike for P004 test framework

Date: 2026-05-26

## Goal

Identify established agent skill libraries or individual skills that can support P004 renderer testing, especially Vitest, Playwright, browser QA, and skill quality/security checks.

## Findings

### 1. OpenAI skills catalog

Source: https://github.com/openai/skills

The OpenAI skills catalog is the most relevant baseline for Codex-compatible skills. It documents the standard pattern: a skill is a folder containing `SKILL.md` plus optional scripts/resources. It also supports installation via `$skill-installer` from curated/experimental folders or GitHub URLs.

Recommendation: use this as the structural standard for `safety-agent` skills. Keep local P004 skills in the same `SKILL.md` pattern so they remain portable.

### 2. Anthropic `webapp-testing`

Source: https://github.com/anthropics/skills/tree/main/skills/webapp-testing
Catalog page: https://officialskills.sh/anthropics/skills/webapp-testing

This is the closest off-the-shelf match for browser QA. It uses Playwright to manage local app testing, server lifecycle, DOM inspection, screenshot capture, and browser log collection.

Recommendation: adopt ideas, not blindly vendor it. P004 needs Node Playwright tests inside renderer repos, while this skill is Python Playwright oriented. It is still a useful reference for server lifecycle, screenshots, console capture, and inspection workflow.

### 3. oakoss `playwright`

Source/catalog: https://explainx.ai/skills/oakoss/agent-skills/playwright

This skill is explicitly about Playwright usage, including browser automation, screenshots/PDF generation, Playwright Test configuration, troubleshooting, auto-waiting, assertions, locators, and CI/Docker patterns.

Recommendation: strong candidate to adapt for our browser QA skill. The P004 skill should narrow it to: Chromium 1440x900, requirement-ID-tagged tests, console capture, baseline/nextgen screenshots, and GitHub Pages demo checks.

### 4. oakoss `vitest-testing`

Source/catalog: https://llmbase.ai/skills/oakoss/vitest-testing/

This skill covers Vitest testing patterns and explicitly delegates end-to-end testing to Playwright. It emphasizes behavior/public API testing, test structure, mocks, fixtures, and Vitest configuration.

Recommendation: adopt the pattern for P004 unit/integration tests. Pair it with our renderer-specific rules: config normalization, data transforms, filter state, summary calculations, and deterministic fixture outputs.

### 5. Skill quality and security tooling

Sources:

- https://github.com/agent-ecosystem/skill-validator
- https://github.com/cisco-ai-defense/skill-scanner
- https://skilltester.ai/

`skill-validator` checks skill structure, link validity, token cost, content quality, and CI integration. `skill-scanner` is a best-effort security scanner for agent skills and explicitly warns that no automated scan is proof of safety. SkillTester provides utility/security benchmarking for many marketplace skills.

Recommendation: before importing third-party skills into `safety-agent`, run a manual review plus at least one static/quality/security check. Do not install large community skill packs wholesale.

## Recommended adoption plan

1. **Do not adopt a large skills library wholesale.** Skill ecosystems are uneven, and community skills can carry quality/security risk.
2. **Adopt selected patterns from established skills:**
   - OpenAI catalog structure for skill packaging.
   - Anthropic `webapp-testing` for browser QA workflow shape.
   - oakoss `playwright` for Playwright best practices.
   - oakoss `vitest-testing` for Vitest unit/integration testing patterns.
3. **Create P004-specific local skills instead of relying on generic skills directly:**
   - `p004-vitest-requirement-tests`
   - `p004-playwright-browser-qa`
   - `p004-demo-scaffold`
   - `p004-requirements-validator`
4. **Add validation/security guardrails:**
   - Validate local skill structure during PRs.
   - Keep skills short and task-specific.
   - Avoid skills that instruct agents to skip tests, bypass review, exfiltrate data, install unreviewed dependencies, or weaken sandboxing.

## Proposed concrete tool stack

Per nextgen renderer repo:

- Vite for dev server/build.
- Vitest for unit/integration tests.
- Playwright Test for browser behavior and visual smoke checks.
- ESLint + Prettier for static quality.
- Fixture registry for baseline, edge cases, and expected deterministic summaries.
- Requirement matrix validator for P004 traceability.

## P004-specific skill backlog

### `p004-vitest-requirement-tests`

Use when writing unit/integration tests from requirement IDs. Should enforce:

- one or more requirement IDs in each test name;
- behavior/public API assertions over implementation details;
- deterministic fixtures;
- explicit expected outputs for summaries/filters/config normalization.

### `p004-playwright-browser-qa`

Use when browser-checking a demo. Should enforce:

- Chromium 1440x900;
- console error capture;
- screenshot capture only for stable states;
- interaction checks tied to requirement IDs;
- QA note output suitable for PR comments.

### `p004-demo-scaffold`

Use when creating demo pages. Should enforce:

- baseline link;
- nextgen link;
- fixture selector;
- controls covering every reviewed requirement;
- visible requirement coverage checklist.

### `p004-requirements-validator`

Use before implementation or PR review. Should enforce:

- unique IDs;
- required matrix columns;
- no `needs-jeremy-review` rows in implementation-ready scope;
- no raw CAT URLs as requirement text without fixture extraction;
- every reviewed row has evidence type.

## Decision

Adopt external skills as references, not dependencies. Build and maintain a narrow local P004 skills library inside `safety-agent`, with clear validation and security guardrails.

## Follow-up decision: bounded test-driver sub-agent

Jeremy approved creating a bounded test-driver sub-agent for P004. The sub-agent should use the local `p004-test-driver` skill and `templates/p004-test-driver-prompt.md` prompt template. It owns requirement-to-test mapping and QA evidence, not product implementation or requirement rewriting.

## qcthat idea: JS evidence bridge

Jeremy also asked to file an idea around using `gilead-biostat/qcthat` as part of the test-agent workflow. `qcthat` currently focuses on R package qualification by linking GitHub issues to `{testthat}` evidence. The same model is relevant for P004 if `qcthat` or an adapter can ingest Vitest and Playwright reports.

Candidate direction:

- Keep GitHub issues or matrix rows as the requirement source.
- Require Vitest/Playwright test names to include requirement IDs and/or issue IDs.
- Export Vitest JSON/JUnit and Playwright JSON/JUnit.
- Add an adapter that normalizes JS test results into a qcthat-compatible issue/test/evidence matrix.
- Use the test-driver sub-agent to maintain coverage notes and blocked/manual rows.

This should be tracked as a future project idea, not a dependency for the first P004 renderer migration.
