<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/248 on 2026-08-18 11:18 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Assignee: @me -->

## What this does

The commit-identity scan shipped in #244 had two ways to read a commit it could not parse as a clean one. Both are closed, and a record that does not parse is now counted and reported rather than skipped.

Closes #247.

## Roadmap context

Sub-issue of [jwildfire/obot.roadmap#260](https://github.com/jwildfire/obot.roadmap/issues/260), following [#241](https://github.com/jwildfire/obot.agent/issues/241) / [PR #244](https://github.com/jwildfire/obot.agent/pull/244). Milestone v0.5.0.

Found because 👯🤖 W0059 passed back the shape of a bug in its own check ([#245](https://github.com/jwildfire/obot.agent/issues/245)) rather than only fixing it: anywhere a failed read produces a default that a later comparison treats as real, the same door is open. It was open here, in two places. No test either of us had written would have found it.

## Evidence

The two doors, both silent, both in the direction that matters:

- A record that came back with fewer than seven fields defaulted its two trailer fields to `''`. `agentMarker()` then returns `null` and the commit drops out of the scan with no trace — a failed read wearing the shape of a healthy one, in the one place whose entire job is to notice something.
- The subject sat fifth in a separator-delimited record and is the only free-text field in it. A commit subject containing the separator shifted every field after it, landing the `Co-Authored-By` value in the `Worker:` slot and the `Worker:` value off the end — so a real agent commit read as clean.

The second is verified rather than argued: the new test commits an actual `\x1f` byte in a subject through real git. Against the previous format it produces eight fields, `worker` comes back empty, and the commit is not raised. Against this one the trailer stays in its own field and the finding is raised.

Live output over the seven checkouts is unchanged — no real record hits either path today, which is the point: this is the failure that would have been invisible when it did.

1,148 tests pass; `python3 scripts/obot-policy validate` clean.

## Technical briefing

`tools/lib/identity.mjs`
- The subject moves to the end of the record and is rejoined from everything past the sixth field, so it can hold the separator without shifting anything.
- A record with fewer than seven fields returns `{ unreadable: true }` instead of a commit with defaulted trailers.
- `misattributed()` counts `unreadable` separately and never judges those records.
- `renderIdentity()` reports them under the `COMMIT IDENTITY READING BROKEN` headline — unknown, not clean.

`skills/obot-identity/SKILL.md` records the consequence of `obot-push` refusing `--force`: a branch the wrapper has pushed cannot be rebased and re-pushed through it, so merge the integration branch forward instead. The refusal stays, per 🧭🤖 obot-navigator on 2026-08-18 — an escape hatch on a force-push tool gets used once for a good reason and then always. Written down so the next worker meets it as a documented constraint rather than a surprise.

## Next steps

The three asks on [#241](https://github.com/jwildfire/obot.agent/issues/241#issuecomment-5326227949) are unchanged and still @jwildfire's: the `env` block, the two repo-local wrong ids, and the `obot-push` allowlist entry. Ask 2 is the one that collapses the finding count — 85 of the 123 findings come from a single wrong id in `obot.agent`'s own `.git/config`.

Off the board — ProjectsV2 writes are refused for the App under [jwildfire/obot.roadmap#252](https://github.com/jwildfire/obot.roadmap/issues/252).

---

Drafted by 👯🤖 W0060 using Opus 5
