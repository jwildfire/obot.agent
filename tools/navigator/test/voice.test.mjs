// The car lane reaches the one file a scheduled process writes and he reads.
//
// jwildfire/obot.roadmap#265. Two failures have to be visible here and they are
// different: a sentence that reached no decision (he does not know it failed), and a
// lane that is not being polled at all (nothing he says can land, and every surface
// would otherwise look quiet). The second is the one that would go unnoticed for
// days, so the section says which of the two it is on every sweep.
import assert from 'node:assert/strict'
import test from 'node:test'

import { ALARM_RE } from '../../ops-dashboard/lib/navigator.mjs'
import { unroutedSection } from '../../voice/lib/route.mjs'

const NOW = new Date('2026-08-20T14:00:00Z')
const item = (over = {}) => ({
  id: 'i1', key: 'k1', at: '2026-08-20T13:50:00.000Z', status: 'open', heard: 1,
  text: 'the thing about the branches, go with the safe one',
  reason: 'you said this was an answer and it matches none of the 2 open decisions',
  reasonKind: 'declared-no-match', candidates: [], ...over,
})

test('an armed and quiet lane says both halves, and neither is an alarm', () => {
  const md = unroutedSection([], { now: NOW, lane: { armed: true, read: true, routed: 0 } })
  assert.doesNotMatch(md, ALARM_RE)
  assert.match(md, /armed/i)
  assert.match(md, /none/i)
})

test('a lane nobody polls says so — a quiet section would otherwise read as a working lane', () => {
  const md = unroutedSection([], { now: NOW, lane: { armed: false, read: true, routed: 0 } })
  assert.match(md, /not armed/i)
  assert.match(md, /voice-decisions arm/, 'and it says the one command that changes that')
})

test('a lane that could not be read is an alarm the page can actually render', () => {
  const md = unroutedSection([], { now: NOW, lane: { armed: true, read: false, why: 'osascript refused' } })
  const headline = md.split('\n').find((l) => ALARM_RE.test(l))
  assert.ok(headline, 'the verdict must match the real ALARM_RE, not a copy of it')
  assert.match(md, /osascript refused/)
})

test('an unrouted sentence is an alarm, with his words on the row', () => {
  const md = unroutedSection([item()], { now: NOW, lane: { armed: true, read: true, routed: 0 } })
  assert.ok(md.split('\n').find((l) => ALARM_RE.test(l)))
  assert.match(md, /the thing about the branches/)
})

test('the sweep renders the section it is handed, and says so when it was handed none', async () => {
  const { renderState } = await import('../sweep.mjs')
  const meta = { sweptAt: '2026-08-20 14:00', cadenceMin: 5, repoCount: 7, ok: true }
  const withIt = renderState({
    snapshot: {}, events: [], meta, voice: unroutedSection([item()], { now: NOW, lane: { armed: true, read: true, routed: 0 } }),
  })
  assert.match(withIt, /## Voice answers/)
  assert.match(withIt, /the thing about the branches/)

  const without = renderState({ snapshot: {}, events: [], meta })
  assert.match(without, /## Voice answers/, 'the section is rendered even when the reading failed')
  assert.ok(without.split('\n').find((l) => ALARM_RE.test(l) && /VOICE/.test(l)),
    'and it is an alarm, because "no reading" is not "nothing was said"')
})
