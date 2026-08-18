// A degraded boundary says so where someone will see it (obot.agent#201, under
// jwildfire/obot.roadmap#238).
//
// When no marker is present, resolveBoundary falls back to local midnight and
// returns a value. Nothing throws, nothing enters model.notices, and the only
// signal anywhere is one clause in the page footer — which is how the dashboard
// spent two weeks scoping its Agents and Roadmap-activity panels to the whole
// day while their labels read "since session start", and nobody noticed.
//
// The fix is not the marker alone. A boundary that degrades silently will
// degrade silently again the first morning the fold does not fire, and the host
// sleeps often enough that this is a when rather than an if.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveBoundary, buildModel } from '../lib/model.mjs'
import { render } from '../lib/render.mjs'

const TZ = new Date('2026-08-18T12:00:00Z').getTimezoneOffset()
const base = { date: '2026-08-18', tzOffsetMinutes: TZ, jobs: { data: [] } }

test('a resolved boundary is not degraded', () => {
  const b = resolveBoundary({
    ...base,
    scratchpad: { data: { marker: { date: '2026-08-18', time: '07:00', sessionNumber: 1 } } },
  })
  assert.equal(b.degraded, false)
  assert.match(b.anchor, /07:00/)
})

test('no marker is DEGRADED, and says what that costs rather than only what it did', () => {
  const b = resolveBoundary({ ...base, scratchpad: { data: { marker: null } } })
  assert.equal(b.degraded, true, 'returning a value is not the same as answering the question')
  assert.match(b.anchor, /no marker/)
  assert.match(b.why, /whole day|midnight/i)
})

test('a marker whose job cannot be resolved is degraded too', () => {
  const b = resolveBoundary({
    ...base,
    scratchpad: { data: { marker: { date: '2026-08-18', time: null, jobId: 'deadbeef', sessionNumber: 1 } } },
  })
  assert.equal(b.degraded, true)
})

test('the degradation reaches model.notices, which is the channel that renders', () => {
  const m = model({ marker: null })
  assert.ok(m.notices.boundary, 'notices enumerates its keys explicitly; an unlisted one renders nowhere')
  assert.match(m.notices.boundary, /whole day|midnight/i)
})

test('and it is gone once a marker exists', () => {
  const m = model({ marker: { date: '2026-08-18', time: '07:00', sessionNumber: 1 } })
  assert.equal(m.notices.boundary, null)
})

test('the page shows it — not in the footer, where nothing is read', () => {
  const html = render(model({ marker: null }))
  const foot = html.lastIndexOf('boundary:')
  const warn = html.indexOf('scoped to the whole day')
  assert.ok(warn > 0, 'the reader must be told, in the body, that the scope is not what the labels claim')
  assert.ok(warn < foot, 'above the footer clause that was the only signal for two weeks')
})

test('the panel labels stop claiming "since session start" when they are not', () => {
  const degraded = render(model({ marker: null }))
  const fine = render(model({ marker: { date: '2026-08-18', time: '07:00', sessionNumber: 1 } }))
  assert.match(fine, /since session start/, 'the honest case keeps its wording')
  assert.doesNotMatch(degraded, /since session start/,
    'a label that lies is worse than a missing one — it is what made this invisible')
})

function model({ marker }) {
  return buildModel({
    collected: {
      jobs: { data: [] },
      agentsCli: { data: [] },
      scratchpad: { data: { marker, overview: null, todo: null, notes: null, scaffold: null, log: null } },
      nextSession: { data: null },
      ghSweep: { data: { items: [], releases: [], fetchedAt: Date.parse('2026-08-18T16:00:00Z') } },
    },
    workspace: '/tmp/nonexistent-ws',
    date: '2026-08-18',
    mode: 'live',
    generatedAtIso: '2026-08-18T16:00:00.000Z',
    tzOffsetMinutes: 240,
  })
}
