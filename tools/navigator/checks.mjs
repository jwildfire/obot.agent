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
// FOR AN ISSUE. A merged pull request has no structural parent field at all, and the
// one signal it does have — `closingIssuesReferences` — is empty on correctly written
// work here: GitHub records it only for a pull request targeting the default branch,
// so no release candidate can have one, and the house convention forbids `Closes` on
// partial work so the issue stays open. Nine merged pull requests were findings on
// 2026-08-18 and not one carried a closing keyword. So a pull request may also prove
// its parent with a linking keyword its author wrote — anchored, with the reference
// next to it, which is what separates a declaration from a mention — and only when
// the issue it names is itself parented (jwildfire/obot.agent#225).
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
 * The label that settles an orphan.
 *
 * @jwildfire, 2026-08-17: "i'm fine if some orphans stay orphaned, but fix the ones
 * we can. Let's tag true orphans with a label." The backfill (hub#233) attached the
 * 51 items that could honestly be attached and labelled the 146 that could not — most
 * of them because they predate the requirement they would have hung from, and a parent
 * that is chronologically impossible is a fiction rather than a fix.
 *
 * A labelled item is a settled state, not a pending task, so it stops being a finding.
 * It does not stop being counted: the section prints how many were excluded, for the
 * same reason the window prints what it dropped. An exclusion nobody can see is
 * indistinguishable from a check that found nothing.
 */
export const ACCEPTED_LABEL = 'orphan-accepted'

const accepted = (i) => (i.labels ?? []).includes(ACCEPTED_LABEL)
const shipped = (i) => (i.kind === 'pr' ? i.state === 'MERGED' : i.state === 'CLOSED')

/**
 * The keywords an author writes to say a pull request belongs to an issue.
 *
 * `Closes`/`Fixes`/`Resolves` are GitHub's own; the rest are what this workspace
 * actually writes when the issue must stay open, which is most of the time. The set
 * is the vocabulary measured across the 163 merged pull requests in the seven policy
 * repos, not a guess.
 */
const KEYWORDS = 'clos(?:e|es|ed)|fix(?:es|ed)?|resolv(?:e|es|ed)|refs?|references|part of|follows|implements'

// Anchored, and the reference must sit immediately after the keyword. That is the
// whole discrimination: `Refs #202` is a declaration, `A one-line follow-up to #171`
// is a sentence, and `Closes nothing on its own; #224 stays closed by #225` is a
// sentence that starts with a keyword. A list marker or bold wrapper may precede the
// keyword — release notes write `- Closes #45` — and nothing else may.
const LINK_LINE = new RegExp(`^\\s{0,3}(?:[-*+]\\s+|>\\s*)?(?:\\*\\*|__|\\*|_)?\\s*(?:${KEYWORDS})(?:\\*\\*|__|\\*|_)?\\s*:?\\s+(.+)$`, 'i')

// `#N` and `owner/repo#N` are the two forms GitHub itself links, plus the URL a
// markdown link wraps. A bare `roadmap#243` is deliberately not one of them: GitHub
// renders it as plain text, so treating it as a reference would be inventing a link
// the author did not make.
const SELF_REF = /^#(\d+)\b/
const CROSS_REF = /^([\w.-]+)\/([\w.-]+)#(\d+)\b/
const URL_REF = /^(?:\[[^\]]*\]\(\s*)?(?:<)?https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)\b/

/**
 * The issues a pull request body states it belongs to.
 *
 * Never a mention: the keyword anchors the line and the reference sits next to it.
 * `kind` is `'pr'` only when the reference itself says so — a bare `#171` cannot be
 * told from an issue by syntax, so it is resolved against what was actually fetched.
 */
export function statedIssueRefs(body = '', repo = '') {
  const [selfOwner, selfName] = String(repo).split('/')
  const out = []
  for (const raw of String(body ?? '').split('\n')) {
    const line = raw.match(LINK_LINE)
    if (!line) continue
    const rest = line[1].trim()
    let m
    if ((m = rest.match(URL_REF))) out.push({ repo: `${m[1]}/${m[2]}`, number: Number(m[4]), kind: m[3] === 'pull' ? 'pr' : undefined })
    else if ((m = rest.match(CROSS_REF))) out.push({ repo: `${m[1]}/${m[2]}`, number: Number(m[3]) })
    else if ((m = rest.match(SELF_REF)) && selfOwner && selfName) out.push({ repo: `${selfOwner}/${selfName}`, number: Number(m[1]) })
  }
  return out
}

const refKey = (r) => `${r.repo}#${r.number}`
const refLabel = (r) => `${shortRepo(r.repo)}#${r.number}`

/** What was actually fetched, so a stated reference can be checked rather than believed. */
function localIndex(items) {
  const m = new Map()
  for (const i of items) m.set(`${i.repo}#${i.number}`, { kind: i.kind, parent: i.parent ?? null })
  return m
}

/**
 * Whether one shipped item has something in the plan above it, and if not, why not.
 *
 * One definition, used by the findings, the bounded count and the accepted count
 * alike — three numbers computed from three different ideas of "covered" is how a
 * section starts contradicting itself.
 */
function coverage(item, index, resolved) {
  if (item.parent) return { covered: true }
  // An issue has a structural parent field and using it is one click. Its body is
  // never read here, and that asymmetry is the point rather than an oversight.
  if (item.kind !== 'pr') return { covered: false, why: 'none' }
  const refs = item.statedRefs ?? []
  if (!refs.length) return { covered: false, why: 'none' }
  const seen = refs.map((r) => ({ r, entry: r.kind === 'pr' ? { kind: 'pr' } : (index.get(refKey(r)) ?? resolved.get(refKey(r)) ?? null) }))
  if (seen.some((s) => s.entry?.kind === 'issue' && s.entry.parent)) return { covered: true }
  const orphan = seen.find((s) => s.entry?.kind === 'issue' && !s.entry.parent)
  if (orphan) return { covered: false, why: 'unparented', ref: orphan.r }
  const unknown = seen.find((s) => !s.entry)
  if (unknown) return { covered: false, why: 'unresolved', ref: unknown.r }
  return { covered: false, why: 'pr', ref: seen[0].r }
}

/**
 * The row, worded so the reader knows which object to go and repair.
 *
 * "merged with no requirement above it" was the only sentence this check could say,
 * and it said it about work whose requirement was one hop away. Each shape below
 * names the thing that can actually be fixed, or says plainly that nothing was read.
 */
function orphanLine({ item, why, ref: named }) {
  const verb = item.kind === 'pr' ? 'merged' : 'closed'
  const tail = `— "${item.title}"`
  if (why === 'unparented') return `${ref(item)} ${verb} under ${refLabel(named)}, which has no requirement above it either ${tail}`
  if (why === 'unresolved') return `${ref(item)} ${verb} naming ${refLabel(named)}, which this sweep could not resolve ${tail}`
  if (why === 'pr') return `${ref(item)} ${verb} naming ${refLabel(named)}, a pull request, which carries no requirement of its own ${tail}`
  return `${ref(item)} ${verb} with no requirement above it ${tail}`
}

/**
 * Work that shipped with nothing in the plan above it.
 *
 * `items` are issues and pull requests already fetched, each carrying the structural
 * parent GitHub records (`parent`), never a reference scraped from the body.
 */
export function orphanedWork(items = [], now = new Date(), resolved = new Map()) {
  const index = localIndex(items)
  const out = []
  for (const i of items) {
    if (!shipped(i) || accepted(i) || !inWindow(i.closedAt, now)) continue
    const c = coverage(i, index, resolved)
    if (c.covered) continue
    out.push({ kind: 'orphan', repo: i.repo, number: i.number, line: orphanLine({ item: i, why: c.why, ref: c.ref }) })
  }
  return out
}

/** How many the window dropped, so the count can be reported rather than hidden. */
export function orphansOutsideWindow(items = [], now = new Date(), resolved = new Map()) {
  const index = localIndex(items)
  return items.filter((i) => shipped(i) && !accepted(i) && !inWindow(i.closedAt, now))
    .filter((i) => !coverage(i, index, resolved).covered).length
}

/** How many the label settled, so the exclusion is reported rather than hidden. */
export function orphansAccepted(items = [], resolved = new Map()) {
  const index = localIndex(items)
  return items.filter((i) => shipped(i) && accepted(i))
    .filter((i) => !coverage(i, index, resolved).covered).length
}

/**
 * How many stated references one sweep will look up rather than leave unverified.
 *
 * The repo query fetches the 100 open and 50 most-recently-updated closed issues, and
 * the hub alone has 113 open — so a pull request can name a live requirement the
 * query simply did not return. One extra call per sweep settles those; this bounds it
 * so a bad body can never turn the five-minute sweep into a crawler.
 */
export const REF_LOOKUP_CAP = 25

/**
 * The stated references nothing fetched can answer, deduped and bounded.
 *
 * Only from pull requests that are findings without them — a pull request already
 * covered by what was fetched costs no call. What the cap drops is returned, never
 * swallowed: an unverified reference reported as covered is the failure this whole
 * check exists to prevent.
 */
export function unresolvedRefs(items = [], now = new Date()) {
  const index = localIndex(items)
  const wanted = new Map()
  for (const i of items) {
    if (i.kind !== 'pr' || !shipped(i) || accepted(i) || !inWindow(i.closedAt, now)) continue
    const c = coverage(i, index, new Map())
    if (c.covered) continue
    for (const r of i.statedRefs ?? []) {
      if (r.kind === 'pr' || index.has(refKey(r))) continue
      wanted.set(refKey(r), r)
    }
  }
  const all = [...wanted.values()]
  return { refs: all.slice(0, REF_LOOKUP_CAP), dropped: Math.max(0, all.length - REF_LOOKUP_CAP) }
}

const SAFE_NAME = /^[\w.-]+$/

/** One aliased query for every reference that needs settling — one call, not one each. */
export function refLookupQuery(refs = []) {
  const parts = refs
    .filter((r) => r.repo.split('/').length === 2 && r.repo.split('/').every((p) => SAFE_NAME.test(p)) && Number.isInteger(r.number))
    .map((r, n) => {
      const [owner, name] = r.repo.split('/')
      return `  a${n}: repository(owner:"${owner}", name:"${name}") { issueOrPullRequest(number:${r.number}) { __typename ... on Issue { parent { number } } } }`
    })
  return parts.length ? `query {\n${parts.join('\n')}\n}` : null
}

/**
 * The lookup's answer, keyed the way `coverage` reads it.
 *
 * An alias that came back null or missing is left out rather than recorded as an
 * issue with no parent: not-read and read-and-empty are different answers, and only
 * one of them is a finding.
 */
export function parseRefLookup(refs = [], data = {}) {
  const out = new Map()
  refs.forEach((r, n) => {
    const node = data?.[`a${n}`]?.issueOrPullRequest
    if (!node) return
    if (node.__typename === 'Issue') out.set(refKey(r), { kind: 'issue', parent: node.parent ?? null })
    else out.set(refKey(r), { kind: 'pr', parent: null })
  })
  return out
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
 * Only workers, and this is a DELIVERY question rather than a liveness one — which
 * is the distinction obot.agent#181 was filed about. A worker is judged on what it
 * delivered; a role is not. Prime and the Navigator carry no deliverable, and
 * neither does the admiral: it moves other people's finished work and records what
 * it did in the admiral log, so a verdict on its own closeout would be a verdict
 * on nothing. Its exits stay out of this list on purpose.
 *
 * The exclusion that WAS wrong is the liveness one, and it lived in wake.mjs: the
 * `blocked`/`done` states mean something different for a session that rests between
 * wakings, and the admiral was excluded as if it were one of those when it is
 * the opposite — triggered, budgeted, and dead when it stops. That is now asked of
 * `lifecycle` in tools/lib/roles.mjs rather than of a list of roles.
 *
 * `firstTerminalAt` is the watermark — written once and never revised — so a
 * closeout is neither double-counted nor missed.
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
  // Nothing read means nothing found, and nothing found is not clean. On a machine
  // where every `gh` call fails and there is no hub clone, all three lists are empty
  // because no source could be opened, and the headline read "roadmap discipline:
  // clean" — two lines above its own "an absent audit reads as a clean one"
  // (jwildfire/obot.roadmap#223). Callers summarise by the first line, so the
  // headline is the only part that has to carry this.
  const unread = found.errors?.length ?? 0
  const lines = ['## Roadmap discipline', '']
  lines.push(total > 0
    ? `roadmap discipline: **${total} finding${total === 1 ? '' : 's'}** across the project repos, last ${WINDOW_DAYS} days`
    : unread
      ? `roadmap discipline: **NOT CHECKED** — ${unread} source${unread === 1 ? '' : 's'} could not be read this sweep (below). No finding here means no reading, not a clean roadmap.`
      : `roadmap discipline: clean — no findings across the project repos, last ${WINDOW_DAYS} days`)
  if (found.audit) lines.push(`  ${found.audit.ok ? found.audit.summary : `**${found.audit.summary}**`}`)
  // The deployed hub's own account of itself (hub#224). Its summary already carries
  // its own bold ALL-CAPS headline in the alarm form, so it is printed as written
  // rather than wrapped — double-bolding would break the dashboard's alarm match.
  if (found.site) lines.push(`  ${found.site.summary}`)
  if (found.orphansOutsideWindow) {
    lines.push(`  bounded: ${found.orphansOutsideWindow} older than ${WINDOW_DAYS} days not shown — widen the window to work through the backlog`)
  }
  // The exclusion is printed, not assumed. The label removes these from the findings
  // by design (hub#233); a reader who cannot see how many were removed cannot tell a
  // clean check from a muted one.
  if (found.orphansAccepted) {
    lines.push(`  accepted: ${found.orphansAccepted} labelled ${ACCEPTED_LABEL} and not counted — settled history, not pending work (hub#233)`)
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
      nodes { number title closedAt parent { number } labels(first:20) { nodes { name } } }
    }
    pullRequests(states:MERGED, first:50, orderBy:{field:UPDATED_AT, direction:DESC}) {
      nodes { number title body mergedAt closingIssuesReferences(first:5) { nodes { number } }
              labels(first:20) { nodes { name } } }
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
 *
 * When GitHub recorded no closing reference — which is most of them here, for the
 * two reasons at the top of this file — the body's stated references are carried
 * alongside, and `coverage` decides whether any of them lands on a parented issue.
 * The body is what makes this the query's largest field by far; it is fetched anyway
 * because the alternative is a second call per pull request that has one.
 */
export function shapeRepo(repo, data) {
  const r = data?.repository
  if (!r) return []
  const names = (n) => (n?.nodes ?? []).map((l) => l.name)
  const issues = (r.issues?.nodes ?? []).map((i) => ({
    repo, number: i.number, kind: 'issue', state: 'CLOSED',
    closedAt: i.closedAt, parent: i.parent ?? null, title: i.title,
    labels: names(i.labels),
  }))
  const prs = (r.pullRequests?.nodes ?? []).map((p) => {
    const closes = (p.closingIssuesReferences?.nodes ?? []).length
    return {
      repo, number: p.number, kind: 'pr', state: 'MERGED', closedAt: p.mergedAt,
      parent: closes ? { via: 'closes' } : null,
      statedRefs: closes ? [] : statedIssueRefs(p.body, repo),
      title: p.title, labels: names(p.labels),
    }
  })
  return [...issues, ...prs]
}
