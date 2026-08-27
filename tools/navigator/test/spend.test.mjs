// What the fleet spends, measured before it is spent.
//
// Requirement jwildfire/obot.roadmap#275. Worker W0078.
//
// The requirement's own framing is that the measurement already existed and the
// CADENCE did not: `build_usage_data.py` had not run since 16 August because the
// session wrapup was its only heartbeat and the wrapup stopped. So these tests hold
// down the three things that would let that happen again, plus the two traps this
// program has already paid for.
//
//   1. A CHECK THAT CANNOT FAIL IS NOT A CHECK. The ladder is asserted against
//      @jwildfire's REAL week — the measured per-day figures for Thu 2026-08-13 →
//      Wed 2026-08-19, the week he ran out on. It has to produce a warning on 08-17
//      and a stop on 08-18/08-19, because that is the week the requirement was
//      written about. A cap that would have sat green through it is decoration.
//
//   2. UNKNOWN IS NOT OK. A reading that did not happen, a meter whose week has
//      already reset, a usage artifact that could not be built — none of them may
//      render or exit as "under the cap". They get their own state and their own
//      exit code, and dispatch is refused rather than allowed.
//
//   3. THE VERDICT IS THE FIRST LINE. The Navigator summarises by first line and the
//      dashboard's ALARM_RE only styles headlines it recognises, so the stop headline
//      is asserted against the REAL regular expression imported from the dashboard
//      rather than against a copy of it (obot.agent#223).
//
// And the graduation is deliberate: the stop matches ALARM_RE and the warning does
// not. Two tiers exist on the page already — `nav-alarm` and `nav-note` — and a
// warning that shouts as loudly as a stop is a stop nobody believes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  ALARM_READING, ALARM_STOP, CALIB_MIN_PERCENT, WARN_LEAD,
  applyHalt, calibrationPath, haltMarker, judge, loadConfig, nextCalibration,
  pickCalibration, readMeter, readSpend, readUsage, refreshUsage,
  spendNote, spendSection, weekWindow,
} from '../spend.mjs'
import { ALARM_RE, parseNavigatorState } from '../../ops-dashboard/lib/navigator.mjs'
import { renderState } from '../sweep.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')
const GUARD = path.join(REPO, 'tools', 'spend-guard')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'spend-'))

// ---------------------------------------------------------------- his real week
//
// Measured, not invented: `sum(cost)` per UTC day from the committed usage artifact
// (obot.roadmap/site/usage/usage.json, refreshed through 2026-08-19 in acaec74).
// 2026-08-13 is a Thursday and the weekly meter resets on Thursday, so this is one
// whole allowance window — the one that ran out.
const REAL_WEEK = {
  '2026-08-14': 549.89,
  '2026-08-15': 640.47,
  '2026-08-16': 544.33,
  '2026-08-17': 723.19,
  '2026-08-18': 1167.26,
  '2026-08-19': 28.97,
}

// The calibration taken from the machine's own meter on 2026-08-20T10:42:05.623Z:
// the API reported the weekly bucket at 99% against $3,769.13 of measured spend
// since the prior reset. One percentage point is worth ~$38.07. This is arithmetic
// on two real readings, not a plan allowance anybody published.
const CALIBRATION = { at: '2026-08-20T10:42:05.623Z', weeklyPercent: 99, spentUsd: 3769.13, source: 'test' }

// The reset instant is a real `resets_at` read from the machine's own meter — a
// Thursday, which is what "until Thursday" on 08-18 was pointing at. It is the
// fallback the judge uses when no live meter reading is usable; nothing here picks
// a weekday.
const CONFIG = {
  schema: 1,
  nightlyCapPercent: 50,
  weeklyStopPercent: 90,
  nightWarnFraction: 0.8,
  usageTtlMinutes: 10,
  weekAnchor: '2026-08-20T14:59:59.596883+00:00',
  calibration: CALIBRATION,
}

/** A usage artifact in the real generator's schema, holding the days given. */
function usageFile(byDay) {
  const dir = tmp()
  const cells = Object.entries(byDay).map(([day, cost]) => ({
    day, agent: '🦾🤖 W0001 fixture', role: 'auto',
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    cost, calls: 1, subCalls: 0, subCost: 0,
  }))
  const total = cells.reduce((n, c) => n + c.cost, 0)
  const days = Object.keys(byDay).sort()
  const p = path.join(dir, 'usage.json')
  fs.writeFileSync(p, JSON.stringify({
    schema: 1, project: 'obot2', days, cells, models: [],
    roleLabels: {}, cacheMultipliers: {},
    totals: { cost: Number(total.toFixed(2)), calls: cells.length, subCost: 0, subCalls: 0,
              input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
              agents: 1, activeDays: cells.length, first: days[0] ?? null, last: days.at(-1) ?? null },
  }) + '\n')
  return p
}

/** A `.claude.json` carrying only the utilization block this reading is allowed to touch. */
function meterFile({ percent = 40, fetchedAt = '2026-08-17T12:00:00Z', resetsAt = '2026-08-20T14:59:59.596883+00:00',
                     scoped = null, malformed = false } = {}) {
  const dir = tmp()
  const p = path.join(dir, '.claude.json')
  if (malformed) { fs.writeFileSync(p, '{ not json'); return p }
  const limits = [
    { kind: 'session', group: 'session', percent: 4, severity: 'normal', resets_at: resetsAt, scope: null, is_active: false },
    { kind: 'weekly_all', group: 'weekly', percent, severity: 'critical', resets_at: resetsAt, scope: null, is_active: true },
  ]
  if (scoped != null) {
    limits.push({ kind: 'weekly_scoped', group: 'weekly', percent: scoped, severity: 'warning',
                  resets_at: resetsAt, scope: { model: { id: null, display_name: 'Fable' } }, is_active: false })
  }
  fs.writeFileSync(p, JSON.stringify({
    // The real file is 119 KB of account state and history. The reading must take
    // the utilization numbers and nothing else — this fixture carries a decoy.
    oauthAccount: { accessToken: 'SECRET-MUST-NEVER-BE-READ-OR-PRINTED' },
    cachedUsageUtilization: {
      fetchedAtMs: Date.parse(fetchedAt),
      utilization: { seven_day: { utilization: percent, resets_at: resetsAt }, limits },
    },
  }))
  return p
}

/** Judge the fleet's position at `now`, against the fixtures given. */
function verdictAt(now, byDay, opts = {}) {
  const usage = readUsage(usageFile(byDay))
  const meter = opts.meter === null || opts.meter === undefined
    ? { read: false, ok: false, why: 'no meter fixture', usable: false, expired: false, percent: null }
    : readMeter(meterFile(opts.meter), new Date(now))
  return judge({ meter, usage, config: { ...CONFIG, ...(opts.config || {}) }, now: new Date(now) })
}

/** The ladder over his real week: what the mechanism would have said each evening. */
const ladder = () => ['2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19']
  .map((day) => {
    // Dispatch happens at the top of the night, before the night's own spend. The
    // days after `day` are not yet measured, so the artifact holds the week to date.
    const soFar = Object.fromEntries(Object.entries(REAL_WEEK).filter(([d]) => d < day))
    return { day, atDispatch: verdictAt(`${day}T01:00:00Z`, soFar) }
  })

// ------------------------------------------------------------------ the week window

test('the week runs reset-to-reset, and the reset is read from the meter not guessed', () => {
  const w = weekWindow(new Date('2026-08-19T01:00:00Z'), '2026-08-20T14:59:59.596883+00:00')
  assert.equal(w.startsAt.toISOString().slice(0, 10), '2026-08-13')
  assert.equal(w.endsAt.toISOString().slice(0, 10), '2026-08-20')
  assert.deepEqual(w.days.slice(0, 2), ['2026-08-13', '2026-08-14'])
  assert.equal(w.days.at(-1), '2026-08-19')
})

test('a reset instant already in the past rolls forward to the live window', () => {
  // 2026-08-20T15:00Z: the meter's `resets_at` has just passed. The window is the
  // NEW week, not the finished one — otherwise every reading after a Thursday
  // morning judges the fleet against a week that is already over.
  const w = weekWindow(new Date('2026-08-21T02:00:00Z'), '2026-08-20T14:59:59.596883+00:00')
  assert.equal(w.startsAt.toISOString().slice(0, 10), '2026-08-20')
  assert.deepEqual(w.days, ['2026-08-20', '2026-08-21'])
})

// ------------------------------------------------------------------ the real week

test('his real week produces a WARNING before it produces a STOP', () => {
  const states = Object.fromEntries(ladder().map(({ day, atDispatch }) => [day, atDispatch.state]))
  // Thu 08-13 is the reset. The first three nights are inside the rule.
  assert.equal(states['2026-08-14'], 'ok')
  assert.equal(states['2026-08-15'], 'ok')
  assert.equal(states['2026-08-16'], 'ok')
  // 08-17: 45.6 points gone, so less than one full night's cap remains. This is the
  // warning the week never got — and it arrives at dispatch, before the night runs.
  assert.equal(states['2026-08-17'], 'warn')
  // 08-18 opens with 25 points left against a 50-point cap: still a warning at
  // dispatch, because the cap is a cap and not a forecast. It becomes a stop DURING
  // the night, once the night has spent the headroom (asserted below) — that night
  // actually took $1,167, so the halt would have landed at roughly $968.
  assert.equal(states['2026-08-18'], 'warn')
  // 08-19: the week is at 95%, past the stop line. Refused before anything spawns —
  // which is the morning he called the halt by hand.
  assert.equal(states['2026-08-19'], 'stop')
  const order = ladder().map((r) => r.atDispatch.state)
  assert.ok(order.indexOf('warn') < order.indexOf('stop'), 'the warning must come first')
})

test('the stop refuses dispatch and the warning does not', () => {
  const byDay = Object.fromEntries(ladder().map(({ day, atDispatch }) => [day, atDispatch]))
  assert.equal(byDay['2026-08-17'].allowed, true, 'a warning is a signal, not a refusal')
  assert.equal(byDay['2026-08-18'].allowed, true)
  assert.equal(byDay['2026-08-19'].allowed, false)
})

test('the night cap is 50% of the week because that is what he said, and it is stated', () => {
  const v = verdictAt('2026-08-15T01:00:00Z', { '2026-08-14': 549.89 })
  assert.equal(v.night.capPoints, 50)
  assert.match(v.week.denominator.what, /percentage points of the weekly allowance/i)
  // The number is always accompanied by what it is a fraction of (#275: "Never guess
  // the allowance. If the denominator is unknown, say the number and say what it is
  // a fraction of.").
  assert.match(spendSection(v), /1 point ≈ \$38/)
  assert.match(spendSection(v), /calibrat/i)
})

test('a night that eats its headroom stops part-way through, not only at dispatch', () => {
  // The night of 08-18 with the night's own spend already on the artifact: the
  // mechanism has to say stop while the night is still running, not next morning.
  const soFar = Object.fromEntries(Object.entries(REAL_WEEK).filter(([d]) => d <= '2026-08-18'))
  const v = verdictAt('2026-08-18T20:00:00Z', soFar)
  assert.equal(v.state, 'stop')
  assert.ok(v.night.points > v.night.headroomPoints)
})

// --------------------------------------------------------------- unknown is not ok

test('a usage artifact that could not be read is unknown, and unknown refuses', () => {
  const usage = readUsage(path.join(tmp(), 'absent.json'))
  const v = judge({ meter: { read: false, ok: false, usable: false, why: 'none', expired: false, percent: null },
                    usage, config: CONFIG, now: new Date('2026-08-20T20:00:00Z') })
  assert.equal(v.state, 'unknown')
  assert.equal(v.allowed, false)
  assert.match(v.headline, /BROKEN/)
})

test('a malformed meter is a failed reading, never a zero reading', () => {
  const m = readMeter(meterFile({ malformed: true }), new Date('2026-08-20T20:00:00Z'))
  assert.equal(m.ok, false)
  assert.equal(m.usable, false)
  assert.notEqual(m.percent, 0)
})

test('a meter whose week has already reset is expired, not current', () => {
  // The live case on 2026-08-20: the cache was fetched at 10:42Z reading 99%, and the
  // week reset at 14:59Z. Believing that 99% after the reset halts a fleet that has a
  // full allowance in front of it.
  const m = readMeter(meterFile({ percent: 99, fetchedAt: '2026-08-20T10:42:05Z' }),
                      new Date('2026-08-20T18:00:00Z'))
  assert.equal(m.read, true)
  assert.equal(m.expired, true)
  assert.equal(m.usable, false)
  const v = verdictAt('2026-08-20T18:00:00Z', { '2026-08-20': 40 },
                      { meter: { percent: 99, fetchedAt: '2026-08-20T10:42:05Z' } })
  assert.equal(v.state, 'ok', 'a fresh week with $40 spent is not a breach')
  assert.match(spendSection(v), /expired/i)
})

test('with no calibration and no usable meter there is no denominator, so it is unknown', () => {
  const v = verdictAt('2026-08-19T01:00:00Z', REAL_WEEK, { config: { calibration: null } })
  assert.equal(v.state, 'unknown')
  assert.equal(v.allowed, false)
  assert.match(spendNote(v).split('\n')[0], /BROKEN|UNKNOWN/)
})

test('the meter wins when it reads higher than the projection', () => {
  // The projection can only see spend this machine recorded. Cloud, web and phone
  // usage leave no local transcript, so the measured figure is a FLOOR and the
  // meter is the only thing that sees the rest. Whichever is worse governs.
  const v = verdictAt('2026-08-18T01:00:00Z', { '2026-08-17': 100 },
                      { meter: { percent: 92, fetchedAt: '2026-08-18T00:30:00Z' } })
  assert.equal(v.week.source, 'meter')
  assert.ok(v.week.percentUsed >= 92)
  assert.equal(v.state, 'stop', 'the artifact saw $100 this week; the meter saw 92% of the allowance gone')
})

// ------------------------------------------------------------- the rendered surface

test('the verdict is the first line of both the note and the section', () => {
  for (const v of [verdictAt('2026-08-19T01:00:00Z', REAL_WEEK),
                   verdictAt('2026-08-15T01:00:00Z', { '2026-08-14': 549.89 })]) {
    assert.equal(spendNote(v).split('\n')[0].trim(), v.headline.trim())
    const body = spendSection(v).split('\n').filter((l) => l.trim())
    assert.match(body[0], /^## Spend/)
    assert.equal(body[1].trim(), v.headline.trim())
  }
})

test('the stop headline is styled by the dashboard and the warning deliberately is not', () => {
  // Asserted against the REAL regex, imported. A copy would drift and the cost of
  // the drift is a breach that renders as grey text.
  assert.match(ALARM_STOP, ALARM_RE)
  assert.match(ALARM_READING, ALARM_RE)
  assert.doesNotMatch(WARN_LEAD, ALARM_RE, 'a warning is the middle tier, not the alarm tier')
  const warn = ladder().find((r) => r.day === '2026-08-17').atDispatch
  assert.ok(spendNote(warn).startsWith(WARN_LEAD))
})

test('the note reaches the ops tab and the section reaches the record', () => {
  const stop = verdictAt('2026-08-19T01:00:00Z', REAL_WEEK)
  const md = renderState({
    snapshot: {}, events: [],
    meta: { sweptAt: '2026-08-19 01:00 EDT', cadenceMin: 5, ok: true, repoCount: 1 },
    spend: { note: spendNote(stop), section: spendSection(stop) },
  })
  const state = parseNavigatorState(md)
  const note = state.notes.find((n) => /SPEND/.test(n.text))
  assert.ok(note, 'the one-line verdict must be a pre-heading note — that is the ops tab surface')
  assert.equal(note.alarm, true)
  assert.ok(state.sections.some((s) => /^Spend/.test(s.title)), 'and a section for /navigator/record')
})

test('a sweep that could not read spend says so rather than saying nothing', () => {
  const md = renderState({
    snapshot: {}, events: [],
    meta: { sweptAt: '2026-08-19 01:00 EDT', cadenceMin: 5, ok: true, repoCount: 1 },
  })
  assert.match(md, /SPEND READING BROKEN/)
  assert.doesNotMatch(md, /spend: OK/)
})

test('nothing from the account file reaches a surface except the utilization numbers', () => {
  const v = verdictAt('2026-08-18T01:00:00Z', { '2026-08-17': 100 },
                      { meter: { percent: 92, fetchedAt: '2026-08-18T00:30:00Z' } })
  const rendered = `${spendNote(v)}\n${spendSection(v)}\n${JSON.stringify(v)}`
  assert.doesNotMatch(rendered, /SECRET-MUST-NEVER-BE-READ-OR-PRINTED/)
  assert.doesNotMatch(rendered, /accessToken/)
})

// ------------------------------------------------------------------- the cadence

test('the generator runs when the artifact is stale and is left alone when it is fresh', () => {
  const cache = path.join(tmp(), 'usage.json')
  const calls = []
  const run = (cmd, args) => { calls.push([cmd, ...args]); fs.writeFileSync(cache, '{"totals":{"cost":1}}'); return { ok: true } }
  const now = new Date('2026-08-20T18:00:00Z')

  const first = refreshUsage({ hub: '/hub', cachePath: cache, ttlMin: 10, now, run })
  assert.equal(first.ran, true)
  assert.equal(calls.length, 1)
  assert.match(calls[0].join(' '), /build_usage_data\.py/)
  assert.match(calls[0].join(' '), /--out/)

  fs.utimesSync(cache, now, now)
  const second = refreshUsage({ hub: '/hub', cachePath: cache, ttlMin: 10, now, run })
  assert.equal(second.ran, false, 'a fresh artifact is not rebuilt every five minutes')

  const later = new Date('2026-08-20T18:11:00Z')
  assert.equal(refreshUsage({ hub: '/hub', cachePath: cache, ttlMin: 10, now: later, run }).ran, true)
})

test('the generator is never pointed at the hub working tree', () => {
  const cache = path.join(tmp(), 'usage.json')
  const calls = []
  const run = (cmd, args) => { calls.push(args); fs.writeFileSync(cache, '{}'); return { ok: true } }
  refreshUsage({ hub: '/hub', cachePath: cache, ttlMin: 10, now: new Date('2026-08-20T18:00:00Z'), run })
  const out = calls[0][calls[0].indexOf('--out') + 1]
  // Writing into obot.roadmap/site/usage/ every ten minutes dirties the hub clone,
  // and a dirty tree makes the sweep's own checkout auto-update REFUSE.
  assert.equal(out, cache)
  assert.doesNotMatch(out, /obot\.roadmap|site\/usage/)
})

test('a generator that fails leaves the reading unknown, not stale-but-trusted', () => {
  const cache = path.join(tmp(), 'usage.json')
  const r = refreshUsage({ hub: '/hub', cachePath: cache, ttlMin: 10, now: new Date('2026-08-20T18:00:00Z'),
                           run: () => ({ ok: false, why: 'python3 not found' }) })
  assert.equal(r.ok, false)
  assert.match(r.why, /python3/)
  assert.equal(readUsage(cache).ok, false)
})

// -------------------------------------------------------------- the refusal path

test('the halt file is the refusal, and it names itself so it can be lifted', () => {
  const ws = tmp()
  fs.mkdirSync(path.join(ws, '.claude'), { recursive: true })
  const halt = path.join(ws, '.claude', 'autonomy-halt')
  const stop = verdictAt('2026-08-19T01:00:00Z', REAL_WEEK)

  const wrote = applyHalt(ws, stop)
  assert.equal(wrote.wrote, true)
  assert.ok(fs.existsSync(halt))
  const body = fs.readFileSync(halt, 'utf8')
  assert.ok(body.startsWith(haltMarker()), 'the first line is the marker that makes it ours')
  assert.match(body, /obot-auto/)

  // Idempotent: a halt already in place is not rewritten every five minutes.
  assert.equal(applyHalt(ws, stop).wrote, false)

  const ok = verdictAt('2026-08-15T01:00:00Z', { '2026-08-14': 549.89 })
  const cleared = applyHalt(ws, ok)
  assert.equal(cleared.cleared, true)
  assert.equal(fs.existsSync(halt), false, 'the week resets on its own; his hands are not the lift')
})

test('a halt file @jwildfire wrote is never touched', () => {
  const ws = tmp()
  fs.mkdirSync(path.join(ws, '.claude'), { recursive: true })
  const halt = path.join(ws, '.claude', 'autonomy-halt')
  fs.writeFileSync(halt, 'stop everything — jeremy\n')
  const ok = verdictAt('2026-08-15T01:00:00Z', { '2026-08-14': 549.89 })
  const r = applyHalt(ws, ok)
  assert.equal(r.cleared, false)
  assert.equal(fs.readFileSync(halt, 'utf8'), 'stop everything — jeremy\n')
})

test('an unknown reading refuses a dispatch but does not park the morning brief', () => {
  // The halt file is the broad instrument — the 07:00 fold honours it too, and the
  // fold is a REPORT. Blinding the surface that would tell him about a spending
  // problem, because the spending reading broke, is the same mistake as gating the
  // Navigator on its own reading. So a measured breach writes it and an unmeasurable
  // one does not; the dispatch-specific gate is the stricter of the two.
  const ws = tmp()
  fs.mkdirSync(path.join(ws, '.claude'), { recursive: true })
  const usage = readUsage(path.join(tmp(), 'absent.json'))
  const v = judge({ meter: { read: false, ok: false, usable: false, why: 'none', expired: false, percent: null },
                    usage, config: CONFIG, now: new Date('2026-08-20T20:00:00Z') })
  assert.equal(v.state, 'unknown')
  assert.equal(v.allowed, false, 'a dispatch is still refused')
  assert.equal(applyHalt(ws, v).wrote, false)
  assert.equal(fs.existsSync(path.join(ws, '.claude', 'autonomy-halt')), false)
  // And obot-auto, the gate that IS about dispatch, still stops on it.
  const r = guard(['check'], { config: { ...CONFIG, calibration: null } })
  assert.equal(r.code, 4)
})

// ------------------------------------------------------------------ the guard CLI

/** Run tools/spend-guard against fixtures. Returns {code, out, err}. */
function guard(args, { byDay = REAL_WEEK, meter = null, now = '2026-08-19T01:00:00Z', config = CONFIG } = {}) {
  const dir = tmp()
  const cfg = path.join(dir, 'spend.json')
  fs.writeFileSync(cfg, JSON.stringify(config))
  const env = {
    ...process.env,
    OBOT_SPEND_CONFIG: cfg,
    OBOT_SPEND_USAGE: usageFile(byDay),
    OBOT_SPEND_NOW: now,
    OBOT_SPEND_NO_REFRESH: '1',
    OBOT_SPEND_METER: meter === null ? path.join(dir, 'no-meter.json') : meterFile(meter),
    OBOT_WORKSPACE: dir,
  }
  try {
    const out = execFileSync(GUARD, args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out, err: '' }
  } catch (e) {
    return { code: e.status, out: e.stdout || '', err: e.stderr || '' }
  }
}

test('the guard exits 0 under the cap, 2 over it, and 4 when it does not know', () => {
  assert.equal(guard(['check'], { byDay: { '2026-08-14': 549.89 }, now: '2026-08-15T01:00:00Z' }).code, 0)
  const over = guard(['check'])
  assert.equal(over.code, 2, "exit 2 is this repo's refusal code (obot-merge, obot-policy)")
  assert.match(over.err, /REFUSED/)
  const unknown = guard(['check'], { config: { ...CONFIG, calibration: null } })
  assert.equal(unknown.code, 4, 'a refusal and a failure are different things (#275)')
})

test('a warning exits 0 and says so — it is a signal, not a gate', () => {
  const soFar = Object.fromEntries(Object.entries(REAL_WEEK).filter(([d]) => d < '2026-08-17'))
  const r = guard(['check'], { byDay: soFar, now: '2026-08-17T01:00:00Z' })
  assert.equal(r.code, 0)
  assert.match(`${r.out}${r.err}`, new RegExp(WARN_LEAD))
})

test('the guard leads with the verdict, on the first line', () => {
  const r = guard(['check'], { byDay: { '2026-08-14': 549.89 }, now: '2026-08-15T01:00:00Z' })
  assert.match(r.out.split('\n')[0], /^spend: OK/)
})

test('--json gives a caller the whole ladder without parsing prose', () => {
  const r = guard(['check', '--json'], { byDay: { '2026-08-14': 549.89 }, now: '2026-08-15T01:00:00Z' })
  const v = JSON.parse(r.out)
  assert.equal(v.state, 'ok')
  assert.equal(typeof v.week.percentUsed, 'number')
  assert.equal(typeof v.night.headroomPoints, 'number')
  assert.equal(typeof v.week.denominator.what, 'string')
})

test('--allow-unknown is the only way past an unknown reading, and it is explicit', () => {
  assert.equal(guard(['check', '--allow-unknown'], { config: { ...CONFIG, calibration: null } }).code, 0)
  assert.equal(guard(['check', '--allow-unknown']).code, 2, 'it excuses an unknown, never a breach')
})

// ------------------------------------------------------- the dispatcher honours it

/** Run obot-auto --preflight-only (which spawns nothing) against a fixture week. */
function preflight(byDay, now) {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true })
  const cfg = path.join(dir, 'spend.json')
  fs.writeFileSync(cfg, JSON.stringify(CONFIG))
  const env = {
    ...process.env,
    OBOT_WORKSPACE: dir,
    OBOT_SPEND_CONFIG: cfg,
    OBOT_SPEND_USAGE: usageFile(byDay),
    OBOT_SPEND_NOW: now,
    OBOT_SPEND_NO_REFRESH: '1',
    OBOT_SPEND_METER: path.join(dir, 'no-meter.json'),
  }
  try {
    const out = execFileSync(path.join(REPO, 'scripts', 'obot-auto'), ['--preflight-only'],
                             { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out, err: '' }
  } catch (e) { return { code: e.status, out: e.stdout || '', err: e.stderr || '' } }
}

test('obot-auto refuses to launch past the cap', () => {
  // The end of the chain: not "the module returns stop" but "the thing that starts
  // an autonomous session will not start one".
  const r = preflight(REAL_WEEK, '2026-08-19T01:00:00Z')
  assert.notEqual(r.code, 0, 'a breached cap must stop the launcher, not warn it')
  // Named, not merely /spend/. This assertion used to be loose enough to pass on the
  // WRONG failure: the check sat fourth in the pre-flight, CI has no `claude` on
  // PATH, and the launcher was dying at "claude CLI not on PATH" long before it
  // reached the cap. A check that cannot fail is not a check, and neither is one
  // that cannot tell you which thing failed.
  assert.match(r.err, /spend cap breached/i)
})

test('obot-auto is not stopped by the spend check when the cap is clear', () => {
  // The other half, and the reason the assertion above can be trusted: under the cap
  // the launcher gets past this gate and dies (or not) on something else entirely.
  const r = preflight({ '2026-08-14': 549.89 }, '2026-08-15T01:00:00Z')
  assert.doesNotMatch(r.err, /spend/i)
  assert.match(r.out, /spend: OK/, 'and it reports the position it just read')
})

// ------------------------------------------------------------------ configuration

test('the shipped policy states the threshold, its source, and that it is his', () => {
  const cfg = loadConfig(REPO)
  assert.equal(cfg.nightlyCapPercent, 50, 'his words: "no more than fifty percent of my weekly usage in any given night"')
  assert.ok(cfg.weeklyStopPercent > 0 && cfg.weeklyStopPercent <= 100)
  assert.ok(cfg.calibration && cfg.calibration.at, 'a denominator with no date is a guess')
  assert.match(JSON.stringify(cfg), /inferred|calibrat/i)
})

// ------------------------------------------------------- the other dispatch lanes

/** A workspace holding the cached verdict the sweep writes. */
function cachedVerdict(state, { ageS = 0 } = {}) {
  const dir = tmp()
  const cache = path.join(dir, '.claude/session-hub/cache')
  fs.mkdirSync(cache, { recursive: true })
  const f = path.join(cache, 'spend.json')
  fs.writeFileSync(f, JSON.stringify({ state, why: 'the week is at 95% of the allowance, past the 90% stop line',
                                       headline: `${ALARM_STOP} — over` }))
  const t = new Date(Date.now() - ageS * 1000)
  fs.utimesSync(f, t, t)
  return dir
}

/** Run tools/worker-id claim in `dir`. Returns {code, out, err}. */
function claim(dir) {
  try {
    return { code: 0, out: execFileSync(path.join(REPO, 'tools', 'worker-id'), ['claim', '--slug', 'fixture'],
      { encoding: 'utf8', env: { ...process.env, OBOT_WORKSPACE: dir }, stdio: ['ignore', 'pipe', 'pipe'] }), err: '' }
  } catch (e) { return { code: e.status, out: e.stdout || '', err: e.stderr || '' } }
}

test('a worker id is refused past the cap, and no id is burned', () => {
  // Every dispatch of a worker claims an id first — obot-auto before it launches,
  // session-spawn before it spawns — and nothing else does. So this is the one place
  // a refusal reaches both lanes without gating the Navigator, prime or the admiral,
  // which claim nothing and must keep running: blinding the surfaces that report the
  // spend is the worst possible way to control it.
  const r = claim(cachedVerdict('stop'))
  assert.equal(r.code, 2)
  assert.equal(r.out.trim(), '', 'stdout is consumed as WID=$(...) — a refusal must put nothing there')
  assert.match(r.err, /REFUSED/)
})

test('a worker id is still issued under the cap, and when nothing was measured', () => {
  // The gate must not become the thing that stops every worker on the machine: a
  // dead sweep is the sweep's own alarm, and it says so on every run.
  for (const dir of [cachedVerdict('ok'), cachedVerdict('warn'), cachedVerdict('stop', { ageS: 7200 }), tmp()]) {
    assert.match(claim(dir).out.trim(), /^W\d{4}$/)
  }
})

/** Feed the PreToolUse hook one Bash command; returns its stdout (empty = defer). */
function hook(command, { state = 'stop', ageS = 0, missing = false } = {}) {
  const dir = tmp()
  const verdict = path.join(dir, 'spend.json')
  if (!missing) {
    fs.writeFileSync(verdict, JSON.stringify({ state, why: 'the week is at 95% of the allowance',
                                               headline: '**NIGHTLY SPEND CAP BREACHED** — over' }))
    const t = new Date(Date.now() - ageS * 1000)
    fs.utimesSync(verdict, t, t)
  }
  return execFileSync(path.join(REPO, 'hooks', 'spend-cap-hook.py'), [], {
    encoding: 'utf8',
    env: { ...process.env, OBOT_SPEND_VERDICT: verdict, OBOT_SPEND_VERDICT_MAX_AGE: '3600' },
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
  })
}

test('the hook denies an agent-typed spawn past the cap', () => {
  // The lane no script can see: a lead typing the spawn into a Bash call. Every
  // background sibling in the fleet is created this way.
  const out = hook('OBOT_WORKER_ID=W0001 claude --bg --permission-mode auto -n "x" "do a thing"')
  const d = JSON.parse(out)
  assert.equal(d.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(d.hookSpecificOutput.permissionDecisionReason, /spend cap/i)
  assert.equal(JSON.parse(hook('obot.agent/scripts/obot-auto --goal charts')).hookSpecificOutput.permissionDecision, 'deny')
})

test('the hook fires on nothing else — a guard that cries wolf gets switched off', () => {
  // Everything here contains the words and none of it starts an agent.
  for (const cmd of [
    'git commit -m "wire the spend cap into claude --bg spawns"',
    'echo "spawn with: claude --bg -n name" >> notes.md',
    'grep -rn "claude --bg" obot.agent/skills',
    'claude agents --json',
    'cat <<EOF\nclaude --bg -p something\nEOF',
    'node --test tools/navigator/test/spend.test.mjs',
  ]) assert.equal(hook(cmd), '', `must defer: ${cmd}`)
})

test('the hook defers when it has no fresh verdict rather than blocking the machine', () => {
  const spawn = 'claude --bg -n "x" "y"'
  assert.equal(hook(spawn, { missing: true }), '', 'no verdict — the sweep raises that alarm, not this')
  assert.equal(hook(spawn, { ageS: 7200 }), '', 'an hour-old verdict is not a reading')
  assert.equal(hook(spawn, { state: 'warn' }), '', 'a warning is a signal, not a gate')
  assert.equal(hook(spawn, { state: 'ok' }), '')
})

// ---------------------------------------------------------------- recalibration
//
// The denominator has to maintain itself. The bootstrap in config/spend.json is a
// dated inference against one meter reading; if it stayed frozen it would be wrong
// the moment prices, the plan, or the "+50% weekly limits promo through Aug 31"
// change — and nobody edits a config file for any of those.

test('a fresh meter reading re-derives the denominator', () => {
  const c = nextCalibration({
    meter: { usable: true, percent: 60, fetchedAt: '2026-08-25T10:00:00.000Z' },
    weekSpentUsd: 1500, stored: null,
  })
  assert.equal(c.weeklyPercent, 60)
  assert.equal(c.spentUsd, 1500)
  assert.equal(c.meterFetchedAt, '2026-08-25T10:00:00.000Z')
  assert.match(c.source, /live/)
  // $25/point, against the bootstrap's $36.91 — the shape of what the promo expiring
  // would look like, arrived at without anyone touching the file.
  assert.equal(Number((c.spentUsd / c.weeklyPercent).toFixed(2)), 25)
})

test('the same meter fetch is never re-recorded, and a weak one is never recorded', () => {
  const meter = { usable: true, percent: 60, fetchedAt: '2026-08-25T10:00:00.000Z' }
  assert.equal(nextCalibration({ meter, weekSpentUsd: 1500, stored: { meterFetchedAt: meter.fetchedAt } }), null)
  // Expired, and therefore describing a week that is over.
  assert.equal(nextCalibration({ meter: { ...meter, usable: false }, weekSpentUsd: 1500, stored: null }), null)
  // Too early in the week: one rounding step in an integer percentage moves the
  // answer by tens of percent.
  assert.equal(nextCalibration({ meter: { ...meter, percent: CALIB_MIN_PERCENT - 1 }, weekSpentUsd: 100, stored: null }), null)
  assert.equal(nextCalibration({ meter, weekSpentUsd: 0, stored: null }), null)
})

test('the newer of the bootstrap and the machine-recorded calibration wins', () => {
  const boot = { at: '2026-08-20T10:42:05.623Z', weeklyPercent: 99, spentUsd: 3654.11 }
  const later = { at: '2026-08-27T10:00:00.000Z', weeklyPercent: 60, spentUsd: 1500, bucket: 'weekly_all' }
  const older = { at: '2026-08-01T10:00:00.000Z', weeklyPercent: 60, spentUsd: 1500, bucket: 'weekly_all' }
  assert.equal(pickCalibration({ calibration: boot }, later), later)
  assert.equal(pickCalibration({ calibration: boot }, older), boot)
  assert.equal(pickCalibration({ calibration: boot }, null), boot)
  assert.equal(pickCalibration({ calibration: null }, later), later)
})

test('a calibration recorded before the buckets were told apart is not trusted', () => {
  // The one on this machine on 2026-08-27 read `63%` with nothing saying which
  // bucket that was. It cannot be told apart from a Fable-scoped derivation now, and
  // the bootstrap it would displace prices a point LOWER — so falling back trips
  // sooner, not later (obot.agent#331).
  const boot = { at: '2026-08-20T10:42:05.623Z', weeklyPercent: 99, spentUsd: 3654.11, bucket: 'weekly_all' }
  const untagged = { at: '2026-08-27T14:55:22.445Z', weeklyPercent: 63, spentUsd: 3231.66 }
  assert.equal(pickCalibration({ calibration: boot }, untagged), boot)
  assert.equal(pickCalibration({ calibration: null }, untagged), null)
})

test('readSpend records the new calibration and prints which one it used', () => {
  // A later week, with a meter fetch newer than the shipped bootstrap — which is the
  // only way a re-derivation should take effect. The bootstrap wins against anything
  // older than itself, and a test that did not set the dates this way passed its
  // first assertion while the old denominator quietly stayed in force.
  const ws = tmp()
  const cfg = path.join(ws, 'spend.json')
  fs.writeFileSync(cfg, JSON.stringify(CONFIG))
  const env = {
    OBOT_SPEND_CONFIG: cfg,
    OBOT_SPEND_NO_REFRESH: '1',
    OBOT_SPEND_USAGE: usageFile({ '2026-08-27': 800, '2026-08-28': 934.69 }),
    OBOT_SPEND_METER: meterFile({ percent: 45, fetchedAt: '2026-08-29T00:30:00Z',
                                  resetsAt: '2026-09-03T14:59:59.596883+00:00' }),
  }
  const now = new Date('2026-08-29T01:00:00Z')
  const first = readSpend({ workspace: ws, hub: '/hub', env, now })
  assert.equal(first.verdict.recalibrated, '2026-08-29T00:30:00.000Z')
  assert.ok(fs.existsSync(calibrationPath(ws)))
  // $1,734.69 over 45 points = $38.55/point, replacing the bootstrap's $36.91.
  assert.equal(first.config.calibration.spentUsd, 1734.69)
  assert.equal(first.config.calibration.weeklyPercent, 45)
  assert.match(first.section, /calibrated 2026-08-29T00:30:00\.000Z/)
  assert.match(first.section, /live/)

  // Second pass, same meter fetch: nothing re-recorded, same denominator in force.
  const second = readSpend({ workspace: ws, hub: '/hub', env, now })
  assert.equal(second.verdict.recalibrated, null)
  assert.equal(second.config.calibration.spentUsd, 1734.69)
})

test('an expired meter leaves the last recorded calibration standing', () => {
  // The live case: the CLI has not re-fetched since before the reset, so nothing new
  // can be derived — and the week must still be priced against something real.
  const ws = tmp()
  const cfg = path.join(ws, 'spend.json')
  fs.writeFileSync(cfg, JSON.stringify(CONFIG))
  const r = readSpend({
    workspace: ws, hub: '/hub', now: new Date('2026-08-20T18:00:00Z'),
    env: {
      OBOT_SPEND_CONFIG: cfg, OBOT_SPEND_NO_REFRESH: '1',
      OBOT_SPEND_USAGE: usageFile({ '2026-08-20': 40 }),
      OBOT_SPEND_METER: meterFile({ percent: 99, fetchedAt: '2026-08-20T10:42:05Z' }),
    },
  })
  assert.equal(r.verdict.recalibrated, null)
  assert.equal(r.verdict.state, 'ok')
  assert.equal(r.config.calibration.spentUsd, CALIBRATION.spentUsd, 'the bootstrap still applies')
  assert.match(r.section, /expired/i)
})

// ------------------------------------------------- the two weekly buckets (#331)
//
// On 2026-08-27 the guard reported 20% of the week gone seventeen minutes after the
// client's own `/usage` reported 5%. Two separate faults produced that, and the
// fixtures below are the machine's real cached block for that instant rather than
// numbers chosen to make a point:
//
//   limits[] carried `weekly_all` at 5 and `weekly_scoped` (Fable) at 9, from ONE
//   fetch at 20:41:00.593Z. The reading took `Math.max` over everything in the
//   `weekly` group, so the Fable bucket populated the all-model field. There was no
//   second reading for the meter to have "moved" between — both numbers are in the
//   same document.
//
//   The week began at 15:00Z that day, and the priced artifact buckets by whole UTC
//   day. All $1,040.81 of 2026-08-27 was therefore charged to a week that was seven
//   hours old, when $1,004.84 of it had been spent before the reset. That is where
//   the 20% came from: the projection, not the meter.
//
// The rule the fix states: the meter measured everything up to the instant it was
// fetched, so the artifact may only ADD days the meter had not yet seen.

/** The machine's real cached block at 2026-08-27T20:41:00.593Z. */
const LIVE_0827 = { percent: 5, scoped: 9, fetchedAt: '2026-08-27T20:41:00.593Z',
                    resetsAt: '2026-09-03T15:00:00.469896+00:00' }

test('a scoped bucket never populates the all-model field', () => {
  const m = readMeter(meterFile(LIVE_0827), new Date('2026-08-27T21:10:00Z'))
  assert.equal(m.percent, 5, 'the all-model bucket, which is what /usage calls "all models"')
  assert.deepEqual(m.scoped, [{ label: 'Fable', percent: 9 }])
  // The highest bucket is still known — it is what the refusal ladder uses — but it
  // is a separate field, named, and never the week position.
  assert.deepEqual(m.worst, { label: 'Fable', percent: 9 })
})

test('both buckets are stated side by side, and which one binds is said not inferred', () => {
  const v = verdictAt('2026-08-27T21:10:00Z', { '2026-08-27': 1040.81 }, { meter: LIVE_0827 })
  const out = spendNote(v)
  assert.match(out, /all models 5%/)
  assert.match(out, /Fable 9%/)
  assert.match(out, /all-model bucket/, 'the output must say which bucket the points are measured against')
})

test('the artifact does not re-charge the meter for days the meter already measured', () => {
  // The live defect. The week is seven hours old; the artifact holds a whole UTC day
  // that straddles the reset, and the meter — fetched inside that same day — has
  // already counted whatever part of it belongs to this week.
  const v = verdictAt('2026-08-27T21:10:00Z', { '2026-08-27': 1040.81 }, { meter: LIVE_0827 })
  assert.equal(v.week.percentUsed, 5, 'the meter measured this week directly; the artifact has nothing to add')
  assert.equal(v.state, 'ok')
})

test('spend on a day the meter has not seen is still added on top of it', () => {
  // The other direction, and the reason the projection exists at all: the CLI
  // refreshes the meter when it feels like it. A night that runs after the last
  // fetch must not be invisible.
  const v = verdictAt('2026-08-29T04:00:00Z',
                      { '2026-08-27': 1040.81, '2026-08-28': 900, '2026-08-29': 900 },
                      { meter: { ...LIVE_0827, percent: 40, fetchedAt: '2026-08-27T20:41:00.593Z' } })
  // $1,800 on the two days since the fetch, at the bootstrap's $38.07/point.
  assert.ok(v.week.percentUsed > 80, `40 metered plus the two unmetered days, got ${v.week.percentUsed}`)
  assert.match(v.week.source, /since/)
})

test('an unusable meter still projects across the whole window', () => {
  // Nothing about this fix may narrow the fallback: with no meter, the artifact is
  // the only reading there is and every day of the window counts.
  const v = verdictAt('2026-08-19T01:00:00Z', REAL_WEEK)
  assert.equal(v.state, 'stop')
  assert.ok(v.week.percentUsed > 90)
})

test('a scoped bucket past the stop line refuses on its own, by name', () => {
  // The conservatism the old `Math.max` bought by accident, kept on purpose. A
  // model-scoped limit can bind before the all-model one.
  const v = verdictAt('2026-08-27T21:10:00Z', { '2026-08-27': 10 },
                      { meter: { ...LIVE_0827, percent: 20, scoped: 93 } })
  assert.equal(v.state, 'stop')
  assert.equal(v.allowed, false)
  assert.match(v.headline, /Fable/)
  assert.match(v.headline, /93/)
})

test('a scoped bucket below the stop line does not raise the all-model position', () => {
  const v = verdictAt('2026-08-27T21:10:00Z', { '2026-08-27': 10 },
                      { meter: { ...LIVE_0827, percent: 20, scoped: 60 } })
  assert.equal(v.week.percentUsed, 20, 'a Fable bucket says nothing about the all-model allowance')
  assert.equal(v.state, 'ok')
})

test('the denominator is calibrated against the all-model bucket and records which', () => {
  // Pairing every measured dollar with a MODEL-SCOPED percentage prices a point off
  // two different populations. The obot2 workspace spent 100% Opus in the week this
  // was found, while the Fable bucket read 9% — driven entirely by usage the
  // artifact cannot see.
  const meter = readMeter(meterFile({ percent: 40, scoped: 90, fetchedAt: '2026-08-25T10:00:00.000Z',
                                      resetsAt: '2026-08-27T14:59:59.596883+00:00' }),
                          new Date('2026-08-25T12:00:00Z'))
  const c = nextCalibration({ meter, weekSpentUsd: 1500, stored: null })
  assert.equal(c.weeklyPercent, 40, 'the all-model bucket, not the highest one')
  assert.equal(c.bucket, 'weekly_all')
})

test('a night that spans the weekly reset says so rather than asserting the points', () => {
  // The artifact buckets by whole UTC day and the reset lands mid-day, so on one
  // night a week the night's dollars include spend charged to the week just ended.
  // The figure stays (dropping it would let an unbounded night through); the claim
  // it makes is corrected in the output.
  const v = verdictAt('2026-08-27T21:10:00Z', { '2026-08-27': 1040.81 }, { meter: LIVE_0827 })
  assert.match(spendSection(v), /previous allowance week/i)
  const ordinary = verdictAt('2026-08-29T04:00:00Z', { '2026-08-29': 100 },
                             { meter: { ...LIVE_0827, percent: 20 } })
  assert.doesNotMatch(spendSection(ordinary), /previous allowance week/i)
})
