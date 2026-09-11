# AGENTS.md — obot.agent

This repo is the core of the obot program's semi-autonomous approach and nothing else:
the `goal-session` skill a working session runs, the standup routine that reports on
every goal, and the cloud environments the sessions run in. It carries no standards of
its own.

IMPORTANT: the standards live in `jwildfire/obot.roadmap` and compliance with them is
the job. Read these three before doing anything, every session:

- [Issue contract](https://github.com/jwildfire/obot.roadmap/blob/main/docs/issue-contract.md)
  — goals, requirements and tasks, definitions of done, labels, milestones, blocked,
  closing.
- [Ways of working](https://github.com/jwildfire/obot.roadmap/blob/main/docs/ways-of-working.md)
  — goal sessions, what @jwildfire reviews, the standup, steering, releases.
- [Developer guidelines](https://github.com/jwildfire/obot.roadmap/blob/main/docs/developer-guidelines.md)
  — branching, PRs, commits and attribution, testing, merging via rulesets, release
  candidates, artifacts and style.

In a cloud environment they are also on disk at `~/obot.roadmap/docs/` (the setup script
clones the hub — [`docs/cloud-environments.md`](docs/cloud-environments.md)). Where a
repository's own `CLAUDE.md` and these documents disagree, the hub documents win; say so
on the task and carry on.

## Three rules

1. Work from an issue tree, never from chat. A session starts from a goal issue whose
   requirements and tasks exist, each with a definition of done and a milestone, signed
   off by @jwildfire on the goal issue. If the tree is incomplete, file what is missing
   under the issue contract and stop for his sign-off.
2. Write progress where the work is. Comment on the goal issue at start and nightly
   (complete / in progress / blocked); close each task with the evidence its definition
   of done asked for and one sentence saying what he can now do. A question for him goes
   on the issue it blocks, with the `blocked` label — never into chat, never into a
   standup by any other route.
3. Prove it in the transcript. Every task names a check the conversation can show — a
   test result, a build exit code, a deployed URL and what it displays — and the `/goal`
   condition names how the session proves the tree's state at the end of every turn.

## How a session uses Claude Code

This follows [Claude Code's best practices](https://code.claude.com/docs/en/best-practices);
the features below are the whole toolkit, and nothing here is bespoke.

- One goal per session, as a [cloud session](https://code.claude.com/docs/en/claude-code-on-the-web)
  bound to the repository where the goal's tasks live, in
  [auto mode](https://code.claude.com/docs/en/auto-mode-config) so tool calls need no
  prompts. Steering happens on claude.ai/code or the phone.
- [`/goal`](https://code.claude.com/docs/en/goal) anchors the session: the condition is
  generated from the tree (the skill has the template), a separate evaluator re-checks
  it after every turn, and the session keeps working until the tree is closed or
  blocked. The evaluator reads only the transcript — end every turn with the tree's
  state.
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
- [Routines](https://code.claude.com/docs/en/routines) for anything that runs on a
  schedule; the standup is one. No launchd, no cron, no background process on a
  person's machine.
- Manage context: `/context` to see what loaded, `/compact` with a note on what to
  preserve when the window fills, subagents so research does not consume the main
  window.
- Course-correct early: a wrong direction costs less at the first turn than at the
  tenth. Rewind with checkpoints rather than patching over a bad path.

## Repository layout

- [`skills/goal-session/SKILL.md`](skills/goal-session/SKILL.md) — the procedure from
  the goal issue to its closing comment. Installed into a cloud environment by the setup
  script; locally, symlink it into a workspace's `.claude/skills/`.
- [`routines/standup.md`](routines/standup.md) — the scheduled routine's prompt: every
  goal's complete / in progress / blocked counts and one question per blocked issue,
  rendered from GitHub, published to the hub's voice-readable `standup.md`.
- [`docs/cloud-environments.md`](docs/cloud-environments.md) — the environments per
  repository, their setup scripts, credentials, and what to verify first.
- [`NEWS.md`](NEWS.md) — the running release log; the current section is the next
  release's notes.

## Identity and attribution

The actor is the connected GitHub account of the session. Authorship is on the object:
the drafted-by line after a `---` rule at the foot of every issue, PR and comment, and
the `Co-Authored-By` trailer the harness supplies on every commit. Say @jwildfire
reviewed something only when he did. Full rules: the hub's developer guidelines.

## What came before

Until 2026-09-10 this repo carried a fully autonomous multi-agent prototype — navigator,
admiral and prime sessions, a dispatcher, session bookends, dashboards, journals, a merge
policy script and a bot identity. It was retired in v0.5.0 because it spent its effort on
itself; [`NEWS.md`](NEWS.md) has the readout and the v0.4.0 tag has the code.
