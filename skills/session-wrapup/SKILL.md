---
name: session-wrapup
description: "Wrap up a working session by folding the session scratchpad — the as-you-go record kept by session-update, session-note, and the sibling heartbeat — into a checkpoint draft put in front of @jwildfire in under a minute, while one background sibling verifies that record against GitHub during his review; corrections fold in before anything is applied, then the agreed changes land: issue updates, stage moves, scaffold/memory updates, and the diary entry. Use at the end of any substantive session — 'wrap up', 'session wrapup', 'close out the session'. With --auto, skip the review checkpoint and post the wrapup directly under standing grants (@jwildfire, 2026-07-24). Do NOT use mid-session or for empty sessions."
argument-hint: "Optional: session focus or extra context — carried in the verifier's briefing, not investigated inline"
---

# Session Wrapup

Close out a working session so nothing lives only in a conversation. The wrapup is
done when five things are true:

1. **Clean roadmap** — every issue touched this session is accurate (body, stage,
   links) and the board reflects reality.
2. **Everything captured** — every open todo surfaced during the session has a
   durable home (issue, diary loose end, or memory), not just chat history.
3. **Scaffold reviewed** — friction and repetition from the session are turned into
   applied or proposed scaffold updates (skills, AGENTS.md, memory, config).
4. **Summary posted** — the day's diary entry is committed, the site deploy is
   green, and the deployed URL is shared for review.
5. **Next session prepped** — every agreed next-session priority links a hub
   requirement; any priority without one has its **Business Requirement +
   Overview** drafted and filed before the session ends.

**The lean contract** (@jwildfire, 2026-07-12; superseding the collection-sweep
design): **the scratchpad is the inventory.** During the session,
[`session-update`](../session-update/SKILL.md) /
[`session-note`](../session-note/SKILL.md) and the scratchpad heartbeat (every
[`session-spawn`](../session-spawn/SKILL.md) briefing requires tagged key-event
lines and a close-out entry; a workspace Stop hook nudges any session that goes
quiet — see `session-update`)
keep `.claude/session-notes/{YYYY-MM-DD}.md` current. The wrapup **folds that
record and verifies it** with one background sibling — it does not re-derive the
day from transcript-mining subagents and per-repo sweeps. A thin scratchpad is a
during-session note-taking failure to fix (tighten the heartbeat, log as you
go), not a reason for a heavier wrapup.

**Two clocks** (hub #148 D1) — they are measured separately and neither is allowed
to hide behind the other:

- **Time-to-first-visible-output: under 1 minute.** The checkpoint draft is in
  front of @jwildfire inside the bar, produced from the scratchpad alone. This is
  the binding SLA; verification runs beside it, not before it.
- **Time-to-fully-closed: an honest, separate budget**, bounded by the deploy
  floor — the hub-site deploy-to-green median is **157s over 12 runs**, so a fully
  closed wrapup can never beat that, and pretending otherwise just moves the wait
  somewhere invisible. Report both numbers, not a blended one.

The starting point being fixed is measured, not felt: the **2026-07-30 `--auto`
wrapup took ~28 minutes**. This bookend runs under the responsiveness contract in
[`docs/session-framework.md`](../../docs/session-framework.md).

The routine is **interactive** (@jwildfire's call, 2026-07-09): draft and present
first, discuss, and only after the discussion apply changes. Standing grants cover
the mechanics of the apply phase; they do not skip the discussion.

This codifies diary design decision D2 (per-session cadence — see
[`diary/README.md`](../../../obot.roadmap/diary/README.md)) and extends it from "write the entry"
to the full closing routine.

## When to Use

- The end of any substantive working session, before signing off.
- @jwildfire asks to "wrap up", "close out", or "do the session wrapup".

**Do not invoke** mid-session (the summary would be premature — if in doubt, ask
whether the session is over) or after sessions with no real activity (never write
filler diary entries).

## Procedure

The shape is **ack + delegate** (step 0) → **draft and show** (steps 1–3, inside
the under-a-minute bar; the checkpoint *is* the discussion) → **fold corrections**
(step 4) → **collect and apply** (steps 5–8) → **post** (step 9) → **exit**
(step 10). Nothing before the checkpoint edits issues, moves stages, posts, or
writes memory.

### 0. Ack and spawn the verifier — in one message

The **first output of the wrapup**, before any reading beyond today's scratchpad:
one line confirming the wrapup started, naming the sibling
`👯🤖 {date} wrapup-verify` and what it is checking, and saying the draft is next.
Then spawn it and move straight on to step 1 — never wait on it.

Brief the sibling from
[`templates/delta-sweep-briefing.md`](../../templates/delta-sweep-briefing.md),
which layers on
[`templates/sibling-briefing.md`](../../templates/sibling-briefing.md) and is the
single home for the `gh` traps — the silent 100-result cap on `gh search` is
exactly the error class this sibling exists to catch, so it must run with the
traps in hand. In the wrapup-verify variant its corrections land in
`{workspace}/.claude/session-notes/{YYYY-MM-DD}-wrapup-verify.md`, its heartbeat
lines are inserted under the scratchpad's `## Session log` heading with a shelled
`$(date +%H:%M)`, and it ends with a terminal `result:` line. Any free-text
argument to `/session-wrapup` is carried in the briefing as recon — it is never
investigated inline.

Fan its work into **three independent jobs** (hub #148 D3), all in the sibling,
none in the lead:

- **(a) Delta verify** — every scratchpad claim corresponds to real GitHub state
  (a "PR posted" line to a real PR, a "merged" claim to a merged PR), plus
  **strays**: GitHub activity in the session window with no scratchpad line.
- **(b) Local git, scoped** — `git status` and unpushed commits in **only** the
  repos and worktrees the scratchpad names as touched; unpushed work is a loose
  end, not a completion. Never a sweep of every clone.
- **(c) Roadmap hygiene recon** — the step 5 checklist run read-only, returning a
  **proposed fix list** the lead applies, plus the still-open Ideas listing.

**Transcripts stay the exception.** Mine a session transcript
(`~/.claude/projects/…/{sessionId}.jsonl`) only when the fold surfaces a **known
gap** — a sibling job that ran but left no scratchpad lines, activity nothing
accounts for. When justified, it is a **fourth job for the same sibling**, never a
second blocking subagent in the lead. Name the gap in the wrapup summary either
way.

### 1. Draft from the scratchpad alone

The scratchpad **is** the as-you-go record; the draft does not wait on
verification. Read today's `.claude/session-notes/{YYYY-MM-DD}.md` in full — the
`## Overview` check-state (what the kickoff list says got done), unchecked
`## Todo` items, `## Notes`, `## Scaffold`, and the `## Session log` including
every sibling (`👯🤖`) and ultracode (`⚡️🤖`) line — in **one batched read**
together with the previous diary entry for format reference. One tool block, not
sequential reads.

**Pre-compose deterministically** (hub #148 D4) so the model edits prose rather
than deriving structure:

- The **merged / opened / closed / advanced** grouping, with links, comes
  mechanically from the scratchpad plus the warm sweep cache.
- The **session-report line** and the scratchpad **check-offs** are likewise
  mechanical.
- The **scaffold changes** are the scratchpad's `## Scaffold` section carried
  verbatim — [`session-scaffold`](../session-scaffold/SKILL.md) already built that
  list as the friction happened, so nothing is re-derived here.
- The **next-session priorities** are drafted here from the same scratchpad alone:
  unchecked `## Todo` items and uncompleted `## Overview` lines, carried items
  marked as carried.
- The model writes only the **lead paragraph and the section prose**.

The scaffold and next-session sections are **required to be in the checkpoint draft**
(step 3 shows the entry in publish form), so they are composed here, from the
scratchpad, and only *extended* after the checkpoint — the session sweep for what
the scaffold list missed is step 6, and the traceability pass that links a hub
requirement to every priority is step 7. Nothing in this step reads GitHub or
files anything.

Output is bulleted lists, not prose paragraphs, everywhere but the lead.

### 2. Persist the draft to disk — before rendering

Write the composed entry to
`{workspace}/.claude/session-notes/{YYYY-MM-DD}-diary-draft.md` (suffix `-2`,
`-3`, … for later sessions the same day, mirroring the diary file convention),
then **render the review page from that file** (hub #148 comment). A session that
dies after the checkpoint loses nothing. This is the same path the `--auto`
failure lane already writes to, so the two agree by construction.

### 3. Checkpoint — the draft post, reviewed in Chrome

The checkpoint is **a draft of the wrapup post presented for review**
(@jwildfire's format, 2026-07-14, superseding the three-question
AskUserQuestion checkpoint — "the formatting on the Q&A is hard to follow"):

1. **The full diary entry draft** (step 9 format) — accomplishments, scaffold
   changes, and next-session priorities all visible in the form they will actually
   publish. Add a short aside listing what posts alongside the entry (changelog
   entry, session report) and what was already applied under standing grants
   before the draft.
2. **Render it as a local HTML review page and open it in Chrome** —
   @jwildfire reviews in Chrome, not the CLI. The page shows the entry styled
   as it will publish, with a comment box and two buttons —
   `✅ Approve & post` / `✏️ Request changes` — wired to a one-shot localhost
   listener so the click (with comments) reaches the session directly; a chat
   reply works as a fallback. Nothing posts until the decision arrives.
3. **Verification banner** — the page carries a load-bearing line reading
   `👯🤖 wrapup-verify still running` or `👯🤖 wrapup-verify landed at HH:MM`
   (shelled — `$(date +%H:%M)`, never modeled). A
   provisional draft must say it is provisional; the banner is never dropped for
   tidiness.
4. **Comments are the discussion**: fold them in — including any new work they
   direct, which then belongs in the entry — re-render, and re-present until
   approved. An approval is the go-ahead for the apply phase (Approval
   Convention satisfied); the diary entry is then posted under the
   standard-update grant.

**The under-a-minute clock stops here** — at first paint of this page, not at the
last revision.

**Timing ledger** — at first paint here, and again at step 9, append one JSON line
per step to `.claude/session-hub/cache/init-timings.jsonl` with `"bookend":"wrapup"`,
per the schema in the [responsiveness
contract](../../docs/session-framework.md#the-timing-ledger). Shell the timestamps.
The ledger is local telemetry — **never commit it**.

Anything beyond standing grants that the sweep surfaced (deletions, closing
unverified work, upstream PRs) still needs its own explicit ask — raise it in
the review aside or separately, never bury it in the draft.

If @jwildfire is unavailable (unattended background run, no decision), stop
here and surface `needs input:` with the full draft — never post the diary or
edit issues without the review. This rule is for the *default* interactive
wrapup; a wrapup invoked with `--auto` posts without the checkpoint instead
(see the [Unattended variant](#unattended---auto-variant)).

### 4. Fold the verifier's corrections in — before APPLY

Read `{workspace}/.claude/session-notes/{YYYY-MM-DD}-wrapup-verify.md` and state
the deltas in chat as a short bulleted revision — `Since the draft: …` — then
re-render the review page if the entry text changed.

- **Nothing is applied before the corrections land**, or before the sibling is
  explicitly declared timed out.
- If it **is** declared timed out, say so in the closing response *and* in the
  entry — an unverified wrapup is allowed, an unverified wrapup that reads as
  verified is not.
- A `no changes` line from the verifier is a **valid landing and must be stated**,
  never silently assumed — a silently-skipped verification must be detectable.

### 5. Roadmap hygiene — apply the fix list

The checklist below is **run as recon by the verifier sibling** (step 0 job c) and
arrives as a proposed-fix list; the lead applies it rather than re-deriving it.
For **each issue or PR the inventory says was touched** (not the whole tracker):

- **Body accurate?** Re-read the live body (`gh issue view` — Draft Sync
  Convention); flag it if the session changed scope, design, or status.
  Requirement issues must carry the five template sections (see
  [Creating Requirement issues](../../../obot.roadmap/AGENTS.md)).
- **Stage correct?** Flag touched items whose board stage no longer matches
  reality (stages come free with the delta digest). Respect done-gates
  (e.g. a renderer requirement is not Released until its site entry deploys).
- **Links intact?** PRs carry `Closes #X` lines and Development-sidebar links;
  sub-issues are attached to their parent (`sub-issue-linking` skill).
- **Metadata set?** Milestone (lowercase `YYYYqN` or `backlog`) and topic labels.
- **Releases tied?** Any release published this session lists its hub
  requirement(s) in the release notes — a `Requirements delivered:` line placed
  before the closing attribution rule. Retro-add via the releases API
  (`gh api -X PATCH repos/{owner}/{repo}/releases/{id}`) when missing.
- **Ideas promoted?** The sibling lists still-open Ideas discussions
  (`gh api graphql` on the hub's Ideas category, states `OPEN`, excluding the
  pinned explainer #47) and each is noted as "captured, not yet promoted" — these
  are ideas the `ideas-triage` Action and `session-inbox` haven't landed on the
  roadmap yet (@jwildfire, 2026-07-24). Surface the list; don't force-promote.

Then sweep the scratchpad and conversation for **uncaptured todos**: promises
made, "we should…" moments, blockers hit, review requests, deferred decisions.
Propose a durable home for each — a Requirement (`requirement-drafting`), a
sub-issue (`requirement-tasks`), an edit/comment on an existing issue, or the
diary's "Next session" / "🙋 ToDo" sections (step 9). Standing grants make the
fixes mechanically no-approval-needed, but they are applied in step 8 — after
the checkpoint. Anything involving deleting or closing what isn't verifiably
done needs explicit approval: raise it at the checkpoint, never assume it.

**Blockers and risks get issues, not just prose** (@jwildfire, 2026-07-29). A risk
named only in a diary entry is a risk nobody is tracking — the entry scrolls off
the news page and the concern goes with it. So for every item heading into the
entry's `## Blockers / risks` section, decide: is it **actionable** — is there
something a future session or @jwildfire could actually do about it? If yes, it
gets a tracking issue. Purely descriptive context (a constraint that simply *is*,
with no action available) stays prose.

File them **as obotclaw**, in the repo that owns the fix (the hub for
product/roadmap concerns, `obot.agent` for harness and scaffold ones), and open
each body with a provenance line naming where it came from — so the issue carries
its own history:

> Filed from the **blockers and risks** identified in session 😺🤖 {date} (job
> {id}) — the wrapup files actionable risks rather than leaving them in a diary
> entry. Session record: [diary {date}]({deployed diary URL}).

Write the body as the risk, not the anecdote. **Every documented risk carries a
nested `## Proposed mitigation` section** (@jwildfire, 2026-07-29) — a risk
without one is a complaint, and it puts the burden of inventing the fix on
whoever picks the issue up cold. So each body is two halves:

- **`## Risk`** — what happened, and why it matters. Concrete: the mechanism, not
  the vibe.
- **`## Proposed mitigation`** — two to four numbered candidate fixes, each a real
  option someone could choose, ending with a one-line **recommendation** naming
  which to take and why. Where a fix is cheap and a structural change is not, say
  which is which; where the honest answer is "accept it and revisit at X", that is
  a legitimate option to list.

Board each new hub issue (normally `Backlog`) and give it a milestone. Then **link
the issue from the entry's blocker bullet**, so the diary points at the tracker
rather than replacing it. **Composing the full Risk + Proposed mitigation bodies
happens after the checkpoint**, in the apply phase (step 8): the checkpoint draft
shows the blocker bullets with an `issue to file` marker rather than waiting on
composed bodies.

### 6. Scaffold review — extend the drafted list

The candidate list is already in the checkpoint draft, carried verbatim from the
scratchpad's `## Scaffold` section in step 1 — the list
[`session-scaffold`](../session-scaffold/SKILL.md) built as friction happened. Add
the sibling's review to it, then check the session for anything both missed:

- **Repeatable pattern** executed by hand two or more times, or an existing skill
  that gave stale/wrong guidance → a new skill or a skill update. Hub-process
  skills live in this repo (symlinked from the workspace `.claude/skills/`);
  shared gsm conventions go upstream as a `gsm.agent` PR.
- **Convention drift** — a convention changed or was granted in-session →
  an `AGENTS.md` / workspace `CLAUDE.md` update so the next session starts
  current.
- **Memory** — durable facts, preferences, and feedback → memory writes or
  updates.
- **Config friction** — repeated permission prompts, broken symlinks, stale
  merged worktrees, heartbeat nudges that misfired → note what a fix would be;
  nothing destructive without approval.

### 7. Next-session tasks — make them traceable, queue the filings

Step 1 drafted this list from the scratchpad and the checkpoint showed it; here it
is made traceable against the verified record — link the issue/PR each item
advances, propose an issue where substantial work has none, and fold in anything
the checkpoint discussion added. The agreed list lands in the diary's
**"Next session: loose ends"**
section, the scratchpad `## Overview` check-state, and the `next-session-todo`
memory (step 8) — the hand-off [`session-init`](../session-init/SKILL.md) reads
back.

**The hand-off must be self-contained (2026-08-04):** the `## Overview` this
wrapup leaves behind carries the complete ranked list — full one-line items
with links, groups, and check-state — in the **current day's** scratchpad,
never a pointer to an earlier day's file ("see YYYY-MM-DD.md"). A session that
spans days copies the list forward into today's file as part of step 8. Init
reads ONE file; the 2026-08-04 init paid a round trip chasing a two-file
pointer chain.

**Roadmap prep — obot.agent orchestration job (1), roadmap-standards enforcement:**
every priority on the drafted list must link a hub requirement. **The obligation is
unchanged; only its position relative to the checkpoint moves** (hub #148 D6). A
priority without a requirement **no longer blocks the checkpoint**:

- Draft the requirement's **Business Requirement + Overview** sections (via
  `requirement-drafting`; scope questions to @jwildfire are welcome —
  AskUserQuestion).
- Mark the item `requirement to file` in the checkpoint draft.
- **File it in the apply phase (step 8)** — or hand it to the next session's queue
  — rather than before the checkpoint.
- **Record the queued filing in the entry** so nothing drops.

Board-add every new requirement with a Status (normally `Requirement Gathering`)
and link existing implementation issues as sub-issues at filing time
(`sub-issue-linking`; note the one-parent-per-issue constraint). Later lifecycle
sections (Data Requirement, Design, Tasks) stay stubbed for their own stages.

### 8. Apply the agreed changes

- Issue-body edits, stage moves, link and metadata fixes from step 5, as agreed.
- New issues/sub-issues and issue comments that got homes in the discussion,
  including the **composed Risk + Proposed mitigation bodies** deferred from
  step 5.
- The **queued requirement filings** from step 7 (or their explicit hand-off to
  the next session's queue).
- Scaffold updates from step 6 that were approved or fall under standing grants;
  memory writes, including updating the `next-session-todo` memory to the agreed
  step-7 list.
- Check captured scratchpad items off (`- [x]`) — never delete them or the file.

### 9. Draft and post the session summary

- **File**: one post per session (@jwildfire, 2026-07-09). The day's first
  session is `diary/YYYY-MM-DD.md`; each later session gets its **own file**
  `diary/YYYY-MM-DD-N.md` (N = 2, 3, …) with the H1
  `# Daily diary: YYYY-MM-DD — Session N`. Never append a second session to an
  existing entry — `render_diary.mjs` gives every session file its own page and
  news-index line.
- **Format** (match recent entries; the diary README and the latest few entries
  are the exemplars): lead `<span class="meta">…</span>` story paragraph, then
  `## Work completed` (from the step 1 inventory, grouped by lane),
  `## PRs / issues touched` (merged / opened / closed / advanced, with links),
  `## Blockers / risks` (each actionable item linking the issue filed for it in
  step 8), `## Next session: loose ends` (from step 7, as agreed),
  `## 🙋 ToDo` (items needing @jwildfire). The scratchpad `## Notes` lines are
  raw material for the entry, not verbatim copy.
- **Changelog**: if the session changed what `roadmap.html` shows (stage moves,
  new requirements), append a `site/roadmap-changelog.json` entry with the
  semver bump rules in `AGENTS.md`.
- **Session report** (design #24, D2): render the frozen operational record and
  place it beside the entry —

  ```bash
  node obot.agent/tools/session-hub/session-hub.mjs --report   # from the workspace root
  ```

  Output lands at `obot.roadmap/reports/sessions/{slug}.html` (slug mirrors the
  diary file). Add one line to the entry directly under the `<span class="meta">`
  paragraph: `📊 [Session report](../reports/sessions/{slug}.html)`. The report
  commits together with the diary entry. **The render runs after the checkpoint**
  — it freezes the step-8 check-states anyway, so it has no business on the
  pre-checkpoint path (hub #148 D6). The analytics/status refresh and the
  open-Ideas listing move off that path with it.
- **Refresh analytics usage data**: regenerate the Cost data behind
  [the Analytics page](https://jwildfire.github.io/obot.roadmap/analytics/index.html) —

  ```bash
  python3 obot.roadmap/scripts/build_usage_data.py   # writes site/usage/usage.json
  ```

  The source is this machine's local transcripts, so the site deploy **cannot**
  rebuild this data itself — it re-renders whatever `usage.json` was last
  committed, and the wrapup is the heartbeat that keeps it current
  (@jwildfire, 2026-07-29). Commit the refreshed file together with the diary
  entry (standard-update grant). Like the report render, this is a
  post-checkpoint step (hub #148 D6).
- **Post**: commit directly to `main` and push (standard-update grant). The site
  deploy triggers on `diary/**` pushes.
- **Refresh package status**: that same deploy re-renders
  [the Status page](https://jwildfire.github.io/obot.roadmap/status.html) from the
  live GitHub API, so posting the entry brings the dashboard current — no local R
  needed. If a session ends without any `obot.roadmap` commit, trigger it directly:

  ```bash
  gh workflow run deploy-site.yml -R jwildfire/obot.roadmap
  ```
- **Verify the deploy — asynchronously; it does not block the lead** (hub #148
  D5). Push, share the deployed URL, and verify off the critical path: start
  `gh run list -R jwildfire/obot.roadmap --workflow=deploy-site.yml --limit 1` plus
  its watch **in the background**, or hand the watch to the verify sibling. The
  failure lane must be **durable**: on a red run — or one that fell back to the
  "temporarily unavailable" placeholder, since the dashboard steps are
  `continue-on-error` — append a `## Deploy failure` line to the scratchpad naming
  the run URL and end the session with `needs input:`. **A posted-but-undeployed
  entry is not posted** — that rule is unchanged; it is now a condition confirmed
  before close-out rather than a blocking watch loop.
- **Share the deployed URL** (https://jwildfire.github.io/obot.roadmap/ diary page)
  — @jwildfire reviews in Chrome on the deployed site, not from a local file.
- **Append the closing timing-ledger line** for this bookend (schema and path in
  step 3), so the wrapup SLA stays a checkable fact rather than a vibe.

### 10. Exit checklist

Confirm, and state in the closing response:

- [ ] Scratchpad folded — every line verified, captured, and checked off; gaps
      (missing sibling logs, stray GitHub activity) named.
- [ ] Checkpoint draft persisted to disk before rendering.
- [ ] Checkpoint held — changes applied only after the step 3 discussion.
- [ ] Verifier corrections folded in before apply (or timeout stated).
- [ ] Board stages match reality for every touched issue; bodies synced.
- [ ] No todo exists only in conversation — each has an issue, diary line, or
      memory entry.
- [ ] Scaffold updates applied or proposed; memory current.
- [ ] Session report rendered and linked from the diary entry.
- [ ] Next-session list recorded (diary + scratchpad + memory); queued
      requirement filings named.
- [ ] Diary entry deployed (workflow green) and the deployed URL shared.
- [ ] Timing ledger line appended for this bookend.

## Unattended (`--auto`) variant

`/session-wrapup --auto` posts the wrapup **without @jwildfire's review**
(his directive, 2026-07-24 — superseding the hold-everything-for-morning
draft-only variant from the hub #18 design). It is the standard close for
autonomous sessions (`obot-auto`,
[hub #18](https://github.com/jwildfire/obot.roadmap/issues/18)) and for any
wrapup he invokes with `--auto`; a bare `/session-wrapup` stays interactive —
the step 3 checkpoint remains the default contract.

- **Steps 0–2 run unchanged** (ack + spawn the verifier, draft from the
  scratchpad, persist the draft to disk), as do **steps 5–7** (hygiene fix list,
  scaffold review, next-session draft).
- **Step 3 is skipped**: no review page, no approval wait. Compose the final
  entry directly in step 9 format, and open it with an unreviewed marker
  directly under the session-report line:
  `*Posted unattended (--auto); not yet reviewed by @jwildfire.*` — the diary
  publishes to a public site, so the flag keeps the record honest. He reviews
  after the fact; fold any corrections in by direct commit (standard-update
  grant) and drop the marker when he signs off.
- **Step 4 becomes a blocking wait — the asymmetric rule.** An `--auto` wrapup
  **waits for the verify sibling before posting**, because there is no human to
  catch a correction afterwards. The wait is a **declared exemption**: log it as a
  scratchpad heartbeat line under `## Session log` when the wait starts and when
  it ends, and state it in the digest.
- **Step 8 applies standing-grant changes only** (board stages, issue-body
  fixes and comments, scratchpad check-offs, memory updates — including
  `next-session-todo`). The grant boundary does not move with `--auto`:
  merges, deletions, closes beyond the wired grants, releases, and upstream
  posts still land as `## 🙋 ToDo` asks in the entry, never auto-applied.
- **Step 9 runs in full**: post the entry plus changelog line and session
  report under the standard-update grant, and carry the deployed URL into the
  close-out. Deploy verification stays **asynchronous and non-blocking here too** —
  `--auto` is not one of the declared exemptions in the [responsiveness
  contract](../../docs/session-framework.md#exemptions--announce-them), so it uses
  the same durable `## Deploy failure` lane step 9 defines rather than a blocking
  watch loop. If the push or deploy fails,
  downgrade gracefully: the entry is already saved at
  `{workspace}/.claude/session-notes/{YYYY-MM-DD}-diary-draft.md` (step 2 wrote
  it) — end with `needs input:` naming the failure — a posted-but-undeployed
  entry is not posted.
- **Still write the morning digest** into the scratchpad as a
  `## Morning digest` section (ultracode-runbook format: what shipped with
  links and CI state, token/cost note per the allocation grant, anything
  skipped or failed with why, and a numbered morning-actions queue) — it stays
  the fastest skim even with the diary live.
- **Step 10 adapts one box**: "Checkpoint held" becomes "Unreviewed marker
  present in the posted entry".
- **End the session** with `result:` and the deployed diary URL; `needs
  input:` is reserved for the failure path above.
