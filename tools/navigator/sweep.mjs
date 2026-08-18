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

import { answersSection, deliverAnswers, pendingAnswers } from '../ops-dashboard/lib/answers.mjs'
import { ORPHAN_QUERY, auditFreshness, checksSection, emptyCloseouts, orphanedWork,
         orphansAccepted, orphansOutsideWindow, parseIndexRows, readJson, registryDisagreement,
         shapeRepo, siteVersionFreshness } from './checks.mjs'
// What counts as a release candidate now lives beside this file rather than in it,
// because the Operations Dashboard has to answer the same question and used to answer
// it differently. Re-exported so this module's callers and tests are unaffected.
import { classifyRC, discoverRepos, POLICY_FILE } from './classify.mjs'
import { refreshMetrics } from './metrics.mjs'
// The checkout this machine runs from, and the consumers that read it
// (jwildfire/obot.roadmap#243). Merging is not deploying here: everything runs from
// the local checkout and a merge to `main` does not move it, so the sweep — already
// walking past it every five minutes — fast-forwards it and restarts what reads it.
// Fast-forward only; every refusal is reported and nothing is ever forced.
import { buildStamp, renderSelfUpdate, selfUpdate } from './selfupdate.mjs'
// The wake (hub#212). The sweep already knew a worker had stopped; what it could not
// do was get the Navigator's attention, so workers stopped and then waited — twenty
// minutes on 2026-08-16, six hours on 2026-08-17. Detection and delivery live in
// wake.mjs; this file supplies the readings and appends the log the Navigator tails.
import { hostWasAway, idleDetection, judgedWorkers, listenerState, outsideWindow,
         deliverable, parseWakeLog, pending as pendingWakes, readJobs, readyBacklog,
         wakeLine, wakeSection } from './wake.mjs'

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

export function renderState({ snapshot, events, meta, answers = [], ledger = null, workers = null, delivery = null, checks = null, wake = null, admiral = null, selfupdate = null }) {
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

  // And directly under the pair: what code produced any of this. It sits third rather
  // than first because the wake is about somebody waiting and this is about the
  // machine, but it belongs above the queue for the same reason a build stamp belongs
  // next to the numbers — everything below was written by the commit this names, and
  // until 2026-08-17 nothing here named it (jwildfire/obot.roadmap#243).
  lines.push((selfupdate && selfupdate.trim())
    ? selfupdate.trimEnd()
    : '## Checkout — the code this machine is running\n\n**AUTO UPDATE BROKEN** — no update ran this sweep, so nothing here says the checkout is current or that a merge would reach him.', '')

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

  // The Navigator session's own record, folded in whole (D0017, 2026-08-16). Two
  // writers, two files: the session appends to delivery.md and never touches this
  // one; the sweep reads that file and never writes it. They rejoin here because
  // the dashboard's Navigator tab already renders any heading this file carries,
  // so the delivery record reaches him with no rendering code at all.
  lines.push('', (delivery && delivery.trim())
    ? delivery.trimEnd()
    : '## Delivery\n\n- **NO READING** — the delivery record could not be read this sweep, so no worker has been judged. That is the absence of the record, not a finding that nobody delivered.')

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

  const now = new Date()
  return {
    backlog,
    backlogCapped,
    section: checksSection({
      audit,
      site,
      orphans: orphanedWork(items, now),
      orphansOutsideWindow: orphansOutsideWindow(items, now),
      orphansAccepted: orphansAccepted(items),
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
function runWake(jobs, { backlog, backlogCapped, prevSweptIso }) {
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
  const idle = idleDetection(jobs, { now, backlog, backlogCapped, pendingCount: detections.length, hostWasAway: away })
  const all = idle ? [...detections, idle] : detections

  const listener = listenerState(WAKE_BEAT, now)
  const { deliver, held } = deliverable(all, parseLog(), now)

  for (const d of deliver) {
    try { appendFileSync(WAKE_LOG, `${wakeLine(d, now.toISOString())}\n`) } catch { /* the section still carries it */ }
  }

  return {
    delivered: deliver,
    section: wakeSection({
      pending: all,
      delivered: deliver,
      held,
      listener,
      outside: outsideWindow(jobs, { now, judged }),
      jobsRead,
      awayNote: away
        ? `host was away — no sweep for ${Math.round((now - Date.parse(prevSweptIso)) / 60000)}m, so stalled/waiting/idle are suppressed this run; a detector cannot run on a suspended host`
        : null,
    }),
    note: `${all.length} pending, ${deliver.length} delivered, channel ${listener.armed ? 'armed' : 'DOWN'}`,
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
    return { at: new Date().toISOString(), sweep: SELF, consumers: [],
             checkout: { ok: false, code: 'broken', branch: null, reason: `the update step failed outright — ${String(e.message).slice(0, 140)}` } }
  }
}

const safeAdmiral = () => {
  try { return runAdmiral() } catch (e) {
    return `## Admiral — triggered, acts and exits\n\n**ADMIRAL TRIGGER BROKEN** — ${String(e.message).slice(0, 160)}. No condition was evaluated this run; this is not a quiet fleet.\n`
  }
}
// A broken wake must not break the sweep, and must not fail quietly either: the
// section says the channel is unreadable rather than saying nothing.
const safeWake = (jobs, opts) => {
  try { return runWake(jobs, opts) } catch (e) {
    return { delivered: [], note: `wake broken: ${String(e.message).slice(0, 80)}`,
             section: `## Wake — workers that stopped\n\n**WAKE CHECK BROKEN** — ${String(e.message).slice(0, 160)}. No worker stop-state was read this run; this is not a quiet fleet.\n` }
  }
}

function main() {
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
    const wake = safeWake(jobs, { backlog: 0, backlogCapped: true, prevSweptIso: prevWrap.sweptIso })
    writeFileSync(STATE_MD, renderState({ snapshot: prevWrap.snapshot, events: prevWrap.events, meta, answers: safePending(), ledger: safeLedger(), workers: safeWorkers(), delivery: safeDelivery(), checks: safeChecks([], jobs)?.section, wake: wake.section, selfupdate, admiral: safeAdmiral() }))
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
  let checks = null
  let backlog = 0
  let backlogCapped = true // until a run proves otherwise, the queue is a floor
  try {
    const c = runChecks(repos, jobs)
    checks = c.section
    backlog = c.backlog
    backlogCapped = c.backlogCapped
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

  // The wake, last of the readings and first in the file. It writes to the log the
  // Navigator's Monitor tails; everything it found is in the section either way.
  const wake = safeWake(jobs, { backlog, backlogCapped, prevSweptIso: prevWrap.sweptIso })

  const ok = errors.length === 0
  const meta = { sweptAt, cadenceMin: CADENCE_MIN, repoCount: repos.length, ok, errors, lastGoodAt: ok ? sweptAt : prevWrap.lastGoodAt }
  mkdirSync(dirname(SNAPSHOT), { recursive: true })
  // The admiral trigger runs last of the readings, after the wake, because an admiral
  // it launches will read the state file this run is about to write.
  const admiral = safeAdmiral()
  writeFileSync(STATE_MD, renderState({ snapshot: next, events: allEvents, meta, answers, ledger, workers, delivery, checks, wake: wake.section, admiral, selfupdate }))
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
  log(`${ok ? 'ok' : 'PARTIAL'} — ${repos.length} repos, ${Object.keys(next).length} RCs, ${events.length} events, ${answers.length} answers pending (${answerEvents.length} handed over) · workers: ${workers ? (workers.ok ? 'clean' : 'FINDING') : 'no reading'} · wake: ${wake.note} · metrics: ${metricsNote} · checkout: ${update.checkout.code}${update.consumers?.map(c => ` · ${c.id}: ${c.code}`).join('') ?? ''}${errors.length ? ' · ' + errors.join('; ') : ''}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
