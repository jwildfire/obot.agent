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
- Legacy forks held baseline and requirements-harvesting work; the
  [safety-histogram](https://github.com/jwildfire/safety-histogram) fork (the P004 pilot)
  was archived 2026-08-15 on @jwildfire's call — its renderer lives on as safety.viz's
  histogram module. The remaining RhoInc renderers stay upstream until their migration
  starts.

For current status — which renderers are live, what's in review, what's next — see the
[roadmap site](https://jwildfire.github.io/obot.roadmap/) and the hub's project board.

## Repository layout

- `AGENTS.md` — the overlay: program rules layered on gsm.agent conventions.
- `agent.md` — short entrypoint: which skill to reach for.
- `docs/` — framework docs (test framework, GxP framework, interview framework,
  terminology, [`session-framework`](docs/session-framework.md) — the responsiveness contract the session commands
  answer to — gsm.viz reference). The harvested requirement matrices moved to
  safety.viz (`requirements/`) in obot.roadmap#64; `docs/requirements/` keeps the
  harvest-phase review record and a pointer.
- `skills/` — the agent skills; grouped index in [`agent.md`](agent.md).
- `commands/` — the short `/s-*` aliases for the session-command family (`/s-init`
  is `/session-init`); generated and installed by
  [`scripts/session-aliases`](scripts/session-aliases). Note the workspace copies at
  `~/Documents/obot2/.claude/commands/*.md` are **installed copies, not symlinks** —
  editing the files here does not update the live workspace commands until
  `scripts/session-aliases` is re-run. Skills under `.claude/skills/` *are* symlinks and
  go live immediately.
- `templates/` — starter templates (requirements matrix, interview log/question,
  test-driver prompt) plus the sibling briefing and the delta-sweep briefing — the
  fill-in briefings `session-spawn` and the bookends use.
- `interviews/` — P004 interview records (historical; kept verbatim).
- `scripts/` — `obot-app-token` (mints obotclaw[bot] installation tokens), `obot-merge`
  (the policy-gated merge lane), `obot-auto` (launches an unattended `--auto` session),
  `obot-prime` (launches the standing 🎩🤖 Q&A concierge session —
  [`skills/session-prime`](skills/session-prime/SKILL.md)),
  `policy.json` + `obot-policy` (see below), the idea-queue intake trio
  (`reminders-to-ideas`, `ideas-file`, `ideas-sweep`), `reviews-queue` (the classified
  PR queue behind `session-reviews`), `session-aliases` (generates and installs the
  `/s-*` aliases), and the wiki requirements-harvest helper.
- `tools/` — the session [`session-hub`](tools/session-hub/README.md) (live dashboard +
  wrapup report) and [`statusline`](tools/statusline/README.md) (the status line every
  agent runs, with its clickable hub link). Each ships an installer where the harness
  needs a copy outside the repo.

## Write policy: one decision per repo

[`scripts/policy.json`](scripts/policy.json) is the guardrail for every agent write in
the workspace — what merges where, and what an unattended session may do. A repo gets
**one** decision, its **profile**:

| | `protected` (the default) | `auto` (@jwildfire promotes a repo to it) |
|---|---|---|
| **integration** branch | merge needs `--jeremy-approved` attestation | merges on the standard lane |
| **release** branch(es) | attestation | attestation |
| any other branch | refused | refused |
| unattended `--auto` session | no writes at all | branch, draft PR, merge integration, manage issues |

Branches are declared by **role**, not name, so a repo whose branches aren't called
`dev`/`main` needs no special case — `demo-301` maps `main`→integration and its live
Pages branch `site`→release. A repo **absent from the file is refused entirely**; adding
one lands it at `protected`. Anything beyond a profile goes in that repo's `custom`
block and carries its own recorded approval.

```bash
scripts/obot-policy explain jwildfire/safety.viz   # effective permissions, with the approval record
scripts/obot-policy matrix                         # every repo x branch
scripts/obot-policy validate                       # structural + policy consistency (obot-auto gates on this)
scripts/obot-policy add jwildfire/new-repo         # scaffold at 'protected'
```

`policy.json` sits inside its own carve-out: PRs touching it never merge unattended, and
never merge at all without @jwildfire's sign-off. It replaced the `merge-policy.json` +
`autonomy-grants.json` pair, which had to be edited separately per repo and had drifted.

## Agent identity

Agent-authored commits, pushes, issues, and PRs come from the **`obotclaw[bot]`** GitHub
App — mechanics and token minting in
[`skills/obot-identity/SKILL.md`](skills/obot-identity/SKILL.md). Jeremy reviews and
merges as @jwildfire; the bot authors work but never approves or merges it.

## Idea queue (capture → triage → roadmap)

How raw ideas become roadmap items without a persistent Claude session
(requirement [obot.roadmap#48](https://github.com/jwildfire/obot.roadmap/issues/48);
full design on the
[roadmap site](https://jwildfire.github.io/obot.roadmap/requirements/design/48_design.html)):

- **Capture (zero tokens).** Three lanes into the hub's
  [Ideas discussions](https://github.com/jwildfire/obot.roadmap/discussions/categories/ideas):
  a new discussion straight from GitHub mobile/web; *"Hey Siri, add … to my obot
  list"* — [`scripts/reminders-to-ideas`](scripts/reminders-to-ideas) files pending
  Reminders as discussions posted by obotclaw[bot] (no LLM); or, from inside a
  session, [`session-idea`](skills/session-idea/SKILL.md) →
  [`scripts/ideas-file`](scripts/ideas-file). All three post the same shape, and all
  three honour the `private:` prefix that keeps an item in a local file, never posted.
- **Triage (continuous + backstop).** The hub's
  [`ideas-triage` Action](https://github.com/jwildfire/obot.roadmap/blob/main/.github/workflows/ideas-triage.yml)
  responds to each new post within minutes — confident ideas become issues and the
  thread closes as resolved; unclear ones get questions for @jwildfire in-thread. At
  session kickoff, [`session-inbox`](skills/session-inbox/SKILL.md) sweeps whatever is
  still open since the last watermark ([`scripts/ideas-sweep`](scripts/ideas-sweep))
  and folds it into the kickoff list; wrapups flag captured-but-unpromoted ideas.
- **Promotion.** On approval an idea becomes a Requirement issue via the hub lifecycle,
  linked back to its thread, and the discussion is closed as resolved — never deleted.

## Core workflow (renderer migration)

For each renderer:

1. **Harvest requirements** from upstream wiki pages, settings schema, README, examples, issue history, and test notes.
2. **Create a requirements matrix** mapping every functional requirement to one or more tests.
3. **Establish baseline behavior** using the legacy renderer before refactoring.
4. **Separate pure data logic** from rendering and browser interactions.
5. **Replace Webcharts incrementally** with a modern renderer architecture.
6. **Add automated tests** at unit, integration, browser, visual, and requirements levels.
7. **Document traceability** from requirement to test to implementation PR.

Renderer wiki requirements are harvested into
[safety.viz `requirements/`](https://github.com/jwildfire/safety.viz/tree/HEAD/requirements).
These files are source-backed starting matrices and must be reviewed, de-duplicated, and
mapped to tests before a renderer migration is considered complete. They live next to the
code they specify, so a behavior change and its requirement rows land in one PR.

- [Requirement matrices](https://github.com/jwildfire/safety.viz/tree/HEAD/requirements) ([why they moved](docs/requirements/README.md))
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
