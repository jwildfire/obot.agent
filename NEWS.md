<!--
NEWS.md is the running release log and the draft of each release's notes.
Shape (per skills/rc-release-notes/SKILL.md): newest release first; every release
section opens with its demo-artifact link, then a text-only, functionality-first
account of what a user can now do. The GitHub release publishes from the section
here, copied verbatim, when the release is approved and tagged.
-->

# obot.agent v0.5.0 (Upcoming)

- **A reply now comes before the work that supports it.** After obot-prime answered one question in 31 silent minutes (bookkeeping, a long sibling briefing, and a post-spawn wrap-up all composed ahead of the reply), the responsiveness contract gained a mechanical turn-ordering rule: the first content block of any turn answering @jwildfire is text, a delegating turn's first tool call is the spawn, and all bookkeeping follows the reply. Prime additionally caps every turn at two tool calls before its first visible text, defers memory and state writes to after the ack, and composes briefings as pointers to on-disk artifacts rather than paraphrases. Briefing depth is unchanged — only its position in the turn moved. ([#102](https://github.com/jwildfire/obot.agent/issues/102))

# obot.agent v0.4.0

**See it move:** the [annotated v0.4.0 demo](https://jwildfire.github.io/obot.roadmap/reports/oa-v0.4-demo/) walks each change as a real terminal capture with the command that produced it.

v0.3.0 gave obot the ability to run unattended. v0.4.0 is about what that run costs you: a session opens before the model thinks, the dashboard is one click from any status line, write policy is one file instead of two drifting ones, the three things that used to park an overnight run on a permission prompt are fixed, and the release you are reading has a written contract behind it. Nothing in the session-command surface is removed or renamed.

## What's new

- **A session opens before the model produces a token.** The hand-off — the previous session's priorities, what is waiting on you, what changed overnight — is assembled by a shell script during command expansion, so it is already in the prompt at first paint instead of being rediscovered over several model round trips. `/session-init` and `/s-init` are now the same fast command, and `obot-auto` launches unattended leads through it too. ([#76](https://github.com/jwildfire/obot.agent/pull/76), [#77](https://github.com/jwildfire/obot.agent/pull/77), [#80](https://github.com/jwildfire/obot.agent/pull/80), [#81](https://github.com/jwildfire/obot.agent/pull/81) · hub [#91](https://github.com/jwildfire/obot.roadmap/issues/91), [#148](https://github.com/jwildfire/obot.roadmap/issues/148))

- **Every status line ends with a clickable hub link** — the live session ops hub inside the obot workspace, the deployed roadmap hub anywhere else — so the dashboard is one click from any session. The status line also became a tracked, installable artifact under `tools/statusline/` rather than one untracked file on one machine, and the watch loop can serve the live view over loopback so the link opens in Chrome instead of Finder. ([#52](https://github.com/jwildfire/obot.agent/pull/52) · hub [#24](https://github.com/jwildfire/obot.roadmap/issues/24))

- **A repo's write policy is one decision in one file.** Merge tiers and unattended-autonomy grants used to live in two files needing separate edits per repo, and they had drifted into a state neither could express. They are now one `policy.json` where a repo gets a single profile, `obot-policy explain <repo>` prints what that profile means in plain words, and branches match by role rather than by name — so a release branch called `master` or `site` needs no special-casing. ([#59](https://github.com/jwildfire/obot.agent/pull/59), [#61](https://github.com/jwildfire/obot.agent/pull/61) · hub [#18](https://github.com/jwildfire/obot.roadmap/issues/18), [#140](https://github.com/jwildfire/obot.roadmap/issues/140))

- **Overnight runs stop parking on permission prompts.** Spawned agents were handed a worktree path outside `.claude/worktrees/` — the only location Claude Code auto-approves — so each one waited for a click that, unattended, means until morning. A new triage table also tells you in one command why a session is missing from Remote Control, and the wrapup rebuilds the Analytics cost data before it posts so the spend page stops going stale. ([#69](https://github.com/jwildfire/obot.agent/pull/69), [#63](https://github.com/jwildfire/obot.agent/pull/63), [#67](https://github.com/jwildfire/obot.agent/pull/67) · hub [#18](https://github.com/jwildfire/obot.roadmap/issues/18), [#46](https://github.com/jwildfire/obot.roadmap/issues/46))

- **What needs you is the first thing a wrapup says.** Every wrapup output — checkpoint page, diary entry, morning digest, closing message — now opens with the release candidates awaiting review and the decisions awaiting your call, each linking its PR and its demo or decision artifact, with the work log underneath. Both lists carry forward until you close them, decisions post to the hub's Q&A discussions where you answer in-thread, and a risk named in a wrapup becomes a tracked issue carrying a proposed mitigation. ([#83](https://github.com/jwildfire/obot.agent/pull/83), [#85](https://github.com/jwildfire/obot.agent/pull/85), [#71](https://github.com/jwildfire/obot.agent/pull/71), [#72](https://github.com/jwildfire/obot.agent/pull/72) · hub [#142](https://github.com/jwildfire/obot.roadmap/issues/142)–[#144](https://github.com/jwildfire/obot.roadmap/issues/144), [#148](https://github.com/jwildfire/obot.roadmap/issues/148))

- **Releases now have a written contract.** `docs/rc-framework.md` states what reaches your review queue — release candidates and decision artifacts, nothing else — and what a candidate must carry, with a deployed demo page as a hard gate. The companion `rc-release-notes` skill puts the notes in a repo's `NEWS.md`, demo link first, and the tag publishes that section verbatim on approval. This file is that convention applied to obot.agent itself. ([#83](https://github.com/jwildfire/obot.agent/pull/83), [#86](https://github.com/jwildfire/obot.agent/pull/86) · hub [#123](https://github.com/jwildfire/obot.roadmap/issues/123))

- **Releases are now real, reviewable PRs.** A lagging `stable` branch, cut at v0.3.0, gives this repo what it never had: a base to propose a release against. Each release is a `main → stable` PR whose diff is exactly the release window, carrying the RC roles and merging only with explicit approval — the release you are reading arrives that way. The same decision set the program's governing principle (operational repos self-improve with automatic merges to `main` and periodic `stable` releases; user-facing clinical work is reviewed before prod) and the NEWS.md convention this heading follows: every repo keeps a NEWS.md current in `main`, unreleased work under a `(Upcoming)` heading. ([decision record](https://github.com/jwildfire/obot.roadmap/discussions/155))

- **The test suite runs in CI.** Every push and pull request now runs the full 112-test suite plus the policy-file validator on GitHub Actions — previously this repo had no CI at all, which mattered rather a lot for a repo whose merges to production are automatic. A red check now blocks a broken `main` instead of a morning surprise.

- **Prime remembers across restarts.** The standing Q&A session writes its durable state to a capped, provenance-stamped `prime-state.md`, and a cold session rehydrates from one read via `tools/prime-rehydrate` — including across midnight, which the first version got wrong and a same-night fix corrected. ([#91](https://github.com/jwildfire/obot.agent/pull/91), [#94](https://github.com/jwildfire/obot.agent/pull/94) · hub [#154](https://github.com/jwildfire/obot.roadmap/discussions/154))

- **`/grill-me` interviews you about a goal** — a resumable, multi-session elicitation interview that extracts what you want built, including the parts held tacitly, before requirements are filed. ([#96](https://github.com/jwildfire/obot.agent/pull/96))

- **Thirteen session commands have one-word aliases, and three are new:** `/s-idea` files a half-formed thought to the triage queue without derailing the session, `/s-reviews` walks the PRs waiting on a decision one at a time, and `/s-prime` runs a session as the standing question desk — a long-lived session that answers from warm context in seconds and delegates anything slower. ([#64](https://github.com/jwildfire/obot.agent/pull/64), [#84](https://github.com/jwildfire/obot.agent/pull/84) · hub [#48](https://github.com/jwildfire/obot.roadmap/issues/48), [#114](https://github.com/jwildfire/obot.roadmap/issues/114))

## Also in this release

- The roadmap audit queue costs no tokens until you click, and batches submit in parallel with per-agent worktrees so concurrent applies stop colliding. ([#55](https://github.com/jwildfire/obot.agent/pull/55), [#56](https://github.com/jwildfire/obot.agent/pull/56) · hub [#92](https://github.com/jwildfire/obot.roadmap/issues/92), [#109](https://github.com/jwildfire/obot.roadmap/issues/109))
- An upstream audit you can hand over: five ready-to-file `gsm.qtl` issue drafts, each with a runnable repro, at `drafts/gsm.qtl/`. Re-verified against current upstream on 2026-08-14; they stay drafts because agents do not write outside the `jwildfire` org. ([#62](https://github.com/jwildfire/obot.agent/pull/62))
- **Milestones stopped being optional.** No work starts on an issue until it carries a milestone, and a release names the issues it ships — `obot-merge` now refuses any merge whose `Closes` target has no milestone, and a release-branch merge whose body names no issue at all. The rule is written where an agent hits it before branching: `--auto` increment selection, the release-notes procedure and the RC checklist. safety.viz v1.6.0 shipped the night before this landed grouping none of the four issues it delivered. ([#89](https://github.com/jwildfire/obot.agent/issues/89) · hub [#123](https://github.com/jwildfire/obot.roadmap/issues/123))
- **A note on the merge lane.** Three `obot-merge` calls in this window were denied by the Claude Code auto-mode classifier and succeeded on a plain retry, which briefly looked like a threat to the whole unattended model. It was not: 3 denials in 99 real invocations, traced to the one command spelling the workspace permission allowlist did not cover. The allowlist rule landed on 2026-08-14 and the three merges that closed this release went through on the first attempt. Evidence and reasoning: [decision artifact](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-14-merge-lane-classifier-denials/).

## Tests and provenance

112 tests are green across the status line, session hub, serve loop, audit lane and the merge gate, up from 66 at v0.3.0 (`node --test tools/session-hub/test/*.test.mjs tools/statusline/test/*.test.mjs scripts/test/*.test.mjs`), and the suite now runs in CI on every push and pull request. Every capture on the demo page is real output from this machine with its reproduce command executed before publication.

# Earlier releases

Full notes for every earlier release live on its GitHub release page:

- [v0.3.0](https://github.com/jwildfire/obot.agent/releases/tag/v0.3.0) (2026-07-26) — autonomous sessions: `--auto` selects the next increment from the goal registry and runs it unattended; the idea queue; goal-driven selection.
- [v0.2.0](https://github.com/jwildfire/obot.agent/releases/tag/v0.2.0) (2026-07-15) — the session framework: lean bookends, the scratchpad heartbeat, and the sibling-spawn lane.
- [v0.1.0](https://github.com/jwildfire/obot.agent/releases/tag/v0.1.0) (2026-07-12) — first release of the agent-harness overlay.
