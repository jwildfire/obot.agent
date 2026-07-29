# AGENTS.md — obot overlay on the gsm.agent harness

## Overlay contract

This repo is an **overlay** on the
[gsm.agent](https://github.com/Gilead-BioStats/gsm.agent) harness (cloned as `.github/`
in the obot2 workspace). gsm.agent's AGENTS.md conventions — drafts, attribution,
approval gates, worktrees, TDD — apply here **in full**. This file adds only the obot
program layer; it does not restate what upstream owns, and where the two appear to
conflict, upstream wins unless the divergence is documented explicitly. The two
documented divergences are commit attribution mechanics — see
[`skills/obot-identity/SKILL.md`](skills/obot-identity/SKILL.md) — and worktree
location, below.

The tiers of agent execution used in this program (*session* / *spawned agent* /
*subagent*) are defined in [`docs/terminology.md`](docs/terminology.md).

## Worktree location (documented divergence)

Upstream's Parallel Worktree Convention places linked worktrees in a sibling
`../{repo}-worktrees/` directory. In this program, place them **inside the repo** at
`{repo}/.claude/worktrees/{branch}` instead:

```bash
# From the repo root; base off the repo's integration branch as upstream directs
git fetch origin
git worktree add .claude/worktrees/{branch} -b {branch} origin/{base}
# Once per repo, keep git status clean (covers all current and future worktrees):
grep -qxF '.claude/worktrees/' .git/info/exclude 2>/dev/null || echo '.claude/worktrees/' >> .git/info/exclude
```

**Why:** Claude Code auto-approves worktrees under `.claude/worktrees/` and treats any
other location as a "permission-root relocation" that requires a manual click from
@jwildfire — which stalls every unattended session that isolates work the upstream way.
In an interactive Claude Code session, prefer the built-in EnterWorktree tool (it
creates worktrees under `.claude/worktrees/` automatically); the manual commands above
are for scripted lanes and spawned agents.

Everything else in the upstream convention still applies: one branch per worktree, all
commands run from inside the worktree, push and `gh pr create` from the worktree, and
cleanup after merge (`git worktree remove .claude/worktrees/{branch}` from the repo
root, then delete the branch). Do not remove other agents' in-flight worktrees, in
either layout. Repo-wide searches from the main checkout may want
`--exclude-dir=.claude` now that worktrees live inside the repo.

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

Use `skills/stakeholder-interview/SKILL.md` for any Jeremy input needed through Telegram — architecture, prioritization, API design, validation strategy, review questions, and process decisions, not only requirements. Capture answers in `interviews/` and propagate decisions into the relevant durable artifacts.

## Required artifacts per renderer

- `requirements/<renderer>.md` in [safety.viz](https://github.com/jwildfire/safety.viz/tree/HEAD/requirements) — the requirement matrix (moved out of this repo in obot.roadmap#64)
- requirement-keyed tests and the published evidence page in safety.viz
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

This is the project-level test-first discipline for JS renderer work, used alongside the
upstream [`tdd`](https://github.com/Gilead-BioStats/gsm.agent/blob/main/skills/tdd/SKILL.md)
skill; how the two relate will be settled when gsm.agent's Q3 skills-library work lands
(D1, deferred 2026-07-11).

## Branching and release model (safety.viz only)

This model applies to **safety.viz and nothing else** — it is not an ecosystem default.
For every other repo, follow the upstream rule: do not assume `dev`/`main`; check the
repo's actual branch model. Established 2026-07-08 alongside the documentation-site design
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

All active repos live under the `jwildfire` account; agent-authored commits, pushes,
and PRs come from `obotclaw[bot]` per `skills/obot-identity/SKILL.md`. Future transfer
to `SafetyGraphics` should happen only after repository scope, naming, permissions,
and governance are clear.
