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
  DEATH, IDLE_MIN, MAX_WAKES_PER_RUN, RESOLVED_NAMES, RETIRES, RETIRE_MIN, REWAKE_MIN, STALL_MIN,
  TRIGGERED_QUIET_MIN,
  WAKE_WINDOW_HOURS, classify, deliverable, hostWasAway, idleDetection, isBoilerplateDetail,
  judgedAt, judgedSince, judgedWorkers, listenerState, misreadHolds, outsideWindow,
  parseWakeLog, pending, readJobs,
  scrubDetail, triage, TIMED_VERDICT, unactionable, verdictKeys, wakeLine, wakeSection, workerIdOf,
  WAITING_SETTLE_MIN,
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

// ---- the roles that must exit, and the ones that may rest (obot.agent#181) ----
//
// Transcribed from job 64a7980b on this machine, exactly as the harness left it:
// launched 12:46:08Z on 2026-08-17, one timeline event at 13:51:32Z reading
// `state: blocked` with `API Error: Unable to connect to API: SSL certificate
// hostname mismatch`, and nothing after it until a person stopped it at 00:03:43Z
// the next day. Ten hours and twelve minutes, on a detector that already knew that
// shape by heart — it was simply never asked about this session.

const manager = (over = {}) => ({
  id: '64a7980b', name: '\u{1F6A6}\u{1F916} obot-fleet', state: 'blocked', tempo: 'idle',
  detail: 'API Error: Unable to connect to API: SSL certificate hostname mismatch',
  needs: null, updatedAt: agoMin(1), firstTerminalAt: null, ...over,
})

const standing = (tag, over = {}) => ({
  id: 'std1', name: `${tag} obot-role`, state: 'blocked', tempo: 'idle', detail: 'idle',
  needs: null, updatedAt: agoMin(612), firstTerminalAt: null, ...over,
})

test('a blocked admiral is dead, and reads as dead on the first sweep that sees it', () => {
  const d = classify(manager({ updatedAt: agoMin(5) }), NOW)
  assert.deepEqual(d.map((x) => x.kind), ['dead'])
  assert.match(d[0].line, /^admiral died/, 'named by its role — it has no worker id and never will')
  assert.match(d[0].line, /SSL certificate hostname mismatch/)
})

test('the ten hours it actually sat there produce one detection, not silence', () => {
  const d = classify(manager({ updatedAt: agoMin(612) }), NOW)
  assert.equal(d.length, 1)
  assert.equal(d[0].kind, 'dead')
  assert.equal(d[0].key, 'dead:64a7980b')
})

test('a manager wedged with a message nobody has a pattern for is still not silent', () => {
  // The `dead` list is signatures taken from records that have already happened. A
  // wedge carrying a new message must not be invisible because it is new.
  const unknown = manager({ detail: 'waiting on something nobody has written a pattern for yet' })
  assert.deepEqual(classify({ ...unknown, updatedAt: agoMin(TRIGGERED_QUIET_MIN - 1) }, NOW), [],
    'inside its budget it is simply working')
  const d = classify({ ...unknown, updatedAt: agoMin(TRIGGERED_QUIET_MIN + 1) }, NOW)
  assert.deepEqual(d.map((x) => x.kind), ['wedged'])
  assert.match(d[0].line, /will not exit on its own/)
  assert.ok(REWAKE_MIN.wedged, 'and it has a re-wake floor like every other kind')
})

test('a manager that exited cleanly is the design working, not a closeout to judge', () => {
  // Its whole point is that it ends. Asking for a verdict on every exit would put a
  // standing nag behind a triggered role.
  for (const state of ['done', 'stopped', 'failed']) {
    assert.deepEqual(classify(manager({ state, detail: 'acted and exited', firstTerminalAt: agoMin(5) }), NOW), [],
      `a ${state} manager carries no deliverable of its own`)
  }
})

test('a manager waiting on a human says what it is waiting for', () => {
  // Past the settle. At eleven minutes this reads `settling` and is held for one
  // sweep rather than delivered (obot.agent#176) — the four minutes are the price of
  // not waking anyone on a state the record has not been given a chance to contradict.
  const waiting = manager({ detail: 'awaiting approval', needs: 'approve Bash: obot-merge 158', updatedAt: agoMin(16) })
  const d = classify(waiting, NOW)
  assert.deepEqual(d.map((x) => x.kind), ['waiting'])
  assert.match(d[0].line, /approve Bash/)
  assert.deepEqual(classify({ ...waiting, updatedAt: agoMin(11) }, NOW).map((x) => x.kind), ['settling'])
})

test('the exclusion that was correct still holds: a resting role is never a corpse', () => {
  // The reason the exclusion existed, and it has not changed — prime and the
  // Navigator wait between wakings, so blocked is their ordinary state.
  for (const tag of ['\u{1F3A9}\u{1F916}', '\u{1F9ED}\u{1F916}']) {
    assert.deepEqual(classify(standing(tag), NOW), [], `${tag} blocked and quiet ten hours is resting`)
    assert.deepEqual(classify(standing(tag, { state: 'done', firstTerminalAt: agoMin(30) }), NOW), [],
      `${tag} finishing a turn is not a closeout awaiting judgement`)
    assert.deepEqual(classify(standing(tag, { detail: 'API Error: Connection refused' }), NOW), [],
      `${tag} is not judged even on a death signature — that stays out of scope`)
  }
})

test('one reading per job: a wedge is never stacked on top of a diagnosis', () => {
  const d = classify(manager({ updatedAt: agoMin(612) }), NOW)
  assert.equal(d.filter((x) => x.kind === 'wedged').length, 0)
})

test('a suspended host suppresses the elapsed-time reading for a manager too', () => {
  const unknown = manager({ detail: 'no signature here', updatedAt: agoMin(612) })
  assert.deepEqual(classify(unknown, NOW, { hostWasAway: true }), [],
    'a detector cannot run on a sleeping host, so elapsed time proves nothing')
})

test('the whole fleet at once: the admiral is seen, the resting roles are not', () => {
  const found = triage([
    manager({ updatedAt: agoMin(612) }),
    standing('\u{1F3A9}\u{1F916}', { id: 'p1' }),
    standing('\u{1F9ED}\u{1F916}', { id: 'n1' }),
  ], { now: NOW })
  // The admiral is the only one read at all — that is what this has always asserted.
  // Since obot.agent#157 a dead reading is reported once and then stands rather than
  // repeating, so it lands in `standing` rather than in `live`; what must not change
  // is that prime and the Navigator produce no reading of any kind.
  assert.deepEqual([...found.live, ...found.standing].map((d) => d.job), ['64a7980b'])
  assert.deepEqual(found.standing.map((d) => d.kind), ['dead'])
  assert.deepEqual(found.live, [])
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

// ---- the state field does not merely hide things, it invents them -------------
//
// obot.agent#176. On 2026-08-17 this channel reported W0033 (job d2dc1b30) as
// "waiting 12m and nobody has resolved it — needs: restart ops-dashboard: pkill …".
// Nothing was pending. No restart command was ever run and no permission prompt was
// raised in that session: it had DECIDED not to restart the dashboard and named that
// as an outstanding action in its report. The harness's own classifier read that
// sentence — an action somebody else had to take — as this session being blocked on
// it. So `blocked` is not a signal to be trusted and then filtered; it is the thing
// being fabricated, and the admiral closes sessions on it.
//
// Every fixture below is transcribed from a record on this machine.

const NOWL = new Date('2026-08-17T07:33:00Z')

// d2dc1b30, verbatim. The block at 07:16:18 was written from its own prose; the next
// entry is 07:29:15 and the last is 07:32:09, so the session was working throughout.
const misreadJob = (over = {}) => ({
  id: 'd2dc1b30', name: '👯🤖 W0033 2026-08-17 agentdate', state: 'blocked', tempo: 'blocked',
  detail: 'ops-dashboard stale (pid 42255); need manual restart to see merged changes',
  needs: 'restart ops-dashboard: pkill -f "ops-dashboard.mjs --serve" && …',
  updatedAt: '2026-08-17T07:29:15.879Z',
  firstTerminalAt: '2026-08-17T07:11:28.873Z',
  lastBlockedAt: '2026-08-17T07:29:15.879Z',
  movedAfterBlockedAt: '2026-08-17T07:32:09.627Z',
  ...over,
})

// 5ccdd375 / W0007, verbatim, and the reason `firstTerminalAt` is not used as a
// discriminator anywhere: it closed out at 08:13:32, was RESUMED four minutes later,
// and then froze on a real permission prompt until a person stopped it 20.8 hours
// on. Its terminal watermark precedes its block by 71.8 minutes — the same sign as
// W0033's, and further out.
const stuckAfterCloseoutJob = (over = {}) => ({
  id: '5ccdd375', name: '👯🤖 W0007 2026-08-16 lastlook', state: 'working', tempo: 'blocked',
  detail: '', needs: 'approve Bash: bash …/tools/scratchpad-log …',
  updatedAt: '2026-08-16T09:25:23.193Z',
  firstTerminalAt: '2026-08-16T08:13:32.955Z',
  lastBlockedAt: null, movedAfterBlockedAt: null,
  ...over,
})

test('the fabricated block: a session that went on working is not waiting', () => {
  const d = classify(misreadJob(), NOWL)
  assert.equal(d.filter((x) => x.kind === 'waiting').length, 0,
    'this is the wake that fired on 2026-08-17T07:28:40Z, and it must not fire again')
  const m = d.find((x) => x.kind === 'misread')
  assert.ok(m, 'suppressed, and said out loud — a silent gate is indistinguishable from a broken one')
  assert.match(m.line, /07:32:09/, 'it names the activity that followed the block')
})

test('the settle is what makes that true in time, not only in hindsight', () => {
  // Replayed at the instant the false wake actually fired. The session had not yet
  // contradicted the record — its next entry was still 35 seconds away — so the
  // discriminator cannot fire and the ONLY thing standing between a fabricated state
  // and a notification is the hold.
  const atTheWake = misreadJob({
    updatedAt: '2026-08-17T07:16:18.954Z',
    lastBlockedAt: '2026-08-17T07:16:18.954Z',
    movedAfterBlockedAt: null,
  })
  const d = classify(atTheWake, new Date('2026-08-17T07:28:40.973Z'))
  assert.equal(d.filter((x) => x.kind === 'waiting').length, 0, 'quiet 12.4m is under grace + settle')
  assert.ok(d.some((x) => x.kind === 'settling'))

  // And one sweep later the record has answered: 07:29:15, 07:30:41, 07:32:09.
  assert.ok(classify(misreadJob(), NOWL).some((x) => x.kind === 'misread'))
})

test('a real stall is delayed by the settle and never suppressed by it', () => {
  const w0007 = classify(stuckAfterCloseoutJob(), new Date('2026-08-17T05:21:23.193Z'))
  assert.ok(w0007.some((x) => x.kind === 'waiting'), '1196 minutes is not a settle question')
  assert.equal(w0007.filter((x) => x.kind === 'misread').length, 0)

  // The four minutes the settle costs, stated as a test rather than as a claim.
  const fresh = { ...stuckAfterCloseoutJob(), updatedAt: agoMin(12) }
  assert.deepEqual(classify(fresh, NOW).map((x) => x.kind), ['stopped', 'settling'])
  assert.deepEqual(classify({ ...fresh, updatedAt: agoMin(16) }, NOW).map((x) => x.kind), ['stopped', 'waiting'])
})

test('the terminal watermark is used nowhere — it is true for the real stall too', () => {
  // W0007's `firstTerminalAt` precedes its block by 71.8 minutes and W0033's by 5.2.
  // Any rule ordering against it suppresses the true case harder than the false one,
  // and an ANNOTATION built on it would have printed a warning on the one detection
  // in this corpus that was right. So the line carries no such caveat.
  const w = classify(stuckAfterCloseoutJob(), new Date('2026-08-17T05:21:23.193Z')).find((x) => x.kind === 'waiting')
  assert.ok(!/CHECK IT FIRST|terminal result/.test(w.line), 'no doubt is cast on a genuine stall')
  assert.match(w.line, /re-read/, 'what it says instead is that the record was re-read and had not moved')
})

test('a tempo-block has no entry to measure "after" from, so it is never refuted by one', () => {
  // W0007 and W0008 wrote no `blocked` timeline entry at all. Anchoring a tempo-block
  // on some earlier, unrelated block and finding ordinary work after it would suppress
  // the genuine article.
  const d = classify(stuckAfterCloseoutJob({
    lastBlockedAt: '2026-08-16T07:45:00.000Z',
    movedAfterBlockedAt: '2026-08-16T08:00:00.000Z',
  }), new Date('2026-08-17T05:21:23.193Z'))
  assert.ok(d.some((x) => x.kind === 'waiting'))
  assert.equal(d.filter((x) => x.kind === 'misread').length, 0)
})

test('the anchor is the LAST blocked entry: a multi-entry block does not resume itself', () => {
  // 7f91b395 / W0021, verbatim: a genuine stall whose blocked run is three entries,
  // 05:27:25 / 05:28:03 / 05:29:14, hand-stopped an hour later. The middle entry is
  // the obot.agent#177 template comment — so anchoring on the run's START would let
  // one bug disarm the gate for the other.
  const d = classify({
    id: '7f91b395', name: '👯🤖 W0021 2026-08-17 gsrelease', state: 'blocked', tempo: 'blocked',
    detail: 'v1.1.0 is held at the tag pending @jwildfire\'s ruling on SafetyCensus()',
    needs: '@jwildfire: rule on SafetyCensus() to resume v1.1.0 release',
    updatedAt: '2026-08-17T05:29:14.239Z', firstTerminalAt: null,
    lastBlockedAt: '2026-08-17T05:29:14.239Z', movedAfterBlockedAt: null,
  }, new Date('2026-08-17T06:31:53.330Z'))
  assert.deepEqual(d.map((x) => x.kind), ['waiting'])
})

test('a misread never reaches the admiral: neither held kind is one it acts on', () => {
  for (const j of [misreadJob(), misreadJob({ updatedAt: '2026-08-17T07:29:15.879Z', movedAfterBlockedAt: null, lastBlockedAt: '2026-08-17T07:29:15.879Z' })]) {
    const kinds = classify(j, NOWL).map((x) => x.kind)
    assert.ok(!kinds.some((k) => ['waiting', 'stalled', 'dead'].includes(k)), JSON.stringify(kinds))
  }
})

test('neither a suppression nor a hold switches off the wedged catch-all beneath it', () => {
  // A budgeted role has no `stopped` detection to fall back on, so if either counted
  // as a detection the one safety net under a manager that really has stopped would
  // switch itself off exactly when the record had just been shown to be unreliable.
  const d = classify(misreadJob({ name: '⚓🤖 obot-admiral', updatedAt: agoMin(TRIGGERED_QUIET_MIN + 1) }), NOW)
  assert.ok(d.some((x) => x.kind === 'wedged'))
})

test('the same discriminator covers a fabricated death, which is acted on in an hour', () => {
  // The DEATH regex reads `detail` and `needs`, both of which are the session's own
  // prose. "checking gh rate limits" and "postmortem: W0009 lost to API error" are
  // both real lines from this machine's timelines, and both match it.
  const d = classify(misreadJob({ detail: 'postmortem: W0009 lost to API error', needs: '' }), NOWL)
  assert.equal(d.filter((x) => x.kind === 'dead').length, 0)
  assert.ok(d.some((x) => x.kind === 'misread'))
})

test('a death is not settled: its signature is a transport error, not a decision', () => {
  const d = classify(job({ state: 'blocked', tempo: 'blocked', updatedAt: agoMin(11),
    detail: "API Error: Can't reach the API server (ENOTFOUND)" }), NOW)
  assert.deepEqual(d.map((x) => x.kind), ['dead'], 'reported on the first sighting, as before')
})

test('held detections stay out of the wake list and are counted in the section', () => {
  const jobs = [misreadJob(), stuckAfterCloseoutJob({ updatedAt: agoMin(12) })]
  const p = pending(jobs, { now: NOW })
  assert.ok(!p.some((d) => ['misread', 'settling'].includes(d.kind)), 'nobody is woken for a state that was never real, or not yet read twice')
  const held = misreadHolds(jobs, { now: NOW })
  assert.equal(held.length, 2)
  const section = wakeSection({ pending: p, misread: held, jobsRead: true })
  assert.match(section, /held/i, 'the count is on the page — obot.agent#129, third time')
  assert.ok(!/^\s+.*held/im.test(section), 'unindented: the dashboard reads an indented line as a detail and drops its alarm')
})

test('readJobs carries the timeline facts the gate needs', () => {
  const timeline = [
    { at: '2026-08-17T07:11:28.873Z', state: 'done', detail: 'merged' },
    { at: '2026-08-17T07:16:18.954Z', state: 'blocked', detail: 'ops-dashboard stale (pid 42255)' },
    { at: '2026-08-17T07:29:15.879Z', state: 'blocked', detail: 'boilerplate' },
    { at: '2026-08-17T07:30:41.007Z', state: 'working', detail: 'Inspecting my own job record' },
    { at: '2026-08-17T07:32:09.627Z', state: 'done', detail: 'mechanism established' },
  ].map((e) => JSON.stringify(e)).join('\n')
  const read = (p) => {
    if (p.endsWith('state.json')) return JSON.stringify({ name: '👯🤖 W0033', state: 'done', updatedAt: '2026-08-17T07:32:09.627Z' })
    if (p.endsWith('timeline.jsonl')) return timeline
    throw new Error('no such file')
  }
  const [j] = readJobs('/jobs', { read, list: () => ['d2dc1b30'] })
  assert.equal(j.lastBlockedAt, '2026-08-17T07:29:15.879Z', 'the LAST block, not the first')
  assert.equal(j.movedAfterBlockedAt, '2026-08-17T07:32:09.627Z')
  assert.equal(j.lastActivityAt, '2026-08-17T07:32:09.627Z')
  assert.equal(j.firstTerminalAt, '2026-08-17T07:11:28.873Z', 'and the watermark still comes off the timeline when the state file lacks it')
})

// ---- obot.agent#177: template boilerplate is not a session's status -----------

test('a detail that is structurally a comment is not a detail', () => {
  const boiler = '<!-- how to use: this is the briefing a lead session hands a spawned sibling. Copy the block'
  assert.equal(isBoilerplateDetail(boiler), true)
  assert.equal(isBoilerplateDetail('  \n<!-- anything -->'), true, 'leading whitespace is still a comment')
  assert.equal(isBoilerplateDetail('merged and closed out'), false)
  assert.equal(isBoilerplateDetail(''), false)
  assert.equal(scrubDetail(boiler), '', 'it carries no information about the session, so it carries none onto a surface')
  assert.equal(scrubDetail('merged and closed out'), 'merged and closed out')
})

test('boilerplate never reaches a wake line, and never counts as a death signature', () => {
  const d = classify(job({ state: 'blocked', tempo: 'blocked', updatedAt: agoMin(120),
    detail: '<!-- how to use: this is the briefing a lead session hands a spawned sibling. -->',
    needs: 'approve Bash: git push' }), NOW)
  assert.ok(!/how to use/.test(JSON.stringify(d)), 'template text is not what the session is doing')
})

test('readJobs scrubs boilerplate at the read boundary, so no consumer has to remember', () => {
  const read = (p) => {
    if (p.endsWith('state.json')) {
      return JSON.stringify({ name: '👯🤖 W0044', state: 'working', tempo: 'active',
        detail: '<!-- how to use: this is the briefing a lead session hands a spawned sibling. -->',
        updatedAt: '2026-08-17T07:29:15.879Z' })
    }
    throw new Error('no timeline')
  }
  const [j] = readJobs('/jobs', { read, list: () => ['b4c16f12'] })
  assert.equal(j.detail, '', 'the Agents tab renders this field as a task tag on a surface @jwildfire reads')
})

// ---- the list can only grow: three states, and none of them collapsed ------
//
// obot.agent#157. Nine minutes after this channel was armed it had woken the
// Navigator three times for the same three workers, all of them already judged and
// none of them able to change. The fixtures below are those three workers and the
// two later ones that prove the fix did not overshoot.

/** The 2026-08-17 05:21 batch, exactly as the job records held it. */
const batch = () => [
  job({ id: '5ccdd375', name: '👯🤖 W0007 2026-08-16 lastlook', state: 'working', tempo: 'blocked',
    needs: 'approve Bash: gh pr create …', updatedAt: agoMin(1188) }),
  job({ id: '03046e41', name: '👯🤖 W0008 2026-08-16 d0018', state: 'working', tempo: 'blocked',
    needs: 'approve Write: drafts/…', updatedAt: agoMin(1180) }),
  job({ id: 'cdd4df64', name: '👯🤖 W0009 2026-08-16 rmbuild', state: 'blocked', tempo: 'blocked',
    detail: "API Error: Can't reach the API server", updatedAt: agoMin(1034) }),
]

const judgedAll = new Set(['W0007', 'W0008', 'W0009'])
/** All three verdicts were written at 21:31 the evening before — after every onset. */
const judgedThen = new Map([['W0007', NOW.getTime()], ['W0008', NOW.getTime()], ['W0009', NOW.getTime()]])

test('the three that woke it three times in nine minutes wake nothing at all', () => {
  const t = triage(batch(), { now: NOW, judged: judgedAll, judgedAt: judgedThen })
  assert.deepEqual(t.live, [], 'nothing pending')
  assert.deepEqual(t.standing, [], 'and nothing standing either — a verdict outranks a retirement')
  assert.deepEqual(t.resolved.map((d) => d.worker).sort(), ['W0007', 'W0008', 'W0009'])
  assert.equal(deliverable(t.live, [], NOW).deliver.length, 0, 'no wake goes out')
})

test('and each of the three is still findable, with what settled it', () => {
  const t = triage(batch(), { now: NOW, judged: judgedAll, judgedAt: judgedThen })
  const md = wakeSection({ pending: t.live, resolved: t.resolved, standing: t.standing, jobsRead: true })
  for (const w of ['W0007', 'W0008', 'W0009']) assert.match(md, new RegExp(w), `${w} is named, not dropped`)
  assert.match(md, /resolved: 3 stop-state/)
  assert.match(md, /delivery record/, 'and the reader is told where the verdicts are')
})

test('a verdict recorded BEFORE the stop-state began settles nothing — the W0049 case', () => {
  // Judged `confirmed` at 06:22 on 2026-08-18, went on working, found parked at
  // 06:55. That wake was right, and it produced the `drift` verdict at 07:59.
  const j = job({ id: '006fec4f', name: '👯🤖 W0049 2026-08-18 oa198conflict', state: 'working',
    tempo: 'blocked', needs: 'approve Bash: gh api …', updatedAt: agoMin(33) })
  const t = triage([j], { now: NOW, judged: new Set(['W0049']),
    judgedAt: new Map([['W0049', NOW.getTime() - 60 * 60000]]) })
  assert.deepEqual(t.live.map((d) => d.kind), ['waiting'], 'the later stop-state still wakes')
  assert.deepEqual(t.resolved, [])
})

test('a caller with only the set of names keeps the old, untimed suppression', () => {
  // The admiral and every test written before this pass a Set. A gate that switched
  // itself off for a field they do not pass would be a silent widening.
  const j = job({ state: 'done', firstTerminalAt: agoMin(30) })
  assert.equal(triage([j], { now: NOW, judged: new Set(['W0007']) }).live.length, 0)
  assert.equal(judgedSince(j, { at: j.firstTerminalAt }, new Set(['W0007'])).at, null)
})

// ---- standing: reported once, then never again, and never silently ----------

test('a dead worker is unactionable the instant it is read — there is no hour that helps', () => {
  const dead = job({ id: 'x1', state: 'blocked', tempo: 'blocked',
    detail: 'API Error: Connection refused', updatedAt: agoMin(11) })
  const t = triage([dead], { now: NOW })
  assert.deepEqual(t.live, [])
  assert.deepEqual(t.standing.map((d) => d.kind), ['dead'])
  assert.match(t.standing[0].line, /record is terminal/)
  assert.match(t.standing[0].line, /delivery-log/, 'and it says what it needs')
})

test('the dead worker woken seven times over sixteen hours is woken once', () => {
  // dead:63b5b6fb — W0035 died at 07:39 on 2026-08-17 and the channel woke for it
  // at 07:39, 12:36, 13:38, 14:38, 16:49, 22:10 and 23:40.
  const dead = job({ id: '63b5b6fb', name: '👯🤖 W0035 2026-08-17 agenttime', state: 'blocked',
    tempo: 'blocked', detail: "You've hit your session limit · API Error", updatedAt: agoMin(2) })
  const first = triage([dead], { now: NOW }).standing
  const { deliver } = deliverable(first, [], NOW)
  assert.equal(deliver.length, 1, 'the death is reported')
  // Sixteen hours later, on the same unchanged record.
  const later = new Date(NOW.getTime() + 16 * 60 * 60000)
  const log = parseWakeLog(wakeLine(deliver[0], NOW.toISOString()))
  const again = deliverable(triage([dead], { now: later }).standing, log, later)
  assert.equal(again.deliver.length, 0, 'and never again')
  assert.match(again.held[0].why, /already delivered/)
})

test('a waiting worker keeps waking while anyone might still answer, then retires once', () => {
  const stuck = (m) => job({ id: 'w1', tempo: 'blocked', needs: 'approve Bash: rm …', updatedAt: agoMin(m) })
  // Inside the window nothing is retired: this is the channel working.
  const early = triage([stuck(20)], { now: NOW })
  assert.deepEqual(early.live.map((d) => d.kind), ['waiting'])
  assert.deepEqual(early.standing, [])
  // Past it, exactly once, and with the ask changed from "resolve this" to "stop it".
  const late = triage([stuck(RETIRE_MIN + 1)], { now: NOW })
  assert.deepEqual(late.live, [])
  assert.equal(late.standing.length, 1)
  assert.match(late.standing[0].line, /nobody else can answer/)
  assert.match(late.standing[0].key, /^standing:waiting:/, 'its own key: the ask is a different ask')
})

test('a retirement is recorded in the append-only log, not implied by silence', () => {
  const late = triage([job({ id: 'w1', tempo: 'blocked', needs: 'approve Bash: rm …',
    updatedAt: agoMin(RETIRE_MIN + 1) })], { now: NOW }).standing
  const line = wakeLine(deliverable(late, [], NOW).deliver[0], NOW.toISOString())
  assert.match(line, /WAKE standing:waiting:w1/, 'greppable, timestamped, permanent')
  assert.equal(parseWakeLog(line)[0].key, 'standing:waiting:w1')
})

test('a second episode of the same job is new, and the first retirement does not gag it', () => {
  const key = 'standing:waiting:w1'
  const old = parseWakeLog(`${agoMin(600)} WAKE ${key} — retired the first time`)
  // It came back, worked, and got stuck again. Same job, same key, later onset.
  const again = triage([job({ id: 'w1', tempo: 'blocked', needs: 'approve Bash: rm …',
    updatedAt: agoMin(RETIRE_MIN + 1) })], { now: NOW }).standing
  assert.equal(deliverable(again, old, NOW).deliver.length, 1, 'a later onset is a later episode')
})

// ---- and the bound that was already there, untouched ------------------------

test('no closeout is ever retired: the two suppressions cover disjoint kinds', () => {
  assert.ok(!RETIRES.has('stopped'), 'the closeout nag is what this channel is for')
  const ancient = job({ state: 'done', tempo: 'idle', firstTerminalAt: agoMin(23 * 60),
    updatedAt: agoMin(23 * 60) })
  const t = triage([ancient], { now: NOW })
  assert.deepEqual(t.live.map((d) => d.kind), ['stopped'],
    'still nagging at 23h, however long it has not moved')
  assert.equal(unactionable(t.live[0], ancient, NOW), null)
})

test('the window still bounds closeouts and only closeouts, at the number it always had', () => {
  assert.equal(WAKE_WINDOW_HOURS, 24)
  const old = job({ state: 'done', firstTerminalAt: agoMin(WAKE_WINDOW_HOURS * 60 + 60) })
  assert.deepEqual(triage([old], { now: NOW }).live, [])
  assert.deepEqual(triage([old], { now: NOW }).standing, [], 'counted by the bound, not by a retirement')
  assert.equal(outsideWindow([old], { now: NOW }), 1)
})

// ---- what the reader sees ---------------------------------------------------

test('a fleet with standing entries is never reported as clear', () => {
  const t = triage([job({ id: 'x1', state: 'blocked', tempo: 'blocked',
    detail: 'API Error: Connection refused', updatedAt: agoMin(11) })], { now: NOW })
  const md = wakeSection({ pending: t.live, standing: t.standing, resolved: t.resolved, jobsRead: true })
  assert.ok(!/wake: clear/.test(md), 'a list nobody can act on is not a clear one')
  assert.match(md, /nothing anyone can act on/)
  assert.match(md, /standing: 1 stop-state/)
  assert.match(md, /### Standing/)
})

test('a genuinely new stop-state is the first row, not the fourth', () => {
  const jobs = [
    ...batch(),
    job({ id: 'fresh', name: '👯🤖 W0114 2026-08-21 wakedrain', state: 'done', firstTerminalAt: agoMin(4) }),
  ]
  // The three from yesterday are unjudged this time, so nothing but the retirement
  // keeps them out of the way — which is the case the issue is actually about.
  const t = triage(jobs, { now: NOW })
  const md = wakeSection({ pending: t.live, standing: t.standing, resolved: t.resolved, jobsRead: true })
  const rows = md.split('\n').filter((l) => l.startsWith('- '))
  assert.match(rows[0], /W0114/, 'the new one leads')
  assert.equal(t.live.length, 1)
  assert.equal(t.standing.length, 3, 'and the other three stand rather than repeat')
})

test('standing rows sit BELOW the pending list, never above it', () => {
  const t = triage([...batch(), job({ id: 'fresh', name: '👯🤖 W0114 x', state: 'done',
    firstTerminalAt: agoMin(4) })], { now: NOW })
  const md = wakeSection({ pending: t.live, standing: t.standing, resolved: t.resolved, jobsRead: true })
  assert.ok(md.indexOf('### Pending') < md.indexOf('### Standing'))
})

test('the counts the section prints are the counts it was given — nothing double-counted', () => {
  const t = triage(batch(), { now: NOW, judged: new Set(['W0007']), judgedAt: judgedThen })
  assert.equal(t.live.length + t.resolved.length + t.standing.length, 3,
    'every detection lands in exactly one of the three')
  assert.equal(t.resolved.length, 1)
  assert.equal(t.standing.length, 2)
})

test('judgedAt takes the LAST verdict, because a correction is written as a new line', () => {
  const m = judgedAt([
    JSON.stringify({ op: 'verdict', worker: 'W0009', at: '2026-08-16T21:31:39+01:00' }),
    JSON.stringify({ op: 'verdict', worker: 'W0009', at: '2026-08-16T21:34:22+01:00' }),
    '{"op": "call", "id": "n0065", "at": "2026-08-16T21:00:00+01:00"}',
    '{"op": "verdict", "worker": "W00',
    JSON.stringify({ op: 'verdict', worker: 'W0013' }),  // no timestamp: unorderable
  ].join('\n'))
  assert.equal(m.get('W0009'), Date.parse('2026-08-16T21:34:22+01:00'))
  assert.ok(!m.has('W0013'), 'a verdict with no clock cannot order anything, so it carries none')
  assert.ok(!m.has('n0065'))
})

test('a closeout is judged untimed, because the watermark LAGS the verdict that judges it', () => {
  // Learned from the machine, not reasoned out, and the fix would have shipped
  // without it: 16 of the 118 closeouts on this machine that join to a verdict carry
  // one recorded BEFORE `firstTerminalAt` — median lead 4 minutes, worst 23 hours —
  // because the Navigator judges the close-out REPORT and the harness stamps the
  // watermark when the process finally goes terminal. Timing this gate turned a live
  // pending list of 0 into one of 4 and would have grown with every worker judged
  // from then on: an already-judged closeout nagging for ever, which is the exact
  // defect obot.agent#157 is about, arriving through its own fix.
  const closed = job({ state: 'done', tempo: 'idle', firstTerminalAt: agoMin(30) })
  const judgedNineMinutesEarlier = new Map([['W0007', NOW.getTime() - 39 * 60000]])
  const t = triage([closed], { now: NOW, judged: new Set(['W0007']), judgedAt: judgedNineMinutesEarlier })
  assert.deepEqual(t.live, [], 'still resolved: a worker has ONE closeout watermark and one verdict about it')
  assert.equal(t.resolved.length, 1)
  assert.ok(!TIMED_VERDICT.has('stopped'))
})

test('and the liveness kinds ARE timed, because their onset moves and a closeout\'s does not', () => {
  for (const k of ['dead', 'waiting', 'stalled', 'wedged']) {
    assert.ok(TIMED_VERDICT.has(k), `${k} reads from updatedAt, which moves every time the session does`)
  }
})

test('the resolved line is bounded: it points at the record rather than becoming one', () => {
  // Measured live on 2026-08-21: 31 resolved stop-states. Unbounded, that is a
  // 31-name line growing by one per worker judged, sitting one line above the list
  // it was meant to shorten.
  const many = Array.from({ length: RESOLVED_NAMES + 25 }, (_, i) =>
    ({ kind: 'stopped', worker: `W0${200 + i}`, key: `stopped:j${i}` }))
  const md = wakeSection({ pending: [], resolved: many, jobsRead: true })
  const line = md.split('\n').find((l) => l.startsWith('resolved:'))
  assert.ok(line.includes('+25 more'), line)
  assert.equal(line.match(/W0\d+/g).length, RESOLVED_NAMES)
  assert.match(line, /delivery record/, 'and it says where the other 25 are')
})
