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
*subagent*) are defined in [`docs/terminology.md`](docs/terminology.md), and which tier may
sit in the lead's response path is set by
[`docs/session-framework.md`](docs/session-framework.md).

## Session framework: responsiveness

- The session bookends and every chat reply answer to a responsiveness contract —
  SLAs, the round-trip budget, the delegation rule, first-paint and revision handling,
  and the declared exemptions. [`docs/session-framework.md`](docs/session-framework.md)
  is that contract and the sole authority for it (@jwildfire's live mandate, 2026-08-01).
- Read it before touching any session skill, command file, or briefing template. This
  file deliberately does not restate its clauses, so there is only ever one copy to keep
  current.

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
**Never call the EnterWorktree tool in the obot2 workspace** (@jwildfire, 2026-08-04:
"i really don't want you to prompt me to enter worktrees. just do it."). The workspace
root is not a git repository, so the tool surfaces a permission prompt and then fails
anyway with "current directory is not in a git repository". The scripted commands above
are the only lane — interactive sessions, scripted lanes, and spawned agents alike. Work
the worktree through absolute paths into it rather than switching the session into it,
and never tell a spawned agent or ultracode job to use EnterWorktree here.

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
- Do not start work on an issue that carries no milestone — see [Milestone before work](#milestone-before-work).
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

## Release-candidate PRs: title and body

**Title: `{package} vX.Y.Z-RCn`, and nothing else** — `gsm.safety v1.1.0-RC1`. No summary,
no `Release candidate:` lead, no em-dash tail (@jwildfire, 2026-08-15: *"New rule for
release candidate names: {package} Vx.x.x-RCx. No other summary allowed."*). This
supersedes the earlier same-day rule (title *starts with* package and version, then
describes the release); those titles are legacy and get retitled on their next touch.

`n` counts candidates put in front of him: first is `-RC1`; it increments **only** when
review is re-requested after a `CHANGES_REQUESTED` decision; the **same PR is retitled**,
never replaced, so the review thread survives; it resets per version; and the tag drops
the suffix — the release is `v1.1.0`.

**Body order**: one-sentence exec summary → bulleted links (**demo page and `NEWS.md`, the
`NEWS.md` link mandatory in every RC PR**) → the list of requirements closed, each carrying
its `Closes #N` keyword → details as needed. That is the five-section obot PR body
reordered, not a second template, and the `Closes` keywords must stay in it or issues stop
closing and `obot-merge` refuses the release merge.

**The exec summary is the first line of the body — no banner above it.** The
attested-lane rule goes in an **HTML comment**, placed *below* the sentence, not a
heading above it:

```markdown
{One sentence: what this release lets someone do that they could not do before.}

<!-- Release candidate. Merges only on @jwildfire's explicit approval, via the
     attested lane: scripts/obot-merge <pr> -R <repo> --jeremy-approved '<where/when>'. -->
```

Below, because GitHub hides the comment either way but parsers do not: the dashboard
builds his queue row from the first line that is not a heading or a bullet, and `<!--`
is neither. Sentence first means nothing downstream has to know comments exist.

The `## ⛔ Release candidate — merges only on @jwildfire's approval, via the attested lane`
heading is **retired** (@jwildfire, 2026-08-17: *"I really don't like this header …
shouldn't need that as the first thing on a PR - just add a rule for the relevant agents
and maybe an invisible markdown comment"*). It told the approver a rule about himself, it
took the line the exec summary was given, and it announced a guard already enforced in
code — `obot-merge` refuses a release-role merge without `--jeremy-approved`, and raw
`gh pr merge` is hook-denied.

**The general rule: anything on a surface he reads is written for him.** Agent-to-agent
instructions go in agent-facing places — this file, `docs/`, the skills, or an HTML
comment. See [`docs/rc-framework.md` → Written for him, or written for
us](docs/rc-framework.md#written-for-him-or-written-for-us).

Full rules, the template, and the `-RCn` edge cases:
[`docs/rc-framework.md`](docs/rc-framework.md#what-an-rc-pr-must-carry) and
[`skills/rc-release-notes/SKILL.md`](skills/rc-release-notes/SKILL.md).

## Milestone before work

**No work starts on an issue until a milestone is assigned** (@jwildfire, 2026-08-14).
The milestone belongs to *picking the issue up* — it goes on before the branch, not at
close-out.

- **Selecting work.** An issue with no milestone is not pickable. Assign one first,
  creating the release's milestone if it does not exist yet, or say plainly why the issue
  belongs to no release and pick something else. The `--auto` selection criteria in
  [`skills/session-init/SKILL.md`](skills/session-init/SKILL.md) carry this as an
  eligibility check, and it is the earliest place the rule bites.
- **Both halves are required, not either.** The **milestone groups** the release; the
  **`Closes #N` keyword closes** the issue. `Closes` lines with no milestone ship work no
  release accounts for; a milestone with no `Closes` lines leaves shipped issues open.
- **Every RC PR body names the issues its release ships**, one `Closes #N` line each, even
  when increment PRs already closed them — the RC body is the release's manifest.
- **The milestone records the release that shipped the work**, not the wave that scoped it.
  When an issue slips a release, move its milestone forward at ship time rather than
  leaving the scoping wave's version on it.
- Enforced mechanically by [`scripts/obot-merge`](scripts/obot-merge), which refuses a
  merge whose `Closes` target carries no milestone and a release-role merge whose body
  names no issue. `--no-milestone '<reason>'` and `--no-issues '<reason>'` are the escape
  hatches; each wants a real reason, and neither is a substitute for assigning the
  milestone.

**Why this exists.** safety.viz v1.6.0 (2026-08-14) shipped four delivered issues and
grouped none of them: no `v1.6.0` milestone existed, three of the issues still carried
`v1.2.0` from the wave that scoped them, and the RC PR body carried no `Closes` lines. The
release's own record had to be reconstructed from the diff the same night.

## Running the merge command

Once a merge is approved, type it as **one command, undecorated**:

```bash
obot.agent/scripts/obot-merge <pr#> -R jwildfire/<repo> --squash --delete-branch
```

The obot2 workspace allowlist permits three spellings of the wrapper — `scripts/…`,
`obot.agent/scripts/…`, and the absolute path — and a `Bash(prefix *)` rule matches a
command only when **every** sub-command matches, splitting on `|`, `&&`, `||`, and `;`.
So a `bash` prefix, a `./`, a `cd … &&`, a trailing `; echo "exit=$?"`, or the reflexive
`| tail -20` each cost the match, and the call falls through to the auto-mode classifier
instead. The classifier is not a gate that can be satisfied — it is nondeterministic, and
refuses roughly one call in thirty. Shell redirection (`2>&1`) is not a separator and is
safe; the wrapper prints ten lines, so there is nothing worth piping to `tail` anyway.

A classifier refusal is not a permission decision and not a policy refusal — the merge
policy in [`scripts/policy.json`](scripts/policy.json) is the only thing that decides
whether a merge is allowed. If a merge is refused, re-type the bare command; do not go
looking for a different route.

**Why this exists.** Of 497 `obot-merge` invocations across the session transcripts to
2026-08-17, only 7 were written in a form the allowlist could match — and all 7 were
allowed. Every one of the 17 refusals in that history sits among the 490 that matched
nothing. obot.agent#150 and #158 sat finished, green and unmerged overnight on that coin
flip, and obot.roadmap#217 was refused and then allowed on the byte-identical string three
minutes later. Guarded by
[`scripts/test/merge-invocation.test.mjs`](scripts/test/merge-invocation.test.mjs).

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
  test-evidence page (requirements → tests → screenshots), and API reference —
  **and its `gsm.safety` R widget is delivered or filed as a milestoned hub
  requirement** (@jwildfire, 2026-08-15: "Every renderer gets an R widget";
  the fourth pillar, enforced by gsm.safety's `safety-viz-parity` CI against
  every safety.viz release, with requirement-cited deferrals in that repo's
  `.github/parity-allowlist.yaml`).

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

### An approval-gated action cites the approval, not the requirement

Deleting, merging to a protected surface, and anything an invariant names must name
where @jwildfire said yes — the specific approval, with its date and channel, not the
document that contains it. A requirement is not that document: most are now written by
an agent, and a filed requirement is milestoned, boarded and goal-linked whether the
scope in it came from him or from an agent's own judgement.

```bash
node obot.roadmap/scripts/provenance.mjs resolve <requirement number | D0018.1 | owner/repo#9 review>
```

It prints what was asked, what he said, the channel and the date, or it says nobody has
approved this — which is a complete answer, and means stop and ask. Where an approval
can live on the object being approved, prefer that form: a native GitHub review carries
his identity, the object and a timestamp first-party, with no relay chain to have
provenance about. Chat relay is the fallback for what GitHub cannot hold — config items,
deletions, decisions about surfaces rather than pull requests.

Two things not to do. Do not compose a citation from your own reading of a conversation;
if the decision is real but unrecorded, the fix is a decision artifact. And do not append
"and reviewed by @jwildfire" to an attribution line — that clause sat on 75 of the hub's
113 requirements with no record of a review behind any of them, which is what an
approval field becomes when anyone can type into it (hub#215).
