// The car lane reaches the one file a scheduled process writes and he reads.
//
// jwildfire/obot.roadmap#265. Two failures have to be visible here and they are
// different: a sentence that reached no decision (he does not know it failed), and a
// lane that is not being polled at all (nothing he says can land, and every surface
// would otherwise look quiet). The second is the one that would go unnoticed for
// days, so the section says which of the two it is on every sweep.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

test('a section rendered by hand reports the lane without claiming a poll it did not do', () => {
  const md = unroutedSection([], { now: NOW, lane: { armed: true, read: null } })
  assert.doesNotMatch(md, ALARM_RE)
  assert.match(md, /did not poll/i)
})

test('an unreadable unrouted store is an alarm, never an all-clear about his sentences', () => {
  // safeVoice took `.items` and threw the read flag away, so a store it could not open
  // rendered the same line as a clean lane: a positive claim about his dictated
  // sentences made from a failed read (obot.agent#206/#215).
  const md = unroutedSection([], { now: NOW, lane: { armed: true, read: true, routed: 0 }, read: false, why: 'EACCES' })
  const headline = md.split('\n').find((l) => ALARM_RE.test(l))
  assert.ok(headline, 'a failed read must render as an alarm')
  assert.doesNotMatch(md, /none unrouted/, 'and must never claim there are none')
  assert.match(md, /EACCES/)
})

test('sentences left alone for being older than the queue are counted, not hidden', () => {
  const md = unroutedSection([], { now: NOW, lane: { armed: true, read: true, routed: 0, stale: 2 } })
  assert.match(md, /2/)
  assert.match(md, /older|before/i)
})

test('a receipt that failed to write is an alarm — the stamp is what stops a re-read', () => {
  const md = unroutedSection([], { now: NOW, lane: { armed: true, read: true, routed: 1, unstamped: 1 } })
  const line = md.split('\n').find((l) => ALARM_RE.test(l))
  assert.ok(line)
  // Matching the regex is NOT enough. `parseNavigatorState` alarm-tests preamble notes
  // and UNINDENTED plain lines and nothing else; this line was indented, so it parsed as
  // a detail of the line above and rendered grey while this assertion stayed green.
  assert.match(line, /^\S/, 'unindented, or it can never go red however it is worded (hub#241)')
  assert.doesNotMatch(line, /^- /, 'and not a bullet, for the same reason')
})

test('BOTH sweep call sites pass the voice section — the wiring, not just the contract', async () => {
  // renderState's contract was tested and neither call site was, so `voice: safeVoice()`
  // could be deleted from either one and the suite stayed green.
  const src = await readFile(new URL('../sweep.mjs', import.meta.url), 'utf8')
  // The first split is the `export function renderState({` declaration; the rest are
  // the calls.
  const calls = src.split('renderState({').slice(2)
  assert.equal(calls.length, 2, 'if a third call site appears, it needs the section too')
  for (const [i, call] of calls.entries()) {
    // Each call is written on one line, so the line is the argument list. Slicing at
    // the first `})` would stop inside a nested call instead.
    assert.match(call.split('\n')[0], /voice:\s*safeVoice\(\)/, `call site ${i + 1} must pass the voice section`)
    // Same reasoning for the other half of the lane (hub#280): a section wired into
    // renderState's contract and into neither call site renders the fallback forever,
    // which reads as "no reading ran" every five minutes and gets tuned out.
    assert.match(call.split('\n')[0], /decisionEpisodes:\s*safeEpisodes\(\)/,
      `call site ${i + 1} must pass the decision-episode section`)
  }
})

test('a queue snapshot that is corrupt is not reported to him as one never read', () => {
  // safeVoice took `readQueue(WS).queue` and dropped the read flag beside it, so a
  // snapshot file that exists and cannot be parsed produced the same words as a machine
  // that has never read him a queue — two different problems with two different fixes.
  const md = unroutedSection([], {
    now: NOW,
    lane: { armed: true, read: true, routed: 0, queueRead: false, queueWhy: 'queue.json is not readable JSON' },
  })
  const headline = md.split('\n').find((l) => ALARM_RE.test(l))
  assert.ok(headline, 'an unreadable snapshot is a fault, not a quiet lane')
  assert.match(md, /not readable JSON/)
})
