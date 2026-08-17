#!/usr/bin/env node
// The four checks that missed the night of 2026-08-15.
//
// D0017, approved by @jwildfire on 2026-08-16, makes these the Navigator's day-one
// work. Six pieces of work shipped that night and the roadmap recorded none of them;
// the nightly audit caught one of the six failures and missed five. These are the
// mechanical half of the fix — the half that belongs in the five-minute sweep rather
// than in the session, because none of them needs judgment:
//
//   1. a spoke issue closed, or a pull request merged, with no requirement above it
//   2. an answer he recorded still unapplied after an hour   (already live, in
//      ops-dashboard/lib/answers.mjs — covered by a test here so it cannot quietly
//      stop being true)
//   3. the decision registry and the published index disagreeing
//   4. an agent exiting having produced nothing
//
// SCOPE IS ALL SEVEN PROJECT REPOS, not the hub alone. @jwildfire, 2026-08-16: "The
// audit def needs to include all project repos not just roadmap. Coo watches tasks
// too and tasks live across the project." That is also what makes the headline
// failure detectable at all — the six untracked issues were invisible for exactly one
// reason, that they were in a spoke repository and the nightly audit only read the
// hub. The hub's own audit is unchanged and still runs; this does not duplicate it.
//
// GATE ON WORK DONE, NOT ON FILING. The blunt rule — every spoke issue needs a hub
// parent — fires on 26 of the 41 open spoke issues today, and 14 of the 16 in this
// repo. Nobody would trust that list; it would be muted inside a week and the real
// signal with it. An issue needs an ancestor once it has produced something: once it
// is closed, or once a pull request against it merged.
//
// A REFERENCE IN PROSE IS NOT A LINK. One of the six named its requirement in a
// sentence of its body and was counted as linked by two separate readers; GitHub
// records no parent for it. Only the structural field counts here.
//
// NO SILENT CAPS. The window bounds how far back a run looks, so a first pass does
// not dump months of history into a five-minute file — and whatever falls outside it
// is counted and reported, because a truncated list that does not say so reads as
// full coverage.
import { readFileSync } from 'node:fs'

/** How far back a run looks. Bounded, and what falls outside is reported. */
export const WINDOW_DAYS = 14

// How many rows of one group the section prints. The first live run found 66
// findings inside the window and 112 outside it — a real backlog, and exactly the
// backlog D0017 makes the Navigator's to triage rather than his to read. Printing
// all of it every five minutes would bury the rest of the state file, so the section
// shows the newest few and says how many it did not show. The count is never dropped.
export const SHOW_PER_GROUP = 8

/** The tags whose sessions are workers. A standing session is not one. */
const WORKER_TAG = '\u{1F46F}\u{1F916}' // 👯🤖

const shortRepo = (repo) => String(repo).replace(/^jwildfire\//, '')
const ref = (item) => `${shortRepo(item.repo)}#${item.number}`
const daysAgo = (at, now) => (at ? (now.getTime() - Date.parse(at)) / 86400000 : Infinity)
const inWindow = (at, now) => daysAgo(at, now) <= WINDOW_DAYS

/**
 * Work that shipped with nothing in the plan above it.
 *
 * `items` are issues and pull requests already fetched, each carrying the structural
 * parent GitHub records (`parent`), never a reference scraped from the body.
 */
export function orphanedWork(items = [], now = new Date()) {
  return items
    .filter((i) => (i.kind === 'pr' ? i.state === 'MERGED' : i.state === 'CLOSED'))
    .filter((i) => !i.parent)
    .filter((i) => inWindow(i.closedAt, now))
    .map((i) => ({
      kind: 'orphan',
      repo: i.repo,
      number: i.number,
      line: `${ref(i)} ${i.kind === 'pr' ? 'merged' : 'closed'} with no requirement above it — "${i.title}"`,
    }))
}

/** How many the window dropped, so the count can be reported rather than hidden. */
export function orphansOutsideWindow(items = [], now = new Date()) {
  return items.filter((i) => (i.kind === 'pr' ? i.state === 'MERGED' : i.state === 'CLOSED'))
    .filter((i) => !i.parent)
    .filter((i) => !inWindow(i.closedAt, now)).length
}

/**
 * The decision registry against the published index.
 *
 * Two files answer "has he decided this" and nothing compares them (hub#196). The
 * site reads the index row; the local dashboard reads the registry for the id. A
 * disagreement means one of his decisions is invisible on one of the two surfaces.
 */
export function registryDisagreement(registry = {}, indexRows = []) {
  const byIndex = new Map(indexRows.map((r) => [r.slug, r]));
  const out = []
  for (const a of registry.artifacts ?? []) {
    const registrySaysDecided = String(a.status ?? '').toLowerCase() === 'decided'
    const row = byIndex.get(a.slug)
    if (!row) {
      if (registrySaysDecided) {
        out.push({ kind: 'registry', line: `${a.id ?? a.slug} — the registry calls ${a.slug} decided and the index has no row for it` })
      }
      continue
    }
    if (registrySaysDecided !== Boolean(row.decided)) {
      out.push({
        kind: 'registry',
        line: registrySaysDecided
          ? `${a.id ?? a.slug} — the registry says decided, the index does not`
          : `${a.id ?? a.slug} — the index says decided, the registry does not`,
      })
    }
  }
  return out
}

/**
 * Workers that finished having produced nothing.
 *
 * Only workers: the `blocked`/`done` states mean something different for a standing
 * session, which waits between wakings by design and would otherwise be reported as
 * a corpse every quiet hour. `firstTerminalAt` is the watermark — written once and
 * never revised — so a closeout is neither double-counted nor missed.
 *
 * The job's own child list is weak evidence and is used here only in the direction it
 * can be trusted: children present means something was produced. Nearly half of jobs
 * record none, including one that merged three pull requests, so an empty list is a
 * question for the session to settle against GitHub, not a verdict.
 */
export function emptyCloseouts(jobs = [], now = new Date()) {
  return jobs
    .filter((j) => String(j.name ?? '').startsWith(WORKER_TAG))
    .filter((j) => j.firstTerminalAt && inWindow(j.firstTerminalAt, now))
    .filter((j) => !(j.children ?? []).length)
    .map((j) => ({
      kind: 'closeout',
      line: `${(String(j.name).match(/W\d{4}(?:\.\d+)?/) ?? [j.id])[0]} finished having produced nothing on its own record — job ${j.id}, verify against GitHub before acting`,
    }))
}

/**
 * The `## Roadmap discipline` section the sweep folds into its state file.
 *
 * Verdict first. When the config ledger printed its notes before its verdict the
 * headline vanished from nearly every sweep while the check looked perfectly healthy
 * (obot.agent#129); the same mistake here would make four checks report nothing.
 */
export function checksSection(found = {}, now = new Date()) {
  const orphans = found.orphans ?? []
  const registry = found.registry ?? []
  const closeouts = found.closeouts ?? []
  const total = orphans.length + registry.length + closeouts.length
  const lines = ['## Roadmap discipline', '']
  lines.push(total === 0
    ? `roadmap discipline: clean — no findings across the project repos, last ${WINDOW_DAYS} days`
    : `roadmap discipline: **${total} finding${total === 1 ? '' : 's'}** across the project repos, last ${WINDOW_DAYS} days`)
  if (found.audit) lines.push(`  ${found.audit.ok ? found.audit.summary : `**${found.audit.summary}**`}`)
  // The deployed hub's own account of itself (hub#224). Its summary already carries
  // its own bold ALL-CAPS headline in the alarm form, so it is printed as written
  // rather than wrapped — double-bolding would break the dashboard's alarm match.
  if (found.site) lines.push(`  ${found.site.summary}`)
  if (found.orphansOutsideWindow) {
    lines.push(`  bounded: ${found.orphansOutsideWindow} older than ${WINDOW_DAYS} days not shown — widen the window to work through the backlog`)
  }
  if (found.errors?.length) {
    for (const e of found.errors) lines.push(`  unread: ${e}`)
  }
  const group = (title, rows) => {
    if (!rows.length) return
    lines.push('', `### ${title} (${rows.length})`, '')
    for (const r of rows.slice(0, SHOW_PER_GROUP)) lines.push(`- ${r.line}`)
    const hidden = rows.length - SHOW_PER_GROUP
    if (hidden > 0) lines.push(`- …and ${hidden} more not shown here — the full list is what the Navigator triages`)
  }
  group('Work that shipped with no requirement above it', orphans)
  group('The decision registry and the published index disagree', registry)
  group('Agents that finished having produced nothing', closeouts)
  return lines.join('\n') + '\n'
}

/**
 * How old the nightly audit's findings are, and whether that is a problem.
 *
 * This is the check the 2026-08-16 investigation actually produced. The audit and a
 * live verifier were reported as disagreeing about the same board state within hours
 * of each other; they never disagreed, because the audit had not run. Its last output
 * was 22 hours old and predated every issue in question — the freshest file on disk
 * was from the morning before — and its four findings, none of them about the board,
 * were relayed as "four requirements off the board".
 *
 * findings.json has always carried `generatedAt`. What it has never carried is a
 * reason for a reader to look at it. The audit page renders the age; a script or an
 * agent reading the file gets a confident answer with no indication that it describes
 * a world that no longer exists. So the age becomes a reading of its own, on the
 * surface agents actually read.
 *
 * The threshold allows a full day plus slack, because the audit is nightly and
 * GitHub's scheduler has run it as much as 90 minutes late.
 */
export const AUDIT_STALE_HOURS = 30

export function auditFreshness(findings, now = new Date()) {
  if (!findings?.generatedAt) {
    return { ok: false, summary: 'nightly audit: NO FINDINGS FILE — nothing has audited the roadmap, and an absent audit reads as a clean one' }
  }
  const hours = (now.getTime() - Date.parse(findings.generatedAt)) / 3600000
  const age = hours < 1 ? `${Math.round(hours * 60)}m` : `${Math.round(hours)}h`
  const total = findings.counts?.total ?? (findings.findings ?? []).length
  if (hours > AUDIT_STALE_HOURS) {
    return {
      ok: false,
      summary: `nightly audit: STALE — last run ${age} ago (${findings.generatedAt}); its ${total} finding(s) describe the roadmap as it was, not as it is`,
    }
  }
  // Even a healthy line carries the timestamp and the caveat. The 2026-08-16
  // misreading happened at 22 hours — inside any sane staleness threshold — so a
  // check that only speaks up when the audit is late would not have prevented it.
  // What was missing was a sentence saying the snapshot predates the work being
  // judged, next to the number somebody was about to quote.
  return {
    ok: true,
    summary: `nightly audit: last run ${age} ago at ${findings.generatedAt} — ${total} finding(s); anything filed since then is invisible to it`,
  }
}

/**
 * What the deployed hub says about itself — relayed, not recomputed.
 *
 * @jwildfire asked for a version number in the hub header with a hover saying when the
 * page launched (hub#224). The build stamps that, and the same computation answers a
 * question this sweep should be watching: has the changelog fallen behind what the site
 * actually ships? On 2026-08-16 it had. The roadmap rebuild (#211, D0018) deployed with
 * no changelog entry, so the header's badge read a version dated 05:20Z on a page built
 * at 22:15Z and told anyone who looked that the site was seventeen hours older than it
 * was — confidently, in public, for a day.
 *
 * THE VERDICT IS THE BUILD'S, NOT OURS. This reads `version.json` off the deployed site
 * and relays the answer the header is showing. It would be easy to recompute it here
 * from the local hub clone, and it would be wrong: that clone is not the deployed tree
 * and was measured five commits behind the deployed commit while this was written. Two
 * surfaces answering one question is the defect that forced classify.mjs into its own
 * module; across a repo boundary the only honest fix is for one side to publish and the
 * other to quote.
 *
 * ABSENCE IS NOT AGREEMENT. An unreadable stamp is a finding, not silence. Until the
 * hub side deploys this will 404 on every sweep, and that reads correctly: nothing can
 * currently tell whether the header's version matches the build it is on.
 *
 * The headlines are ALL-CAPS and carry FINDING or GAP because that is what the
 * dashboard's alarm styling matches (ops-dashboard/lib/navigator.mjs ALARM_RE, case
 * sensitive). A carefully worded warning that renders as ordinary grey text is a
 * warning nobody sees.
 */
export const BUILD_STALE_HOURS = 48

export function siteVersionFreshness(stamp, now = new Date()) {
  if (!stamp || !stamp.builtAt) {
    return {
      ok: false,
      summary: "hub build stamp: **DEPLOY STAMP FINDING** — the deployed site publishes no readable version.json, so nothing can say whether the header's version matches the build it is on",
    }
  }
  const hours = (now.getTime() - Date.parse(stamp.builtAt)) / 3600000
  const age = Number.isFinite(hours)
    ? (hours < 1 ? `${Math.round(hours * 60)}m` : hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`)
    : 'an unknown time'
  const who = `v${stamp.version ?? '?'} built ${stamp.builtAt} (${age} ago) on ${stamp.short ?? 'an unknown commit'}`

  // The site redeploys on a daily cron, so a build this old means the deploy itself has
  // stopped running — a different failure from changelog drift, and worth its own line.
  if (Number.isFinite(hours) && hours > BUILD_STALE_HOURS) {
    return { ok: false, summary: `hub build stamp: **DEPLOY GAP FINDING** — ${who}; the site redeploys daily, so a build this old means the deploy has stopped running` }
  }
  if (stamp.drift?.unknown) {
    return { ok: false, summary: `hub build stamp: **CHANGELOG DRIFT FINDING** — ${who}; the drift check could not run, and an unanswered question is not a clean one (${stamp.drift.summary ?? 'no reason given'})` }
  }
  if (stamp.drift && stamp.drift.ok === false) {
    return { ok: false, summary: `hub build stamp: **CHANGELOG DRIFT FINDING** — ${who}; ${stamp.drift.summary}` }
  }
  // Even the healthy line carries the numbers, for the reason auditFreshness gives
  // above: a check that speaks only when something is late teaches nobody what current
  // looks like, and the 2026-08-16 misreading happened inside every sane threshold.
  return { ok: true, summary: `hub build stamp: ${who}; the changelog is current with it` }
}

/** The index rows, read from the decisions README the site publishes from. */
export function parseIndexRows(markdown = '') {
  const rows = []
  for (const line of markdown.split('\n')) {
    const m = line.match(/^\|\s*\[[^\]]*\]\(([^)]+)\/\)\s*\|(.*)\|\s*$/)
    if (!m) continue
    rows.push({ slug: m[1].replace(/\/$/, ''), decided: /decided/i.test(m[2]) })
  }
  return rows
}

export function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

// ---- gh-facing collection (not under test; exercised live) ------------------

// One query per repo rather than one search across all of them: the structural
// `parent` field is only reachable through the repository connection, and a search
// result would have to be re-fetched item by item to get it — seven calls instead of
// dozens. At the five-minute cadence that is ~84 calls an hour against a 5000 limit.
// `openIssues` rides on this query rather than earning a call of its own: the idle
// detection (hub#212) needs a count of ready work, this query already runs once per
// repo every five minutes, and a second listing would be 2000 calls a day for a
// number that moves a few times an hour.
export const ORPHAN_QUERY = `
query($owner:String!, $name:String!) {
  repository(owner:$owner, name:$name) {
    openIssues: issues(states:OPEN, first:100) {
      pageInfo { hasNextPage }
      nodes { number milestone { title } labels(first:10) { nodes { name } } }
    }
    issues(states:CLOSED, first:50, orderBy:{field:UPDATED_AT, direction:DESC}) {
      nodes { number title closedAt parent { number } }
    }
    pullRequests(states:MERGED, first:50, orderBy:{field:UPDATED_AT, direction:DESC}) {
      nodes { number title mergedAt closingIssuesReferences(first:5) { nodes { number } } }
    }
  }
}`

/**
 * Issues and pull requests from one repo, shaped for `orphanedWork`.
 *
 * A merged pull request counts as having an ancestor when it closes any issue at
 * all: the issue is what carries the link to a requirement, and if that issue is
 * itself unparented it is already reported on its own row. Reporting both would
 * double-count one failure, and a list that inflates is a list that gets muted.
 */
export function shapeRepo(repo, data) {
  const r = data?.repository
  if (!r) return []
  const issues = (r.issues?.nodes ?? []).map((i) => ({
    repo, number: i.number, kind: 'issue', state: 'CLOSED',
    closedAt: i.closedAt, parent: i.parent ?? null, title: i.title,
  }))
  const prs = (r.pullRequests?.nodes ?? []).map((p) => ({
    repo, number: p.number, kind: 'pr', state: 'MERGED', closedAt: p.mergedAt,
    parent: (p.closingIssuesReferences?.nodes ?? []).length ? { via: 'closes' } : null,
    title: p.title,
  }))
  return [...issues, ...prs]
}
