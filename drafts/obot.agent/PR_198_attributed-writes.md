<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/198 on 2026-08-18 00:52 EDT; body updated 2026-08-18 04:15 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: bug, Assignee: jwildfire -->

## What this does

Structural GitHub writes now go out as `obotclaw[bot]`, and the workspace refuses one that is about to run as @jwildfire instead of asking anyone to remember.

Closes #197
Closes #234

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

<b>Two defects found in this branch after it was opened are fixed here too</b>, both of them the guard being confident about something it had not checked.

<b>The first was measured on the terminal, not reasoned about.</b> An empty token is not an error:

<pre>
$ GH_TOKEN= gh api user --jq .login
jwildfire
</pre>

<code>gh</code> reads an empty <code>GH_TOKEN</code> as unset and falls back to the stored credential. The guard matched the prefix text and never asked whether a credential arrived, so a correctly written <code>GH_TOKEN=$(obot-app-token) gh …</code> whose mint failed ran, succeeded, and landed in @jwildfire's history — <a href="https://github.com/jwildfire/obot.agent/issues/207">#207</a>, one confirmed write. The mint is not the fault: all five of its failure modes exit non-zero with empty stdout. The shell is: a command substitution in an assignment <i>prefix</i> has its exit status discarded, and <code>set -e</code> does not see it. So the check had to move to the point of use.

<b>The second is <a href="https://github.com/jwildfire/obot.agent/issues/234">#234</a>, with the probe table in the issue.</b> A bare <code>gh api graphql</code> read was denied whenever a correctly attributed mutation shared the same Bash call, and the denial called that read a mutation — so an agent that checked its mutation line found the credential already there and had nowhere to go. One session took the wrong diagnosis far enough to nearly remove the <code>test -n "$T"</code> safety check from the sibling briefing.

<b>The one-character fix that issue proposes was measured before being adopted, and rejected.</b> Feeding the guard an unwrapped mutation with <code>MUTATION.search(seg)</code> in place returns <i>defer</i>: quoted spans are blanked before matching and a mutation lives entirely inside the quoted <code>-f query=</code>, so the check would have matched nothing and the guard's central case would have stopped firing silently. <code>split_segments</code> now returns spans instead of substrings, cut from two length-identical views of the same text — stripped for command shape, raw for the payload — which is what makes a per-segment mutation check possible at all.

<b>The effect, read off the guard itself rather than off a passing test.</b> Each command fed to both versions of the hook, verdict as returned:

<pre>
case                                              before   after
empty token in front of a write                   defer    deny
mint by substitution (cannot fail safely)         defer    deny
variable this call never assigned                 defer    deny
mint + check + write, one call                    defer    defer
bare graphql READ beside a prefixed mutation      deny     defer
unwrapped graphql mutation, alone                 deny     deny
the wrapper                                       defer    defer
</pre>

The last two rows are the invariants: the guard keeps its teeth on an unattributed mutation, and the sanctioned lane stays open. The three new denials are the ways a credential can be empty at the moment of the write; the one new deferral is #234.

<b>Tests.</b> 13 new across two files on the original defect, plus 2 on the audit lane; 7 more added here (5 on the credential check, 1 encoding #234's probe table, 1 pinning that a refusal describes a route that exists). Each was confirmed red against this branch before the fix: 5 failures on the guard, 1 on the wrapper. Full suite green — 1107 tests, 1107 pass, plus <code>obot-policy validate</code>.

## Technical briefing

<b>`scripts/obot-gh`</b> — runs any `gh` command under a fresh installation token; stores nothing. Refuses `pr merge`, so it cannot become a hole in `merge-gate-guard` (that hook matches a bare `gh pr merge`, and `obot-gh pr merge` does not look like one to it). Refuses `project`, because the bot cannot sign a board write; `--as-jeremy --reason '<why>'` is the only route, and it records the write to `.claude/attribution.journal` and says on stderr whose name it goes out under.

<b>`hooks/attribution-guard.sh`</b> — PreToolUse guard. Two failure modes decide whether a guard like this survives, and both are tested. A guard that MISSES: it judges each command segment separately, so `obot-gh … && gh issue edit …` does not pass on the strength of its first half. A guard that FIRES ON PROSE gets switched off within a day and then protects nothing, so quoted spans and heredoc bodies are stripped before matching — command substitutions survive that stripping, because `GH_TOKEN="$(gh auth token)"` really does run `gh`, and laundering his credential is denied by name.

<b>The guard judges the credential, not the spelling.</b> A <code>GH_TOKEN=</code> prefix used to admit the segment outright. Three shapes are now refused, each one a way the credential can be empty at the moment of the write: an empty assignment; a value from a command substitution, whose failure the shell hides; and <code>GH_TOKEN=$T</code> where nothing in the same command assigns <code>$T</code> and the environment does not carry it — because every Bash call gets a fresh shell, so the recommended spelling split across two calls is #207 again by another route. A literal, a variable that is genuinely exported, and a variable assigned earlier in the same command are all still admitted, as is the wrapper, which now enforces its own mint. The value is read off the raw segment: stripping quotes makes <code>GH_TOKEN="$T"</code> and <code>GH_TOKEN="ghs_real"</code> indistinguishable, and those are the two cases furthest apart in meaning.

<b>A hook cannot verify a token it will not be given</b>, which is why the check is shaped this way. It sees the command before it runs, so any attempt to confirm the credential is the App's rather than his would mean minting a different token and putting a GitHub API call in front of every write. What it can do is refuse the shapes in which an empty credential passes unnoticed, and name the two lanes that check their own mint — the wrapper and <code>obot-merge</code>, both of which now do.

<b>Every refusal describes a route that exists.</b> The old message told an agent to say out loud that a board write goes out under his name, on a checkout where the guard refuses that very command — an instruction that cannot be followed teaches the agent reading it to look for a way around the guard. Refusals now name the accepted spelling exactly, including that the mint has to travel in the same Bash call, and say plainly that the board deadlock is his decision (<a href="https://github.com/jwildfire/obot.roadmap/issues/252">roadmap#252</a>) rather than a hatch to take quietly.

<b>The advice adapts to the checkout.</b> When `obot-gh` is not present (a machine that has not pulled — including `main` right now), the refusal names the inline `GH_TOKEN=$(obot-app-token)` form instead. A guard that refuses a write and then points at a command which is not there has replaced the class with a dead end, and the next agent works around the guard rather than the problem.

<b>The local audit apply lane</b> (`tools/session-hub/session-audit.mjs`) ran every apply on `gh auth token`. It applies a batch at a time, which makes it a plausible source of much of the ~100. Its Actions twin was already correct, and reading it caught a trap: `apply_audit_decision.mjs` takes `GH_TOKEN || GITHUB_TOKEN` for writes while `lib/gh.mjs` takes `GITHUB_TOKEN || GH_TOKEN` for reads — opposite on purpose. The apply re-runs the whole audit first, and an audit that cannot see the board skips every board rule and reports live findings as stale, throwing away a decision he actually made. All three credentials are load-bearing; the tidier one-token fix would have broken it silently.

<b>`scripts/test/write-lane.test.mjs`</b> fails if a new fenced command teaches a bare write. Agents do not invent `gh issue edit --add-label`; they copy it — which is exactly how the `bash ` prefix spread (#180). Fenced blocks only: inline prose stays free, or the paragraphs explaining this bug could not be written.

<b>Consequence worth knowing:</b> `--assignee @me` cannot be used through the wrapper. A GitHub App bot is not an assignable user — `GET /repos/jwildfire/obot.roadmap/assignees/obotclaw[bot]` is a 404 — so the assignee is named. Documented divergence from the upstream gsm.agent convention, which predates the bot identity.

<b>Already landed on the hub</b> (standing grant, direct to `main`): <a href="https://github.com/jwildfire/obot.roadmap/commit/0bc28fb">0bc28fb</a> updates the audit and ideas-triage policies and the two requirement skills.

## Next steps

<b>One decision is @jwildfire's and nothing here can make it.</b> Board moves cannot be attributed to the bot on any credential a GitHub App can hold. Either the board moves to an organisation — which lets the bot sign board writes, but changes the project number and does not carry existing items across, so they must be re-added — or it stays user-owned and board moves remain his, recorded as the counted exception this PR introduces. Doing nothing is a real option; the exception is now visible and countable rather than silent.

<b>The guard armed in the live workspace is the copy from 17 August, not this branch's.</b> <code>.claude/hooks/attribution-guard.sh</code> is a file copy rather than a link, so both defects above are live in every session running right now, and nothing here changes that until this merges and the hook is re-installed. It was deliberately not updated in place: <code>hooks/</code> is a carve-out path, and arming unapproved code across every session is the thing the carve-out exists to prevent. Sessions started before an install do not have it either — hooks load at session start.

<b>That means a guard is live ahead of the escape hatch it points at, and it is worth naming rather than leaving for the next person to rediscover.</b> Until this merges, <code>scripts/obot-gh</code> does not exist on <code>main</code>, so the sanctioned route the refusal recommends is not installed. Nothing is blocked — the guard detects this and names the inline <code>GH_TOKEN=$(obot-app-token)</code> form instead, which is why that fallback exists — but the recommended route is dead for as long as this PR is open. It is the same shape as arming a skill symlink into a worktree before the skill lands: correct behaviour, live before the thing it depends on. It resolves on merge. The general lesson is that a guard and its escape hatch should arm together, and where they cannot, the guard has to detect which one it is living in — which is what the checkout-adaptive advice does and what its test pins.

<b>Also fixed here, and not this PR's defect:</b> <code>tool-invocation.test.mjs</code> was failing on <code>main</code> at this branch's exact merge base (<code>17e4f624</code>, run <a href="https://github.com/jwildfire/obot.agent/actions/runs/32090618374">32090618374</a>) over six lines documenting <code>tools/config-count</code> — mode 755 with its own <code>node</code> shebang — behind a <code>node</code> prefix. The six lines were brought to the assertion; nothing in the test was edited (<code>207f8a5</code>). Worth noting that the check did not catch it: <code>config-count</code> landed on <code>main</code> with the suite already red, so the test that exists for this habit was reporting a failure nobody was reading.

<b>Not fixed here:</b> `~/.claude/settings.json` still carries blanket `Bash(gh api *)` / `Bash(gh issue create *)` / `Bash(gh pr edit *)` allow rules. The hook denies over an allow, so they are not a hole, but they are worth narrowing separately.

---

Drafted by 👯🤖 W0043, extended by 👯🤖 W0049 (rebase) and 👯🤖 W0058 (Claude Code using Opus 5). Awaiting review by @jwildfire — <code>hooks/</code> is a carve-out path, so this merges only with his explicit approval and <code>--jeremy-approved</code>.
