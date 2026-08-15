<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/126 on 2026-08-16 00:58 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->

# The config list can lose an entry without anyone noticing, and its id allocator counts prose

## What happened

👯🤖 oa113 reported that config ids `c0010` and `c0011` were allocated but no entry for either exists anywhere in `.claude/blockers.md` — no `## Resolved` entry, no RETIRED note, no trace. Since the `blocker-log` contract is "resolved entries MOVE to `## Resolved`, never delete", that read as two entries leaving the file outside the lifecycle, with no way to recover them because the file is deliberately not in git.

**It was not a loss.** Reconstructed from session transcripts, minute by minute:

| time (2026-08-15) | session | what happened |
|---|---|---|
| 22:00:52 | 👯🤖 opsux | backs up `blockers.md` — ids present: `c0001`–`c0009`, nothing else |
| 22:02:17 | 👯🤖 opsux | rewrites the whole file with `p.write_text()`, hand-authoring every entry. The `c0003` body carries a **forward cross-reference**: "See **c0011** for the same problem in obot.agent" — an id it predicted but had not yet claimed |
| 22:03:15 | 👯🤖 opsux | runs `blocker-log` twice (its own echo headers read `=== c0010 ===` / `=== c0011 ===`). The allocator takes `max` of every `cNNNN` in the whole file, plus one; the prose `c0011` is now the max, so the two real items are filed as **c0012** and **c0013** |
| 22:03:55 | 👯🤖 opsux | rewrites the file again to correct the cross-reference `c0011` → `c0013`, erasing the only occurrence of `c0011` |

So `c0010` was never allocated or written at all — it was jumped over. `c0011` existed for 98 seconds, as prose, never as an entry. Every id that has ever identified an entry (`c0001`–`c0009`, `c0012`, `c0013`) is still in the file today. **Nothing was lost.**

## The three defects this exposes

**1. The allocator counts prose.** Matching `cNNNN` over the whole file text cannot tell an *identifier* from a *mention*. Any cross-reference, plan, or note above the current high-water mark silently burns ids — and burns them invisibly, since the evidence is a number that is simply absent. `nextConfigId()` in `tools/ops-dashboard/lib/collect.mjs` carries the identical bug.

**2. There is no lock.** `blocker-log` does read → compute → write with nothing guarding it, and several sessions write this file on a normal night (51 mutating calls across sessions in the transcripts). Two overlapping runs clobber each other and an entry is genuinely gone. This did not happen here; nothing stops it happening next time.

**3. Loss is silent.** The file is local-only by design — correct for its content, and it means no version history, no backup, no integrity check. A vanished entry leaves the id sequence lying about what ever existed, and nobody finds out.

## What to build

An **append-only allocation journal** at `.claude/blockers.journal`, written under an `flock`, which answers all three:

- **Allocation** comes from the journal's high-water mark and from *entry headlines*, never from body prose. Prose can no longer burn an id.
- **No reuse, ever** — the journal is permanent and append-only, so an id it recorded is never offered again even if the entry is later gone from the file. Stronger than today's rule, where deleting an entry frees its number.
- **Concurrency** — the whole read-modify-write happens inside the lock, with the file re-read *inside* it. This closes the clobber race that is currently wide open.
- **Detection** — every run compares journalled allocations against ids actually present, and the file's checksum against the last one the tool wrote. An allocated-but-absent id, or an edit made outside the tool, is reported loudly instead of vanishing.

Detection matters as much as prevention here, because an agent editing `blockers.md` with ordinary file tools bypasses the lock entirely and no amount of locking in this tool can stop that. The checksum notices it on the next run, which is the honest guarantee.

### Rejected alternatives

- **A local-only git repo under `.claude/`** — real history, but nothing enforces a commit after each write, so the hand-edit path (the one that actually happens) leaves the history lying. A nested repo also sits one `git add -A` away from being pushed, against a file whose whole point is that it never leaves this machine.
- **Timestamped snapshots on write** — only capture states the tool produced, so they miss exactly the bypass case; and retention becomes a policy nobody maintains. The journal keeps the useful part (a checksum per write) without the copies.
- **Detection alone in the Navigator sweep** — necessary but insufficient: it fires up to 5 minutes late and prevents nothing. Taken *as well*, via a cheap `--audit` the sweep or dashboard can call.

### Scope

- `tools/blocker-log` — lock, journal, honest allocation, loud audit on every run, `--audit` subcommand
- `tools/ops-dashboard/lib/collect.mjs` — `nextConfigId()` stops counting prose
- tests in `tools/ops-dashboard/test/`

Not in scope, and deliberately: **nothing in `blockers.md` is deleted or restored.** There is nothing to restore — no entry was lost — and the standing workspace rule is that agents never delete.

---

This Issue was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
