<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/332 on 2026-08-27 22:57 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Assignee: @me -->

## Summary

`spend-guard` reported 20% of the week used seventeen minutes after the client's own `/usage` reported 5%, and the guard does not merely report — it refuses. Two separate faults produced that number, and the one everybody suspected is not the one that produced it. The reading now matches `/usage` exactly on this machine, and no refusal path was made more permissive to get there.

Closes #331

## Which explanation was true

Both, and a third nobody had looked for. The issue offered two candidates — a scoped bucket misread as the all-model one, or the meter genuinely moving between the two readings — and asked for the question to be settled before anything was fixed.

- **The scoped misread is real.** `readMeter` took `Math.max` across every limit in the `weekly` group, which includes `weekly_scoped`. The machine's cached block at `2026-08-27T20:41:00.593Z` carries `weekly_all` at 5 and `weekly_scoped` (Fable) at 9, and the guard printed 9.
- **The "meter moved" explanation is refuted.** Both numbers came out of one fetch, with one `fetchedAtMs`. There was no second reading for it to have moved between; they were in the same document all along. `/usage` and the guard were reading the same cached block seventeen minutes apart.
- **Neither of them produced the 20%.** That came from the artifact projection, which the ladder takes the max of against the meter. The allowance week resets mid-day — 15:00Z on a Thursday — and the priced artifact buckets by whole UTC day, so a week seven hours old was charged the entire day of 2026-08-27: $1,040.81, of which $1,004.84 had been spent before the reset, against the week that had just ended. Fixing only the bucket misread would have moved the headline from 20% to 20%.

## Evidence

- Spend on 2026-08-27 split at the reset instant, measured from the transcripts with `build_usage_data.py`'s own pricing: whole UTC day $1,049.84 · before 15:00Z $1,004.84 · inside the new allowance week $45.00. The guard summed $1,040.81 for a week that was $45 old.
- The previous allowance week, 08-20T15:00Z → 08-27T15:00Z, ran $3,163.60 at 100% Opus 5 — $0.71 of Sonnet and no Fable at all. The Fable bucket the guard was reading as the week's position is driven entirely by usage the artifact cannot see.
- The calibration window is not a problem: whole UTC days overlapping the window price that week at $3,282.54 against a true $3,163.60, 4% high, because the errors at the two edges partly cancel. Left alone deliberately.
- Live reading after the fix, against the same cached block the client renders: `week: $1,053.90 measured, meter at 5% of the allowance (meter)` and `meter: all models 5%, Fable 9% (weekly buckets, one fetch at 2026-08-27T20:41:00.593Z)`. `/usage` at 20:24Z: 5% all models, 9% Fable.
- Every refusal path executed rather than reasoned about — a Fable bucket at 93% with all-models at 20% (exit 2, named in the headline), the all-model bucket itself at 94% (exit 2), a 5% meter with a $1,900 night on a day it had not seen (56%, exit 2), a meter with no fetch instant against a $3,600 artifact (98%, exit 2), no meter at all (98%, exit 2), and a reading that did not happen (exit 4).

## Technical briefing

- `readMeter` takes `weekly_all` for `percent`, records `bucket`, and keeps the highest bucket separately as `worst`. A scoped percentage never enters the points arithmetic: the workspace's dollars and one model's allowance are different populations.
- The projection may only add what the meter has not seen. The meter measured everything up to its fetch instant; the artifact buckets by whole UTC day and cannot split the day the fetch landed in, so it adds the days that began after that day ended. A meter the CLI has not refreshed for a day or more is still raised by every day since, at full weight — that is why the projection exists and it is unchanged.
- Two fallbacks unchanged, both conservative: no usable meter means the artifact projects across the whole window and governs alone; a meter with no fetch instant cannot be placed in time, so whichever of the two reads worse governs, as before.
- A model-scoped bucket past the stop line refuses on its own and by name. That is the conservatism the old `Math.max` bought by accident, kept on purpose.
- The denominator is calibrated against the all-model bucket and records which. The calibration this machine had recorded says `63%` with nothing saying which bucket, so it is no longer trusted and the shipped bootstrap stands — which prices a point at $36.91 against the recorded $51.30, so it trips sooner, not later.
- The night is still the whole UTC day and still counts every dollar in it. On the one night a week that straddles the reset, `check` says the night's dollars include spend charged to the week just ended rather than asserting a figure it cannot support.
- 50 tests in `tools/navigator/test/spend.test.mjs`, 9 of them new. The full suite is green apart from the style census, which fails identically on `origin/main` and for a reason in a sibling clone CI cannot see.

## Next steps

- No carve-out path was touched. `config/spend.json` gains one field, `"bucket": "weekly_all"`, recording what its own note already asserted about the bootstrap.
- Left undone and worth a separate issue: on a reset night the night's points still include pre-reset spend, so a heavy Thursday morning could stop a night whose new week is untouched. It is labelled rather than fixed, because splitting it needs sub-day granularity from `build_usage_data.py` in `obot.roadmap`, which is a different repo and a bigger change than this defect warrants.
- Also left: the guard writes a re-derived calibration on a plain `check`, not only under `--halt`, so a rehearsal against a fixture meter will overwrite the real one unless `OBOT_WORKSPACE` is set. It bit this session's own rehearsal.

---

This PR was drafted by 👯🤖 W0140 (Claude Code using Opus 5) in an unattended session, not yet reviewed by @jwildfire
