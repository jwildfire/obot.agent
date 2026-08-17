// Tests for the wake detection (jwildfire/obot.roadmap#212).
//
// The fixtures are transcribed from real job records on this machine on 2026-08-17,
// not invented, because the whole module rests on one claim that could only be
// learned by reading them: a stopped worker's `state` field lies. W0007 and W0008
// both read `working` for twenty hours while stuck on a permission prompt, and
// W0009 read `blocked` while dead on a network error. Every case below that matters
// is one of those shapes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEATH, IDLE_MIN, MAX_WAKES_PER_RUN, REWAKE_MIN, STALL_MIN, WAKE_WINDOW_HOURS,
  classify, deliverable, hostWasAway, idleDetection, judgedWorkers, listenerState,
  outsideWindow, parseWakeLog, pending, verdictKeys, wakeLine, wakeSection, workerIdOf,
} from '../wake.mjs'

const NOW = new Date('2026-08-17T06:00:00Z')
const agoMin = (m) => new Date(NOW.getTime() - m * 60000).toISOString()

const job = (over = {}) => ({
  id: 'abc123', name: '👯🤖 W0007 2026-08-16 lastlook', state: 'working', tempo: 'active',
  detail: '', needs: '', updatedAt: agoMin(1), firstTerminalAt: null, ...over,
})

// ---- the three shapes the state field hides ---------------------------------

test('waiting: state reads working while tempo says blocked — the W0007/W0008 shape', () => {
  // Both sat exactly like this for ~20 hours on 2026-08-16 with nobody resolving them.
  const d = classify(job({ state: 'working', tempo: 'blocked', needs: 'approve Bash: python3 …', updatedAt: agoMin(1188) }), NOW)
  assert.deepEqual(d.map((x) => x.kind), ['waiting'])
  assert.match(d[0].line, /waiting 1188m/)
  assert.match(d[0].line, /approve Bash/)
})

test('dead: state reads blocked and the message is a network error — the W0009 shape', () => {
  const d = classify(job({ name: '👯🤖 W0009 2026-08-16 rmbuild', state: 'blocked', tempo: 'blocked',
    detail: "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)",
    needs: 'API unavailable — retry', updatedAt: agoMin(1034) }), NOW)
  assert.deepEqual(d.map((x) => x.kind), ['dead'])
  assert.match(d[0].line, /died/)
  // The trap named in the requirement: a dead worker's record understates what it wrote.
  assert.match(d[0].line, /check GitHub/)
})

test('dead beats waiting: a corpse is blocked and quiet too, and must not be answered', () => {
  const d = classify(job({ state: 'blocked', tempo: 'blocked', needs: 'API unavailable — retry',
    detail: 'API Error: Connection refused', updatedAt: agoMin(120) }), NOW)
  assert.deepEqual(d.map((x) => x.kind), ['dead'])
})

test('stalled: tempo active and nothing for longer than a worker ever pauses', () => {
  const d = classify(job({ updatedAt: agoMin(STALL_MIN + 5), detail: 'writing tests first' }), NOW)
  assert.deepEqual(d.map((x) => x.kind), ['stalled'])
  assert.match(d[0].line, /twenty seconds/)
})

test('a healthy worker is not a detection', () => {
  assert.deepEqual(classify(job({ updatedAt: agoMin(1) }), NOW), [])
})

test('a standing session is never a worker: prime and the Navigator are excluded', () => {
  assert.deepEqual(classify(job({ name: '🎩🤖 obot-prime', state: 'blocked', tempo: 'blocked', needs: 'say go', updatedAt: agoMin(600) }), NOW), [])
  assert.deepEqual(classify(job({ name: '🧭🤖 obot-navigator', state: 'blocked', tempo: 'blocked', needs: 'review D0019', updatedAt: agoMin(600) }), NOW), [])
})

test('one job can be in two stop-states at once, and both are real', () => {
  // W0007 exactly: closed out at 08:13, then twenty hours stuck on a permission prompt.
  const d = classify(job({ state: 'working', tempo: 'blocked', needs: 'approve Bash: bash …',
    firstTerminalAt: agoMin(180), updatedAt: agoMin(90) }), NOW)
  assert.deepEqual(d.map((x) => x.kind).sort(), ['stopped', 'waiting'])
  assert.notEqual(d[0].key, d[1].key) // different keys → each wakes once, on its own floor
})

// ---- suppression: the delivery record is the ledger, not new state ----------

test('a closeout with a verdict does not wake again', () => {
  const jobs = [job({ state: 'done', tempo: 'idle', firstTerminalAt: agoMin(30) })]
  assert.equal(pending(jobs, { now: NOW }).length, 1)
  assert.equal(pending(jobs, { now: NOW, judged: new Set(['W0007']) }).length, 0)
})

test('suppression also matches the freehand slugs the journal used before W-ids', () => {
  const j = job({ name: '👯🤖 2026-08-16 d0014fix', state: 'done', firstTerminalAt: agoMin(30) })
  assert.deepEqual(verdictKeys(j), ['d0014fix', 'abc123'])
  assert.equal(pending([j], { now: NOW, judged: new Set(['d0014fix']) }).length, 0)
})

test('a delivered-but-unjudged closeout stays pending: only a verdict silences it', () => {
  const jobs = [job({ state: 'done', firstTerminalAt: agoMin(30) })]
  const p = pending(jobs, { now: NOW })
  const log = parseWakeLog(wakeLine(p[0], agoMin(120)))
  assert.equal(pending(jobs, { now: NOW }).length, 1)          // still pending
  assert.equal(deliverable(p, log, NOW).deliver.length, 1)      // and past its floor, out again
})

test('closeouts older than the window are counted, never silently dropped', () => {
  const old = job({ state: 'done', firstTerminalAt: agoMin(WAKE_WINDOW_HOURS * 60 + 60) })
  assert.deepEqual(pending([old], { now: NOW }), [])
  assert.equal(outsideWindow([old], { now: NOW }), 1)
  assert.equal(outsideWindow([old], { now: NOW, judged: new Set(['W0007']) }), 0)
})

// ---- delivery: floors and caps, both of which report what they held ---------

test('the re-wake floor holds a repeat, and says how long is left', () => {
  const p = pending([job({ state: 'done', firstTerminalAt: agoMin(5) })], { now: NOW })
  const log = parseWakeLog(wakeLine(p[0], agoMin(5)))
  const { deliver, held } = deliverable(p, log, NOW)
  assert.equal(deliver.length, 0)
  assert.match(held[0].why, new RegExp(`floor ${REWAKE_MIN.stopped}m`))
})

test('the per-run cap holds the overflow and names it rather than truncating', () => {
  const jobs = Array.from({ length: MAX_WAKES_PER_RUN + 2 }, (_, i) =>
    job({ id: `j${i}`, name: `👯🤖 W000${i} 2026-08-17 x`, state: 'done', firstTerminalAt: agoMin(10 + i) }))
  const { deliver, held } = deliverable(pending(jobs, { now: NOW }), [], NOW)
  assert.equal(deliver.length, MAX_WAKES_PER_RUN)
  assert.equal(held.length, 2)
  assert.match(held[0].why, /cap/)
})

test('the wake log round-trips: the key is a field, never re-read out of the prose', () => {
  const p = pending([job({ state: 'done', firstTerminalAt: agoMin(10) })], { now: NOW })[0]
  const parsed = parseWakeLog(`${wakeLine(p, NOW.toISOString())}\nnot a wake line\n`)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].key, p.key)
  assert.equal(parsed[0].at, NOW.toISOString())
})

// ---- the host guard: a suspended laptop is not a stalled fleet --------------

test('hostWasAway is the gap since the previous sweep, not a guess about the lid', () => {
  assert.equal(hostWasAway(agoMin(5), NOW), false)
  assert.equal(hostWasAway(agoMin(600), NOW), true)
  assert.equal(hostWasAway(null, NOW), false) // first run ever: judge normally
})

test('after a suspend, elapsed-time detections are suppressed and closeouts are not', () => {
  // The 2026-08-16 misreading in one test: lid closed at 08:28, every worker on the
  // machine looked stalled and dead on the next reading, and the amendment to #212
  // was filed on that before the power log corrected it.
  const jobs = [
    job({ id: 'a', tempo: 'active', updatedAt: agoMin(600) }),                                   // would be stalled
    job({ id: 'b', tempo: 'blocked', needs: 'approve Bash', updatedAt: agoMin(600) }),           // would be waiting
    job({ id: 'c', state: 'done', firstTerminalAt: agoMin(60) }),                                // a real closeout
  ]
  const p = pending(jobs, { now: NOW, hostWasAway: true })
  assert.deepEqual(p.map((d) => d.kind), ['stopped'])
})

// ---- the supervisor stalling is the same shape one level up -----------------

const nav = (over = {}) => job({ id: 'nav', name: '🧭🤖 obot-navigator', state: 'blocked', tempo: 'blocked', updatedAt: agoMin(IDLE_MIN + 10), ...over })

test('idle: a queue with items and nothing running is itself a detection', () => {
  const d = idleDetection([nav()], { now: NOW, backlog: 41, pendingCount: 0 })
  assert.equal(d.kind, 'idle')
  assert.match(d.line, /41 milestoned issue/)
})

test('idle does not fire while a worker is running', () => {
  assert.equal(idleDetection([nav(), job({ id: 'w', tempo: 'active', updatedAt: agoMin(1) })], { now: NOW, backlog: 41 }), null)
})

test('idle does not fire with an empty queue, a busy Navigator, or a host that was away', () => {
  assert.equal(idleDetection([nav()], { now: NOW, backlog: 0 }), null)
  assert.equal(idleDetection([nav({ tempo: 'active', updatedAt: agoMin(1) })], { now: NOW, backlog: 41 }), null)
  assert.equal(idleDetection([nav()], { now: NOW, backlog: 41, hostWasAway: true }), null)
  assert.equal(idleDetection([nav({ updatedAt: agoMin(IDLE_MIN - 5) })], { now: NOW, backlog: 41 }), null)
})

// ---- the channel, and what the state file says when it is dead -------------

test('listenerState: a fresh heartbeat is armed, a stale one is a loud finding', () => {
  const armed = listenerState('x', NOW, { stat: () => ({ mtimeMs: NOW.getTime() - 20000 }) })
  assert.equal(armed.armed, true)
  const down = listenerState('x', NOW, { stat: () => ({ mtimeMs: NOW.getTime() - 3600000 }) })
  assert.equal(down.armed, false)
  assert.match(down.summary, /WAKE CHANNEL DOWN/)
  const never = listenerState('x', NOW, { stat: () => { throw new Error('ENOENT') } })
  assert.equal(never.armed, false)
  assert.match(never.summary, /wake-listen/) // and says how to arm it
})

test('a dead channel never reads as a judged fleet: the pending list renders anyway', () => {
  const p = pending([job({ state: 'done', firstTerminalAt: agoMin(10) })], { now: NOW })
  const md = wakeSection({
    pending: p, delivered: [], held: [],
    listener: listenerState('x', NOW, { stat: () => { throw new Error('ENOENT') } }),
  })
  assert.match(md, /1 unresolved stop-state/)
  assert.match(md, /WAKE CHANNEL DOWN/)
  assert.match(md, /W0007 closed out/)
})

test('a clean sweep says so out loud — a detector that only speaks on failure looks dead', () => {
  const md = wakeSection({ pending: [], listener: { armed: true, summary: 'wake channel: armed — listener seen 3s ago' } })
  assert.match(md, /wake: clear/)
  assert.match(md, /armed/)
})

test('the bound and the suspend note reach the reader rather than the log', () => {
  const md = wakeSection({ pending: [], outside: 12, awayNote: 'host was away 9h — elapsed-time detections skipped this run' })
  assert.match(md, /12 unjudged closeout/)
  assert.match(md, /host was away/)
})

// ---- small pieces -----------------------------------------------------------

test('workerIdOf finds ids and sub-ids, and nothing where there is none', () => {
  assert.equal(workerIdOf('👯🤖 W0015 2026-08-17 wakefix'), 'W0015')
  assert.equal(workerIdOf('👯🤖 W0015.1 2026-08-17 probe'), 'W0015.1')
  assert.equal(workerIdOf('👯🤖 2026-08-16 d0014fix'), null)
})

test('judgedWorkers reads the append-only journal and survives a torn line', () => {
  const j = judgedWorkers([
    JSON.stringify({ op: 'verdict', worker: 'W0013' }),
    '{"op": "call", "id": "n0065"}',
    '{"op": "verdict", "worker": "W00',
    JSON.stringify({ op: 'verdict', worker: 'd0003' }),
  ].join('\n'))
  assert.deepEqual([...j].sort(), ['W0013', 'd0003'])
})

test('DEATH matches the errors this machine actually produced, not invented ones', () => {
  assert.ok(DEATH.test("API Error: Can't reach the API server (ENOTFOUND)"))
  assert.ok(DEATH.test('API Error: Connection refused — a firewall or proxy may be blocking it'))
  assert.equal(DEATH.test('approve Bash: python3 "$CLAUDE_JOB_DIR/t'), false)
  assert.equal(DEATH.test('Review hub#199 (agent roster cost) and #200'), false)
})

// ---- the section has to survive the dashboard's reader ----------------------
//
// Three times now a verdict has been written where the reader drops it: the config
// ledger's headline behind its notes (obot.agent#129), the ledger verdicts above the
// first heading, the discipline headline as a plain line. This section is checked
// against the actual parser rather than eyeballed, because "it renders" has been
// wrong every previous time it was assumed.

test('the wake section reaches the dashboard with its verdict and its alarm intact', async () => {
  const { parseNavigatorState } = await import('../../ops-dashboard/lib/navigator.mjs')
  const p = pending([job({ state: 'done', firstTerminalAt: agoMin(10) })], { now: NOW })
  const md = [
    '# navigator-state', '', 'swept: 2026-08-17 06:00 · cadence 5m · ok', '',
    wakeSection({
      pending: p, delivered: [], held: [],
      listener: listenerState('x', NOW, { stat: () => { throw new Error('ENOENT') } }),
      outside: 36,
    }),
  ].join('\n')
  const parsed = parseNavigatorState(md, new Date('2026-08-17T04:02:00Z'))
  const wake = parsed.sections.find((s) => s.title === 'Wake')
  assert.ok(wake, 'the Wake section reaches the page at all')
  const notes = wake.items.filter((i) => i.note)
  assert.ok(notes.some((i) => /1 unresolved stop-state/.test(i.text)), 'the verdict renders')
  const alarm = notes.find((i) => /WAKE CHANNEL DOWN/.test(i.text))
  assert.ok(alarm, 'the channel alarm renders as a row of its own, not as small print')
  assert.equal(alarm.alarm, true, 'and is flagged as an alarm')
  assert.ok(notes.some((i) => /36 unjudged closeout/.test(i.text)), 'the bound renders')
  assert.ok(wake.items.some((i) => /W0007 closed out/.test(i.text)), 'and so does the pending row')
})

test('with no job ledger on the machine the channel is unwatched, not clear', () => {
  // Every detector in this module reads `~/.claude/jobs`. On a machine that has
  // never run an agent the pending list is empty because nothing was looked at, and
  // "clear — every worker that stopped has been judged" is the strongest claim on
  // the surface resting on the weakest evidence (jwildfire/obot.roadmap#223).
  const unread = wakeSection({ pending: [], jobsRead: false })
  assert.match(unread, /wake: \*\*NO READING\*\*/)
  assert.match(unread, /not a clear channel/)
  assert.doesNotMatch(unread, /wake: clear/)

  // Read and empty is a measurement and keeps the verdict.
  assert.match(wakeSection({ pending: [] }), /wake: clear/)
})
