# AGENTS.md — obot.agent

This repo is the core of the obot program's semi-autonomous approach and nothing else:
the `requirement-session` skill a working session runs, the standup routine that reports on
every objective, and a page on cloud environments, which are parked. It carries no
standards of its own.

IMPORTANT: the standards live in `jwildfire/obot.roadmap` and compliance with them is
the job. Read these three before doing anything, every session:

- [Issue contract](https://github.com/jwildfire/obot.roadmap/blob/main/docs/issue-contract.md)
  — objectives, requirements and tasks, definitions of done, labels, milestones, blocked,
  closing.
- [Ways of working](https://github.com/jwildfire/obot.roadmap/blob/main/docs/ways-of-working.md)
  — requirement sessions, what @jwildfire reviews, the standup, steering, releases.
- [Developer guidelines](https://github.com/jwildfire/obot.roadmap/blob/main/docs/developer-guidelines.md)
  — branching, PRs, commits and attribution, testing, merging via rulesets, release
  candidates, artifacts and style.

In @jwildfire's workspace they are on disk in the `obot.roadmap` clone beside this one.
Where a
repository's own `CLAUDE.md` and these documents disagree, the hub documents win; say so
on the task and carry on.

## Three rules

1. Work from an issue tree, never from chat. A session runs one requirement, under an
   objective whose requirements and tasks exist, each with a definition of done and a
   milestone, signed off by @jwildfire on the objective issue. If the tree is incomplete,
   file what is missing under the issue contract and stop for his sign-off.
2. Write progress where the work is. Comment on the requirement at start and nightly
   (complete / in progress / blocked); close each task with the evidence its definition
   of done asked for and one sentence saying what he can now do; close the requirement
   with its proof and one line on the objective. A question for him goes
   on the issue it blocks, with the `blocked` label — never into chat, never into a
   standup by any other route.
3. Prove it in the transcript. Every task names a check the conversation can show — a
   test result, a build exit code, a deployed URL and what it displays — and the `/goal`
   condition is the requirement's definition of done, with how the session proves its
   tasks' state at the end of every turn.

## How a session uses Claude Code

This follows [Claude Code's best practices](https://code.claude.com/docs/en/best-practices);
the features below are the whole toolkit, and nothing here is bespoke.

- One requirement per session, run locally from @jwildfire's workspace — the folder
  that holds the program's repositories side by side — on his own machines, in
  [auto mode](https://code.claude.com/docs/en/auto-mode-config) so tool calls need no
  prompts. He steers on the issue or in the session. Cloud sessions are parked since
  2026-10-07 ([`docs/cloud-environments.md`](docs/cloud-environments.md) says why).
- [`/goal`](https://code.claude.com/docs/en/goal) anchors the session: the condition is
  the requirement's definition of done plus its tasks (the skill has the template), a
  separate evaluator re-checks it after every turn, and the session keeps working until
  the requirement is proven or blocked. The evaluator reads only the transcript — end
  every turn with the tasks' state.
- [Plan mode](https://code.claude.com/docs/en/permission-modes#analyze-before-you-edit-with-plan-mode)
  before touching code on a task: explore, propose, then implement against the plan.
- [Subagents](https://code.claude.com/docs/en/sub-agents) for investigation and for
  verification — a fresh context reads the codebase or tries to refute a result, and
  the main conversation stays on the implementation. The
  [Workflow tool](https://code.claude.com/docs/en/workflows) (ultracode) for multi-stage
  fan-out when @jwildfire has opted in; [Claude Design](https://code.claude.com/docs/en/design)
  (ultradesign) for visual design. Every brief names its task issue.
- [Skills](https://code.claude.com/docs/en/skills) for procedures, `CLAUDE.md` for the
  few rules that apply to every conversation in a repository — short, with `@` imports
  where a document is worth loading — and [hooks](https://code.claude.com/docs/en/hooks-guide)
  only for deterministic gates that must happen every time. Nothing here adds a hook.
  The workspace has one, which refuses a GitHub write that would go out under
  @jwildfire's name.
- [Routines](https://code.claude.com/docs/en/routines) for anything that runs on a
  schedule; the standup is one. No launchd, no cron, no background process on a
  person's machine.
- Manage context: `/context` to see what loaded, `/compact` with a note on what to
  preserve when the window fills, subagents so research does not consume the main
  window.
- Course-correct early: a wrong direction costs less at the first turn than at the
  tenth. Rewind with checkpoints rather than patching over a bad path.

## Repository layout

- [`skills/requirement-session/SKILL.md`](skills/requirement-session/SKILL.md) — the procedure from the requirement issue to its closing comment. Linked into the workspace's `.claude/skills/`.
- [`routines/standup.md`](routines/standup.md) — the scheduled routine's prompt: every
  objective's complete / in progress / blocked counts and one question per blocked issue,
  rendered from GitHub, published to the hub's voice-readable `standup.md`.
- [`docs/cloud-environments.md`](docs/cloud-environments.md) — parked on 2026-10-07 and
  kept for when cloud sessions resume: the environments per repository, their setup
  scripts, credentials, and what to verify first.
- [`NEWS.md`](NEWS.md) — the running release log; the current section is the next
  release's notes.

## Identity and attribution

A session writes to GitHub as obotclaw[bot], the program's GitHub App, and not as
@jwildfire: issues, comments, commits, pushes, pull requests and merges. There is one
exception, the review that records his approval of a release candidate (below). `gh` on
his machine is signed in as him and he is admin on every repository,
so a write with no token set would be recorded as his. The token and the guard that
refuses any other kind of write are tooling of his workspace, not of this or any other
repository; the workspace's README describes them.

Three things are his alone, and a session does not do them with any token: approving a
pull request, merging past a ruleset, and changing a ruleset. His approval of a release
candidate may be given in the session's approval prompt; the session then records it as
his review, from his account, and merges, tags and publishes as the bot (his decision,
2026-10-07; the session skill's step 7). That review is the only write a session makes
as him, and it is not the session approving: the approval is his answer to the prompt. A
"yes" typed in chat is not that approval.

Authorship is also on the object: the drafted-by line after a `---` rule at the foot of
every issue, PR and comment, and the `Co-Authored-By` trailer the harness supplies on
every commit. Say @jwildfire reviewed something only when he did. Full rules: the hub's
developer guidelines.

## What came before

Until 2026-09-10 this repo carried a fully autonomous multi-agent prototype — navigator,
admiral and prime sessions, a dispatcher, session bookends, dashboards, journals, a merge
policy script and a bot identity. It was retired in v0.5.0 because it spent its effort on
itself; [`NEWS.md`](NEWS.md) has the readout and the v0.4.0 tag has the code. v0.5.0 moved
sessions to the cloud, acting as the connected account. v0.6.0 parked that and brought the
bot back as the author, with its tooling kept on @jwildfire's machines instead of here.
