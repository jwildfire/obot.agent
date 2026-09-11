---
name: requirement-session
description: "Run a working session on one hub requirement: check that its objective's tree is signed off and every task under the requirement has a definition of done and a milestone, set Claude Code's built-in /goal from the requirement's definition of done, work the tasks with every PR bound to its issue, list the tasks' state at the end of every turn, post the nightly complete / in progress / blocked comment on the requirement, and close the requirement with its proof. Use when @jwildfire says 'start the session for #N', 'run requirement N', '/requirement-session N', or a cloud session is launched with a requirement issue as its task. Do NOT use for an objective (an objective is never a session — pick its next requirement), for a single question (answer it), for filing the tree itself (that is the hub's requirement-drafting and requirement-tasks skills, which this hands off to when the tree is incomplete), or for a release candidate's review (that is @jwildfire's)."
argument-hint: "Requirement issue number on jwildfire/obot.roadmap"
---

# Requirement session

The contract this follows is the hub's [issue contract](https://github.com/jwildfire/obot.roadmap/blob/main/docs/issue-contract.md)
and [ways of working](https://github.com/jwildfire/obot.roadmap/blob/main/docs/ways-of-working.md);
the engineering rules are its [developer guidelines](https://github.com/jwildfire/obot.roadmap/blob/main/docs/developer-guidelines.md).
In a cloud environment those three files are also at `~/obot.roadmap/docs/`. One requirement
per session; an objective is the steering unit and is never a session.

## 1. Read the requirement and its tree

```bash
gh issue view <requirement> -R jwildfire/obot.roadmap --json title,body,state,milestone
gh api repos/jwildfire/obot.roadmap/issues/<requirement>/sub_issues --paginate \
  --jq '.[] | "\(.repository_url | sub(".*/repos/";"")) #\(.number) [\(.state)] \(.title) milestone=\(.milestone.title // "-")"'
gh api repos/jwildfire/obot.roadmap/issues/<requirement>/parent --jq '"objective #\(.number) \(.title)"'
```

Read the requirement's body (all six sections), every task's body, and the objective's
body and comments. Note for each node: definition of done present, milestone present,
state, latest comment.

## 2. The clarity check — stop if it fails

The session does not start building until all of these hold. Ready is the prep phase's
output; a requirement that still reads Backlog on the board has a prep job in front of it,
and this session's answer is to do that prep (file what is missing) and stop for sign-off,
not to build.

- The objective's tree is signed off: a comment from @jwildfire on the objective issue
  saying so. Quote its link.
- The requirement has its Design and Definition of done sections populated, a milestone,
  at least one task, and a board status of Ready (set it — `03bd076a` — if the tree is
  complete and signed off but the status still reads Backlog).
- Every task lives in exactly one implementation repo, carries its own definition of done,
  a `Parent:` line and a milestone in that repo, and is linked as a sub-issue of the
  requirement. No task without a milestone, no session.
- The requirement's definition of done is something this session can prove in its
  transcript — a command and its output, a URL and what it shows, a test and its result.

If any fails: file or fix the missing nodes with the hub's `requirement-drafting`,
`requirement-tasks` and `sub-issue-linking` skills, comment on the requirement (and, if
the tree is unsigned, on the objective) with what was filed and the one sentence asking for
sign-off, add the `blocked` label to the requirement, and stop. Do not set a goal on an
unsigned tree.

## 3. Set the goal

Compose the condition from the requirement — its number, its definition of done quoted,
the turn or time bound — and run `/goal` with it, in auto mode:

```text
/goal Requirement jwildfire/obot.roadmap#<requirement> is done: every task linked as its
sub-issue is closed by a merged pull request carrying its definition-of-done evidence, or
carries the `blocked` label with a comment naming the one thing needed from @jwildfire;
and the requirement's own definition of done — <its end state and proof, quoted> — is
proven in a closing comment on the requirement. Prove it at the end of every turn by
listing each task with its state. Stop after <N> turns or by <date>, whichever comes
first, and post the nightly comment before stopping.
```

Move the requirement's board status to In session — the board is the one place its
status lives, and the write goes out under the connected account:

```bash
# item id of the requirement on the obot Roadmap project
ITEM=$(gh api graphql -f query='{ repository(owner:"jwildfire", name:"obot.roadmap") { issue(number: <requirement>) { projectItems(first: 5) { nodes { id project { number } } } } } }' --jq '.data.repository.issue.projectItems.nodes[] | select(.project.number == 1) | .id')
gh project item-edit --project-id PVT_kwHOADgnX84BcTPz --id "$ITEM" --field-id PVTSSF_lAHOADgnX84BcTPzzhW9FpU --single-select-option-id 34b8738c   # In session
```

Option ids: Backlog `87331fb3` · Ready `03bd076a` · In session `34b8738c` · Review
`b5cd3859` · Released `1db40a3a`. Then post the start comment on the requirement:

```markdown
Session started <date> on <repo>. Tasks in order: sv#T1 → sv#T2 → sv#T3. Holding: #T1,
#T2 (this session); #T3 (subagent, when #T1 merges). Tree signed off by @jwildfire in
<link to the objective comment>.

---
This comment was drafted by Claude Code using <model>.
```

## 4. Work the tasks

- One branch per task, named `<task-number>-<slug>`, off the integration branch.
- The PR body: exec summary, `Closes <repo>#<task>` on its own line, the
  definition-of-done evidence (the command and its output, the URL and what it shows,
  the test and its result), then details. Non-draft, auto-merge enabled, nobody
  assigned or requested.
- Tests first where the change is testable (the upstream `tdd` skill); the repo's check
  must be green before the PR is opened, not after.
- A subagent or Workflow stage gets a brief that names its task issue and the definition
  of done, and returns the evidence, not a summary.
- When a task's PR merges, comment on the task with the evidence and one sentence saying
  what @jwildfire can now do that he could not before; the closing keyword closes it.
- If a task cannot proceed: write the one question on the task, add the `blocked`
  label, name it in the requirement's nightly comment, and move to the next task.

## 5. End every turn with the tasks' state

The evaluator reads only the transcript. The last thing in every turn is:

```text
State of requirement #<requirement>:
- sv#T1 closed — PR #123 merged
- sv#T3 open — PR #125 waiting on checks
- gs#T5 blocked — needs the ADaM alignment call, asked on the issue
- requirement DoD: not yet proven / proven in <link>
```

## 6. The nightly comment

Once a day, and before the session stops for any reason, post on the requirement:

```markdown
### Complete
- #N — one sentence: what @jwildfire can now do that he could not before

### In progress
- #N — where it stands, and what lands next

### Blocked
- #N — the one question, quoted from the issue's latest comment

---
This comment was drafted by Claude Code using <model>.
```

Every blocked line must correspond to an issue carrying the `blocked` label whose latest
comment is that question; the standup routine reads the labels, not this comment.

## 7. Releases

When the requirement ships a release, follow the hub developer guidelines' Releases
section: the `NEWS.md` section, the demo page on the hub, the RC PR titled
`{package} vX.Y.Z-RCn` against the release branch with one `Closes #N` line per issue shipped, @jwildfire requested as reviewer. Move the requirement's board status to
Review (`b5cd3859`) when the RC opens. The ruleset holds it for his review; never merge it
yourself.

## 8. Finish

When every task is closed and the requirement's definition of done is proven: post the
closing comment on the requirement with the proof and the sentence, close it, move its
board status to Released (`1db40a3a`), post one line on the objective naming the
requirement and the sentence, clear the goal
(`/goal clear` if it has not cleared itself), and stop. Do not start the next
requirement in the same session — it gets its own.
