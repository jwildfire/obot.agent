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

## Written for him, or written for us

**Anything written on a surface he reads is written for him.** RC PR bodies,
decision artifacts, demo pages, dashboard rows, release notes, the nightly
summary — every word on them is addressed to @jwildfire, and nothing else gets
to sit there.

Agent-to-agent instructions go in agent-facing places instead:
[`AGENTS.md`](../AGENTS.md), the docs in this directory, the
[skills](../skills/), or an **HTML comment in the body** — invisible to him,
present for the agent reading the PR itself.

The test is one question: *would he do anything differently for having read
this?* If it is a rule about how agents behave, the answer is no.

- **A rule about him is not for him.** "Merges only on @jwildfire's approval"
  tells the approver that he is the approver.
- **A guard that works does not announce itself.** The attested lane is enforced
  in code — [`scripts/obot-merge`](../scripts/obot-merge) refuses a release-role
  merge without `--jeremy-approved`, and raw `gh pr merge` is hook-denied. A
  sentence in a PR body enforces nothing; it just occupies the line above the
  fold.
- **Our register is not his reading.** Worker ids, lane names, attestation
  vocabulary, audit bookkeeping: real, necessary, and ours. This is the same
  fault as a dashboard page that reads like an audit log.

**Decided 2026-08-17** (@jwildfire: *"just add a rule for the relevant agents and
maybe an invisible markdown comment"*), on the `⛔ Release candidate` heading that
used to open every RC body; the rule generalises past that one banner. Anything
that parses these bodies must skip HTML comments — see the RC body template below.

## Operational vs clinical control

The governing principle behind what reaches his queue (@jwildfire, 2026-08-15,
[decision record](https://github.com/jwildfire/obot.roadmap/discussions/155)):

- **Operational repos** (the obot harness and program surfaces): agents get wide
  latitude to self-improve — proactive, automatic merges to production (`main`),
  fixing issues as they appear, with **periodic (~weekly) releases to `stable`**
  for housekeeping and to keep him fully in the loop.
- **User-facing clinical repos**: he reviews **everything** before it reaches
  prod, and releases are formally documented as soon as they go live.

Which repo is which is a decision he makes, never an agent. **Decided 2026-08-15**
([artifact](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-15-operational-clinical-classification/),
answer in [Q&A #160](https://github.com/jwildfire/obot.roadmap/discussions/160)) and
recorded as a `class` field per repo in [`scripts/policy.json`](../scripts/policy.json):
obot.agent and obot.roadmap **operational**; safety.viz, gsm.safety, open.csr,
open.gismo and demo-301 **clinical**. demo-301 is his override of the recommendation,
with a recorded reclassification condition: it is where he reviews app functionality
today, and converts to operational if it becomes a simple template with no
user-facing changes. The safety-histogram fork was retired the same day (functionality
lives on as safety.viz's histogram module). The weekly
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
| Merge lane | standard — `obot.agent/scripts/obot-merge <pr> -R <repo>` | attested — `obot.agent/scripts/obot-merge <pr> -R <repo> --jeremy-approved '<where/when>'` |
| Body | short: what changed, why, evidence link | the full five sections below |
| Demo | not required | **required** |

Increment PRs are working paper. Keep them small, land them, move on. **Open
them non-draft** — `obot-merge` refuses drafts, and a draft on GitHub means
"unfinished", which an increment is not — and keep him out of the queue the way
that actually works: never assign him, never request his review, never ping. If
an increment cannot merge because its repo is `protected`, it is a *blocker*,
and blockers go to a decision artifact (below), not to his review queue.

An increment that touches a **guardrail path** in
[`scripts/policy.json`](../scripts/policy.json)'s carve-out is a narrower case,
and it is not automatically a blocker. In an operational repo, on the
integration branch, if the change implements something he has already decided,
it merges with `obot-merge … --decision '<the decision, and what it decided>'`
— the audit comment records that he did not review the merge and names what he
did decide. If there is no such decision, that is what a decision artifact is
for. What never happens is the increment appearing in his review queue: he
reviews release candidates and decision artifacts, and nothing else
(@jwildfire, 2026-08-15: *"this isnt an RC or an artifact"*).

Check the decision before you cite it. `--decision` takes a free-text string and
`obot-merge` validates the *lane* rather than the citation — it never opens the
registry, so `--decision 'D0005, he approved it'` and `--decision 'some earlier
decision'` are equally acceptable to the tool, and its own test suite passes both.
The citation is therefore worth exactly what the person composing it checked, which
is the failure mode hub#215 exists to close. So resolve it first:

```bash
node obot.roadmap/scripts/provenance.mjs resolve D0018.1
```

That prints what was asked, what he said, the channel and the date — the four facts
the audit comment should be quoting — or it refuses, which means there is no such
decision and the answer is a decision artifact rather than a better sentence. Citing
a decision that does not resolve is worse than merging without one: it puts his name
on the merge, in a comment that stays.

## What an RC PR must carry

An RC is not "the accumulated diff." It is a release proposed for publication,
and it stands or falls on whether he can see what changed without reading code.

### The title

**`{package} vX.Y.Z-RCn`, and nothing else** — `gsm.safety v1.1.0-RC1`. No summary, no
`Release candidate:` lead, no em-dash tail (@jwildfire, 2026-08-15: *"New rule for release
candidate names: {package} Vx.x.x-RCx. No other summary allowed."*). This supersedes his
own earlier rule the same day, under which the title *started* with the package and
version and then described the release; titles written to that shape are legacy and get
retitled on their next touch.

The description does not disappear, it moves: it becomes the one-sentence executive
summary that opens the body (below), which is where the Operations Dashboard now reads
the second line of an RC row from.

#### The `-RCn` counter

`n` counts **candidates put in front of @jwildfire**, not PR objects and not pushes.

1. **The first candidate for a version is `-RC1`.** Always — there is no unnumbered RC.
2. **Increment when review is re-requested after a `CHANGES_REQUESTED` decision**, and
   only then. Commits pushed before he has reviewed do not move the counter; a round of
   review that ends in approval does not either. One increment per review round.
3. **Retitle the same PR — never open a new one.** The review thread is the record: his
   comments, the review decisions, the Development links and the CI history all live on
   it, and he reviews `-RC2` by reading what he asked for on `-RC1`. A replacement PR
   throws that away. Retitling costs one `gh pr edit --title`.
   - A **mechanical** re-open is not a re-cut and does not move the counter — e.g.
     open.gismo #9 → #10 (2026-08-15), closed 33 seconds in and reopened under the bot so
     @jwildfire could hold the reviewer role. #10 is still `-RC1`.
4. **The counter resets per version**: `v1.1.0-RC1`, `v1.1.0-RC2`, then `v1.2.0-RC1`.
5. **The tag drops the suffix.** The release is `v1.1.0`. `-RCn` never appears on a tag, a
   release title, a release body, or a `NEWS.md` heading — it names a *candidate*, and
   what ships is the release.

`scripts/obot-merge` **warns** on a release-role merge whose title is not in this shape;
it does not refuse. The refusals in that script protect the release's record — an issue
with no milestone, a release naming no issue — which is wrong-and-unrecoverable once the
merge lands. A title is cosmetic and fixable afterwards in one command, and obot-merge
runs on the attested lane *after* he has approved: blocking there would stall an approved
release at its last step over a string.

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
3. **The RC body, in this order** (@jwildfire, 2026-08-15: *"1 sentence exec summary
   then bulleted list with relevant links to demo page and news.md. then a list of all
   requirements closed in the PR. Then get in to the details as needed."*). This is the
   five-section obot PR body reordered and tightened, not a second template — the
   sections are the same, the links come above the fold, and the `Closes` keywords now
   live in the requirements list:

   ```markdown
   {One sentence: what this release lets someone do that they could not do before.}

   <!-- Release candidate. Merges only on @jwildfire's explicit approval, via the
        attested lane: scripts/obot-merge <pr> -R <repo> --jeremy-approved '<where/when>'.
        Agent-facing note — it is a comment because he does not need to be told a
        rule about himself. See obot.agent docs/rc-framework.md. -->


   - **See it move:** [annotated demo]({deployed hub URL})
   - **Release notes:** [NEWS.md]({repo}/blob/{head branch}/NEWS.md) — the `vX.Y.Z
     (Upcoming)` section, which publishes verbatim as the release body
   - {any other link he needs before deciding}

   ### Requirements this release closes
   - Closes #12 — {what it delivered}
   - Closes #14 — {what it delivered}

   **The ask:** {the decision, and what happens on approval}

   ### Evidence
   ### Technical briefing
   ### Next steps
   ```

   - **The one sentence is the first visible line — nothing goes above it.** No banner,
     no status heading, no "⛔ Release candidate" lead. That heading was the shape until
     2026-08-17, when @jwildfire cut it: *"I really don't like this header … shouldn't
     need that as the first thing on a PR - just add a rule for the relevant agents and
     maybe an invisible markdown comment."* It told him a rule about himself, it spent
     the position the exec summary was given, and it announced a guard that is already
     enforced in code — `obot-merge` refuses a release-role merge without
     `--jeremy-approved`, and raw merges are hook-denied. The rule lives here and
     in the HTML comment; see [Written for him, or written for us](#written-for-him-or-written-for-us).
   - **The comment goes *below* the sentence, not above it.** GitHub hides it either way,
     so the placement is not about him — it is about everything that reads these bodies.
     The Operations Dashboard builds his queue row from the first line that is not a
     heading or a bullet, and `<!--` is neither, so a leading comment becomes the row on
     his phone. Putting the sentence first means no reader has to know about comments at
     all: a naive parser, a future consumer and a person skimming raw markdown all get the
     release sentence. The dashboard strips comments wherever they appear as well — both,
     because a parser fix only protects the readers we control, and it ships on its own
     schedule. On 2026-08-17 the running dashboard held the old parser in memory with a
     twenty-minute cache standing between a leading comment and his screen; the ordering
     rule is what makes that race impossible rather than merely survived.
   - **The one sentence is the row on his phone.** The Operations Dashboard shows it
     under the title, truncated near 325px on a 390px screen — front-load it, and do not
     open with "This PR".
   - **The `NEWS.md` link is mandatory in every RC PR**, no exceptions. Link the **file
     on the RC's head branch**, not an anchor: sections are newest-first so the file
     opens on the right one, and the `#...-upcoming` anchor breaks at tag time when the
     suffix drops.
   - **The requirements list carries the `Closes #N` keywords** — it does not replace
     them. Prose like "closes the metrics requirement" does not close anything, and
     `obot-merge` refuses a release merge whose body names no issue (item 4).
   - Everything under **Evidence** onward is "details as needed": as deep as the release
     warrants, never above the requirements list.
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
   happens on approval (tag and publish, or merge and hold). It sits directly under
   the requirements list, above the details — see the template in item 3.

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
