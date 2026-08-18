// The two things allowed to interrupt him, and the morning line (obot.agent#205,
// under jwildfire/obot.roadmap#238).
//
// Today there is NO path from this program to his phone. The one wake channel
// that exists was built without one on purpose — tools/navigator/wake.mjs says so
// in its own comment: "the mechanism below was chosen partly because it has no
// path to him."
//
// And the obvious construction is the one that provably cannot work.
// PushNotification is a harness tool, so a script cannot call it; and it reaches
// a phone only when Remote Control is connected, while every scheduler-spawned
// session on this machine is deliberately unbridged. So a cron-spawned sibling
// that pushes is exactly the shape that fails silently.
//
// What is built instead: the fold writes a payload, and a bridged standing
// session already running relays it. That starts no agent on a clock, so it moves
// no autonomy line, and it degrades honestly — with no listener there is no
// interruption and the briefing page still updates.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rcReadyWithDemo, allGoalsBlocked, composeMorning, writePush, PUSH_LOG, listenerAlive } from '../lib/push.mjs'

const ws = () => mkdtempSync(join(tmpdir(), 'foldpush-'))

// ---------------------------------------------------------------- RC with demo
const rcEvent = (ref) => ({ type: 'rc-new', ref, ts: '2026-08-18T06:00:00Z', url: `https://github.com/jwildfire/${ref.split('#')[0]}/pull/${ref.split('#')[1]}` })

test('an RC with a demo is the interrupting kind', () => {
  const r = rcReadyWithDemo([rcEvent('open.gismo#10')], { 'jwildfire/open.gismo#10': { demo: 'https://demo', title: 'open.gismo v0.2.0-RC1' } })
  assert.equal(r.length, 1)
  assert.match(r[0].line, /open\.gismo v0\.2\.0-RC1/)
  assert.match(r[0].line, /demo/)
})

test('an RC with NO demo says demo owed rather than linking the PR and calling it one', () => {
  const r = rcReadyWithDemo([rcEvent('open.gismo#10')], { 'jwildfire/open.gismo#10': { demo: null, title: 'open.gismo v0.2.0-RC1' } })
  assert.equal(r.length, 1)
  assert.match(r[0].line, /demo owed/)
  assert.doesNotMatch(r[0].line, /· demo https?:/, 'a small lie here costs the next push its credibility')
})

test('an RC the cache knows nothing about is still reported, not dropped', () => {
  const r = rcReadyWithDemo([rcEvent('safety.viz#99')], {})
  assert.equal(r.length, 1)
  assert.match(r[0].line, /demo owed/)
})

test('anything that is not a new RC is not an interruption', () => {
  const r = rcReadyWithDemo([{ type: 'comments-new', ref: 'x#1', ts: '2026-08-18T06:00:00Z' }], {})
  assert.equal(r.length, 0)
})

// -------------------------------------------------------------- goals blocked
const goals = { charts: { issue: 78, status: 'active' }, app: { issue: 79, status: 'active' }, old: { issue: 1, status: 'retired' } }

test('every ACTIVE goal blocked at once is the escalation; retired ones do not count', () => {
  const r = allGoalsBlocked(goals, () => ['blocked'])
  assert.equal(r.all, true)
  assert.equal(r.checked, 2, 'the retired goal is not part of "every active goal"')
})

test('one goal still moving is not the escalation', () => {
  const r = allGoalsBlocked(goals, (issue) => (issue === 78 ? ['blocked'] : []))
  assert.equal(r.all, false)
})

test('no active goals at all is NOT "every goal is blocked"', () => {
  const r = allGoalsBlocked({ old: { issue: 1, status: 'retired' } }, () => ['blocked'])
  assert.equal(r.all, false, 'vacuous truth would wake him for an empty registry')
  assert.equal(r.checked, 0)
})

test('a label lookup that fails is unknown, and unknown never escalates', () => {
  const r = allGoalsBlocked(goals, () => { throw new Error('gh down') })
  assert.equal(r.all, false)
  assert.equal(r.unknown, true)
  assert.match(r.why, /gh down/)
})

// ------------------------------------------------------------- the morning line
test('the morning line is counts and one URL, and it is skippable', () => {
  const line = composeMorning({ rcs: 1, decisions: 3, todos: 2 })
  assert.match(line, /1 RC · 3 decisions · 2 todos/)
  assert.match(line, /jwildfire\.github\.io\/obot\.roadmap\/reports\/briefing\//)
  assert.ok(line.length < 120, `a push card is not a page: ${line.length} chars`)
})

test('an empty queue composes no morning line at all', () => {
  assert.equal(composeMorning({ rcs: 0, decisions: 0, todos: 0 }), null,
    'silence has to mean nothing needs you, or it stops being credible')
})

// ------------------------------------------------------------------- the lane
test('a push is written where a listener can see it, and never lost if none is', () => {
  const w = ws()
  const r = writePush(w, { kind: 'morning', text: '1 RC · 3 decisions — briefing' })
  assert.ok(existsSync(join(w, PUSH_LOG)))
  const line = JSON.parse(readFileSync(join(w, PUSH_LOG), 'utf8').trim().split('\n').at(-1))
  assert.equal(line.kind, 'morning')
  assert.equal(r.delivered, false, 'written is not delivered, and the fold must not claim otherwise')
})

test('the fold can tell whether anyone is listening, and says so either way', () => {
  const w = ws()
  assert.equal(listenerAlive(w, { now: new Date('2026-08-18T11:00:00Z') }).alive, false)

  mkdirSync(join(w, '.claude/fold'), { recursive: true })
  writeFileSync(join(w, '.claude/fold/push.listener'), '2026-08-18T10:59:50Z\n')
  assert.equal(listenerAlive(w, { now: new Date('2026-08-18T11:00:00Z') }).alive, true)

  writeFileSync(join(w, '.claude/fold/push.listener'), '2026-08-18T10:40:00Z\n')
  const stale = listenerAlive(w, { now: new Date('2026-08-18T11:00:00Z') })
  assert.equal(stale.alive, false, 'a Monitor dies with its session, so this lane can be silently absent')
  assert.match(stale.why, /stale|no listener/i)
})
