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
//
// Why scheduled, not a session Monitor: session-bound watchers die with the
// session and coverage was manual per-RC — both failed on sv#131 (2026-08-15,
// CHANGES_REQUESTED at 08:29Z unseen for hours). Installed via
// tools/navigator/install-launchd, cadence 5 min.
//
// Failure contract: a failed sweep must never look fresh. On error the state
// file is rewritten with a FAILED header naming the last good sweep; a repo
// that fails to list keeps its previous entries and emits no rc-gone events.
//
// Day-one scope (hub#157): bookkeeping only. Records and reports; never
// judges, corrects, or touches other agents' work. Nothing it writes is
// published.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { answersSection, deliverAnswers, pendingAnswers } from '../ops-dashboard/lib/answers.mjs'
import { ORPHAN_QUERY, auditFreshness, checksSection, emptyCloseouts, orphanedWork,
         orphansOutsideWindow, parseIndexRows, readJson, registryDisagreement,
         shapeRepo } from './checks.mjs'
// What counts as a release candidate now lives beside this file rather than in it,
// because the Operations Dashboard has to answer the same question and used to answer
// it differently. Re-exported so this module's callers and tests are unaffected.
import { classifyRC, discoverRepos, POLICY_FILE } from './classify.mjs'

export { classifyRC, discoverRepos }

const WS = process.env.OBOT_WORKSPACE || join(process.env.HOME, 'Documents/obot2')
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const POLICY = POLICY_FILE
const STATE_MD = join(WS, '.claude/session-hub/navigator-state.md')
const SNAPSHOT = join(WS, '.claude/session-hub/cache/navigator-rc.json')
const LOG = join(WS, '.claude/session-hub/navigator-sweep.log')
const SCRATCHPAD_LOG = join(REPO_ROOT, 'tools', 'scratchpad-log')
// The hub clone, for joining an artifact slug to the decision id he quotes.
const HUB = process.env.OBOT_HUB || join(WS, 'obot.roadmap')
const CADENCE_MIN = 5
const MAX_EVENTS = 15

const short = (repo, n) => `${repo.replace(/^jwildfire\//, '')}#${n}`
const reviewKey = r => `${r.author}:${r.submittedAt}`

// diff(prev, next, goneStates, failedRepos) → events, each {type, line}.
// goneStates maps a key present in prev but not next to its resolved final
// state (MERGED/CLOSED/unknown). failedRepos: repos whose listing failed this
// run — their prev entries are neither diffed nor declared gone.
export function diff(prev, next, goneStates = {}, failedRepos = new Set()) {
  const events = []
  for (const [key, cur] of Object.entries(next)) {
    const old = prev[key]
    const name = short(cur.repo, cur.number)
    if (!old) {
      events.push({ type: 'rc-new', line: `NEW RC ${name} "${cur.title}" → ${cur.base} ${cur.url}` })
      for (const r of cur.reviews) {
        events.push({ type: 'review-new', line: `REVIEW ${name} ${r.state} by @${r.author} ${r.submittedAt} — "${r.excerpt}"` })
      }
      continue
    }
    const oldReviews = new Set(old.reviews.map(reviewKey))
    for (const r of cur.reviews.filter(r => !oldReviews.has(reviewKey(r)))) {
      events.push({ type: 'review-new', line: `NEW REVIEW ${name} ${r.state} by @${r.author} ${r.submittedAt} — "${r.excerpt}"` })
    }
    if (cur.reviewDecision !== old.reviewDecision) {
      events.push({ type: 'decision-change', line: `DECISION ${name} ${old.reviewDecision || '(none)'} → ${cur.reviewDecision || '(none)'}` })
    }
    if (cur.commentCount > old.commentCount) {
      events.push({ type: 'comments-new', line: `COMMENTS ${name} +${cur.commentCount - old.commentCount} (now ${cur.commentCount})` })
    }
  }
  for (const [key, old] of Object.entries(prev)) {
    if (next[key] || failedRepos.has(old.repo)) continue
    const state = goneStates[key] || 'unknown'
    events.push({ type: 'rc-gone', line: `RC GONE ${short(old.repo, old.number)} — ${state}` })
  }
  return events
}

export function renderState({ snapshot, events, meta, answers = [], ledger = null, workers = null, delivery = null, checks = null }) {
  const stamp = `[verified gh ${meta.sweptAt.slice(-5)}]`
  const head = meta.ok
    ? `swept: ${meta.sweptAt} · cadence ${meta.cadenceMin}m · ok — ${meta.repoCount} repos, ${Object.keys(snapshot).length} RCs`
    : `swept: ${meta.sweptAt} · cadence ${meta.cadenceMin}m · **FAILED** (${(meta.errors || []).join('; ')}) — queue below is from the last good sweep ${meta.lastGoodAt || 'unknown'}, treat as stale`
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
  if (ledger) {
    lines.push(ledger.ok ? `config ledger: ${ledger.summary}` : `**CONFIG LEDGER GAP** — ${ledger.summary}`)
    for (const d of ledger.detail || []) lines.push(`  ${d}`)
    lines.push('')
  }
  // The worker ledger (#130). Same discipline, different question: not "did the
  // record lose something" but "is anything writing to the record at all". A
  // worker that spawned with no id can never be attributed to what it wrote, and
  // since every agent write is authored by the same bot identity, an unattributed
  // worker is unattributable forever — there is no second chance to recover it.
  if (workers) {
    lines.push(workers.ok ? `worker ledger: ${workers.summary}` : `**WORKER LEDGER FINDING** — ${workers.summary}`)
    for (const d of workers.detail || []) lines.push(`  ${d}`)
    lines.push('')
  }
  lines.push(
    '## RC queue — open PRs awaiting or holding @jwildfire review',
    '',
  )
  const rcs = Object.values(snapshot).sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number)
  if (!rcs.length) lines.push(`**RC queue: EMPTY.** ${stamp}`)
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
  if (delivery && delivery.trim()) lines.push('', delivery.trimEnd())

  // The four checks that missed the night of 2026-08-15 (D0017). Rendered even when
  // clean, because a detector that only ever speaks up on failure is
  // indistinguishable from a dead one — the same reason the ledgers report clean.
  if (checks && checks.trim()) lines.push('', checks.trimEnd())

  lines.push('', `## Recent events (newest first, capped ${MAX_EVENTS})`, '')
  if (!events.length) lines.push('- (none recorded yet)')
  for (const e of events) lines.push(`- ${e.at || meta.sweptAt.slice(-5)} ${e.line} ${e.stamp || stamp}`)
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

// The four checks (#136, under D0017). Scope is every repo in the policy file — all
// seven project repos, not the hub alone — which is @jwildfire's directive and also
// the only reason last night's failure is detectable by a machine at all: those six
// issues were invisible because they sat in a spoke repo and the nightly audit read
// only the hub.
//
// A repo that fails to read is named in the section rather than skipped silently. A
// check that quietly covers six of seven repos and prints "clean" is worse than no
// check, because the reader takes it as complete.
function runChecks(repos) {
  const items = []
  const errors = []
  for (const { repo } of repos) {
    const [owner, name] = repo.split('/')
    try {
      const data = JSON.parse(gh(['api', 'graphql', '-f', `query=${ORPHAN_QUERY}`,
        '-F', `owner=${owner}`, '-F', `name=${name}`])).data
      items.push(...shapeRepo(repo, data))
    } catch (e) {
      errors.push(`${repo}: ${String(e.message).slice(0, 90)}`)
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
    closeouts = emptyCloseouts(readJobs(), new Date())
  } catch (e) {
    errors.push(`jobs: ${String(e.message).slice(0, 90)}`)
  }

  // How old the thing this design leans on actually is. The 2026-08-16 investigation
  // found the audit had not run at all while its day-old output was being quoted as
  // this morning's board state; the file has always carried its timestamp and nothing
  // ever made a reader look at it.
  const audit = auditFreshness(readJson(join(HUB, 'site/audit/findings.json')), new Date())

  const now = new Date()
  return checksSection({
    audit,
    orphans: orphanedWork(items, now),
    orphansOutsideWindow: orphansOutsideWindow(items, now),
    registry,
    closeouts,
    errors,
  }, now)
}

// The harness's own job ledger. `firstTerminalAt` is the closeout watermark; the
// state file alone is not proof a job finished well, so the timeline is read where
// it exists and the state is the fallback.
function readJobs() {
  const dir = join(process.env.HOME, '.claude', 'jobs')
  const out = []
  let names = []
  try { names = readdirSync(dir) } catch { return out }
  for (const id of names) {
    let state
    try { state = JSON.parse(readFileSync(join(dir, id, 'state.json'), 'utf8')) } catch { continue }
    let firstTerminalAt = state.firstTerminalAt || null
    if (!firstTerminalAt && state.state === 'done') {
      try {
        const lines = readFileSync(join(dir, id, 'timeline.jsonl'), 'utf8').trim().split('\n')
        for (const l of lines) {
          const ev = JSON.parse(l)
          if (['done', 'blocked', 'failed'].includes(ev.state || ev.type)) { firstTerminalAt = ev.at || ev.ts; break }
        }
      } catch { /* no timeline — the state file is what there is */ }
    }
    out.push({ id, name: state.name, state: state.state, firstTerminalAt, children: state.children || [] })
  }
  return out
}

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
const safeChecks = (repos) => { try { return runChecks(repos) } catch { return null } }

function main() {
  const sweptAt = nowStamp()
  let prevWrap = { lastGoodAt: null, snapshot: {}, events: [] }
  try { prevWrap = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) } catch { /* first run */ }

  let repos
  try {
    repos = discoverRepos(JSON.parse(readFileSync(POLICY, 'utf8')))
  } catch (e) {
    const meta = { sweptAt, cadenceMin: CADENCE_MIN, repoCount: 0, ok: false, errors: [`policy.json: ${e.message}`], lastGoodAt: prevWrap.lastGoodAt }
    // A sweep that cannot read the policy still reports his answers: they come
    // from the local store, and a failed RC sweep is no reason to imply there is
    // nothing waiting on an agent.
    writeFileSync(STATE_MD, renderState({ snapshot: prevWrap.snapshot, events: prevWrap.events, meta, answers: safePending(), ledger: safeLedger(), workers: safeWorkers(), delivery: safeDelivery(), checks: safeChecks([]) }))
    log(`FAILED policy.json: ${e.message}`)
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

  const events = diff(prevWrap.snapshot, next, goneStates, failedRepos)

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
  const stamped = [
    ...events.map(e => ({ ...e, stamp: `[verified gh ${hhmm}]` })),
    ...answerEvents.map(e => ({ ...e, stamp: `[ops store ${hhmm}]` })),
  ].map(e => ({ ...e, at: hhmm }))
  const allEvents = [...stamped.reverse(), ...(prevWrap.events || [])].slice(0, MAX_EVENTS)

  // A broken ledger check must not break the RC sweep, exactly as a broken answer
  // store must not: this is an extra pair of eyes, never a precondition.
  let ledger = null
  try { ledger = auditLedger() } catch (e) { errors.push(`ledger: ${String(e.message).slice(0, 120)}`) }
  let workers = null
  try { workers = auditWorkers() } catch (e) { errors.push(`workers: ${String(e.message).slice(0, 120)}`) }
  let delivery = null
  try { delivery = readDelivery() } catch (e) { errors.push(`delivery: ${String(e.message).slice(0, 120)}`) }
  let checks = null
  try { checks = runChecks(repos) } catch (e) { errors.push(`checks: ${String(e.message).slice(0, 120)}`) }
  // The gap check rides along with the record itself: a finding is prepended to
  // the section so it cannot be read as a quiet day.
  let deliveryAudit = null
  try { deliveryAudit = auditDelivery() } catch { /* an extra pair of eyes, never a precondition */ }
  if (delivery && deliveryAudit && !deliveryAudit.ok) {
    delivery = `**DELIVERY RECORD GAP** — ${deliveryAudit.summary}\n\n${delivery}`
  }

  const ok = errors.length === 0
  const meta = { sweptAt, cadenceMin: CADENCE_MIN, repoCount: repos.length, ok, errors, lastGoodAt: ok ? sweptAt : prevWrap.lastGoodAt }
  mkdirSync(dirname(SNAPSHOT), { recursive: true })
  writeFileSync(STATE_MD, renderState({ snapshot: next, events: allEvents, meta, answers, ledger, workers, delivery, checks }))
  writeFileSync(SNAPSHOT, JSON.stringify({ lastGoodAt: meta.lastGoodAt, snapshot: next, events: allEvents }, null, 2))

  for (const e of stamped.slice(0, 5)) scratchpad(e.line)
  log(`${ok ? 'ok' : 'PARTIAL'} — ${repos.length} repos, ${Object.keys(next).length} RCs, ${events.length} events, ${answers.length} answers pending (${answerEvents.length} handed over) · workers: ${workers ? (workers.ok ? 'clean' : 'FINDING') : 'no reading'}${errors.length ? ' · ' + errors.join('; ') : ''}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
