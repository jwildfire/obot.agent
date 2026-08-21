<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/287 on 2026-08-20 -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Assignee: @me -->

Every config item now opens by telling you what problem it fixes, instead of what to type.

Closes #286

## Roadmap context

You asked for this tonight, in these words: *"I need the config summarys to start with the 'why'. Why is this important? What problem does it fix?"*

It landed alongside the audit of whether the thirteen open items are still needed — deliberately, because the two questions are the same question. An item nobody can write a "why it matters" for is a strong candidate for not being needed at all.

## The trap, which was most of the work

This list already had a `Why`, and your own earlier rule keeps it **last**, because *"an item that opens with the mechanism is written agent-to-agent, and he triages by skimming"*.

Moving `Why` to the top would have satisfied your sentence exactly and produced precisely the opening that rule exists to stop. So it was read as the **stakes** — what breaks if you never do it — which is what `Unblocks` already meant: *"what it buys, in his terms"*.

`Unblocks` is therefore **renamed and promoted**, not joined by a second field. Two fields both meaning "why" drift apart, and the hand-written one is the one that goes stale. `Unblocks:` is still read as an alias, so nothing stops parsing and most entries' existing wording promoted as-is.

## What changed for you

- Every open item and every card now opens with one plain sentence: *"Your GitHub history goes on recording structural edits you never made"*, *"Every hub edit an agent makes goes through a shell workaround that mangles content"*, *"The two events allowed to interrupt you get written down and may never reach you"*.
- All seven open items were backfilled, and all seven cards re-rendered. Each holds at a real 390px viewport with **Why this matters** as its first heading.
- The card's old **Buys you** strip item is gone. It was the same fact written twice, in the copy that could drift.

## Evidence

- <a href="https://github.com/jwildfire/obot.agent/issues/286">Issue #286</a> — the ask and the trap, written down before the change
- Full `obot.agent` test suite green after rebase onto `main`, including seven new tests
- Every card measured in a real 390px iframe: `scrollWidth` 390, no horizontal scroll, `Why this matters` first heading on all seven

## Technical briefing

- `--matters` is required and **checked**, the same doctrine as `--do` / `--expect` / `--verify`: enforced at capture, never patched up in the renderer. A line opening with a command, a path, a flag, a bare mechanism (*"the classifier …"*) or a *"because …"*, or too short to be a sentence, is refused with **every** reason at once — one at a time turns a rewrite into a guessing game.
- What the bar cannot catch is a grammatical sentence that says nothing. The help says so, so a pass never reads as a compliment.
- `--set-matters cNNNN --text '…'` writes or replaces an entry's lead inside the flock and journals it. Backfill needed a real mechanism: a hand edit bypasses the lock and moves the digest the ledger watches, so the next run reports a change it cannot account for.
- The parser orders its labels **longest-first**. `Why` is a prefix of `Why it matters`, and an unordered alternation would have filed the stakes as the mechanism, silently. There is a test for exactly that case.
- The card reads the line from `.claude/blockers.md` rather than from the prose file, so the first thing you read is the one the capture bar enforced and it cannot drift from the entry.
- One pre-existing bug fixed on the way through: raw-entry cards did not wrap long paths, and c0003 measured **532px wide in a 390px viewport** from a single absolute path in its `Verify` line.

## Next steps

- Nothing here needs you. This is `tools/`, not a carve-out path, so it lands on the standard lane.
- One sharp edge left alone and worth knowing: `blocker-log`'s dedup probe searches the whole file including its own seeded header, so a headline like "An item" collides with the boilerplate sentence *"an item belongs here only if …"* and the capture is refused. It fails loudly rather than silently, so it is a papercut rather than a defect — but it is real and it is not filed.

---

Drafted by 👯🤖 W0090 using Opus 5.
