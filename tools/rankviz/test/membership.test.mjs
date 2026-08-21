// Membership, which is a different record from the order and is not allowed to pretend
// otherwise.
//
// `rank/top10.json` says in what ORDER; the `top10` and `on-deck` labels say WHICH.
// They are two mechanisms (obot.roadmap#278) and the label record starts earlier than
// the file does — which is the only reason this module exists: it is the one part of
// this page that genuinely extends the record backwards, and every test below is about
// it extending honestly rather than plausibly.
import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import { batchEvents, membershipSpan, replayMembership } from '../membership.mjs'

const ev = (iso, action, label, issue) => ({ iso, action, label, issue })

describe('replayMembership — the sets, as the events left them', () => {
  test('a labelled event adds and an unlabelled event removes', () => {
    const { states } = replayMembership([
      ev('2026-08-19T01:00:00Z', 'labeled', 'top10', 1),
      ev('2026-08-19T01:00:05Z', 'labeled', 'top10', 2),
      ev('2026-08-20T09:00:00Z', 'unlabeled', 'top10', 1),
    ], { labels: ['top10'] })
    assert.equal(states.length, 2)
    assert.deepEqual(states[0].sets.top10, [1, 2])
    assert.deepEqual(states[1].sets.top10, [2])
  })

  test('events arriving newest-first are replayed oldest-first anyway', () => {
    const { states } = replayMembership([
      ev('2026-08-20T09:00:00Z', 'unlabeled', 'top10', 1),
      ev('2026-08-19T01:00:00Z', 'labeled', 'top10', 1),
    ], { labels: ['top10'] })
    assert.deepEqual(states[0].sets.top10, [1])
    assert.deepEqual(states.at(-1).sets.top10, [])
  })

  test('two labels are kept apart, and a promotion shows in both', () => {
    const { states } = replayMembership([
      ev('2026-08-19T12:00:00Z', 'labeled', 'on-deck', 5),
      ev('2026-08-20T17:02:55Z', 'labeled', 'top10', 5),
      ev('2026-08-20T17:02:56Z', 'unlabeled', 'on-deck', 5),
    ], { labels: ['top10', 'on-deck'] })
    assert.deepEqual(states[0].sets['on-deck'], [5])
    assert.deepEqual(states[0].sets.top10, [])
    assert.deepEqual(states.at(-1).sets.top10, [5])
    assert.deepEqual(states.at(-1).sets['on-deck'], [])
  })

  test('removing a label that was never applied changes nothing and does not go negative', () => {
    const { states } = replayMembership([
      ev('2026-08-19T01:00:00Z', 'unlabeled', 'top10', 9),
      ev('2026-08-19T01:00:01Z', 'labeled', 'top10', 1),
    ], { labels: ['top10'] })
    assert.deepEqual(states.at(-1).sets.top10, [1])
  })

  test('no events is no states — not an empty membership', () => {
    const { states, read } = replayMembership([], { labels: ['top10'] })
    assert.deepEqual(states, [])
    assert.equal(read, true)
  })

  test('an event for a label nobody asked about is ignored', () => {
    const { states } = replayMembership([
      ev('2026-08-19T01:00:00Z', 'labeled', 'top10', 1),
      ev('2026-08-19T01:00:02Z', 'labeled', 'enhancement', 2),
    ], { labels: ['top10'] })
    assert.equal(states.length, 1)
    assert.deepEqual(states[0].sets.top10, [1])
  })
})

describe('batchEvents — bursts are one act of labelling, not eleven', () => {
  test('events inside the gap are one batch and events beyond it start another', () => {
    const batches = batchEvents([
      ev('2026-08-19T01:00:00Z', 'labeled', 'top10', 1),
      ev('2026-08-19T01:00:07Z', 'labeled', 'top10', 2),
      ev('2026-08-19T01:00:14Z', 'labeled', 'top10', 3),
      ev('2026-08-19T12:21:10Z', 'labeled', 'on-deck', 4),
    ], 5 * 60 * 1000)
    assert.equal(batches.length, 2)
    assert.equal(batches[0].length, 3)
    assert.equal(batches[1].length, 1)
  })

  test('the gap is measured from the previous event, so a slow drip stays one batch', () => {
    const batches = batchEvents([
      ev('2026-08-19T01:00:00Z', 'labeled', 'top10', 1),
      ev('2026-08-19T01:04:00Z', 'labeled', 'top10', 2),
      ev('2026-08-19T01:08:00Z', 'labeled', 'top10', 3),
    ], 5 * 60 * 1000)
    assert.equal(batches.length, 1)
  })
})

describe('membershipSpan — how far back the label record actually reaches', () => {
  test('is the first and last event, and says whether the fetch reached the beginning', () => {
    const s = membershipSpan([
      ev('2026-08-19T01:32:55Z', 'labeled', 'top10', 278),
      ev('2026-08-21T01:41:31Z', 'labeled', 'top10', 260),
    ], { complete: true })
    assert.equal(s.from, '2026-08-19T01:32:55Z')
    assert.equal(s.to, '2026-08-21T01:41:31Z')
    assert.equal(s.complete, true)
  })

  // The failure this guards: the events endpoint is paginated newest-first, so a page
  // cap that is hit produces a record that LOOKS like it starts when the labels were
  // created. A truncated record that says so is usable; one that does not is a lie
  // about the very thing this page exists to be honest about.
  test('a truncated fetch is reported as truncated, not as the beginning of the record', () => {
    const s = membershipSpan([ev('2026-08-19T01:32:55Z', 'labeled', 'top10', 278)], { complete: false })
    assert.equal(s.complete, false)
    assert.match(s.why, /truncat|not reach|cap/i)
  })

  test('no events at all is unknown, never a zero-length span', () => {
    const s = membershipSpan([], { complete: true })
    assert.equal(s.from, null)
    assert.equal(s.to, null)
  })
})
