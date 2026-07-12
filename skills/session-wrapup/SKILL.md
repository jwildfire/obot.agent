---
name: session-wrapup
description: "Wrap up a working session in three phases: collect a read-only inventory of work across all agents (GitHub, git, session transcripts, scratchpad, memory); discuss findings and clarifying questions with @jwildfire; then apply the agreed changes — issue updates, stage moves, scaffold/memory updates, and the diary entry. Use at the end of any substantive session — 'wrap up', 'session wrapup', 'close out the session'. Do NOT use mid-session or for empty sessions."
argument-hint: "Optional: session focus or extra context to fold into the summary"
---

# Session Wrapup

Close out a working session so nothing lives only in a conversation. The wrapup is
done when four things are true:

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

The routine is **interactive** (@jwildfire's call, 2026-07-09): first **collect**
the full picture read-only, then **discuss** — present findings and ask clarifying
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

### 1. Inventory the session — all agents, not just this conversation

A session often spans several agents (interactive sessions, background jobs,
subagents). Sweep the evidence, don't trust recall:

- **This conversation** and any subagent/background-job results in it.
- **Agent session transcripts** — the wrapup often runs as a fresh session that saw
  none of the day's work firsthand. The day's transcripts live at
  `~/.claude/projects/-Users-jwildfire-Documents-obot2/{sessionId}.jsonl` (one file
  per session; `ls -t` and take today's) with background-job metadata under
  `~/.claude/jobs/`. They are large — don't read them inline; spawn a subagent per
  transcript (or one for the batch) to extract what each session did, decisions
  made, promises to @jwildfire, and anything that never reached GitHub, the
  scratchpad, or memory.
- **GitHub activity** since the session started, across the active repos
  (`obot.roadmap`, `safety.viz`, `gsm.safety`, `safety-histogram`, `obot.agent`,
  and upstream `gsm.agent` via its local clone — the Gilead-BioStats API is
  SAML-blocked). Per repo:
  `gh issue list -R jwildfire/{repo} --state all --search "updated:>={YYYY-MM-DD}"`
  and the same for `gh pr list`.
- **Local git state** in each workspace clone *and its `*-worktrees/` siblings*:
  `git log --all --since={date}` for commits, plus `git status` for uncommitted or
  unpushed work — unpushed work is a loose end, not a completion.
- **Session scratchpad** — `.claude/session-notes/{YYYY-MM-DD}.md` in the
  workspace, written mid-session by the
  [`session-update`](../session-update/SKILL.md) /
  [`session-note`](../session-note/SKILL.md) skills: fold unchecked Todo items
  into the uncaptured-todo sweep (step 2) and Notes into the diary entry
  (step 7), then check items off as captured — never delete the file.
- **Memory** (`next-session-todo` and friends) for what the session was *supposed*
  to do — anything planned but untouched is carried forward in step 4.

Produce a work inventory grouped the way diary entries report it: merged / opened /
closed / advanced, each with links.

### 2. Roadmap hygiene sweep — build the fix list

For **each requirement or issue touched this session** (from the step 1 inventory),
check — and record mismatches as **proposed fixes**, don't edit anything yet:

- **Body accurate?** Re-read the live body (`gh issue view` — Draft Sync
  Convention); flag it if the session changed scope, design, or status. Verify
  requirement issues still carry exactly the five template sections (see
  [Creating Requirement issues](../../../obot.roadmap/AGENTS.md)).
- **Stage correct?** Check the obot Roadmap user project (project 1,
  `gh project item-list 1 --owner jwildfire`) and flag items whose stage no longer
  matches reality. Respect done-gates (e.g. a renderer requirement is not Released
  until its site entry deploys).
- **Links intact?** PRs carry `Closes #X` lines and Development-sidebar links;
  sub-issues are attached to their parent (use the `sub-issue-linking` skill).
- **Metadata set?** Milestone (lowercase `YYYYqN` or `backlog`) and topic labels.
- **Releases tied?** Any release published this session lists its hub
  requirement(s) in the release notes — a `Requirements delivered:` line placed
  before the closing attribution rule. Retro-add via the releases API
  (`gh api -X PATCH repos/{owner}/{repo}/releases/{id}`) when missing.

Then sweep the session itself for **uncaptured todos**: promises made in
conversation, "we should…" moments, blockers hit, review requests, deferred
decisions. Propose a durable home for each:

- New scoped work → a Requirement (`requirement-drafting`) or a sub-issue in the
  implementation repo (`requirement-tasks`).
- Adjustments to existing work → an edit or comment on the existing issue.
- Small or not-yet-scoped items → the diary entry's "Next session" /
  "🙋 ToDo" sections (step 7), which are re-read at the next session's start.

Standing grants make the fixes themselves no-approval-needed mechanically, but they
are applied in step 6 — after the checkpoint. Anything involving deleting or
closing what isn't verifiably done needs explicit approval: raise it at the
checkpoint, never assume it.

### 3. Scaffold review — collect candidates

Review the session for scaffold updates and list them as candidates to discuss:

- **Repeatable pattern** executed by hand two or more times, or an existing skill
  that gave stale/wrong guidance → a new skill or a skill update. Hub-process
  skills live in this repo (`.github/skills/` + a symlink from the workspace
  `.claude/skills/`); shared gsm conventions go upstream as a `gsm.agent` PR.
- **Convention drift** — a convention changed or was granted in-session (autonomy,
  formats, gates) → an `AGENTS.md` / workspace `CLAUDE.md` update so the next
  session starts current.
- **Memory** — durable facts, preferences, and feedback from the session → memory
  writes or updates.
- **Config friction** — repeated permission prompts, broken skill symlinks, stale
  merged worktrees, out-of-date clones → note what a fix would be; nothing
  destructive without approval.

### 4. Draft next-session tasks

Draft a prioritized, concrete list of what the next session should pick up:

- Every item traceable — link the issue/PR it advances; propose an issue (step 2)
  if substantial work has none.
- Include carried items from previous entries that are still open, marked as
  carried, so nothing silently drops.
- The agreed list lands in the diary's **"Next session: loose ends"** section and
  the memory next-session pointer (step 6).

**Roadmap prep — obot.agent orchestration job (1), roadmap-standards enforcement:**
every priority on the drafted list must link a hub requirement. For any priority
without one, draft the requirement's **Business Requirement + Overview** sections
(via `requirement-drafting`; scope questions to @jwildfire are welcome —
AskUserQuestion) and **file it before the checkpoint**, so the step-5 priorities
question presents each priority *with* its requirement link. Board-add every new
requirement with a Status (normally `Requirement Gathering`) and link existing
implementation issues as sub-issues at filing time (`sub-issue-linking`; note the
one-parent-per-issue constraint). Later lifecycle sections (Data Requirement,
Design, Tasks) stay stubbed for their own stages.

### 5. Checkpoint — three questions, content inside the prompt

The checkpoint is **one `AskUserQuestion` call with exactly three questions**
(@jwildfire's format, 2026-07-09). Embed the substance **in each question's own
text** — @jwildfire sees only the prompt while answering, so content that lives
in earlier chat messages is invisible at decision time; a preview he can't see
is no preview:

1. **Accomplishments** — the session's key accomplishments, compact, in the
   question text; ask *"anything to add?"* Options: `Looks complete` /
   `Missing something` (freeform Other supplies what).
2. **Scaffold** — one or more concrete proposed scaffold improvements from
   step 3, in the question text; ask *"agree?"* Options: `Apply as proposed` /
   `Adjust` / `Skip this time`.
3. **Priorities** — the top 3 priorities for the next session from step 4, in
   the question text; ask *"agree?"* Options: `Agree` / `Reorder or swap`.

The answers are the discussion: fold adjustments back into the plan, re-asking
only what changed. Affirmative answers to all three are the go-ahead for the
apply phase (Approval Convention satisfied); the diary entry is then composed
from the approved content and posted under the standard-update grant. Anything
beyond standing grants that the sweep surfaced (deletions, closing unverified
work, upstream PRs) still needs its own explicit ask — raise it separately,
never bundle it into the three questions.

If @jwildfire is unavailable (unattended background run, no reply), stop here
and surface `needs input:` with the full plan — never post the diary or edit
issues without the checkpoint.

### 6. Apply the agreed changes

- Issue-body edits, stage moves, link and metadata fixes from step 2, as agreed.
- New issues/sub-issues and issue comments that got homes in the discussion.
- Scaffold updates from step 3 that were approved or fall under standing grants;
  memory writes, including updating the memory next-session pointer to the agreed
  step-4 list.

### 7. Draft and post the session summary

- **File**: one post per session (@jwildfire, 2026-07-09). The day's first
  session is `diary/YYYY-MM-DD.md`; each later session gets its **own file**
  `diary/YYYY-MM-DD-N.md` (N = 2, 3, …) with the H1
  `# Daily diary: YYYY-MM-DD — Session N`. Never append a second session to an
  existing entry — `render_diary.mjs` gives every session file its own page and
  news-index line.
- **Format** (match recent entries; the diary README and the latest few entries are
  the exemplars):
  - Lead `<span class="meta">…</span>` paragraph — the session's story in 2–4
    sentences.
  - `## Work completed` — from the step 1 inventory, grouped by lane.
  - `## PRs / issues touched` — merged / opened / closed / advanced, with links.
  - `## Blockers / risks`
  - `## Next session: loose ends` — from step 4, as agreed at the checkpoint.
  - `## 🙋 ToDo` — items needing @jwildfire (reviews, sign-offs, decisions).
- **Changelog**: if the session changed what `roadmap.html` shows (stage moves, new
  requirements), append a `site/roadmap-changelog.json` entry with the semver bump
  rules in `AGENTS.md`.
- **Post**: commit directly to `main` and push (standard-update grant). The site
  deploy triggers on `diary/**` pushes.
- **Verify the deploy**: `gh run list -R jwildfire/obot.roadmap --workflow=deploy-site.yml --limit 1`
  and watch it to a green conclusion — a posted-but-undeployed entry is not posted.
- **Share the deployed URL** (https://jwildfire.github.io/obot.roadmap/ diary page)
  — @jwildfire reviews in Chrome on the deployed site, not from a local file.

### 8. Exit checklist

Confirm, and state in the closing response:

- [ ] Checkpoint held — changes applied only after the step 5 discussion.
- [ ] Board stages match reality for every touched issue; bodies synced.
- [ ] No todo exists only in conversation — each has an issue, diary line, or
      memory entry.
- [ ] Scaffold updates applied or proposed; memory current.
- [ ] Next-session list recorded (diary + memory).
- [ ] Diary entry deployed (workflow green) and the deployed URL shared.
