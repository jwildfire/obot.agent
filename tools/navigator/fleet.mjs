// fleet — the trigger conditions for the fleet manager (obot.agent#167, under
// jwildfire/obot.roadmap#236).
//
// The sweep detects; a short-lived manager acts and exits. This module is the
// detecting half: pure functions over job records and an open-PR listing, so the
// conditions can be proved in a test rather than trusted in production.
//
// WHY THIS EXISTS, and it is recorded plainly because smoothing it over would lose
// the lesson: it answers a failure of the Navigator as much as of the concierge.
// Twice in two days finished work stopped moving and @jwildfire found it both times
// — six stalled sessions, seven open operational pull requests, all visible the
// whole time in `claude agents` and on GitHub. Detection was never the problem.
// Action was. So nothing here is a better detector; it is a detector wired to a
// launch.
//
// THREE PROPERTIES THIS FILE EXISTS TO GUARANTEE:
//
// 1. THE TRIGGER IS A POSITIVE CONDITION, NEVER AN ABSENCE. "Nothing is running"
//    must not launch a manager, or a genuinely quiet system spawns one forever.
//    Every condition below is something that IS true of a named job or a named pull
//    request — never something that is missing. `triggers()` on an empty fleet
//    returns fired:false, and a test holds it there.
//
// 2. THE SWEEP MAKES THE CHEAP TEST; THE MANAGER MAKES THE EXPENSIVE ONE. A PR is a
//    candidate here on facts the sweep already has in hand — open, idle, not a
//    draft, not a release candidate, operational repo. Whether its checks are green,
//    whether a review requested changes, whether it closes an issue: that is a call
//    per pull request, far too much for something that runs every five minutes, and
//    it is the manager's bar to apply. A candidate is NOT a decision to merge.
//
// 3. IT DESCRIBES; IT DOES NOT JUDGE. A closeout with no verdict is reported as a
//    gap. Judging delivery stays the Navigator's — the delivery record is
//    deliberately single-writer for verdicts, and a second writer would make it
//    two-sourced, which is the defect this programme spent two days removing from
//    the decisions registry, the dashboard queue and the roadmap page.
//
// Detection of stop-states is NOT rebuilt here. wake.mjs (hub#212) already knows
// what waiting, stalled and dead look like, and every signature in it was taken
// from a real job record on this machine. This module raises the bar and nothing
// else: the wake notifies at 10-30 minutes, the manager acts at hours, because a
// notification that turns out to be premature costs a glance and a close that turns
// out to be premature destroys work.
import { classify, hostWasAway, isWorker, judgedWorkers, readJobs, verdictKeys,
         workerIdOf } from './wake.mjs'

export { hostWasAway, judgedWorkers, readJobs }

/** The manager's own session tag. Deliberately not a worker tag: a manager that
 *  its own detector reads as a worker would wake the Navigator about itself, and
 *  a later run would find it stalled and close it. */
export const MANAGER_TAG = '\u{1F6A6}\u{1F916}' // 🚦🤖
export const MANAGER_NAME = `${MANAGER_TAG} obot-fleet`

export const isManager = (job) => String(job?.name ?? '').startsWith(MANAGER_TAG)

/**
 * The harness's terminal states, all three of them.
 *
 * Copied from wake.mjs's `classify`, which had them right. The first draft of the
 * singleton tested `state !== 'done'` alone, and the very first real launch caught
 * it: a manager stopped an hour earlier still read as live, so the singleton was
 * held permanently and no manager could ever launch again. The launcher went on
 * reporting "held — a manager is already running", which is the worst shape a
 * failure can take here, because it looks exactly like the guard working.
 */
export const TERMINAL = ['done', 'stopped', 'failed']
export const isLive = (job) => !TERMINAL.includes(job?.state)

const num = (v, dflt) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : dflt
}

/**
 * How long a stop-state must hold before a manager acts on it. MEASURED, not
 * guessed — the requirement asks for that explicitly.
 *
 * From the 92 job records on this machine (2026-08-17): of every span a worker
 * spent blocked and then RESOLVED, the longest was 106 minutes and the next
 * longest 80. Every worker block that ran past that was never resolved at all —
 * 21h, 21h, 22h, a day — and had to be closed by hand, which is the failure this
 * exists to end. 180 minutes therefore sits above every legitimate resolution ever
 * recorded here, with 70 minutes of headroom, and below every observed failure.
 * It is also what @jwildfire asked for in words: "more than a few hours".
 *
 * These bars sit ON TOP of wake.mjs's own grace periods rather than replacing them:
 * classify() emits nothing for a waiting worker until WAITING_GRACE_MIN (10m) or a
 * stalled one until STALL_MIN (30m), so those are hard floors beneath anything set
 * here. That is the right way round — this module raises the bar, it can never lower
 * it — but it does mean a value below the floor has no effect, which is worth knowing
 * before anyone tunes one of these down and concludes the detector is broken.
 *
 * `dead` is shorter because a worker that died on an API error is not coming back,
 * so waiting on it cannot pay. 60 minutes still leaves the wake channel — whose own
 * re-wake floor for a dead worker is 60 minutes — a full cycle to reach the
 * Navigator first, so the manager is the second responder rather than the first.
 */
export const ACT_MIN = {
  waiting: num(process.env.OBOT_FLEET_WAIT_MIN, 180),
  stalled: num(process.env.OBOT_FLEET_STALL_MIN, 180),
  dead: num(process.env.OBOT_FLEET_DEAD_MIN, 60),
}

/**
 * How long an open pull request may sit still on an operational lane.
 *
 * Measured over the last 60 merged PRs in obot.agent and 21 in obot.roadmap: median
 * time from open to merge is 3 minutes and 17 minutes respectively, and the 75th
 * percentile 24 and 83. Twelve of those 81 took more than six hours, and that tail
 * is exactly the population this requirement was written about. 120 minutes clears
 * the 75th percentile of both repos with room and still catches the tail on the
 * same morning rather than the next one.
 */
export const PR_IDLE_MIN = num(process.env.OBOT_FLEET_PR_IDLE_MIN, 120)

/**
 * How long a closeout may sit before its absence from the delivery record is a gap
 * rather than the Navigator simply not having got to it yet. Also measured.
 *
 * Across the 22 verdicts on this machine that can be joined to a job record, the
 * time from closeout to recorded verdict has a median of 11 minutes, a 90th
 * percentile of 57, and then a clean break: the next two are 376 minutes and 738.
 * Those two are W0013 and W0007 — the pair the wake channel was built for, and the
 * ones this requirement was written about. 90 minutes therefore sits above every
 * healthy verdict ever recorded here and below both failures.
 *
 * Without this bar the condition would fire the instant any worker finished, which
 * would launch a manager after every single piece of work — a busy fleet spawning
 * an overseer per closeout, which is the standing-supervisor cost D0016 rejected,
 * arriving by the back door.
 */
export const CLOSEOUT_GAP_MIN = num(process.env.OBOT_FLEET_GAP_MIN, 90)

/**
 * The manager's lifetime bound, and the whole reason a triggered design beats a
 * standing one. A manager with no time limit is a standing session that has not
 * admitted it yet. The manager is told this budget and must exit inside it; the
 * sweep reports one that has not, which works because the sweep is a script and
 * cannot stall the way an agent stalls, and the only thing watching IT is launchd,
 * which is the operating system. The regress terminates at the OS.
 *
 * The general rule, worth stating once: never let an agent be the sole watcher of
 * an agent.
 */
export const MANAGER_TTL_MIN = num(process.env.OBOT_FLEET_TTL_MIN, 30)
/** When an overrun stops being a finding and becomes a runaway. Reported either
 *  way; only killed if the kill is armed, because terminating a process mid-write
 *  is not something to do on a default. */
export const MANAGER_HARD_MIN = num(process.env.OBOT_FLEET_HARD_MIN, 60)

/** Never two launches inside this window, whatever changed. */
export const RELAUNCH_FLOOR_MIN = num(process.env.OBOT_FLEET_FLOOR_MIN, 60)
/** And a much longer floor when the conditions are the SAME ones as last time, so a
 *  condition nothing can resolve — a pull request that will never pass the bar —
 *  cannot spin up a manager every hour for the rest of the week. */
export const REPEAT_FLOOR_MIN = num(process.env.OBOT_FLEET_REPEAT_MIN, 240)

const minsSince = (at, now) => {
  const t = Date.parse(at ?? '')
  return Number.isNaN(t) ? null : (now.getTime() - t) / 60000
}

const round = (n) => (n === null ? null : Math.round(n))

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

// ---- condition 1: sessions stopped long enough to act on ---------------------

/**
 * Workers whose stop-state has held past the acting threshold.
 *
 * The kinds come from wake.mjs unchanged. What is added is the clock and the bar,
 * and one deliberate exclusion: a `stopped` detection — a closeout awaiting a
 * verdict — is NOT a stalled session. Nothing is stuck; the work finished. It is
 * condition 3, and it is reported rather than acted on.
 */
export function stalledSessions(jobs = [], { now = new Date(), hostWasAway: away = false } = {}) {
  // A suspended laptop is not a stalled fleet. Same guard the wake uses: a
  // detector cannot run on a host that was not running, and every worker on a lid
  // that was shut for thirteen hours would otherwise read as three hours stalled.
  if (away) return []
  const out = []
  for (const job of jobs) {
    if (isManager(job)) continue // it never acts on itself, or on its successor
    for (const d of classify(job, now)) {
      if (!(d.kind in ACT_MIN)) continue
      const mins = minsSince(d.at, now)
      if (mins === null || mins < ACT_MIN[d.kind]) continue
      out.push({
        kind: d.kind,
        key: d.key,
        job: d.job,
        worker: d.worker,
        at: d.at,
        mins: round(mins),
        threshold: ACT_MIN[d.kind],
        needs: job.needs ?? '',
        detail: job.detail ?? '',
        line: `${d.worker} (job ${d.job}) has been ${d.kind} ${round(mins)}m, past the ${ACT_MIN[d.kind]}m bar` +
              (job.needs ? ` — needs: ${clip(job.needs, 110)}` : ''),
      })
    }
  }
  return out.sort((a, b) => b.mins - a.mins)
}

// ---- condition 2: operational pull requests that stopped moving --------------

/**
 * Repos the manager may land a pull request in, and the branch it may land on.
 *
 * Read from scripts/policy.json rather than listed here, so promoting a repo is
 * still one decision in one file. Two filters, both of them hard:
 *
 *   class === 'operational'  — the split @jwildfire decided on 2026-08-15. A
 *     clinical repo is one he reviews before anything reaches the released
 *     surface, and an agent landing a pull request there without him is the thing
 *     the classification exists to prevent. Today that is obot.agent and
 *     obot.roadmap, and nothing else.
 *   profile === 'auto'       — the repo is on the standard merge lane at all.
 *
 * The integration branch is taken from the repo's own entry, so a repo whose lane
 * is not called `main` needs no special case. The field is `branches`, spelled the
 * way classify.mjs already reads it — the policy file's prose calls them roles,
 * which is what the first draft of this function looked for, and it found nothing
 * and said so rather than reporting an empty operational set as a quiet fleet.
 */
export function operationalRepos(policy = {}) {
  const out = []
  for (const [repo, cfg] of Object.entries(policy.repos ?? {})) {
    if (cfg?.class !== 'operational' || cfg?.profile !== 'auto') continue
    const integration = cfg?.branches?.integration
    if (!integration) continue
    out.push({ repo, integration, release: cfg?.branches?.release ?? [] })
  }
  return out.sort((a, b) => a.repo.localeCompare(b.repo))
}

/**
 * Open pull requests that have stopped moving on an operational lane.
 *
 * CANDIDATES, not decisions. Everything excluded here is excluded on data the sweep
 * already holds from `gh pr list`; everything else — checks green, no requested
 * changes, a linked issue — is the manager's bar, applied per pull request with the
 * calls that needs. The exclusions:
 *
 *   not the integration branch — a release-role base is a release candidate by
 *     definition and the manager may never merge one.
 *   draft — unfinished by its author's own declaration.
 *   reviewDecision set — @jwildfire has it, or has ruled on it. Either way it is
 *     his, and an RC by the sweep's own classifier.
 *   a review requested from him — same: it is in his queue, and only release
 *     candidates reach his queue.
 *
 * The idle clock is `updatedAt`, which moves on a push, a comment or a review. A
 * pull request somebody is still working on is therefore never idle.
 */
export function stuckPRs(prs = [], { now = new Date(), idleMin = PR_IDLE_MIN } = {}) {
  const out = []
  for (const pr of prs) {
    const mins = minsSince(pr.updatedAt, now)
    if (mins === null || mins < idleMin) continue
    if (pr.isDraft) continue
    if (pr.baseRefName !== pr.integration) continue
    if (pr.reviewDecision) continue
    if ((pr.reviewRequests ?? []).length) continue
    out.push({
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      url: pr.url,
      base: pr.baseRefName,
      mins: round(mins),
      threshold: idleMin,
      line: `${pr.repo.replace(/^jwildfire\//, '')}#${pr.number} has not moved in ${round(mins)}m on ${pr.baseRefName} — ${clip(pr.title, 80)}`,
    })
  }
  return out.sort((a, b) => b.mins - a.mins)
}

// ---- condition 3: closeouts the delivery record never heard about ------------

/**
 * Workers that finished and carry no verdict.
 *
 * REPORTED, NEVER JUDGED. The manager surfaces the gap and wakes the Navigator; the
 * Navigator writes the verdict. This is correction 1 of the requirement and the one
 * most likely to be eroded by a well-meaning later change, so the shape of this
 * return value carries no verdict field at all — there is nothing here for a
 * manager to fill in.
 */
export function closeoutGaps(jobs = [], { now = new Date(), judged = new Set(),
                                          judgedReadable = true,
                                          minMins = CLOSEOUT_GAP_MIN, windowHours = 24 } = {}) {
  // AN UNREADABLE JOURNAL IS NOT AN EMPTY ONE, and the difference is the whole
  // condition. `judged` empty means "nothing has been judged", which makes every
  // recent closeout a gap; a journal that could not be read produces the identical
  // empty set and would fire on the entire fleet at once.
  //
  // Found by running it rather than by reasoning about it: a sandboxed integration
  // run pointed OBOT_WORKSPACE at a fresh directory with the real job ledger, read
  // no journal, and launched a real manager holding twelve phantom gaps for workers
  // the Navigator had judged hours earlier. Nothing was written, because a gap is
  // only ever reported — but the same failure on a condition that ACTS would have
  // been a manager closing a fleet on a missing file.
  //
  // So it fails the other way: no reading means no detection, said out loud. Same
  // discipline as the sweep's `backlogCapped`, where a repo that failed to list must
  // never make the queue look smaller than it is.
  if (!judgedReadable) return []
  const out = []
  for (const job of jobs) {
    if (!isWorker(job) || !job.firstTerminalAt) continue
    const mins = minsSince(job.firstTerminalAt, now)
    // Bounded at both ends: below `minMins` the Navigator has simply not got to it
    // yet, and beyond the window is history nobody can judge any more. What falls
    // outside the top of the window is the wake channel's to report, not a gap to
    // launch a manager for.
    if (mins === null || mins < minMins || mins > windowHours * 60) continue
    if (verdictKeys(job).some((k) => judged.has(k))) continue
    const who = workerIdOf(job.name) || `job ${job.id}`
    out.push({
      job: job.id,
      worker: who,
      at: job.firstTerminalAt,
      mins: round(mins),
      line: `${who} closed out ${round(mins)}m ago with no entry in the delivery record — reported to the Navigator, not judged here`,
    })
  }
  return out.sort((a, b) => b.mins - a.mins)
}

// ---- the trigger ------------------------------------------------------------

/**
 * Does anything positive hold right now?
 *
 * Returns the conditions and a signature. `fired` is true only when at least one
 * NAMED thing is in a state it should not be in. There is no branch in this
 * function that can fire on a count of zero, and `triggers({})` returning
 * fired:false is held by a test, because the failure mode it guards against — a
 * quiet system spawning managers forever — is silent, cheap to introduce and
 * expensive to notice.
 */
export function triggers({ jobs = [], prs = [], policy = {}, judged = new Set(),
                           judgedReadable = true, now = new Date(),
                           hostWasAway: away = false } = {}) {
  const sessions = stalledSessions(jobs, { now, hostWasAway: away })
  const pulls = stuckPRs(prs, { now })
  const gaps = closeoutGaps(jobs, { now, judged, judgedReadable })
  const conditions = [
    ...sessions.map((s) => ({ type: 'session', ...s })),
    ...pulls.map((p) => ({ type: 'pr', ...p })),
    ...gaps.map((g) => ({ type: 'closeout-gap', ...g })),
  ]
  return {
    conditions,
    sessions,
    pulls,
    gaps,
    fired: conditions.length > 0,
    judgedReadable,
    signature: signatureOf(conditions),
    operational: operationalRepos(policy).map((r) => r.repo),
  }
}

/** A stable name for "these exact conditions", for the repeat floor. Sorted, so the
 *  order the readings happened to come back in cannot make the same fleet look new. */
export function signatureOf(conditions = []) {
  return conditions
    .map((c) => (c.type === 'pr' ? `pr:${c.repo}#${c.number}` : `${c.type}:${c.job ?? ''}:${c.kind ?? ''}`))
    .sort()
    .join('|')
}

// ---- the launch decision ----------------------------------------------------

export const launchLine = (at, signature, why) => `${at} LAUNCH ${signature || '-'} — ${why}`
export const holdLine = (at, signature, why) => `${at} HOLD ${signature || '-'} — ${why}`

/** Launch and hold entries back out of the log. The signature is a field, never
 *  re-derived from prose — the mistake the ledger work spent a night undoing. */
export function parseFleetLog(text = '') {
  const out = []
  for (const raw of String(text).split('\n')) {
    const m = /^(\S+) (LAUNCH|HOLD) (\S+) — (.*)$/.exec(raw.trim())
    if (m) out.push({ at: m[1], op: m[2], signature: m[3] === '-' ? '' : m[3], line: m[4] })
  }
  return out
}

/**
 * Whether this run launches a manager, and why not when it does not.
 *
 * Four gates, and every one of them reports what it held rather than returning a
 * bare false — a launcher that silently declines is indistinguishable from one that
 * is broken, which is this house's signature failure.
 */
export function shouldLaunch({ trigger, jobs = [], log = [], now = new Date(),
                               hostWasAway: away = false } = {}) {
  if (away) return { launch: false, why: 'host was away — a gap in the sweep is not a stalled fleet' }
  if (!trigger?.fired) return { launch: false, why: 'no condition holds — a quiet fleet is not a trigger' }

  const live = jobs.filter((j) => isManager(j) && isLive(j))
  if (live.length) {
    return { launch: false, why: `a manager is already running (job ${live[0].id}, ${live[0].state})` }
  }

  const launches = log.filter((e) => e.op === 'LAUNCH')
  const last = launches[launches.length - 1]
  if (last) {
    const since = minsSince(last.at, now)
    if (since !== null && since < RELAUNCH_FLOOR_MIN) {
      return { launch: false, why: `last launch ${round(since)}m ago, floor is ${RELAUNCH_FLOOR_MIN}m` }
    }
    if (since !== null && last.signature === trigger.signature && since < REPEAT_FLOOR_MIN) {
      return {
        launch: false,
        why: `identical conditions to the launch ${round(since)}m ago and nothing has changed — repeat floor is ` +
             `${REPEAT_FLOOR_MIN}m, so a condition nobody can resolve cannot spin up a manager every hour`,
      }
    }
  }
  return {
    launch: true,
    why: `${trigger.conditions.length} condition(s): ${trigger.sessions.length} session(s) past the bar, ` +
         `${trigger.pulls.length} idle operational PR(s), ${trigger.gaps.length} closeout gap(s)`,
  }
}

/**
 * A manager that has not exited.
 *
 * `state` is not consulted for the clock: a manager stuck on a prompt reads
 * `blocked` and one wedged mid-turn reads `working`, and both are overruns. What
 * matters is the wall clock since it started, which is the one reading that cannot
 * be overstated by the session's own account of itself.
 */
export function overrun(jobs = [], { now = new Date(), ttlMin = MANAGER_TTL_MIN,
                                     hardMin = MANAGER_HARD_MIN, startedAt = {} } = {}) {
  const out = []
  for (const job of jobs) {
    if (!isManager(job) || !isLive(job)) continue
    const started = startedAt[job.id] ?? job.createdAt ?? job.updatedAt
    const mins = minsSince(started, now)
    if (mins === null || mins < ttlMin) continue
    out.push({
      job: job.id,
      state: job.state,
      mins: round(mins),
      hard: mins >= hardMin,
      line: `manager job ${job.id} has run ${round(mins)}m against a ${ttlMin}m budget (state ${job.state})` +
            (mins >= hardMin ? ` — past the ${hardMin}m ceiling` : ''),
    })
  }
  return out
}

// ---- the section the sweep folds into navigator-state.md --------------------

const SHOW = 6

/** Said on every run where the journal could not be read, because a suppressed
 *  detector that stays silent is indistinguishable from one that found nothing. */
export const UNJUDGED_NOTE =
  'delivery journal unreadable — closeout-gap detection SUPPRESSED this run; an unreadable ' +
  'journal is not an empty one, and treating it as empty would make every recent closeout a gap'


/**
 * Verdict first, then what held the launch, then the conditions.
 *
 * Unindented above the list for the same reason the wake section is: the dashboard
 * reads an indented line as detail of the line above it, and a detail carries no
 * alarm flag, so an overrun written as a sub-line would reach his page as small
 * grey text.
 */
export function fleetSection({ trigger = null, decision = null, overruns = [],
                               launched = null, error = null } = {}) {
  const lines = ['## Fleet — the triggered manager', '']
  if (error) {
    lines.push(`**FLEET TRIGGER BROKEN** — ${clip(error, 160)}. No condition was evaluated this run; this is not a quiet fleet.`)
    return lines.join('\n') + '\n'
  }
  if (!trigger) {
    lines.push('fleet: no reading this run')
    return lines.join('\n') + '\n'
  }

  // The alarm headline is spelled to match the dashboard's alarm regex, which is
  // case-sensitive ALL-CAPS and keyed on one of GAP/FINDING/BREACHED/FAILED/DOWN/
  // BROKEN (tools/ops-dashboard/lib/navigator.mjs). "MANAGER OVERRUN" matches none
  // of them and would reach his page as ordinary grey text — the exact shape of
  // obot.agent#129, where a real headline rendered as if nothing were wrong.
  for (const o of overruns) {
    lines.push(o.hard ? `**MANAGER BUDGET BREACHED** — ${o.line}` : `manager overrun — ${o.line}`)
  }

  if (!trigger.fired) {
    lines.push('fleet: nothing to act on — no session past the bar, no idle operational PR, no unrecorded closeout')
    lines.push('  the trigger is a positive condition: an empty fleet never launches a manager')
    if (trigger.judgedReadable === false) lines.push(`  ${UNJUDGED_NOTE}`)
    return lines.join('\n') + '\n'
  }
  if (trigger.judgedReadable === false) lines.push(`  ${UNJUDGED_NOTE}`)

  lines.push(`fleet: **${trigger.conditions.length} condition(s)** — ${trigger.sessions.length} session(s) past the bar, ` +
             `${trigger.pulls.length} idle operational PR(s), ${trigger.gaps.length} closeout gap(s)`)
  if (launched) lines.push(`  launched manager ${launched} — it acts and exits inside ${MANAGER_TTL_MIN}m`)
  else if (decision) lines.push(`  held: ${decision.why}`)

  const group = (title, rows) => {
    if (!rows.length) return
    lines.push('', `### ${title} (${rows.length})`, '')
    for (const r of rows.slice(0, SHOW)) lines.push(`- ${r.line}`)
    if (rows.length > SHOW) lines.push(`- …and ${rows.length - SHOW} more`)
  }
  group('Sessions stopped past the acting bar', trigger.sessions)
  group('Operational pull requests that stopped moving', trigger.pulls)
  group('Closeouts with no entry in the delivery record — reported, not judged', trigger.gaps)
  return lines.join('\n') + '\n'
}

/**
 * The brief handed to the manager.
 *
 * Conditions and clocks only. It deliberately carries no summary of what any
 * session did and no opinion about any pull request, because the one rule most
 * likely to be got wrong is that a summary is built from GitHub and never from the
 * session's own record — and a brief that arrived pre-summarised from local job
 * state would be exactly that mistake, wearing the launcher's authority.
 */
export function brief({ trigger, now = new Date(), ttlMin = MANAGER_TTL_MIN }) {
  return {
    generatedAt: now.toISOString(),
    deadline: new Date(now.getTime() + ttlMin * 60000).toISOString(),
    ttlMin,
    thresholds: { ...ACT_MIN, prIdleMin: PR_IDLE_MIN, closeoutGapMin: CLOSEOUT_GAP_MIN },
    operationalRepos: trigger.operational,
    signature: trigger.signature,
    sessions: trigger.sessions,
    pulls: trigger.pulls,
    closeoutGaps: trigger.gaps,
  }
}
