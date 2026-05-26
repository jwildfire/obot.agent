# safety-agent

Agent instructions and GxP-oriented workflow framework for modernizing legacy SafetyGraphics JavaScript renderers.

## Purpose

`safety-agent` is the operating guide for agents working on the next generation of SafetyGraphics renderer packages. The immediate project is to modernize the legacy RhoInc Safety Explorer Suite renderers staged under `obot-claw`, remove the `webcharts` dependency, and move toward independent modern JavaScript renderers, likely using Chart.js where it fits the display model.

The framework is designed to keep migration work traceable:

1. use existing RhoInc wiki documentation as functional requirements,
2. convert those requirements into machine-trackable tests,
3. preserve clinical display behavior before changing internals,
4. document each behavior change and design decision,
5. keep static and interactive safety displays aligned where practical.

## Reference implementation

Use `gsm.viz` as the JavaScript architecture reference for nextgen renderer work. It provides the Chart.js/esbuild/Jest pattern currently used under GSM reporting. See `docs/gsm-viz-reference.md`.

## Starting scope

First renderer: `safety-histogram`

- Upstream: https://github.com/RhoInc/safety-histogram
- Staging fork: https://github.com/obot-claw/safety-histogram
- Requirements source: https://github.com/RhoInc/safety-histogram/wiki/Technical-Documentation#functional-specs
- P004 overview: https://obot-claw.github.io/projects/004/overview.html
- Safety Histogram deep dive: https://obot-claw.github.io/projects/004/safety-histogram.html

## Repository layout

- `AGENTS.md` - global agent rules for this modernization program.
- `agent.md` - short entrypoint for humans and agents.
- `docs/` - framework documentation, requirements strategy, and testing model.
- `skills/` - reusable task instructions for agents working on renderer migrations.
- `templates/` - starter templates for requirements matrices and migration plans.

## Interview framework

Use `docs/interview-framework.md` and `skills/stakeholder-interview/SKILL.md` whenever Jeremy input is needed through Telegram. Active P004 questions are tracked in `interviews/p004-open-questions.md`.

## Core workflow

For each renderer:

1. **Harvest requirements** from upstream wiki pages, settings schema, README, examples, issue history, and test notes.
2. **Create a requirements matrix** mapping every functional requirement to one or more tests.
3. **Establish baseline behavior** using the legacy renderer before refactoring.
4. **Separate pure data logic** from rendering and browser interactions.
5. **Replace Webcharts incrementally** with a modern renderer architecture.
6. **Add automated tests** at unit, integration, browser, visual, and requirements levels.
7. **Document traceability** from requirement to test to implementation PR.


## Requirement matrices

Renderer wiki requirements are harvested under `docs/requirements/`. These files are source-backed starting matrices and must be reviewed, de-duplicated, and mapped to tests before a renderer migration is considered complete.

- [Requirement matrices](docs/requirements/README.md)
- [Test framework](docs/test-framework.md)

## GxP stance

This repo does not make any renderer validated by itself. It defines a pragmatic GxP-oriented engineering framework: traceable requirements, controlled changes, documented evidence, deterministic tests, and explicit review checkpoints. Qualification/validation decisions remain project-specific and require human governance.
