<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/203 on 2026-08-18 01:02 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, type:task -->

Requirement: jwildfire/obot.roadmap#238 — the morning fold, and the briefing it produces.

## Why it stopped

The ideas backstop sweep last ran on 14 August. The watermark file proves it: `.claude/ideas-watermark` reads `2026-08-14T21:33:59Z` and its mtime is the same instant.

It stopped because its only automatic trigger lived inside the interactive kickoff's recon sibling, and that lane has not run since 4 August. Nothing scheduled invokes it.

It is a backstop, not a front line — the hub's ideas-triage Action handles each new post within minutes — so the expected result on most mornings is nothing. That is exactly why it went unmissed for four days.

## What this task does

The fold runs the sweep and reports what it found in one line.

`scripts/ideas-sweep` is already read-only, needs no TTY, and was confirmed to run clean non-interactively. The work is in the parts around it:

- **Do not run the Reminders ingest from the fold.** `scripts/reminders-to-ideas` shells `osascript` into Apple Reminders and the skill itself warns it can stall on a permission prompt. At 07:00 there is nobody to answer that prompt. Either drop the step or run it under a timeout and treat a stall as a line in the briefing.
- **Distinguish empty from broken.** The sweep prints nothing and exits 0 in both cases — verified today. The category id is hardcoded; if it ever changes, the sweep reports "no new ideas" forever and looks healthy. Assert a non-zero total for the category before believing an empty result.
- **Advance the watermark to what was actually swept.** `--advance` stamps `date -u` at the moment it runs, not the newest `updatedAt` it saw, so anything updated between the read and the advance is skipped permanently. In a fold where those are seconds apart this is a real race; capture the maximum `updatedAt` from the sweep output and write that.
- **Check the page bound.** The query takes the fifty most recently updated and filters client-side, so more than fifty updated since the watermark truncates silently. Fine today with a four-day watermark and thirty-three discussions; not fine after an outage.
- **Two credentials, one pass.** The sweep reads on the ambient `gh` token; posting a triage reply is obotclaw[bot] via `scripts/obot-app-token`, minted once for the batch. A cron environment holding neither will still see some steps exit 0. Verify the effect — a posted comment URL — not the exit code.

Triage that needs judgement is not the fold's job. The fold surfaces the count into the briefing's todo lines and leaves the reply to whoever picks it up; the seven-step interactive procedure stays where it is.

## Acceptance

- A morning with no new ideas costs one line and one sentence in the run log, and advances nothing it should not.
- A morning with new ideas surfaces the count on the briefing with a link to the queue.
- A broken sweep — wrong category, no token, network failure — reports as broken and not as empty. Demonstrated by breaking it deliberately.
- The watermark, after a fold, equals the newest `updatedAt` the sweep actually returned.

## Not this task

Editing `skills/session-inbox/SKILL.md` to name the fold, or any other re-homing note — [#240](https://github.com/jwildfire/obot.roadmap/issues/240) owns those, and this requirement retires nothing. Call the sweep from the fold and leave the skill alone.

---

Filed by 👯🤖 W0045 (Claude Code using Opus 5). Not reviewed by @jwildfire.
