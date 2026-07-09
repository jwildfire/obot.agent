# AGENTS.md - SafetyGraphics Nextgen Renderer Agents

## Mission

Modernize SafetyGraphics JavaScript renderers with a GxP-oriented engineering discipline. Preserve clinically relevant behavior, replace legacy dependencies deliberately, and build a testable foundation for interactive and static safety displays.

## Non-negotiables

- Treat upstream wiki pages, settings schemas, examples, and regression tests as requirements sources.
- Do not start a rendering rewrite before producing a requirements matrix for the feature area being changed.
- Do not remove behavior because it is awkward to implement in Chart.js; document the requirement and propose a replacement or justified de-scope.
- Preserve backward-compatible data mappings unless Jeremy explicitly approves a breaking API change.
- Every migration PR must state which requirements it covers and which tests provide evidence.
- Do not claim GxP validation. Use language like "GxP-oriented", "qualification-ready evidence", or "traceability support" unless a formal validation process exists.

## Reference architecture

Use gsm.viz as the reference implementation for nextgen JavaScript renderer architecture: ES modules, Chart.js, data schemas, `checkInputs()` -> `configure()` -> `structureData()` -> Chart.js render flow, Jest/jsdom/canvas tests, and static examples. See `docs/gsm-viz-reference.md`.

## Stakeholder interviews

Use `skills/stakeholder-interview/SKILL.md` for any Jeremy input needed through Telegram. Interviews are not limited to requirements; they cover architecture, prioritization, API design, validation strategy, review questions, and process decisions. Capture answers in `interviews/` and propagate decisions into the relevant durable project artifacts.

## Required artifacts per renderer

- `docs/requirements/<renderer>-requirements.md`
- `docs/requirements/<renderer>-traceability.csv` or `.md`
- `docs/design/<renderer>-migration-plan.md`
- baseline example fixture(s)
- automated test plan
- PR checklist with requirement IDs

## Testing expectations

Minimum test layers:

1. **Schema tests** - settings and data mapping validation.
2. **Pure function tests** - data preparation, binning, statistics, domain calculations.
3. **Renderer integration tests** - DOM/canvas creation, lifecycle, settings updates.
4. **Browser behavior tests** - controls, filtering, hover/click, listing, warnings.
5. **Visual regression tests** - stable screenshots where feasible.
6. **Requirements traceability tests** - every harvested requirement maps to test evidence or a documented manual review.

## Branching and release model (safety.viz)

Established 2026-07-08 alongside the documentation-site design
([obot.roadmap#21](https://github.com/jwildfire/obot.roadmap/issues/21),
[design doc](https://jwildfire.github.io/obot.roadmap/requirements/design/21_design.html)):

- **`dev` is the integration branch** — feature-branch PRs target `dev`.
- **Releases are PRs from `dev` → `main`.** `main` is protected: PR required, the
  "Build, format, and test" check must pass, no force pushes or deletions.
- **The documentation site builds three tiers** from the `gh-pages` branch:
  the site root from `main` (releases), `/dev/` from `dev` (integration preview),
  and `/pr/{N}/` per open PR (removed on close).
- **Definition of done:** a renderer module is not done — and its migration
  requirement is not Released — until its site entry is complete: gallery demo,
  test-evidence page (requirements → tests → screenshots), and API reference.

## Preferred migration sequence

1. Baseline and document current behavior.
2. Add tests around pure logic and critical browser behavior.
3. Extract data/state modules away from Webcharts lifecycle.
4. Introduce a new renderer API with a compatibility shim.
5. Replace Webcharts rendering with Chart.js or targeted custom rendering.
6. Retire compatibility code only after review.

## Repository write policy

Use `obot-claw` forks as staging repositories. Future transfer to `SafetyGraphics` should happen only after repository scope, naming, permissions, and governance are clear.
