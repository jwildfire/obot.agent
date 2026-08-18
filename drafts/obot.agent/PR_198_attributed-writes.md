<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/198 on 2026-08-18 00:52 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: bug, Assignee: jwildfire -->

## What this does

Structural GitHub writes now go out as `obotclaw[bot]`, and the workspace refuses one that is about to run as @jwildfire instead of asking anyone to remember.

Closes #197

For two days every structural roadmap edit — labels, milestones, sub-issue links, project additions, board moves — was attributed to @jwildfire's own account, across roughly a hundred issues he had not read. Issue and comment bodies were already correct, because the app token was passed to `gh issue create`; the pattern was never carried to the rest, and the ambient `gh` token authenticates as him. Existing events are left alone — they are history, and #197 is what explains them.

## Roadmap context

Harness defect on the obot.agent operational lane, milestone v0.5.0. It undercuts work the programme has spent two days building: the delivery record separates a call an agent made on his behalf from a decision he gave, decision artifacts mark a relayed answer `verbatim=false`, and a rename went to him as a proposal rather than being applied — all of it undone by a timeline saying he did it himself. Sharpest on hub#215, the requirement about not letting an agent's inference read as his approval, whose own timeline says he applied a label he has never seen.

## Evidence

<b>The done-when, read off the primary record rather than a passing test.</b> A new label added through the wrapper, on the <a href="https://github.com/jwildfire/obot.agent/issues/197">issue itself</a>:

<pre>
2026-08-18T03:39:54Z  labeled  actor=obotclaw[bot]  label=status:in-progress
</pre>

<b>This pull request is the second reading.</b> It was created, milestoned and labelled through the wrapper, so its own timeline is evidence for the creation, milestone and label paths.

<b>The platform limit, confirmed twice.</b> Empirically, the installation token gets <code>FORBIDDEN</code> "Resource not accessible by integration" on the board's node id and <code>NOT_FOUND</code> on <code>user(login:"jwildfire"){projectV2(number:1)}</code>. And from GitHub's own reference: every user-owned project endpoint carries "This endpoint does not work with GitHub App user access tokens, GitHub App installation access tokens, or fine-grained personal access tokens", and the <a href="https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps">App permissions reference</a> has no user-level Projects permission at all — only an organization one.

<b>Tests.</b> 13 new across two files, plus 2 new on the audit lane. The full suite is green except `tool-invocation.test.mjs`, which fails identically on `main` (six `node obot.agent/tools/config-count` lines) and is not touched here.

## Technical briefing

<b>`scripts/obot-gh`</b> — runs any `gh` command under a fresh installation token; stores nothing. Refuses `pr merge`, so it cannot become a hole in `merge-gate-guard` (that hook matches a bare `gh pr merge`, and `obot-gh pr merge` does not look like one to it). Refuses `project`, because the bot cannot sign a board write; `--as-jeremy --reason '<why>'` is the only route, and it records the write to `.claude/attribution.journal` and says on stderr whose name it goes out under.

<b>`hooks/attribution-guard.sh`</b> — PreToolUse guard. Two failure modes decide whether a guard like this survives, and both are tested. A guard that MISSES: it judges each command segment separately, so `obot-gh … && gh issue edit …` does not pass on the strength of its first half. A guard that FIRES ON PROSE gets switched off within a day and then protects nothing, so quoted spans and heredoc bodies are stripped before matching — command substitutions survive that stripping, because `GH_TOKEN="$(gh auth token)"` really does run `gh`, and laundering his credential is denied by name.

<b>The advice adapts to the checkout.</b> When `obot-gh` is not present (a machine that has not pulled — including `main` right now), the refusal names the inline `GH_TOKEN=$(obot-app-token)` form instead. A guard that refuses a write and then points at a command which is not there has replaced the class with a dead end, and the next agent works around the guard rather than the problem.

<b>The local audit apply lane</b> (`tools/session-hub/session-audit.mjs`) ran every apply on `gh auth token`. It applies a batch at a time, which makes it a plausible source of much of the ~100. Its Actions twin was already correct, and reading it caught a trap: `apply_audit_decision.mjs` takes `GH_TOKEN || GITHUB_TOKEN` for writes while `lib/gh.mjs` takes `GITHUB_TOKEN || GH_TOKEN` for reads — opposite on purpose. The apply re-runs the whole audit first, and an audit that cannot see the board skips every board rule and reports live findings as stale, throwing away a decision he actually made. All three credentials are load-bearing; the tidier one-token fix would have broken it silently.

<b>`scripts/test/write-lane.test.mjs`</b> fails if a new fenced command teaches a bare write. Agents do not invent `gh issue edit --add-label`; they copy it — which is exactly how the `bash ` prefix spread (#180). Fenced blocks only: inline prose stays free, or the paragraphs explaining this bug could not be written.

<b>Consequence worth knowing:</b> `--assignee @me` cannot be used through the wrapper. A GitHub App bot is not an assignable user — `GET /repos/jwildfire/obot.roadmap/assignees/obotclaw[bot]` is a 404 — so the assignee is named. Documented divergence from the upstream gsm.agent convention, which predates the bot identity.

<b>Already landed on the hub</b> (standing grant, direct to `main`): <a href="https://github.com/jwildfire/obot.roadmap/commit/0bc28fb">0bc28fb</a> updates the audit and ideas-triage policies and the two requirement skills.

## Next steps

<b>One decision is @jwildfire's and nothing here can make it.</b> Board moves cannot be attributed to the bot on any credential a GitHub App can hold. Either the board moves to an organisation — which lets the bot sign board writes, but changes the project number and does not carry existing items across, so they must be re-added — or it stays user-owned and board moves remain his, recorded as the counted exception this PR introduces. Doing nothing is a real option; the exception is now visible and countable rather than silent.

<b>The guard is already armed in the live workspace</b>, installed from this branch, and it correctly advises the inline-token form until this merges. Sessions started before it was installed do not have it — hooks load at session start.

<b>Not fixed here:</b> `~/.claude/settings.json` still carries blanket `Bash(gh api *)` / `Bash(gh issue create *)` / `Bash(gh pr edit *)` allow rules. The hook denies over an allow, so they are not a hole, but they are worth narrowing separately.

---

This PR was drafted by 👯🤖 W0043 (Claude Code using Opus 5) and reviewed by @jwildfire.
