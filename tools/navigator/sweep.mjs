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
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, statSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { answersSection, deliverAnswers, pendingAnswers } from '../ops-dashboard/lib/answers.mjs'

const WS = process.env.OBOT_WORKSPACE || join(process.env.HOME, 'Documents/obot2')
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const POLICY = join(REPO_ROOT, 'scripts', 'policy.json')
const STATE_MD = join(WS, '.claude/session-hub/navigator-state.md')
const SNAPSHOT = join(WS, '.claude/session-hub/cache/navigator-rc.json')
const LOG = join(WS, '.claude/session-hub/navigator-sweep.log')
const SCRATCHPAD_LOG = join(REPO_ROOT, 'tools', 'scratchpad-log')
// The hub clone, for joining an artifact slug to the decision id he quotes.
const HUB = process.env.OBOT_HUB || join(WS, 'obot.roadmap')
const CADENCE_MIN = 5
const REVIEWER = 'jwildfire'
const MAX_EVENTS = 15

export function discoverRepos(policy) {
  return Object.entries(policy.repos || {}).map(([repo, entry]) => ({
    repo,
    release: (entry.branches && entry.branches.release) || [],
    class: entry.class || 'unclassified',
  }))
}

export function classifyRC(pr, releaseBranches) {
  if (pr.isDraft) return false
  if (releaseBranches.includes(pr.baseRefName)) return true
  if ((pr.reviewRequests || []).some(r => r.login === REVIEWER)) return true
  if (pr.reviewDecision) return true // reviewed already, still open — still his queue
  return false
}

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

export function renderState({ snapshot, events, meta, answers = [] }) {
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
    '## RC queue — open PRs awaiting or holding @jwildfire review',
    '',
  ]
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
    writeFileSync(STATE_MD, renderState({ snapshot: prevWrap.snapshot, events: prevWrap.events, meta, answers: safePending() }))
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

  const ok = errors.length === 0
  const meta = { sweptAt, cadenceMin: CADENCE_MIN, repoCount: repos.length, ok, errors, lastGoodAt: ok ? sweptAt : prevWrap.lastGoodAt }
  mkdirSync(dirname(SNAPSHOT), { recursive: true })
  writeFileSync(STATE_MD, renderState({ snapshot: next, events: allEvents, meta, answers }))
  writeFileSync(SNAPSHOT, JSON.stringify({ lastGoodAt: meta.lastGoodAt, snapshot: next, events: allEvents }, null, 2))

  for (const e of stamped.slice(0, 5)) scratchpad(e.line)
  log(`${ok ? 'ok' : 'PARTIAL'} — ${repos.length} repos, ${Object.keys(next).length} RCs, ${events.length} events, ${answers.length} answers pending (${answerEvents.length} handed over)${errors.length ? ' · ' + errors.join('; ') : ''}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
