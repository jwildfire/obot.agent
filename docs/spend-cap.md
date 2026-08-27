# The nightly spend cap

What the fleet spends, measured before it is spent. Requirement
[obot.roadmap#275](https://github.com/jwildfire/obot.roadmap/issues/275).

## The rule

@jwildfire, dictated 2026-08-18:

> "no more than fifty percent of my weekly usage in any given night at this point."

And, an hour later, at roughly 95% of the week:

> "defer any heavy design or build work until next week when my limit resets. Same with all other work for the next couple of days."

The first sentence is the nightly cap. The second is where he actually stops, and it
is the weekly stop line.

## What was missing, and what was not

Not the measurement. `obot.roadmap/scripts/build_usage_data.py` has priced this
machine's transcripts since July. What was missing is that **nothing ran it**: the
session wrapup was its only heartbeat, the wrapup stopped when the model became a
standing prime session, and the artifact sat five days old while the fleet spent a
week's allowance in five nights.

So this is a cadence and a threshold. No new measurement pipeline was built.

## The unit is a percentage point, not a dollar

`~/.claude.json → cachedUsageUtilization` is Anthropic's own meter, cached by the
CLI. `limits[]` carries the weekly bucket as a **percentage** with a `resets_at`.
Every `limit_dollars` on this account is `null`, and Anthropic publishes no numeric
weekly limit for Max — the support pages give only relative multiples of an
unpublished Pro baseline. **Any dollar allowance stated as fact would be fabricated.**

So the cap is expressed in his own unit and there is no denominator to guess: a night
may consume at most 50 points of the weekly meter.

Dollars become points through a **calibration** — one real meter reading against the
measured spend behind it, in `config/spend.json`:

| | |
|---|---|
| reading | `weekly_all` at 99%, fetched 2026-08-20T10:42:05.623Z |
| measured | $3,654.11 across the complete UTC days of that week (08-14 → 08-19) |
| therefore | 1 point ≈ $36.91 of API-equivalent spend |

### It maintains itself

Every time the sweep sees a `fetchedAtMs` it has not seen before, it pairs the
**all-model** percentage with the dollars measured since the reset, records which
bucket that was, and writes the result to
`.claude/session-hub/cache/spend-calibration.json`. Whichever of that and the shipped
bootstrap is **newer** prices a point, and the section always names which one is in
force. A recording that does not say which bucket it came from is not trusted — it
may have been paired with a scoped percentage, and the two cannot be told apart after
the fact — so the bootstrap stands until a tagged one replaces it. Only above 20% of a week — one rounding step in an integer percentage moves a
small ratio by tens of percent — and never from an expired reading.

The lag is bounded by the cadence rather than argued about: the sweep sees a new fetch
within five minutes and the artifact is at most ten minutes old, so the dollars trail
the percentage by minutes. Trailing under-states dollars-per-point, which over-states
what a night has spent — conservative in the direction that trips.

The bootstrap is an inference, dated, labelled as one everywhere it is printed, and
deliberately conservative in two directions: it excludes the two partial days at the window edges
that the projection does count, and it prices at API list rates rather than at
whatever Anthropic's meter actually weighs. Both push the reading to trip sooner. It
is also inflated by the "+50% weekly limits promo through Aug 31" active on the
account — which is why it is re-derived from the live meter rather than frozen.

## The two weekly buckets

`limits[]` carries more than one weekly bucket and they are **not interchangeable**:

| kind | is | binds |
|---|---|---|
| `weekly_all` | what the client's own `/usage` prints as "Current week (all models)" | everything: the week position, the points, the calibration |
| `weekly_scoped` | one model's own allowance, with its own denominator | only itself — it refuses at the stop line on its own, by name |

`check` prints both, side by side, and says which one the points are measured
against. A scoped percentage is never mixed into the points arithmetic: the
workspace's dollars and one model's allowance are two different populations, and
pricing one against the other prices a point off nothing.

This is not hypothetical. Until obot.agent#331 the reading took `Math.max` across the
whole `weekly` group, so on 2026-08-27 Fable's 9% sat in the all-model field while
the all-model bucket read 5% in the same document — and the workspace had spent 100%
Opus that week, so the Fable bucket was driven entirely by usage the artifact cannot
see.

## The two readings

| | sees | blind to |
|---|---|---|
| **the meter** (`~/.claude.json`) | the whole account — phone, web, claude.ai | the night; per-agent detail; and it refreshes only when the CLI feels like it |
| **the artifact** (`build_usage_data.py`) | every night, every agent, rebuilt on the sweep's cadence | anything this machine did not record, so it is a **floor** |

**The meter measured everything up to the instant it was fetched, so the artifact may
only add what the meter has not seen.** It buckets by whole UTC day and cannot split
the day the fetch landed in, so the days it adds are the ones that began after that
day ended. A meter the CLI has not refreshed for a day or more is raised by every day
since, at full weight — which is the reason the projection exists.

Charging the whole window on top of a live meter is what read the week four times
high on 2026-08-27. The allowance week resets mid-day (15:00Z on a Thursday); the
artifact charged the seven-hour-old week a whole UTC day, of which $1,004.84 of
$1,040.81 had been spent before the reset.

Two fallbacks are unchanged, and both are the conservative direction. With **no
usable meter** the artifact projects across the whole window and governs alone. With
a meter carrying **no fetch instant** — which cannot be placed in time, so nothing
can be said about what it has seen — whichever of the two reads worse governs.

A meter reading whose `resets_at` has passed is **expired**, not current — believing
a 99% reading after a Thursday reset would halt a fleet with a full allowance in
front of it.

## The night is the UTC day

The generator buckets by `timestamp[:10]` on UTC stamps. For America/New_York a UTC
day opens at 20:00 the previous evening, so an overnight fleet dispatched after
dinner lands entirely inside one bucket — which is the unit a nightly cap needs. It
is not a rolling twelve hours and nothing here claims it is.

One night a week the UTC day contains the weekly reset, and on that night the night's
dollars include spend charged to the allowance week that just ended. The figure stays
— dropping it would let an unbounded night through — and `check` says so on the line
underneath rather than asserting a number it cannot support.

## The ladder

```
nightly cap   = 50 points                       (his sentence)
stop line     = 90 points of the week           (his revealed halt, config/spend.json)
headroom      = min(nightly cap, stop line − week before tonight)

stop     week ≥ stop line, OR tonight ≥ headroom          → dispatch refused
warn     headroom < nightly cap (a full night no longer
         fits), OR tonight ≥ 80% of its headroom          → dispatch allowed, loudly
ok       otherwise
unknown  no reading, or no denominator                    → dispatch refused, separately
```

`unknown` is never collapsed into `ok`. A broken measurement is not permission to
spend, and it gets its own exit code so a caller can tell a refusal from a failure.

### What it would have said during the week that ran out

Rehearsed against the committed artifact, `spend-guard rehearse --as-of`:

| night (UTC) | verdict |
|---|---|
| 2026-08-14 | `OK` — 14.9 of 50 points, week 15% |
| 2026-08-15 | `OK` — 17.4 of 50, week 32% |
| 2026-08-16 | `OK` — 14.7 of 50, week 47% |
| 2026-08-17 | `SPEND WARNING` — 43.0 points left, less than one full night's cap |
| 2026-08-18 | `NIGHTLY SPEND CAP BREACHED` — tonight took 31.6 of 23.4 available points |
| 2026-08-19 | `NIGHTLY SPEND CAP BREACHED` — week at 98%, past the 90% stop line |

A warning on the 17th, a stop during the 18th, a refusal on the 19th — which is the
morning he called the halt by hand.

## Where it is enforced

| lane | mechanism | live? |
|---|---|---|
| `obot-auto` (autonomous lead) | pre-flight check 2 runs `tools/spend-guard check`; exit 2 or 4 aborts the launch | yes |
| everything honouring the kill switch (`obot-auto`, the morning fold) | the Navigator sweep writes `.claude/autonomy-halt` on a stop and **lifts it automatically** when the reading clears | yes |
| `worker-id claim` — every sibling and every autonomous lead | refuses past the cap, before the journal is touched, so no id is burned | yes |
| an agent typing `claude --bg …` into a Bash call | `hooks/spend-cap-hook.py`, a `PreToolUse` deny | registered in the manifest — live on this machine once the installer is run |

The Navigator, prime and the admiral claim no worker id and are never gated: blinding
the surfaces that *report* the spend would be the worst possible way to control it.

The halt file names itself on its first line. A halt file @jwildfire wrote is never
touched; one this mechanism wrote is lifted on the next clear reading, because the
allowance week resets on its own and nobody should have to remember to delete a file.

The halt file is written on a **measured breach only**, never on `unknown`. It is the
broad instrument — the 07:00 morning fold honours it too, and the fold is a report
rather than a dispatch. Blinding the surface that would tell him about a spending
problem, because the spending reading broke, is the same mistake as gating the
Navigator on its own reading. `unknown` still refuses at the gate that is specifically
about dispatch: obot-auto's pre-flight exits on it.

### The hook is one approval away

`hooks/spend-cap-hook.py` is written, tested, and carried in the `hooks/install.sh`
manifest as:

```
"spend-cap-hook.py:PreToolUse:Bash"
```

Registering a hook means editing `hooks/`, which is a policy carve-out path, so the
pull request that added that row is on the **attested lane** — a guard that can deny
a spawn is @jwildfire's call and not an agent's.

Two separate things, and the difference matters: the row being in the manifest is not
the hook being live. It takes effect on a machine only when `hooks/install.sh` is run
there, which copies it into `.claude/hooks/` and registers it in the workspace
`settings.json`. Until the installer runs, the agent-typed spawn lane is covered by
`worker-id claim` — which every documented spawn passes through — and not by anything
that could stop a spawn that skipped the claim.

`hooks/install.sh --check` reports the difference rather than assuming it.

## Where it is read

- `.claude/session-hub/navigator-state.md` — one line at the very top, above both
  ledgers, plus a `## Spend` section with the whole ladder. The top line is what the
  Operations Dashboard's ops tab renders and what a dispatching agent reads first.
- The Operations Dashboard: the one-liner on `/`, the full section on
  `/navigator/record`. No dashboard code was needed — sections render by heading.
- `.claude/session-hub/cache/spend.json` — the cached verdict, for readers that must
  not pay for a node start (the hook, `worker-id`).

## The cadence

The Navigator sweep rebuilds the artifact every 10 minutes (`usageTtlMinutes`) into
`.claude/session-hub/cache/usage.json` — **never** into `obot.roadmap/site/usage/`,
because a regenerated artifact in the hub clone leaves that tree dirty and a dirty
tree makes the sweep's own checkout auto-update refuse. The published copy stays a
deliberate commit.

The generator takes about three seconds, reads only local transcripts and touches no
network.

## Commands

```bash
tools/spend-guard check                      # the verdict, first line; exit 0/2/4
tools/spend-guard check --json               # the whole ladder
tools/spend-guard check --halt               # also write/lift the halt file (the sweep's mode)
tools/spend-guard check --allow-unknown      # proceed past a reading that did not happen
tools/spend-guard rehearse --as-of 2026-08-18
```

## Changing the thresholds

`config/spend.json`, in a pull request. Every number in it carries a `_`-prefixed
sibling saying where it came from. That is the point: a threshold nobody can trace is
a threshold nobody can argue with.
