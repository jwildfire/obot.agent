// admiral — the trigger conditions for the admiral (obot.agent#167, under
// jwildfire/obot.roadmap#236).
//
// The sweep detects; a short-lived admiral acts and exits. This module is the
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
//    must not launch an admiral, or a genuinely quiet system spawns one forever.
//    Every condition below is something that IS true of a named job or a named pull
//    request — never something that is missing. `triggers()` on an empty fleet
//    returns fired:false, and a test holds it there.
//
// 2. THE SWEEP MAKES THE CHEAP TEST; THE ADMIRAL MAKES THE EXPENSIVE ONE. A PR is a
//    candidate here on facts the sweep already has in hand — open, idle, not a
//    draft, not a release candidate, operational repo. Whether its checks are green,
//    whether a review requested changes, whether it closes an issue: that is a call
//    per pull request, far too much for something that runs every five minutes, and
//    it is the admiral's bar to apply. A candidate is NOT a decision to merge.
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
// else: the wake notifies at 10-30 minutes, the admiral acts at hours, because a
// notification that turns out to be premature costs a glance and a close that turns
// out to be premature destroys work.
import { isForeignRole } from '../lib/roles.mjs'
import { classify, hostWasAway, isWorker, judgedWorkers, readJobs, verdictKeys,
         workerIdOf } from './wake.mjs'

export { hostWasAway, judgedWorkers, readJobs }

/** The admiral's own session tag. Deliberately not a worker tag: an admiral that
 *  its own detector reads as a worker would wake the Navigator about itself, and
 *  a later run would find it stalled and close it.
 *
 *  ANCHOR RATHER THAN TRAFFIC SIGNAL (obot.agent#182). The first tag was 🚦, chosen
 *  when the role was called the fleet manager. That glyph already means something
 *  else in the one place he actually reads: `## 🚦 Release candidates needing
 *  review` is the first headline of every wrapup, every session-init hand-off and
 *  the RC framework. One glyph meaning both "his review queue" and "the agent that
 *  never touches a release candidate" is the worst possible pair to collide, so the
 *  rename took the chance to separate them. ⚓ is naval like the name and sits
 *  beside prime's 🎩 and nav's 🧭. */
export const ADMIRAL_TAG = '\u{2693}\u{1F916}' // ⚓🤖
export const ADMIRAL_NAME = `${ADMIRAL_TAG} obot-admiral`

/**
 * Is this job THIS WORKSPACE'S admiral?
 *
 * The name is a claim and the workspace is a fact (obot.agent#188). Asking the name
 * alone is how four sessions spawned by the launcher's own unit suite — real
 * `claude --bg -n '⚓🤖 obot-admiral'` processes in `mkdtemp` workspaces — held the
 * singleton against every real launch, collected two
 * **ADMIRAL KILLED ON A BREACHED BUDGET** headlines on @jwildfire's dashboard and
 * took a real SIGTERM between them.
 *
 * `workspace` is optional and its absence changes nothing: an unknown workspace, or
 * a job record with no `cwd`, falls back to the name exactly as before. Failing
 * closed on a missing field would make a real admiral invisible, and an admiral
 * nothing is watching is the failure obot.agent#181 was written about.
 */
export const isAdmiral = (job, { workspace } = {}) =>
  String(job?.name ?? '').startsWith(ADMIRAL_TAG) && !isForeignRole(job, { workspace })

/**
 * Sessions wearing a role's name that ran somewhere else.
 *
 * Reported rather than merely dropped. Four records vanishing from the singleton,
 * the budget and the wake with nothing said would be a suppression nobody can see,
 * which is the same defect as the rows it suppressed — so the section names them and
 * says where they actually ran.
 */
export function foreignRoleSessions(jobs = [], { workspace } = {}) {
  // LIVE ones only, and that bound is the difference between a finding and a
  // permanent line. A terminal session holds no singleton, breaches no budget and
  // reaches no wake — it is history, and the Agents tab is where history is read.
  // Unbounded, this would name every fixture the machine had ever spawned, on every
  // sweep, for as long as the job ledger keeps them.
  return jobs.filter((j) => isForeignRole(j, { workspace }) && isLive(j))
}

/**
 * The harness's terminal states, all three of them.
 *
 * Copied from wake.mjs's `classify`, which had them right. The first draft of the
 * singleton tested `state !== 'done'` alone, and the very first real launch caught
 * it: an admiral stopped an hour earlier still read as live, so the singleton was
 * held permanently and no admiral could ever launch again. The launcher went on
 * reporting "held — an admiral is already running", which is the worst shape a
 * failure can take here, because it looks exactly like the guard working.
 */
export const TERMINAL = ['done', 'stopped', 'failed']
export const isLive = (job) => !TERMINAL.includes(job?.state)

const num = (v, dflt) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : dflt
}

/**
 * How long a stop-state must hold before an admiral acts on it. MEASURED, not
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
 * Navigator first, so the admiral is the second responder rather than the first.
 */
export const ACT_MIN = {
  waiting: num(process.env.OBOT_ADMIRAL_WAIT_MIN, 180),
  stalled: num(process.env.OBOT_ADMIRAL_STALL_MIN, 180),
  dead: num(process.env.OBOT_ADMIRAL_DEAD_MIN, 60),
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
export const PR_IDLE_MIN = num(process.env.OBOT_ADMIRAL_PR_IDLE_MIN, 120)

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
 * would launch an admiral after every single piece of work — a busy fleet spawning
 * an overseer per closeout, which is the standing-supervisor cost D0016 rejected,
 * arriving by the back door.
 */
export const CLOSEOUT_GAP_MIN = num(process.env.OBOT_ADMIRAL_GAP_MIN, 90)

/**
 * The admiral's lifetime bound, and the whole reason a triggered design beats a
 * standing one. An admiral with no time limit is a standing session that has not
 * admitted it yet. The admiral is told this budget and must exit inside it; the
 * sweep reports one that has not, which works because the sweep is a script and
 * cannot stall the way an agent stalls, and the only thing watching IT is launchd,
 * which is the operating system. The regress terminates at the OS.
 *
 * The general rule, worth stating once: never let an agent be the sole watcher of
 * an agent.
 */
export const ADMIRAL_TTL_MIN = num(process.env.OBOT_ADMIRAL_TTL_MIN, 30)
/** When an overrun stops being a finding and becomes a runaway. Reported either
 *  way; only killed if the kill is armed, because terminating a process mid-write
 *  is not something to do on a default. */
export const ADMIRAL_HARD_MIN = num(process.env.OBOT_ADMIRAL_HARD_MIN, 60)

/** Never two launches inside this window, whatever changed. */
export const RELAUNCH_FLOOR_MIN = num(process.env.OBOT_ADMIRAL_FLOOR_MIN, 60)
/** And a much longer floor when the conditions are the SAME ones as last time, so a
 *  condition nothing can resolve — a pull request that will never pass the bar —
 *  cannot spin up an admiral every hour for the rest of the week. */
export const REPEAT_FLOOR_MIN = num(process.env.OBOT_ADMIRAL_REPEAT_MIN, 240)

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
export function stalledSessions(jobs = [], { now = new Date(), hostWasAway: away = false,
                                            workspace = null } = {}) {
  // A suspended laptop is not a stalled fleet. Same guard the wake uses: a
  // detector cannot run on a host that was not running, and every worker on a lid
  // that was shut for thirteen hours would otherwise read as three hours stalled.
  if (away) return []
  const out = []
  for (const job of jobs) {
    if (isAdmiral(job, { workspace })) continue // it never acts on itself, or on its successor
    // The workspace goes to `classify` too, and leaving it out was a real hole in the
    // first draft of this guard: a session wearing a role's name is no longer skipped
    // by the line above — it is not the admiral — so without it here the same fixture
    // came back through `classify` as a budgeted role and fired the trigger from the
    // other side of the same function.
    for (const d of classify(job, now, { workspace })) {
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
 * Repos the admiral may land a pull request in, and the branch it may land on.
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
 * changes, a linked issue — is the admiral's bar, applied per pull request with the
 * calls that needs. The exclusions:
 *
 *   not the integration branch — a release-role base is a release candidate by
 *     definition and the admiral may never merge one.
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
 * REPORTED, NEVER JUDGED. The admiral surfaces the gap and wakes the Navigator; the
 * Navigator writes the verdict. This is correction 1 of the requirement and the one
 * most likely to be eroded by a well-meaning later change, so the shape of this
 * return value carries no verdict field at all — there is nothing here for an
 * admiral to fill in.
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
  // no journal, and launched a real admiral holding twelve phantom gaps for workers
  // the Navigator had judged hours earlier. Nothing was written, because a gap is
  // only ever reported — but the same failure on a condition that ACTS would have
  // been an admiral closing a fleet on a missing file.
  //
  // So it fails the other way: no reading means no detection, said out loud. Same
  // discipline as the sweep's `backlogCapped`, where a repo that failed to list must
  // never make the queue look smaller than it is.
  if (!judgedReadable) return []
  const out = []
  for (const job of jobs) {
    if (!isWorker(job) || !job.firstTerminalAt) continue
    // A SESSION THAT RESUMED IS NOT A CLOSEOUT (obot.agent#176, one condition over).
    // `firstTerminalAt` is a first-write-wins watermark the harness never resets, so
    // a worker that closed out and was then handed more work carries it for the life
    // of the record — and this scan had no liveness filter while the two other job
    // scans in this file have one. The row it produced asserts "closed out Nm ago"
    // in front of an agent holding `claude stop`, about a session that is mid-work.
    // Five records on this machine spent 129 to 575 minutes in that state, one of
    // them publishing a release tag on `stable` through most of its 575.
    //
    // Positive evidence only: a LIVE session with nothing after its terminal stamp is
    // still reported, because a gap is only ever reported and an unreported one is a
    // closeout nobody judges. What is dropped is only the case the timeline settles.
    if (isLive(job) && job.lastActivityAt &&
        Date.parse(job.lastActivityAt) > Date.parse(job.firstTerminalAt)) continue
    const mins = minsSince(job.firstTerminalAt, now)
    // Bounded at both ends: below `minMins` the Navigator has simply not got to it
    // yet, and beyond the window is history nobody can judge any more. What falls
    // outside the top of the window is the wake channel's to report, not a gap to
    // launch an admiral for.
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
 * quiet system spawning admirals forever — is silent, cheap to introduce and
 * expensive to notice.
 */
export function triggers({ jobs = [], prs = [], policy = {}, judged = new Set(),
                           judgedReadable = true, now = new Date(),
                           hostWasAway: away = false, workspace = null } = {}) {
  const sessions = stalledSessions(jobs, { now, hostWasAway: away, workspace })
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
/**
 * A launch that was DECIDED and not made, because OBOT_ADMIRAL_SPAWN=0 disarmed the
 * spawn (obot.agent#188).
 *
 * Its own word rather than a LAUNCH line, and that is the whole point of it. The
 * floors below are read back out of this log, so a stub that wrote LAUNCH would hold
 * the next REAL launch for an hour on the strength of one that never happened —
 * a guard silently re-armed by a change that reported success, which is this
 * codebase's signature failure. `parseAdmiralLog` reads LAUNCH and HOLD only, so a
 * STUB line is a record for a human and arms nothing.
 */
export const stubLine = (at, signature, why) => `${at} STUB ${signature || '-'} — ${why}`

/** Launch and hold entries back out of the log. The signature is a field, never
 *  re-derived from prose — the mistake the ledger work spent a night undoing. */
export function parseAdmiralLog(text = '') {
  const out = []
  for (const raw of String(text).split('\n')) {
    const m = /^(\S+) (LAUNCH|HOLD) (\S+) — (.*)$/.exec(raw.trim())
    if (m) out.push({ at: m[1], op: m[2], signature: m[3] === '-' ? '' : m[3], line: m[4] })
  }
  return out
}

/**
 * Whether this run launches an admiral, and why not when it does not.
 *
 * Four gates, and every one of them reports what it held rather than returning a
 * bare false — a launcher that silently declines is indistinguishable from one that
 * is broken, which is this house's signature failure.
 */
export function shouldLaunch({ trigger, jobs = [], log = [], now = new Date(),
                               hostWasAway: away = false, workspace = null } = {}) {
  if (away) return { launch: false, why: 'host was away — a gap in the sweep is not a stalled fleet' }
  if (!trigger?.fired) return { launch: false, why: 'no condition holds — a quiet fleet is not a trigger' }

  const live = jobs.filter((j) => isAdmiral(j, { workspace }) && isLive(j))
  if (live.length) {
    return { launch: false, why: `an admiral is already running (job ${live[0].id}, ${live[0].state})` }
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
             `${REPEAT_FLOOR_MIN}m, so a condition nobody can resolve cannot spin up an admiral every hour`,
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
 * An admiral that has not exited.
 *
 * `state` is not consulted for the clock: an admiral stuck on a prompt reads
 * `blocked` and one wedged mid-turn reads `working`, and both are overruns. What
 * matters is the wall clock since it started, which is the one reading that cannot
 * be overstated by the session's own account of itself.
 */
export function overrun(jobs = [], { now = new Date(), ttlMin = ADMIRAL_TTL_MIN,
                                     hardMin = ADMIRAL_HARD_MIN, startedAt = {},
                                     workspace = null } = {}) {
  const out = []
  for (const job of jobs) {
    if (!isAdmiral(job, { workspace }) || !isLive(job)) continue
    const started = startedAt[job.id] ?? job.createdAt ?? job.updatedAt
    const mins = minsSince(started, now)
    if (mins === null || mins < ttlMin) continue
    out.push({
      job: job.id,
      state: job.state,
      mins: round(mins),
      hard: mins >= hardMin,
      line: `admiral job ${job.id} has run ${round(mins)}m against a ${ttlMin}m budget (state ${job.state})` +
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
export function admiralSection({ trigger = null, decision = null, overruns = [],
                               launched = null, error = null, stubbed = null,
                               foreign = [] } = {}) {
  const lines = ['## Admiral — triggered, acts and exits', '']
  if (error) {
    lines.push(`**ADMIRAL TRIGGER BROKEN** — ${clip(error, 160)}. No condition was evaluated this run; this is not a quiet fleet.`)
    return lines.join('\n') + '\n'
  }
  if (!trigger) {
    lines.push('admiral: no reading this run')
    return lines.join('\n') + '\n'
  }

  // The alarm headline is spelled to match the dashboard's alarm regex, which is
  // case-sensitive ALL-CAPS and keyed on one of GAP/FINDING/BREACHED/FAILED/DOWN/
  // BROKEN (tools/ops-dashboard/lib/navigator.mjs). "ADMIRAL OVERRUN" matches none
  // of them and would reach his page as ordinary grey text — the exact shape of
  // obot.agent#129, where a real headline rendered as if nothing were wrong.
  //
  // The character class is [A-Z0-9 ] and nothing else, so punctuation between the
  // asterisks silently breaks the match: "ADMIRAL KILLED, BUDGET BREACHED" contains
  // BREACHED and still renders grey, purely because of the comma. Its test caught
  // exactly that, which is the argument for testing the wording rather than reading it.
  for (const o of overruns) {
    if (o.killed) lines.push(`**ADMIRAL KILLED ON A BREACHED BUDGET** — ${o.line} · ${o.killed}`)
    else lines.push(o.hard ? `**ADMIRAL BUDGET BREACHED** — ${o.line}` : `admiral overrun — ${o.line}`)
  }

  // A launcher that has been disarmed reports as loudly as one that is broken, and
  // for the same reason: a section saying it considered the fleet and declined is
  // what a WORKING launcher says, so a silent stub would be indistinguishable from
  // health. DOWN rather than DISARMED because the dashboard's alarm regex is keyed
  // on GAP/FINDING/BREACHED/FAILED/DOWN/BROKEN and would render anything else grey.
  if (stubbed) lines.push(`**ADMIRAL LAUNCH DOWN** — ${clip(stubbed, 220)}`)

  // Said, never merely dropped. These are the records the singleton, the budget and
  // the wake stopped counting, and a suppression nobody can see is the same defect
  // as the rows it suppressed (obot.agent#188).
  if (foreign.length) {
    // The last path segment, not the whole path. A system temp directory is fifty
    // characters of machine noise and one word that identifies the run, and this
    // line lands on a phone screen — the full path pushes the word that answers the
    // question off the end of it.
    const where = (j) => (j.cwd ? `…/${String(j.cwd).split('/').filter(Boolean).pop()}` : 'an unnamed directory')
    lines.push(`not this workspace: ${foreign.length} session(s) carrying a role's name ran elsewhere — ` +
               `ignored by the singleton, the budget and the wake · ` +
               foreign.slice(0, 3).map((j) => `${j.id} in ${where(j)}`).join(' · ') +
               (foreign.length > 3 ? ` · …and ${foreign.length - 3} more` : ''))
  }

  if (!trigger.fired) {
    lines.push('admiral: nothing to act on — no session past the bar, no idle operational PR, no unrecorded closeout')
    lines.push('  the trigger is a positive condition: an empty fleet never launches an admiral')
    if (trigger.judgedReadable === false) lines.push(`  ${UNJUDGED_NOTE}`)
    return lines.join('\n') + '\n'
  }
  if (trigger.judgedReadable === false) lines.push(`  ${UNJUDGED_NOTE}`)

  lines.push(`admiral: **${trigger.conditions.length} condition(s)** — ${trigger.sessions.length} session(s) past the bar, ` +
             `${trigger.pulls.length} idle operational PR(s), ${trigger.gaps.length} closeout gap(s)`)
  if (launched) lines.push(`  launched admiral ${launched} — it acts and exits inside ${ADMIRAL_TTL_MIN}m`)
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
 * The brief handed to the admiral.
 *
 * Conditions and clocks only. It deliberately carries no summary of what any
 * session did and no opinion about any pull request, because the one rule most
 * likely to be got wrong is that a summary is built from GitHub and never from the
 * session's own record — and a brief that arrived pre-summarised from local job
 * state would be exactly that mistake, wearing the launcher's authority.
 */
export function brief({ trigger, now = new Date(), ttlMin = ADMIRAL_TTL_MIN }) {
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
