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

Every time the sweep sees a `fetchedAtMs` it has not seen before, it pairs that
percentage with the dollars measured since the reset and records the result to
`.claude/session-hub/cache/spend-calibration.json`. Whichever of that and the shipped
bootstrap is **newer** prices a point, and the section always names which one is in
force. Only above 20% of a week — one rounding step in an integer percentage moves a
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

## The two readings

| | sees | blind to |
|---|---|---|
| **the meter** (`~/.claude.json`) | the whole account — phone, web, claude.ai | the night; per-agent detail; and it refreshes only when the CLI feels like it |
| **the artifact** (`build_usage_data.py`) | every night, every agent, rebuilt on the sweep's cadence | anything this machine did not record, so it is a **floor** |

Whichever reads worse governs. A meter reading whose `resets_at` has passed is
**expired**, not current — believing a 99% reading after a Thursday reset would halt
a fleet with a full allowance in front of it.

## The night is the UTC day

The generator buckets by `timestamp[:10]` on UTC stamps. For America/New_York a UTC
day opens at 20:00 the previous evening, so an overnight fleet dispatched after
dinner lands entirely inside one bucket — which is the unit a nightly cap needs. It
is not a rolling twelve hours and nothing here claims it is.

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
| an agent typing `claude --bg …` into a Bash call | `tools/spend-cap-hook`, a `PreToolUse` deny | **not installed** — see below |

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

`tools/spend-cap-hook` is written and tested but not registered, because registering
a hook means editing `hooks/` — a policy carve-out path, and therefore @jwildfire's
to approve. When he does it is one row in `hooks/install.sh`:

```
"spend-cap-hook:PreToolUse:Bash"
```

(and the file moves to `hooks/`). Until then, the agent-typed spawn lane is covered
by `worker-id claim` — which every documented spawn passes through — and not by
anything that could stop a spawn that skipped the claim.

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
