#!/usr/bin/env node
// navigator-sweep — the Navigator's RC-review sweep (obot.roadmap#157, first
// capability; C2-b of the 2026-08-14 prime-context-management artifact).
//
// A scheduled, session-independent observer of the RC review queue. Every run:
//   1. discovers the relevant repos from scripts/policy.json (a new repo entry
//      is swept on the next run — no code change);
//   2. lists open PRs per repo and classifies RCs: base branch holds a
//      `release` role, OR review requested from @jwildfire, OR already
//      reviewed (reviewDecision set) — drafts excluded;
//   3. fetches each RC's reviews and comment counts;
//   4. diffs against the previous snapshot → events (new review, new RC,
//      RC merged/closed, new comments, decision change);
//   5. writes {workspace}/.claude/session-hub/navigator-state.md — the file
//      🎩🤖 obot-prime reads (prime-rehydrate already bundles it). Navigator
//      is the SOLE writer of that file; prime never writes it, the Navigator
//      never writes prime-state.md.
//   6. appends one scratchpad `## Session log` line per event (tag 🧭🤖 nav)
//      so working sessions and the wrapup see review activity without polling.
//   7. reads every worker's job record, renders the ones that stopped, stalled,
//      died or are waiting into a `## Wake` section above everything else, and
//      appends one line per wake to the log the Navigator's Monitor tails
//      (hub#212). See wake.mjs — this file supplies the readings.
//
// Why scheduled, not a session Monitor: session-bound watchers die with the
// session and coverage was manual per-RC — both failed on sv#131 (2026-08-15,
// CHANGES_REQUESTED at 08:29Z unseen for hours). Installed via
// tools/navigator/install-launchd, cadence 5 min.
//
// The wake in step 7 is the mirror of that and not a contradiction: the OBSERVER
// stays scheduled and session-independent, and only the notification is
// session-bound — because only a session can be notified. When that half dies the
// state file says so on every run, and the pending list is still written.
//
// Failure contract: a failed sweep must never look fresh. On error the state
// file is rewritten with a FAILED header naming the last good sweep; a repo
// that fails to list keeps its previous entries and emits no rc-gone events.
//
// Day-one scope (hub#157): bookkeeping only. Records and reports; never
// judges, corrects, or touches other agents' work. Nothing it writes is
// published.
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync,
         statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { answersSection, deliverAnswers, pendingAnswers, unappliedDetections } from '../ops-dashboard/lib/answers.mjs'
import { isArmed as voiceArmed } from '../voice/lib/armed.mjs'
import { readQueue as voiceQueue } from '../voice/lib/handles.mjs'
import { pollReminders } from '../voice/lib/reminders.mjs'
import { episodeCoverage, episodesSection } from '../voice/lib/episodes.mjs'
import { readUnrouted, unroutedSection } from '../voice/lib/route.mjs'
import { ORPHAN_QUERY, auditFreshness, checksSection, emptyCloseouts, orphanedWork,
         orphansAccepted, orphansOutsideWindow, parseIndexRows, parseRefLookup, readJson,
         refLookupQuery, registryDisagreement, shapeRepo, siteVersionFreshness,
         unresolvedRefs } from './checks.mjs'
// What counts as a release candidate now lives beside this file rather than in it,
// because the Operations Dashboard has to answer the same question and used to answer
// it differently. Re-exported so this module's callers and tests are unaffected.
import { misattributed, renderIdentity, scanCommits } from '../lib/identity.mjs'
import { classifyRC, discoverRepos, POLICY_FILE } from './classify.mjs'
import { refreshMetrics } from './metrics.mjs'
// The checkout this machine runs from, and the consumers that read it
// (jwildfire/obot.roadmap#243). Merging is not deploying here: everything runs from
// the local checkout and a merge to `main` does not move it, so the sweep — already
// walking past it every five minutes — fast-forwards it and restarts what reads it.
// Fast-forward only; every refusal is reported and nothing is ever forced.
import { brokenRecord, buildStamp, renderSelfUpdate, selfUpdate } from './selfupdate.mjs'
// Local-only work (jwildfire/obot.roadmap#256, obot.agent#240). Everything above this
// line reads GitHub, and GitHub is accurate about everything that reached it — so work
// that never reached it is invisible to every one of them. Four instances in two days,
// all found by accident. This is the reading that runs on the machine where that work
// actually is; see localwatch.mjs for why age plus absence of an owner, and never
// dirtiness, is what makes it a finding.
import { collectLocal, fetchCachePath, localSection } from './localwatch.mjs'
// Claim currency (obot.agent#262, under jwildfire/obot.roadmap#264 and #266). Every
// other reading above asks whether something happened; this asks whether something
// still written down is still true. Two artifact classes state claims — the config
// list and the decision artifacts — and until now nothing re-checked either after the
// day it was written. One mechanism, because #266 asked for one by name.
import { readCurrency } from './currency.mjs'
// The constraints he actually stated, beside the judging that uses them
// (obot.agent#293, under jwildfire/obot.roadmap#267). The Navigator objected twice, on
// the record, that three audio episodes ran over his five-minute maximum — and he had
// granted the exception in the same sentence that set the number. The constraint arrives
// in chat, the work arrives in the queue, and until this section nothing carried one to
// the other. Its second half asks the same question sideways: two workers in flight under
// one requirement, which happened three times in the week this was written.
import { collectConstraints, constraintsBroken, constraintsSection } from './constraints.mjs'
// What the fleet spends, before it spends it (jwildfire/obot.roadmap#275). Every
// reading above is about work; this one is about the budget the work runs on. The
// measurement already existed — `build_usage_data.py` has priced this machine's
// transcripts since July — but its only heartbeat was the session wrapup, and when
// the wrapup stopped the artifact sat five days old while the fleet spent a week's
// allowance in five nights. The sweep is the cadence that cannot forget, and the
// halt file is the refusal that does not depend on an agent remembering.
import { ALARM_READING, applyHalt, readSpend, spendBroken, spendBrokenNote, writeVerdict } from './spend.mjs'
// Carve-out routing (obot.agent#264, under jwildfire/obot.roadmap#220). A pull request
// touching a guardrail path can be merged by nobody but @jwildfire, so it belongs in
// the config bucket — the only one of his three that means "his hands". Nothing put it
// there until now, and the admiral escalated one every cycle to an audience that could
// do nothing about it. Only the broken-section wording is imported here; the decision
// and the write both live in tools/carveout-route.
import { routingBroken } from './carveout.mjs'
// The ranked head (jwildfire/obot.roadmap#278). Reported, never acted on: a `top10`
// label on a closed issue is a slot open, and choosing what fills it is 🎩🤖 obot-prime's.
import { collectRankHead, rankheadSection, readingBroken as rankheadBroken } from './rankhead.mjs'
// The wake (hub#212). The sweep already knew a worker had stopped; what it could not
// do was get the Navigator's attention, so workers stopped and then waited — twenty
// minutes on 2026-08-16, six hours on 2026-08-17. Detection and delivery live in
// wake.mjs; this file supplies the readings and appends the log the Navigator tails.
import { hostWasAway, idleDetection, judgedWorkers, listenerState, outsideWindow,
         deliverable, misreadHolds, parseWakeLog, pending as pendingWakes, readJobs,
         readyBacklog, wakeLine, wakeSection } from './wake.mjs'
// And the other half of the same lane (jwildfire/obot.roadmap#257). The wake carries
// "a worker stopped"; this makes it also carry "something completed, here is the
// sentence", and compares GitHub's closed requirements against the record so a
// closure with no sentence is a finding rather than a silence.
import { closedRequirements, completionDetections, landingsLine, landingsNote,
         unsummarised } from './closures.mjs'

export { classifyRC, discoverRepos }

const WS = process.env.OBOT_WORKSPACE || join(process.env.HOME, 'Documents/obot2')
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const POLICY = POLICY_FILE
const STATE_MD = join(WS, '.claude/session-hub/navigator-state.md')
const SNAPSHOT = join(WS, '.claude/session-hub/cache/navigator-rc.json')
// The release-metrics cache (jwildfire/obot.roadmap#218). Written here and only
// here — the sweep is the sole writer of session-hub files — read by the
// dashboard's Navigator tab, which never reaches the network at render time.
const METRICS = join(WS, '.claude/session-hub/cache/metrics.json')
const METRICS_TTL_MIN = 60
// Where the local-state reading remembers its last fetch. The sweep does NOT fetch six
// remotes every five minutes — that measured 3.6s warm and is unbounded on a bad
// connection, for a number that moves by two or three commits an hour. It refreshes on
// the same hourly ride the metrics take, and every position it prints says how old it
// is, which is the call selfupdate.mjs already made for the checkout position.
// ONE spelling, since obot.agent#291 put the clone update on the same cadence: it runs
// first, fetches when the TTL is up, and this section reads the same cache as already
// refreshed. Two literals for one path is how that becomes two fetches an hour.
const LOCALWATCH_CACHE = fetchCachePath(WS)
// How far back the commit-identity scan reads. Bounded so a five-minute job never walks
// months of history; the backlog it does not cover is the 301 commits already counted on
// obot.agent#241, which is a cleanup question rather than a detection one.
const IDENTITY_WINDOW_DAYS = 14
// The wake channel (hub#212). Append-only: the sweep writes, the Navigator's Monitor
// tails, and the last entry per key is its own debounce — no separate state file.
const WAKE_LOG = join(WS, '.claude/session-hub/navigator-wake.log')
const WAKE_BEAT = join(WS, '.claude/session-hub/cache/navigator-wake.listener')
const JOBS_DIR = process.env.OBOT_JOBS_DIR || join(process.env.HOME, '.claude', 'jobs')
const DELIVERY_JOURNAL = join(WS, '.claude/session-hub/delivery.journal')
const LOG = join(WS, '.claude/session-hub/navigator-sweep.log')
const SCRATCHPAD_LOG = join(REPO_ROOT, 'tools', 'scratchpad-log')
// The hub clone, for joining an artifact slug to the decision id he quotes.
const HUB = process.env.OBOT_HUB || join(WS, 'obot.roadmap')
// The hub as GitHub names it, for the closure detector: a requirement closes there
// and nowhere else, and a closed issue in an implementation repo is a task rather
// than something he is owed a sentence about (jwildfire/obot.roadmap#257).
const HUB_REPO = process.env.OBOT_HUB_REPO || 'jwildfire/obot.roadmap'
// This run's own build stamp, captured at load.
//
// The sweep is the component every other check trusts and it was the one most likely
// to be running old code unnoticed, because nothing reported what version of itself it
// was: the dashboard says what it serves, the audit says how old its findings are, and
// this said neither. Captured rather than read, and for a sharper reason here than
// anywhere else — this process fast-forwards the very checkout it is executing from,
// so seconds later `git rev-parse HEAD` names precisely the code that is NOT running.
const SELF = buildStamp(REPO_ROOT)
// Where a restarted dashboard's output goes. Its own file: a replacement that dies on
// startup has to leave something behind, or "it did not come back" is the whole report.
const DASHBOARD_LOG = join(WS, '.claude/session-hub/ops-dashboard.log')
const CADENCE_MIN = 5
// Completions delivered per run, budgeted apart from the stop-state wakes. Five,
// because five is what actually happened on 2026-08-20 — four workers finishing
// inside twenty-five minutes closed five requirements, and the run that has to
// deliver all of them is exactly the run this exists for.
const MAX_COMPLETIONS_PER_RUN = 5
// Unapplied answers of his, budgeted apart from BOTH of the above, for the reason
// completions were: a fleet with three unjudged closeouts must not be able to starve
// the one notification that is about a decision he made himself. Three, because
// three is what happened on 2026-08-16 and the run that has to carry all of them is
// exactly the run this exists for.
const MAX_ANSWERS_PER_RUN = 3
const MAX_EVENTS = 15
// The snapshot keeps more history than the state file shows: the dashboard's
// Navigator tab renders these events as a feed, and a feed that forgets everything
// past fifteen entries cannot answer "what happened while I was away". The state
// file's cap is a readability budget for agents; this one is the feed's memory.
const FEED_EVENTS = 60

const short = (repo, n) => `${repo.replace(/^jwildfire\//, '')}#${n}`
const reviewKey = r => `${r.author}:${r.submittedAt}`

// diff(prev, next, goneStates, failedRepos) → events, each {type, ref, url, line}.
// goneStates maps a key present in prev but not next to its resolved final
// state (MERGED/CLOSED/unknown). failedRepos: repos whose listing failed this
// run — their prev entries are neither diffed nor declared gone.
//
// `ref` and `url` ride beside `line` rather than being parsed back out of it:
// the state file wants the sentence, the dashboard's feed wants the parts, and
// recovering parts from a sentence with a regex is how the feed would drift the
// first time a sentence changed shape.
export function diff(prev, next, goneStates = {}, failedRepos = new Set(), { baseline = false } = {}) {
  const events = []
  // The first sweep on a machine has no snapshot to compare against, so every RC
  // that has been open for a week is "absent from the previous reading" and used to
  // be stamped with this morning's clock and pushed to the scratchpad as today's
  // news — history invented out of a file that does not exist
  // (jwildfire/obot.roadmap#223). The baseline is recorded instead; events start
  // from the next sweep.
  if (baseline) {
    const n = Object.keys(next).length
    return n
      ? [{ type: 'baseline', ref: null, url: null, line: `First sweep on this machine — ${n} RC${n === 1 ? '' : 's'} already open, recorded as the baseline; events start from the next sweep` }]
      : []
  }
  for (const [key, cur] of Object.entries(next)) {
    const old = prev[key]
    const name = short(cur.repo, cur.number)
    if (!old) {
      events.push({ type: 'rc-new', ref: name, url: cur.url, line: `NEW RC ${name} "${cur.title}" → ${cur.base} ${cur.url}` })
      for (const r of cur.reviews) {
        events.push({ type: 'review-new', ref: name, url: cur.url, line: `REVIEW ${name} ${r.state} by @${r.author} ${r.submittedAt} — "${r.excerpt}"` })
      }
      continue
    }
    const oldReviews = new Set(old.reviews.map(reviewKey))
    for (const r of cur.reviews.filter(r => !oldReviews.has(reviewKey(r)))) {
      events.push({ type: 'review-new', ref: name, url: cur.url, line: `NEW REVIEW ${name} ${r.state} by @${r.author} ${r.submittedAt} — "${r.excerpt}"` })
    }
    if (cur.reviewDecision !== old.reviewDecision) {
      events.push({ type: 'decision-change', ref: name, url: cur.url, line: `DECISION ${name} ${old.reviewDecision || '(none)'} → ${cur.reviewDecision || '(none)'}` })
    }
    if (cur.commentCount > old.commentCount) {
      events.push({ type: 'comments-new', ref: name, url: cur.url, line: `COMMENTS ${name} +${cur.commentCount - old.commentCount} (now ${cur.commentCount})` })
    }
  }
  for (const [key, old] of Object.entries(prev)) {
    if (next[key] || failedRepos.has(old.repo)) continue
    const state = goneStates[key] || 'unknown'
    events.push({ type: 'rc-gone', ref: short(old.repo, old.number), url: old.url, line: `RC GONE ${short(old.repo, old.number)} — ${state}` })
  }
  return events
}

export function renderState({ snapshot, events, meta, answers = [], ledger = null, workers = null, delivery = null, checks = null, wake = null, admiral = null, carveout = null, selfupdate = null, local = null, identity = null, currency = null, rankhead = null, spend = null, landings = null, landingsVerdict = null, voice = null, decisionEpisodes = null, constraints = null }) {
  const stamp = `[verified gh ${meta.sweptAt.slice(-5)}]`
  // Has this machine ever had a reading of the queue? On a new machine there is no
  // snapshot file, so `snapshot` is `{}` — the same value a genuinely empty queue
  // produces. Rendering both as "**RC queue: EMPTY.** [verified gh]" asserts a
  // verification that did not happen, and 🎩🤖 prime reads this file
  // (jwildfire/obot.roadmap#223).
  const everRead = meta.ok || !!meta.lastGoodAt
  const head = meta.ok
    ? `swept: ${meta.sweptAt} · cadence ${meta.cadenceMin}m · ok — ${meta.repoCount} repos, ${Object.keys(snapshot).length} RCs`
    : meta.lastGoodAt
      ? `swept: ${meta.sweptAt} · cadence ${meta.cadenceMin}m · **FAILED** (${(meta.errors || []).join('; ')}) — queue below is from the last good sweep ${meta.lastGoodAt}, treat as stale`
      : `swept: ${meta.sweptAt} · cadence ${meta.cadenceMin}m · **FAILED** (${(meta.errors || []).join('; ')}) — this is the first sweep on this machine and it failed, so there is no queue to show, stale or otherwise`
  const lines = [
    '# navigator-state — 🧭🤖 Navigator RC-review sweep',
    '',
    'Sole writer: `obot.agent tools/navigator/sweep.mjs` (launchd `com.obot.navigator-sweep`). Prime reads, never writes; the Navigator never writes prime-state.md. **Stale rule: if `swept:` is older than 3× the cadence (15 min), the observer is dead — do not present this as current; say so and verify with one bounded `gh` call. Restart: `launchctl kickstart -k gui/$UID/com.obot.navigator-sweep`.**',
    '',
    head,
    '',
  ]
  // The config list's ledger (obot.agent#126). `.claude/blockers.md` is the record
  // of everything only his hands can do, and it is local-only by design — no history,
  // no backup, nothing that would notice an entry going missing. The capture tool
  // keeps an append-only journal of every id it issues; this is the reading that
  // fires without anyone running the tool. Reported even when clean, because a
  // detector that only ever speaks up on failure is indistinguishable from a dead one.
  // What tonight and this week have cost (jwildfire/obot.roadmap#275). FIRST in the
  // block, above both ledgers: it is the one reading that decides whether anything
  // below is worth dispatching, and this block is what the Operations Dashboard's ops
  // tab renders and what an agent reads before it spawns. Reported even when clean,
  // for the same reason the ledgers are — a detector that only ever speaks up on
  // failure is indistinguishable from a dead one.
  lines.push(spend?.note
    ? spend.note
    : `${ALARM_READING} — no spend reading ran this sweep, so nothing here says the fleet is under the cap. Unknown, not clean.`)
  lines.push('')
  lines.push(ledger
    ? (ledger.ok ? `config ledger: ${ledger.summary}` : `**CONFIG LEDGER GAP** — ${ledger.summary}`)
    : 'config ledger: **NO READING** — `tools/blocker-log --audit` did not run this sweep (missing, not executable, or timed out). The ledger\'s state is unknown, not clean.')
  for (const d of (ledger?.detail) || []) lines.push(`  ${d}`)
  lines.push('')
  // The worker ledger (#130). Same discipline, different question: not "did the
  // record lose something" but "is anything writing to the record at all". A
  // worker that spawned with no id can never be attributed to what it wrote, and
  // since every agent write is authored by the same bot identity, an unattributed
  // worker is unattributable forever — there is no second chance to recover it.
  // A detector that fails to read used to vanish from the file entirely, which is
  // worse than either verdict it could have printed: the section's own rule is that
  // it reports even when clean, precisely so silence cannot be mistaken for health.
  lines.push(workers
    ? (workers.ok ? `worker ledger: ${workers.summary}` : `**WORKER LEDGER FINDING** — ${workers.summary}`)
    : 'worker ledger: **NO READING** — `tools/worker-id --audit` did not run this sweep (missing, not executable, or timed out). The ledger\'s state is unknown, not clean.')
  for (const d of (workers?.detail) || []) lines.push(`  ${d}`)
  lines.push('')
  // The landing record (jwildfire/obot.roadmap#257). A third ledger line, and the
  // question it asks is the one the other two cannot: not whether the record is
  // internally sound, nor whether anything is writing to it, but whether anything
  // REACHED HIM. A requirement closed with nobody saying what he can now do is a
  // finding here, which is what makes the plain-English summary structural rather
  // than an instruction — and an instruction is exactly what four workers had on
  // 2026-08-20 when five requirements closed and nothing told him.
  lines.push(landingsLine(landingsVerdict))
  for (const d of (landingsVerdict?.detail) || []) lines.push(`  ${d}`)
  lines.push('')
  // The wake goes first — before the RC queue, before everything. The RC queue is
  // @jwildfire's work; this is the Navigator's own, it is the section that says
  // whether anything is reaching it at all, and on a cold start it is the answer to
  // "what did I miss while I was not running".
  if (wake && wake.trim()) lines.push(wake.trimEnd(), '')
  // And the acting half, directly beneath the detecting one (obot.agent#167). The
  // wake says a worker stopped; this says what was done about it. They sit together
  // because reading one without the other is how six stalled sessions and seven open
  // pull requests stayed visible for two days without anything moving.
  if (admiral && admiral.trim()) lines.push(admiral.trimEnd(), '')
  // And directly beneath the admiral, the route it now defers to (obot.agent#264).
  // They belong together: this section is the reason a carve-out pull request stopped
  // appearing in the one above, and reading the silence without the explanation is
  // how a working suppression gets mistaken for a broken detector.
  if (carveout && carveout.trim()) lines.push(carveout.trimEnd(), '')

  // And directly under the pair: what code produced any of this. It sits third rather
  // than first because the wake is about somebody waiting and this is about the
  // machine, but it belongs above the queue for the same reason a build stamp belongs
  // next to the numbers — everything below was written by the commit this names, and
  // until 2026-08-17 nothing here named it (jwildfire/obot.roadmap#243).
  lines.push((selfupdate && selfupdate.trim())
    ? selfupdate.trimEnd()
    : '## Checkout — the code this machine is running\n\n**AUTO UPDATE BROKEN** — no update ran this sweep, so nothing here says the checkout is current or that a merge would reach him.', '')

  // And directly under it, the other half of the same question. The checkout section
  // asks whether this machine has what GitHub has; this asks whether GitHub has what
  // this machine has. They are the same failure seen from opposite ends, and the
  // second one had no reader at all until obot.agent#240.
  lines.push((local && local.trim())
    ? local.trimEnd()
    : '## Local-only work — what exists on this machine and not on GitHub\n\n**LOCAL WORK READING BROKEN** — the local-state reading did not run this sweep, so nothing here says that stranded worktrees, unproposed branches or stale checkouts were looked for.', '')

  // Who the commits under all of that say they were made by (obot.agent#241, under
  // jwildfire/obot.roadmap#260). It sits beside the checkout stamp for the same reason:
  // both are readings of this machine rather than of his queue. A wrong id still renders
  // the right name in `git log` and in the GitHub UI, so this section is the only place
  // the failure is visible at all.
  lines.push((identity && identity.trim())
    ? identity.trimEnd()
    : '## Commit identity — agent commits wearing the wrong name\n\n**COMMIT IDENTITY READING BROKEN** — no checkout was scanned this sweep. Attribution is unknown, not clean.', '')

  // Whether what is written down is still true (obot.agent#262). It sits above the
  // queue rather than below it because its findings are about the things IN the queue:
  // a config item whose claim has gone stale and a decision page whose premise has
  // expired are both discovered here, before he goes to the keyboard rather than at it.
  // The spend ladder in full, for /navigator/record and for anything reading the
  // file whole. The one-line verdict is already at the top; this is the arithmetic
  // behind it — the night, the week, the denominator and where each reading came
  // from — because a cap nobody can audit is a cap nobody believes.
  lines.push((spend?.section && spend.section.trim())
    ? spend.section.trimEnd()
    : spendBroken('no spend reading ran this sweep'), '')

  lines.push((currency && currency.trim())
    ? currency.trimEnd()
    : '## Claim currency — what has been re-checked, and when\n\n**CLAIM CHECK BROKEN** — no claim was re-checked this sweep, so nothing here says a config item is still outstanding or that a decision page still frames a live question. Unknown, not clean.', '')

  // What he actually said, beside the judging that uses it (obot.agent#293, under
  // jwildfire/obot.roadmap#267). It sits directly under claim currency because they ask
  // the same question of different material: that section asks whether what an ARTIFACT
  // states is still true, this one asks whether what HE stated is even visible to the
  // party judging against it. Rendered every sweep, clean or not — a section that appears
  // only when something is wrong is indistinguishable from one that has stopped running,
  // and a judge that has quietly stopped objecting is the failure this requirement names
  // as the dangerous one.
  lines.push((constraints && constraints.trim())
    ? constraints.trimEnd()
    : constraintsBroken('no constraint reading ran this sweep'), '')

  // What comes next, once his queue is empty (jwildfire/obot.roadmap#278). It sits
  // directly above the RC queue because it is the same question one step later: that
  // section is what is waiting on him now, this is what gets picked up after. Rendered
  // even when clean — a detector that only speaks up on failure is indistinguishable
  // from a dead one — and it asks nobody for anything.
  lines.push((rankhead && rankhead.trim())
    ? rankhead.trimEnd()
    : '## Ranked head — the next ten, in order (rank declared, everything else derived)\n\n**RANK HEAD READING BROKEN** — no reading ran this sweep, so nothing here says what comes next or whether a slot has opened. Unknown, not clean.', '')

  lines.push(
    '## RC queue — open PRs awaiting or holding @jwildfire review',
    '',
  )
  const rcs = Object.values(snapshot).sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number)
  if (!rcs.length) {
    lines.push(everRead
      ? `**RC queue: EMPTY.** ${stamp}`
      : '**RC queue: UNREAD** — no repository could be listed this sweep and this machine holds no earlier snapshot. This is not an empty queue: nothing was read, so nothing can be said about what is waiting.')
  }
  for (const rc of rcs) {
    const latest = rc.reviews[rc.reviews.length - 1]
    const review = latest
      ? `${latest.state} by @${latest.author} ${latest.submittedAt} — "${latest.excerpt}"`
      : 'no review yet'
    lines.push(`- **${short(rc.repo, rc.number)}** "${rc.title}" → \`${rc.base}\` · ${review} · ${rc.commentCount} comments · ${rc.url} ${stamp}`)
  }
  // The decision answers he has recorded and nobody has applied (#120). This
  // section is why the Navigator is the deliverer: an answer written to the ops
  // store when no session is running has no other reader, and the failure that
  // produced this — a `staged` record nothing watched — was invisible precisely
  // because it lived somewhere nothing scheduled ever looked.
  lines.push('', answersSection(answers).trimEnd())

  // And the same question asked of the other door he answers through
  // (jwildfire/obot.roadmap#265). A car answer becomes an ordinary record in the store
  // above, so that section already covers it once it lands; this one covers the two
  // ways it never lands at all — a sentence that reached no decision, and a lane that
  // nothing is polling. Rendered even when there is no reading, because "the voice
  // lane was not read" and "nothing was dictated" are the same silence otherwise.
  lines.push('', (voice && voice.trim())
    ? voice.trimEnd()
    : '## Voice answers that reached no decision — his words, kept whole\n\n**VOICE LANE READING BROKEN** — no reading of the car lane ran this sweep, so nothing here says whether anything he dictated was routed, lost, or heard at all.')

  // The other half of the same lane (jwildfire/obot.roadmap#280): the section above
  // covers an answer that never landed, this one covers a decision he was never given a
  // way to answer. An open artifact with no current episode is a gap in exactly the sense
  // a closed requirement with no closure summary is — a condition, detected every five
  // minutes, rather than something a person has to remember to go and look for.
  lines.push('', (decisionEpisodes && decisionEpisodes.trim())
    ? decisionEpisodes.trimEnd()
    : '## Decision episodes — an open decision he can answer from the car\n\n**DECISION EPISODE READING BROKEN** — no reading ran this sweep, so nothing here says whether an open decision is waiting without an episode.')

  // The Navigator session's own record, folded in whole (D0017, 2026-08-16). Two
  // writers, two files: the session appends to delivery.md and never touches this
  // one; the sweep reads that file and never writes it. They rejoin here because
  // the dashboard's Navigator tab already renders any heading this file carries,
  // so the delivery record reaches him with no rendering code at all.
  lines.push('', (delivery && delivery.trim())
    ? delivery.trimEnd()
    : '## Delivery\n\n- **NO READING** — the delivery record could not be read this sweep, so no worker has been judged. That is the absence of the record, not a finding that nobody delivered.')

  // And beside it, the same day seen from his end (jwildfire/obot.roadmap#257). The
  // delivery record is what the agents did to the roadmap, judged by the Navigator;
  // this is what a person can now do that he could not before, in the sentence
  // whoever finished the work wrote at the moment it closed. They sit together
  // because the pair is the whole answer to "what happened while I was away", and
  // until now only the first half of it existed.
  lines.push('', (landings && landings.trim())
    ? landings.trimEnd()
    : '## Landings — what reached him\n\n- **NO READING** — the landing record could not be read this sweep. Whether a completion reached him is unknown; this is the absence of the record, not a finding that nothing completed.')

  // The four checks that missed the night of 2026-08-15 (D0017). Rendered even when
  // clean, because a detector that only ever speaks up on failure is
  // indistinguishable from a dead one — the same reason the ledgers report clean.
  lines.push('', (checks && checks.trim())
    ? checks.trimEnd()
    : '## Roadmap discipline\n\n- **NO READING** — the discipline checks did not run this sweep. Nothing here is a clean bill of health.')

  lines.push('', `## Recent events (newest first, capped ${MAX_EVENTS})`, '')
  if (!events.length) lines.push('- (none recorded yet)')
  // The snapshot remembers more than this file shows (FEED_EVENTS vs MAX_EVENTS):
  // the file is an agent's five-minute read, the dashboard feed is his catch-up.
  for (const e of events.slice(0, MAX_EVENTS)) lines.push(`- ${e.at || meta.sweptAt.slice(-5)} ${e.line} ${e.stamp || stamp}`)
  return lines.join('\n') + '\n'
}

// ---- gh-facing orchestration (not under test; exercised live) ----

const gh = args => execFileSync('gh', args, { encoding: 'utf8', timeout: 60000 })
const nowStamp = () => {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const excerpt = body => (body || '').replace(/\s+/g, ' ').trim().slice(0, 180)

// One reading of a local ledger, straight from the tool that owns it.
//
// Shelled rather than reimplemented here on purpose: each tool's `--audit` already
// owns its comparison, it is read-only, and its exit code is the verdict (0 agree,
// 1 a finding). A second implementation in JS would be one more thing to drift,
// which is the class of bug this whole capability exists to close.
//
// Both tools print their verdict first and their notes after, so the first line is
// the headline either way and everything below it is context worth keeping — the
// note that a file was edited outside its tool is what dates a gap when one appears.
function shellAudit(tool) {
  const r = spawnSync(join(REPO_ROOT, 'tools', tool), ['--audit'], {
    env: { ...process.env, OBOT_WORKSPACE: WS }, encoding: 'utf8', timeout: 20000,
  })
  if (r.error || r.status === null) return null
  const strip = l => l.replace(new RegExp(`^${tool}: `), '')
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').filter(Boolean)
  return { ok: r.status === 0, summary: strip(out[0] || 'no reading'), detail: out.slice(1).map(strip) }
}

// The config list: is an id allocated with no entry behind it? (obot.agent#126)
const auditLedger = () => shellAudit('blocker-log')

// The deployed hub's build stamp (hub#224), read off the live site rather than
// computed from the local clone — that clone is not the deployed tree and has been
// measured five commits behind it, so a locally computed answer can contradict the
// page @jwildfire is looking at.
//
// curl through spawnSync rather than fetch: main() is synchronous end to end, and
// making it async for one small read would float an unawaited promise past every
// existing try/catch. Two independent bounds, so a slow or unreachable network costs
// freshness and never the five-minute cadence. The cache buster is not optional —
// Pages serves with max-age=600, and ten minutes of staleness is exactly the window
// in which this answer changes.
const SITE_VERSION_URL = 'https://jwildfire.github.io/obot.roadmap/version.json'
function readSiteVersion() {
  try {
    const r = spawnSync('curl', ['-fsS', '--max-time', '3', `${SITE_VERSION_URL}?t=${Date.now()}`],
      { encoding: 'utf8', timeout: 5000 })
    if (r.error || r.status !== 0 || !r.stdout) return null
    return JSON.parse(r.stdout)
  } catch { return null }
}

// The Navigator session's delivery record, rendered by the tool that owns it
// (#134). Shelled for the same reason the audits are: one owner per record.
function readDelivery() {
  const r = spawnSync(join(REPO_ROOT, 'tools', 'delivery-log'), ['render'], {
    env: { ...process.env, OBOT_WORKSPACE: WS }, encoding: 'utf8', timeout: 20000,
  })
  if (r.error || r.status !== 0) return null
  return (r.stdout || '').trim() || null
}

// And the question the record cannot answer about itself: has a call the Navigator
// says it made gone missing from the file @jwildfire reads? A delegated decision
// that leaves no record is indistinguishable from no decision.
const auditDelivery = () => shellAudit('delivery-log')

/**
 * The admiral trigger, and the launch when a condition holds (obot.agent#167).
 *
 * Shelled rather than imported so the conditions are computed in exactly ONE place:
 * what this file renders and what actually launched can then never disagree. It
 * prints its own `## Admiral` section, so the sweep folds it whole in the same way it
 * folds the delivery record.
 *
 * This is the only part of the sweep that CAUSES something rather than recording it,
 * and it is deliberately the narrowest possible act: it starts a short-lived agent
 * and returns. Everything the admiral then does is the admiral's, under its own
 * skill contract and its own time budget.
 */
/**
 * Carve-out routing (obot.agent#264, under jwildfire/obot.roadmap#220).
 *
 * Shelled like the ledger audits and the admiral launcher, and for the same reason:
 * the tool that owns the decision also owns the writing, so what this file renders
 * and what was actually filed can never disagree. It bounds its own work — a short
 * age bar and a per-run ceiling on `obot-merge --check` calls — so the five-minute
 * cadence is never at the mercy of how many pull requests happen to be open.
 */
function runCarveout() {
  const r = spawnSync(join(REPO_ROOT, 'tools', 'carveout-route'), [], {
    env: { ...process.env, OBOT_WORKSPACE: WS }, encoding: 'utf8', timeout: 120000,
  })
  if (r.error || r.status === null) {
    return routingBroken(`the router did not run (${r.error ? String(r.error.message).slice(0, 120) : 'killed'})`)
  }
  // The router prints a section on every completed run, so empty output is a run that
  // did not complete — never a quiet pass. Returning null here would drop the section
  // off the page entirely, and this is the one spot on it where a carve-out pull
  // request is supposed to appear.
  return (r.stdout || '').trim() || routingBroken(`the router printed nothing (exit ${r.status})`)
}

function runAdmiral() {
  const r = spawnSync(join(REPO_ROOT, 'scripts', 'obot-admiral'), [], {
    env: { ...process.env, OBOT_WORKSPACE: WS }, encoding: 'utf8', timeout: 120000,
  })
  if (r.error || r.status === null) {
    return `## Admiral — triggered, acts and exits\n\n**ADMIRAL TRIGGER BROKEN** — launcher did not run (${r.error ? String(r.error.message).slice(0, 120) : 'killed'}). No condition was evaluated this run; this is not a quiet fleet.\n`
  }
  return (r.stdout || '').trim() || null
}

// The four checks (#136, under D0017). Scope is every repo in the policy file — all
// seven project repos, not the hub alone — which is @jwildfire's directive and also
// the only reason last night's failure is detectable by a machine at all: those six
// issues were invisible because they sat in a spoke repo and the nightly audit read
// only the hub.
//
// A repo that fails to read is named in the section rather than skipped silently. A
// check that quietly covers six of seven repos and prints "clean" is worse than no
// check, because the reader takes it as complete.
// `jobs` is `null` when `~/.claude/jobs` could not be read — distinct from `[]`,
// which means it was read and no agent has run (jwildfire/obot.roadmap#223).
function runChecks(repos, jobs = []) {
  const items = []
  const errors = []
  // Ready work, for the idle detection: counted off the query that was already
  // running rather than off a listing of its own (hub#212).
  let backlog = 0
  let backlogCapped = false
  for (const { repo } of repos) {
    const [owner, name] = repo.split('/')
    try {
      const data = JSON.parse(gh(['api', 'graphql', '-f', `query=${ORPHAN_QUERY}`,
        '-F', `owner=${owner}`, '-F', `name=${name}`])).data
      items.push(...shapeRepo(repo, data))
      const ready = readyBacklog(data)
      backlog += ready.count
      backlogCapped = backlogCapped || ready.capped
    } catch (e) {
      errors.push(`${repo}: ${String(e.message).slice(0, 90)}`)
      // A repo that failed to read contributes no backlog, and saying the queue is
      // smaller than it is would be the wrong direction to fail in — it turns the
      // idle detection off. Named here so the count is never read as complete.
      backlogCapped = true
    }
  }

  // A pull request can state its issue and the per-repo query can still not have
  // returned that issue: the hub alone has 113 open and the query takes 100. One
  // aliased call settles every such reference at once (obot.agent#225). A reference
  // this fails to settle stays unverified in the row rather than counting as covered,
  // and what the cap dropped is named here rather than swallowed.
  const now = new Date()
  let resolved = new Map()
  const { refs: toLookUp, dropped } = unresolvedRefs(items, now)
  if (dropped) errors.push(`${dropped} stated reference(s) not looked up this sweep — the lookup is capped; those rows read as unresolved rather than covered`)
  const lookup = refLookupQuery(toLookUp)
  if (lookup) {
    try {
      resolved = parseRefLookup(toLookUp, JSON.parse(gh(['api', 'graphql', '-f', `query=${lookup}`])).data)
    } catch (e) {
      errors.push(`stated-reference lookup: ${String(e.message).slice(0, 90)} — ${toLookUp.length} reference(s) unverified, reported as such`)
    }
  }

  // The decision registry against the index the site publishes from (hub#196): two
  // files answer "has he decided this" and until now nothing compared them.
  let registry = []
  try {
    const reg = readJson(join(HUB, 'reports/decisions/registry.json'))
    const idx = parseIndexRows(readFileSync(join(HUB, 'reports/decisions/README.md'), 'utf8'))
    if (reg && idx.length) registry = registryDisagreement(reg, idx)
    else errors.push('decision registry or index unreadable')
  } catch (e) {
    errors.push(`decisions: ${String(e.message).slice(0, 90)}`)
  }

  // Agents that finished having produced nothing. Local job records, no API calls.
  let closeouts = []
  try {
    // An absent `~/.claude/jobs` used to arrive as `[]` and contribute a silent zero
    // to the clean verdict above — "agents that finished having produced nothing"
    // was none because nothing was read (jwildfire/obot.roadmap#223).
    if (jobs === null) errors.push(`no job ledger at ${JOBS_DIR} — closeouts are not being checked on this machine; the first background agent creates it`)
    else closeouts = emptyCloseouts(jobs, new Date())
  } catch (e) {
    errors.push(`jobs: ${String(e.message).slice(0, 90)}`)
  }

  // How old the thing this design leans on actually is. The 2026-08-16 investigation
  // found the audit had not run at all while its day-old output was being quoted as
  // this morning's board state; the file has always carried its timestamp and nothing
  // ever made a reader look at it.
  const audit = auditFreshness(readJson(join(HUB, 'site/audit/findings.json')), new Date())

  // And what the deployed site says about itself — the verdict the header is showing,
  // quoted rather than recomputed here (hub#224).
  const site = siteVersionFreshness(readSiteVersion(), new Date())

  return {
    backlog,
    backlogCapped,
    // The closed issues this pass already fetched, handed on rather than re-fetched
    // (jwildfire/obot.roadmap#257). `ORPHAN_QUERY` already asks for `number title
    // closedAt labels` on every CLOSED issue, so the closure detector costs no call
    // — and, more importantly, one reader means the discipline checks and the
    // completion detector can never disagree about what closed.
    items,
    // Whether the hub itself was read. A repo that failed leaves `errors` behind and
    // an unread hub must never render as "every closed requirement covered".
    read: !errors.some((e) => e.startsWith(`${HUB_REPO}:`)),
    section: checksSection({
      audit,
      site,
      orphans: orphanedWork(items, now, resolved),
      orphansOutsideWindow: orphansOutsideWindow(items, now, resolved),
      orphansAccepted: orphansAccepted(items, resolved),
      registry,
      closeouts,
      errors,
    }, now),
  }
}

/**
 * The wake (hub#212): every worker that stopped, and one line each to the Navigator.
 *
 * Ordering is the whole safety property. The pending list is computed and rendered
 * whether or not anything is delivered, and the channel's own state is rendered
 * beside it, so the section can never read as a judged fleet because the delivery
 * lane broke. Delivery is last and cannot change what the section says.
 */
function runWake(jobs, { backlog, backlogCapped, prevSweptIso, completions = [], unapplied = [] }) {
  // `null` means the job ledger is not on this machine; every detector below reads
  // it, so the section has to say that rather than report a clear channel.
  const jobsRead = jobs !== null
  jobs = jobs ?? []
  const now = new Date()
  const away = hostWasAway(prevSweptIso, now)
  const judged = judgedWorkers(safeRead(DELIVERY_JOURNAL))
  // `workspace` is what separates this workspace's roles from a session that merely
  // carries a role's name (obot.agent#188). Four fixture admirals in `mkdtemp`
  // workspaces produced four WAITING detections on this channel, which is exactly
  // the kind of noise that teaches a reader to stop reading it.
  const detections = pendingWakes(jobs, { now, judged, hostWasAway: away, workspace: WS })
  // What the gate refused to believe (obot.agent#176). Reported beside the pending
  // list and never delivered: a suppression that produces no output is
  // indistinguishable from a gate that never ran, which is this programme's own
  // recurring defect and not one to reproduce inside the fix for it.
  const misread = misreadHolds(jobs, { now, hostWasAway: away, workspace: WS })
  const idle = idleDetection(jobs, { now, backlog, backlogCapped, pendingCount: detections.length, hostWasAway: away })
  const all = idle ? [...detections, idle] : detections

  const listener = listenerState(WAKE_BEAT, now)
  const log = parseLog()
  const { deliver, held } = deliverable(all, log, now)

  // Completions ride the same channel and are budgeted SEPARATELY (hub#257). Sharing
  // the per-run cap would let a fleet with three unjudged closeouts starve the one
  // notification that reaches a person — which is the failure being fixed, arriving
  // by a new route. They are once-only rather than floored, so the cap is a burst
  // limit and nothing is lost: what it holds goes out on the next sweep.
  const { deliver: shipped, held: shipHeld } =
    deliverable(completions, log, now, { max: MAX_COMPLETIONS_PER_RUN })

  // And an answer of his that nothing has applied (jwildfire/obot.roadmap#241). Its
  // own budget again, and NOT once-only: a completion is an event and a decision
  // waiting on an agent is a condition, so this one keeps going on its floor until
  // `ops-answers apply` silences it. That is the whole difference between this and
  // the nine hours of 2026-08-16, where the same finding was recomputed 105 times
  // into a file and delivered to nobody.
  const { deliver: answers, held: answersHeld } =
    deliverable(unapplied, log, now, { max: MAX_ANSWERS_PER_RUN })

  for (const d of [...deliver, ...shipped, ...answers]) {
    try { appendFileSync(WAKE_LOG, `${wakeLine(d, now.toISOString())}\n`) } catch { /* the section still carries it */ }
  }

  return {
    delivered: deliver,
    completions: shipped,
    answers,
    section: wakeSection({
      pending: all,
      delivered: deliver,
      held,
      listener,
      outside: outsideWindow(jobs, { now, judged }),
      misread,
      jobsRead,
      completions: shipped,
      completionsHeld: shipHeld,
      answers,
      answersHeld,
      awayNote: away
        ? `host was away — no sweep for ${Math.round((now - Date.parse(prevSweptIso)) / 60000)}m, so stalled/waiting/idle are suppressed this run; a detector cannot run on a suspended host`
        : null,
    }),
    note: `${all.length} pending, ${deliver.length} delivered, ${shipped.length} completion(s) sent, ${answers.length} unapplied answer(s) sent, ${misread.length} misread suppressed, channel ${listener.armed ? 'armed' : 'DOWN'}`,
  }
}

const safeRead = (f) => { try { return readFileSync(f, 'utf8') } catch { return '' } }

/**
 * The wake log's recent tail, for the re-wake floors.
 *
 * The file is append-only and stays that way — it is the record of what was
 * delivered, and rotating it to keep a read cheap would trade a permanent record
 * for a five-minute saving. Instead only the last stretch is read, which is all
 * the floors need: the longest is an hour, and this holds days. A cut first line
 * simply fails the line pattern and is ignored.
 */
const WAKE_TAIL_BYTES = 128 * 1024
function readWakeTail() {
  try {
    const size = statSync(WAKE_LOG).size
    if (size <= WAKE_TAIL_BYTES) return safeRead(WAKE_LOG)
    const fd = openSync(WAKE_LOG, 'r')
    try {
      const buf = Buffer.alloc(WAKE_TAIL_BYTES)
      readSync(fd, buf, 0, WAKE_TAIL_BYTES, size - WAKE_TAIL_BYTES)
      return buf.toString('utf8')
    } finally { closeSync(fd) }
  } catch { return '' }
}
const parseLog = () => parseWakeLog(readWakeTail())

// The worker ledger: is the W-id convention actually being applied? (#130)
//
// This is the one that would otherwise be invisible. The other checks ask whether
// the ledger is internally sound; this one asks whether any worker is using it —
// a capability that ships, gets wired in, reports success every run and is never
// called by a spawn looks exactly like one that works.
const auditWorkers = () => shellAudit('worker-id')

function fetchRC(repo, pr) {
  const detail = JSON.parse(gh(['pr', 'view', String(pr.number), '-R', repo, '--json', 'reviews,comments,reviewDecision']))
  let inline = 0
  try { inline = Number(gh(['api', `repos/${repo}/pulls/${pr.number}/comments?per_page=100`, '--jq', 'length']).trim()) } catch { /* count stays issue-comments-only */ }
  return {
    repo, number: pr.number, title: pr.title, url: pr.url, base: pr.baseRefName,
    reviewDecision: detail.reviewDecision || pr.reviewDecision || '',
    reviews: (detail.reviews || []).map(r => ({ author: r.author?.login || '?', state: r.state, submittedAt: r.submittedAt, excerpt: excerpt(r.body) })),
    commentCount: (detail.comments || []).length + inline,
  }
}

function scratchpad(msg) {
  try { execFileSync('bash', [SCRATCHPAD_LOG, '🧭🤖 nav', msg], { encoding: 'utf8', timeout: 15000 }) } catch { /* scratchpad is best-effort */ }
}

function log(msg) {
  try {
    try { if (statSync(LOG).size > 512 * 1024) writeFileSync(LOG, '') } catch { /* no log yet */ }
    appendFileSync(LOG, `${nowStamp()} ${msg}\n`)
  } catch { /* logging is best-effort */ }
}

const safePending = () => { try { return pendingAnswers(WS, { hub: HUB }) } catch { return [] } }
const safeLedger = () => { try { return auditLedger() } catch { return null } }
const safeWorkers = () => { try { return auditWorkers() } catch { return null } }
const safeDelivery = () => { try { return readDelivery() } catch { return null } }
// The constraint reading (obot.agent#293). Pure file reads — the constraint journal, the
// delivery record, the worker journal and the job ledger — so it cannot stall the sweep;
// it is wrapped anyway, because a section that throws would take the whole state file with
// it and a missing section reads as a page with nothing to report.
const safeConstraints = () => {
  try { return constraintsSection(collectConstraints({ ws: WS, jobs: JOBS_DIR })) }
  catch (e) { return constraintsBroken(String(e.message).slice(0, 160)) }
}
const safeChecks = (repos, jobs) => { try { return runChecks(repos, jobs) } catch { return null } }
// `null` when the job ledger is not on this machine at all — distinct from `[]`,
// which means it was read and no agent has run. `readJobs` (wake.mjs) flattens both
// to an empty list, and the difference is what keeps an unread directory out of the
// discipline verdict below (jwildfire/obot.roadmap#223).
const safeJobs = () => {
  if (!existsSync(JOBS_DIR)) return null
  try { return readJobs(JOBS_DIR) } catch { return null }
}
// A broken trigger must not break the sweep, and must not fail quietly either — an
// admiral section that simply vanished would read as a page with nothing to report.
// The launcher reads the job ledger itself rather than taking this one, so the
// null-versus-empty distinction above is not in its path.
// The update step, which must never be able to take the sweep down with it — and must
// never fail quietly either. A section that simply vanished would read as a machine
// that is current, which is the exact failure this step exists to end.
const safeSelfUpdate = () => {
  try {
    return selfUpdate({ root: REPO_ROOT, workspace: WS, stamp: SELF, logFile: DASHBOARD_LOG })
  } catch (e) {
    // The record is built where the knowledge is (obot.agent#231). This catch used to
    // synthesise one from nothing, which is how the section came to assert "The
    // checkout is untouched" on sweeps where the fast-forward had already moved it.
    return brokenRecord({ root: REPO_ROOT, stamp: SELF, error: e })
  }
}

// The local-state reading (obot.agent#240). Same contract as everything above it: a
// broken reading must not take the sweep down and must not vanish either, because a
// section that disappeared would read as a machine with nothing local to report —
// which is precisely the state four separate instances were in when nobody found them.
const safeLocal = (repos) => {
  try {
    return localSection(collectLocal({ repos, ws: WS, cacheFile: LOCALWATCH_CACHE, jobsDir: JOBS_DIR }))
  } catch (e) {
    return `## Local-only work — what exists on this machine and not on GitHub\n\n**LOCAL WORK READING BROKEN** — ${String(e.message).slice(0, 160)}. No worktree, branch or checkout was read this run; this is not a clean machine.\n`
  }
}

// Commit attribution across the checkouts on this machine (obot.agent#241). Every
// repo is read independently: one unreadable checkout reports itself as unread and the
// rest still report, because a directory that is not a repository is unknown rather
// than clean (jwildfire/obot.roadmap#215).
const safeIdentity = (repos, sweptAt) => {
  const reports = repos.map(({ repo }) => {
    const name = repo.split('/').pop()
    const dir = join(WS, name)
    try {
      return { repo: name, ...misattributed(scanCommits(dir, { sinceDays: IDENTITY_WINDOW_DAYS })) }
    } catch (e) {
      return { repo: name, error: String(e.message).split('\n')[0].slice(0, 120) }
    }
  })
  return renderIdentity(reports, { stamp: `[git ${sweptAt.slice(-5)}]` })
}

// The claim-currency pass (obot.agent#262). It runs commands, so it is the reading
// most able to hang — every command is bounded, the pass is bounded, and the whole
// thing is contained here so a slow `gh` call costs a section rather than the sweep.
const safeCurrency = async () => {
  try { return (await readCurrency(WS, HUB)).section } catch (e) {
    return `## Claim currency — what has been re-checked, and when\n\n**CLAIM CHECK BROKEN** — ${String(e.message).slice(0, 160)}. No config item's claim and no decision premise was checked this run; this is not a current record.\n`
  }
}

// The spend reading (jwildfire/obot.roadmap#275). It shells out to the usage
// generator on a TTL, so like the currency pass it is bounded and contained here: a
// slow or missing python3 costs a section and a halt-file decision, never the sweep.
// It is the only reading that WRITES as well as reads — `.claude/autonomy-halt`, the
// switch obot-auto and the morning fold already honour — which is what makes the cap
// enforcement rather than advice.
const safeSpend = () => {
  try {
    const r = readSpend({ workspace: WS, hub: HUB, repoRoot: REPO_ROOT })
    const halt = applyHalt(WS, r.verdict, { log })
    writeVerdict(WS, r.verdict)
    // `scratchpad` supplies the 🧭🤖 nav tag itself — passing one here prints it twice.
    if (halt.wrote) scratchpad(`spend cap: dispatch parked, .claude/autonomy-halt written — ${r.verdict.why}`)
    if (halt.cleared) scratchpad('spend cap: reading cleared, .claude/autonomy-halt lifted')
    return r
  } catch (e) {
    return { note: spendBrokenNote(String(e.message)), section: spendBroken(String(e.message)) }
  }
}

const safeAdmiral = () => {
  try { return runAdmiral() } catch (e) {
    return `## Admiral — triggered, acts and exits\n\n**ADMIRAL TRIGGER BROKEN** — ${String(e.message).slice(0, 160)}. No condition was evaluated this run; this is not a quiet fleet.\n`
  }
}

const safeCarveout = () => {
  try { return runCarveout() } catch (e) { return routingBroken(String(e.message)) }
}

/**
 * The ranked head, read from this checkout's `rank/top10.json` and from GitHub.
 *
 * Two `gh api` calls and a `git log`. It never writes, never files a config item and
 * never names a replacement — the whole of its output is a statement about what the
 * next ten currently are and whether anything has changed underneath the order.
 */
const safeRankhead = () => {
  try { return rankheadSection(collectRankHead(REPO_ROOT)) } catch (e) { return rankheadBroken(String(e.message)) }
}
/**
 * The car lane (jwildfire/obot.roadmap#265) — and the reason it is the SWEEP that polls it.
 *
 * Nothing has ever polled the Reminders list Siri writes to: no LaunchAgent, no cron,
 * not the fold, which skips it on purpose because `osascript` "can stall on a permission
 * prompt". That objection is answered rather than argued with — `osascriptRunner` is
 * bounded by a hard timeout and reports a failure as a failed read — but it is still his
 * grant to give, so this polls only when something explicitly armed it and says which
 * state it is in either way.
 *
 * It is here rather than in its own LaunchAgent because a lane that answers his decisions
 * needs the same five-minute clock as the sweep that announces them, and because a second
 * scheduled process is a second thing that can be quietly dead.
 */
const safeVoice = () => {
  try {
    const armed = voiceArmed(WS)
    const snapshot = voiceQueue(WS)
    const poll = armed
      ? pollReminders({ workspace: WS, hub: HUB, queue: snapshot.queue })
      : { read: true, why: '', routed: [], unrouted: [], stale: [], unstamped: [] }
    // The read flag is carried, not dropped: an unreadable store rendered as a clean
    // lane, which is a positive claim about his sentences made from a failed read.
    const store = readUnrouted(WS)
    return unroutedSection(store.items, {
      read: store.read,
      why: store.why,
      lane: {
        armed,
        read: poll.read,
        why: poll.why,
        routed: poll.routed.length,
        stale: (poll.stale ?? []).length,
        unstamped: (poll.unstamped ?? []).length,
        queueRead: snapshot.read,
        queueWhy: snapshot.why,
      },
    })
  } catch (e) {
    return '## Voice answers that reached no decision — his words, kept whole\n\n'
      + `**VOICE LANE READING BROKEN** — ${String(e.message).slice(0, 160)}. Nothing he dictated was routed this run; this is not a quiet lane.\n`
  }
}
/**
 * Does every open decision have an episode he could answer from a car?
 *
 * Read-only and offline: the registry and the artifact pages come out of the hub clone
 * the checkout sweep already fast-forwards, and the ledger is local. Nothing here
 * produces an episode — it reports that one is owed, which is the whole point of
 * jwildfire/obot.roadmap#280 being a standing property rather than a batch somebody runs.
 */
const safeEpisodes = () => {
  try {
    return episodesSection(episodeCoverage({ hub: HUB, workspace: WS, now: new Date() }), { now: new Date() })
  } catch (e) {
    return '## Decision episodes — an open decision he can answer from the car\n\n'
      + `**DECISION EPISODE READING BROKEN** — ${String(e.message).slice(0, 160)}. Whether an open decision is `
      + 'waiting without an episode is unknown; this is the absence of the reading, not a finding that none is owed.\n'
  }
}
// A broken wake must not break the sweep, and must not fail quietly either: the
// section says the channel is unreadable rather than saying nothing.
const safeWake = (jobs, opts) => {
  try { return runWake(jobs, opts) } catch (e) {
    return { delivered: [], completions: [], answers: [], note: `wake broken: ${String(e.message).slice(0, 80)}`,
             section: `## Wake — workers that stopped, and what completed\n\n**WAKE CHECK BROKEN** — ${String(e.message).slice(0, 160)}. No worker stop-state was read this run; this is not a quiet fleet.\n` }
  }
}

/**
 * The landing record (jwildfire/obot.roadmap#257): what he was promised, and what
 * reached him. Shelled like the ledger audits, for the same reason — the tool that
 * owns the record owns the reading of it, so what this file renders and what was
 * actually written can never disagree.
 *
 * `null` on any failure, and every consumer says "unknown, not clean" when it gets
 * one. Nothing here ever reports an unread record as a quiet day.
 */
const landingTool = (args, timeout = 20000) => spawnSync(join(REPO_ROOT, 'tools', 'landing-log'), args,
  { env: { ...process.env, OBOT_WORKSPACE: WS }, encoding: 'utf8', timeout })

const safeLandingState = () => {
  try {
    const r = landingTool(['list', '--json'])
    if (r.error || r.status !== 0) return null
    return JSON.parse(r.stdout || 'null')
  } catch { return null }
}

/**
 * Go and LOOK at what he was promised — the half of #257 that cannot be delegated
 * to anyone's assertion. Bounded by the tool itself (a handful of landings per run,
 * each re-checked at most twice an hour), so a promise list that grows can never
 * hold the five-minute cadence open on the network.
 *
 * Its output is not rendered: `list --json` is read afterwards and carries the
 * observations this wrote. Failure is silent here on purpose — an unfetched landing
 * shows up as `unchecked` in the record, which is the honest answer, rather than as
 * a broken section about a check nobody asked to see.
 */
const safeLandingCheck = () => {
  // Two bounds, and the inner one is what actually holds: the tool spends at most its
  // own wall-clock budget looking, and this spawn timeout is the backstop for a tool
  // that somehow does not return at all. A count cap alone would let five landings
  // against a black-holing host cost a minute of a five-minute cadence whose contract
  // is the release-candidate queue rather than this.
  try { landingTool(['check'], 30000) } catch { /* the record says `unchecked`, which is true */ }
}

const safeLandingRender = () => {
  try {
    const r = landingTool(['render'])
    if (r.error || r.status !== 0) return null
    return (r.stdout || '').trim() || null
  } catch { return null }
}

async function main() {
  const sweptAt = nowStamp()
  const sweptIso = new Date().toISOString()
  let prevWrap = { lastGoodAt: null, snapshot: {}, events: [] }
  // Whether this machine has ever completed a sweep. An absent snapshot and a
  // snapshot of an empty queue are different states and must not diff the same way.
  let firstSweep = false
  try { prevWrap = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) } catch { firstSweep = true }
  const jobs = safeJobs()
  // First, before anything reads the network: move the checkout, and restart what
  // reads it. First because everything below shells tools out of this same checkout,
  // so the run should be standing on the code it is about to report — and because a
  // merge he is waiting on should not sit behind a minute of `gh` calls.
  const update = safeSelfUpdate()
  const selfupdate = renderSelfUpdate(update)

  let repos
  try {
    repos = discoverRepos(JSON.parse(readFileSync(POLICY, 'utf8')))
  } catch (e) {
    const meta = { sweptAt, cadenceMin: CADENCE_MIN, repoCount: 0, ok: false, errors: [`policy.json: ${e.message}`], lastGoodAt: prevWrap.lastGoodAt }
    // The success path creates this directory further down, so on a machine where
    // the sweep has never completed this write used to throw ENOENT and the whole
    // process died having reported nothing. The dashboard then showed "No sweep
    // file yet", which reads as "not installed" when the truth is "installed,
    // firing every five minutes, and crashing each time" (jwildfire/obot.roadmap#223).
    mkdirSync(dirname(STATE_MD), { recursive: true })
    // A sweep that cannot read the policy still reports his answers: they come
    // from the local store, and a failed RC sweep is no reason to imply there is
    // nothing waiting on an agent.
    // The wake runs even here. It reads local job records and the delivery journal,
    // neither of which needs the policy file, and a worker that stopped is exactly
    // as unjudged when the RC sweep is broken.
    // The landing record runs even here. It is local, it needs no policy file, and a
    // completion he has not been told about is exactly as undelivered when the RC
    // sweep is broken. GitHub was NOT read on this path, so `read: false` — the
    // verdict says so rather than claiming every closed requirement is covered.
    const failState = safeLandingState()
    const wake = safeWake(jobs, { backlog: 0, backlogCapped: true, prevSweptIso: prevWrap.sweptIso,
      completions: failState ? completionDetections(failState.closures ?? [], { now: new Date() }) : [],
      // His unapplied answers reach the channel on this path too. They come off the
      // local store, they need no policy file, and an answer of his that nothing has
      // applied is exactly as undelivered when the RC sweep is broken.
      unapplied: unappliedDetections(safePending()) })
    writeFileSync(STATE_MD, renderState({ snapshot: prevWrap.snapshot, events: prevWrap.events, meta, answers: safePending(), ledger: safeLedger(), workers: safeWorkers(), delivery: safeDelivery(), checks: safeChecks([], jobs)?.section, wake: wake.section, selfupdate, admiral: safeAdmiral(), carveout: safeCarveout(), identity: null, currency: await safeCurrency(), rankhead: safeRankhead(), spend: safeSpend(), landings: safeLandingRender(), landingsVerdict: landingsNote({ missing: [], state: failState, read: false, now: new Date() }), voice: safeVoice(), decisionEpisodes: safeEpisodes(), constraints: safeConstraints() }))
    log(`FAILED policy.json: ${e.message} · wake: ${wake.note}`)
    process.exit(0)
  }

  const next = {}
  const failedRepos = new Set()
  const errors = []
  for (const { repo, release } of repos) {
    try {
      const prs = JSON.parse(gh(['pr', 'list', '-R', repo, '--state', 'open', '--json', 'number,title,url,baseRefName,isDraft,reviewRequests,reviewDecision,updatedAt']))
      for (const pr of prs.filter(pr => classifyRC(pr, release))) {
        next[`${repo}#${pr.number}`] = fetchRC(repo, pr)
      }
    } catch (e) {
      failedRepos.add(repo)
      errors.push(`${repo}: ${String(e.message).slice(0, 120)}`)
      for (const [key, old] of Object.entries(prevWrap.snapshot)) if (old.repo === repo) next[key] = old
    }
  }

  const goneStates = {}
  for (const [key, old] of Object.entries(prevWrap.snapshot)) {
    if (next[key] || failedRepos.has(old.repo)) continue
    try { goneStates[key] = JSON.parse(gh(['pr', 'view', String(old.number), '-R', old.repo, '--json', 'state'])).state } catch { goneStates[key] = 'unknown' }
  }

  const events = diff(prevWrap.snapshot, next, goneStates, failedRepos, { baseline: firstSweep })

  // The other half of the sweep: hand over the decision answers he has recorded
  // (#120). Bookkeeping still — the Navigator announces, it never applies — but
  // it is the only thing running when no session is, so without this an answer
  // sits in the ops store until he asks about it, which is the failure this
  // capability exists to end. A broken answer store must not break the RC sweep.
  let answers = []
  let answerEvents = []
  try {
    answerEvents = deliverAnswers(WS, { hub: HUB }).events
    answers = pendingAnswers(WS, { hub: HUB })
  } catch (e) {
    errors.push(`answers: ${String(e.message).slice(0, 120)}`)
  }

  const hhmm = sweptAt.slice(-5)
  // Provenance is per source: RC events are verified against GitHub, answer
  // events come off the local ops store. One stamp for both would be a lie.
  //
  // `ts` is the full ISO instant. The `at` clock reads fine in a file swept every
  // five minutes, but the snapshot now outlives the day, and "10:41" with no date
  // is unanswerable the morning after — the exact question the feed exists for.
  const stamped = [
    ...events.map(e => ({ ...e, stamp: `[verified gh ${hhmm}]` })),
    ...answerEvents.map(e => ({ ...e, stamp: `[ops store ${hhmm}]` })),
  ].map(e => ({ ...e, at: hhmm, ts: new Date().toISOString() }))
  const allEvents = [...stamped.reverse(), ...(prevWrap.events || [])].slice(0, FEED_EVENTS)

  // A broken ledger check must not break the RC sweep, exactly as a broken answer
  // store must not: this is an extra pair of eyes, never a precondition.
  let ledger = null
  try { ledger = auditLedger() } catch (e) { errors.push(`ledger: ${String(e.message).slice(0, 120)}`) }
  let workers = null
  try { workers = auditWorkers() } catch (e) { errors.push(`workers: ${String(e.message).slice(0, 120)}`) }
  let delivery = null
  try { delivery = readDelivery() } catch (e) { errors.push(`delivery: ${String(e.message).slice(0, 120)}`) }
  // Commit attribution across the checkouts. It runs here, with the other readings and
  // before `ok` is decided, so a scan that throws is an error on the sweep rather than a
  // silently missing section.
  let identity = null
  try { identity = safeIdentity(repos, sweptAt) } catch (e) { errors.push(`identity: ${String(e.message).slice(0, 120)}`) }
  let checks = null
  let backlog = 0
  let backlogCapped = true // until a run proves otherwise, the queue is a floor
  // The closed issues this pass read, kept for the closure detector below. `null`
  // rather than `[]` because "no issue closed" and "no repo was read" are different
  // facts and only one of them is a clean pass (jwildfire/obot.roadmap#223).
  let closedItems = null
  let hubRead = false
  try {
    const c = runChecks(repos, jobs)
    checks = c.section
    backlog = c.backlog
    backlogCapped = c.backlogCapped
    closedItems = c.items
    hubRead = c.read
  } catch (e) { errors.push(`checks: ${String(e.message).slice(0, 120)}`) }
  // The gap check rides along with the record itself: a finding is prepended to
  // the section so it cannot be read as a quiet day.
  let deliveryAudit = null
  try { deliveryAudit = auditDelivery() } catch { /* an extra pair of eyes, never a precondition */ }
  if (delivery && deliveryAudit && !deliveryAudit.ok) {
    delivery = `**DELIVERY RECORD GAP** — ${deliveryAudit.summary}\n\n${delivery}`
  }

  // Release metrics, refreshed hourly on this five-minute ride. A failed refresh
  // costs freshness, never the sweep: the old cache keeps its honest fetchedAt and
  // the renderer shows the age. Not an error even when it fails — the RC queue is
  // this sweep's contract, the metrics are a passenger.
  let metricsNote = 'skipped'
  try {
    mkdirSync(dirname(METRICS), { recursive: true })
    const r = refreshMetrics({
      repos, hub: HUB, cacheFile: METRICS, ttlMin: METRICS_TTL_MIN,
      read: (f) => readFileSync(f, 'utf8'), write: (f, body) => writeFileSync(f, body),
    })
    metricsNote = r.refreshed ? 'refreshed' : (r.failed ? `refresh failed (${r.failed.length})` : 'cached')
  } catch (e) {
    metricsNote = `broken: ${String(e.message).slice(0, 80)}`
  }

  // What he was promised and what reached him (jwildfire/obot.roadmap#257). The
  // ORDER here is the whole safety property, and it mirrors the wake's own:
  //
  //   1  GO AND LOOK at every landing that is due one. This is the step nobody can
  //      assert their way past — the org chart was "being drafted" for a day while
  //      the page returned 404, and no report from anyone would have caught that.
  //   2  read the record back, once, and give the same reading to the detector, the
  //      wake and the file. Two readers is how the detector and the channel would
  //      come to disagree about what completed.
  //   3  compare GitHub's closed requirements against it, so a closure with no
  //      sentence is a finding rather than a silence.
  //
  // Delivery is last and cannot change what any of it says.
  safeLandingCheck()
  const landingState = safeLandingState()
  const now = new Date()
  const missing = (closedItems && landingState)
    ? unsummarised(closedRequirements(closedItems, { repo: HUB_REPO, now }),
                   landingState.closures ?? [])
    : []
  const landingsVerdict = landingsNote({ missing, state: landingState, read: hubRead, now })
  const completions = landingState
    ? completionDetections(landingState.closures ?? [], { now })
    : []

  // The wake, last of the readings and first in the file. It writes to the log the
  // Navigator's Monitor tails; everything it found is in the section either way.
  const wake = safeWake(jobs, { backlog, backlogCapped, prevSweptIso: prevWrap.sweptIso, completions,
    unapplied: unappliedDetections(answers) })

  const ok = errors.length === 0
  const meta = { sweptAt, cadenceMin: CADENCE_MIN, repoCount: repos.length, ok, errors, lastGoodAt: ok ? sweptAt : prevWrap.lastGoodAt }
  mkdirSync(dirname(SNAPSHOT), { recursive: true })
  // The admiral trigger runs last of the readings, after the wake, because an admiral
  // it launches will read the state file this run is about to write.
  // Routing runs BEFORE the admiral, and the order is load-bearing: a config item
  // raised this pass is what stops the admiral escalating the same pull request in
  // the same pass, rather than five minutes later.
  const carveout = safeCarveout()
  const admiral = safeAdmiral()
  const local = safeLocal(repos)
  const currency = await safeCurrency()
  const rankhead = safeRankhead()
  const spend = safeSpend()
  writeFileSync(STATE_MD, renderState({ snapshot: next, events: allEvents, meta, answers, ledger, workers, delivery, checks, wake: wake.section, admiral, carveout, selfupdate, local, identity, currency, rankhead, spend, landings: safeLandingRender(), landingsVerdict, voice: safeVoice(), decisionEpisodes: safeEpisodes(), constraints: safeConstraints() }))
  // `sweptIso` is the host guard's only input: the gap between two sweeps is what
  // separates a suspended laptop from a stalled fleet, and the local `sweptAt`
  // string cannot be differenced across a timezone or a date boundary.
  writeFileSync(SNAPSHOT, JSON.stringify({ lastGoodAt: meta.lastGoodAt, sweptIso, snapshot: next, events: allEvents }, null, 2))

  for (const e of stamped.slice(0, 5)) scratchpad(e.line)
  // Delivered wakes reach the shared scratchpad too, as ONE line per sweep rather
  // than one per wake. The notification is the Navigator's; this line is everyone
  // else's — the wrapup folds the scratchpad, so a wake that produced no verdict is
  // visible the next morning rather than lost with the session that received it.
  // One line because the scratchpad is shared by every session and the wrapup reads
  // all of it: six pending stop-states on a 30-minute floor would otherwise write a
  // line every few minutes all day. The detail is in the wake log and the state file.
  if (wake.delivered.length) {
    scratchpad(`WAKE x${wake.delivered.length} delivered — ${wake.delivered.map(d => `${d.worker} ${d.kind}`).join(', ')}`)
  }
  log(`${ok ? 'ok' : 'PARTIAL'} — ${repos.length} repos, ${Object.keys(next).length} RCs, ${events.length} events, ${answers.length} answers pending (${answerEvents.length} handed over, ${wake.answers?.length ?? 0} woken) · workers: ${workers ? (workers.ok ? 'clean' : 'FINDING') : 'no reading'} · wake: ${wake.note} · metrics: ${metricsNote} · checkout: ${update.checkout.code}${update.consumers?.map(c => ` · ${c.id}: ${c.code}`).join('') ?? ''}${errors.length ? ' · ' + errors.join('; ') : ''}`)
}

// `main` awaits the claim-currency pass, so it returns a promise. A rejection here has
// to be loud: a sweep that dies after writing nothing looks exactly like a sweep that
// never fired, and the stale rule would then blame the observer.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { log(`FAILED sweep threw: ${String(e?.stack ?? e).slice(0, 400)}`); process.exitCode = 1 })
}
