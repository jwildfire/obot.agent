// Release metrics — the numbers behind the Navigator tab (jwildfire/obot.roadmap#218).
//
// @jwildfire, 2026-08-16: "Show me key release metrics (issues/PRs created by type,
// releases, decisions, etc) in the last 1/3/7/30/365 days."
//
// Two rules, both from the commissioning requirement:
//
//   - Counts come from a real source — GitHub and the decisions record — never from
//     any dashboard page's own view of itself. The roster counting the roster is how
//     a surface becomes self-confirming.
//   - A series younger than its window says so. A flat line that implies nothing
//     happened is worse than an empty panel that names when measurement began.
//
// Split the same way as the sweep: a pure core (classifiers, windows) under test,
// and a gh-facing collector exercised live. The collector runs inside the sweep on
// a TTL, writes one cache file, and the dashboard renders from the cache — a page
// render is the wrong place for a network call (lib/roster.mjs, same rule).
//
// The cache keeps dated items, not precomputed counts: windows move with the clock,
// and a count baked at collect time would be wrong within the hour. Counting is the
// renderer's job; fetching is this file's.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const WINDOWS = [1, 3, 7, 30, 365]

// Where measured history actually begins. The oldest issue in these repos is
// 2026-05-09 (gsm.safety); five of the seven begin with the 2026-07-02 move under
// the `jwildfire` account, and anything earlier lives in other orgs under other
// issue numbers. A 365-day column here is the programme's whole life, not a year.
export const HISTORY_EPOCH = '2026-05-09'
export const CONSOLIDATION = '2026-07-02'

export const HUB_REPO = 'jwildfire/obot.roadmap'

// When each repo's branch model began — the date of its first PR into what is now
// its integration branch (measured 2026-08-16, from the PR record). Before this
// date the repo had no integration/release split, so a PR into what is now a
// release branch was ordinary work: gsm.safety's nine pre-07-29 PRs into `main`
// are not release candidates, and counting them as RCs overstates the lane by
// nearly half. Title matching alone is worse (2 of 29 over history) — the naming
// rule is only days old.
export const BRANCH_MODEL_EPOCH = {
  'jwildfire/obot.agent': '2026-05-26',
  'jwildfire/obot.roadmap': '2026-07-02',
  'jwildfire/safety.viz': '2026-07-09',
  'jwildfire/open.gismo': '2026-07-12',
  'jwildfire/open.csr': '2026-07-25',
  'jwildfire/demo-301': '2026-07-29',
  'jwildfire/gsm.safety': '2026-07-29',
}

const RC_TITLE = /-RC\d|^Release candidate:|^Release v\d|v\d+\.\d+\.\d+ RC\d|promotion/i

/**
 * One issue → its class, from the labels the repos actually use. GitHub's issue
 * "type" field does not exist on these user-owned repos (verified over every hub
 * row), so class is derived and the page must say so.
 *
 * The hub carries the planning taxonomy: goal, requirement, audit-decision, bug;
 * an unlabelled hub issue with a parent is somebody's task, and one with neither
 * is honestly unclassified — mostly asks filed before the requirement discipline,
 * and worth counting as a data-quality figure rather than hiding inside "task".
 * Implementation repos have no such taxonomy: everything that is not a bug is
 * ordinary work, because calling 29% of real work "other" tells him nothing.
 */
export function classifyIssue(issue = {}, repo = '') {
  const labels = (issue.labels || []).map((l) => String(l?.name ?? l).toLowerCase())
  if (labels.includes('goal')) return 'goal'
  if (labels.includes('requirement')) return 'requirement'
  if (labels.includes('bug')) return 'bug'
  if (repo === HUB_REPO) {
    if (labels.includes('audit-decision')) return 'audit'
    return issue.parent_issue_url ? 'task' : 'unclassified'
  }
  return 'task'
}

/**
 * One PR → its lane, by branch role (tools/navigator/classify.mjs owns the live
 * judgement; this is the historical form, where base is what survives). Release
 * candidate = base holds the `release` role AND the repo's branch model existed
 * when the PR was created (or the title says RC outright — the escape hatch for
 * anything mislabelled around the epoch). A PR into neither a release nor the
 * integration branch is stacked work on a feature branch — its own small lane,
 * not standard, because folding it in would misstate both.
 */
export function classifyPRLane(pr = {}, { release = [], integration = null, epoch = null } = {}) {
  const base = pr.base?.ref ?? pr.baseRefName ?? ''
  if (release.includes(base)) {
    const created = pr.created_at ?? pr.createdAt ?? ''
    if (!epoch || (created && created.slice(0, 10) >= epoch) || RC_TITLE.test(pr.title ?? '')) {
      return 'release-candidate'
    }
    return 'standard'
  }
  if (!integration || base === integration) return 'standard'
  return 'stacked'
}

/**
 * items → {1: n, 3: n, 7: n, 30: n, 365: n}, counting dateOf(item) within each
 * window. GitHub events are instants and use rolling windows; decision dates are
 * calendar days with no time, so they use whole-day windows (`grain: 'day'`) —
 * mixing the two silently is the trap the page must not fall into, and the page
 * says which rows count days.
 */
export function windowCounts(items = [], now = new Date(), dateOf = (i) => i.createdAt, { grain = 'instant' } = {}) {
  const counts = Object.fromEntries(WINDOWS.map((w) => [w, 0]))
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  for (const item of items) {
    const raw = String(dateOf(item) ?? '')
    let days
    if (grain === 'day') {
      const t = Date.parse(raw.slice(0, 10))
      if (Number.isNaN(t)) continue
      days = (todayUTC - t) / 86400000
      if (days < 0) continue
      for (const w of WINDOWS) if (days < w) counts[w] += 1
      continue
    }
    const t = Date.parse(raw)
    if (Number.isNaN(t)) continue
    days = (now.getTime() - t) / 86400000
    if (days < 0) continue
    for (const w of WINDOWS) if (days <= w) counts[w] += 1
  }
  return counts
}

/**
 * The decisions record, from its two real sources in the hub clone.
 *
 * Filed comes from the registry (`registry.json` — the id claim is the filing).
 * Decided comes from the artifacts' own machine-readable Decisions sections —
 * every dated block inside `<section id="decisions">` is one recorded decision.
 * That is the same source the published Decisions log derives from, chosen over
 * the registry's `status` field deliberately: the sweep's own checks report the
 * registry disagreeing with the index on ten artifacts tonight, and the contract
 * (reports/decisions/README.md) names the artifacts as the source of truth.
 */
export function readDecisions(hub) {
  const dir = join(hub, 'reports', 'decisions')
  const reg = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8'))
  const artifacts = reg.artifacts || []
  const filed = artifacts.map((a) => ({ id: a.id, date: a.date, title: a.title }))
  const decided = []
  for (const a of artifacts) {
    let html = ''
    try { html = readFileSync(join(dir, a.slug, 'index.html'), 'utf8') } catch { continue }
    const section = /<section[^>]*id="decisions"[^>]*>([\s\S]*?)<\/section>/i.exec(html)?.[1] ?? ''
    for (const m of section.matchAll(/data-date="(\d{4}-\d{2}-\d{2})"/g)) {
      decided.push({ id: a.id, date: m[1], title: a.title })
    }
  }
  return { filed, decided }
}

// ---- gh-facing collection (not under test; exercised live) ------------------

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 })

const iso = (d) => new Date(d).toISOString()

/**
 * Everything created in the last 365 days from one paginated, created-desc list
 * endpoint. Stops at the cutoff or at `maxPages`; if the cap hits first, the
 * truncation is RETURNED, never swallowed — a count that quietly stops early
 * reads as "that is everything", which is the house failure mode.
 */
function listSince(repo, path, cutoff, { maxPages = 5, exec = gh } = {}) {
  const items = []
  let truncated = null
  for (let page = 1; page <= maxPages; page++) {
    const batch = JSON.parse(exec(['api', `repos/${repo}/${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}&state=all&sort=created&direction=desc`]))
    items.push(...batch)
    if (batch.length < 100) return { items: items.filter((i) => Date.parse(i.created_at) >= cutoff), truncated }
    const oldest = batch[batch.length - 1]
    if (Date.parse(oldest.created_at) < cutoff) return { items: items.filter((i) => Date.parse(i.created_at) >= cutoff), truncated }
  }
  truncated = { oldestFetched: items.length ? items[items.length - 1].created_at : null }
  return { items, truncated }
}

/**
 * One full collection: every policy repo's issues, PRs and releases inside the
 * 365-day window, plus the decisions record. Per-repo failures land in `errors`
 * and cost that repo's numbers, never the whole cache — and the renderer names
 * the gap, because a metric silently missing a repo reads as a quiet week.
 */
export function collectMetrics({ repos, hub, now = new Date(), exec = gh }) {
  const cutoff = now.getTime() - 365 * 86400000
  const out = {
    fetchedAt: iso(now),
    repos: repos.map((r) => r.repo),
    issues: [], prs: [], releases: [],
    decisions: { filed: [], decided: [] },
    bounds: [], errors: [], failedRepos: [],
  }
  for (const { repo, release, integration } of repos) {
    try {
      const iss = listSince(repo, 'issues?filter=all', cutoff, { exec })
      for (const i of iss.items) {
        if (i.pull_request) continue // the issues endpoint lists PRs too; they are counted from /pulls, where base survives
        out.issues.push({ repo, number: i.number, createdAt: i.created_at, cls: classifyIssue(i, repo), state: i.state })
      }
      if (iss.truncated) out.bounds.push({ repo, kind: 'issues', ...iss.truncated })
      const prs = listSince(repo, 'pulls', cutoff, { exec })
      const laneCtx = { release, integration, epoch: BRANCH_MODEL_EPOCH[repo] ?? null }
      for (const p of prs.items) {
        out.prs.push({ repo, number: p.number, createdAt: p.created_at, lane: classifyPRLane(p, laneCtx), state: p.merged_at ? 'merged' : p.state })
      }
      if (prs.truncated) out.bounds.push({ repo, kind: 'prs', ...prs.truncated })
      const rels = JSON.parse(exec(['api', `repos/${repo}/releases?per_page=100`]))
      for (const r of rels) {
        if (r.draft) continue
        out.releases.push({ repo, tag: r.tag_name, name: r.name || r.tag_name, publishedAt: r.published_at || r.created_at })
      }
    } catch (e) {
      out.errors.push(`${repo}: ${String(e.message).slice(0, 120)}`)
      out.failedRepos.push(repo)
    }
  }
  try {
    out.decisions = readDecisions(hub)
  } catch (e) {
    // Null, not the seeded empty pair. A decisions record that could not be opened
    // is indistinguishable from one that recorded nothing once it is cached as
    // `{filed: [], decided: []}`, and the cells are what get read — the "known
    // gaps" line below the table is a footnote (jwildfire/obot.roadmap#223).
    out.decisions = null
    out.errors.push(`decisions: ${String(e.message).slice(0, 120)}`)
  }
  return out
}

/**
 * Refresh the cache if it is older than the TTL. Returns the freshest cache either
 * way. A failed refresh keeps the old cache — its `fetchedAt` keeps telling the
 * truth about its age, which is the failure contract everything here shares: stale
 * and saying so beats fresh-looking and wrong.
 */
export function refreshMetrics({ repos, hub, cacheFile, ttlMin = 60, now = new Date(), exec = gh, write, read }) {
  let prev = null
  try { prev = JSON.parse(read(cacheFile)) } catch { /* first run */ }
  const age = prev ? (now.getTime() - Date.parse(prev.fetchedAt)) / 60000 : Infinity
  if (age <= ttlMin) return { cache: prev, refreshed: false }
  try {
    const cache = collectMetrics({ repos, hub, now, exec })
    // A collection that lost every repo is a failure, not a quiet week: keep the
    // old numbers and their honest age rather than replacing them with zeros. A
    // decisions-read error alone does not count — that series has its own line.
    if (cache.failedRepos.length >= repos.length && repos.length > 0) {
      return { cache: prev ?? cache, refreshed: false, failed: cache.errors }
    }
    write(cacheFile, JSON.stringify(cache, null, 1))
    return { cache, refreshed: true }
  } catch (e) {
    return { cache: prev, refreshed: false, failed: [String(e.message).slice(0, 200)] }
  }
}
