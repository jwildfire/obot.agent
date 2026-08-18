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
  DEATH, IDLE_MIN, MAX_WAKES_PER_RUN, REWAKE_MIN, STALL_MIN, TRIGGERED_QUIET_MIN,
  WAKE_WINDOW_HOURS, classify, deliverable, hostWasAway, idleDetection, isBoilerplateDetail,
  judgedWorkers, listenerState, misreadHolds, outsideWindow, parseWakeLog, pending, readJobs,
  scrubDetail, verdictKeys, wakeLine, wakeSection, workerIdOf,
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
  const d = classify(manager({ detail: 'awaiting approval', needs: 'approve Bash: obot-merge 158', updatedAt: agoMin(11) }), NOW)
  assert.deepEqual(d.map((x) => x.kind), ['waiting'])
  assert.match(d[0].line, /approve Bash/)
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

test('the whole fleet at once: the admiral is seen, the standing roles are not', () => {
  const found = pending([
    manager({ updatedAt: agoMin(612) }),
    standing('\u{1F3A9}\u{1F916}', { id: 'p1' }),
    standing('\u{1F9ED}\u{1F916}', { id: 'n1' }),
  ], { now: NOW })
  assert.deepEqual(found.map((d) => d.key), ['dead:64a7980b'])
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
// it, five minutes after the same session stamped a terminal result.
//
// So `blocked` is not a signal to be trusted and then filtered. It is the thing
// being fabricated, and the admiral closes sessions on it.
//
// The fixtures below are the two shapes that matter, transcribed from
// ~/.claude/jobs/d2dc1b30/timeline.jsonl and from the W0007 record above. They look
// alike in the state file and are opposites in the timeline, which is why the gate
// reads the timeline.

const NOWL = new Date('2026-08-17T10:30:00Z') // three hours past the 07:16 block — the admiral's bar

// d2dc1b30, verbatim: terminal at 07:11:28, blocked at 07:16:18 with a `needs`
// derived from its own prose, and then five more entries as it went on working.
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

// W0007, verbatim: closed out, and then genuinely stuck on a permission prompt with
// nothing after it for twenty hours. Same two fields set as above; the timeline is
// what tells them apart.
const stuckAfterCloseoutJob = (over = {}) => ({
  id: 'w0007job', name: '👯🤖 W0007 2026-08-16 lastlook', state: 'working', tempo: 'blocked',
  detail: '', needs: 'approve Bash: python3 …',
  updatedAt: '2026-08-17T09:00:00.000Z',
  firstTerminalAt: '2026-08-17T07:30:00.000Z',
  lastBlockedAt: '2026-08-17T09:00:00.000Z',
  movedAfterBlockedAt: null,
  ...over,
})

test('the fabricated block: a session that stamped a terminal result and then went on working is not waiting', () => {
  const d = classify(misreadJob(), NOWL)
  assert.equal(d.filter((x) => x.kind === 'waiting').length, 0,
    'this is the wake that fired on 2026-08-17T07:28:40Z, and it must not fire again')
  assert.ok(d.some((x) => x.kind === 'misread'), 'suppressed, and said out loud — a silent gate is indistinguishable from a broken one')
  const m = d.find((x) => x.kind === 'misread')
  assert.match(m.line, /07:11:28/, 'it names the terminal stamp that precedes the block')
  assert.match(m.line, /07:32:09/, 'and the activity that followed it')
})

test('the gate needs BOTH discriminators: a terminal stamp alone never suppresses', () => {
  // W0007 closed out at 08:13 and was then stuck twenty hours on a real permission
  // prompt. `firstTerminalAt` precedes its block exactly as it does above, and this
  // is the detection the whole channel was built for. Suppressing on that field
  // alone would trade obot.agent#176 for the failure that preceded it.
  const d = classify(stuckAfterCloseoutJob(), NOWL)
  assert.ok(d.some((x) => x.kind === 'waiting'), 'a session that stopped moving after its block is genuinely stuck')
  assert.equal(d.filter((x) => x.kind === 'misread').length, 0)
})

test('activity alone never suppresses either: a live session with no terminal stamp still reports', () => {
  const d = classify(misreadJob({ firstTerminalAt: null }), NOWL)
  assert.ok(d.some((x) => x.kind === 'waiting'))
  assert.equal(d.filter((x) => x.kind === 'misread').length, 0)
})

test('a misread never reaches the admiral: it is not a kind the closure path acts on', () => {
  // The admiral iterates `classify` and acts on kinds in its own ACT_MIN table.
  // `misread` is deliberately not one of them, and the assertion is here rather
  // than only in admiral.test.mjs because this is the file that emits it.
  const d = classify(misreadJob(), NOWL)
  assert.ok(!d.some((x) => ['waiting', 'stalled', 'dead'].includes(x.kind)))
})

test('a suppressed block does not suppress the wedged catch-all underneath it', () => {
  // A budgeted role has no `stopped` detection to fall back on, so if `misread`
  // counted as a detection the safety net beneath it would silently switch off.
  const d = classify(misreadJob({ name: '⚓🤖 obot-admiral', updatedAt: agoMin(0) }), NOWL)
  assert.ok(d.some((x) => x.kind === 'wedged'), 'still reported as wedged, because it must exit inside its budget')
})

test('the same gate covers a fabricated death, which the admiral acts on in an hour', () => {
  // The DEATH regex reads `detail` and `needs` — both of which are the session's own
  // prose. A worker writing an issue ABOUT an API error is the same defect one word
  // over, and `dead` has the shortest bar of the three.
  const d = classify(misreadJob({ detail: 'filed the API Error report', needs: 'API unavailable — retry' }), NOWL)
  assert.equal(d.filter((x) => x.kind === 'dead').length, 0)
  assert.ok(d.some((x) => x.kind === 'misread'))
})

test('misreads stay out of the wake list and are counted in the section', () => {
  const jobs = [misreadJob(), stuckAfterCloseoutJob()]
  const p = pending(jobs, { now: NOWL })
  assert.ok(!p.some((d) => d.kind === 'misread'), 'nobody is woken to look at a state that was never real')
  const held = misreadHolds(jobs, { now: NOWL })
  assert.equal(held.length, 1)
  const section = wakeSection({ pending: p, misread: held, jobsRead: true })
  assert.match(section, /suppressed/i, 'the count is on the page — obot.agent#129, third time')
  assert.ok(!/^\s+.*suppressed/im.test(section), 'unindented: the dashboard reads an indented line as a detail and drops its alarm')
})

test('readJobs carries the two timeline facts the gate needs', () => {
  const timeline = [
    { at: '2026-08-17T07:11:28.873Z', state: 'done', detail: 'merged' },
    { at: '2026-08-17T07:16:18.954Z', state: 'blocked', detail: 'ops-dashboard stale (pid 42255)' },
    { at: '2026-08-17T07:29:15.879Z', state: 'blocked', detail: 'boilerplate' },
    { at: '2026-08-17T07:30:41.007Z', state: 'working', detail: 'Inspecting my own job record' },
    { at: '2026-08-17T07:32:09.627Z', state: 'done', detail: 'mechanism established' },
  ].map((e) => JSON.stringify(e)).join('\n')
  const read = (p) => {
    // No `firstTerminalAt` in the state file: this is the fallback path, and the
    // `done` state is what gates it — an intermediate blocked entry must never be
    // read as a live worker's closeout.
    if (p.endsWith('state.json')) return JSON.stringify({ name: '👯🤖 W0033', state: 'done', updatedAt: '2026-08-17T07:32:09.627Z' })
    if (p.endsWith('timeline.jsonl')) return timeline
    throw new Error('no such file')
  }
  const [j] = readJobs('/jobs', { read, list: () => ['d2dc1b30'] })
  assert.equal(j.lastBlockedAt, '2026-08-17T07:29:15.879Z', 'the block the detection would be about is the LAST one, not the first')
  assert.equal(j.movedAfterBlockedAt, '2026-08-17T07:32:09.627Z')
  assert.equal(j.firstTerminalAt, '2026-08-17T07:11:28.873Z', 'and the terminal watermark still comes off the timeline when the state file lacks it')
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
  // The third of the four entries in obot.agent#177 re-asserted `blocked` forty-five
  // seconds before a clean close-out, carrying the template comment as its detail.
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

test('the line that actually fired now carries what was wrong with it', () => {
  // The 07:28:40 wake, replayed: the block is fresh, nothing has happened after it,
  // so the conjunction cannot suppress and the detection correctly stands. What
  // changes is the sentence — the terminal stamp was in the record the whole time
  // and was the one fact that would have stopped a reader believing the `needs`.
  const d = classify(misreadJob({
    updatedAt: '2026-08-17T07:16:18.954Z',
    lastBlockedAt: '2026-08-17T07:16:18.954Z',
    movedAfterBlockedAt: null,
  }), new Date('2026-08-17T07:28:40.973Z'))
  const w = d.find((x) => x.kind === 'waiting')
  assert.ok(w, 'D1 alone must not suppress — W0007 is exactly this shape and was really stuck')
  assert.match(w.line, /CHECK IT FIRST/)
  assert.match(w.line, /07:11:28/, 'the terminal stamp that precedes the block')
  assert.match(w.line, /timeline\.jsonl/, 'and where to settle it in one read')
})

test('a real permission prompt is never annotated or suppressed by a stale block', () => {
  // W0007 and W0008 wrote no `blocked` timeline entry at all — verified across all
  // 113 job records on this machine: every `needs` in a state file belongs to a job
  // with no blocked entry, and every job with a blocked entry carries no `needs`.
  // So a tempo-block has nothing to measure "after" from, and must not be refuted by
  // work that happened after some earlier, unrelated block.
  const d = classify(stuckAfterCloseoutJob({
    lastBlockedAt: '2026-08-17T07:45:00.000Z',   // an old prose-derived block
    movedAfterBlockedAt: '2026-08-17T08:00:00.000Z', // and ordinary work after it
  }), NOWL)
  assert.ok(d.some((x) => x.kind === 'waiting'), 'still the detection the channel was built for')
  assert.equal(d.filter((x) => x.kind === 'misread').length, 0)
})
