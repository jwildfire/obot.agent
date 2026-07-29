---
name: session-reviews
description: "Spawn a sibling agent that walks @jwildfire through the open PRs waiting on his decision — one at a time, leading with why each one matters and what is being asked of him, then executing the decision (mark ready, merge via obot-merge, request changes, defer). Use when @jwildfire says '/session-reviews', 'walk me through the PRs', 'what needs my review?', 'let's do reviews', or a session ends with several PRs stacked up awaiting him. Do NOT use to review the agent's own uncommitted diff (that is /code-review), to open a single PR he already named (just show it), or to merge anything without his explicit in-session approval."
argument-hint: "Optional: a repo, a PR number, or a focus to scope the queue"
---

# Session Reviews

Review is the program's bottleneck: agents ship PRs faster than one person can
read them, and a stack of open PRs is stalled work, not finished work. This skill
turns that stack into a conversation — a dedicated sibling that knows the queue,
opens each PR with the decision it is asking for, and executes the answer.

**It spawns an agent** (@jwildfire's wording: "create a new agent to walk me
through review"). Reviewing is its whole job, so the lead session keeps its own
thread and the reviewer can run for as long as the queue takes, driven from the
terminal or from Remote Control on his phone.

## When to Use

- @jwildfire says "/session-reviews", "walk me through the PRs", "what needs my
  review?", "anything waiting on me?".
- A session or an overnight run ends with PRs stacked awaiting him.

**Do not use** for the agent's own working diff (`/code-review`), for a single PR
he already named and just wants opened, or as a route to merging — approval is
his, always, and this skill never assumes it.

## Procedure

### 1. Build the queue

```bash
obot.agent/scripts/reviews-queue          # the table
obot.agent/scripts/reviews-queue --json   # one object per PR, for the reviewer's briefing
```

One sweep across every repo he owns, split into three buckets:

| Bucket | Meaning | What the walkthrough does |
| --- | --- | --- |
| **you** | Mergeable, checks green, nothing sent back | Walk it, one at a time |
| **waiting** | Checks still running | Name it, come back at the end |
| **agent** | Conflicts, failing checks, or unaddressed change requests | Name it and say who will fix it — do **not** spend his time on it |

Two scoping decisions are baked into the script and worth knowing, because both
are counter-intuitive:

- **Drafts count.** Agents here ship `gh pr create --draft` by default, so draft
  is the normal shipping state — most of the real queue is drafts. They are
  walked like anything else.
- **Bots and dormant repos are dropped** by author and by last-updated, so old
  forks do not pad the queue.

If the queue is empty, say so and stop. Do not spawn an agent to report nothing.

### 2. Pick the lane

- **Default — the conversation.** He is at the terminal or on his phone and wants
  to talk through them. Spawn the reviewer (step 3).
- **Large queue (roughly 5+) or he is stepping away — the checkboxes.** File the
  review guide instead: one hub issue, a dependency-ordered checklist where each
  box states exactly what checking it authorizes, and a watcher that executes each
  check ([obot.roadmap#114](https://github.com/jwildfire/obot.roadmap/issues/114),
  validated 2026-07-25). Offer the choice rather than deciding for him.
- **`--here`** — he asked for the walkthrough in this session. Skip the spawn and
  run steps 4-6 inline.

### 3. Spawn the reviewer

Follow the [`session-spawn`](../session-spawn/SKILL.md) contract in full — auto
permission mode, `--remote-control`, `👯🤖 {date} {slug}` naming, green colour,
the scratchpad heartbeat. This one is judgment-heavy and conversational, so give
it a strong model.

```bash
claude --bg --permission-mode auto --remote-control --model opus \
  -n "👯🤖 $(date +%F) pr-review" "<briefing>"
```

The briefing carries: the `reviews-queue --json` output, the walkthrough contract
(step 4), the decision lane (step 5), and this instruction —

> You are running an interactive review with @jwildfire. **End your turn after
> each PR and wait.** Never batch several PRs into one message, never proceed on
> an assumed answer, and never merge anything he has not approved in this
> conversation. If he goes quiet, stop — do not fill the silence with more PRs.

Tell him how to reach it: the session appears in claude.ai/code and the Claude
mobile app (Remote Control), or `claude agents` from the terminal.

### 4. The walkthrough contract — one PR at a time

For each PR in the **you** bucket, oldest first, open with four things and stop:

1. **Why it matters** — what changes for a user, a study, or the program. Its
   roadmap parent if it has one. Not a file list, not a diffstat.
2. **The decision being asked** — merge it, choose between two approaches, confirm
   a judgment call the agent made, or just look at a rendered artifact. Name it
   explicitly; a PR with no decision in it should not be in the walkthrough.
3. **What is already verified** — tests, evidence pages, CI. Say what was checked
   so he does not re-check it.
4. **What is uncertain** — the judgment calls, the thin spots, what the agent
   would push back on if it were reviewing. This is the part worth his attention;
   lead him to it.

The PR body's opening summary is the source for (1) — the obot PR template puts it
first, and `reviews-queue --json` extracts it as `lead`.

**Anything visual goes to a deployed URL first.** He reviews artifacts on the
deployed GitHub Pages site in Chrome, not local previews. If the PR renders a
chart, a page, or an evidence bundle, publish it and hand him the deployed link;
if there is no deployed surface yet, say that plainly rather than offering a
local file path.

Keep it conversational. He mixes decisions with tangents and instructions freely —
follow him, and come back to the queue when the tangent closes.

### 5. Execute the decision

| He says | Do |
| --- | --- |
| **Merge it** | Step 6 |
| **Changes** | Post the specifics as a PR review comment (as obotclaw[bot]), add a `session-update` todo, move on. Do not start fixing mid-walkthrough. |
| **Defer / not now** | Note why in the scratchpad and move on — a deferred PR is a decision, not a gap. |
| **Skip** | Move on without a record. |
| **Question** | Answer from the PR and the code. If it needs real investigation, capture it and keep the queue moving. |

### 6. Merging, when and only when he approves

Approval is explicit and in-session. Nothing about a PR being green, small, or
old constitutes approval.

```bash
obot.agent/scripts/obot-merge <pr#> -R <owner>/<repo> --check   # always first
obot.agent/scripts/obot-merge <pr#> -R <owner>/<repo>
```

Two traps, both verified against the live queue (2026-07-29):

- **`obot-merge` refuses drafts** — "mark it ready for review first". Since most
  of the queue is drafts, `gh pr ready <pr#> -R <repo>` is a normal step of
  executing an approval, not an exception. Marking ready is not merging; it is
  still gated on his word.
- **`--check` is a *policy* check, not a mergeability check.** It answered
  `CHECK PASSED` on a PR whose state was `CONFLICTING`. Read `mergeable` /
  `mergeStateStatus` separately (`reviews-queue` does, and puts conflicts in the
  **agent** bucket) — a passing `--check` does not mean the merge will succeed.

Which lane a PR merges on comes from
[`scripts/policy.json`](../../scripts/policy.json) — the repo's profile plus the
role its base branch plays. Check before you promise him anything:

```bash
obot.agent/scripts/obot-policy explain <owner>/<repo>
```

`standard` merges on his in-conversation approval alone. `attested` — every
release branch, and every branch of a `protected` repo — additionally needs
`--jeremy-approved '<where/when he approved>'`, quoting where in this
conversation he approved it. Raw `gh pr merge`, REST, and GraphQL merges are
denied by the workspace `merge-gate-guard` hook — a denial there means "use
obot-merge", not "find another route".

### 7. Close out

When the queue is done or he stops:

- A short tally: merged, changes requested, deferred, still waiting on checks.
- The **agent** bucket restated as work — each one with who fixes it and how,
  captured as `session-update` items so it survives the session.
- The heartbeat close-out line (what shipped, with links; what is unfinished),
  per the [`session-spawn`](../session-spawn/SKILL.md) contract.

## Lifecycle

The reviewer is a sibling like any other: its decisions land in the scratchpad,
[`session-todo`](../session-todo/SKILL.md) shows the follow-ups mid-session, and
[`session-wrapup`](../session-wrapup/SKILL.md) folds the tally into the diary.
Merges made here are the audit record — the checkbox guide's `--jeremy-approved`
note has its equivalent in this skill's rule that approval is quoted from the
conversation.
