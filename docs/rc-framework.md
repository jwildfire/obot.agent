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

## Two kinds of PR

| | Increment PR | Release-candidate PR |
|---|---|---|
| Base | integration branch (`dev`, or `main` where there is no `dev`) | release branch (`main`; demo-301's `site`) |
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

1. **Release notes, house style.** Functionality-first and user-facing: what a
   person can now do that they could not do before, and why that matters. One
   bullet per feature, each linking its hub requirement and implementing PRs.
   Process notes compress to a line. The exemplar is
   [safety.viz v1.5.0](https://github.com/jwildfire/safety.viz/releases/tag/v1.5.0)
   — match its altitude, not a commit log. Minor and patch releases are lighter
   but the same shape.
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
4. **A green gate**: CI passing on the head commit; for safety.viz renderers the
   done-gate as well — gallery demo, evidence page, API reference all live.
5. **One line stating the ask**: what decision is being requested, and what
   happens on approval (tag and publish, or merge and hold).

### Repos with no visual surface

obot.agent and other harness repos still owe a demo — the demo is a walkthrough
of the *behaviour* change: before/after transcript excerpts, a screenshot of the
new output, and the exact command to reproduce it. "It's internal tooling" is
not an exemption; if a change cannot be shown, it is not ready to be released.

### Repos where integration *is* the release branch

obot.agent, obot.roadmap and demo-301 have no `dev`. There, the RC is a **draft
GitHub release** — same notes, same demo link, same ask — proposed against the
accumulated `main`, rather than a `dev → main` PR. Publishing stays human
(`releases: {prep: true, publish: false}`).

## Blockers and open questions never become PRs

When a session hits something it cannot decide — an unsigned design, a clinical
judgement call, a policy carve-out, a missing prerequisite — it writes a
**decision artifact** instead of stalling or guessing:

- Self-contained HTML at `obot.roadmap/reports/decisions/{YYYY-MM-DD}-{slug}/index.html`.
- Contents, in order: the situation in three sentences; the options, each with
  what it costs and what it forecloses; **a recommendation, stated plainly**;
  and what unblocks on each choice.
- Linked from the blocked goal's hub issue and surfaced in that night's
  executive summary under *Critical blockers*.
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
