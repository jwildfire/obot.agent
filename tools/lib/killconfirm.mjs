// killconfirm — a kill this house reports is a kill it confirmed.
//
// Implements jwildfire/obot.roadmap#251 (obot.agent#223). One primitive, for every
// path here that terminates a process, because the reasoning that makes any of them
// trustworthy is the same reasoning.
//
// WHAT IT REPLACES. `.claude/session-hub/admiral.log`, 2026-08-18, lines 1-14:
// session 1cc6cc32 recorded as killed five times in twenty-one minutes at three
// different pids, and six lines reading `killed overrunning admiral …: no pid found
// — reported only` — the success wording emitted on the branch that admits nothing
// happened. Four admirals ran 263 to 279 minutes against a thirty-minute budget
// while the log called them killed; @jwildfire's concierge terminated them by hand.
//
// THE MEASUREMENT THAT DECIDES THE DESIGN. The three pids are not a stale lookup.
// The pid `claude agents --json` reports for a background session is a
// `claude bg-spare` claimed from a warm pool owned by `claude daemon run` — measured
// on this machine, the process under one session's row had started FIFTY-SIX MINUTES
// before the session it was listed under. The job record carries `respawnFlags` and
// `resumeSessionId`, which is the daemon saying what it does when a host dies: claim
// another spare and resume the session onto it.
//
// So: A DEAD PID CANNOT PROVE A STOPPED SESSION. Confirming the process is gone is
// necessary and not sufficient. A fix that only re-checked liveness after SIGTERM
// would have gone on reporting confirmed kills for sessions that were still running
// — the same defect with a longer code path. Confirmation is read at the SESSION
// level, off the ledger, after the process is gone.
//
// THE FOUR RULES, from the requirement:
//   1. Send, wait, verify absence, escalate to SIGKILL, verify again. Only a
//      confirmed absence may be reported with the word killed.
//   2. An unconfirmed stop is a FINDING, on the sweep's alarm vocabulary — never a
//      line that reads like success.
//   3. The no-pid path does not contain the word killed. It is a detection failure.
//   4. A pid whose process does not match the expected session is treated as NOT
//      FOUND rather than signalled.
//
// Rule 3 is held as a property over the whole vocabulary rather than per branch: see
// KILL_CODES, and the case in tools/navigator/test/killconfirm.test.mjs that walks
// every entry. A wording rule enforced one branch at a time is a wording rule the
// next branch forgets.
import { execFileSync } from 'node:child_process'

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)

/** How long a process gets to exit on SIGTERM before the escalation. */
export const TERM_WAIT_MS = num(process.env.OBOT_KILL_TERM_MS, 8000)
/** And on SIGKILL, after which it is a finding — nothing survives SIGKILL except a
 *  process wedged in an uninterruptible kernel wait, which is worth being told about. */
export const HARD_WAIT_MS = num(process.env.OBOT_KILL_HARD_MS, 4000)
/** The pause before the session-level re-read, so the daemon's view has had a moment
 *  to catch up with a host that just exited. Short: an unknown answer is reported as
 *  unknown, and waiting longer to guess is not an improvement. */
export const SETTLE_MS = num(process.env.OBOT_KILL_SETTLE_MS, 2000)

/**
 * Every outcome this can reach, its confirmed-ness, and the headline it renders as.
 *
 * The headlines are spelled for `ALARM_RE` in tools/ops-dashboard/lib/navigator.mjs,
 * which is case-sensitive ALL-CAPS keyed on GAP/FINDING/BREACHED/FAILED/DOWN/BROKEN
 * and admits only `[A-Z0-9 ]` between the asterisks. Anything else reaches his page
 * as ordinary grey text — a finding nobody sees, which is the failure one door down
 * from the one this file is about.
 */
export const KILL_CODES = {
  confirmed:          { confirmed: true,  alarm: null },
  'not-found':        { confirmed: false, alarm: '**PID RESOLUTION FAILED**' },
  'stale-pid':        { confirmed: false, alarm: '**PID RESOLUTION FAILED**' },
  'identity-mismatch':{ confirmed: false, alarm: '**PID RESOLUTION FAILED**' },
  'ledger-unreadable':{ confirmed: false, alarm: '**SESSION LEDGER UNREADABLE BROKEN READING**' },
  'signal-failed':    { confirmed: false, alarm: '**STOP SIGNAL FAILED**' },
  survived:           { confirmed: false, alarm: '**STOP UNCONFIRMED FINDING**' },
  respawned:          { confirmed: false, alarm: '**STOP UNCONFIRMED FINDING**' },
  'ledger-lag':       { confirmed: false, alarm: '**STOP UNCONFIRMED FINDING**' },
}

/**
 * The outcome's headline, scoped to the surface reporting it.
 *
 * `**STOP UNCONFIRMED FINDING**` becomes `**ADMIRAL STOP UNCONFIRMED FINDING**`. The
 * prefix goes INSIDE the asterisks because the dashboard's regex admits only
 * `[A-Z0-9 ]` between them — a prefix written outside would leave a headline that
 * matches and reads as if it belonged to nothing in particular, and one written with
 * punctuation would stop matching entirely and render grey.
 */
export const prefixedAlarm = (outcome, prefix) => {
  const alarm = outcome?.alarm
  if (!alarm) return null
  return prefix ? alarm.replace(/^\*\*/, `**${prefix} `) : alarm
}

/**
 * Is that pid still running? `EPERM` counts: alive, just not ours to signal.
 *
 * Same shape as selfupdate.mjs's `alive`, deliberately — two liveness answers that
 * disagree would be worse than either.
 */
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

/** What is actually running under that pid, or null if nothing is. */
export function processCommand(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 10000 })
    return out.trim() || null
  } catch { return null }
}

/**
 * The live agent ledger, or null when it could not be read.
 *
 * Null rather than `[]`, and the difference is the whole point: an unreadable ledger
 * is not an empty fleet, and treating it as one turns every session into a session
 * that does not exist — which is the branch that logged `no pid found` six times.
 */
export function readAgents() {
  try {
    const raw = execFileSync('claude', ['agents', '--json'], { encoding: 'utf8', timeout: 20000 })
    const rows = JSON.parse(raw)
    return Array.isArray(rows) ? rows : null
  } catch { return null }
}

/**
 * A blocking sleep, because every caller here is synchronous — the sweep is a script
 * and the launcher runs inside it.
 */
const sleepMs = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms)) } catch { /* a sleep that fails is a shorter sleep */ }
}

/** The session's row in the ledger, joined on the id and nothing else. A name is a
 *  claim; the id is the identity (obot.agent#188). */
const rowFor = (rows, id) => rows.find((r) => String(r?.sessionId ?? '').startsWith(id)) ?? null

/** Does that command line belong to a claude session host? A recycled pid answers to
 *  something else, and something else is never signalled. */
const isSessionHost = (cmd) => /(^|\/)claude(\s|$)/.test(String(cmd ?? '').trim())

const clip = (s, n = 90) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t }

const result = (id, code, detail, { pid = null, sent = [] } = {}) => {
  const spec = KILL_CODES[code]
  if (!spec) throw new Error(`killconfirm: unknown outcome ${code}`)
  return { id, code, pid, sent, confirmed: spec.confirmed, alarm: spec.alarm, detail }
}

/**
 * Stop a session and prove it stopped, or say what is unproven.
 *
 * Everything the machine is asked about is injectable, for one reason: the branches
 * that matter here are the ones nobody can arrange on demand — a process that will
 * not die, a pid that has been recycled onto something else, a session that comes
 * back on a new host. A branch that cannot be reached from a test is a branch nobody
 * has ever seen run, and two of these had never run correctly in production.
 *
 * @param {string} id             session id, or its leading segment (the job id)
 * @param {number} priorAttempts  how many times this session has been signalled
 *                                before — repetition is evidence, so it is said
 */
export function confirmedStop(id, {
  agents = readAgents,
  isAlive = alive,
  command = processCommand,
  signal = process.kill.bind(process),
  sleep = sleepMs,
  termWaitMs = TERM_WAIT_MS,
  hardWaitMs = HARD_WAIT_MS,
  settleMs = SETTLE_MS,
  pollMs = 250,
  priorAttempts = 0,
} = {}) {
  const repeat = priorAttempts > 0
    ? ` — and ${priorAttempts} earlier attempt(s) on this session are on record, which is itself evidence they did not stop it`
    : ''

  const rows = agents()
  if (rows === null) {
    return result(id, 'ledger-unreadable',
      `the agent ledger could not be read, so no pid was resolved for ${id} and nothing was signalled; ` +
      `an unreadable ledger is not an absent session${repeat}`)
  }

  const row = rowFor(rows, id)
  if (!row) {
    return result(id, 'not-found',
      `no session in the agent ledger carries the id ${id}, so nothing was signalled — ` +
      `this is a detection failure, not a stop${repeat}`)
  }

  const pid = Number(row.pid)
  if (!Number.isInteger(pid) || pid <= 0) {
    return result(id, 'not-found',
      `the ledger row for ${id} carries no usable pid (${JSON.stringify(row.pid ?? null)}), ` +
      `so nothing was signalled — this is a detection failure, not a stop${repeat}`)
  }

  // ---- rule 4: identity before the signal ----------------------------------
  const cmd = command(pid)
  if (!isAlive(pid) || cmd === null) {
    return result(id, 'stale-pid',
      `the ledger names pid ${pid} for ${id} and no such process is running — the record is stale, ` +
      `so nothing was signalled and the session's state is unestablished${repeat}`, { pid })
  }
  if (!isSessionHost(cmd)) {
    return result(id, 'identity-mismatch',
      `pid ${pid} is running \`${clip(cmd)}\` rather than a claude session host, so the pid has been ` +
      `recycled onto something else — treated as not found, and nothing was signalled${repeat}`, { pid })
  }

  // ---- rule 1: send, wait, verify, escalate, verify ------------------------
  const sent = []
  const waitFor = (ms) => {
    let waited = 0
    while (isAlive(pid) && waited < ms) { sleep(pollMs); waited += pollMs }
    return !isAlive(pid)
  }

  try { signal(pid, 'SIGTERM'); sent.push('SIGTERM') } catch (e) {
    return result(id, 'signal-failed',
      `SIGTERM to pid ${pid} could not be delivered: ${e.code ?? e.message} — nothing was stopped${repeat}`,
      { pid, sent })
  }
  let gone = waitFor(termWaitMs)
  if (!gone) {
    try { signal(pid, 'SIGKILL'); sent.push('SIGKILL') } catch (e) {
      return result(id, 'signal-failed',
        `pid ${pid} ignored SIGTERM and SIGKILL could not be delivered: ${e.code ?? e.message} — ` +
        `the session is still running${repeat}`, { pid, sent })
    }
    gone = waitFor(hardWaitMs)
  }
  if (!gone) {
    return result(id, 'survived',
      `pid ${pid} was sent ${sent.join(' then ')} and is STILL RUNNING ` +
      `${Math.round((termWaitMs + hardWaitMs) / 1000)}s later — nothing was stopped${repeat}`,
      { pid, sent })
  }

  // ---- the session, not the process ---------------------------------------
  //
  // The host is gone. That is not yet a stopped session: the daemon's whole job is to
  // claim another spare and resume the session onto it, which is what made one
  // session stoppable five times without ever stopping.
  sleep(settleMs)
  const after = agents()
  if (after === null) {
    return result(id, 'ledger-unreadable',
      `pid ${pid} is gone after ${sent.join(' then ')}, but the agent ledger could not be re-read, ` +
      `so whether session ${id} is still running is unestablished${repeat}`, { pid, sent })
  }
  const back = rowFor(after, id)
  if (!back) {
    return result(id, 'confirmed',
      `pid ${pid} exited on ${sent.join(' then ')} and session ${id} is no longer in the agent ledger — ` +
      `stop confirmed at the session, not merely at the process`, { pid, sent })
  }
  const backPid = Number(back.pid)
  if (Number.isInteger(backPid) && backPid > 0 && backPid !== pid && isAlive(backPid)) {
    return result(id, 'respawned',
      `pid ${pid} exited on ${sent.join(' then ')} and session ${id} is live again on pid ${backPid} — ` +
      `the daemon re-hosted it, so the session was NOT stopped${repeat}`, { pid, sent })
  }
  return result(id, 'ledger-lag',
    `pid ${pid} exited on ${sent.join(' then ')} but session ${id} is still listed in the agent ledger ` +
    `(pid ${Number.isFinite(backPid) ? backPid : 'none'}), so whether it was stopped or re-hosted is ` +
    `unestablished — unknown is not success${repeat}`, { pid, sent })
}
