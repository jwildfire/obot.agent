#!/usr/bin/env node
// wake — a worker that stops wakes the Navigator (jwildfire/obot.roadmap#212).
//
// THE FAILURE THIS CLOSES. Nothing tells the Navigator that a worker has stopped, so
// workers stop and then wait. On 2026-08-16 W0006 and W0007 both finished with work
// open and sat about twenty minutes on a fully awake machine, noticed only because
// obot-prime happened to send an unrelated message. On 2026-08-17 the Navigator sat
// idle from 23:20 to 05:25 with a full backlog and nothing running, after W0013
// closed out and nobody judged it; the power log shows no sleep or wake events in
// that window, so the host was awake and the supervisor simply stalled. @jwildfire
// noticed first, twice in two days.
//
// WHAT THE SWEEP ALREADY KNOWS. This adds no new data source. The harness writes
// `~/.claude/jobs/<id>/state.json` for every session; `firstTerminalAt` is already
// the closeout watermark the sweep uses, and the delivery journal is already the
// append-only ledger of which closeouts have a verdict. So already-judged
// suppression is a comparison, not new state, and so is the re-wake floor: the wake
// log is append-only and its own last entry per key is the debounce.
//
// FOUR STOP-STATES, FROM THE FIELDS THE HARNESS ACTUALLY WRITES. The taxonomy below
// was derived by reading all 78 job records on this machine rather than from the
// state name alone, because the state name is the field that lies:
//
//   state=working  tempo=blocked  needs="approve Bash: …"   → WAITING  (W0007, W0008
//                  — twenty hours each, both reading `working` the whole time)
//   state=blocked  detail="API Error: Can't reach the API"  → DEAD     (W0009)
//   state=working  tempo=active   updatedAt 30m+ stale      → STALLED
//   firstTerminalAt set, no verdict in the delivery journal → STOPPED
//
// `tempo` is what separates a worker waiting for a human from a worker that has gone
// quiet, and neither is visible in `state`. A worker stuck on a permission prompt
// reads `working` forever.
//
// WHO IS WATCHED. Workers, and any role that must exit inside a budget. Not the
// roles that rest — prime and the Navigator wait between wakings by design, so
// `blocked` is their ordinary state, and calling it death every quiet hour would
// train the reader to ignore the hour it is true.
//
// The fleet manager is the second kind and was excluded as if it were the first,
// because the role registry answered pinning and liveness with one list. It sat
// blocked from 13:51Z on 2026-08-17 carrying an `API Error` detail this file's own
// `DEATH` pattern matches on sight, for ten hours, until a person stopped it
// (obot.agent#181). Nothing here was missing except permission to look.
//
// THE WAKE IS NEVER HIS. Everything here reaches 🧭🤖 obot-navigator and nothing
// reaches @jwildfire — no PushNotification, no issue comment, no Reminder. A worker
// finishing is precisely the kind of event that should reach an officer and not a
// person, and the mechanism below was chosen partly because it has no path to him.
//
// A MISSED WAKE DEGRADES TO TODAY, NEVER TO SILENCE. The wake is delivered by the
// Navigator session's own Monitor tailing the append-only log this module writes. A
// Monitor dies with its session, so the listener heart-beats a file and the sweep
// reports the channel's state next to the pending list: armed, or WAKE CHANNEL DOWN
// with the count that is not being delivered. The pending list is rendered whether
// or not anything was delivered, so the state file can never claim everything is
// judged because the delivery lane broke.
//
// THE HOST GUARD. On 2026-08-16 a travelling laptop closed its lid and every worker
// on it looked stalled and dead on the next reading; the amendment to #212 was filed
// on that misreading and corrected the same evening. A detector cannot run on a
// suspended host, so when the gap since the previous sweep is longer than one host
// nap the elapsed-time detections (stalled, waiting, idle) are suppressed for that
// run and the reason is printed. Judging a closeout is not time-since-activity and
// is unaffected.
import { readFileSync, readdirSync, statSync } from 'node:fs'

// Which sessions this file is entitled to call dead. The registry declares each
// role's lifecycle; this file asks the liveness question and never the pinning one
// (obot.agent#181, tools/lib/roles.mjs).
import { mustExit, roleOf } from '../lib/roles.mjs'

/** The tags whose sessions are workers. Matches tools/lib/worker_ledger.py. */
export const WORKER_TAGS = ['\u{1F46F}\u{1F916}', '\u{1F9BE}\u{1F916}'] // 👯🤖 🦾🤖
export const NAVIGATOR_TAG = '\u{1F9ED}\u{1F916}' // 🧭🤖

/**
 * How far back a closeout can be and still be worth waking for.
 *
 * There are 63 finished jobs on this machine and most of them predate the delivery
 * record entirely. Without a bound, arming this would deliver a burst of wakes for
 * history nobody can judge any more. What falls outside is counted and reported,
 * never dropped silently.
 */
export const WAKE_WINDOW_HOURS = 24

/** Quiet-for, in minutes, before a tempo=active worker counts as stalled. */
export const STALL_MIN = 30
/** Grace before a worker waiting on a human is called unresolved. */
export const WAITING_GRACE_MIN = 10
/** How long the Navigator must be idle before idleness itself is a detection. */
export const IDLE_MIN = 20
/** A sweep gap longer than this means the host was away, not the fleet stalled. */
export const SUSPEND_GAP_MIN = 15
/** How long the listener heartbeat may be stale before the channel reads as down. */
export const LISTENER_STALE_MIN = 5

/**
 * How long a budgeted role may be quiet before quiet itself is the finding.
 *
 * A worker going quiet is ambiguous — it may be thinking, and `stalled` needs
 * `tempo` to disambiguate. A role that must exit inside a thirty-minute budget and
 * has not moved for thirty minutes is not thinking, whatever its tempo says. This is
 * the catch-all under the three readings above: the manager that was actually lost
 * matched `DEATH` and would have been caught by name, but a wedge carrying an
 * unrecognised message must not be silent purely because nobody has seen that
 * message yet.
 *
 * Held equal to `MANAGER_TTL_MIN` in fleet.mjs by intent rather than by import —
 * fleet.mjs imports this file, so the dependency cannot run the other way.
 */
export const TRIGGERED_QUIET_MIN = 30

/**
 * Per-kind floor between repeat wakes for the same thing.
 *
 * An unjudged closeout keeps nagging, because that is the backlog the whole role
 * exists to clear — it stops when a verdict is recorded, which is the correct
 * silencer. The floors keep that from being a wake every five minutes.
 */
export const REWAKE_MIN = { stopped: 30, stalled: 60, waiting: 60, dead: 60, wedged: 60, idle: 45 }

/** Wakes delivered per run. The overflow is reported, never hidden. */
export const MAX_WAKES_PER_RUN = 3

/**
 * A worker that died rather than one waiting for an answer.
 *
 * Both land in `blocked`; only the message separates them. Every signature here was
 * taken from a real job record on this machine — an invented list would be the
 * difference between "the worker is dead" and "the worker asked you something",
 * which is the one distinction this module cannot afford to guess at.
 */
export const DEATH = /API Error|API unavailable|Connection refused|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|can't reach the api|rate.?limit|Internal server error|heap out of memory/i

const W_ID = /W\d{4}(?:\.\d+)?/

export const isWorker = (job) => WORKER_TAGS.some((t) => String(job?.name ?? '').startsWith(t))
export const isNavigator = (job) => String(job?.name ?? '').startsWith(NAVIGATOR_TAG)

/** The worker id in a session name, or null. `worker_ledger.display_name` puts it first. */
export function workerIdOf(name) {
  const m = W_ID.exec(String(name ?? ''))
  return m ? m[0] : null
}

/**
 * Every name a verdict might have been recorded under for this job.
 *
 * The delivery journal predates the worker ledger, so its `worker` field holds W-ids
 * for anything since 2026-08-16 and freehand slugs before it (`d0014fix`,
 * `wrapup-verify`). Matching on both means adopting this does not resurrect a
 * fortnight of already-judged closeouts under their old names.
 */
export function verdictKeys(job) {
  const name = String(job?.name ?? '')
  const keys = []
  const wid = workerIdOf(name)
  if (wid) keys.push(wid)
  const tail = name.trim().split(/\s+/).pop()
  if (tail && tail !== wid) keys.push(tail)
  if (job?.id) keys.push(job.id)
  return keys
}

const minsSince = (at, now) => {
  const t = Date.parse(at ?? '')
  return Number.isNaN(t) ? null : (now.getTime() - t) / 60000
}

// A role has no worker id and never will, so it is named by the role. `job <id>`
// alone is what a fleet detection would otherwise read as, which is the least
// actionable thing a wake can say.
const label = (job) => workerIdOf(job.name) || roleOf(job.name)?.short || `job ${job.id}`

// A cut sentence must look cut. These lines are notifications: the reader cannot
// scroll them, so one ending mid-quote reads as a corrupted record rather than a
// bounded one.
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

/**
 * Every stop-state one job is in right now. A job can be in two at once and both are
 * real: W0007 had an unjudged closeout from 08:13 AND was stuck on a permission
 * prompt twenty hours later. They need different actions, so they are different
 * detections rather than one summarised line.
 */
export function classify(job, now = new Date(), { hostWasAway = false } = {}) {
  // Workers, and roles that must exit inside a budget. A role that RESTS when idle
  // is skipped — and it is skipped for that reason, never for being on the list of
  // roles @jwildfire pins, which is the conflation that lost the fleet manager.
  const budgeted = mustExit(job?.name)
  if (!isWorker(job) && !budgeted) return []
  const out = []
  const quiet = minsSince(job.updatedAt, now)
  const said = `${job.detail ?? ''} ${job.needs ?? ''}`
  const terminal = ['done', 'stopped', 'failed'].includes(job.state)

  // A budgeted role exiting is it doing its job, not a closeout awaiting judgement:
  // it carries no deliverable of its own, and the delivery journal it writes into is
  // the Navigator's to judge. Asking for a verdict on every clean exit would put a
  // standing nag behind a design whose whole point is that it ends.
  const closedMin = budgeted ? null : minsSince(job.firstTerminalAt, now)
  if (closedMin !== null && closedMin <= WAKE_WINDOW_HOURS * 60) {
    out.push({
      kind: 'stopped',
      key: `stopped:${job.id}`,
      job: job.id,
      worker: label(job),
      at: job.firstTerminalAt,
      line: `${label(job)} closed out ${Math.round(closedMin)}m ago (${job.firstTerminalAt}) and has no verdict — judge it against GitHub, not against its own record, then record it with delivery-log`,
    })
  }

  // Death first: a dead worker is also, technically, quiet and blocked. Reporting it
  // as "waiting for an answer" would send the Navigator to answer a corpse.
  if (!terminal && job.state === 'blocked' && DEATH.test(said)) {
    out.push({
      kind: 'dead',
      key: `dead:${job.id}`,
      job: job.id,
      worker: label(job),
      at: job.updatedAt,
      line: `${label(job)} died — ${clip(job.detail || job.needs || 'no detail', 120)} · quiet ${quiet === null ? '?' : Math.round(quiet)}m · its own record understates what it wrote, so check GitHub for a branch or PR before writing it off`,
    })
  } else if (!terminal && (job.state === 'blocked' || job.tempo === 'blocked') && job.needs &&
             quiet !== null && quiet >= (hostWasAway ? Infinity : WAITING_GRACE_MIN)) {
    out.push({
      kind: 'waiting',
      key: `waiting:${job.id}`,
      job: job.id,
      worker: label(job),
      at: job.updatedAt,
      line: `${label(job)} has been waiting ${Math.round(quiet)}m and nobody has resolved it — needs: ${clip(job.needs, 120)}`,
    })
  } else if (!terminal && job.tempo === 'active' && quiet !== null &&
             quiet >= (hostWasAway ? Infinity : STALL_MIN)) {
    out.push({
      kind: 'stalled',
      key: `stalled:${job.id}`,
      job: job.id,
      worker: label(job),
      at: job.updatedAt,
      line: `${label(job)} reads working and has not moved for ${Math.round(quiet)}m — the usual gap between a worker's actions is about twenty seconds · last: ${clip(job.detail, 90)}`,
    })
  }

  // The catch-all for a budgeted role, and only for one. The three readings above
  // are worker readings: they need a known death signature, or a `needs` string, or
  // `tempo: active`. A manager can be wedged with none of the three — and unlike a
  // worker, one that is not moving is not merely slow, it is a session that was
  // supposed to be gone and now never will be. Two states, kept apart: `overrun` in
  // fleet.mjs catches the manager still RUNNING past its budget, this catches the
  // one that has STOPPED and will never exit.
  if (budgeted && !terminal && !out.length && quiet !== null &&
      quiet >= (hostWasAway ? Infinity : TRIGGERED_QUIET_MIN)) {
    out.push({
      kind: 'wedged',
      key: `wedged:${job.id}`,
      job: job.id,
      worker: label(job),
      at: job.updatedAt,
      line: `${label(job)} has not moved for ${Math.round(quiet)}m in state ${job.state} and must exit inside ${TRIGGERED_QUIET_MIN}m — it launched on a trigger and will not exit on its own · last: ${clip(job.detail || job.needs || 'no detail', 90)}`,
    })
  }
  return out
}

/**
 * The pending set: every stop-state across the fleet, minus the closeouts that
 * already carry a verdict.
 *
 * Suppression is on the delivery journal alone. A wake that was delivered but never
 * judged stays pending on purpose — the re-wake floor spaces it out, and the only
 * thing that silences it is the verdict it is asking for.
 */
export function pending(jobs = [], { now = new Date(), judged = new Set(), hostWasAway = false } = {}) {
  const out = []
  for (const job of jobs) {
    for (const d of classify(job, now, { hostWasAway })) {
      if (d.kind === 'stopped' && verdictKeys(job).some((k) => judged.has(k))) continue
      out.push(d)
    }
  }
  return out.sort((a, b) => Date.parse(b.at ?? 0) - Date.parse(a.at ?? 0))
}

/** Closeouts older than the window: counted so the bound is never silent. */
export function outsideWindow(jobs = [], { now = new Date(), judged = new Set() } = {}) {
  return jobs.filter((j) => isWorker(j) && j.firstTerminalAt)
    .filter((j) => (minsSince(j.firstTerminalAt, now) ?? 0) > WAKE_WINDOW_HOURS * 60)
    .filter((j) => !verdictKeys(j).some((k) => judged.has(k))).length
}

/**
 * The Navigator idle while there is work and nothing running.
 *
 * The extension @jwildfire named on 2026-08-17: the supervisor stalling is the same
 * shape one level up, and a queue with items and nothing running is itself a
 * detection worth waking on. `backlog` is the count of ready work — open issues
 * carrying a milestone, which under the milestone-before-work rule is exactly the
 * set that is allowed to be started.
 */
export function idleDetection(jobs = [], { now = new Date(), backlog = 0, backlogCapped = false, pendingCount = 0, hostWasAway = false } = {}) {
  if (hostWasAway || backlog <= 0) return null
  const nav = jobs.find(isNavigator)
  if (!nav) return null
  const navQuiet = minsSince(nav.updatedAt, now)
  if (nav.tempo === 'active' || navQuiet === null || navQuiet < IDLE_MIN) return null
  const live = jobs.filter((j) => isWorker(j) && j.tempo === 'active' &&
    (minsSince(j.updatedAt, now) ?? Infinity) < STALL_MIN)
  if (live.length) return null
  return {
    kind: 'idle',
    key: 'idle:navigator',
    job: nav.id,
    worker: 'navigator',
    at: nav.updatedAt,
    line: `you have been idle ${Math.round(navQuiet)}m with no worker running, ${backlogCapped ? 'at least ' : ''}${backlog} milestoned issue(s) ready and ${pendingCount} unjudged stop-state(s) — a queue with items and nothing running is itself a detection`,
  }
}

// ---- the wake log: delivery, debounce and provenance in one append-only file ----

export const wakeLine = (d, at) => `${at} WAKE ${d.key} — ${d.line}`

/** Entries back out of the log. The key is a field, never re-derived from prose. */
export function parseWakeLog(text = '') {
  const out = []
  for (const raw of String(text).split('\n')) {
    const m = /^(\S+) WAKE (\S+) — (.*)$/.exec(raw.trim())
    if (m) out.push({ at: m[1], key: m[2], line: m[3] })
  }
  return out
}

/**
 * Which detections go out this run.
 *
 * Two gates and both report what they held: the per-kind re-wake floor, so an
 * unjudged closeout nags without spamming, and a per-run cap, so arming this on a
 * fleet with a backlog does not deliver fifteen notifications in one breath.
 */
export function deliverable(detections = [], log = [], now = new Date(), { max = MAX_WAKES_PER_RUN } = {}) {
  const last = new Map()
  for (const e of log) {
    const t = Date.parse(e.at)
    if (!Number.isNaN(t) && t > (last.get(e.key) ?? 0)) last.set(e.key, t)
  }
  const deliver = []
  const held = []
  for (const d of detections) {
    const floor = REWAKE_MIN[d.kind] ?? 60
    const since = last.has(d.key) ? (now.getTime() - last.get(d.key)) / 60000 : Infinity
    if (since < floor) {
      held.push({ ...d, why: `woken ${Math.round(since)}m ago, floor ${floor}m` })
      continue
    }
    if (deliver.length >= max) {
      held.push({ ...d, why: `over the ${max}-per-run cap; next sweep` })
      continue
    }
    deliver.push(d)
  }
  return { deliver, held }
}

// ---- reading the world ------------------------------------------------------

/**
 * The harness's own job records — the one reader, for every check that asks.
 *
 * It moved here from `sweep.mjs` when this module was added rather than being
 * written a second time: two readers of the same records is how the closeout check
 * and the wake would come to disagree about which workers had stopped, and a
 * disagreement between two halves of the same detector is undetectable from either.
 *
 * Three fields the state name hides are what this adds. `tempo` separates a worker
 * waiting for a human from one that has gone quiet, `needs` says what it is waiting
 * for, and `updatedAt` is the only liveness clock there is.
 *
 * `firstTerminalAt` is the closeout watermark, written once and never revised. Where
 * the state file lacks it the timeline is read, because a job that died has a state
 * file reading `done` with a normal-looking completion note and the death survives
 * only in the append-only timeline.
 */
export function readJobs(dir, { read = readFileSync, list = readdirSync } = {}) {
  const out = []
  let names = []
  try { names = list(dir) } catch { return out }
  for (const id of names) {
    let s
    try { s = JSON.parse(read(`${dir}/${id}/state.json`, 'utf8')) } catch { continue }
    let firstTerminalAt = s.firstTerminalAt || null
    if (!firstTerminalAt && s.state === 'done') {
      try {
        for (const l of read(`${dir}/${id}/timeline.jsonl`, 'utf8').trim().split('\n')) {
          const ev = JSON.parse(l)
          if (['done', 'blocked', 'failed'].includes(ev.state || ev.type)) { firstTerminalAt = ev.at || ev.ts; break }
        }
      } catch { /* no timeline — the state file is what there is */ }
    }
    out.push({
      id,
      name: s.name ?? '',
      state: s.state ?? '?',
      tempo: s.tempo ?? '',
      detail: s.detail ?? '',
      needs: s.needs ?? '',
      updatedAt: s.updatedAt ?? null,
      firstTerminalAt,
      children: s.children || [],
    })
  }
  return out
}

/**
 * Ready work, counted for the idle detection.
 *
 * A milestone is the program's own definition of ready: no work starts on an issue
 * until one is assigned. Requirements are containers rather than work, so they are
 * excluded — counting them would make the queue look permanently full and the
 * detection permanently on.
 */
export function readyBacklog(data) {
  const open = data?.repository?.openIssues ?? {}
  const count = (open.nodes ?? []).filter((i) => i?.milestone)
    .filter((i) => !(i.labels?.nodes ?? []).some((l) => l?.name === 'requirement'))
    .length
  // The page is 100 wide and the hub already carries 97 open issues. A count that
  // silently stops at the page boundary would read as the whole queue, so a capped
  // read says so and the number becomes a floor.
  return { count, capped: Boolean(open.pageInfo?.hasNextPage) }
}

/** Workers whose closeout already carries a verdict, from the append-only journal. */
export function judgedWorkers(journalText = '') {
  const out = new Set()
  for (const raw of String(journalText).split('\n')) {
    if (!raw.trim()) continue
    try {
      const r = JSON.parse(raw)
      if (r.op === 'verdict' && r.worker) out.add(String(r.worker))
    } catch { /* a torn line is not a reason to drop the rest */ }
  }
  return out
}

/**
 * Is anything listening?
 *
 * The listener writes this file every twenty seconds. A stale one means the
 * Navigator has no Monitor armed and the wakes below are being written to a log
 * nobody is reading — which must be said out loud, because it is otherwise
 * indistinguishable from a quiet fleet.
 */
export function listenerState(path, now = new Date(), { stat = statSync } = {}) {
  try {
    const age = (now.getTime() - stat(path).mtimeMs) / 60000
    return age <= LISTENER_STALE_MIN
      ? { armed: true, ageMin: age, summary: `wake channel: armed — listener seen ${Math.round(age * 60)}s ago` }
      : { armed: false, ageMin: age, summary: `**WAKE CHANNEL DOWN** — nothing has listened for ${Math.round(age)}m; wakes are being written and not delivered. Arm it: Monitor \`obot.agent/tools/navigator/wake-listen\`, persistent` }
  } catch {
    return { armed: false, ageMin: null, summary: '**WAKE CHANNEL DOWN** — no listener has ever run; wakes are being written and not delivered. Arm it: Monitor `obot.agent/tools/navigator/wake-listen`, persistent' }
  }
}

/** The host was suspended between sweeps — its fleet is not stalled, it was away. */
export function hostWasAway(prevSweptIso, now = new Date()) {
  const gap = minsSince(prevSweptIso, now)
  return gap !== null && gap > SUSPEND_GAP_MIN
}

// ---- the section the sweep folds into navigator-state.md --------------------

/**
 * Verdict first, then the channel, then the bounds, then the list.
 *
 * Every line above the list is UNINDENTED on purpose. The dashboard's reader treats
 * an indented line as the detail of the line above it, and a detail carries no alarm
 * flag — so `WAKE CHANNEL DOWN` written as a sub-line would reach the page as small
 * print under a headline that says everything is fine. That is obot.agent#129 for
 * the third time (verdict swallowed, detail kept), and the one alarm here that must
 * never be quiet is the one saying the alarms are not being delivered.
 */
export function wakeSection({ pending = [], delivered = [], held = [], listener = null, awayNote = null, outside = 0, jobsRead = true } = {}) {
  const lines = ['## Wake — workers that stopped', '']
  // Every detector here reads `~/.claude/jobs`. With no ledger on the machine the
  // pending list is empty because nothing was looked at, and "clear — every worker
  // that stopped has been judged" is the strongest possible claim built on the
  // weakest possible evidence (jwildfire/obot.roadmap#223).
  lines.push(!jobsRead
    ? 'wake: **NO READING** — there is no job ledger on this machine, so no worker\'s stop-state has been looked at. This is not a clear channel; it is an unwatched one.'
    : pending.length
      ? `wake: **${pending.length} unresolved stop-state${pending.length === 1 ? '' : 's'}** — ${delivered.length} delivered this sweep`
      : 'wake: clear — every worker that stopped has been judged, and no worker is stalled or waiting')
  if (listener) lines.push(listener.summary)
  if (awayNote) lines.push(awayNote)
  if (outside) lines.push(`bounded: ${outside} unjudged closeout(s) older than ${WAKE_WINDOW_HOURS}h are not woken for — judge them from the delivery record, not from here`)
  if (pending.length) {
    lines.push('', '### Pending', '')
    for (const d of pending) {
      const state = delivered.some((x) => x.key === d.key)
        ? 'delivered'
        : (held.find((x) => x.key === d.key)?.why ?? 'pending')
      // No markdown emphasis on the state: the dashboard's reader strips `*` and
      // backticks but not underscores, so an italicised tail arrives on the page as
      // literal underscores. Plain text renders correctly on both surfaces.
      lines.push(`- ${d.kind.toUpperCase()} ${d.line} · ${state}`)
    }
  }
  return lines.join('\n') + '\n'
}
