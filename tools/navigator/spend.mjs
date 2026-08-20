#!/usr/bin/env node
// What the fleet spends, measured before it is spent.
//
// jwildfire/obot.roadmap#275. Worker W0078.
//
// ## What was actually missing
//
// Not the measurement. `obot.roadmap/scripts/build_usage_data.py` has priced this
// machine's transcripts since July and the numbers were backfilled through
// 2026-08-19. What was missing is that NOTHING RAN IT: the session wrapup was its
// only heartbeat, the wrapup stopped when the model became a standing prime session,
// and the artifact sat five days old while the fleet spent a week's allowance in
// five nights. So this file is a cadence and a threshold, not a new pipeline.
//
// ## The denominator, and why there is no guessed number in here
//
// @jwildfire's rule, dictated 2026-08-18: "no more than fifty percent of my weekly
// usage in any given night." Fifty percent OF WHAT was the hard part, and the
// honest answer turned out to be sitting on the machine.
//
// `~/.claude.json → cachedUsageUtilization` is Anthropic's own meter, cached by the
// CLI: `limits[]` carries the weekly bucket as a PERCENTAGE with a `resets_at`. No
// dollar figure — every `limit_dollars` on this account is null, and Anthropic
// publishes no numeric weekly limit for Max, so any dollar allowance stated as fact
// would be fabricated.
//
// So the unit here is the percentage point, and the cap is expressed in his own
// terms with no denominator to guess: a night may consume at most 50 points of the
// weekly meter. Dollars are converted into points by a CALIBRATION — one real meter
// reading against the measured spend behind it — which is re-derived every time the
// meter refreshes and therefore survives pricing changes and the +50% promotional
// limits expiring on 2026-08-31. The bootstrap calibration in `config/spend.json`
// is dated and labelled an inference; it is never presented as a published figure.
//
// ## The two readings, and why both
//
//   the meter    authoritative for the WEEK, and the only thing that sees usage this
//                machine never recorded (phone, web, claude.ai). But the CLI refreshes
//                it when it feels like it — one observation on disk, 5.5 hours stale
//                when this was written — and it carries no per-night detail.
//   the artifact fresh (rebuilt on the sweep's cadence), per-day, per-agent, and the
//                only thing that can say what TONIGHT has cost. But it prices only
//                the obot2 workspace, so it is a FLOOR, never a ceiling.
//
// Whichever reads worse governs. A floor that exceeds the meter means the meter is
// stale; a meter that exceeds the floor means spend this machine cannot see.
//
// ## The night is the UTC day
//
// `build_usage_data.py` buckets by `timestamp[:10]` on UTC transcript stamps. For
// America/New_York that means a UTC day starts at 20:00 the previous evening — so an
// overnight fleet dispatched after dinner lands entirely inside ONE bucket, which is
// exactly the unit a nightly cap needs. It is not a rolling twelve hours and this
// file never claims it is.
//
// ## Headlines
//
// Spelled for `ALARM_RE` in tools/ops-dashboard/lib/navigator.mjs, which styles only
// uppercase bold headlines carrying GAP / FINDING / BREACHED / FAILED / DOWN /
// BROKEN. The stop matches it; the WARNING deliberately does not, because the page
// has a second tier (`nav-note`) and a warning that shouts as loudly as a stop is a
// stop nobody believes. The constants are exported so the test asserts them against
// the real regular expression rather than against a copy of it.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Over the cap. Dispatch is refused. Matches ALARM_RE. */
export const ALARM_STOP = '**NIGHTLY SPEND CAP BREACHED**'
/** The reading did not happen. Unknown, not clean, and not permission to spend. */
export const ALARM_READING = '**SPEND READING BROKEN**'
/** The middle tier: a signal, not a gate. Deliberately not an ALARM_RE headline. */
export const WARN_LEAD = 'SPEND WARNING'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DAY_MS = 86400000
const WEEK_MS = 7 * DAY_MS

const utcDay = (d) => d.toISOString().slice(0, 10)
const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pts = (n) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(1))

// ------------------------------------------------------------------ configuration

/**
 * The declared policy. Versioned in the repo so changing a threshold is a pull
 * request rather than an edit nobody sees; `OBOT_SPEND_CONFIG` overrides for
 * rehearsal and tests.
 */
export function loadConfig(repoRoot = REPO_ROOT, env = process.env) {
  const p = env.OBOT_SPEND_CONFIG || path.join(repoRoot, 'config', 'spend.json')
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch (e) {
    // A missing policy is not a licence to spend: the caller sees no thresholds and
    // judges everything unknown, which refuses.
    return { schema: 0, error: `${p}: ${e.code || e.message}` }
  }
}

// ------------------------------------------------------------------- the meter

/**
 * Anthropic's own weekly meter, as cached by the CLI in `~/.claude.json`.
 *
 * The file is 119 KB of account state including an OAuth token. This reads the
 * utilization block and nothing else, and returns only numbers and timestamps —
 * nothing from that file reaches a surface (asserted in the test).
 */
export function readMeter(file, now = new Date()) {
  const miss = (why) => ({ read: false, ok: false, usable: false, expired: false,
                           percent: null, resetsAt: null, fetchedAt: null, scoped: [], why })
  let raw
  try { raw = fs.readFileSync(file, 'utf8') } catch (e) {
    return miss(e.code === 'ENOENT' ? `no meter cache at ${file}` : `${e.code}: ${file}`)
  }
  let doc
  // A parse failure is a FAILED reading. Coercing it to zero would read as a fresh
  // week — the exact absent/unreadable collapse this program has fixed six times.
  try { doc = JSON.parse(raw) } catch (e) { return miss(`meter cache unparseable: ${String(e.message).slice(0, 80)}`) }
  const u = doc?.cachedUsageUtilization
  if (!u) return miss('no cachedUsageUtilization block — the CLI has not fetched a limit reading')

  const weekly = (u.utilization?.limits || []).filter((l) => l && l.group === 'weekly' && Number.isFinite(l.percent))
  const seven = u.utilization?.seven_day
  const percent = weekly.length
    ? Math.max(...weekly.map((l) => l.percent))
    : (Number.isFinite(seven?.utilization) ? seven.utilization : null)
  const resetsAt = weekly.find((l) => l.kind === 'weekly_all')?.resets_at || seven?.resets_at || null
  const fetchedAt = Number.isFinite(u.fetchedAtMs) ? new Date(u.fetchedAtMs).toISOString() : null
  if (percent === null || !resetsAt) return miss('the utilization block carries no weekly bucket')

  // The sharpest staleness test is not age but expiry: once `resets_at` has passed,
  // the cached percentage describes a week that is OVER. Believing a 99% reading
  // after a Thursday reset halts a fleet with a full allowance in front of it.
  const expired = now.getTime() >= Date.parse(resetsAt)
  return {
    read: true, ok: true, expired, percent, resetsAt, fetchedAt,
    usable: !expired,
    severity: weekly.find((l) => l.kind === 'weekly_all')?.severity || null,
    scoped: weekly.filter((l) => l.kind === 'weekly_scoped' && l.scope?.model?.display_name)
      .map((l) => ({ label: l.scope.model.display_name, percent: l.percent })),
    why: expired ? `reading fetched ${fetchedAt} describes the week that ended ${resetsAt}` : null,
  }
}

// ----------------------------------------------------------------- the artifact

/**
 * Put the generator on a cadence.
 *
 * Rebuilt into the sweep's own cache, never into `obot.roadmap/site/usage/` — a
 * regenerated artifact in the hub clone leaves that tree dirty, and a dirty tree
 * makes the sweep's checkout auto-update REFUSE (obot.agent#186). The published
 * copy stays a deliberate commit; this one is the reading.
 */
export function refreshUsage({ hub, cachePath, ttlMin = 10, now = new Date(), run = runGenerator }) {
  let age = Infinity
  try { age = (now.getTime() - fs.statSync(cachePath).mtimeMs) / 60000 } catch { /* absent — rebuild */ }
  if (age <= ttlMin) return { ran: false, ok: true, ageMin: age, why: null }
  fs.mkdirSync(path.dirname(cachePath), { recursive: true })
  const script = path.join(hub, 'scripts', 'build_usage_data.py')
  const r = run('python3', [script, '--out', cachePath])
  return { ran: true, ok: !!r.ok, ageMin: r.ok ? 0 : age, why: r.ok ? null : r.why }
}

function runGenerator(cmd, args) {
  try {
    execFileSync(cmd, args, { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true }
  } catch (e) {
    return { ok: false, why: `${cmd} ${path.basename(args[0])}: ${String(e.stderr || e.message).trim().slice(0, 140)}` }
  }
}

/** The priced artifact, reduced to what a cap needs: dollars per UTC day, and the total. */
export function readUsage(file) {
  let doc
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) {
    return { read: false, ok: false, byDay: new Map(), totalUsd: null, generatedAt: null,
             why: e.code === 'ENOENT' ? `no usage artifact at ${file}` : `${e.code || 'parse'}: ${file}` }
  }
  if (!Array.isArray(doc?.cells)) return { read: true, ok: false, byDay: new Map(), totalUsd: null,
                                           generatedAt: null, why: 'usage artifact has no cells[]' }
  const byDay = new Map()
  for (const c of doc.cells) byDay.set(c.day, (byDay.get(c.day) || 0) + (c.cost || 0))
  let generatedAt = null
  try { generatedAt = new Date(fs.statSync(file).mtimeMs).toISOString() } catch { /* judged below */ }
  return { read: true, ok: true, byDay, totalUsd: doc.totals?.cost ?? null, generatedAt,
           lastDay: doc.totals?.last ?? null, why: null }
}

// ------------------------------------------------------------------- the window

/**
 * The allowance week, reset to reset.
 *
 * `anchor` is a real `resets_at` from the meter — never a weekday this file picked.
 * Any anchor works: the window rolls by whole weeks until it contains `now`, so a
 * reading from three weeks ago still names today's boundaries correctly.
 */
export function weekWindow(now, anchor) {
  const a = Date.parse(anchor)
  if (!Number.isFinite(a)) return null
  let end = a
  while (end <= now.getTime()) end += WEEK_MS
  while (end - WEEK_MS > now.getTime()) end -= WEEK_MS
  const startsAt = new Date(end - WEEK_MS)
  const endsAt = new Date(end)
  const days = []
  for (let d = Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth(), startsAt.getUTCDate());
       d <= now.getTime(); d += DAY_MS) days.push(utcDay(new Date(d)))
  return { startsAt, endsAt, days }
}

// -------------------------------------------------------------------- the judge

/**
 * The ladder. Four states, and the three that are not `ok` are all distinguishable:
 * a refusal (`stop`) and a failure (`unknown`) are different things, which #275 asks
 * for by name.
 *
 *   ok       under the cap, and a full night's cap still fits inside the week.
 *   warn     less than one full night's cap remains this week, or the night has
 *            eaten most of the headroom it actually has. Dispatch is allowed.
 *   stop     the week is past its stop line, or the night has spent its headroom.
 *            Dispatch is refused.
 *   unknown  no reading, or no denominator. Dispatch is refused, loudly, and never
 *            rendered as "under the cap".
 *
 * The stop line is 90 points rather than 100 because that is where he actually
 * stopped: at "ninety something percent" on 2026-08-18 he deferred everything. It is
 * declared in `config/spend.json` as his revealed threshold, not derived from his
 * fifty-percent sentence, which is about a night and not about a week.
 */
export function judge({ meter, usage, config, now = new Date() }) {
  const cap = Number(config?.nightlyCapPercent)
  const stopAt = Number(config?.weeklyStopPercent)
  const warnFrac = Number(config?.nightWarnFraction ?? 0.8)
  const calib = config?.calibration || null
  const anchor = (meter?.resetsAt) || config?.weekAnchor || calib?.resetsAt || null
  const window = anchor ? weekWindow(now, anchor) : null
  const day = utcDay(now)

  // A percentage point in dollars, from one real meter reading against the measured
  // spend behind it. Undefined until a calibration exists — and an undefined
  // denominator is `unknown`, never a permissive default.
  const usdPerPoint = calib && Number.isFinite(calib.spentUsd) && Number(calib.weeklyPercent) > 0
    ? calib.spentUsd / calib.weeklyPercent
    : null

  const denominator = {
    what: 'percentage points of the weekly allowance Anthropic meters (100 points = one week)',
    usdPerPoint,
    calibratedAt: calib?.at ?? null,
    calibratedFrom: calib ? `${calib.weeklyPercent}% of the week against ${money(calib.spentUsd)} measured` : null,
    source: calib?.source ?? null,
    note: 'Anthropic publishes no numeric weekly limit and every limit_dollars on this account is null, so no dollar allowance is asserted here.',
  }

  const base = {
    at: now.toISOString(),
    week: { percentUsed: null, source: 'none', spentUsd: null, stopPercent: stopAt,
            startsAt: window?.startsAt?.toISOString() ?? null, endsAt: window?.endsAt?.toISOString() ?? null,
            denominator },
    night: { day, spentUsd: null, points: null, capPoints: Number.isFinite(cap) ? cap : null,
             headroomPoints: null, pctOfHeadroom: null },
    reading: {
      meter: { read: !!meter?.read, ok: !!meter?.ok, usable: !!meter?.usable, expired: !!meter?.expired,
               percent: meter?.percent ?? null, fetchedAt: meter?.fetchedAt ?? null,
               resetsAt: meter?.resetsAt ?? null, scoped: meter?.scoped ?? [], why: meter?.why ?? null },
      usage: { read: !!usage?.read, ok: !!usage?.ok, generatedAt: usage?.generatedAt ?? null, why: usage?.why ?? null },
    },
  }

  const unknown = (why) => ({
    ...base, state: 'unknown', allowed: false, why,
    headline: `${ALARM_READING} — ${why} Nothing here says the fleet is under the cap; it says nobody measured.`,
  })

  if (!Number.isFinite(cap) || !Number.isFinite(stopAt)) return unknown(`no spend policy loaded (${config?.error || 'thresholds missing'}).`)
  if (!window) return unknown('no reset instant is known, so the allowance week has no boundaries.')
  if (!usage?.ok) return unknown(`${usage?.why || 'the usage artifact could not be read'}.`)

  const weekSpentUsd = window.days.reduce((n, d) => n + (usage.byDay.get(d) || 0), 0)
  const nightSpentUsd = usage.byDay.get(day) || 0
  base.week.spentUsd = Number(weekSpentUsd.toFixed(2))
  base.night.spentUsd = Number(nightSpentUsd.toFixed(2))

  const projected = usdPerPoint ? weekSpentUsd / usdPerPoint : null
  const metered = meter?.usable ? meter.percent : null
  if (metered === null && projected === null) {
    return unknown(meter?.why
      ? `the meter is unusable (${meter.why}) and no calibration exists to price the artifact in points.`
      : 'no usable meter reading and no calibration, so there is no denominator.')
  }

  // Whichever reads worse governs: the artifact is a floor (it prices only this
  // workspace), the meter is authoritative but refreshes on the CLI's schedule.
  const percentUsed = Math.max(metered ?? 0, projected ?? 0)
  base.week.percentUsed = Number(percentUsed.toFixed(2))
  base.week.source = metered === null ? 'artifact projection'
    : (projected !== null && projected > metered ? 'meter, raised by spend the artifact has recorded since' : 'meter')

  const nightPoints = usdPerPoint ? nightSpentUsd / usdPerPoint : null
  if (nightPoints === null) {
    // The week is known but the night is not. That is enough to stop on the week and
    // not enough to say anything about the night.
    if (percentUsed >= stopAt) {
      return { ...base, state: 'stop', allowed: false,
               why: `the week is at ${percentUsed.toFixed(0)}% of the allowance, past the ${stopAt}% stop line.`,
               headline: `${ALARM_STOP} — the week is at ${percentUsed.toFixed(0)}% of the allowance (stop line ${stopAt}%).` }
    }
    return unknown('no calibration, so tonight\'s spend cannot be priced against the weekly meter.')
  }

  const weekBefore = Math.max(0, percentUsed - nightPoints)
  const headroom = Math.max(0, Math.min(cap, stopAt - weekBefore))
  base.night.points = Number(nightPoints.toFixed(2))
  base.night.headroomPoints = Number(headroom.toFixed(2))
  base.night.pctOfHeadroom = headroom > 0 ? Number(((nightPoints / headroom) * 100).toFixed(0)) : 100

  if (weekBefore >= stopAt) {
    return { ...base, state: 'stop', allowed: false,
             why: `the week is at ${weekBefore.toFixed(0)}% of the allowance, past the ${stopAt}% stop line; it resets ${window.endsAt.toISOString().replace('T', ' ').slice(0, 16)}Z.`,
             headline: `${ALARM_STOP} — the week is at ${weekBefore.toFixed(0)}% of the allowance, past the ${stopAt}% stop line.` }
  }
  if (nightPoints >= headroom) {
    return { ...base, state: 'stop', allowed: false,
             why: `tonight has taken ${pts(nightPoints)} points and only ${pts(headroom)} were available (the smaller of his ${cap}-point night cap and what is left of the week).`,
             headline: `${ALARM_STOP} — tonight has taken ${pts(nightPoints)} of ${pts(headroom)} available points.` }
  }
  if (headroom < cap) {
    return { ...base, state: 'warn', allowed: true,
             why: `${pts(headroom)} points remain before the ${stopAt}% stop line — less than one full night at his ${cap}-point cap.`,
             headline: `${WARN_LEAD} — ${pts(headroom)} points left this week, less than one full night's cap (${cap}). Tonight has taken ${pts(nightPoints)}.` }
  }
  if (nightPoints >= warnFrac * headroom) {
    return { ...base, state: 'warn', allowed: true,
             why: `tonight has taken ${pts(nightPoints)} of its ${pts(headroom)} points.`,
             headline: `${WARN_LEAD} — tonight has taken ${pts(nightPoints)} of ${pts(headroom)} points (${base.night.pctOfHeadroom}% of the night's headroom).` }
  }
  return { ...base, state: 'ok', allowed: true,
           why: `tonight ${pts(nightPoints)} of ${pts(headroom)} points; the week is at ${percentUsed.toFixed(0)}%.`,
           headline: `spend: OK — tonight ${pts(nightPoints)} of ${pts(headroom)} points, week ${percentUsed.toFixed(0)}% of ${stopAt}% stop line.` }
}

// --------------------------------------------------------------- recalibration

/**
 * Below this the ratio is too noisy to trust: a week that has barely started prices
 * a point off a handful of dollars, and one rounding step in the meter's integer
 * percentage moves the answer by tens of percent.
 */
export const CALIB_MIN_PERCENT = 20

/**
 * A fresh calibration, when the meter has been re-fetched since the last one.
 *
 * This is what keeps the denominator honest without anyone maintaining it. The
 * bootstrap in `config/spend.json` is a dated inference; every subsequent meter
 * fetch replaces it with a newer pair of real readings, so the number tracks a
 * pricing change, a plan change, and the "+50% weekly limits promo through Aug 31"
 * expiring, none of which anybody would remember to edit a file for.
 *
 * The lag is bounded by the cadence rather than argued about: the sweep observes a
 * new `fetchedAtMs` within five minutes of it appearing and the artifact is at most
 * ten minutes old, so the dollars paired with the percentage trail it by minutes.
 * They trail rather than lead, which under-states dollars-per-point and therefore
 * over-states the points a night has spent — conservative in the direction that
 * trips sooner.
 */
export function nextCalibration({ meter, weekSpentUsd, stored }) {
  if (!meter?.usable || !Number.isFinite(meter.percent) || meter.percent < CALIB_MIN_PERCENT) return null
  if (!Number.isFinite(weekSpentUsd) || weekSpentUsd <= 0) return null
  if (!meter.fetchedAt || (stored && stored.meterFetchedAt === meter.fetchedAt)) return null
  return {
    at: meter.fetchedAt,
    meterFetchedAt: meter.fetchedAt,
    weeklyPercent: meter.percent,
    spentUsd: Number(weekSpentUsd.toFixed(2)),
    source: 'live — re-derived from the meter this machine cached',
  }
}

/** The newer of the shipped bootstrap and whatever the machine has since recorded. */
export function pickCalibration(config, stored) {
  const a = config?.calibration || null
  if (!a) return stored || null
  if (!stored?.at) return a
  return Date.parse(stored.at) > Date.parse(a.at) ? stored : a
}

/** Where the machine remembers its own calibration. */
export const calibrationPath = (workspace) =>
  path.join(workspace, '.claude/session-hub/cache/spend-calibration.json')

function readStoredCalibration(workspace) {
  try { return JSON.parse(fs.readFileSync(calibrationPath(workspace), 'utf8')) } catch { return null }
}

function writeStoredCalibration(workspace, calib) {
  try {
    const p = calibrationPath(workspace)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(calib, null, 1) + '\n')
  } catch { /* the bootstrap still applies; the section names which one is in force */ }
}

// ------------------------------------------------------------------ the surfaces

const detailLines = (v) => {
  const d = []
  d.push(`night ${v.night.day} (UTC day — for America/New_York it opens at 20:00 the evening before): ${v.night.spentUsd === null ? 'unmeasured' : money(v.night.spentUsd)} = ${pts(v.night.points)} of ${pts(v.night.headroomPoints)} available points (his cap ${pts(v.night.capPoints)})`)
  d.push(`week: ${v.week.spentUsd === null ? 'unmeasured' : money(v.week.spentUsd)} measured, meter at ${v.week.percentUsed === null ? '—' : `${v.week.percentUsed.toFixed(0)}%`} of the allowance (${v.week.source}), stop line ${v.week.stopPercent}%, resets ${v.week.endsAt ? `${v.week.endsAt.replace('T', ' ').slice(0, 16)}Z` : 'unknown'}`)
  const den = v.week.denominator
  d.push(`denominator: ${den.what}${den.usdPerPoint ? `; 1 point ≈ ${money(den.usdPerPoint)} of API-equivalent spend, calibrated ${den.calibratedAt} from ${den.calibratedFrom} (${den.source})` : '; NOT CALIBRATED — dollars cannot be priced in points'}`)
  d.push(`meter: ${v.reading.meter.read
    ? (v.reading.meter.expired
        ? `read but EXPIRED — ${v.reading.meter.why}; the week position below comes from the artifact alone`
        : `${v.reading.meter.percent}% weekly, fetched ${v.reading.meter.fetchedAt}`)
    : `NOT READ — ${v.reading.meter.why}`}`)
  for (const s of v.reading.meter.scoped || []) d.push(`  model-scoped limit: ${s.label} at ${s.percent}% — a scoped bucket can bind before the all-model one`)
  d.push(`artifact: ${v.reading.usage.ok ? `rebuilt ${v.reading.usage.generatedAt}` : `NOT READ — ${v.reading.usage.why}`}; it prices only the obot2 workspace, so measured spend is a floor`)
  return d
}

/**
 * The one-line verdict, for the block above the first heading in navigator-state.md.
 *
 * That block is what the Operations Dashboard's ops tab renders (`ledgerNotes`) and
 * what a dispatching agent reads first, so the spend position sits there beside the
 * two ledgers rather than in a section further down. Reported even when clean: a
 * detector that only ever speaks up on failure is indistinguishable from a dead one.
 */
export function spendNote(v) {
  return [v.headline, ...detailLines(v).map((l) => `  ${l}`)].join('\n')
}

/** The full section, for `/navigator/record` and for anything reading the file whole. */
export function spendSection(v) {
  return ['## Spend — tonight and this week, before the next dispatch', '', v.headline, '',
          ...detailLines(v).map((l) => `- ${l}`), ''].join('\n')
}

// -------------------------------------------------------------- the refusal path

const HALT_MARKER = '# obot spend cap — written by tools/navigator/spend.mjs'

/** The first line that makes a halt file this mechanism's rather than his. */
export const haltMarker = () => HALT_MARKER

/**
 * Write or lift `.claude/autonomy-halt` — the kill switch `obot-auto` and the morning
 * fold already honour. Using the switch that exists means the refusal reaches every
 * consumer with no new wiring, and it is the switch he already knows.
 *
 * The marker line is load-bearing in both directions: a halt file WITHOUT it is his
 * and is never touched, and one WITH it is lifted automatically when the reading
 * clears — otherwise one breach parks the fleet until somebody notices, every week.
 */
export function applyHalt(workspace, verdict, { log = () => {} } = {}) {
  const halt = path.join(workspace, '.claude', 'autonomy-halt')
  let existing = null
  try { existing = fs.readFileSync(halt, 'utf8') } catch (e) {
    // ENOENT is the only failure allowed to read as absence. Anything else and we
    // must not decide: a read-modify-write after a failed read is how files vanish.
    if (e.code !== 'ENOENT') return { wrote: false, cleared: false, why: `${e.code}: ${halt}` }
  }
  const ours = existing !== null && existing.startsWith(HALT_MARKER)

  if (verdict.allowed === false) {
    if (existing !== null) return { wrote: false, cleared: false, why: 'a halt is already in place' }
    fs.mkdirSync(path.dirname(halt), { recursive: true })
    fs.writeFileSync(halt, [
      HALT_MARKER,
      `# ${verdict.at}`,
      '',
      verdict.headline.replace(/\*\*/g, ''),
      verdict.why,
      '',
      'This file parks obot-auto and the morning fold. It is lifted automatically by the',
      'next Navigator sweep whose spend reading clears — the allowance week resets on its',
      'own and nobody should have to remember to delete this.',
      `Reading: ${JSON.stringify({ week: verdict.week.percentUsed, night: verdict.night.points, headroom: verdict.night.headroomPoints })}`,
      '',
    ].join('\n'))
    log(`spend: halt written (${verdict.state})`)
    return { wrote: true, cleared: false, why: null }
  }
  if (ours) { fs.unlinkSync(halt); log('spend: halt lifted, the reading has cleared'); return { wrote: false, cleared: true, why: null } }
  return { wrote: false, cleared: false, why: existing === null ? null : 'the halt in place is not ours' }
}

// ------------------------------------------------------------------ orchestration

/**
 * One reading, for the sweep and for the guard. Refreshes the artifact on its TTL,
 * reads the meter, judges, and caches the verdict where a cheap reader (the hook,
 * a shell) can pick it up without paying for node twice.
 */
export function readSpend({ workspace, hub, repoRoot = REPO_ROOT, env = process.env, now = new Date() } = {}) {
  const config = loadConfig(repoRoot, env)
  const cachePath = env.OBOT_SPEND_USAGE || path.join(workspace, '.claude/session-hub/cache/usage.json')
  const refresh = env.OBOT_SPEND_NO_REFRESH === '1'
    ? { ran: false, ok: true, why: null }
    : refreshUsage({ hub, cachePath, ttlMin: Number(config.usageTtlMinutes) || 10, now })
  const usage = readUsage(cachePath)
  if (!refresh.ok && !usage.ok) usage.why = refresh.why || usage.why
  const meterPath = env.OBOT_SPEND_METER || path.join(process.env.HOME || '', '.claude.json')
  const meter = readMeter(meterPath, now)

  // Re-derive the denominator whenever the meter has been re-fetched. Without this
  // the bootstrap in config/spend.json is frozen, and a frozen calibration is wrong
  // the moment prices, the plan or a promotional limit changes — none of which
  // anybody edits a file for.
  let stored = readStoredCalibration(workspace)
  const anchor = meter.resetsAt || config.weekAnchor || pickCalibration(config, stored)?.resetsAt || null
  const window = anchor ? weekWindow(now, anchor) : null
  const weekSpentUsd = window && usage.ok
    ? window.days.reduce((n, d) => n + (usage.byDay.get(d) || 0), 0)
    : null
  const fresh = nextCalibration({ meter, weekSpentUsd, stored })
  if (fresh) { writeStoredCalibration(workspace, fresh); stored = fresh }

  const effective = { ...config, calibration: pickCalibration(config, stored) }
  const verdict = judge({ meter, usage, config: effective, now })
  verdict.refresh = refresh
  verdict.recalibrated = fresh ? fresh.at : null
  return { verdict, note: spendNote(verdict), section: spendSection(verdict), config: effective }
}

/** Cache the verdict for readers that must not pay for a node start (the hook). */
export function writeVerdict(workspace, verdict) {
  const p = path.join(workspace, '.claude/session-hub/cache/spend.json')
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(verdict, null, 1) + '\n')
    return { ok: true, path: p }
  } catch (e) { return { ok: false, why: `${e.code}: ${p}` } }
}

/** The section a sweep prints when the whole reading threw. Unknown, not clean. */
export const spendBroken = (why) =>
  `## Spend — tonight and this week, before the next dispatch\n\n${ALARM_READING} — ${String(why).slice(0, 160)}. No spend reading ran this sweep, so nothing here says the fleet is under the cap.\n`

/** The matching one-liner for the note block. */
export const spendBrokenNote = (why) =>
  `${ALARM_READING} — ${String(why).slice(0, 160)}. No spend reading ran this sweep; unknown, not under the cap.`
