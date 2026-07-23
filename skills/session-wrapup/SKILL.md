---
name: session-wrapup
description: "Wrap up a working session by folding the session scratchpad — the as-you-go record kept by session-update, session-note, and the sibling heartbeat — verified by one GitHub delta agent; then discuss findings via the three-question checkpoint and apply the agreed changes: issue updates, stage moves, scaffold/memory updates, and the diary entry. Use at the end of any substantive session — 'wrap up', 'session wrapup', 'close out the session'. Do NOT use mid-session or for empty sessions."
argument-hint: "Optional: session focus or extra context to fold into the summary"
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
record and verifies it** with one GitHub delta agent — it does not re-derive the
day from transcript-mining subagents and per-repo sweeps. A thin scratchpad is a
during-session note-taking failure to fix (tighten the heartbeat, log as you
go), not a reason for a heavier wrapup. Target: a typical wrapup in **~10
minutes with a single delta agent**.

The routine is **interactive** (@jwildfire's call, 2026-07-09): first **collect**
the picture read-only, then **discuss** — present findings and ask clarifying
questions — and only after the discussion **apply** changes. Standing grants cover
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

Three phases: **collect** (steps 1–4 — read-only: no issue edits, stage moves,
posts, or memory writes yet), **discuss** (step 5), **apply** (steps 6–8).

### 1. Fold the scratchpad, verify with one delta agent

**The scratchpad first.** Read today's
`.claude/session-notes/{YYYY-MM-DD}.md` in full: the `## Overview` check-state
(what the kickoff list says got done), unchecked `## Todo` items, `## Notes`,
and the `## Session log` — including every sibling (`👯🤖`) and ultracode
(`⚡️🤖`) line the heartbeat collected. This record, plus the current
conversation, is the inventory. Group it the way diary entries report it:
merged / opened / closed / advanced, each with links.

**Then verify, don't trust.** Launch a single read-only subagent to check the
record against reality — batched calls, not per-repo loops:

- `gh search issues` / `gh search prs` across `--owner jwildfire`, filtered to
  activity since the session started (`--json` fields plus `updatedAt`; parse
  with `python3`, `jq` is not installed), plus
  `gh project item-list 1 --owner jwildfire` for board stages.
- Its two jobs: **verify scratchpad claims** (a "PR posted" line must
  correspond to a real PR; a "merged" claim to a merged PR) and **catch
  strays** — GitHub activity in the session window with no scratchpad line.

**Local git, scoped.** Check `git status` / unpushed commits only in the repos
and worktrees the scratchpad or delta digest name as touched this session —
unpushed work is a loose end, not a completion. Do not sweep every clone.

**Transcripts are the exception, not the default.** Mine a session transcript
(`~/.claude/projects/…/{sessionId}.jsonl`, via one scoped subagent) only when
the fold surfaces a **known gap** — e.g. a sibling job ran but left no
scratchpad lines, or the delta caught activity nothing accounts for. Name the
gap in the wrapup summary either way.

### 2. Roadmap hygiene sweep — build the fix list

For **each issue or PR the inventory says was touched** (not the whole tracker),
check — and record mismatches as **proposed fixes**, don't edit anything yet:

- **Body accurate?** Re-read the live body (`gh issue view` — Draft Sync
  Convention); flag it if the session changed scope, design, or status.
  Requirement issues must carry the five template sections (see
  [Creating Requirement issues](../../../obot.roadmap/AGENTS.md)).
- **Stage correct?** Flag touched items whose board stage no longer matches
  reality (stages come free with the step 1 delta digest). Respect done-gates
  (e.g. a renderer requirement is not Released until its site entry deploys).
- **Links intact?** PRs carry `Closes #X` lines and Development-sidebar links;
  sub-issues are attached to their parent (`sub-issue-linking` skill).
- **Metadata set?** Milestone (lowercase `YYYYqN` or `backlog`) and topic labels.
- **Releases tied?** Any release published this session lists its hub
  requirement(s) in the release notes — a `Requirements delivered:` line placed
  before the closing attribution rule. Retro-add via the releases API
  (`gh api -X PATCH repos/{owner}/{repo}/releases/{id}`) when missing.

Then sweep the scratchpad and conversation for **uncaptured todos**: promises
made, "we should…" moments, blockers hit, review requests, deferred decisions.
Propose a durable home for each — a Requirement (`requirement-drafting`), a
sub-issue (`requirement-tasks`), an edit/comment on an existing issue, or the
diary's "Next session" / "🙋 ToDo" sections (step 7). Standing grants make the
fixes mechanically no-approval-needed, but they are applied in step 6 — after
the checkpoint. Anything involving deleting or closing what isn't verifiably
done needs explicit approval: raise it at the checkpoint, never assume it.

### 3. Scaffold review — collect candidates

Start from the scratchpad's `## Scaffold` section — the list
[`session-scaffold`](../session-scaffold/SKILL.md) built as friction happened;
those entries are the primary candidates. Then review the session for anything
the list missed:

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

### 4. Draft next-session tasks

Draft a prioritized, concrete list of what the next session should pick up:
every item traceable (link the issue/PR it advances; propose an issue if
substantial work has none), carried items marked as carried so nothing silently
drops. The agreed list lands in the diary's **"Next session: loose ends"**
section, the scratchpad `## Overview` check-state, and the `next-session-todo`
memory (step 6) — the hand-off [`session-init`](../session-init/SKILL.md) reads
back.

**Roadmap prep — obot.agent orchestration job (1), roadmap-standards enforcement:**
every priority on the drafted list must link a hub requirement. For any priority
without one, draft the requirement's **Business Requirement + Overview** sections
(via `requirement-drafting`; scope questions to @jwildfire are welcome —
AskUserQuestion) and **file it before the checkpoint**, so the draft post's
next-session list presents each priority *with* its requirement link. Board-add every new
requirement with a Status (normally `Requirement Gathering`) and link existing
implementation issues as sub-issues at filing time (`sub-issue-linking`; note the
one-parent-per-issue constraint). Later lifecycle sections (Data Requirement,
Design, Tasks) stay stubbed for their own stages.

### 5. Checkpoint — the draft post, reviewed in Chrome

The checkpoint is **a draft of the wrapup post presented for review**
(@jwildfire's format, 2026-07-14, superseding the three-question
AskUserQuestion checkpoint — "the formatting on the Q&A is hard to follow"):

1. **Compose the full diary entry draft** (step 7 format) from the fold —
   accomplishments, scaffold changes, and next-session priorities all visible
   in the form they will actually publish. Add a short aside listing what posts
   alongside the entry (changelog entry, session report) and what was already
   applied under standing grants before the draft.
2. **Render it as a local HTML review page and open it in Chrome** —
   @jwildfire reviews in Chrome, not the CLI. The page shows the entry styled
   as it will publish, with a comment box and two buttons —
   `✅ Approve & post` / `✏️ Request changes` — wired to a one-shot localhost
   listener so the click (with comments) reaches the session directly; a chat
   reply works as a fallback. Nothing posts until the decision arrives.
3. **Comments are the discussion**: fold them in — including any new work they
   direct, which then belongs in the entry — re-render, and re-present until
   approved. An approval is the go-ahead for the apply phase (Approval
   Convention satisfied); the diary entry is then posted under the
   standard-update grant.

Anything beyond standing grants that the sweep surfaced (deletions, closing
unverified work, upstream PRs) still needs its own explicit ask — raise it in
the review aside or separately, never bury it in the draft.

If @jwildfire is unavailable (unattended background run, no decision), stop
here and surface `needs input:` with the full draft — never post the diary or
edit issues without the review.

### 6. Apply the agreed changes

- Issue-body edits, stage moves, link and metadata fixes from step 2, as agreed.
- New issues/sub-issues and issue comments that got homes in the discussion.
- Scaffold updates from step 3 that were approved or fall under standing grants;
  memory writes, including updating the `next-session-todo` memory to the agreed
  step-4 list.
- Check captured scratchpad items off (`- [x]`) — never delete them or the file.

### 7. Draft and post the session summary

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
  `## Blockers / risks`, `## Next session: loose ends` (from step 4, as agreed),
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
  commits together with the diary entry. Render it **after** the scratchpad
  check-states from step 6 are final — the report freezes them.
- **Post**: commit directly to `main` and push (standard-update grant). The site
  deploy triggers on `diary/**` pushes.
- **Refresh package status**: that same deploy re-renders
  [the Status page](https://jwildfire.github.io/obot.roadmap/status.html) from the
  live GitHub API, so posting the entry brings the dashboard current — no local R
  needed. If a session ends without any `obot.roadmap` commit, trigger it directly:

  ```bash
  gh workflow run deploy-site.yml -R jwildfire/obot.roadmap
  ```
- **Verify the deploy**: `gh run list -R jwildfire/obot.roadmap --workflow=deploy-site.yml --limit 1`
  and watch it to a green conclusion — a posted-but-undeployed entry is not posted.
  The dashboard steps are `continue-on-error`, so also check that the run did not
  fall back to the "temporarily unavailable" placeholder.
- **Share the deployed URL** (https://jwildfire.github.io/obot.roadmap/ diary page)
  — @jwildfire reviews in Chrome on the deployed site, not from a local file.

### 8. Exit checklist

Confirm, and state in the closing response:

- [ ] Scratchpad folded — every line verified, captured, and checked off; gaps
      (missing sibling logs, stray GitHub activity) named.
- [ ] Checkpoint held — changes applied only after the step 5 discussion.
- [ ] Board stages match reality for every touched issue; bodies synced.
- [ ] No todo exists only in conversation — each has an issue, diary line, or
      memory entry.
- [ ] Scaffold updates applied or proposed; memory current.
- [ ] Session report rendered and linked from the diary entry.
- [ ] Next-session list recorded (diary + scratchpad + memory).
- [ ] Diary entry deployed (workflow green) and the deployed URL shared.

## Unattended (`--auto`) variant

For wrapups inside an autonomous session
([hub #18](https://github.com/jwildfire/obot.roadmap/issues/18), design
approved 2026-07-22) — the step 5 unavailable-rule, made the designed path
rather than an exception:

- **Steps 1–4 run unchanged** (fold, verify with the delta agent, hygiene
  sweep, next-session draft).
- **Step 5 is replaced**: compose the full diary entry draft, but save it as a
  *draft file* — `{workspace}/.claude/session-notes/{YYYY-MM-DD}-diary-draft.md`
  — never into `obot.roadmap/diary/` (hub commits deploy the site; a committed
  entry is a published entry). No Chrome listener, no posting.
- **Step 6 applies mechanical standing-grant fixes only** (board stages,
  issue comments, scratchpad check-offs, memory updates). Anything beyond —
  closes of unverified work, deletions, publishing — goes on the morning list.
- **Step 7 does not run**: no diary post, no changelog entry, no session
  report — those freeze after @jwildfire's morning review, in the next
  interactive session or on his instruction.
- **Write the morning digest** into the scratchpad as a `## Morning digest`
  section (ultracode-runbook format): increment attempted, what shipped with
  links and CI state, token/cost note per the allocation grant, anything
  skipped or failed with why, and a numbered morning-actions queue.
- **End the session** with `needs input:` and the digest headline plus the
  diary-draft path. The review surface is what @jwildfire already uses: draft
  PRs on GitHub, the session hub, the digest, the draft entry.
