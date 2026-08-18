// The only two things allowed to interrupt him, and the morning line
// (obot.agent#205, under jwildfire/obot.roadmap#238).
//
// Today there is no path from this program to @jwildfire's phone at all. The one
// wake channel that exists was built without one deliberately —
// tools/navigator/wake.mjs says so in its own comment: "the mechanism below was
// chosen partly because it has no path to him." That stays true. This is a
// SEPARATE lane, not a generalisation of it: a worker finishing should reach an
// officer, and only these two things should reach a person.
//
// THE OBVIOUS CONSTRUCTION PROVABLY CANNOT WORK, which is why this looks indirect.
// PushNotification is a harness tool — a script cannot call it — and it reaches a
// phone only when Remote Control is connected, while every scheduler-spawned
// session on this machine is deliberately unbridged (the sibling rule of
// 2026-08-15; none of the fleet or admiral job records carries a bridge). A
// cron-spawned sibling that pushes is exactly the shape that no-ops in silence.
//
// So the fold WRITES a payload and a bridged standing session already running
// RELAYS it. That starts no agent on a clock, so it moves no autonomy line, and
// it degrades honestly: with no listener there is no interruption, the briefing
// page still updates, and the fold says the push had no relay rather than
// reporting a delivery it cannot observe.
//
// NOT VERIFIED END TO END. Nobody has seen this reach a phone. What is unverified
// is precise: whether a bridged standing session is alive at the moment of the
// push, and whether PushNotification from that session reaches the device. The
// decision that asked for this said "the build must verify it", and the build
// cannot — PushNotification deliberately declines when he is at the terminal and
// reports that it skipped, so a success return proves nothing. The only evidence
// that counts is him saying the phone buzzed, on a run he did not start.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

export const PUSH_LOG = '.claude/fold/push.jsonl'
export const LISTENER_BEAT = '.claude/fold/push.listener'
export const BRIEFING_URL = 'jwildfire.github.io/obot.roadmap/reports/briefing/'

// A Monitor dies with its session, so this lane can be silently absent — which is
// the one failure mode it must never have. Three minutes is generous against a
// twenty-second beat and tight enough to catch a session that ended.
const LISTENER_STALE_MS = 3 * 60 * 1000

/**
 * New release candidates since the last fold, each with its demo or an honest
 * admission that it has none.
 *
 * The demo link is not in the sweep's own data — it comes from parsing the pull
 * request body, cached separately. An RC the cache knows nothing about is still
 * reported: dropping it would mean the one event class that is allowed to
 * interrupt him silently not doing so.
 */
export function rcReadyWithDemo(events, rcsLane = {}) {
  return (events ?? [])
    .filter((e) => e.type === 'rc-new')
    .map((e) => {
      const entry = rcsLane[`jwildfire/${e.ref}`] ?? rcsLane[e.ref] ?? {}
      const title = entry.title ?? e.ref
      // "demo owed" rather than linking the pull request and calling it a demo.
      // A small lie here costs the next push its credibility, and the credibility
      // of the push is the only thing this lane has.
      const tail = entry.demo ? ` · demo ${entry.demo}` : ' · demo owed'
      return { ref: e.ref, url: e.url ?? entry.url ?? null, line: `RC ready: ${title}${tail}` }
    })
}

/**
 * Every ACTIVE goal blocked at once — the escalation rc-framework already names
 * as the one case the morning read is too slow for.
 *
 * Vacuously true is refused: an empty registry is not "every goal is blocked",
 * and waking him for one would be the worst possible first use of this lane.
 */
export function allGoalsBlocked(goals, labelsOf) {
  const active = Object.entries(goals ?? {}).filter(([, g]) => g.status === 'active')
  if (!active.length) return { all: false, checked: 0, unknown: false, why: 'no active goals in the registry' }
  const blocked = []
  for (const [slug, g] of active) {
    let labels
    try {
      labels = labelsOf(g.issue)
    } catch (e) {
      return { all: false, checked: active.length, unknown: true, why: `could not read goal labels: ${String(e.message).split('\n')[0]}` }
    }
    if ((labels ?? []).includes('blocked')) blocked.push(slug)
  }
  return {
    all: blocked.length === active.length,
    checked: active.length,
    blocked,
    unknown: false,
    why: `${blocked.length} of ${active.length} active goals blocked`,
  }
}

/** The morning card: counts, one URL, and free to skip. */
export function composeMorning({ rcs = 0, decisions = 0, todos = 0 }) {
  const parts = []
  if (rcs) parts.push(`${rcs} RC${rcs === 1 ? '' : 's'}`)
  if (decisions) parts.push(`${decisions} decision${decisions === 1 ? '' : 's'}`)
  if (todos) parts.push(`${todos} todo${todos === 1 ? '' : 's'}`)
  // An empty queue composes nothing. Silence has to mean nothing needs him, or it
  // stops being credible — and a credible silence is what makes the push worth
  // keeping on.
  if (!parts.length) return null
  return `${parts.join(' · ')} — briefing: ${BRIEFING_URL}`
}

/**
 * Write a push for the relay to pick up.
 *
 * `delivered` is always false here, and that is the point: this function can
 * observe that it wrote a line and nothing more. Reporting a delivery it cannot
 * see is the failure this programme keeps finding.
 */
export function writePush(workspace, { kind, text, url = null, now = new Date() }) {
  const f = join(workspace, PUSH_LOG)
  mkdirSync(dirname(f), { recursive: true })
  appendFileSync(f, JSON.stringify({ at: now.toISOString(), kind, text, url }) + '\n')
  const listener = listenerAlive(workspace, { now })
  return { written: true, delivered: false, listener }
}

export function listenerAlive(workspace, { now = new Date() } = {}) {
  const f = join(workspace, LISTENER_BEAT)
  let beat
  try {
    beat = Date.parse(readFileSync(f, 'utf8').trim()) || statSync(f).mtimeMs
  } catch {
    return { alive: false, why: 'no listener has ever armed this lane' }
  }
  const age = now.getTime() - beat
  if (age > LISTENER_STALE_MS) {
    return { alive: false, why: `the push listener is stale — last beat ${Math.round(age / 60000)} min ago` }
  }
  return { alive: true, why: null }
}

export function ghLabels(repo, issue) {
  const out = execFileSync('gh', ['issue', 'view', String(issue), '-R', repo, '--json', 'labels', '--jq', '[.labels[].name]|join(",")'], {
    encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
  })
  return out.trim() ? out.trim().split(',') : []
}
