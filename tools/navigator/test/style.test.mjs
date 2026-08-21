// The census's detector half: the five-minute sweep, which is the only vantage point
// on this machine where all nine declared roots exist at once.
//
// Task jwildfire/obot.agent#311, under requirement jwildfire/obot.roadmap#289.
//
// CI gates a pull request and sees one clone; it can never watch a public site
// reintroduce a palette, because safety.viz, open.gismo, open.csr and obot.roadmap are
// not on the runner and never will be. The sweep sees all of them and gates nothing.
// So the two callers are not redundant and neither is optional — the gate half lives
// in tools/style/test/gate.test.mjs.
//
// Every test here is written against the failure. A section that renders is not the
// deliverable; a section that renders `clean` about surfaces nothing opened is the
// defect #309 spent this morning removing, and a caller is exactly where that
// distinction dies.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ALARM_READING, BUDGET_MS, HEADING, collectStyle, styleBroken, styleSection } from '../style.mjs'
import { renderState } from '../sweep.mjs'
import { ALARM_RE } from '../../ops-dashboard/lib/navigator.mjs'
import { MD_HEADING } from '../../style/census.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** A census run that produced this markdown and this exit code, without running one. */
const fake = (stdout, status = 0) => ({ status, stdout, stderr: '', error: null })
const spy = (r) => { const calls = []; return { calls, spawn: (...a) => { calls.push(a); return r } } }

const DRIFTED = `${MD_HEADING}\n\n**STYLE CENSUS GAP** — 1 surface not accounted for.\n\n5 registered exemptions outstanding.\n\n- obot.roadmap/scripts/lib/premise-status.mjs — unregistered palette: declares 6 colour tokens at .pcx\n`
const UNKNOWN = `${MD_HEADING}\n\nClean for what could be read. 4 declared roots and 8 registered claims were not on this machine and went unexamined — unknown, not clean.\n\n5 registered exemptions on the register, 4 of which were not examined this run.\n\n- safety.viz/site — not examined (root): safety.viz is not on this machine. Unknown, not clean.\n`
const CLEAN = `${MD_HEADING}\n\nEvery declared surface was read, and every one accounts for its colours.\n\n5 registered exemptions outstanding.\n`

// ------------------------------------------------------------------ the reading

test('the sweep runs the census itself, bounded by a wall clock rather than by hope', () => {
  // The sweep restarts the dashboard, fast-forwards seven checkouts and renders a
  // dozen sections every five minutes. An unbounded synchronous walk in the middle of
  // that is a cadence failure waiting for a big directory, and "it was fast when I
  // measured it" is not a bound.
  const s = spy(fake(CLEAN))
  collectStyle({ spawn: s.spawn })
  assert.equal(s.calls.length, 1, 'exactly one census per sweep')
  const [cmd, argv, opts] = s.calls[0]
  assert.match(String(cmd), /tools\/style-census$/, 'the command itself, so the sweep and CI run the same code path')
  assert.deepEqual(argv, ['--md'], 'the markdown form, which is what navigator-state.md is made of')
  assert.equal(opts.timeout, BUDGET_MS, 'and a hard timeout, so a slow census costs a section and never the cadence')
})

test('the run is timed, and the cost is stated rather than assumed', () => {
  const got = collectStyle({ spawn: spy(fake(CLEAN)).spawn })
  assert.equal(typeof got.ms, 'number')
  assert.ok(got.ms >= 0)
  assert.match(styleSection(got), /read in \d+ ?ms/, 'a slowdown has to become visible on the page rather than be inferred from a missing sweep')
})

test('the three run states survive the trip into the sweep', () => {
  assert.equal(collectStyle({ spawn: spy(fake(CLEAN)).spawn }).state, 'clean')
  assert.equal(collectStyle({ spawn: spy(fake(UNKNOWN)).spawn }).state, 'unknown')
  assert.equal(collectStyle({ spawn: spy(fake(DRIFTED, 1)).spawn }).state, 'drifted')
})

test('the real census runs through the real seam', () => {
  // Not a fake. Every test above overrides `spawn`, and a default parameter that every
  // test replaces is covered by none of them (obot.agent#229) — this is the one that
  // proves the wiring reaches the tool on disk.
  const got = collectStyle()
  assert.equal(got.read, true, got.why ?? 'the census did not run at all')
  assert.ok(['clean', 'unknown', 'drifted'].includes(got.state), `unexpected state ${got.state}`)
  assert.ok(got.md.startsWith(MD_HEADING), 'and it produced the census\'s own markdown')
  assert.ok(got.ms > 0, 'a real run takes real time')
})

// ------------------------------------------------------------------ the section

test('the section is the census\'s own words, not a second copy of them', () => {
  // The argument of the whole requirement, applied to the check: one sentence, one
  // place. A sweep that re-renders the verdict in its own words is a duplicated store
  // that drifts, which is what #289 is about.
  const md = styleSection(collectStyle({ spawn: spy(fake(DRIFTED, 1)).spawn }))
  for (const line of DRIFTED.trim().split('\n')) assert.ok(md.includes(line), `dropped: ${line}`)
})

test('drift raises a headline the Navigator actually reads', () => {
  const md = styleSection(collectStyle({ spawn: spy(fake(DRIFTED, 1)).spawn }))
  const alarms = md.split('\n').filter((l) => /^\S/.test(l) && !l.startsWith('#') && ALARM_RE.test(l))
  assert.ok(alarms.length, 'the verdict has to be an unindented plain line — parseNavigatorState never alarm-tests a bullet (obot.roadmap#241)')
  assert.match(alarms[0], /STYLE CENSUS GAP/)
})

test('unknown is not rounded up to clean, and is not an alarm either', () => {
  const md = styleSection(collectStyle({ spawn: spy(fake(UNKNOWN)).spawn }))
  assert.match(md, /unknown, not clean/, 'a run that could not look must not report as one that looked and found nothing')
  assert.ok(!md.split('\n').some((l) => ALARM_RE.test(l)),
    'and it must not be red: nobody on a machine without a clone can fix its absence, and a check that is red for an unfixable reason gets switched off')
})

test('a census that could not run is broken, never clean', () => {
  for (const [why, r] of [
    ['it timed out', { status: null, stdout: '', stderr: '', error: new Error('ETIMEDOUT') }],
    ['it is not on this machine', { status: null, stdout: '', stderr: '', error: new Error('ENOENT') }],
    ['it crashed', { status: 2, stdout: '', stderr: 'boom', error: null }],
    ['it printed something else', { status: 0, stdout: 'hello', stderr: '', error: null }],
  ]) {
    const got = collectStyle({ spawn: () => r })
    assert.equal(got.read, false, `${why}: a reading that did not happen is not a reading`)
    const md = styleSection(got)
    assert.ok(md.startsWith(HEADING), `${why}: the section still has to appear — a section that vanishes reads as nothing to report`)
    assert.ok(md.split('\n').some((l) => ALARM_RE.test(l)), `${why}: and it has to be loud`)
    assert.match(md, /Unknown, not clean/i, `${why}: no surface was examined, and the page has to say that rather than nothing`)
  }
})

test('the section heading is the census\'s heading, single-sourced', () => {
  // The broken form and the rendered form must land under the same heading or the
  // Operations Dashboard shows two tabs for one reading, one of which is always empty.
  assert.equal(HEADING, MD_HEADING)
  assert.ok(styleBroken('the tool is missing').startsWith(HEADING))
  assert.ok(styleSection(collectStyle({ spawn: spy(fake(CLEAN)).spawn })).startsWith(HEADING))
})

// ------------------------------------------------------- and it is actually called

test('the state file carries the section, and a sweep that skips it says so', () => {
  const meta = { sweptAt: new Date().toISOString(), cadenceMin: 5, ok: true, repoCount: 7, errors: [] }
  const withIt = renderState({ snapshot: {}, events: [], meta, style: styleSection(collectStyle({ spawn: spy(fake(CLEAN)).spawn })) })
  assert.match(withIt, /## Style census/)

  const without = renderState({ snapshot: {}, events: [], meta, style: null })
  assert.match(without, /## Style census/, 'the section appears even when the reading did not — silence is indistinguishable from a check that has stopped running')
  assert.match(without, new RegExp(ALARM_READING.replace(/\*/g, '\\*')))
})

test('the sweep hands it to renderState on every path it writes the file from', () => {
  // The defect this task exists to remove, asserted directly: the census had no
  // caller. `renderState` accepting a section proves nothing if nothing passes one,
  // and the sweep writes navigator-state.md from two places — the normal pass and the
  // early-failure pass, which is the one that runs when `gh` is down and the one a
  // reader is most likely to be looking at.
  const src = readFileSync(join(REPO, 'tools/navigator/sweep.mjs'), 'utf8')
  const writes = src.split('\n').filter((l) => l.includes('writeFileSync(STATE_MD, renderState({'))
  assert.ok(writes.length >= 2, 'the sweep still writes the state file from more than one path')
  for (const w of writes) assert.match(w, /style: (safeStyle\(\)|style)\.section/, 'every path that writes the file runs the census')
  assert.match(src, /· style: \$\{style\.note\}/, 'and the sweep\'s own log line records that it ran — a page can be stale and look current, a log line cannot be there and absent at once')
})
