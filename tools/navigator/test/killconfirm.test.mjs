// A kill this house reports is a kill it confirmed (jwildfire/obot.roadmap#251,
// obot.agent#223).
//
// WHAT WAS WRONG, and it is worth stating because the fix reads as pedantic without
// it. `.claude/session-hub/admiral.log` recorded session 1cc6cc32 as killed five
// times in twenty-one minutes, at three different pids, and two of those lines read
// `killed overrunning admiral 1cc6cc32: no pid found — reported only` — the success
// wording emitted on the branch that admits nothing happened. Four admirals ran 263
// to 279 minutes against a thirty-minute budget while the log called them killed.
//
// AND WHY THE THREE PIDS ARE NOT A LOOKUP BUG. The pid `claude agents --json`
// reports for a background session is a `claude bg-spare` claimed from a warm pool
// that `claude daemon run` owns — on the machine this was measured on, the process
// under one session's row had started fifty-six minutes BEFORE the session did. The
// job record carries `respawnFlags` and `resumeSessionId`; when a host dies the
// daemon claims another spare and resumes the session onto it. So SIGTERM to that
// pid stops a pooled host, the session comes back on a fresh pid, and the next sweep
// signals that one.
//
// The consequence every case below is built on: A DEAD PID CANNOT PROVE A STOPPED
// SESSION. Confirming the process is gone is necessary and not sufficient, and a fix
// that only re-checked liveness after SIGTERM would have gone on reporting confirmed
// kills for sessions that were still running.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ALARM_RE } from '../../ops-dashboard/lib/navigator.mjs'
import { alive, confirmedStop, KILL_CODES, prefixedAlarm } from '../../lib/killconfirm.mjs'

// ---- fixtures ---------------------------------------------------------------

const ID = 'aaaaaaaa'
const SESSION = `${ID}-1111-2222-3333-444444444444`

/** A ledger row in the shape `claude agents --json` returns. */
const row = (pid, { id = SESSION, name = '⚓🤖 obot-admiral' } = {}) => ({ pid, sessionId: id, name })

/** Every process this suite starts, so a case that fails still cleans up after itself. */
const started = []

/**
 * A real process that ignores SIGTERM, orphaned so nothing here has to reap it.
 *
 * Started through `sh -c '… & echo $!'` rather than `child_process.spawn`, and that
 * detail is load-bearing: the module's wait is a BLOCKING sleep, so a child of this
 * test process could never be reaped while the wait runs, and a zombie answers
 * `kill(pid, 0)` exactly like a live process. The case would then pass for the wrong
 * reason — it would prove the wait times out, not that the process survived.
 */
function ignoresSigterm() {
  // The readiness file, and it is not ceremony. `echo $!` returns a pid the instant
  // the shell forks, which is BEFORE node has run a line — so a SIGTERM sent on the
  // strength of `kill(pid, 0)` alone can land in the window before the handler is
  // installed, and the fixture dies of the signal it exists to ignore. That race made
  // this case pass as `ledger-lag` on the first run of the real implementation: a
  // fixture that quietly is not the fixture, which would have proved nothing.
  const ready = join(mkdtempSync(join(tmpdir(), 'killconfirm-')), 'ready')
  const script = `process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(ready)}, '1'); setInterval(() => {}, 1e9)`
  const r = spawnSync('sh', ['-c', `${process.execPath} -e ${JSON.stringify(script)} >/dev/null 2>&1 & echo $!`],
    { encoding: 'utf8' })
  const pid = Number(String(r.stdout).trim())
  assert.ok(Number.isInteger(pid) && pid > 0, `no pid from the fixture: ${r.stderr}`)
  started.push(pid)
  for (let i = 0; i < 100 && !existsSync(ready); i++) spawnSync('sh', ['-c', 'sleep 0.05'])
  assert.equal(existsSync(ready), true, 'the fixture never reported itself ready to ignore SIGTERM')
  assert.equal(alive(pid), true, 'the fixture process did not start')
  return pid
}

test.after(() => {
  for (const pid of started) { try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ } }
})

// The claimed host, as the launcher would see it. Injected rather than probed,
// because these cases are about what happens AFTER identity is established; the
// identity check has its own cases below.
const asClaudeHost = () => 'claude bg-spare --bg-spare /tmp/cc-daemon-501/x/y.claim.sock'

// Short windows throughout: the point of each case is the branch, not the clock.
const FAST = { termWaitMs: 600, hardWaitMs: 600, settleMs: 50, pollMs: 25 }

// ---- the two cases the requirement names ------------------------------------

test('a process that ignores SIGTERM reports a FINDING, never success', () => {
  // The named case. The process really ignores SIGTERM; the signal function forwards
  // SIGTERM and swallows SIGKILL, which is the only way to hold a process that
  // cannot be stopped — no process survives a real SIGKILL, and a case that let the
  // escalation through would be testing the escalation rather than this branch. The
  // escalation gets its own case immediately below, against the same fixture, for
  // real.
  const pid = ignoresSigterm()
  const sent = []
  const out = confirmedStop(ID, {
    ...FAST,
    agents: () => [row(pid)],
    command: asClaudeHost,
    signal: (p, sig) => { sent.push(sig); if (sig === 'SIGTERM') process.kill(p, sig) },
  })

  assert.equal(out.confirmed, false, 'the process is still running, so nothing was stopped')
  assert.equal(out.code, 'survived')
  assert.deepEqual(sent, ['SIGTERM', 'SIGKILL'], 'it escalated rather than giving up after SIGTERM')
  assert.doesNotMatch(out.detail, /killed/i, 'an unconfirmed stop may not borrow the word')
  assert.ok(out.alarm, 'an unconfirmed stop is a finding, and a finding has a headline')
  assert.match(out.alarm, ALARM_RE, 'and the headline reaches the page rather than rendering grey')
  // The effect, not the exit code: the thing this reported on is still there.
  assert.equal(alive(pid), true)
})

test('and the escalation is real — the same fixture dies of SIGKILL and is CONFIRMED gone', () => {
  // The other half, so "reports a finding" cannot be satisfied by a path that simply
  // never works. Nothing is stubbed here except the ledger: the signals are real, the
  // process is real, and the confirmation is read off the process table afterwards.
  const pid = ignoresSigterm()
  let calls = 0
  const out = confirmedStop(ID, {
    ...FAST,
    // Gone from the ledger once it has actually been signalled — the daemon's view
    // after a host it owns exits.
    agents: () => (calls++ === 0 ? [row(pid)] : []),
    command: asClaudeHost,
  })

  assert.equal(out.confirmed, true, out.detail)
  assert.equal(out.code, 'confirmed')
  assert.match(out.detail, /SIGKILL/, 'it says how it had to be stopped')
  assert.equal(out.alarm, null, 'a confirmed stop is not a finding')
  assert.equal(alive(pid), false, 'and the process really is gone')
})

test('the no-pid path never uses the word killed', () => {
  // The second named case. The ledger holds a session under a different id, so the
  // join finds nothing — the branch that produced
  // `killed overrunning admiral 7233bc9c: no pid found — reported only` six times.
  let signalled = false
  const out = confirmedStop(ID, {
    ...FAST,
    agents: () => [row(4242, { id: '99999999-0000-0000-0000-000000000000' })],
    command: asClaudeHost,
    signal: () => { signalled = true },
  })

  assert.equal(out.confirmed, false)
  assert.equal(out.code, 'not-found')
  assert.equal(signalled, false, 'nothing was signalled')
  assert.doesNotMatch(out.detail, /kill/i, 'it is a detection failure and says so')
  assert.match(out.detail, /nothing was signalled/)
  assert.match(out.alarm, ALARM_RE)
})

// ---- the respawn: the shape that made one session killable five times --------

test('a session that comes back on a new pid is UNCONFIRMED, not a kill', () => {
  // The measured behaviour, as a case. The host dies; the daemon claims another
  // spare and resumes the session onto it. Process-level confirmation alone would
  // call this a success — it is the exact reading that logged five kills of a
  // session that ran for four and a half hours.
  const dead = 4242
  const fresh = process.pid // any pid that is definitely alive
  let stopped = false
  let calls = 0
  const out = confirmedStop(ID, {
    ...FAST,
    agents: () => (calls++ === 0 ? [row(dead)] : [row(fresh)]),
    command: asClaudeHost,
    isAlive: (p) => (p === dead ? !stopped : true),
    signal: () => { stopped = true },
  })

  assert.equal(out.confirmed, false)
  assert.equal(out.code, 'respawned')
  assert.match(out.detail, new RegExp(String(fresh)), 'it names the pid it came back on')
  assert.doesNotMatch(out.detail, /killed/i)
  assert.match(out.alarm, ALARM_RE)
})

test('a session still listed on the pid that was signalled is UNCONFIRMED', () => {
  // The ledger has not caught up, so whether the session was stopped or re-hosted
  // cannot be established. Unknown is not success.
  const pid = 4242
  let stopped = false
  const out = confirmedStop(ID, {
    ...FAST,
    agents: () => [row(pid)],
    command: asClaudeHost,
    isAlive: () => !stopped,
    signal: () => { stopped = true },
  })
  assert.equal(out.confirmed, false)
  assert.equal(out.code, 'ledger-lag')
  assert.doesNotMatch(out.detail, /killed/i)
})

// ---- identity: a pid that is not the session is not signalled ---------------

test('a recycled pid is treated as NOT FOUND rather than signalled', () => {
  // Clause 4 of the requirement. The ledger names a pid; the process answering to it
  // is something else entirely. Signalling it would terminate an unrelated program
  // and report a kill of a session that was never touched.
  let signalled = false
  const out = confirmedStop(ID, {
    ...FAST,
    agents: () => [row(4242)],
    isAlive: () => true,
    command: () => '/usr/sbin/cupsd',
    signal: () => { signalled = true },
  })

  assert.equal(signalled, false, 'nothing was signalled')
  assert.equal(out.confirmed, false)
  assert.equal(out.code, 'identity-mismatch')
  assert.match(out.detail, /cupsd/, 'and it says what actually answered')
  assert.doesNotMatch(out.detail, /killed/i)
})

test('a pid the process table does not know is a STALE record, and nothing is signalled', () => {
  let signalled = false
  const out = confirmedStop(ID, {
    ...FAST,
    agents: () => [row(4242)],
    isAlive: () => false,
    command: () => null,
    signal: () => { signalled = true },
  })
  assert.equal(signalled, false)
  assert.equal(out.confirmed, false)
  assert.equal(out.code, 'stale-pid')
  assert.doesNotMatch(out.detail, /killed/i)
})

test('an unreadable ledger is a broken reading, never an absent session', () => {
  const out = confirmedStop(ID, { ...FAST, agents: () => null, signal: () => {} })
  assert.equal(out.confirmed, false)
  assert.equal(out.code, 'ledger-unreadable')
  assert.doesNotMatch(out.detail, /killed/i)
  assert.match(out.alarm, ALARM_RE)
})

test('a signal that cannot be delivered is reported, not swallowed', () => {
  const out = confirmedStop(ID, {
    ...FAST,
    agents: () => [row(4242)],
    isAlive: () => true,
    command: asClaudeHost,
    signal: () => { const e = new Error('operation not permitted'); e.code = 'EPERM'; throw e },
  })
  assert.equal(out.confirmed, false)
  assert.equal(out.code, 'signal-failed')
  assert.match(out.detail, /EPERM/)
  assert.doesNotMatch(out.detail, /killed/i)
})

// ---- the invariants, held across every outcome ------------------------------

test('no unconfirmed outcome anywhere in the vocabulary may say killed', () => {
  // The wording rule as a property rather than a spot check, so a code added later
  // inherits it. This is the defect itself: the success wording was emitted on a
  // branch that admitted nothing happened.
  for (const [code, spec] of Object.entries(KILL_CODES)) {
    if (code === 'confirmed') continue
    assert.equal(spec.confirmed, false, `${code} must not be a confirmed outcome`)
    assert.doesNotMatch(spec.alarm ?? '', /^$/, `${code} is a finding and needs a headline`)
    assert.match(spec.alarm, ALARM_RE, `${code}'s headline would render as grey text`)
  }
  assert.equal(KILL_CODES.confirmed.confirmed, true)
  assert.equal(KILL_CODES.confirmed.alarm, null)
})

test('the repeat is named: a session signalled before and still here proves the earlier ones failed', () => {
  const out = confirmedStop(ID, {
    ...FAST,
    agents: () => [row(4242)],
    isAlive: () => true,
    command: asClaudeHost,
    signal: () => {},
    priorAttempts: 4,
  })
  assert.equal(out.confirmed, false)
  assert.match(out.detail, /4 earlier/, 'the repetition is the evidence, so it is said')
})

test('a headline scoped to its surface still reaches the page', () => {
  // The prefix goes inside the asterisks. Outside them it would still match and read
  // as belonging to nothing; with punctuation it would stop matching and render as
  // grey text, which is obot.agent#129 all over again.
  for (const [code, spec] of Object.entries(KILL_CODES)) {
    if (code === 'confirmed') continue
    const headline = prefixedAlarm(spec, 'ADMIRAL')
    assert.match(headline, ALARM_RE, `${code} loses its alarm once it is scoped`)
    assert.match(headline, /^\*\*ADMIRAL /)
  }
  assert.equal(prefixedAlarm(KILL_CODES.confirmed, 'ADMIRAL'), null, 'a confirmed stop has no finding to scope')
})
