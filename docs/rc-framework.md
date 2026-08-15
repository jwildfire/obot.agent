# Release-candidate framework

**Status:** v1, provisional — written 2026-08-14 from @jwildfire's direction in
that day's goal-review session, ahead of the design pass that hub
[#123](https://github.com/jwildfire/obot.roadmap/issues/123) (release
scaffolding) still owes. Sessions follow this until #123's design supersedes it.

## The rule this exists to serve

> "I want obot to focus on creating release candidates *with associated* demos
> for my review. I don't want to review any other PRs." — @jwildfire, 2026-08-14

@jwildfire reviews exactly two kinds of thing:

1. **Release-candidate (RC) PRs** — each carrying release notes and a demo page.
2. **Decision artifacts** — an HTML page laying out options and a recommendation
   when a session hits a call it cannot make.

Everything else lands without him: increments merge on the standard lane, and
their record is the nightly executive summary, not his inbox.

## Operational vs clinical control

The governing principle behind what reaches his queue (@jwildfire, 2026-08-15,
[decision record](https://github.com/jwildfire/obot.roadmap/discussions/155)):

- **Operational repos** (the obot harness and program surfaces): agents get wide
  latitude to self-improve — proactive, automatic merges to production (`main`),
  fixing issues as they appear, with **periodic (~weekly) releases to `stable`**
  for housekeeping and to keep him fully in the loop.
- **User-facing clinical repos**: he reviews **everything** before it reaches
  prod, and releases are formally documented as soon as they go live.

Which repo is which is a decision he makes, never an agent: the clear cases and
the ambiguous ones are laid out in the
[repo-classification decision artifact](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-15-operational-clinical-classification/),
and the classification is recorded per repo in
[`scripts/policy.json`](../scripts/policy.json) once he decides. The weekly
release trigger is reconciled with the session-model design in
[Q&A #158](https://github.com/jwildfire/obot.roadmap/discussions/158), not here.
**Precondition**: automatic merge-to-prod on an operational repo requires that
repo to have CI running its test suite — a repo with no gate has nothing to make
issues "appear".

## Two kinds of PR

| | Increment PR | Release-candidate PR |
|---|---|---|
| Base | integration branch (`dev`, or `main` where there is no `dev`) | release branch (`main`; obot.agent's `stable`; demo-301's `site`) |
| Reviewer | none — never assign or request @jwildfire | @jwildfire, always |
| Merge lane | standard — `obot-merge <pr> -R <repo>` | attested — `obot-merge <pr> -R <repo> --jeremy-approved '<where/when>'` |
| Body | short: what changed, why, evidence link | the full five sections below |
| Demo | not required | **required** |

Increment PRs are working paper. Keep them small, land them, move on. Do not
mark them ready for review, do not request review, do not ping. If an increment
cannot merge unattended — it touches a carve-out path in
[`scripts/policy.json`](../scripts/policy.json), or its repo is `protected` —
it is a *blocker*, and blockers go to a decision artifact (below), not to his
review queue.

## What an RC PR must carry

An RC is not "the accumulated diff." It is a release proposed for publication,
and it stands or falls on whether he can see what changed without reading code.

1. **Release notes, house style, drafted in `NEWS.md`.** Functionality-first
   and user-facing: what a person can now do that they could not do before, and
   why that matters. One bullet per feature, each linking its hub requirement
   and implementing PRs. Process notes compress to a line. The exemplar is
   [safety.viz v1.5.0](https://github.com/jwildfire/safety.viz/releases/tag/v1.5.0)
   — match its altitude, not a commit log. Minor and patch releases are lighter
   but the same shape. The notes live in the repo's **`NEWS.md`** — the running
   release log, whose current section *is* the notes draft, opening with the
   `**See it move:**` demo link ahead of the feature list — and the tag's
   release body is copied verbatim from that section on approval (@jwildfire,
   2026-08-14). **Every repo keeps its NEWS.md current in `main` at all times**:
   between releases, merged-but-unreleased work accumulates under a
   `vX.Y.Z (Upcoming)` heading, which loses the `(Upcoming)` suffix when the
   release is cut (@jwildfire, 2026-08-15,
   [decision record](https://github.com/jwildfire/obot.roadmap/discussions/155)).
   Shape and
   procedure: [`skills/rc-release-notes/SKILL.md`](../skills/rc-release-notes/SKILL.md).
2. **A demo page — the hard requirement.** A self-contained HTML page published
   under `obot.roadmap/reports/{slug}/` on the hub Pages site, walking each
   update with screenshots or short clips and try-it-yourself steps against the
   live surface. Exemplar: [`reports/sv-v1.5-demo/`](https://jwildfire.github.io/obot.roadmap/reports/sv-v1.5-demo/).
   The deployed URL goes **above the fold** in the PR body and in the release
   notes as a `**See it move:**` line. A PR without a working deployed demo link
   is not an RC and must not be put in front of him.
3. **The five-section obot PR body**: executive summary (with `Closes #X`) →
   roadmap context (goal, requirements delivered) → evidence as HTML links →
   technical briefing → next steps.
4. **A milestone, and a `Closes #N` line per issue the release ships.** The
   milestone groups the release; the keyword closes the issue — **both**, never
   either. Create the release's milestone before the window opens, assign it to
   every issue the release delivers (moving it forward off the wave that scoped
   the issue), and list them all in the RC body even where increment PRs already
   closed them: the RC body is the release's manifest. An issue only partly
   delivered keeps the milestone and stays **open**, with a comment naming what
   remains. See [`AGENTS.md` → Milestone before work](../AGENTS.md#milestone-before-work);
   [`scripts/obot-merge`](../scripts/obot-merge) refuses a release merge that
   names no issue, and any merge whose `Closes` target has no milestone.
5. **A green gate**: CI passing on the head commit; for safety.viz renderers the
   done-gate as well — gallery demo, evidence page, API reference all live, and
   the `gsm.safety` R widget delivered or filed as a milestoned requirement
   (the widget-parity pillar, @jwildfire 2026-08-15).
6. **One line stating the ask**: what decision is being requested, and what
   happens on approval (tag and publish, or merge and hold).

After the release is tagged, the hub requirements it delivered move stage on the
["obot Roadmap" project](https://github.com/users/jwildfire/projects/1) — to
**Released** when the requirement is wholly shipped, and they close only then. A
requirement with open sub-issues stays where it is and gets a comment recording
what this release delivered and what is left. This is part of the release, not
follow-up: v1.6.0 shipped with [obot.roadmap#35](https://github.com/jwildfire/obot.roadmap/issues/35)
still sitting at *Design*.

### Repos with no visual surface

obot.agent and other harness repos still owe a demo — the demo is a walkthrough
of the *behaviour* change: before/after transcript excerpts, a screenshot of the
new output, and the exact command to reproduce it. "It's internal tooling" is
not an exemption; if a change cannot be shown, it is not ready to be released.

### Repos whose integration branch is `main`

obot.agent, obot.roadmap and demo-301 have no `dev` — work lands directly on
`main`. That does not exempt them from the RC-is-a-PR rule:

- **obot.agent** carries a **lagging `stable` branch**, cut at the v0.3.0 commit
  (the R2 shape, @jwildfire 2026-08-15,
  [decision record](https://github.com/jwildfire/obot.roadmap/discussions/155)).
  Work keeps landing on `main`; each release is a **`main → stable` PR** whose
  diff is exactly the release window. The PR takes the RC roles (assignee
  `obotclaw[bot]`, reviewer @jwildfire), merges on the attested lane, and the
  tag lands on `stable`.
- **demo-301** releases by `main → site` PR — `site` is the live Pages branch
  and holds the release role.
- **obot.roadmap** does not cut releases today; if that changes, it adopts the
  same lagging-`stable` shape.

Publishing stays human everywhere (`releases: {prep: true, publish: false}`).
The earlier draft-GitHub-release workaround is retired: a draft release has no
assignee, no reviewer, no review request and no diff — none of what makes an RC
reviewable.

## Blockers and open questions never become PRs

When a session hits something it cannot decide — an unsigned design, a clinical
judgement call, a policy carve-out, a missing prerequisite — it writes a
**decision artifact** instead of stalling or guessing:

- Self-contained HTML at `obot.roadmap/reports/decisions/{YYYY-MM-DD}-{slug}/index.html`.
- **A permanent ID, claimed before the page is written** (@jwildfire, 2026-08-15):
  the artifact is `D0001`, its questions are `D0001.1`, `D0001.2`, … in page order.
  `node scripts/claim_decision_id.mjs <slug> --title "…" --q "A1: …"` in obot.roadmap
  allocates it and `node scripts/stamp_decision_ids.mjs` writes it onto the page. He
  approves by quoting an ID back in chat, so it must be unique across every artifact
  — the artifact's own codes (A1, BL2, M3 …) stay beside it as secondary labels, never
  in place of it, and the ID never replaces the sentence saying what is being decided.
- **A one-line description in the page head**, written with the page:
  `<meta name="description" content="...">` directly after `<title>`, 40–260
  characters. It is what the hub's news feed shows, and therefore what @jwildfire
  decides from before opening anything: say what the artifact contains and why he
  would open it, in plain English, naming things rather than numbering them. Not
  "AI-generated report." — that was the hardcoded feed fallback until 2026-08-15 and
  it is now rejected by name. `node scripts/check_artifact_descriptions.mjs` in
  obot.roadmap fails the deploy without one.
- Contents, in order: the situation in three sentences; the options, each with
  what it costs and what it forecloses; **a recommendation, stated plainly**;
  and what unblocks on each choice.
- Linked from the blocked goal's hub issue and surfaced in that night's
  executive summary under *Critical blockers*.
- **Posted to the hub's [Q&A discussions](https://github.com/jwildfire/obot.roadmap/discussions/categories/q-a)**
  (@jwildfire, 2026-08-14): a *brief* executive summary — the open question, the
  options in a line each, and the recommendation — linking the artifact for the
  full argument, never restating it in markdown. The Q&A thread is the *place*:
  @jwildfire documents his decision there. The thread is linked from the
  [decisions index](https://github.com/jwildfire/obot.roadmap/blob/main/reports/decisions/README.md)
  and from the roadmap page's Todo section, which leads with both queues —
  RCs needing review and decisions needed.
- One artifact per decision. Bundling three questions into one page defeats it.

**Escalation:** if every active goal in
[`goals/registry.json`](../goals/registry.json) is blocked at once, ping
@jwildfire directly rather than waiting for the morning read — that is the one
case where the nightly summary is too slow.

## The nightly executive summary

One artifact per day at `obot.roadmap/reports/exec/{YYYY-MM-DD}/index.html`,
covering the previous day's work, ordered by what needs him:

1. **RCs awaiting review** — top of page, each with its demo link.
2. **Critical blockers** — each linking its decision artifact.
3. What shipped, per active goal.
4. What runs next, per active goal.
5. Run cost.

The machinery for scheduling these runs is hub
[#122](https://github.com/jwildfire/obot.roadmap/issues/122); the release
tracking behind the summary is [#123](https://github.com/jwildfire/obot.roadmap/issues/123).

## The per-session wrapup uses the same two headlines

Until the nightly summary exists, the session wrapup *is* the delivery vehicle,
so it carries the same ordering: every wrapup output — checkpoint page, diary
entry, `--auto` morning digest, closing chat response — opens with
**🚦 Release candidates needing review**, then **🧭 Decisions needed**, each a
bulleted list of one-line items linking their PR or draft release and their hub
demo or decision artifact. Both lists are cumulative: an RC he has not reviewed
and a decision he has not made stay at the top of every subsequent wrapup until
he closes them. The composition rules live in
[`skills/session-wrapup/SKILL.md`](../skills/session-wrapup/SKILL.md#the-two-headlines).

---
This document was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
