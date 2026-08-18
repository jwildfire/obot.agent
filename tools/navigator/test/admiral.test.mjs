// The admiral trigger (obot.agent#167, under jwildfire/obot.roadmap#236).
//
// The properties held here are the ones whose violation is SILENT. A trigger that
// fires on an absence spawns an admiral forever on a quiet machine and nothing
// complains; an admiral that merges a release candidate looks exactly like an admiral
// that merged something ordinary; a section whose alarm headline does not match the
// dashboard's regex renders as small grey text on the page @jwildfire reads. None of
// those announce themselves, so each one gets a test.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ACT_MIN, CLOSEOUT_GAP_MIN, UNJUDGED_NOTE, ADMIRAL_NAME, ADMIRAL_TAG, PR_IDLE_MIN,
         REPEAT_FLOOR_MIN, RELAUNCH_FLOOR_MIN, brief, closeoutGaps, admiralSection,
         holdLine, isAdmiral, killLine, launchLine, operationalRepos, overrun, parseAdmiralLog,
         priorStopAttempts, shouldLaunch, signatureOf, stalledSessions, stuckPRs,
         triggers } from '../admiral.mjs'
import { ALARM_RE } from '../../ops-dashboard/lib/navigator.mjs'

const NOW = new Date('2026-08-17T12:00:00Z')
const agoMin = (m) => new Date(NOW.getTime() - m * 60000).toISOString()

// A worker as readJobs() shapes it. `tempo` is what separates a worker waiting on a
// human from one that has gone quiet, and neither is visible in `state`.
const worker = (over = {}) => ({
  id: 'job1', name: '👯🤖 W0099 2026-08-17 thing', state: 'working', tempo: 'active',
  detail: '', needs: '', updatedAt: agoMin(1), firstTerminalAt: null, children: [], ...over,
})

const pr = (over = {}) => ({
  repo: 'jwildfire/obot.agent', integration: 'main', number: 1, title: 'a change',
  url: 'https://github.com/jwildfire/obot.agent/pull/1', baseRefName: 'main',
  isDraft: false, reviewRequests: [], reviewDecision: '', updatedAt: agoMin(500), ...over,
})

const POLICY = {
  repos: {
    'jwildfire/obot.agent': { profile: 'auto', class: 'operational', branches: { integration: 'main', release: ['stable'] } },
    'jwildfire/obot.roadmap': { profile: 'auto', class: 'operational', branches: { integration: 'main', release: [] } },
    'jwildfire/gsm.safety': { profile: 'auto', class: 'clinical', branches: { integration: 'dev', release: ['main'] } },
    'jwildfire/safety.viz': { profile: 'auto', class: 'clinical', branches: { integration: 'dev', release: ['main'] } },
    'jwildfire/locked': { profile: 'protected', class: 'operational', branches: { integration: 'main', release: [] } },
  },
}

// ---- THE rule: a positive condition, never an absence -----------------------

test('THE rule — an empty fleet never fires. A quiet system must not spawn an admiral forever', () => {
  const t = triggers({ jobs: [], prs: [], policy: POLICY, now: NOW })
  assert.equal(t.fired, false)
  assert.equal(t.conditions.length, 0)
  const d = shouldLaunch({ trigger: t, jobs: [], log: [], now: NOW })
  assert.equal(d.launch, false)
  assert.match(d.why, /quiet fleet is not a trigger/)
})

test('a fleet of healthy working sessions and no pull requests never fires', () => {
  const jobs = [worker({ id: 'a' }), worker({ id: 'b', updatedAt: agoMin(0) })]
  assert.equal(triggers({ jobs, prs: [], policy: POLICY, now: NOW }).fired, false)
})

test('a fleet of already-judged closeouts never fires', () => {
  const jobs = [worker({ id: 'a', state: 'done', firstTerminalAt: agoMin(600) })]
  const judged = new Set(['W0099'])
  assert.equal(triggers({ jobs, prs: [], policy: POLICY, judged, now: NOW }).fired, false)
})

// ---- condition 1: sessions past the bar --------------------------------------

test('a worker waiting under the bar is not acted on; over it, it is', () => {
  const under = worker({ state: 'blocked', tempo: 'blocked', needs: 'rule on X', updatedAt: agoMin(ACT_MIN.waiting - 5) })
  assert.equal(stalledSessions([under], { now: NOW }).length, 0)
  const over = worker({ state: 'blocked', tempo: 'blocked', needs: 'rule on X', updatedAt: agoMin(ACT_MIN.waiting + 5) })
  const found = stalledSessions([over], { now: NOW })
  assert.equal(found.length, 1)
  assert.equal(found[0].kind, 'waiting')
  assert.match(found[0].line, /has been waiting \d+m, past the 180m bar/)
  assert.match(found[0].line, /rule on X/)
})

test('a dead worker is acted on sooner than a waiting one — it is not coming back', () => {
  const dead = worker({ state: 'blocked', detail: "API Error: Can't reach the API", updatedAt: agoMin(ACT_MIN.dead + 5) })
  const found = stalledSessions([dead], { now: NOW })
  assert.equal(found.length, 1)
  assert.equal(found[0].kind, 'dead')
  assert.ok(ACT_MIN.dead < ACT_MIN.waiting)
})

test('a closeout is NOT a stalled session — nothing is stuck, the work finished', () => {
  const done = worker({ state: 'done', firstTerminalAt: agoMin(600), updatedAt: agoMin(600) })
  assert.equal(stalledSessions([done], { now: NOW }).length, 0)
})

test('the host guard: a lid shut for hours is not a stalled fleet', () => {
  // 2026-08-16, a travelling laptop: every worker on it read as stalled on the next
  // reading. An admiral launched on that would have closed a fleet that was asleep.
  const over = worker({ state: 'blocked', tempo: 'blocked', needs: 'x', updatedAt: agoMin(900) })
  assert.equal(stalledSessions([over], { now: NOW, hostWasAway: true }).length, 0)
  assert.equal(stalledSessions([over], { now: NOW, hostWasAway: false }).length, 1)
})

test('the admiral never detects itself, or its predecessor', () => {
  const self = { ...worker({ state: 'blocked', tempo: 'blocked', needs: 'x', updatedAt: agoMin(900) }), name: ADMIRAL_NAME }
  assert.equal(stalledSessions([self], { now: NOW }).length, 0)
  assert.equal(isAdmiral(self), true)
  assert.equal(isAdmiral(worker()), false)
})

// ---- condition 2: operational pull requests ----------------------------------

test('only operational repos on the auto profile are landable — clinical never appears', () => {
  const repos = operationalRepos(POLICY).map((r) => r.repo)
  assert.deepEqual(repos, ['jwildfire/obot.agent', 'jwildfire/obot.roadmap'])
  for (const clinical of ['jwildfire/gsm.safety', 'jwildfire/safety.viz']) {
    assert.ok(!repos.includes(clinical), `${clinical} is clinical and must never be landable`)
  }
  assert.ok(!repos.includes('jwildfire/locked'), 'a protected repo is not on the standard lane')
})

test('an idle operational PR is a candidate; a fresh one is not', () => {
  assert.equal(stuckPRs([pr({ updatedAt: agoMin(PR_IDLE_MIN - 5) })], { now: NOW }).length, 0)
  const found = stuckPRs([pr()], { now: NOW })
  assert.equal(found.length, 1)
  assert.match(found[0].line, /obot\.agent#1 has not moved in \d+m on main/)
})

test('every release-candidate shape is excluded — the admiral may never merge one', () => {
  const cases = [
    ['a draft', pr({ isDraft: true })],
    ['a release-role base', pr({ baseRefName: 'stable' })],
    ['a review decision already recorded', pr({ reviewDecision: 'APPROVED' })],
    ['changes requested', pr({ reviewDecision: 'CHANGES_REQUESTED' })],
    ['a review requested from him', pr({ reviewRequests: [{ login: 'jwildfire' }] })],
  ]
  for (const [why, p] of cases) {
    assert.equal(stuckPRs([p], { now: NOW }).length, 0, `${why} must not be a candidate`)
  }
})

// ---- condition 3: closeout gaps ----------------------------------------------

test('a closeout gap needs the Navigator to have had a fair chance first', () => {
  // Verdict latency here: median 11m, p90 57m, then a break to 376m and 738m — the
  // two named failures. Firing at zero would launch an admiral after every closeout.
  const fresh = worker({ state: 'done', firstTerminalAt: agoMin(CLOSEOUT_GAP_MIN - 10) })
  assert.equal(closeoutGaps([fresh], { now: NOW }).length, 0)
  const stale = worker({ state: 'done', firstTerminalAt: agoMin(CLOSEOUT_GAP_MIN + 10) })
  assert.equal(closeoutGaps([stale], { now: NOW }).length, 1)
})

test('a closeout gap is bounded above too — history nobody can judge is not a trigger', () => {
  const ancient = worker({ state: 'done', firstTerminalAt: agoMin(48 * 60) })
  assert.equal(closeoutGaps([ancient], { now: NOW }).length, 0)
})

test('a session that resumed after its closeout is not a gap — it is working', () => {
  // obot.agent#176, one condition over. `firstTerminalAt` is a first-write-wins
  // watermark the harness never resets, so a session that closed out and was then
  // resumed carries it forever — and this scan had no liveness filter while the two
  // other job scans in this file both have one. The row it produced asserts "W0099
  // closed out 600m ago" in front of an agent holding `claude stop`, about a session
  // that is mid-release. Five real records on this machine spent between 129 and 575
  // minutes in exactly that state; 978bca0c was publishing a tag on `stable` through
  // most of its 575.
  const resumed = worker({
    state: 'working', firstTerminalAt: agoMin(600), updatedAt: agoMin(2),
    lastActivityAt: agoMin(2),
  })
  assert.equal(closeoutGaps([resumed], { now: NOW }).length, 0)

  // Positive evidence only. A live session with NOTHING after its terminal stamp is
  // still a gap: the safe direction here is to report, because a gap is only ever
  // reported and an unreported one is a closeout nobody judges.
  const quiet = worker({ state: 'working', firstTerminalAt: agoMin(600), lastActivityAt: agoMin(605) })
  assert.equal(closeoutGaps([quiet], { now: NOW }).length, 1)

  // And a properly closed-out worker is untouched, which is the whole population
  // this condition exists for.
  const closed = worker({ state: 'done', firstTerminalAt: agoMin(600), lastActivityAt: agoMin(600) })
  assert.equal(closeoutGaps([closed], { now: NOW }).length, 1)
})

test('a gap carries NO verdict field — there is nothing here for an admiral to fill in', () => {
  const stale = worker({ state: 'done', firstTerminalAt: agoMin(600) })
  const [gap] = closeoutGaps([stale], { now: NOW })
  assert.ok(!('verdict' in gap), 'judging delivery stays the Navigator\'s')
  assert.match(gap.line, /reported to the Navigator, not judged here/)
})

// ---- the launch decision -----------------------------------------------------

const firedTrigger = () => triggers({
  jobs: [worker({ state: 'blocked', tempo: 'blocked', needs: 'x', updatedAt: agoMin(600) })],
  prs: [pr()], policy: POLICY, now: NOW,
})

test('a real condition launches, and says how many of each', () => {
  const t = firedTrigger()
  assert.equal(t.fired, true)
  const d = shouldLaunch({ trigger: t, jobs: [], log: [], now: NOW })
  assert.equal(d.launch, true)
  assert.match(d.why, /1 session\(s\) past the bar, 1 idle operational PR\(s\)/)
})

test('singleton: a live admiral blocks a second one and names the job holding it', () => {
  const live = [{ ...worker(), id: 'mgr1', name: ADMIRAL_NAME, state: 'working' }]
  const d = shouldLaunch({ trigger: firedTrigger(), jobs: live, log: [], now: NOW })
  assert.equal(d.launch, false)
  assert.match(d.why, /already running \(job mgr1/)
})

test('singleton: a finished admiral does not block a new one — in ANY terminal state', () => {
  // The bug the first real launch caught. `stopped` is a terminal state the harness
  // uses constantly, and testing only for `done` held the singleton permanently: one
  // admiral stops, and no admiral ever launches again while the launcher goes on
  // reporting "held — an admiral is already running". A failure that looks exactly
  // like the guard working is the worst shape available.
  for (const state of ['done', 'stopped', 'failed']) {
    const dead = [{ ...worker(), id: 'mgr0', name: ADMIRAL_NAME, state }]
    assert.equal(shouldLaunch({ trigger: firedTrigger(), jobs: dead, log: [], now: NOW }).launch, true,
      `an admiral in state '${state}' must not hold the singleton`)
  }
})

test('overrun ignores an admiral in any terminal state, not just done', () => {
  for (const state of ['done', 'stopped', 'failed']) {
    const jobs = [{ ...worker(), id: 'm', name: ADMIRAL_NAME, state, createdAt: agoMin(900) }]
    assert.equal(overrun(jobs, { now: NOW }).length, 0, `state '${state}' is finished, not overrunning`)
  }
})

test('the relaunch floor holds a second launch inside the hour', () => {
  const log = [{ at: agoMin(RELAUNCH_FLOOR_MIN - 10), op: 'LAUNCH', signature: 'other', line: 'x' }]
  const d = shouldLaunch({ trigger: firedTrigger(), jobs: [], log, now: NOW })
  assert.equal(d.launch, false)
  assert.match(d.why, /floor is 60m/)
})

test('the repeat floor: identical conditions cannot spin up an admiral every hour', () => {
  // The termination argument. A pull request that will never pass the bar is a
  // permanent condition, and without this it would launch an admiral hourly forever.
  const t = firedTrigger()
  const log = [{ at: agoMin(RELAUNCH_FLOOR_MIN + 10), op: 'LAUNCH', signature: t.signature, line: 'x' }]
  const d = shouldLaunch({ trigger: t, jobs: [], log, now: NOW })
  assert.equal(d.launch, false)
  assert.match(d.why, /identical conditions/)
  assert.ok(REPEAT_FLOOR_MIN > RELAUNCH_FLOOR_MIN)
})

test('the repeat floor lets a CHANGED fleet through after the ordinary floor', () => {
  const log = [{ at: agoMin(RELAUNCH_FLOOR_MIN + 10), op: 'LAUNCH', signature: 'something-else', line: 'x' }]
  assert.equal(shouldLaunch({ trigger: firedTrigger(), jobs: [], log, now: NOW }).launch, true)
})

test('a HOLD entry never satisfies the floor — only a real launch does', () => {
  const log = [{ at: agoMin(5), op: 'HOLD', signature: 'x', line: 'held' }]
  assert.equal(shouldLaunch({ trigger: firedTrigger(), jobs: [], log, now: NOW }).launch, true)
})

test('host away suppresses the launch even if something looks fired', () => {
  const d = shouldLaunch({ trigger: firedTrigger(), jobs: [], log: [], now: NOW, hostWasAway: true })
  assert.equal(d.launch, false)
  assert.match(d.why, /host was away/)
})

test('the signature is stable under ordering — the same fleet is never "new"', () => {
  const a = signatureOf([{ type: 'pr', repo: 'r', number: 2 }, { type: 'session', job: 'j', kind: 'waiting' }])
  const b = signatureOf([{ type: 'session', job: 'j', kind: 'waiting' }, { type: 'pr', repo: 'r', number: 2 }])
  assert.equal(a, b)
})

test('the log round-trips: the signature is a field, never re-derived from prose', () => {
  const line = launchLine('2026-08-17T12:00:00Z', 'pr:x#1', 'because — with an em dash')
  const [e] = parseAdmiralLog(line)
  assert.equal(e.op, 'LAUNCH')
  assert.equal(e.signature, 'pr:x#1')
  const [h] = parseAdmiralLog(holdLine('2026-08-17T12:00:00Z', '', 'nothing'))
  assert.equal(h.op, 'HOLD')
  assert.equal(h.signature, '')
})

// ---- the lifetime bound ------------------------------------------------------

test('overrun is measured on the wall clock, not on the state the session reports', () => {
  // An admiral stuck on a prompt reads `blocked`; one wedged mid-turn reads
  // `working`. Both are overruns, and the session's own account cannot be trusted.
  const jobs = [{ ...worker(), id: 'm', name: ADMIRAL_NAME, state: 'working', createdAt: agoMin(45) }]
  const [o] = overrun(jobs, { now: NOW })
  assert.equal(o.job, 'm')
  assert.equal(o.hard, false)
  const [hard] = overrun(jobs, { now: NOW, hardMin: 30 })
  assert.equal(hard.hard, true)
})

test('an admiral inside its budget is not an overrun, and a finished one never is', () => {
  assert.equal(overrun([{ ...worker(), name: ADMIRAL_NAME, createdAt: agoMin(5) }], { now: NOW }).length, 0)
  assert.equal(overrun([{ ...worker(), name: ADMIRAL_NAME, state: 'done', createdAt: agoMin(900) }], { now: NOW }).length, 0)
})

// ---- what reaches his page ---------------------------------------------------

// The dashboard's alarm styling. A headline that does not match it renders as
// ordinary grey text — obot.agent#129. Imported rather than copied since
// obot.agent#223: a copy goes on passing while the real regex moves underneath it,
// which is a headline asserted green and rendered grey.

test('a breached admiral budget reaches the page as an ALARM, not as grey text', () => {
  const jobs = [{ ...worker(), id: 'm', name: ADMIRAL_NAME, createdAt: agoMin(900) }]
  const s = admiralSection({ trigger: triggers({ policy: POLICY, now: NOW }), overruns: overrun(jobs, { now: NOW }) })
  assert.match(s, ALARM_RE)
})

test('a broken trigger says so, and never reads as a quiet fleet', () => {
  const s = admiralSection({ error: 'policy.json unreadable' })
  assert.match(s, ALARM_RE)
  assert.match(s, /this is not a quiet fleet/)
  assert.doesNotMatch(s, /nothing to act on/)
})

test('a clean run still reports — a detector that only speaks up on failure reads as dead', () => {
  const s = admiralSection({ trigger: triggers({ policy: POLICY, now: NOW }) })
  assert.match(s, /nothing to act on/)
  assert.doesNotMatch(s, ALARM_RE)
})

test('the verdict line is unindented — the dashboard reads an indented line as detail', () => {
  const s = admiralSection({ trigger: firedTrigger(), decision: { why: 'x' } })
  const verdict = s.split('\n').find((l) => l.startsWith('admiral:'))
  assert.ok(verdict, 'the verdict must be a top-level line')
  assert.doesNotMatch(verdict, /^\s/)
})

test('a held launch says WHY it held — a launcher that silently declines looks broken', () => {
  const s = admiralSection({ trigger: firedTrigger(), decision: { why: 'an admiral is already running (job mgr1, working)' } })
  assert.match(s, /held: an admiral is already running/)
})

// ---- the brief ---------------------------------------------------------------

test('the brief carries conditions and clocks — and no summary of any session', () => {
  // Rule 1: a summary is built from GitHub, never from the session's own record. A
  // brief arriving pre-summarised from local job state would be exactly that
  // mistake, wearing the launcher's authority.
  const b = brief({ trigger: firedTrigger(), now: NOW })
  const flat = JSON.stringify(b)
  assert.ok(!/"summary"/.test(flat), 'the brief must not carry a summary')
  assert.ok(!/"verdict"/.test(flat), 'the brief must not carry a verdict')
  assert.equal(b.ttlMin > 0, true)
  assert.ok(Date.parse(b.deadline) > NOW.getTime(), 'the brief must carry a deadline')
  assert.deepEqual(b.operationalRepos, ['jwildfire/obot.agent', 'jwildfire/obot.roadmap'])
  assert.equal(b.thresholds.prIdleMin, PR_IDLE_MIN)
})

test('the admiral tag is not a worker tag', () => {
  // Or the wake would nag the Navigator about the admiral, and a later admiral would
  // find its predecessor stalled and close it.
  assert.equal(ADMIRAL_TAG, '\u{2693}\u{1F916}')
  assert.ok(!ADMIRAL_NAME.startsWith('\u{1F46F}\u{1F916}'))
  assert.ok(!ADMIRAL_NAME.startsWith('\u{1F9BE}\u{1F916}'))
})

// ---- an unreadable journal is not an empty one ------------------------------
//
// This section exists because of a real launch, not a thought experiment. A
// sandboxed integration run pointed OBOT_WORKSPACE at a fresh directory while
// keeping the real job ledger, read no delivery journal, and launched a real
// admiral holding twelve phantom gaps for workers the Navigator had judged hours
// earlier. Nothing was written — a gap is only ever reported — but the identical
// failure on a condition that ACTS is an admiral closing a fleet on a missing file.

test('an unreadable journal SUPPRESSES the closeout-gap condition rather than firing on all of it', () => {
  const closed = [
    worker({ id: 'a', name: '👯🤖 W0003 x', state: 'done', firstTerminalAt: agoMin(600) }),
    worker({ id: 'b', name: '👯🤖 W0004 x', state: 'done', firstTerminalAt: agoMin(700) }),
  ]
  // Journal read, genuinely nothing judged: these ARE gaps.
  assert.equal(closeoutGaps(closed, { now: NOW, judged: new Set(), judgedReadable: true }).length, 2)
  // Journal not readable: the same empty set must mean "no reading", not "no verdicts".
  assert.equal(closeoutGaps(closed, { now: NOW, judged: new Set(), judgedReadable: false }).length, 0)
})

test('the whole trigger goes quiet on an unreadable journal, and says so out loud', () => {
  const closed = [worker({ state: 'done', firstTerminalAt: agoMin(600) })]
  const t = triggers({ jobs: closed, prs: [], policy: POLICY, judgedReadable: false, now: NOW })
  assert.equal(t.fired, false, 'a missing file must not launch an admiral')
  const s = admiralSection({ trigger: t })
  assert.match(s, /closeout-gap detection SUPPRESSED/)
  assert.equal(UNJUDGED_NOTE.includes('not an empty one'), true)
})

test('a suppressed detector still says so when OTHER conditions fired', () => {
  // Otherwise the run reads as a complete picture of the fleet when one third of it
  // was never looked at.
  const jobs = [
    worker({ id: 'w', state: 'blocked', tempo: 'blocked', needs: 'x', updatedAt: agoMin(600) }),
    worker({ id: 'c', state: 'done', firstTerminalAt: agoMin(600) }),
  ]
  const t = triggers({ jobs, prs: [], policy: POLICY, judgedReadable: false, now: NOW })
  assert.equal(t.fired, true)
  assert.equal(t.gaps.length, 0)
  assert.match(admiralSection({ trigger: t, decision: { why: 'x' } }), /SUPPRESSED/)
})

// ---- what the page says about a stop (jwildfire/obot.roadmap#251) -------------

const OVERRUN_LINE = 'admiral job m has run 90m against a 30m budget (state working)'
const overrunWith = (kill) => [{ job: 'm', state: 'working', mins: 90, hard: true, kill, line: OVERRUN_LINE }]

test('a CONFIRMED stop reaches the page as its own ALARM, not as a quiet exit', () => {
  // A ceiling that fires silently is indistinguishable from an admiral that exited
  // cleanly, which would make the enforcement invisible exactly when it acted.
  const kill = { confirmed: true, code: 'confirmed', alarm: null,
                 detail: 'pid 123 exited on SIGTERM and session m is no longer in the agent ledger' }
  const s = admiralSection({ trigger: triggers({ policy: POLICY, now: NOW }), overruns: overrunWith(kill) })
  assert.match(s, ALARM_RE)
  assert.match(s, /ADMIRAL KILLED ON A BREACHED BUDGET/)
  assert.match(s, /pid 123 exited on SIGTERM/)
})

test('an UNCONFIRMED stop is a finding on the page, and never reads as a kill', () => {
  // The defect, at the surface it reached: two **ADMIRAL KILLED ON A BREACHED
  // BUDGET** headlines on his dashboard for sessions that went on running for four
  // more hours. The headline a reader trusts is the one that must not be able to
  // overstate what happened.
  const kill = { confirmed: false, code: 'respawned', alarm: '**STOP UNCONFIRMED FINDING**',
                 detail: 'pid 123 exited on SIGTERM and session m is live again on pid 456 — the daemon re-hosted it' }
  const s = admiralSection({ trigger: triggers({ policy: POLICY, now: NOW }), overruns: overrunWith(kill) })
  assert.match(s, ALARM_RE, 'an unconfirmed stop is a finding and reaches the page as one')
  assert.match(s, /ADMIRAL STOP UNCONFIRMED FINDING/)
  assert.doesNotMatch(s, /ADMIRAL KILLED/, 'the success headline belongs to confirmed stops alone')
  assert.doesNotMatch(s, /killed/i)
  assert.match(s, /live again on pid 456/, 'and it says what was actually observed')
})

test('a stop that found no pid says so, without the word killed', () => {
  const kill = { confirmed: false, code: 'not-found', alarm: '**PID RESOLUTION FAILED**',
                 detail: 'no session in the agent ledger carries the id m, so nothing was signalled' }
  const s = admiralSection({ trigger: triggers({ policy: POLICY, now: NOW }), overruns: overrunWith(kill) })
  assert.match(s, /ADMIRAL PID RESOLUTION FAILED/)
  assert.match(s, ALARM_RE)
  assert.doesNotMatch(s, /kill/i)
})

// ---- the record (jwildfire/obot.roadmap#251) ---------------------------------

test('the log records a stop under its own op, and an unconfirmed one under a different word', () => {
  // The kill used to be written as `HOLD - — killed overrunning admiral …`, which
  // put it in the launch-decision vocabulary and made every kill unreadable as a
  // kill. Its own op means the record can be read back — which is what lets the next
  // run know this session has been signalled before.
  const at = '2026-08-18T01:27:31.373Z'
  const yes = killLine(at, '1cc6cc32', { confirmed: true, detail: 'pid 67793 exited on SIGTERM' })
  const no = killLine(at, '1cc6cc32', { confirmed: false, detail: 'no pid was resolved and nothing was signalled' })
  assert.match(yes, /^2026-08-18T01:27:31.373Z KILL 1cc6cc32 — /)
  assert.match(no, /^2026-08-18T01:27:31.373Z KILL-UNCONFIRMED 1cc6cc32 — /)
  assert.doesNotMatch(no, /killed/i)

  const log = parseAdmiralLog([yes, no].join('\n'))
  assert.equal(log.length, 2)
  assert.deepEqual(log.map((e) => e.op), ['KILL', 'KILL-UNCONFIRMED'])
})

test('a session signalled before is COUNTED, because the repetition is the evidence', () => {
  // Session 1cc6cc32 was recorded as killed five times in twenty-one minutes. A
  // successful stop is not repeatable, so the second attempt already knew the first
  // had failed — nothing was reading the record back.
  const log = parseAdmiralLog([
    killLine('2026-08-18T01:27:31.373Z', '1cc6cc32', { confirmed: false, detail: 'a' }),
    killLine('2026-08-18T01:33:03.838Z', '1cc6cc32', { confirmed: false, detail: 'b' }),
    killLine('2026-08-18T01:38:13.997Z', '7233bc9c', { confirmed: false, detail: 'c' }),
    holdLine('2026-08-18T01:40:00.000Z', 'sig', 'unrelated'),
  ].join('\n'))
  assert.equal(priorStopAttempts(log, '1cc6cc32'), 2)
  assert.equal(priorStopAttempts(log, '7233bc9c'), 1)
  assert.equal(priorStopAttempts(log, 'never-seen'), 0)
})

test('a KILL line is not a launch decision, so it can never arm the relaunch floor', () => {
  // The old wording wrote kills as HOLD lines. HOLD is read back by shouldLaunch's
  // floors; a kill is not a decision about launching and must not sit in that
  // vocabulary at all.
  const log = parseAdmiralLog(killLine('2026-08-18T01:27:31.373Z', 'm', { confirmed: true, detail: 'x' }))
  assert.equal(log.filter((e) => e.op === 'LAUNCH' || e.op === 'HOLD').length, 0)
})
