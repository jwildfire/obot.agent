<!-- STATUS: Drafted on 2026-08-18 10:35 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: type:task, Assignee: @me -->

## What this does

The bot's commit address ends in a nine-digit user id, and until now every tool and every session typed that number itself. Across the seven active checkouts, 1,068 commits carry the correct address, 101 carry a legacy form that also works, and 301 carry thirty-eight distinct fabrications — one of them reading `223456789`, twenty-six of them belonging to real GitHub accounts.

The id now lives in one module and is never typed. The live tool that was hardcoding a real user's id on every diary commit takes it from there. The five-minute sweep reports any agent commit whose author does not link to the bot. And there is a push wrapper, because the push was never a token problem.

Closes #241.

## Roadmap context

Sub-issue of [jwildfire/obot.roadmap#260](https://github.com/jwildfire/obot.roadmap/issues/260) — "git pushes and commits still go out as him, the lane no token fixes". Milestone v0.5.0.

This PR is the repo-side half. The half that changes git config, and the workspace settings that would carry it, is @jwildfire's to approve and is written up on #241 rather than done here.

## Evidence

Measured on this machine, 2026-08-18, across obot.agent, obot.roadmap, safety.viz, gsm.safety, open.gismo, open.csr and demo-301:

| form | commits | links to `obotclaw[bot]` |
|---|---|---|
| `299836032+obotclaw[bot]@users.noreply.github.com` | 1068 | yes |
| `obotclaw[bot]@users.noreply.github.com` (no id) | 101 | yes |
| 38 distinct wrong ids | 301 | no |

Both link verdicts were checked against live commits rather than assumed, and the answer is the reassuring one: GitHub matches the whole noreply address, not the numeric prefix.

- Correct id, [demo-301 `86ab1670`](https://github.com/jwildfire/demo-301/commit/86ab1670a5440118793867613672ca4308af7f4a) → `author: obotclaw[bot]`
- Wrong id, [demo-301 `9b152280`](https://github.com/jwildfire/demo-301/commit/9b152280802f87cb941e87263a129c76b9ddde72) → `author: null`
- Legacy id-less form, [obot.roadmap `072739b8`](https://github.com/jwildfire/obot.roadmap/commit/072739b8d8313a2acc57183ca2dcf263d6f8fc06) → `author: obotclaw[bot]`

So those 301 commits are unattributable, not credited to a stranger. That distinction is the difference between a cleanup and an incident.

The other direction: 110 commits are authored as @jwildfire while carrying an agent trailer — 106 `Co-Authored-By: Claude …`, 4 `Worker:`. 87 further commits are authored as him with no marker, and those are his.

Every commit in this PR was made with the environment form the design proposes, and lands as `obotclaw[bot] <299836032+obotclaw[bot]@users.noreply.github.com>`.

## Technical briefing

`tools/lib/identity.mjs`
- `BOT_USER_ID` and `BOT_EMAIL`, composed so the id and the address cannot disagree.
- `classifyEmail()` — canonical / legacy / wrong-id / not-bot, and `linksToBot()`.
- `identityEnv()` and `identityArgs()`, so no caller builds either by hand.
- `agentMarker()`, `misattributed()`, `scanCommits()`, `renderIdentity()`.

Why a module rather than a better-written constant: `skills/obot-identity/SKILL.md` has carried the correct number, next to the words "look-up not needed", since 2026-07-11. Thirty-eight fabrications happened anyway. Documenting the number more emphatically has been tried.

`tools/fold/lib/publish.mjs` hardcoded `219968887+obotclaw[bot]@…` — an id belonging to a real user — on every fold. Fixed and guarded by a test that reads the commit back rather than trusting the argv.

`tools/navigator/sweep.mjs` gains a `## Commit identity` section, beside the checkout stamp and above the RC queue. It reports when clean, names any checkout it could not read rather than counting it as clean, and caps each repo at five examples with the number it did not show — the first live run found 123 findings in a fourteen-day window. Headlines are spelled to match the dashboard's `ALARM_RE`, asserted in the test rather than eyeballed, and the existing `renderState` call-site guard now covers `identity` too.

`scripts/obot-push` mints and pushes over HTTPS as the bot. It refuses on an empty token instead of falling through to @jwildfire's keyring, refuses a remote outside the jwildfire org, and refuses `--force` and `--delete`. Its first real use — pushing this branch — found a defect in itself: `git push -u <url>` records the URL it was handed as the branch's remote, so the flag would have written a live installation token into `.git/config`. It did, once; the token was scrubbed by hand at the moment it was noticed, and the wrapper now handles `-u` itself and sets the tracking branch against the remote's name. That is a test.

Tests: 1,105 pass, `python3 scripts/obot-policy validate` clean. The scan test commits through real git rather than a fixture, because the sweep runs against real checkouts from launchd — and it is what proves the property the design rests on: the environment beats the checkout's own config, and beats `-c` on the same command line.

Coordinated with 👯🤖 W0059 (obot.agent#240, hub#256), which is adding a `## Local-only work` section to the same file: separate keys, separate modules, one adjacent `lines.push` block.

## Next steps

Three things on #241 need @jwildfire, and nothing here assumes any of them:

1. The four `GIT_*` variables in the workspace `.claude/settings.json` `env` block, and in `hooks/install.sh` so a fresh machine gets them. Both are governed carve-out surfaces.
2. The two repo-local wrong ids, in obot.agent and safety.viz.
3. An allowlist entry for `obot-push`, so it does not land on the auto-mode classifier.

Off the board — ProjectsV2 writes are refused for the App under [jwildfire/obot.roadmap#252](https://github.com/jwildfire/obot.roadmap/issues/252).

---

Drafted by 👯🤖 W0060 using Opus 5
