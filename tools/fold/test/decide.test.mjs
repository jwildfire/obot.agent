// The gate, which is the whole design (jwildfire/obot.roadmap#238).
//
// The requirement uses one phrase — "content-gated" — for three outputs whose
// false positives cost wildly different amounts, and collapsing them is how this
// becomes the openclaw daily summary again. Those summaries published on a clock
// regardless of content: 559 words on a day they themselves called quiet, asks at
// line 38, and a reader trained to skip. So:
//
//   diary    gates on ACTIVITY   — a wrong yes costs a thin entry; the record still exists
//   briefing gates on CHANGE     — a wrong yes costs nothing; it is one URL rewritten
//   push     gates on CHANGE + a non-empty queue — a wrong yes costs the next push
//
// The asymmetry that matters most is at the bottom: an UNKNOWN must never be
// reported as quiet. The Navigator's canonical defect is a line reading "seven
// repos, two release candidates, workers clean" while all seven queries had
// failed, and /tmp/com.obot.navigator-sweep.err holds 33 KB of connection resets,
// so this is a live condition rather than a hypothetical.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, queueHash } from '../lib/decide.mjs'

const EMPTY_QUEUE = { rcs: [], decisions: [], todos: [], blockers: 0 }
const BUSY_QUEUE = {
  rcs: [{ key: 'jwildfire/open.gismo#10', title: 'open.gismo v0.2.0-RC1' }],
  decisions: [{ key: 'D0019', title: 'Scheduled sessions' }],
  todos: [{ key: 'todo:arm-the-wake', title: 'Arm a scheduled wake' }],
  blockers: 10,
}
const NO_ACTIVITY = { commits: [], events: [], scratchpad: [], unknown: false }
const SOME_ACTIVITY = { commits: ['abc1234'], events: [], scratchpad: [], unknown: false }

const call = (o) => decide({
  activity: NO_ACTIVITY,
  queue: EMPTY_QUEUE,
  queueUnknown: false,
  lastHash: 'sha256:seen-before',
  ...o,
})

test('a quiet night writes nothing at all', () => {
  const d = call({ lastHash: queueHash(EMPTY_QUEUE) })
  assert.equal(d.verdict, 'quiet')
  assert.equal(d.diary, false)
  assert.equal(d.briefing, false)
  assert.equal(d.push, false)
})

test('activity alone writes the diary and nothing else', () => {
  const d = call({ activity: SOME_ACTIVITY, lastHash: queueHash(EMPTY_QUEUE) })
  assert.equal(d.verdict, 'fold')
  assert.equal(d.diary, true, 'a day with ninety-one commits gets an entry')
  assert.equal(d.briefing, false, 'the queue did not move, so the page did not')
  assert.equal(d.push, false, 'nothing new needs him')
})

test('a changed queue re-renders the page but only pushes when it has items', () => {
  const gained = call({ queue: BUSY_QUEUE, lastHash: queueHash(EMPTY_QUEUE) })
  assert.equal(gained.briefing, true)
  assert.equal(gained.push, true)

  const emptied = call({ queue: EMPTY_QUEUE, lastHash: queueHash(BUSY_QUEUE) })
  assert.equal(emptied.briefing, true, 'clearing his queue is worth re-rendering')
  assert.equal(emptied.push, false, 'it is not worth waking him to say nothing needs him')
})

test('a queue he has not closed carries every morning and never pushes twice', () => {
  const same = queueHash(BUSY_QUEUE)
  const d = call({ queue: BUSY_QUEUE, lastHash: same })
  assert.equal(d.push, false, 'this is the property that makes skipping a week free')
  assert.equal(d.briefing, false)
})

test('the first fold publishes the page even with an empty queue, so the URL exists', () => {
  const d = call({ lastHash: null })
  assert.equal(d.briefing, true, 'a bookmarkable URL has to exist before it can be bookmarked')
  assert.equal(d.push, false, 'existing is not a reason to interrupt him')
})

test('an unknown queue is never reported as quiet, and never publishes', () => {
  const d = call({ queue: BUSY_QUEUE, queueUnknown: true, lastHash: queueHash(EMPTY_QUEUE) })
  assert.equal(d.verdict, 'unknown')
  assert.equal(d.briefing, false, 'a page built from failed queries is short, tidy and wrong')
  assert.equal(d.push, false)
})

test('unknown activity folds the diary rather than claiming the night was quiet', () => {
  const d = call({ activity: { ...NO_ACTIVITY, unknown: true }, lastHash: queueHash(EMPTY_QUEUE) })
  assert.equal(d.diary, true, 'the failure direction that matters is claiming quiet when it was not')
  assert.notEqual(d.verdict, 'quiet')
})

test('every verdict carries the evidence behind it, so it can be argued with', () => {
  const d = call({ activity: SOME_ACTIVITY, queue: BUSY_QUEUE, lastHash: null })
  assert.ok(d.reasons.activity, 'why the diary gate opened or did not')
  assert.ok(d.reasons.change, 'why the page gate opened or did not')
  assert.ok(d.reasons.push, 'why he was or was not interrupted')
  assert.match(d.reasons.activity, /commit/i)
})

test('the hash ignores churn that is not a change to his queue', () => {
  const a = { ...BUSY_QUEUE }
  const b = { ...BUSY_QUEUE, rcs: [{ ...BUSY_QUEUE.rcs[0], sweptAt: '00:34', ageDays: 3 }] }
  assert.equal(queueHash(a), queueHash(b), 'age and sweep time move on their own every morning')
})

test('the hash is order-independent, because the collectors are not ordered', () => {
  const two = { ...EMPTY_QUEUE, decisions: [{ key: 'D0019' }, { key: 'D0020' }] }
  const flipped = { ...EMPTY_QUEUE, decisions: [{ key: 'D0020' }, { key: 'D0019' }] }
  assert.equal(queueHash(two), queueHash(flipped))
})

test('the blocker count is in the hash, but never any blocker text', () => {
  const nine = queueHash({ ...EMPTY_QUEUE, blockers: 9 })
  const ten = queueHash({ ...EMPTY_QUEUE, blockers: 10 })
  assert.notEqual(nine, ten, 'the count is the whole permitted payload, and it is a real signal')
})
