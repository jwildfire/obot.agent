# obot.agent

The obot program overlay on the [gsm.agent](https://github.com/Gilead-BioStats/gsm.agent)
agent harness: program conventions, agent skills, and a GxP-oriented engineering framework
for the safetyGraphics → gsm modernization.

## What this repo is

Agents working in the obot2 workspace operate under three layers:

| Layer | Owns | Repo |
|---|---|---|
| **gsm.agent** (upstream) | Ecosystem conventions: drafts, attribution, approval gates, worktrees, TDD | [Gilead-BioStats/gsm.agent](https://github.com/Gilead-BioStats/gsm.agent) (cloned as `.github/`) |
| **obot.agent** (this repo) | The obot program layer: mission + GxP stance, renderer-migration skills and framework docs, session-lifecycle skills, the obotclaw automation identity | [jwildfire/obot.agent](https://github.com/jwildfire/obot.agent) |
| **obot.roadmap** (hub) | Requirements + lifecycle, designs, project board, diary, reports — **live program status lives there, not here** | [jwildfire/obot.roadmap](https://github.com/jwildfire/obot.roadmap) · [site](https://jwildfire.github.io/obot.roadmap/) |

The overlay contract is the headline of [`AGENTS.md`](AGENTS.md): upstream conventions
apply in full, this repo adds only the obot layer, and upstream wins on conflict unless a
divergence is documented. The tiers of agent execution (*session* / *spawned agent* /
*subagent*) are defined in [`docs/terminology.md`](docs/terminology.md).

## The program

Modernize the legacy RhoInc / SafetyGraphics JavaScript renderers into a consolidated,
tested library, mirroring the gsm.kri ↔ gsm.viz architecture:

- **[safety.viz](https://github.com/jwildfire/safety.viz)** — the consolidated Chart.js
  renderer library and its documentation site (v0.1.0 shipped the `safety-histogram`
  pilot renderer, 2026-07-11).
- **[gsm.safety](https://github.com/jwildfire/gsm.safety)** — R package with `Widget_*()`
  htmlwidget bindings over safety.viz, and later the static safety charts.
- Legacy forks (e.g. [safety-histogram](https://github.com/jwildfire/safety-histogram))
  hold baseline and requirements-harvesting work; the remaining RhoInc renderers stay
  upstream until their migration starts.

For current status — which renderers are live, what's in review, what's next — see the
[roadmap site](https://jwildfire.github.io/obot.roadmap/) and the hub's project board.

## Repository layout

- `AGENTS.md` — the overlay: program rules layered on gsm.agent conventions.
- `agent.md` — short entrypoint: which skill to reach for.
- `docs/` — framework docs (test framework, GxP framework, interview framework,
  terminology, gsm.viz reference) and harvested requirement matrices
  (`docs/requirements/`).
- `skills/` — the 14 agent skills; grouped index in [`agent.md`](agent.md).
- `templates/` — starter templates (requirements matrix, interview log/question,
  test-driver prompt).
- `interviews/` — P004 interview records (historical; kept verbatim).
- `scripts/` — `obot-app-token` (mints obotclaw[bot] installation tokens) and the wiki
  requirements-harvest helper.

## Agent identity

Agent-authored commits, pushes, issues, and PRs come from the **`obotclaw[bot]`** GitHub
App — mechanics and token minting in
[`skills/obot-identity/SKILL.md`](skills/obot-identity/SKILL.md). Jeremy reviews and
merges as @jwildfire; the bot authors work but never approves or merges it.

## Core workflow (renderer migration)

For each renderer:

1. **Harvest requirements** from upstream wiki pages, settings schema, README, examples, issue history, and test notes.
2. **Create a requirements matrix** mapping every functional requirement to one or more tests.
3. **Establish baseline behavior** using the legacy renderer before refactoring.
4. **Separate pure data logic** from rendering and browser interactions.
5. **Replace Webcharts incrementally** with a modern renderer architecture.
6. **Add automated tests** at unit, integration, browser, visual, and requirements levels.
7. **Document traceability** from requirement to test to implementation PR.

Renderer wiki requirements are harvested under `docs/requirements/`. These files are
source-backed starting matrices and must be reviewed, de-duplicated, and mapped to tests
before a renderer migration is considered complete.

- [Requirement matrices](docs/requirements/README.md)
- [Test framework](docs/test-framework.md)

## Reference implementation

`gsm.viz` remains the JavaScript architecture reference — ES modules, Chart.js, schema
validation, the validate → configure → structure → render flow (see
[`docs/gsm-viz-reference.md`](docs/gsm-viz-reference.md)). safety.viz is the living
implementation of that pattern for the safety displays.

## Interview framework

Use [`docs/interview-framework.md`](docs/interview-framework.md) and
[`skills/stakeholder-interview/SKILL.md`](skills/stakeholder-interview/SKILL.md) whenever
Jeremy's input is needed through Telegram — architecture, prioritization, API design,
review questions, and process decisions, not only requirements. The P004 question logs in
`interviews/` are the historical record of this framework in use.

## Releases

Overlay milestones are tagged (`vX.Y.Z`); release notes are drafted by agents and
published by @jwildfire. See the
[releases page](https://github.com/jwildfire/obot.agent/releases) — `v0.1.0-rc1` is the
safety.agent → obot.agent restructure RC
([requirement](https://github.com/jwildfire/obot.roadmap/issues/17)).

## GxP stance

This repo does not make any renderer validated by itself. It defines a pragmatic
GxP-oriented engineering framework: traceable requirements, controlled changes, documented
evidence, deterministic tests, and explicit review checkpoints. Qualification/validation
decisions remain project-specific and require human governance.
