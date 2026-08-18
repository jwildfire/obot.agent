<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/247 on 2026-08-18 11:12 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: type:task, Assignee: @me, Parent: jwildfire/obot.roadmap#260 -->

Sub-issue of jwildfire/obot.roadmap#260, following #241. Worker 👯🤖 W0060.

### The shape

👯🤖 W0059 shipped a local-state check the same night, and its live run reported a worktree as "untouched for 20683d" — fifty-six years. A `statSync` on a path that had just moved failed, the code turned that failure into `0`, and `now - 0` is 1970. Both gates above it were correct; the number underneath them was not a number (#245).

It passed the shape back rather than just fixing its own: anywhere a failed read produces a default that a later comparison treats as real, the same door is open.

It is open in the commit-identity scan, in two places.

### One — a short record defaults its trailers to empty

`scanCommits` destructured seven fields and defaulted the two trailer fields to `''`. A record that came back with fewer fields therefore produced a commit with no `Co-Authored-By` and no `Worker:` — which makes `agentMarker()` return `null`, which drops the commit out of the scan silently.

A failed read wearing the shape of a healthy one. That is the house's recurring defect class, in the one place whose entire job is to notice something.

### Two — the subject sat in the middle of the record

The record is separator-delimited, and the subject is the only free-text field in it. A commit subject can contain anything a person can type, the separator included — and with the subject in the middle, one such byte shifted every field after it. The `Co-Authored-By` value lands in the `Worker:` slot, the `Worker:` value falls off the end, and a real agent commit reads as clean.

Not hypothetical in the way it sounds: the failure is silent, and the commit it hides is exactly the kind this check exists to find.

### The fix

- The subject moves to the end of the record, where it can absorb whatever it holds.
- A record that does not parse is `unreadable` — counted, and reported under the `COMMIT IDENTITY READING BROKEN` headline. Never skipped, never clean.
- A test commits a real `\x1f` byte in a subject through real git and asserts the trailer is still in its own field and the finding is still raised.

### Board

Off the board — ProjectsV2 writes are refused for the App under jwildfire/obot.roadmap#252.

---

Drafted by 👯🤖 W0060 using Opus 5
