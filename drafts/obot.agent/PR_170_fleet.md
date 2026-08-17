<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/170 on 2026-08-17 08:12 BST, body updated with the completed cycle 08:14 BST -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->

Finished work stops moving and nobody notices. This wires the detector we already had to an actor, so the noticing stops being someone's job.

Closes #167

## What this is

The five-minute sweep detects; a short-lived `🚦🤖 fleet` acts and exits.

- **The trigger** — `tools/navigator/fleet.mjs`, pure functions over job records and an open-PR listing. Every condition is positive and computable.
- **The launcher** — `scripts/obot-fleet`, which owns the evaluation so what the state file shows and what actually launched can never disagree, and prints the `## Fleet` section the sweep folds in.
- **The contract** — `skills/fleet/SKILL.md`, the four rules, the never-list, and the order of work.
- **The mechanical half of correction 1** — `delivery-log verdict` now refuses the fleet actor outright.

## Why it exists, recorded the way the requirement asks

It answers a failure of the Navigator as much as of the concierge, and that is deliberate rather than blame-shifting: fleet hygiene keeps losing to larger mandates — translating asks, judging delivery, improving the machinery — because a broad role always has something more interesting to do.

Twice in two days, finished work stopped moving and @jwildfire found it both times. Six stalled sessions, several past twenty hours, four of them having already delivered before stalling. Seven open operational pull requests on a lane where agents are supposed to merge and fix forward. `claude agents` showed all six the whole time; GitHub showed all seven the whole time.

Detection was never the problem. Action was. So nothing here is a better detector.

## The four rules, and where each one actually lives

**1. A summary is built from GitHub, never from the session's own record.** In `skills/fleet/SKILL.md`, and proved end to end below rather than asserted. The brief the launcher writes deliberately carries no summary of any session and no opinion about any pull request — a brief arriving pre-summarised from local job state would be exactly this mistake wearing the launcher's authority. A test asserts the brief contains no `summary` and no `verdict` key.

**2. The trigger is a positive condition, never an absence.** `triggers()` returns `fired: false` on an empty fleet, and a test holds it there. Mutating `fired` to `true` fails four tests.

**3. It records call lines, actor-stamped, and never verdicts.** Enforced by the tool, not by the instructions: `delivery-log verdict` under `OBOT_ACTOR=fleet` exits 2 — "you may not do this", distinct from exit 1, "you got the arguments wrong". Call lines now carry the actor in the record @jwildfire reads, not only in the journal beneath it. A closeout gap is reported and left for the Navigator.

**4. The bar for landing a PR matters more than the mechanism.** Six conditions, all of which must hold, and the merge uses the undecorated single-command form from #162. The sweep applies the cheap half of the bar — operational repo, integration branch, not a draft, not a release candidate — and the manager applies the expensive half, which costs a call per pull request.

## Thresholds: measured against this machine's history, not guessed

The requirement asks for this explicitly, so none of these are round numbers picked for feeling about right.

| Bar | Value | What the record says |
|---|---|---|
| waiting / stalled | 180m | Longest worker block ever **resolved** here: 106m. Every span past that — 21h, 21h, 22h, a day — was never resolved and had to be closed by hand. |
| dead | 60m | It is not coming back. 60m still lets the wake channel, whose own floor for `dead` is 60m, reach the Navigator first. |
| PR idle | 120m | Open-to-merge median 3m in `obot.agent`, 17m in `obot.roadmap`; p75 24m and 83m; a >6h tail of 12 of 81. |
| closeout gap | 90m | Verdict latency median 11m, p90 57m, then a clean break to 376m and 738m — which are W0013 and W0007, the two named failures. |
| manager TTL | 30m | A manager with no time limit is a standing session that has not admitted it yet. |

These sit **on top of** wake.mjs's own grace periods rather than replacing them, so a value set below those floors has no effect. Recorded in the module, because otherwise the next person to tune one down concludes the detector is broken.

## Evidence

- **Full suite: 632 tests, 632 passing, 61 of them new.** One caveat, stated because it is the honest reading: `tools/ops-dashboard/test/serve-marker.test.mjs` failed earlier in this session and passes now, and nothing about it changed. It assumes port 7399 is free; when a real dashboard is bound to it the test's second instance lands on 7400 and the assertion misses. Reproduced red on a clean `origin/main` at `7f68cdf` with none of this branch's code. The Navigator has filed it as #173 — it is pre-existing, it is nondeterministic in the same shape as the merge refusals, and it is not this PR's to fix.
- **Eleven mutation tests, eleven caught.** Every safety property was broken on purpose to confirm the test fails: firing on an absence, admitting a clinical repo, admitting a release candidate, dropping the host-away guard, an alarm headline that stops matching the dashboard's regex, disarming the verdict guard, dropping the actor stamp, reporting an unreadable policy as a quiet fleet, dropping `fleet` from the policy-failure `renderState` call site, removing the unreadable-journal guard, and narrowing the terminal-state list back to `done` alone. A check that cannot fail is indistinguishable from no check.
- **A hollow test was found and replaced during that pass** — it set an env var nothing read, so it could never fail. `OBOT_FLEET_POLICY` was added so the no-readable-lane branch is reachable from a test at all.
- **The first draft failed loudly and correctly.** It read branch roles from a `roles` key the policy file spells `branches`, found no operational repo, and printed `FLEET TRIGGER BROKEN` rather than reporting a quiet fleet. That is the direction this house wants to fail in.
- **That last mutation found a real hole rather than confirming a guard.** Dropping `fleet` from the policy-failure call site left all 32 tests green, because `renderState` defaults it to null — so a forgotten call site renders a page with no fleet section and no error, which reads as nothing to report. The guard is now source-level, the same shape as `scripts/test/merge-invocation.test.mjs`, and asserts every call site passes both `wake` and `fleet`.

### The completed cycle

A real condition fired, a real manager launched, acted, recorded and exited. Installed is not running, so this is the bar.

**The setup.** A real worker, `W0031.1`, was spawned and told to do three things: post a genuine comment on #167, then tell its own session record it had produced nothing, then stall on a `needs input:` question about a histogram refactor. The irrelevance of the question is the point — nothing in the session's account of itself hints at what it actually did, so a manager cannot reach the right answer by accident. Its `output` field read `None`; `issuecomment-5312815631` sat on #167, timestamped `06:53:59Z`.

**The cycle.**

| | |
|---|---|
| Condition detected | `W0031.1 (job 5d05a498) has been waiting 10m, past the bar — needs: should I proceed with the histogram refactor?` |
| Launched | `07:05:20Z` — `🚦🤖 obot-fleet`, job `3661e697`, off the real trigger |
| Closed the session | `07:08:30Z`, verified by the probe leaving `claude agents --json` rather than by an exit code |
| Recorded | call `n0095`, actor-stamped `fleet`, in the real delivery record |
| Exited | `07:10:06Z` — **4m 45s against a 30m budget** |
| Fleet afterwards | trigger returns `nothing to act on`; the singleton is free, not stuck |

**What it wrote, verbatim, and this is the whole point of rule 1:**

> Closed W0031.1 (job 5d05a498), stalled 12m blocked on "should I proceed with the histogram refactor?". **GitHub shows one write it never mentioned: comment on obot.agent#167 (issuecomment-5312815631, 06:53:59Z). Its own final message claimed it produced nothing; GitHub is right and its record is wrong.** No worktree of its own and nothing uncommitted on disk. The pending question closes unanswered; it was synthetic (deliberate fleet-manager probe spawned by W0031).

It found the write the session denied making, checked the local disk as well as GitHub — the place 1,900 lines once went missing — recorded a `call` and not a verdict, landed nothing because nothing qualified, and exited well inside its budget.

**The clock, stated plainly.** The session bar was compressed from 180m to 1m for this run, via the documented `OBOT_FLEET_WAIT_MIN`. Nothing else was faked: a real session really stalled, the real launcher really evaluated, a real manager really closed it and really wrote to the delivery record. Only the wait was shortened, because the alternative was a three-hour test.

### Two defects the live running caught, neither reachable by reading the code

This is the argument for the cycle being the done-bar rather than a formality. Both are fixed, tested and pushed.

**1. An unreadable delivery journal read as an empty one.** A sandboxed integration run pointed `OBOT_WORKSPACE` at a fresh directory while keeping the real job ledger. `judgedWorkers('')` returned an empty set, an empty set is indistinguishable from "nothing has been judged", and every closed worker in the 24-hour window became a gap. It launched a real manager holding **twelve phantom gaps** for workers the Navigator had judged hours earlier. It was stopped inside a minute and verified as having written nothing — no delivery call, no scratchpad line, no GitHub write — because a gap is only ever reported. The same failure on a condition that *acts* is a manager closing a fleet on a missing file. Readability is now a fact carried separately from emptiness, and no reading means no detection, said out loud.

**2. The singleton tested `state !== 'done'` when the harness also uses `stopped` and `failed`.** Caught by the first real launch, which was refused: `held — a manager is already running (job 4c314e52, stopped)`. One manager stops and no manager ever launches again, while the launcher goes on reporting that the guard is working. That is the worst shape a failure can take here, and it was in the guard that had just been written.

### One finding that is not about the code

`.claude/skills/fleet` was symlinked into the worktree so the live cycle could run at all, which made unreviewed code loadable in every session in this workspace — the Navigator found it in its own available-skills list. It is now repointed at `obot.agent/skills/fleet`, the merged location, where the other twenty all point. It dangles harmlessly until this merges and then resolves by itself, so removing the worktree can no longer make the skill silently disappear. The general lesson is worth more than the fix: whatever adds a skill overlay should point at the checkout rather than at wherever the file happens to sit when it runs.

## What it may never do

Merge a release candidate. Touch a clinical repo — those are never even listed, so no code path reaches a merge decision for one. Publish anything. Edit a permission surface. Act outside the operational profile. Write a verdict. Close a session whose work it could not verify. It has no authority over the Navigator or the concierge.

## Two things that need your call

1. **The hard-ceiling kill is built but not armed.** The sweep reports a manager that overruns its 30m budget; past a 60m ceiling it can SIGTERM it, but only with `OBOT_FLEET_KILL=1`. Reporting is unambiguously wanted; terminating a process mid-write is not something to default on. Say the word and it ships armed.
2. **Whether fleet may land the PR that creates it.** Nothing stops it once this merges — `obot.agent` is operational and this would be an ordinary candidate. It felt wrong to let it merge itself as its own first act, so this PR is left for the standard lane.

## Next steps

- `.claude/skills/fleet` already points at `obot.agent/skills/fleet` and resolves on merge with no manual step. `commands/` is symlinked to the checkout, so `/s-fleet` needs nothing either. Nothing to do on merge beyond the merge.
- `#169` (pinning) takes the tag and session name from `MANAGER_TAG` / `MANAGER_NAME` rather than re-declaring them — W0034 has both. Worth knowing there: fleet is absent most of the time by design, so a permanently-empty pinned row must read as "no condition held" rather than "fleet is down".

---

This PR was drafted by 👯🤖 W0031 (Claude Code using Opus 5) and reviewed by @jwildfire.
