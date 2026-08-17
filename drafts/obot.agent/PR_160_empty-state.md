<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/160 on 2026-08-17 06:48 BST -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Assignee: @me, Reviewers: @jwildfire -->

Every dashboard surface now renders honestly on a machine with no history — the state none of them had ever been seen in, and the one your new machine opens in later this week.

Closes #159

It was found by accident on 2026-08-16: a CI runner with no `~/.claude/jobs` failed a test, and the cause was real — with an empty roster the sessions brief lost both its feed and its link to the record. The local suite had passed 271 times because it was resting on this workstation's actual job history. That was one instance of a class, and this fixes the class.

Opened cold today, before this branch:

- The dashboard said `0 release candidates · 0 decisions · 0 config`, `Nothing is waiting on you.`, `All answered.` and `Nothing needs your keyboard.` — four verdicts about three files nobody had opened, one of them four lines above the page's own admission that it could not read the decision log.
- The agents roster showed `$0.00 spent` in the largest type on the page, directly above a column of cells each correctly reading *cost unavailable — no usage artifact*.
- The Navigator's sweep — the file 🎩🤖 prime reads and the Navigator tab renders whole — led with `RC queue: EMPTY [verified gh]` when every repo listing had failed, and `roadmap discipline: clean` computed from three lists that were empty because nothing could be opened.
- The live session view reported `0 agents` and `0 tokens across 0 reporting sessions` over a jobs directory that does not exist.

> The rule this encodes: a surface may print a figure only when it read the file the figure comes from. A zero and an unread file look identical on a page, and that confusion has cost this programme repeatedly. A measured zero is still a zero — the distinction is about unread sources, not small numbers.

## The design call, made deliberately

The requirement asked that this not be decided by accident. It is: shared vocabulary, per-surface placement. `tools/ops-dashboard/lib/absent.mjs` owns the words and the rule; each surface places them in its own markup.

- Not one shared component. The failure is a *claim* problem rather than a layout one, so a component would either impose an empty frame on a surface that legitimately has nothing to draw — the brief's feed and record link must survive an empty roster, not be replaced by a panel — or grow enough configuration to be that module with extra steps.
- Not per-surface wording either. That is how a page ends up saying "All answered" and "Decisions unavailable" in the same column.

## Roadmap context

- Requirement: [jwildfire/obot.roadmap#223](https://github.com/jwildfire/obot.roadmap/issues/223) — *every surface renders honestly on a machine with no history — before the move, not after*. Milestone `2026q3`, goal [#73](https://github.com/jwildfire/obot.roadmap/issues/73).
- Timing is the argument. The alternative is discovering this as a first impression on a machine bought to make the work better.

## Evidence

- <a href="https://github.com/jwildfire/obot.agent/blob/w0016-empty-state/tools/ops-dashboard/test/fresh-machine.test.mjs">tools/ops-dashboard/test/fresh-machine.test.mjs</a> — boots the real server as a child process with `HOME` pointed at an empty directory and reads every route over HTTP. No assertion in it can rest on this machine's history.
- <a href="https://github.com/jwildfire/obot.agent/blob/w0016-empty-state/tools/session-hub/test/fresh-machine.test.mjs">tools/session-hub/test/fresh-machine.test.mjs</a> — the same for the watch loop, including the frozen report and the published session indicator.
- <a href="https://github.com/jwildfire/obot.agent/blob/w0016-empty-state/tools/ops-dashboard/lib/absent.mjs">tools/ops-dashboard/lib/absent.mjs</a> — the vocabulary, the rule, and the design call written down where it will be read.
- 489 tests pass; `obot-policy validate` and the policy verdict sweep are clean.
- Seen in Chrome at a real 390px viewport, all five routes plus the live view. That found three things the tests could not: the honest sentences name absolute paths, and three of them ran off the right edge of the phone you read this on.

## What changed

- Absence and emptiness are held apart, and threaded through the model rather than re-derived in the view. By the time a renderer holds an empty array it can no longer tell an absent file from an empty one. `collectRoster` records which of its four sources it actually read; `collectJobs` distinguishes ENOENT — day one, blameless — from a real read failure; `safeJobs` returns `null` for a ledger that is not there. An empty worker ledger means no agent has claimed an id, an absent one means nothing can be attributed at all, and only the first supports *no agent has run*.
- Verdicts stop being passed over unread files. An absent delivery record is not a finding that nobody delivered, so those rows sit under *Finished, not judged*. `roadmap discipline: clean` becomes `NOT CHECKED` and names how many sources were unread. `RC queue: EMPTY [verified gh]` becomes `UNREAD`, with no stamp. Four sweep detectors that used to vanish from the state file when they could not run now print `NO READING`, because the section's own rule is that it reports even when clean so its silence cannot be read as health.
- The wake channel that landed on `main` while this was in flight had the same shape — `wake: clear — every worker that stopped has been judged`, with no ledger to have judged them from — and is fixed with it.
- Two things that leave the machine. The frozen session report is published to the hub and used to freeze three unread files into a green *0 agents, 0 tokens, 0 closures/releases* banner. And `sessionState`, behind the public roadmap page's session indicator, published `idle · 0 agents` — byte-identical to a machine that was genuinely quiet. It has a fourth state now.
- Day two is covered, because that is where the same defect kept reappearing in a subtler form. A usage artifact that opens fine and holds no cell for any of today's agents passed the "was it read" guard and produced `$0.00` again. The delivery record is two files, and keying its presence on one let the page deny a record two screens above a table built from the other. `every one delivered` rendered when nobody had been credited with anything. The headline's *produced nothing* counted agents still running, contradicting the row below it under *Running now*.
- Three sentences that were about you turned out to be about the machine: *first look*, from a visit record that is local-only and does not travel; *the hub clone is not a git repository*, printed identically for a path that does not exist; and a promise that the Navigator would pick your answer up within five minutes, on a machine where the sweep has never been installed.
- Two remedies were simply wrong on day one. `launchctl kickstart` answers *Could not find service* until `install-launchd` has run, and the sweep's own failure report could not be written at all, because the directory it lands in is created further down the success path — so a sweep crashing every five minutes looked exactly like one that was never installed.
- Seven existing tests pinned the old behaviour and now assert the distinction instead. Three are worth naming, because each one's comment already described the honest behaviour while its assertion required the dishonest one: `roster.test.mjs` asserted `/No agent has run/` directly beneath a comment ruling out exactly that reading; `render.test.mjs` required *no sessions in scope* inside its all-notices case; `sweep.test.mjs` required a failed detector to render nothing at all.

## Next steps

- Review on the branch, or open the dashboard against an empty `HOME` to see it as the new machine will.
- Not covered, and worth a follow-up if you want it: `tools/ops-dashboard/lib/feed.mjs` has a `~/.claude/jobs` default and no test file of its own, and `statusline.sh` degrades silently when `python3` cannot parse its payload — a real day-one condition before Xcode CLT.

---

This PR was drafted by 👯🤖 W0016 (Claude Code using Opus 5) and reviewed by @jwildfire.
