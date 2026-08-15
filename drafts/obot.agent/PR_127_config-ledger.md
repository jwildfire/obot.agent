<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/127 on 2026-08-16 01:26 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->

## What this is

The config list — `.claude/blockers.md`, everything only your hands can do — could lose an entry and nobody would find out. It now keeps an append-only ledger of every id it issues, written under a lock, and says so out loud when the ledger and the file disagree.

Closes #126

**Two ids, c0010 and c0011, were missing from the sequence. Nothing was lost.** Reconstructed minute-by-minute from the session transcripts:

| time (2026-08-15) | what happened |
|---|---|
| 22:00:52 | 👯🤖 opsux backs up the list — ids present: `c0001`–`c0009`, nothing else |
| 22:02:17 | it rewrites the whole file, hand-authoring every entry. The `c0003` body carries a **forward cross-reference**: "See **c0011** for the same problem in obot.agent" — an id it had predicted but not claimed |
| 22:03:15 | it runs `blocker-log` twice. The allocator takes the highest `cNNNN` *anywhere in the file*; the prose `c0011` is now the highest, so the two real items are filed as **c0012** and **c0013** |
| 22:03:55 | it corrects the cross-reference `c0011` → `c0013`, erasing the only occurrence of `c0011` |

So `c0010` was never written at all, and `c0011` existed for 98 seconds as prose. Every id that has ever named an entry is still in the file. **c0010/c0011 have no recoverable content because they never had any.**

## Roadmap context

Milestone v0.5.0. The list itself was approved as canonical on 2026-08-15 (BL1–BL4) with capture in oa#105 and read path in oa#106; this is the integrity layer underneath it. Nothing here changes what an entry looks like or how the dashboard renders one.

## Evidence

Looking for the cause turned up two further defects, and the fix answers all three.

**1. The allocator counted prose.** It now takes the next id from the journal's high-water mark and from *entry headlines*, never from body text. Write `c0099` in a `Why:` line and it is inert.

**2. There was no lock.** Capture is read → compute → write the whole file, and several sessions write it on a normal night. Measured against the unlocked tool with 24 concurrent captures:

```
trial 1: entries=20 distinct_ids=19 (expected 24 / 24)
trial 2: entries=5  distinct_ids=5  (expected 24 / 24)
trial 3: entries=22 distinct_ids=22 (expected 24 / 24)
```

Trial 2 destroyed 19 of 24 config items, silently; trial 1 also issued a duplicate id. The read-modify-write now happens inside an exclusive `flock`, and the test at that same size is green.

**3. Loss was silent.** Every run compares what the journal issued against what the file holds, and names any id that has no entry. Each record carries the **actor** and the file's **digest** — reconstructing this incident took a scan of every transcript in the workspace, and one journal line would have answered it.

Prevention stops at the tool's edge: an agent editing the file with ordinary tools bypasses the lock and nothing here can stop that. The digest notices on the next run. That is why detection is built alongside prevention rather than instead of it.

Rehearsed against a copy of your real list:

```
blocker-log: adopting .../blockers.md - the sequence already had 2 unaccounted id(s): c0010, c0011
  Recorded in the seed record, not treated as a loss: whether they ever named an
  entry cannot be known from the file. Everything from here is tracked.
blocker-log: filed c0014 under ## Open in .../blockers.md
```

**244 tests pass, 0 fail** (was 201). 12 are new. `blocker-log --audit` was run read-only against the real workspace; the file is byte-for-byte unchanged and no journal was created.

## Technical briefing

- **`tools/lib/blockers_ledger.py`** (new) — the ledger: `flock` helper, append-only journal I/O (`O_APPEND`, so even a writer that escaped the lock cannot overwrite a line), allocation, and the audit.
- **`tools/blocker-log`** — both writing lanes now run inside the lock and journal what they did; new read-only `--audit` lane whose **exit code is the verdict** (0 agree, 1 a gap), matching the contract every `Verify:` line already follows.
- **`tools/navigator/sweep.mjs`** — the 5-minute sweep shells `--audit` and carries the verdict into `navigator-state.md`. Shelled rather than reimplemented in JS on purpose: a second implementation is one more thing to drift, which is the class of bug this closes. It is reported *even when clean*, because a detector that only speaks on failure cannot be told from a dead one. A broken check never breaks the RC sweep.
- **`tools/ops-dashboard/lib/collect.mjs`** — `nextConfigId()` had the identical prose bug; now headline-anchored, and documented as the weaker of the two answers since it cannot see the journal.

Adopting a list that predates the journal happens once and is deliberately conservative: the high-water mark is read with the *old* whole-text rule, because with no history behind us a burned id costs nothing while a **reused** id makes a record ambiguous — and you approve these by number in chat. The holes the sequence already had are recorded in the seed record rather than normalised away, so the next person to notice `c0010` does not start this investigation from nothing.

## Next steps

- **Nothing in `blockers.md` was deleted or restored.** There was nothing to restore, and it is not an agent's call.
- One tail: the file's own header still says the next id is "one above the highest in the whole file (Open, Resolved and all)". That is true today and becomes false when this merges — worth correcting in the local file at that point. Flagging rather than editing your ledger by hand mid-review.
- `c0001` (the workspace allowlist line for `blocker-log`) is still open, and this session hit it repeatedly; `c0013` blocked every file edit here, so the whole change was written through shell heredocs.

---

Drafted by Claude Code using Opus 5 and reviewed by @jwildfire
