<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/270 on 2026-08-20 -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Assignee: @me -->

## What this does

On 2026-08-18 @jwildfire said "no more than fifty percent of my weekly usage in any given night" — and nothing on this machine could have obeyed it, because nothing knew what the week had cost. This makes the spend measured on a cadence, states the threshold where it can be traced, and enforces it in three places that do not depend on an agent remembering.

Closes jwildfire/obot.roadmap#275

The requirement's premise needed one correction, and it changed the whole shape of the work: **the measurement was never missing.** `obot.roadmap/scripts/build_usage_data.py` has priced this machine's transcripts since July and the numbers were backfilled through 2026-08-19. What was missing is that **nothing ran it** — the session wrapup was its only heartbeat, the wrapup stopped when the model became a standing prime session, and the artifact sat five days old while the fleet spent a week's allowance in five nights. So this is a cadence and a threshold. No new measurement pipeline was built.

## Roadmap context

- Requirement: [obot.roadmap#275](https://github.com/jwildfire/obot.roadmap/issues/275) — "what the fleet spends is measured before it is spent", `top10`, milestone `2026q3`.
- Its three Done-when bullets, each answered below.
- The requirement is off the user-owned Project board. Board writes fail for every agent right now — the obotclaw App gets `FORBIDDEN` on a user-owned ProjectsV2 board and the only credential that works is the one the guard exists to deny ([obot.roadmap#252](https://github.com/jwildfire/obot.roadmap/issues/252)). Recorded here so it reads as a known blocked mechanism rather than an oversight.

### Done when: the Navigator can state, before dispatching, what tonight has cost and what the week has cost

The five-minute sweep rebuilds the priced artifact every ten minutes into `.claude/session-hub/cache/usage.json` — never into `obot.roadmap/site/usage/`, because a regenerated artifact in the hub clone leaves that tree dirty and a dirty tree makes the sweep's own checkout auto-update refuse. The generator takes ~3s, reads only local transcripts and touches no network.

The reading lands as a one-liner at the very top of `navigator-state.md`, above both ledgers — that block is what the Operations Dashboard's ops tab renders and what a dispatching agent reads first — plus a `## Spend` section carrying the whole ladder. No dashboard code was needed: sections render by heading.

### Done when: a threshold he set is enforced by something other than an agent's memory

| lane | mechanism | live? |
|---|---|---|
| `obot-auto` (the autonomous lead) | pre-flight check 2 runs `tools/spend-guard check`; exit 2 or 4 aborts the launch | yes |
| everything honouring the kill switch (`obot-auto`, the morning fold) | the sweep writes `.claude/autonomy-halt` on a stop, and lifts it again when the reading clears | yes |
| `worker-id claim` — every sibling spawn and every autonomous lead | refuses past the cap, before the journal is touched, so no id is burned | yes |
| an agent typing `claude --bg …` into a Bash call | `tools/spend-cap-hook`, a `PreToolUse` deny | **no — one approval away, see Next steps** |

The Navigator, prime and the admiral claim no worker id and are never gated. Blinding the surfaces that *report* the spend would be the worst possible way to control it.

### Done when: a week like this one produces a warning before it produces a stop

Rehearsed against the committed artifact for the week that ran out (`tools/spend-guard rehearse --as-of`):

| night (UTC) | verdict |
|---|---|
| 2026-08-14 | `spend: OK` — 14.9 of 50.0 points, week 15% |
| 2026-08-15 | `spend: OK` — 17.4 of 50.0, week 32% |
| 2026-08-16 | `spend: OK` — 14.7 of 50.0, week 47% |
| 2026-08-17 | `SPEND WARNING` — 43.0 points left this week, less than one full night's cap |
| 2026-08-18 | `NIGHTLY SPEND CAP BREACHED` — tonight has taken 31.6 of 23.4 available points |
| 2026-08-19 | `NIGHTLY SPEND CAP BREACHED` — the week is at 98%, past the 90% stop line |

A warning on the 17th, a cut-off during the 18th at roughly $968 of the $1,167 that night actually took, and a refusal on the 19th — which is the morning he stopped everything by hand.

## Evidence

- <a href="https://github.com/jwildfire/obot.agent/blob/spend/docs/spend-cap.md">docs/spend-cap.md</a> — the full account: the rule, the unit, the two readings, the ladder, where it is enforced and where it is read.
- <a href="https://github.com/jwildfire/obot.agent/blob/spend/config/spend.json">config/spend.json</a> — the declared policy. Every number carries a `_`-prefixed sibling saying where it came from.
- <a href="https://github.com/jwildfire/obot.agent/blob/spend/tools/navigator/test/spend.test.mjs">tools/navigator/test/spend.test.mjs</a> — 34 tests. The ladder is asserted against his real week rather than an invented one; a check that would have sat green through the week the requirement was written about is decoration.
- Full suite green: **1435 pass, 0 fail** (`node --test` over the six CI globs).
- Live reading on this machine, after the Thursday reset: `spend: OK — tonight 5.8 of 50.0 points, week 6% of 90% stop line.`

## Technical briefing

**The unit is a percentage point, not a dollar, and that is the whole denominator answer.** `~/.claude.json → cachedUsageUtilization` is Anthropic's own meter, cached by the CLI: `limits[]` carries the weekly bucket as a percentage with a `resets_at`. Every `limit_dollars` on this account is `null`, and Anthropic publishes no numeric weekly limit for Max — the support pages give only relative multiples of an unpublished Pro baseline. Any dollar allowance stated as fact would be fabricated, so the cap is counted in his own unit and there is no denominator to invent.

**Dollars become points through one dated calibration**, in `config/spend.json`: `weekly_all` at 99% fetched 2026-08-20T10:42:05.623Z, against $3,654.11 measured across the complete UTC days of that week → 1 point ≈ $36.91. It is an inference, labelled as one everywhere it prints, and conservative in two directions (it excludes the two partial days at the window edges that the projection does count, and prices at API list rates). And it maintains itself: every time the sweep sees a `fetchedAtMs` it has not seen before, it pairs that percentage with the dollars measured since the reset and records the result, and whichever of that and the shipped bootstrap is newer prices a point. Only above 20% of a week — one rounding step in an integer percentage moves a small ratio by tens of percent — and never from an expired reading. That is what lets it survive the "+50% weekly limits promo through Aug 31" active on the account, and a pricing or plan change nobody would edit a file for.

**Two readings, worst governs.** The meter sees the whole account — phone, web, claude.ai — but refreshes only when the CLI feels like it and knows nothing about a night. The artifact is fresh and per-night but prices only the obot2 workspace, so it is a floor. A meter reading whose `resets_at` has passed is `expired`, not current: believing the cached 99% after Thursday's reset would have halted a fleet with a full allowance in front of it, and that case is live on this machine right now.

**The night is the UTC day.** The generator buckets on `timestamp[:10]` of UTC stamps, and for America/New_York a UTC day opens at 20:00 the previous evening — so an overnight fleet dispatched after dinner lands entirely inside one bucket. That is the unit a nightly cap needs, and nothing here claims it is a rolling twelve hours.

**The ladder**, with only two declared parameters:

```
nightly cap = 50 points                     his sentence, verbatim
stop line   = 90 points of the week         his revealed halt: at ~95% he deferred everything
headroom    = min(nightly cap, stop line − week before tonight)

stop     week ≥ stop line, OR tonight ≥ headroom
warn     headroom < nightly cap (a full night no longer fits), OR tonight ≥ 80% of headroom
ok       otherwise
unknown  no reading, or no denominator
```

**`unknown` is never collapsed into `ok`**, and it has its own exit code so a caller can tell a refusal from a failure — #275 asks for that distinction by name. A broken measurement is not permission to spend.

**Two traps this program has already paid for, handled explicitly.** A check that cannot fail is not a check: the ladder is seeded with the real week and proven to fire, and the halt file, the guard exit codes and the hook deny each have a test that watches them trip. And the verdict is the first line of every output — of the guard, of the note, of the section — because callers summarise by first line, and when the config ledger printed its notes first the verdict vanished from nearly every sweep while looking perfectly healthy ([#129](https://github.com/jwildfire/obot.agent/issues/129)).

**The halt file is written on a measured breach only, never on `unknown`.** It is the broad instrument — the 07:00 morning fold honours it too, and the fold is a report rather than a dispatch. Blinding the surface that would tell him about a spending problem, because the spending reading broke, is the same mistake as gating the Navigator on its own reading. `unknown` still refuses at the gate that is specifically about dispatch.

**The halt file names itself.** A halt @jwildfire wrote is never touched; one this mechanism wrote is lifted on the next clear reading, because the allowance week resets on its own and nobody should have to remember to delete a file every Thursday.

## Next steps

- **One approval, and the last lane closes.** `tools/spend-cap-hook` is written and tested but not registered, because registering a hook means editing `hooks/` — a policy carve-out path, and therefore yours. When you want it, it is one row in `hooks/install.sh` (`"spend-cap-hook:PreToolUse:Bash"`) and the file moves to `hooks/`. Until then the agent-typed spawn lane is covered by `worker-id claim`, which every documented spawn passes through, and by nothing that could stop a spawn which skipped the claim.
- **The calibration is an inference and should be confirmed against a fresh meter reading.** It is dated and re-derived automatically, but the honest error bar is about ±10%: the meter is token-based with per-model weighting and this prices at API list rates, and it currently includes promotional limits that expire on 31 August.
- **`weeklyStopPercent: 90` is a reading of your behaviour, not of your words.** You called the halt at roughly 95%; 90 leaves a margin under that. Move it in `config/spend.json` if it is wrong.
- **The published `obot.roadmap/site/usage/usage.json` still refreshes only on a deliberate commit.** The sweep keeps the *reading* current; the public page does not move on its own. That is out of scope here and worth its own decision — an automated commit to the hub every ten minutes is noise, and a daily one is a small separate piece of work.

---

Drafted by 👯🤖 W0078 using Opus 5.
