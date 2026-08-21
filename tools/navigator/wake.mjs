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
// The admiral is the second kind and was excluded as if it were the first,
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
import { isForeignRole, mustExit, roleOf } from '../lib/roles.mjs'

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

/**
 * THREE STATES, AND NOTHING MAY COLLAPSE TWO OF THEM (obot.agent#157).
 *
 * The channel woke the Navigator three times in nine minutes of being armed, for the
 * same three workers — `DEAD W0009`, `WAITING W0007`, `WAITING W0008` — and would
 * have kept waking for them for as long as their job records sat on this machine,
 * because nothing about them could change. All three had carried a verdict since
 * 21:31 the previous evening. Measured against the real log afterwards: 7 of the 97
 * stop-state wakes ever delivered went out for a worker that already had one, and
 * `dead:63b5b6fb` went out seven times across sixteen hours for a session that died
 * at 07:39 and could not come back.
 *
 * So every stop-state is in exactly one of three states, and the whole fix is
 * keeping them apart:
 *
 *   RESOLVED     a verdict exists in the delivery record, recorded AFTER this
 *                stop-state began. It never wakes anyone again. Counted and named
 *                in the section, because the verdict is the record and a reader
 *                must still be able to find it.
 *   LIVE         terminal and unjudged, or stuck for less time than anything on
 *                this machine has ever taken to come back. It keeps waking on its
 *                floor. That is the channel working and it is not to be quietened.
 *   STANDING     permanently unactionable — dead, or parked past the point where
 *                anything has ever resumed. Reported ONCE with what it needs, then
 *                never again, and never silently: it stays in the section under
 *                `### Standing` for as long as it is true.
 *
 * AFTER, and not merely "a verdict exists". W0049 is why. It was judged `confirmed`
 * at 06:22 on 2026-08-18, went on working, and was found parked at 06:55 — a wake
 * this channel was right to deliver, and which produced the `drift` verdict at
 * 07:59. An untimed verdict gate would have swallowed it. So the comparison is
 * against the instant this particular stop-state began (`d.at`), which for a
 * closeout is `firstTerminalAt` and for everything else is the last time the session
 * moved.
 */

/**
 * When a stop-state stops being something anybody can still resolve.
 *
 * MEASURED, and measured from the same corpus as the admiral's own bar rather than
 * from a second reading: of every span a worker on this machine spent blocked and
 * then RESOLVED, the longest was 106 minutes and the next longest 80. Every block
 * that ran past that was never resolved at all — 21h, 21h, 22h, a day — and had to
 * be closed by hand. 180 minutes therefore sits above every recovery ever recorded
 * here and below every observed failure.
 *
 * Held equal to `ACT_MIN.waiting` in admiral.mjs by intent rather than by import,
 * exactly as `TRIGGERED_QUIET_MIN` is: admiral.mjs imports this file, so the
 * dependency cannot run the other way. The two numbers being the same is the point.
 * The admiral is the thing that ACTS on a stuck session at 180 minutes; past that
 * bar the wake has handed the condition on, and repeating it is asking a reader to
 * do a second time what an actor is already doing.
 *
 * It is NOT applied to `stopped`. See `RETIRES` below.
 */
export const RETIRE_MIN = 180

/**
 * The kinds a retirement may silence — every stop-state except the closeout.
 *
 * HOW THIS INTERACTS WITH THE BOUND THAT ALREADY EXISTS, because a channel with two
 * different notions of "stop waking for this" and no stated relationship between
 * them is worse than one with none. `WAKE_WINDOW_HOURS` reads on `firstTerminalAt`
 * and therefore only ever touches `stopped`; this set deliberately excludes
 * `stopped`. The two are disjoint by construction: no stop-state can be suppressed
 * by both, no closeout is ever retired, and `outsideWindow`'s count and the standing
 * list can never describe the same thing twice. `wake.test.mjs` holds that.
 *
 * The bound is therefore untouched — not widened, not lengthened, not extended to a
 * new kind. Making an unjudged closeout quieter is the failure this fix would be
 * trading for, and `stopped` keeps nagging until a verdict silences it.
 */
export const RETIRES = new Set(['dead', 'waiting', 'stalled', 'wedged'])

/**
 * The kinds whose onset is a liveness clock, and therefore the kinds where "has this
 * been judged" has to mean "judged SINCE this began".
 *
 * The same set as `RETIRES` and for the same underlying reason rather than by
 * coincidence: these are the readings taken from `updatedAt`, which moves. A closeout
 * is not one of them — see `judgedSince` for the measurement that settles it.
 */
export const TIMED_VERDICT = RETIRES

/** Quiet-for, in minutes, before a tempo=active worker counts as stalled. */
export const STALL_MIN = 30
/** Grace before a worker waiting on a human is called unresolved. */
export const WAITING_GRACE_MIN = 10
/**
 * One more sweep before a `waiting` reading is believed — obot.agent#176.
 *
 * The discriminator above needs time to be true. A session misread as blocked has
 * not yet contradicted the record at the instant it is misread: W0033's fabricated
 * block was written at 07:16:18.954Z and its next entry came at 07:29:15.879Z, and
 * the wake fired at 07:28:40.973Z — thirty-five seconds too early to know. So the
 * first sighting is held for one sweep and re-read, which is the whole difference
 * between a discriminator that works retrospectively and one that works.
 *
 * FIVE MINUTES because that is the sweep's own period, from
 * `com.obot.navigator-sweep.plist` (`StartInterval` 300). Measured against every
 * blocked entry on this machine that was followed by a resume: 48 of them, median
 * 1.4 minutes, p75 4.4, p90 30.9. Fifteen minutes of total quiet therefore sits
 * above 83% of every resume ever recorded here and far below the genuine article —
 * the real stalls in this corpus ran 20 and 21 hours. The eight resumes slower than
 * this belong almost entirely to prime and the Navigator, which rest by design and
 * are not watched.
 *
 * The cost is named rather than hidden: a genuine wait is reported about four
 * minutes later than before. W0021, W0024 and W0031.1 each fired at 11 to 13
 * minutes and were all real. Four minutes against a session's work is the trade this
 * whole gate is, and it is the one the requirement asks for.
 */
export const WAITING_SETTLE_MIN = 5
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
 * Held equal to `ADMIRAL_TTL_MIN` in admiral.mjs by intent rather than by import —
 * admiral.mjs imports this file, so the dependency cannot run the other way.
 */
export const TRIGGERED_QUIET_MIN = 30

/**
 * Per-kind floor between repeat wakes for the same thing.
 *
 * An unjudged closeout keeps nagging, because that is the backlog the whole role
 * exists to clear — it stops when a verdict is recorded, which is the correct
 * silencer. The floors keep that from being a wake every five minutes.
 *
 * `unapplied` is the same argument about one of his own decisions
 * (jwildfire/obot.roadmap#241) and is deliberately NOT a once-only kind. A finish is
 * an event and repeating it teaches him to ignore the channel; an answer he clicked
 * that nothing has applied is a condition that stays true until an agent acts, and
 * the nine hours of 2026-08-16 are exactly what one silent delivery buys. Its
 * silencer is `ops-answers apply`, and nothing else.
 */
// `stall` is stallwatch.mjs's kind and its floor lives here rather than there, because
// `deliverable()` reads this table and a second table is how one channel comes to have
// two answers for the same key. Fifteen rather than sixty: an open prompt is a
// condition nothing clears on its own, and the whole finding is that it is expensive
// to leave standing (obot.agent#317).
export const REWAKE_MIN = { stopped: 30, stalled: 60, waiting: 60, dead: 60, wedged: 60, idle: 45, delivered: 1440, unapplied: 60, stall: 15 }

/**
 * Kinds where the event is the whole condition, so one wake is the whole delivery.
 *
 * Every other kind repeats on a floor because the condition persists until somebody
 * acts: a closeout that is unjudged now is still unjudged in an hour, and the nagging
 * is the point. A COMPLETION is done. Repeating it would turn the one channel that
 * reaches a person into the thing he learns to ignore, which is how the delivery path
 * this kind was added for (jwildfire/obot.roadmap#257) would fail a second time.
 *
 * The floor above stays anyway rather than being dropped: a kind with no REWAKE_MIN
 * entry silently inherits `?? 60` below, and if the once-only rule were ever narrowed
 * the fallback should be a day rather than an hour.
 */
export const ONCE_KINDS = new Set(['delivered'])

/** Wakes delivered per run. The overflow is reported, never hidden. */
export const MAX_WAKES_PER_RUN = 3

/** How many resolved workers the section names before it points at the record instead. */
export const RESOLVED_NAMES = 6

/**
 * A worker that died rather than one waiting for an answer.
 *
 * Both land in `blocked`; only the message separates them. Every signature here was
 * taken from a real job record on this machine — an invented list would be the
 * difference between "the worker is dead" and "the worker asked you something",
 * which is the one distinction this module cannot afford to guess at.
 */
export const DEATH = /API Error|API unavailable|Connection refused|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|can't reach the api|rate.?limit|Internal server error|heap out of memory/i

/**
 * A status detail that is structurally a comment, and therefore not a status.
 *
 * obot.agent#177. The sibling briefing's opening `<!-- how to use: … -->` is the
 * first text in the prompt a spawned session receives, which is exactly the position
 * a classifier samples, so it arrived in `intent` and then in four timeline entries
 * as the session's `detail` — one of them re-asserting `blocked` forty-five seconds
 * before a clean close-out. The template no longer ships it, which removes the class
 * at source; this is the guard for everything the template does not control, because
 * the field is written by the harness and read by the Agents tab, and a row whose
 * task tag reads "how to use: this is the briefing…" displaces what the session is
 * actually doing on a surface @jwildfire reads.
 *
 * Empty is the right answer rather than a truncation: the value carries nothing
 * about the session, and every consumer already has a rendering for a missing detail.
 */
export const isBoilerplateDetail = (s) => /^\s*<!--/.test(String(s ?? ''))
export const scrubDetail = (s) => (isBoilerplateDetail(s) ? '' : String(s ?? ''))

/**
 * Why a `blocked` reading is a misreading — or null, when it is to be believed.
 *
 * obot.agent#176. The harness derives this state from the session's own prose, so a
 * sentence describing an action somebody ELSE has to take is read as this session
 * being blocked on it. On 2026-08-17 that put W0033 on the wake channel as "waiting
 * 12m and nobody has resolved it", five minutes after the same session had stamped a
 * terminal result, while it was in fact reviewing a peer's follow-up. The admiral had
 * gone live an hour earlier and closes sessions on that signal.
 *
 * BOTH discriminators, and both are already in the append-only timeline:
 *
 *   D1  a terminal result was stamped BEFORE the block   → it had already finished
 *   D2  the session emitted something AFTER the block    → it went on working
 *
 * They are ANDed, and the conjunction is load-bearing rather than cautious. D1 alone
 * describes W0007 exactly — closed out at 08:13 and then stuck twenty hours on a real
 * permission prompt with nothing after it — which is the failure this whole channel
 * was built for, and `wake.test.mjs` has carried that record as a fixture since the
 * channel was written. Suppressing on D1 alone would trade obot.agent#176 for the bug
 * that preceded it. What separates the two is D2 and only D2: one of them moved again
 * and the other never did.
 *
 * The consequence is deliberate and worth stating: at the instant a block first
 * appears, D2 cannot yet be true, so the wake still fires and a person still glances
 * at it. What the gate protects is the ACTING path — the admiral acts at 180 minutes,
 * by which time a session that kept working has said so in the record. That is the
 * failure in the safe direction the requirement asks for: leaving a stalled session
 * open costs one cycle, and closing a working one costs its work.
 */
export const blockedSince = (job) => (job?.state === 'blocked' && job?.lastBlockedAt) || job?.updatedAt || null

/**
 * It emitted something after the block, so it was working through it.
 *
 * THE discriminator, and the only one. `firstTerminalAt` was the obvious second
 * candidate and it is refuted by the record: it is a first-write-wins watermark the
 * harness never resets, so it says "this session has EVER closed out", never "this
 * session's current run is finished". 31 of the 113 job records on this machine
 * produced timeline activity after it. Worse, it is TRUE for W0007 — which closed
 * out at 08:13, was resumed four minutes later, and then sat twenty hours on a real
 * permission prompt until a person stopped it. Ordering against that watermark puts
 * the false case at +5.2 minutes and the true one at +71.8: same sign, and the true
 * one further out. There is no threshold on it that works, in either direction, and
 * it is not used here at all — not to suppress, and not to annotate, because an
 * annotation would have printed CHECK IT FIRST on the realest stall in the corpus.
 *
 * Only when the block is the one the TIMELINE describes. A block that lives in
 * `tempo` alone — which is every real permission prompt in these records, W0007 and
 * W0008 included, neither of which wrote a `blocked` entry at all — has no entry to
 * measure "after" from, so the timeline cannot refute it and this returns false.
 *
 * And the anchor is the LAST blocked entry, never the first. W0021 sat genuinely
 * stuck through a three-entry blocked run; anchoring on the run's start would read
 * the second and third entries as it coming back to life, and one of those entries
 * is the obot.agent#177 template comment — which would make one bug disarm the gate
 * for the other.
 */
export function movedThroughBlock(job) {
  if (job?.state !== 'blocked' || !job?.lastBlockedAt) return false
  const moved = Date.parse(job?.movedAfterBlockedAt ?? '')
  return !Number.isNaN(moved) && moved > Date.parse(job.lastBlockedAt)
}

export function misreadBlocked(job) {
  if (!movedThroughBlock(job)) return null
  return `it moved again at ${job.movedAfterBlockedAt}, after the blocked entry at ${job.lastBlockedAt} — the state was derived from its own prose, not from a pending prompt`
}

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
// alone is what an admiral detection would otherwise read as, which is the least
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
export function classify(job, now = new Date(), { hostWasAway = false, workspace = null } = {}) {
  // Workers, and roles that must exit inside a budget. A role that RESTS when idle
  // is skipped — and it is skipped for that reason, never for being on the list of
  // roles @jwildfire pins, which is the conflation that lost the admiral.
  //
  // A session wearing a role's name from OUTSIDE this workspace is not that role and
  // has no budget here, so it is not a budgeted job (obot.agent#188). Four fixture
  // admirals in `mkdtemp` workspaces produced four WAITING detections this way, on a
  // channel whose whole value is that a detection means something. Where the record
  // says nothing — no cwd, or no workspace given — the name is trusted exactly as
  // before, because a detector that goes quiet on a missing field is worse than one
  // that occasionally speaks up.
  const budgeted = mustExit(job?.name) && !isForeignRole(job, { workspace })
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

  // Is this `blocked` reading a reading at all? Both branches below rest on a state
  // the harness derives from the session's own prose, and one of them reaches the
  // admiral in an hour and the other in three (obot.agent#176). The check sits above
  // both rather than inside either, because a fabricated death and a fabricated block
  // are the same defect one word apart.
  const misread = (job.state === 'blocked' || job.tempo === 'blocked') && !terminal
    ? misreadBlocked(job)
    : null
  if (misread) {
    out.push({
      kind: 'misread',
      key: `misread:${job.id}`,
      job: job.id,
      worker: label(job),
      at: job.updatedAt,
      line: `${label(job)} reads ${job.state}/${job.tempo} but ${misread}`,
    })
  }

  // Death first: a dead worker is also, technically, quiet and blocked. Reporting it
  // as "waiting for an answer" would send the Navigator to answer a corpse.
  if (!misread && !terminal && job.state === 'blocked' && DEATH.test(said)) {
    out.push({
      kind: 'dead',
      key: `dead:${job.id}`,
      job: job.id,
      worker: label(job),
      at: job.updatedAt,
      line: `${label(job)} died — ${clip(job.detail || job.needs || 'no detail', 120)} · quiet ${quiet === null ? '?' : Math.round(quiet)}m · its own record understates what it wrote, so check GitHub for a branch or PR before writing it off`,
    })
  } else if (!misread && !terminal && (job.state === 'blocked' || job.tempo === 'blocked') && job.needs &&
             quiet !== null && quiet >= (hostWasAway ? Infinity : WAITING_GRACE_MIN)) {
    // Held on the first sighting, believed on the second. `settling` is not a kind
    // anything acts on and not a kind anything is woken for; it exists so that a
    // detection which was raised and then withdrawn leaves a trace, because the
    // alternative is a channel that is silent for two different reasons.
    const settled = quiet >= WAITING_GRACE_MIN + WAITING_SETTLE_MIN
    if (!settled) {
      out.push({
        kind: 'settling',
        key: `settling:${job.id}`,
        job: job.id,
        worker: label(job),
        at: job.updatedAt,
        line: `${label(job)} reads blocked after ${Math.round(quiet)}m — held one sweep and re-read before anyone is woken, because a session misread as blocked has not yet contradicted the record at the instant it is misread (obot.agent#176)`,
      })
    }
    else out.push({
      kind: 'waiting',
      key: `waiting:${job.id}`,
      job: job.id,
      worker: label(job),
      at: job.updatedAt,
      line: `${label(job)} has been waiting ${Math.round(quiet)}m and nobody has resolved it — needs: ${clip(job.needs, 120)} · its record was re-read ${WAITING_SETTLE_MIN}m after the first sighting and had not moved`,
    })
  } else if (!misread && !terminal && job.tempo === 'active' && quiet !== null &&
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
  // admiral.mjs catches the admiral still RUNNING past its budget, this catches the
  // one that has STOPPED and will never exit.
  // `misread` deliberately does not count toward `out.length`. A budgeted role has no
  // `stopped` detection to fall back on, so if a suppression counted as a detection
  // the one safety net under a manager that really has stopped would switch itself
  // off exactly when the record had just been shown to be unreliable.
  if (budgeted && !terminal && !out.some((d) => !['misread', 'settling'].includes(d.kind)) && quiet !== null &&
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
 * Has this worker been judged since this particular stop-state began?
 *
 * Returns the verdict key and when it was recorded, or null.
 *
 * THE CLOCK IS ONLY ASKED ABOUT THE KINDS WHOSE ONSET IS A CLOCK, and that
 * distinction was learned from the machine rather than reasoned out. `stopped`
 * begins at `firstTerminalAt`, and the ordering there is not what it looks like:
 * across the 118 closeouts on this machine that can be joined to a verdict, 16 of
 * them — 14% — carry a verdict recorded BEFORE the watermark it judges, with a
 * median lead of 4 minutes and a worst case of 23 hours. Both halves have plain
 * explanations. The Navigator judges a worker's close-out REPORT, and the harness
 * stamps the watermark when the process actually goes terminal a few minutes later;
 * and where a session had to be stopped by hand — W0002, W0008, W0009 — the
 * watermark lands at the stop, hours after the verdict. Timing this gate would
 * therefore have resurrected every judged closeout on the machine into a permanent
 * nag: measured live, it turned a pending list of 0 into one of 4 and would have
 * grown with every worker judged from then on.
 *
 * It is also unnecessary there. `firstTerminalAt` is a first-write-wins watermark
 * the harness never resets, so a worker has exactly one of them and a verdict for
 * that worker can only ever be about that one closeout. There is no second episode
 * to confuse it with, which is precisely what there IS for the liveness kinds: their
 * onset is `updatedAt`, which moves every time the session does, so a verdict from
 * this morning can predate an entirely new stop-state this afternoon. That is
 * W0049 on 2026-08-18, and it is why those kinds are timed.
 *
 * `judgedAt` is optional and its absence is the OLD behaviour exactly: any verdict
 * at all resolves. That fallback is deliberate rather than lazy — a caller holding
 * only the set of judged names (the admiral, every test written before this) must
 * not have its suppression silently switched off by a field it does not pass.
 */
export function judgedSince(job, d, judged = new Set(), judgedAt = null) {
  const key = verdictKeys(job).find((k) => judged.has(k))
  if (key === undefined) return null
  const at = judgedAt?.get?.(key)
  if (at === undefined || at === null) return { key, at: null }
  if (!TIMED_VERDICT.has(d?.kind)) return { key, at }
  const began = Date.parse(d?.at ?? '')
  // An unparseable onset cannot order anything, so it falls back to resolving — the
  // same direction as a missing `judgedAt`, and for the same reason.
  if (Number.isNaN(began) || at >= began) return { key, at }
  return null
}

/**
 * Why this stop-state can never produce a new fact — or null while it still can.
 *
 * The two shapes, and they are different in kind rather than in degree:
 *
 *   DEAD is unactionable at the instant it is detected. A session that died on an
 *   API error is not slow, it is over; there is no hour at which it becomes more
 *   likely to come back. One report is the whole delivery.
 *
 *   WAITING / STALLED / WEDGED are unactionable only once the clock says so. A
 *   prompt opened four minutes ago may well be answered, so the channel keeps
 *   waking. Past RETIRE_MIN nothing on this machine has ever come back, and nobody
 *   can answer a prompt inside somebody else's session anyway (obot.agent#315: the
 *   message queue of a parked session never drains).
 *
 * `stopped` is absent on purpose and the omission is load-bearing. A closeout with
 * no verdict is the backlog the whole role exists to clear, and it is actionable
 * forever — the action is to judge it. It is bounded by WAKE_WINDOW_HOURS and by
 * nothing else.
 */
export function unactionable(d, job, now = new Date()) {
  if (!RETIRES.has(d?.kind)) return null
  if (d.kind === 'dead') {
    return 'a dead session\'s record is terminal — it will never produce another fact, so the death is reported once and then stands'
  }
  const quiet = minsSince(job?.updatedAt, now)
  if (quiet === null || quiet < RETIRE_MIN) return null
  return `it has not moved for ${Math.round(quiet)}m — nothing on this machine has ever resumed past ${RETIRE_MIN}m, and a prompt inside another session is one nobody else can answer`
}

/**
 * The standing form of a detection: same reading, different ask.
 *
 * Its own KEY (`standing:…`) rather than the detection's, because the ask has
 * changed and the log is the record of what was asked. A `waiting` worker was woken
 * for three times to say "somebody resolve this"; the standing line says "nobody is
 * going to, so stop it and judge what it produced" — a different action, and one
 * that must reach the Navigator once even though the underlying key has been in the
 * log for hours.
 *
 * `once: true` is read by `deliverable`, which suppresses on the log entry rather
 * than on a clock. That is what makes the retirement RECORDED rather than implied by
 * silence: `grep ' WAKE standing:' navigator-wake.log` is the permanent, timestamped
 * list of everything this channel has ever stopped waking for, and why.
 */
export function standingWake(d, why) {
  return {
    ...d,
    once: true,
    key: `standing:${d.key}`,
    why,
    line: `${d.line} · ${why} — stop the session if it is still up, then judge what it produced against GitHub and record it with delivery-log`,
  }
}

/**
 * Every stop-state across the fleet, split three ways (obot.agent#157).
 *
 * `live` is what wakes anyone. `resolved` and `standing` are what does not, and both
 * are RETURNED rather than dropped: a suppression that produces no output is
 * indistinguishable from a gate that never ran, and the section prints both counts.
 *
 * Order matters and is not arbitrary. RESOLVED is tested first because a verdict
 * outranks everything — a judged worker is finished business whether or not it is
 * also permanently stuck, and reporting it as standing would ask for an action that
 * has already been taken. STANDING is tested second, so a live detection is what is
 * left over rather than what was selected: a new kind added to `classify` tomorrow
 * lands in `live` and wakes somebody, which is the safe direction for this file to
 * fail in.
 */
export function triage(jobs = [], { now = new Date(), judged = new Set(), judgedAt = null,
                                    hostWasAway = false, workspace = null } = {}) {
  const live = []
  const resolved = []
  const standing = []
  for (const job of jobs) {
    for (const d of classify(job, now, { hostWasAway, workspace })) {
      // Nobody is woken to look at a state that was never real. It is counted in the
      // section instead, which is where a suppression belongs: visible, and not a
      // notification (obot.agent#176).
      if (d.kind === 'misread' || d.kind === 'settling') continue
      const v = judgedSince(job, d, judged, judgedAt)
      if (v) {
        resolved.push({ ...d, verdictKey: v.key, verdictAt: v.at })
        continue
      }
      const why = unactionable(d, job, now)
      if (why) {
        standing.push(standingWake(d, why))
        continue
      }
      live.push(d)
    }
  }
  const newestFirst = (a, b) => Date.parse(b.at ?? 0) - Date.parse(a.at ?? 0)
  return { live: live.sort(newestFirst), resolved: resolved.sort(newestFirst), standing: standing.sort(newestFirst) }
}

/**
 * The pending set — what still wakes somebody.
 *
 * Kept as its own name because it is what every caller and every test asks for, and
 * because "pending" is the honest word for it: these are the stop-states with an
 * action still outstanding that somebody can still take.
 */
export function pending(jobs = [], opts = {}) {
  return triage(jobs, opts).live
}

/**
 * The blocked readings this sweep refused to believe.
 *
 * Separate from `pending` on purpose. A suppression that produces no output is
 * indistinguishable from a gate that never ran, and this programme has shipped that
 * failure often enough to name it: the sweep reports the count next to the pending
 * list, and the list itself is unaffected.
 */
export function misreadHolds(jobs = [], { now = new Date(), hostWasAway = false, workspace = null } = {}) {
  return jobs.flatMap((job) => classify(job, now, { hostWasAway, workspace })
    .filter((d) => d.kind === 'misread' || d.kind === 'settling'))
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
    // Once-only first, and on the KEY rather than on the clock: the log is
    // append-only and holds days, so a key that appears in it at all has already
    // reached a person and never goes out again however long ago that was.
    const deliveredAt = last.get(d.key)
    if (ONCE_KINDS.has(d.kind) && deliveredAt !== undefined) {
      held.push({ ...d, why: 'already delivered — a finish is an event, not a nag' })
      continue
    }
    // `d.once` is the same rule for a retirement (obot.agent#157) with one addition
    // it cannot do without: the suppression is anchored to the detection's own onset.
    //
    // A retirement key is per JOB, and a job can be stuck, come back, and be stuck
    // again — the second episode is genuinely new and must wake somebody, which an
    // unanchored key would gag for the rest of the machine's life. So the hold stands
    // only when the log entry is at or after the instant this reading began; a later
    // onset is a later episode and goes out.
    //
    // It is NOT applied to ONCE_KINDS above. `delivered` means an issue closed, and
    // its `at` is the closure time rather than a liveness clock; the rule there is
    // deliberately "ever, however long ago" (jwildfire/obot.roadmap#257) and this is
    // not the change that gets to reopen it. An unparseable onset falls back to the
    // same unanchored behaviour rather than to a burst.
    if (d.once && deliveredAt !== undefined) {
      const began = Date.parse(d.at ?? '')
      if (Number.isNaN(began) || deliveredAt >= began) {
        held.push({ ...d, why: 'already delivered — it is standing, and standing is reported once' })
        continue
      }
    }
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
 * What it CANNOT add is `status`, and that is worth stating here because the field is
 * repeatedly assumed to be in these records: no job record on this machine carries the
 * key at all. `status` lives only in the live daemon view `claude agents --json`, and it
 * is the one field that separates a session at a real permission prompt from one a
 * classifier read as blocked out of its own prose. stallwatch.mjs joins the two.
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
    // The timeline is the only append-only record here, and the gate in
    // `misreadBlocked` rests entirely on it: the state file holds one snapshot and
    // therefore cannot say whether a session moved AFTER it went blocked. It is read
    // once, here, for every job — a second reader is how two halves of this detector
    // would come to disagree about the same session.
    let events = null
    try {
      events = read(`${dir}/${id}/timeline.jsonl`, 'utf8').trim().split('\n')
        .map((l) => { try { return JSON.parse(l) } catch { return null } })
        .filter((e) => e && (e.at || e.ts))
    } catch { /* no timeline — the state file is what there is */ }
    if (!firstTerminalAt && s.state === 'done' && events) {
      const first = events.find((e) => ['done', 'blocked', 'failed'].includes(e.state || e.type))
      if (first) firstTerminalAt = first.at || first.ts
    }
    // The block a detection would be about is the LAST one, never the first. A worker
    // that was misread hours ago, worked on, and is genuinely stuck now must not be
    // suppressed by activity that happened before its current block.
    let lastBlockedAt = null
    let movedAfterBlockedAt = null
    // The newest thing this session did, whatever it was. `updatedAt` in the state
    // file usually agrees, but the timeline is the record that cannot be rewritten,
    // and every check that asks "did it move after X" has to ask the same file.
    const lastActivityAt = events?.length ? (events[events.length - 1].at || events[events.length - 1].ts || null) : null
    if (events) {
      for (const e of events) {
        const at = e.at || e.ts
        if ((e.state || e.type) === 'blocked') { lastBlockedAt = at; movedAfterBlockedAt = null }
        else if (lastBlockedAt) movedAfterBlockedAt = at
      }
    }
    out.push({
      id,
      name: s.name ?? '',
      state: s.state ?? '?',
      tempo: s.tempo ?? '',
      // Scrubbed at the boundary rather than at each render site (obot.agent#177):
      // there are several surfaces and one reader, and a rule applied in one place
      // cannot be forgotten in the next one somebody adds.
      detail: scrubDetail(s.detail),
      needs: scrubDetail(s.needs),
      updatedAt: s.updatedAt ?? null,
      firstTerminalAt,
      lastBlockedAt,
      movedAfterBlockedAt,
      lastActivityAt,
      // Where the session actually ran. The one field that can tell this
      // workspace's role from something else wearing its name (obot.agent#188): a
      // name is a claim, a working directory is a fact, and all 110 records on this
      // machine carry one.
      cwd: s.cwd ?? null,
      // The session id, so a reading that has only that can still find this record.
      // `claude agents --json` carries `id` for every background session and
      // `sessionId` for every session there is, and stallwatch.mjs joins on the first
      // and falls back to the second (obot.agent#317).
      sessionId: s.sessionId ?? null,
      // Messages sent to this session that it has not read. On a session parked at a
      // permission prompt this number never falls: the queue drains at the receiver's
      // next turn boundary, and a prompting session's next turn boundary is the
      // permission decision itself, so whatever is counted here dies with the session
      // (obot.agent#315, docs/session-reachability.md). Read here rather than in a
      // second reader of the same files, for the reason at the top of this function.
      //
      // It is a FLOOR and not the count, and the difference bites exactly where it
      // matters: this file is only rewritten when the session publishes state, and a
      // session parked at a prompt publishes nothing, so the number frozen here is
      // whatever was true before the prompt opened — measured 2026-08-21 as 0 on a
      // session with a message provably sitting in its queue. stallwatch.mjs takes the
      // larger of this and what the append-only transcript says.
      queued: s.inFlight?.queued ?? 0,
      // Where that transcript is. The harness records every cross-session message as a
      // `queue-operation` entry there, which is the only record of one that a frozen
      // state file cannot understate.
      transcript: s.linkScanPath ?? null,
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
 * WHEN each of those workers was last judged — the other half of the same read.
 *
 * A Set answers "has this worker ever been judged", which is the wrong question by
 * one word (obot.agent#157). W0049 was judged `confirmed` at 06:22 on 2026-08-18,
 * carried on working, and was found parked at 06:55; that wake was right and it
 * produced the `drift` verdict at 07:59. So the question is whether a verdict exists
 * SINCE this stop-state began, and that needs a clock.
 *
 * LAST rather than first, deliberately. The record is append-only and corrections
 * are written as new lines — W0009 and W0049 each carry one — so the most recent
 * verdict is the current state of the Navigator's opinion, and it is the one that
 * can be after a given onset.
 *
 * Returned as a separate Map rather than folded into `judgedWorkers`, because that
 * function's Set is what the admiral and every existing caller reads, and a widened
 * return type is how a suppression quietly changes shape for a caller that never
 * asked for it.
 */
export function judgedAt(journalText = '') {
  const out = new Map()
  for (const raw of String(journalText).split('\n')) {
    if (!raw.trim()) continue
    try {
      const r = JSON.parse(raw)
      if (r.op !== 'verdict' || !r.worker) continue
      const t = Date.parse(r.at ?? '')
      if (Number.isNaN(t)) continue
      const k = String(r.worker)
      if (t > (out.get(k) ?? 0)) out.set(k, t)
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
export function wakeSection({ pending = [], delivered = [], held = [], listener = null, awayNote = null, outside = 0, jobsRead = true, misread = [], completions = [], completionsHeld = [], answers = [], answersHeld = [], resolved = [], standing = [] } = {}) {
  const lines = ['## Wake — workers that stopped, and what completed', '']
  // Every detector here reads `~/.claude/jobs`. With no ledger on the machine the
  // pending list is empty because nothing was looked at, and "clear — every worker
  // that stopped has been judged" is the strongest possible claim built on the
  // weakest possible evidence (jwildfire/obot.roadmap#223).
  //
  // And "clear" is refused a second way (obot.agent#157): a fleet with standing
  // stop-states is not a clear one, it is one whose remaining items nobody can act
  // on. Saying "clear" over the top of them is how the list would come to forget
  // quietly, which is worse than the repeating it replaces.
  lines.push(!jobsRead
    ? 'wake: **NO READING** — there is no job ledger on this machine, so no worker\'s stop-state has been looked at. This is not a clear channel; it is an unwatched one.'
    : pending.length
      ? `wake: **${pending.length} unresolved stop-state${pending.length === 1 ? '' : 's'}** — ${delivered.length} delivered this sweep`
      : standing.length
        ? `wake: nothing anyone can act on — no new stop-state this sweep; ${standing.length} standing below, each reported once already`
        : 'wake: clear — every worker that stopped has been judged, and no worker is stalled or waiting')
  if (listener) lines.push(listener.summary)
  // What the channel carried TO A PERSON this sweep (jwildfire/obot.roadmap#257).
  // Unindented like every verdict line here, and stated even when it is none: the
  // whole finding of 2026-08-20 was that the loop ran and closed inside the machine,
  // and a channel that never says how many of its lines ended at somebody is a
  // channel in which that can happen again unnoticed.
  if (completions.length) {
    lines.push(`completed: ${completions.length} finish${completions.length === 1 ? '' : 'es'} sent to the Navigator this sweep, each as the sentence rather than the number`)
    for (const c of completions) lines.push(`  ${c.line}`)
  }
  if (completionsHeld.length) {
    const fresh = completionsHeld.filter((c) => !/already delivered/.test(c.why ?? ''))
    if (fresh.length) lines.push(`held: ${fresh.length} completion(s) over this run's budget — they go out on the next sweep, nothing is dropped`)
  }
  // And what the channel carried about HIS OWN decisions (jwildfire/obot.roadmap#241).
  // The count only: the rows themselves are in the answers section, and printing them
  // twice would make one finding look like two. Stated here because a channel that
  // never says how many of its lines ended at somebody is a channel in which
  // 2026-08-16 happens again unnoticed.
  if (answers.length) {
    lines.push(`answers: ${answers.length} unapplied answer(s) of his woken to the Navigator this sweep — the rows are in the answers section below`)
  }
  if (answersHeld.length) {
    const fresh = answersHeld.filter((a) => !/floor/.test(a.why ?? ''))
    if (fresh.length) lines.push(`held: ${fresh.length} unapplied answer(s) over this run's budget — they go out on the next sweep, nothing is dropped`)
  }
  if (awayNote) lines.push(awayNote)
  if (outside) lines.push(`bounded: ${outside} unjudged closeout(s) older than ${WAKE_WINDOW_HOURS}h are not woken for — judge them from the delivery record, not from here`)
  // The two suppressions this channel makes on its own reading, both counted and
  // both NAMED (obot.agent#157). A wake list that quietly forgets is worse than one
  // that repeats, so neither of these is allowed to be a silence: `resolved` names
  // the workers whose verdicts are already in the delivery record, and `standing`
  // gets a heading and a row each below.
  //
  // Unindented like every other verdict line here. The dashboard's reader treats an
  // indented line as the detail of the line above it, and a suppression rendered as
  // small print under somebody else's headline is the same defect as not printing it.
  if (resolved.length) {
    // NAMED, but bounded at six. The delivery record is where a verdict is findable
    // and this line is not a second register of it — 31 names on one line, growing by
    // one per worker judged, would be the wall of text this whole fix is about,
    // arriving one line higher up the page than the list it was meant to shorten.
    const names = [...new Set(resolved.map((d) => `${d.worker} (${d.kind})`))]
    const shown = names.slice(0, RESOLVED_NAMES)
    const more = names.length > shown.length ? `, +${names.length - shown.length} more` : ''
    lines.push(`resolved: ${resolved.length} stop-state(s) carry a verdict and are not woken for — ${shown.join(', ')}${more} · every one of them is in the delivery record, which is where a verdict stays findable`)
  }
  if (standing.length) {
    lines.push(`standing: ${standing.length} stop-state(s) nothing can change — reported once each and not woken for again, listed below so the channel forgets nothing`)
  }
  // Unindented, like every line above the list: the dashboard's reader treats an
  // indented line as a detail of the one above it, and this is the line that says
  // how much of the channel's own reading was thrown away.
  if (misread.length) {
    const refused = misread.filter((d) => d.kind === 'misread')
    const settling = misread.filter((d) => d.kind === 'settling')
    const parts = []
    if (refused.length) parts.push(`${refused.length} refused as misread (the session moved again after the block, so the state came from its own prose): ${refused.map((d) => d.worker).join(', ')}`)
    if (settling.length) parts.push(`${settling.length} held one sweep to be re-read before anyone is woken: ${settling.map((d) => d.worker).join(', ')}`)
    lines.push(`held: ${parts.join(' · ')} — obot.agent#176. Nothing was closed on any of them.`)
  }
  const stateOf = (d) => (delivered.some((x) => x.key === d.key)
    ? 'delivered'
    : (held.find((x) => x.key === d.key)?.why ?? 'pending'))
  if (pending.length) {
    lines.push('', '### Pending', '')
    for (const d of pending) {
      // No markdown emphasis on the state: the dashboard's reader strips `*` and
      // backticks but not underscores, so an italicised tail arrives on the page as
      // literal underscores. Plain text renders correctly on both surfaces.
      lines.push(`- ${d.kind.toUpperCase()} ${d.line} · ${stateOf(d)}`)
    }
  }
  // BELOW the pending list, always, and that ordering is the whole point of the
  // issue this closes: a genuinely new stop-state has to be the first thing in the
  // section rather than the fourth. Standing rows are history that has not been
  // tidied away — they are here to be findable, not to be read first.
  if (standing.length) {
    lines.push('', '### Standing — nothing can change these; they are not woken for', '')
    for (const d of standing) lines.push(`- ${d.kind.toUpperCase()} ${d.line} · ${stateOf(d)}`)
  }
  return lines.join('\n') + '\n'
}
