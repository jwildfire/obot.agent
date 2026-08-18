<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/201 on 2026-08-18 01:02 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, type:task -->

Requirement: jwildfire/obot.roadmap#238 — the morning fold, and the briefing it produces.

## This is already broken, and has been for two weeks

`findSessionMarker()` scopes the dashboard's Agents and Roadmap-activity panels to the current session by reading a `<!-- session-init … -->` comment out of the day's scratchpad. The marker was written by hand, by the model, as step 3 of interactive session-init. Nobody runs interactive session-init any more.

The last scratchpad containing one is `2026-08-04.md`. Every day since has had none. The consequence is not an error — it is a value: the boundary resolves to local midnight, the panels widen to the whole day, and their labels keep reading "since session start" while showing since-midnight data. The only signal anywhere is one clause in the page footer, which currently reads `boundary: no marker → local midnight`, and which nothing reads.

The requirement calls this "the one genuinely silent break in this migration". It was right about the mechanism and wrong about the tense.

There is a second consequence nobody has recorded. The session-report slug is derived from the marker's `session #N`, defaulting to 1 when absent — so with no marker, every session of a day resolves to the same slug and `--report` overwrites the previous session's frozen record. `reports/sessions/` holds `2026-07-24.html` alongside `2026-07-24-3.html` from when this worked.

## What this task does

**Writes the marker.** The fold stamps the day boundary into the scratchpad under `## Overview`, following `tools/scratchpad-log`'s discipline exactly — read lines, locate the heading, insert, write back — because the scratchpad is shared by the lead, every sibling and every unattended job, and a 07:00 write racing a night sibling's append is a lost-write window this must not widen. The timestamp is shelled.

Two details that are easy to get wrong and expensive to get wrong:

- `findSessionMarker` takes the **last** match in the file, not the first. A marker appended at the bottom wins over one at the top, in both directions.
- The marker's instant is the **fold**, not midnight. The fold is what defines where one day's record ends and the next begins: it has just folded the overnight work into the diary and the briefing, so the live dashboard should start the new day there. Writing midnight instead would leave the fold's own subject matter sitting in the panel it was just reported out of.

**Makes its absence loud.** A boundary that degrades silently will degrade silently again the first morning the fold does not fire — the machine sleeps, and there are eight observation gaps over fifteen minutes in the last three days alone. So: a notice on the model (the notices object enumerates jobs, agentsCli, scratchpad, nextSession, ghSweep and nothing about the boundary), and a visible render, not a footer clause. The panel labels stop claiming "since session start" when they are not.

**Closes the slug collision**, so a second session's report stops overwriting the first.

## Acceptance

- With the marker present, the dashboard's boundary anchors to it; the four existing `findSessionMarker` tests and the `resolveBoundary` tests stay green.
- With the marker absent, the page says so where someone will see it — a rendered notice, not the footer string. Verified by rendering with and without and diffing what a reader sees.
- Two sessions on one day produce two distinct report files again.
- The fold's write is heading-anchored and survives a concurrent append. Never `Write` the scratchpad wholesale.
- Rewriting the marker invalidates the gh-sweep cache keyed on the boundary, so it forces exactly one cold sweep per morning. That is fine once a day and would not be fine every five minutes — the write happens at the fold and nowhere else.

## Not this task

Retiring or deprecating session-init, which still writes this marker when someone runs it and is explicitly out of scope for the whole requirement — [#240](https://github.com/jwildfire/obot.roadmap/issues/240) owns every retirement. This task adds a second writer, it does not remove the first.

---

Filed by 👯🤖 W0045 (Claude Code using Opus 5). Not reviewed by @jwildfire.
