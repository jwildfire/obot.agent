---
name: goal-session
description: "Run a goal-based working session from a hub goal issue: check that its requirement and task tree is complete with definitions of done and milestones, set the built-in /goal from the tree, work the tasks with every PR bound to its issue, list the tree's state at the end of every turn, and post the nightly complete / in progress / blocked comment. Use when @jwildfire says 'start the goal session for #N', 'run goal N', '/goal-session N', or a cloud session is launched with a goal issue as its task. Do NOT use for a single question (answer it), for filing the tree itself (that is the hub's requirement-drafting and requirement-tasks skills, which this skill hands off to when the tree is incomplete), or for a release candidate's review (that is @jwildfire's)."
argument-hint: "Goal issue number on jwildfire/obot.roadmap"
---

# Goal session

The contract this follows is the hub's [issue contract](https://github.com/jwildfire/obot.roadmap/blob/main/docs/issue-contract.md)
and [ways of working](https://github.com/jwildfire/obot.roadmap/blob/main/docs/ways-of-working.md);
the engineering rules are its [developer guidelines](https://github.com/jwildfire/obot.roadmap/blob/main/docs/developer-guidelines.md).
In a cloud environment those three files are also at `~/obot.roadmap/docs/`. One goal per session.

## 1. Read the tree

```bash
gh issue view <goal> -R jwildfire/obot.roadmap --json title,body,state,milestone
gh api repos/jwildfire/obot.roadmap/issues/<goal>/sub_issues --paginate \
  --jq '.[] | "\(.repository_url | sub(".*/repos/";"")) #\(.number) [\(.state)] \(.title) milestone=\(.milestone.title // "-")"'
# and for each requirement, its sub-issues the same way
```

Read every node's body. Note for each: definition-of-done section present, milestone
present, state, and the latest comment.

## 2. The clarity check — stop if it fails

The session does not start building until all of these hold:

- The goal issue states what done means for the whole goal.
- Every requirement has the five hub sections plus a `### Definition of done` section
  with an observable end state, its proof, and the release it ships in.
- Every requirement has at least one task, each in exactly one implementation repo, each
  with its own definition of done and a `Parent:` line, each linked as a sub-issue.
- Every node carries the release milestone.
- @jwildfire's sign-off on the tree is a comment on the goal issue.

If any fails: file or fix the missing nodes with the hub's `requirement-drafting`,
`requirement-tasks` and `sub-issue-linking` skills, comment on the goal issue with what
was filed and the one sentence asking for sign-off, add the `blocked` label to the goal,
and stop. Do not set a goal on an unsigned tree.

## 3. Set the goal

Compose the condition from the template in the hub's ways of working — the goal number,
the turn or time bound, the proof clause — and run `/goal` with it, in auto mode. Then
post the start comment on the goal issue:

```markdown
Session started <date> on <repo>. Order: #R1 → #R2 → #R3. Holding: #T1, #T2 (this
session); #T3 (subagent, when #T1 merges). Tree signed off by @jwildfire in <link>.

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
- When every task under a requirement is closed, comment on the requirement with the
  proof its definition of done asked for, and close it.
- If a task cannot proceed: write the one question on the task, add the `blocked`
  label, comment on the goal issue naming it, and move to the next task.

## 5. End every turn with the tree's state

The evaluator reads only the transcript. The last thing in every turn is:

```text
Tree state for #<goal>:
- #R1 open — 2 of 3 tasks closed; #T3 in review
- sv#T1 closed — PR #123 merged
- sv#T3 open — PR #125 waiting on checks
- gs#T5 blocked — needs the ADaM alignment call, asked on the issue
```

## 6. The nightly comment

Once a day, and before the session stops for any reason, post on the goal issue:

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

When the goal's tree ships a release, follow the hub developer guidelines' Releases
section: the `NEWS.md` section, the demo page on the hub, the RC PR
titled `{package} vX.Y.Z-RCn` against the release branch with one `Closes #N` line per
issue shipped, @jwildfire requested as reviewer. The ruleset holds it for his review;
never merge it yourself.

## 8. Finish

When the tree is closed: post the closing comment on the goal issue naming the release
and the sentences from the requirements' closing comments, clear the goal (`/goal
clear` if it has not cleared itself), and stop. Do not start another goal in the same
session.
