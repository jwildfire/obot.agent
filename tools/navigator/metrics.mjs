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

import { parseParentUrl } from './goals.mjs'

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
 * A goal's short name, from the one machine-readable bit its body carries.
 *
 * The hub's goal collector (obot.roadmap scripts/lib/collect/goals.mjs) reads the same
 * `<!-- goal-slug: … -->` comment to name the goal's page, so a filter chip reading
 * "autonomy" and the published page at /goals/autonomy are the same name from the same
 * source. Deriving one from the title instead would drift the first time he renames a
 * goal — and #78's title already carries a double space that no slugifier would keep.
 */
export function goalSlug(body = '') {
  const m = /<!--\s*goal-slug:\s*([a-z0-9][a-z0-9._-]*)\s*-->/i.exec(String(body ?? ''))
  return m ? m[1].toLowerCase() : null
}

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
 * How a period is cut into buckets for a trend line.
 *
 * @jwildfire, 2026-08-17: "a metric driven dashboard showing trends over a selectable
 * time period". The counts already existed; a trend needs the period cut into pieces,
 * and the piece size is chosen so the shape is readable rather than so the arithmetic
 * is tidy — 30 hourly bars on a 390px phone is a texture, not a trend.
 *
 * Day-grain series (the decisions record, which records dates and no times) are
 * floored at one bucket per day. Cutting a day-grain series into hours would draw
 * every decision at midnight and invent a daily spike that is an artefact of the
 * recording format, not of anything he did.
 */
export function bucketPlan(period, { grain = 'instant' } = {}) {
  const HOUR = 3600000
  const DAY = 86400000
  const base = {
    1: { size: HOUR, count: 24, unit: 'hour' },
    3: { size: 6 * HOUR, count: 12, unit: '6 hours' },
    7: { size: DAY, count: 7, unit: 'day' },
    30: { size: DAY, count: 30, unit: 'day' },
    365: { size: 7 * DAY, count: 53, unit: 'week' },
  }[period] ?? { size: DAY, count: Math.max(1, Math.round(period)), unit: 'day' }
  if (grain === 'day' && base.size < DAY) {
    return { size: DAY, count: Math.max(1, Math.round(period)), unit: 'day' }
  }
  return base
}

/**
 * One series over one period: the buckets to draw, the total, and the same-length
 * period before it to compare against.
 *
 * Buckets end at `now` and run backwards, so the last bucket is the one in progress —
 * always partial, and labelled as such by the view rather than left to read as a
 * collapse. `prevTotal` covers `[now - 2*period, now - period)`, which is what a delta
 * has to mean for it to be a comparison rather than a coincidence.
 */
export function trendSeries(items = [], {
  period = 7, now = new Date(), dateOf = (i) => i.createdAt, grain = 'instant',
} = {}) {
  const plan = bucketPlan(period, { grain })
  // Buckets sit on a fixed UTC grid rather than on wherever `now` happens to fall, so
  // a daily bucket is a DAY — one he can name — instead of noon-to-noon. Two things
  // depend on it: the bars can be labelled with real dates, and a date-only item
  // filed today lands in today's bucket rather than in the future, where a
  // now-anchored window silently drops it and the page reads "he decided nothing".
  const end = Math.ceil(now.getTime() / plan.size) * plan.size
  const span = plan.size * plan.count
  const start = end - span
  const buckets = Array.from({ length: plan.count }, (_, i) => ({
    start: start + i * plan.size, end: start + (i + 1) * plan.size, n: 0,
  }))
  let total = 0
  let prevTotal = 0
  for (const item of items) {
    const raw = String(dateOf(item) ?? '')
    const t = Date.parse(grain === 'day' ? raw.slice(0, 10) : raw)
    if (Number.isNaN(t)) continue
    if (t >= start && t < end) {
      total += 1
      const idx = Math.min(plan.count - 1, Math.floor((t - start) / plan.size))
      buckets[idx].n += 1
    } else if (t >= start - span && t < start) {
      prevTotal += 1
    }
  }
  return { plan, start, end, buckets, total, prevTotal }
}

/**
 * The earliest thing each repo has on record here, per kind.
 *
 * This is the honest floor for "when did measurement begin" on a per-repo basis: five
 * of the seven repos only exist under this account from the 2026-07-02 consolidation,
 * and anything earlier lives in another org under other issue numbers. Derived rather
 * than declared, because a constant would go stale the day a repo is added.
 */
export function repoEpochs(cache = {}) {
  const out = new Map()
  const note = (repo, at) => {
    const d = String(at ?? '').slice(0, 10)
    if (!d) return
    const prev = out.get(repo)
    if (!prev || d < prev) out.set(repo, d)
  }
  for (const i of cache.issues ?? []) note(i.repo, i.createdAt)
  for (const p of cache.prs ?? []) note(p.repo, p.createdAt)
  for (const r of cache.releases ?? []) note(r.repo, r.publishedAt)
  return out
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
 * Which issues a pull request closes, from the one field that is a link rather than
 * a sentence.
 *
 * REST `/pulls` does not carry it, so this is the collector's only GraphQL call. It
 * is the same field tools/navigator/checks.mjs treats as a PR's ancestor evidence —
 * deliberately, because the goal filter and the discipline checks must not disagree
 * about what a PR is attached to.
 */
export const CLOSES_QUERY = `
query($owner:String!, $name:String!, $cursor:String) {
  repository(owner:$owner, name:$name) {
    pullRequests(first:100, orderBy:{field:CREATED_AT, direction:DESC}, after:$cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number createdAt
        closingIssuesReferences(first:10) { nodes { number repository { nameWithOwner } } }
      }
    }
  }
}`

/**
 * `Map<prNumber, ['owner/repo#n', …]>` for one repo, back to the cutoff.
 *
 * Same no-silent-caps rule as `listSince`: when the page cap is reached before the
 * cutoff, the shortfall is returned so the view can say which PRs were never asked
 * about, rather than showing them as attached to nothing.
 */
export function collectCloses(repo, cutoff, { maxPages = 4, exec = gh } = {}) {
  const [owner, name] = repo.split('/')
  const closes = new Map()
  let cursor = null
  for (let page = 1; page <= maxPages; page++) {
    const args = ['api', 'graphql', '-f', `query=${CLOSES_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`]
    if (cursor) args.push('-f', `cursor=${cursor}`)
    const conn = JSON.parse(exec(args))?.data?.repository?.pullRequests
    if (!conn) break
    let oldest = Infinity
    for (const n of conn.nodes ?? []) {
      const refs = (n.closingIssuesReferences?.nodes ?? [])
        .map((r) => `${r.repository?.nameWithOwner ?? repo}#${r.number}`)
      if (refs.length) closes.set(n.number, refs)
      oldest = Math.min(oldest, Date.parse(n.createdAt))
    }
    if (!conn.pageInfo?.hasNextPage || oldest < cutoff) return { closes, truncated: null }
    cursor = conn.pageInfo.endCursor
  }
  return { closes, truncated: { kind: 'closes' } }
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
    issues: [], prs: [], releases: [], goals: [],
    decisions: { filed: [], decided: [] },
    bounds: [], errors: [], failedRepos: [], noCloses: [],
  }
  for (const { repo, release, integration } of repos) {
    try {
      const iss = listSince(repo, 'issues?filter=all', cutoff, { exec })
      for (const i of iss.items) {
        if (i.pull_request) continue // the issues endpoint lists PRs too; they are counted from /pulls, where base survives
        const cls = classifyIssue(i, repo)
        // The structural sub-issue link, and nothing else. `parent_issue_url` names
        // the parent's repo as well as its number, so a cross-repo parent resolves
        // without assuming parents live in the hub — they nearly always do, and
        // "nearly always" is not a thing to hard-code into a filter.
        const parent = parseParentUrl(i.parent_issue_url)
        out.issues.push({
          repo, number: i.number, createdAt: i.created_at, cls, state: i.state,
          ...(parent ? { parent } : {}),
        })
        // Goals are the filter's vocabulary, so they carry their title and their
        // creation date: nothing can belong to a goal before the goal existed, and
        // that date is what stops a goal-filtered trend from drawing a flat run of
        // zeros over months when the goal was filed last week.
        if (cls === 'goal') {
          out.goals.push({
            repo, number: i.number, title: i.title, createdAt: i.created_at, state: i.state,
            slug: goalSlug(i.body),
          })
        }
      }
      if (iss.truncated) out.bounds.push({ repo, kind: 'issues', ...iss.truncated })
      const prs = listSince(repo, 'pulls', cutoff, { exec })
      const laneCtx = { release, integration, epoch: BRANCH_MODEL_EPOCH[repo] ?? null }
      // A PR's only structural route into the plan. If this call fails the repo keeps
      // every other number it has; what it loses is goal attribution for its PRs, and
      // the repo is named so the view can report the gap instead of drawing zeros.
      let closes = new Map()
      try {
        const c = collectCloses(repo, cutoff, { exec })
        closes = c.closes
        if (c.truncated) out.bounds.push({ repo, kind: 'pr closing links', oldestFetched: null })
      } catch (e) {
        out.noCloses.push(repo)
        out.errors.push(`${repo} pr links: ${String(e.message).slice(0, 80)}`)
      }
      for (const p of prs.items) {
        const refs = closes.get(p.number)
        out.prs.push({
          repo, number: p.number, createdAt: p.created_at,
          lane: classifyPRLane(p, laneCtx), state: p.merged_at ? 'merged' : p.state,
          ...(refs ? { closes: refs } : {}),
        })
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
