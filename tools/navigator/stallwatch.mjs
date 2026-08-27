// stallwatch — a session parked on a permission prompt, seen by the sweep rather than
// by a person (obot.agent#317, under jwildfire/obot.roadmap#212).
//
// ## The remedy we wrote for this cannot be used on this
//
// Measured 2026-08-21 with transcript evidence (obot.agent#315, `docs/session-reachability.md`):
// a session sitting on a permission prompt CANNOT BE REACHED. A cross-session message is
// enqueued unconditionally and drains at the receiver's next turn boundary, and a prompting
// session's next turn boundary is the permission decision itself — which only a human
// produces. The queue never drains. Two leads tried to unstick W0110; both sends returned
// `success: true` and neither was ever read, and the message was still queued at the moment
// the session died.
//
// So every "stop and tell the lead" instruction in the briefing is unreachable exactly when
// it applies. The conversational remedy does not exist and detection is the only one left.
// Three stalls this week, each found by a person happening to look: 67 minutes, 81 minutes,
// 59 minutes. The middle one was fatal — its work had to be finished by prime.
//
// ## `status`, never `state`, and the difference is the whole detector
//
// Three probes in #315, each read back from the session's own transcript JSONL rather than
// from the sender's return value:
//
//   A  real permission prompt      status=waiting  state=blocked  enqueued, NEVER dequeued
//   B  idle, `blocked` because a
//      classifier read its prose   status=idle     state=blocked  dequeued in 8ms, acted on in 2.2s
//   C  busy mid-tool               status=busy     state=working  dequeued 65s later, acted on
//
// A and B read the same `state`. They need opposite responses: A cannot be reached and must
// be stopped or answered, B is healthy and messaging it works in milliseconds. Anything
// keyed on `state` conflates them, and conflating them is how a working session gets killed
// — which is why the wake's own `waiting` reading (wake.mjs, keyed on `state`/`tempo`) has to
// hold a first sighting for a whole sweep before it believes itself. This detector has no
// such window to buy, because `status` is not inferred from anything the session said.
//
// ## Where the fields actually are, which is not where the brief said
//
// The dispatch for this work said `~/.claude/jobs/{id}/state.json` carries all four fields.
// It carries three. NO job record on this machine carries a `status` key at all — 194 of them
// were checked and the count of matches is zero. `status` exists only in the live daemon view
// `claude agents --json`, so this module reads both and joins them on the job id (the agent
// row's `id` is the job directory name, and `daemonShort` in the record agrees). Written down
// here because the next reader would otherwise lose an hour to the same premise:
//
//   claude agents --json   status, kind, cwd, sessionId, id      the live daemon
//   jobs/{id}/state.json   needs, updatedAt, inFlight.queued     the harness's record
//
// ## Why three minutes
//
// The bar the dispatch set is "well before the cost is sunk", and the number is not fitted to
// a measured distribution because none exists: nothing on this machine records `status` over
// time, so there is no history of prompt durations to fit. It is set from the three bounds
// that do exist, and stated so it can be argued with rather than inherited.
//
//   - The briefing already names a bar in prose: "a prompt that has not cleared in a couple of
//     minutes goes back to whoever dispatched the work". A detector built because that
//     instruction does not reach the worker should fire at the bar the instruction names.
//   - The sweep's period is five minutes, so any threshold below five collapses to "the first
//     sweep that sees it". Three buys the whole of that and nothing is gained by going lower.
//   - The wake's fifteen minutes is not a comparable number. Ten of it is grace and five is a
//     settle window whose entire purpose is to tell a real prompt from a prose misread — the
//     distinction `status` makes for free. Inheriting the fifteen would be inheriting the cost
//     of a problem this reading does not have.
//
// What three minutes costs if it is wrong: one line on the Navigator's channel about a prompt
// a present human was about to answer. What fifteen cost, three times this week, is in the
// paragraph at the top.
//
// ## No suspension guard, deliberately
//
// wake.mjs suppresses its elapsed-time detections when the host napped, because a detector
// cannot run on a suspended host and every worker looks stalled on the first reading after.
// That argument does not transfer. `status: waiting` is a PRESENT-TENSE reading from the live
// daemon, not an inference from elapsed time: a nap cannot manufacture one. A nap can only
// inflate the age, and an inflated age on a genuinely open prompt is still a genuinely open
// prompt — nobody was answering it while the lid was shut either.
//
// ## Background sessions only
//
// An interactive session shows its prompt to the person typing at it, and reporting a human's
// own prompt back at them is noise on a channel whose only value is that a line on it means
// something. The failure this closes is a background session nobody is looking at. `kind` in
// the agent row says which, and sessions outside this workspace are not ours to report
// (obot.agent#188).
import { execFileSync } from 'node:child_process'
import { closeSync, openSync, readSync, statSync } from 'node:fs'

import { workerIdOf } from './wake.mjs'
import { roleOf } from '../lib/roles.mjs'

/**
 * Minutes a prompt may stand before it is a finding. See "Why three minutes" above.
 */
export const STALL_PROMPT_MIN = 3

/** The section's heading, so the broken form and the rendered form land in one section. */
export const HEADING = '## Stalled at a prompt — sessions nobody can reach'

/**
 * The reading itself did not happen. Not a clean bill of health and must not read as one.
 *
 * Spelled for the real `ALARM_RE` (`tools/ops-dashboard/lib/navigator.mjs`): the vocabulary is
 * GAP FINDING BREACHED FAILED DOWN BROKEN and nothing else, so "NO STALL READING" would render
 * grey on his page for as long as it existed (hub#241).
 */
export const ALARM_READING = '**STALL READING BROKEN**'

// The re-wake floor for this kind is `REWAKE_MIN.stall` in wake.mjs, beside every other
// kind's, because `deliverable()` reads that one table. A copy here would be a second
// answer to the same question, which is how the two halves of one channel drift.

/** The live daemon's own view of every session, or null when it could not be read. */
export function readAgents({ run = execFileSync } = {}) {
  try {
    const rows = JSON.parse(run('claude', ['agents', '--json'], { encoding: 'utf8', timeout: 20000 }))
    return Array.isArray(rows) ? rows : null
  } catch { return null }
}

/**
 * How much of a transcript is read to count the messages nobody has collected.
 *
 * The whole file is not an option — prime's is 15 MB and this runs inside a five-minute
 * cadence — and the whole file is not needed either. Only entries AFTER the prompt opened
 * are counted, and a parked session writes nothing after that instant, so everything in
 * scope is at the very end of the file. A cut first line simply fails to parse and is
 * ignored, exactly as the wake log's tail reader treats one.
 */
export const TRANSCRIPT_TAIL_BYTES = 256 * 1024

/**
 * Messages sitting in a session's queue that it has not read.
 *
 * WHY NOT `inFlight.queued`, WHICH IS THE OBVIOUS FIELD. Because it is frozen. The job
 * record is rewritten when the session publishes state and a session parked at a prompt
 * publishes nothing, so the number in the record is whatever was true BEFORE the prompt
 * opened. Measured on 2026-08-21: a message was sent to a parked probe, its transcript
 * recorded the `enqueue` at 21:48:27.301Z, and its record still read `queued: 0` at
 * 21:48:54 and stayed there. #315 saw the same field read 1 only at the moment the session
 * was STOPPED and its record was written one last time. A field that reads nought for
 * precisely the sessions it is about is a check that cannot fire, which is this
 * programme's own signature defect and not one to ship inside the fix for it.
 *
 * So the transcript is the reading and the record is the floor. The transcript is
 * append-only and the harness writes one `queue-operation` entry per message with an
 * `operation` of `enqueue`, `dequeue` or `remove`; counted only after `since` — the instant
 * the record froze — because a parked session cannot dequeue anything after that, which is
 * the entire finding.
 */
export function queueDepth(job, { now = new Date(), read = readTail } = {}) {
  const floor = Number(job?.queued ?? 0) || 0
  const since = Date.parse(job?.updatedAt ?? '')
  if (!job?.transcript || Number.isNaN(since)) return floor
  let text
  try { text = read(job.transcript) } catch { return floor }
  let depth = 0
  for (const raw of String(text).split('\n')) {
    if (!raw.includes('queue-operation')) continue
    let e
    try { e = JSON.parse(raw) } catch { continue }
    if (e?.type !== 'queue-operation') continue
    const t = Date.parse(e.timestamp ?? '')
    if (Number.isNaN(t) || t < since) continue
    if (e.operation === 'enqueue') depth += 1
    else if (e.operation === 'dequeue' || e.operation === 'remove') depth -= 1
  }
  // A window can hold a dequeue whose enqueue predates it, so the count floors at nought
  // rather than going negative — and the record's own number is never argued down by it.
  return Math.max(floor, depth, 0)
}

/** The tail of a file, bounded. Same shape as the wake log's reader, for the same reason. */
export function readTail(path, { bytes = TRANSCRIPT_TAIL_BYTES } = {}) {
  const size = statSync(path).size
  const fd = openSync(path, 'r')
  try {
    const n = Math.min(size, bytes)
    const buf = Buffer.alloc(n)
    readSync(fd, buf, 0, n, size - n)
    return buf.toString('utf8')
  } finally { closeSync(fd) }
}

const minsSince = (at, now) => {
  const t = Date.parse(at ?? '')
  return Number.isNaN(t) ? null : (now.getTime() - t) / 60000
}

/**
 * What to call the session in a line somebody has to act on.
 *
 * `job <id>` is the least actionable thing a finding can say, so the worker id comes first
 * and the role short name second — the same order and the same helpers the wake uses, because
 * two spellings of "what is this session called" is how one channel comes to name the same
 * session two ways.
 */
const label = (name, id) => workerIdOf(name) || roleOf(name)?.short || `job ${id}`

/**
 * A cut sentence must look cut, and the `needs` text is the one thing here that must not be
 * paraphrased — it is the pending approval, verbatim, and a lead reading it has to be able to
 * answer without opening anything.
 */
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

const inWorkspace = (cwd, ws) => Boolean(ws) && typeof cwd === 'string' &&
  (cwd === ws || cwd.startsWith(`${ws}/`))

/**
 * One whole reading: who is parked, and who merely looks it.
 *
 * `agents` null means the daemon view could not be read and the answer is unknown rather
 * than clear. `jobs` is what `readJobs` (wake.mjs) already produced for this sweep — one
 * reader of the job records, so this and the wake can never come to disagree about the same
 * session.
 */
export function collectStalls({ agents = null, jobs = [], ws = null, now = new Date(),
                                thresholdMin = STALL_PROMPT_MIN, depth = queueDepth } = {}) {
  if (!Array.isArray(agents)) {
    return { read: false, why: '`claude agents --json` did not answer', stalls: [], reachable: [], watched: 0 }
  }
  const byId = new Map()
  const bySession = new Map()
  for (const j of jobs ?? []) {
    if (j?.id) byId.set(j.id, j)
    if (j?.sessionId) bySession.set(j.sessionId, j)
  }
  const watched = agents.filter((a) => a?.kind === 'background' && inWorkspace(a?.cwd, ws))
  const stalls = []
  const reachable = []
  for (const a of watched) {
    const job = (a.id && byId.get(a.id)) || (a.sessionId && bySession.get(a.sessionId)) || null
    const name = a.name ?? job?.name ?? ''
    // The other half of the discriminator, and it is reported rather than dropped. A
    // suppression that produces no output is indistinguishable from a gate that never ran,
    // which is this programme's own recurring defect and not one to reproduce inside the fix
    // for it. This is the probe-B case: `state: blocked` from its own prose, reachable in
    // milliseconds, and the session a `state`-keyed detector would have gone to kill.
    if (a.status !== 'waiting') {
      if (job?.state === 'blocked' || job?.tempo === 'blocked') {
        reachable.push({ id: a.id ?? null, worker: label(name, a.id), status: a.status ?? '?' })
      }
      continue
    }
    const ageMin = job ? minsSince(job.updatedAt, now) : null
    // An age we could not measure is not an age below the threshold. A session whose record
    // is missing or unreadable is still a session the daemon says is parked, and holding it
    // back for a clock we do not have would be a detector going quiet on a missing field
    // (jwildfire/obot.roadmap#215).
    if (ageMin !== null && ageMin < thresholdMin) continue
    stalls.push({
      id: a.id ?? null,
      sessionId: a.sessionId ?? null,
      worker: label(name, a.id),
      ageMin,
      // Verbatim, up to a bound that looks bounded. Absent is said as absent: the record was
      // read and carried no `needs`, or the record could not be read at all, and those are
      // different sentences.
      needs: job ? (job.needs || '') : null,
      // The daemon's own word for what it is waiting on. Captured so the headline cannot
      // outlive its evidence: every row measured on this machine reads `permission prompt`,
      // and the day one does not, the section says the daemon called it something else
      // rather than asserting a prompt that was never observed.
      waitingFor: a.waitingFor ?? null,
      queued: job ? depth(job, { now }) : 0,
      recordRead: Boolean(job),
    })
  }
  return { read: true, why: null, stalls, reachable, watched: watched.length }
}

/** The reading did not happen. Loud, and never mistakable for a clear one. */
export function stallBroken(why) {
  return `${HEADING}\n\n${ALARM_READING} — ${why}. No session's reachability was looked at this sweep, so nothing here says the fleet is reachable. Unknown, not clear.\n`
}

/**
 * Verdict first on an unindented line, rows as bullets beneath it.
 *
 * The dashboard's reader alarm-tests preamble notes and UNINDENTED plain lines and nothing
 * else — a `- ` bullet can never go red however it is spelled (hub#241, obot.agent#223). So
 * the verdict carries the alarm and the rows carry the detail, and never the other way round.
 */
export function stallSection(reading) {
  if (!reading || !reading.read) return stallBroken(reading?.why ?? 'no stall reading ran this sweep')
  const { stalls, reachable, watched } = reading
  const lines = [HEADING, '']
  if (stalls.length) {
    lines.push(`stalls: ${stalls.length} parked — **STALL FINDING** — ${stalls.length} background session${stalls.length === 1 ? ' is' : 's are'} parked on a permission prompt and cannot be messaged. A send to one returns \`success: true\` and is never delivered: the queue drains at the receiver's next turn boundary and a prompting session's next turn boundary IS the permission decision (docs/session-reachability.md). Answer the prompt at the session, or stop it and respawn the work — there is no third option and nothing here expires on its own.`)
  } else {
    lines.push(`stalls: clear — no background session in this workspace is parked on a permission prompt (${watched} watched, \`claude agents --json\` joined to the job records on \`id\`)`)
  }
  // Reported even when it is the only thing to report. This is the line that says the
  // discriminator did work rather than that nothing was blocked, and without it a clean
  // stall section and a broken one look the same from the page.
  if (reachable.length) {
    lines.push(`reachable: ${reachable.length} session${reachable.length === 1 ? '' : 's'} read blocked in the job record but the daemon says ${reachable.map((r) => `${r.worker} is ${r.status}`).join(', ')} — that is a classifier reading the session's own prose, not a pending prompt, and a message reaches it in milliseconds. Not reported above, on purpose (obot.agent#315 probe B).`)
  }
  if (stalls.length) {
    lines.push('', '### Parked', '')
    for (const s of stalls) {
      const age = s.ageMin === null ? 'age unknown, its job record could not be read' : `waiting ${Math.round(s.ageMin)}m`
      const needs = s.recordRead
        ? (s.needs ? `needs: ${clip(s.needs, 200)}` : 'needs: the record was read and carries no pending-approval text')
        : 'needs: unknown, its job record could not be read'
      // Non-zero only. A queue depth of nought is the ordinary case and printing it every
      // time is how the number that matters stops being read.
      // Silent in the ordinary case, loud when the daemon's word is not the one the
      // headline used. A detector whose headline can drift from its evidence is a
      // detector that will one day be confidently wrong on a page he reads.
      const kind = s.waitingFor && !/permission prompt/i.test(s.waitingFor)
        ? ` · the daemon calls this wait "${clip(s.waitingFor, 60)}" rather than a permission prompt — the row above may not be one`
        : ''
      const queued = s.queued ? ` · ${s.queued} message(s) queued and undelivered — they die with the session, so somebody may be waiting on an answer that will never come` : ''
      lines.push(`- ${s.worker} · ${age} · ${needs}${kind}${queued}`)
    }
  }
  return lines.join('\n') + '\n'
}

/**
 * The same finding as wake-channel detections, so it is pushed and not only published.
 *
 * The section is read when the Navigator looks; this is what reaches it when nobody is
 * looking, which is the entire failure being closed. Shape matches wake.mjs's detections so
 * `deliverable()` and `wakeLine()` take them unchanged.
 *
 * It does NOT suppress the wake's own `waiting` reading of the same session, which may report
 * it again later from the inferred field. Documented duplication is the cheaper mistake: the
 * alternative is changing the behaviour of a detector three other things already depend on,
 * inside the change that adds a second one.
 */
export function stallDetections(reading, { now = new Date() } = {}) {
  if (!reading?.read) return []
  return reading.stalls.map((s) => {
    const age = s.ageMin === null ? 'for an unknown time (its job record could not be read)' : `${Math.round(s.ageMin)}m`
    const needs = s.needs ? ` — needs: ${clip(s.needs, 140)}` : ''
    const queued = s.queued ? ` · ${s.queued} message(s) queued and undelivered, lost when it ends` : ''
    return {
      kind: 'stall',
      key: `stall:${s.id ?? s.sessionId ?? s.worker}`,
      job: s.id,
      worker: s.worker,
      at: now.toISOString(),
      line: `${s.worker} has been parked on a permission prompt ${age} and CANNOT be messaged — a send returns success and is never delivered${needs}${queued} · answer it at the session or stop it`,
    }
  })
}
