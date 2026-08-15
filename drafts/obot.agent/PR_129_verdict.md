<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/129 on 2026-08-16 01:40 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->

## What this is

The config-ledger check stopped showing its verdict the moment anyone edited `blockers.md` by hand. Caught live on the real sweep, not by reading the code.

## Roadmap context

Milestone v0.5.0, follow-up to #126 / #127. No separate issue — a defect in behaviour that landed hours ago.

## Evidence

`--audit` printed its notes before its verdict, and callers summarise by first line — the Navigator puts that line straight into `navigator-state.md`. After a header edit to `blockers.md`, the 01:29 sweep wrote:

```
config ledger: note - .../blockers.md changed outside this tool since it was last written (…)
```

The verdict was gone. Compare the 01:19 sweep, before the edit:

```
config ledger: ledger clean - 11 id(s) allocated, 11 present in .../blockers.md
```

This is the **common** case, not the exception: you tick items off by hand and agents fix cross-references, so an out-of-tool edit is normal — which is exactly why it is recorded as a note rather than an alarm. The line would have stopped reporting the ledger on almost every sweep from here on.

After the fix, run against the real (hand-edited) list:

```
blocker-log: ledger clean - 11 id(s) allocated, 11 present in .../blockers.md
blocker-log: note - .../blockers.md changed outside this tool since it was last written (…)
```

**248 tests pass, 0 fail** (was 245). 3 new: the verdict leads when a note exists, a gap still leads because it outranks any note, and the sweep keeps a note under a clean verdict.

## Technical briefing

- `tools/blocker-log` — the audit lane prints the verdict first, notes after. The first line is now the headline whether it reads `ledger clean` or `LEDGER GAP`.
- `tools/navigator/sweep.mjs` — `auditLedger()` kept `detail` only on failure, which would have dropped the note on every clean reading. It now keeps it either way: a note that the file was edited outside the tool is what **dates** a gap when one appears, and discarding it on the runs where nothing is wrong discards it on every run that precedes something going wrong.

The underlying split is unchanged and still right — a gap is an alarm and exits 1; an out-of-tool edit is context and exits 0. This is only about which of them gets the first line.

## Next steps

None. The `blockers.md` header has been brought in line with the journal semantics separately (local-only file, not in any PR).

---

Drafted by Claude Code using Opus 5 and reviewed by @jwildfire
