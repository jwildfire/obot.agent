// The Navigator tab's metrics view (jwildfire/obot.roadmap#218): the model, the
// staleness contract (numbers always carry their age; three missed refreshes is
// stale), and the feed grouping rule that a dateless event never claims a day.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildMetricsModel, buildFeedModel, metricsHtml, feedHtml, METRICS_STALE_MIN,
  parseFilters, filterHref, PERIOD_DEFAULT,
} from '../lib/metrics-view.mjs'

const now = new Date('2026-08-16T22:00:00Z')

const cache = {
  fetchedAt: '2026-08-16T21:30:00Z',
  repos: ['jwildfire/a', 'jwildfire/b'],
  issues: [
    { repo: 'jwildfire/a', number: 1, createdAt: '2026-08-16T10:00:00Z', cls: 'requirement' },
    { repo: 'jwildfire/a', number: 2, createdAt: '2026-08-10T10:00:00Z', cls: 'bug' },
  ],
  prs: [{ repo: 'jwildfire/a', number: 3, createdAt: '2026-08-16T09:00:00Z', lane: 'release-candidate' }],
  releases: [{ repo: 'jwildfire/a', tag: 'v1.0.0', name: 'v1.0.0', publishedAt: '2026-08-15T00:00:00Z' }],
  decisions: {
    filed: [{ id: 'D0001', date: '2026-08-14' }],
    decided: [{ id: 'D0001', date: '2026-08-16' }],
  },
  bounds: [], errors: [],
}

test('buildMetricsModel: rows carry moving-window counts and the decisions epochs', () => {
  const m = buildMetricsModel(cache, now)
  assert.equal(m.stale, false)
  assert.equal(m.ageMin, 30)
  const req = m.rows.find((r) => r.label === 'requirements')
  assert.deepEqual(req.counts, { 1: 1, 3: 1, 7: 1, 30: 1, 365: 1 })
  const rel = m.rows.find((r) => r.label === 'releases published')
  assert.equal(rel.counts[3], 1)
  assert.equal(m.rows.find((r) => r.label === 'filed for him').epoch, '2026-08-14')
  assert.equal(m.rows.find((r) => r.label === 'decided by him').epoch, '2026-08-16')
})

test('buildMetricsModel: numbers past three missed refreshes are stale, and a missing cache is null', () => {
  const old = buildMetricsModel({ ...cache, fetchedAt: '2026-08-16T18:00:00Z' }, now)
  assert.equal(old.ageMin > METRICS_STALE_MIN, true)
  assert.equal(old.stale, true)
  assert.equal(buildMetricsModel(null, now), null)
})

test('metricsHtml: says the age, names the epochs, and a stale cache says so in words', () => {
  const html = metricsHtml(buildMetricsModel(cache, now))
  assert.match(html, /Counted from GitHub across 2 project repos/)
  assert.match(html, /min ago/)
  assert.match(html, /2026-07-02/) // history epoch — the 365d column is the programme's life
  assert.match(html, /filed since 2026-08-14/i)
  const stale = metricsHtml(buildMetricsModel({ ...cache, fetchedAt: '2026-08-16T10:00:00Z' }, now))
  assert.match(stale, /stale/)
  const none = metricsHtml(null)
  assert.match(none, /No numbers yet/)
})

test('metricsHtml: known gaps are named, never swallowed', () => {
  const html = metricsHtml(buildMetricsModel({
    ...cache,
    errors: ['jwildfire/b: boom'],
    bounds: [{ repo: 'jwildfire/a', kind: 'prs', oldestFetched: '2026-01-05T00:00:00Z' }],
  }, now))
  assert.match(html, /Known gaps/)
  assert.match(html, /counting failed for jwildfire\/b/)
  assert.match(html, /history older than 2026-01-05 not counted/)
})

test('buildFeedModel: day-grouped newest-first; a dateless event never claims a day', () => {
  const events = [
    { type: 'rc-new', ts: '2026-08-16T21:41:00Z', line: 'NEW RC a#1 "t" → main https://x', url: 'https://x', stamp: '[verified gh 21:41]' },
    { type: 'rc-gone', ts: '2026-08-15T10:00:00Z', line: 'RC GONE a#0 — MERGED' },
    { type: 'review-new', at: '10:41', line: 'REVIEW a#1 APPROVED by @j' }, // pre-ts event
  ]
  const groups = buildFeedModel(events, now)
  assert.deepEqual(groups.map((g) => g.day), ['today', 'yesterday', 'earlier'])
  const first = groups[0].items[0]
  assert.equal(first.badge, 'NEW RC')
  assert.equal(first.url, 'https://x')
  assert.equal(first.stamp, 'verified gh 21:41')
  assert.doesNotMatch(first.text, /https/)
  // The pre-ts event keeps its bare clock and claims no day it cannot prove.
  assert.equal(groups[2].items[0].time, '10:41')
})

test('feedHtml: renders groups and an honest empty state', () => {
  const html = feedHtml(buildFeedModel([{ type: 'rc-new', ts: '2026-08-16T21:41:00Z', line: 'NEW RC x', url: 'u' }], now))
  assert.match(html, /What changed/)
  assert.match(html, /NEW RC/)
  assert.match(feedHtml([]), /Nothing recorded yet/)
})

// ---- the selectable period and the two filters (jwildfire/obot.agent#155) ----

test('a cache written before goal links existed says so, instead of showing no goals', () => {
  // The sweep refreshes hourly, so for up to an hour after this ships the page reads
  // exactly this cache. An empty goal row would read as "there are no goals".
  const old = buildMetricsModel(cache, now, {})
  assert.equal(old.goalsUnavailable, true)
  const html = metricsHtml(old)
  assert.match(html, /not in these numbers yet/)
  assert.doesNotMatch(html, /all goals/, 'no goal chips are offered when none can be resolved')
  // …whereas a new cache that genuinely has no goals still offers the control.
  const fresh = buildMetricsModel({ ...cache, goals: [] }, now, {})
  assert.equal(fresh.goalsUnavailable, false)
  assert.match(metricsHtml(fresh), /all goals/)
})

const filterCache = {
  ...cache,
  repos: ['jwildfire/a', 'jwildfire/b'],
  goals: [
    { repo: 'jwildfire/hub', number: 73, title: 'Goal: autonomy', slug: 'autonomy', createdAt: '2026-07-24T00:00:00Z' },
    { repo: 'jwildfire/hub', number: 78, title: 'Goal: charts', slug: 'charts', createdAt: '2026-07-24T00:00:00Z' },
  ],
  issues: [
    { repo: 'jwildfire/a', number: 1, createdAt: '2026-08-16T10:00:00Z', cls: 'requirement', parent: { repo: 'jwildfire/hub', number: 73 } },
    { repo: 'jwildfire/a', number: 2, createdAt: '2026-08-16T11:00:00Z', cls: 'requirement', parent: { repo: 'jwildfire/hub', number: 78 } },
    { repo: 'jwildfire/b', number: 3, createdAt: '2026-08-16T12:00:00Z', cls: 'requirement' },
  ],
  prs: [
    { repo: 'jwildfire/a', number: 4, createdAt: '2026-08-16T09:00:00Z', lane: 'standard', closes: ['jwildfire/a#1'] },
    { repo: 'jwildfire/a', number: 5, createdAt: '2026-08-16T09:30:00Z', lane: 'standard' },
  ],
}

test('parseFilters: a period or a name the record does not hold never silently zeroes the page', () => {
  assert.equal(parseFilters('', filterCache).period, PERIOD_DEFAULT)
  assert.equal(parseFilters('period=30', filterCache).period, 30)
  // Not one of his five: fall back rather than draw an unnamed window.
  assert.equal(parseFilters('period=abc', filterCache).period, PERIOD_DEFAULT)
  assert.equal(parseFilters('period=-1', filterCache).period, PERIOD_DEFAULT)
  assert.equal(parseFilters('period=999', filterCache).period, PERIOD_DEFAULT)
  // Repos resolve by short name or full name; goals by slug or number.
  assert.equal(parseFilters('repo=a', filterCache).repo, 'jwildfire/a')
  assert.equal(parseFilters('repo=jwildfire/a', filterCache).repo, 'jwildfire/a')
  assert.equal(parseFilters('goal=autonomy', filterCache).goal.number, 73)
  assert.equal(parseFilters('goal=73', filterCache).goal.number, 73)
  // A name that is not on record is dropped AND reported — filtering everything to
  // zero over a typo is the failure mode this page is built against.
  const bad = parseFilters('repo=nope&goal=bogus', filterCache)
  assert.equal(bad.repo, null)
  assert.equal(bad.goal, null)
  assert.deepEqual(bad.unknown, ['repo "nope"', 'goal "bogus"'])
})

test('filterHref: changing one filter keeps the other two', () => {
  const cur = { period: 30, repo: 'jwildfire/a', goal: { number: 73, slug: 'autonomy' } }
  assert.equal(filterHref(cur, { period: 7 }), '/navigator?repo=a&goal=autonomy', 'the default period is not spelled out')
  assert.equal(filterHref(cur, { repo: null }), '/navigator?period=30&goal=autonomy')
  assert.equal(filterHref(cur, { goal: null }), '/navigator?period=30&repo=a')
  assert.equal(filterHref({ period: 7, repo: null, goal: null }, {}), '/navigator')
})

test('the goal filter counts what it dropped over each tile\'s own class and window', () => {
  const f = parseFilters('goal=autonomy', filterCache)
  const m = buildMetricsModel(filterCache, now, f)
  const req = m.tiles.find((t) => t.label === 'requirements')
  assert.equal(req.total, 1, 'only the requirement under #73')
  // #3 has no goal at all: counted under no goal, and said so here.
  assert.equal(req.unlinked, 1)
  // #2 is under a different goal — real work, somebody else's direction, dropped quietly.
  assert.equal(req.elsewhere, 1)
  const std = m.tiles.find((t) => t.label === 'standard lane')
  assert.equal(std.total, 1)
  assert.equal(std.unlinked, 1, 'the PR that closes nothing was never asked the question')
})

test('a series the filter cannot answer says why, and never renders a zero', () => {
  const m = buildMetricsModel(filterCache, now, parseFilters('goal=autonomy', filterCache))
  const rel = m.tiles.find((t) => t.label === 'releases published')
  assert.match(rel.blocked, /release carries no structural link to a goal/)
  const dec = m.tiles.find((t) => t.label === 'decided by him')
  assert.match(dec.blocked, /decision artifact carries no goal link/)
  const html = metricsHtml(m)
  assert.match(html, /Not attributable: a release carries no structural link to a goal/)
  // A blocked tile shows an em dash where the number would be, and no chart at all.
  assert.match(html, /class="t-value t-na"/)
  // Under a repo filter it is the decisions that cannot answer, for a different reason.
  const byRepo = buildMetricsModel(filterCache, now, parseFilters('repo=a', filterCache))
  assert.match(byRepo.tiles.find((t) => t.label === 'filed for him').blocked, /programme-wide, not per repo/)
  assert.equal(byRepo.tiles.find((t) => t.label === 'releases published').blocked, null)
})

test('the goal filter states its own coverage before he reads a number', () => {
  const html = metricsHtml(buildMetricsModel(filterCache, now, parseFilters('goal=autonomy', filterCache)))
  // 2 of 3 issues and 1 of 2 PRs carry a link to SOME goal.
  assert.match(html, /2 of 3 issues \(67%\)/)
  assert.match(html, /1 of 2 pull requests \(50%\)/)
  // No filter, no claim about coverage.
  assert.doesNotMatch(metricsHtml(buildMetricsModel(filterCache, now, {})), /Goal filter on/)
})

test('the delta is withheld when the period before this one predates measurement', () => {
  const m = buildMetricsModel(cache, now, { period: 365 })
  const decided = m.tiles.find((t) => t.label === 'decided by him')
  assert.equal(decided.comparable, false)
  assert.equal(decided.delta, null)
  assert.match(metricsHtml(m), /no comparable period/)
  // Not only the decisions row: with only a week of record, a 7-day view has no
  // comparable week behind it either, and says so rather than inventing +100%.
  assert.equal(buildMetricsModel(cache, now, { period: 7 })
    .tiles.find((t) => t.label === 'requirements').comparable, false)
  // …and the comparison IS offered once the record reaches back past it.
  const withHistory = {
    ...cache,
    issues: [...cache.issues, { repo: 'jwildfire/a', number: 9, createdAt: '2026-06-01T00:00:00Z', cls: 'requirement' }],
  }
  assert.equal(buildMetricsModel(withHistory, now, { period: 7 })
    .tiles.find((t) => t.label === 'requirements').comparable, true)
})

test('a filter name that is not on record is reported on the page, not silently ignored', () => {
  const html = metricsHtml(buildMetricsModel(filterCache, now, parseFilters('repo=nope', filterCache)))
  assert.match(html, /Ignored, because it is not in the record/)
  assert.match(html, /repo &quot;nope&quot;|repo "nope"/)
})

test('filter values are escaped: a goal slug cannot inject markup into its own chip', () => {
  const nasty = {
    ...filterCache,
    goals: [{ repo: 'jwildfire/hub', number: 9, title: '<img src=x onerror=alert(1)>', slug: 'a"><script>x</script>', createdAt: '2026-07-24T00:00:00Z' }],
  }
  const html = metricsHtml(buildMetricsModel(nasty, now, {}))
  assert.doesNotMatch(html, /<script>x<\/script>/)
  assert.doesNotMatch(html, /<img src=x/)
})

// ---- what the adversarial pass found, pinned so it cannot come back -----------

test('a goal whose slug is null is never selected by a URL that names no goal', () => {
  // `find` on a null needle matched `g.slug === null`, so bare /navigator silently
  // applied that goal and rendered every tile as 0 or "not attributable" — a filtered
  // page presenting itself as the whole picture.
  const withNullSlug = {
    ...filterCache,
    goals: [{ repo: 'jwildfire/hub', number: 230, title: 'Goal: new', slug: null, createdAt: '2026-08-01T00:00:00Z' }],
  }
  assert.equal(parseFilters('', withNullSlug).goal, null)
  assert.equal(parseFilters('period=7', withNullSlug).goal, null)
  assert.doesNotMatch(metricsHtml(buildMetricsModel(withNullSlug, now, parseFilters('', withNullSlug))), /Of everything on record/)
  // …and it is still reachable by its number, which is the only handle it has.
  assert.equal(parseFilters('goal=230', withNullSlug).goal.number, 230)
})

test('the goal\'s creation date is not treated as a measurement floor', () => {
  // Sub-issue links are granted retroactively: requirements filed before a goal existed
  // get linked to it afterwards. Flooring the hatch at the goal's birthday drew a band
  // captioned "before this series could record anything" with real bars inside it.
  const retro = {
    ...filterCache,
    issues: [
      { repo: 'jwildfire/a', number: 1, createdAt: '2026-07-01T00:00:00Z', cls: 'requirement', parent: { repo: 'jwildfire/hub', number: 73 } },
      ...filterCache.issues,
    ],
  }
  const m = buildMetricsModel(retro, now, parseFilters('period=365&goal=autonomy', retro))
  const req = m.tiles.find((t) => t.label === 'requirements')
  assert.equal(req.total, 2)
  // A bucket may straddle the boundary — the hatch ends on the real date, not on a
  // bucket edge. What must never happen is a counted bucket lying WHOLLY inside the
  // span the caption calls unrecordable.
  const inside = req.buckets.filter((b) => b.n && req.zone.unmeasuredUntil && b.end <= req.zone.unmeasuredUntil)
  assert.deepEqual(inside, [], 'no counted bucket may lie wholly inside the unrecordable span')
})

test('the comparison uses complete buckets on both sides, and says so when it cannot', () => {
  // 24% of a day measured against a whole previous day printed "-6": a fall invented
  // by the clock. Now both sides are complete buckets, or there is no comparison.
  const decisions = {
    ...cache,
    decisions: {
      filed: [{ id: 'D1', date: '2026-08-16' }, { id: 'D2', date: '2026-08-16' }, { id: 'D3', date: '2026-08-17' }],
      decided: [],
    },
  }
  const midMorning = new Date('2026-08-17T06:00:00Z')
  const oneDay = buildMetricsModel(decisions, midMorning, { period: 1 })
  const filed = oneDay.tiles.find((t) => t.label === 'filed for him')
  assert.equal(filed.total, 1, 'the headline still counts today')
  assert.equal(filed.comparable, false, 'but today alone has no complete bucket to compare')
  assert.equal(filed.delta, null)
  assert.match(metricsHtml(oneDay), /this one has not finished yet/)
  // Over a week there ARE complete days, and the comparison names what it covers.
  const week = buildMetricsModel(decisions, midMorning, { period: 7 })
  const w = week.tiles.find((t) => t.label === 'filed for him')
  assert.equal(w.total, 3, 'the headline includes today')
  assert.equal(w.inProgress, true)
  assert.match(metricsHtml(week), /previous complete \d+d/)
})

test('the folded table refuses the same filters the tiles refuse', () => {
  const m = buildMetricsModel(filterCache, now, parseFilters('goal=autonomy', filterCache))
  const html = metricsHtml(m)
  // It printed releases as five zeros directly beneath a tile saying "not attributable",
  // and printed the decisions rows unfiltered beneath tiles that refused to answer.
  const rel = m.rows.find((r) => r.label === 'releases published')
  assert.match(rel.blocked, /release carries no structural link to a goal/)
  assert.match(m.rows.find((r) => r.label === 'filed for him').blocked, /no goal link/)
  assert.match(html, /not attributable &mdash; a release carries no structural link to a goal/)
  // With no filter, both rows are ordinary counted rows again.
  const plain = buildMetricsModel(filterCache, now, {})
  assert.equal(plain.rows.find((r) => r.label === 'releases published').blocked, null)
  assert.equal(plain.rows.find((r) => r.label === 'filed for him').blocked, null)
})

test('nothing on the filter bar exists only behind a hover', () => {
  const html = metricsHtml(buildMetricsModel(filterCache, now, parseFilters('goal=autonomy', filterCache)))
  // The repo chips carried their record-start in a tooltip; it is on every tile instead.
  assert.doesNotMatch(html, /title="on record here since/)
  // The selected goal's full name is visible text, not a tooltip.
  assert.match(html, /Showing Goal: autonomy \(#73\)/)
})

test('a band never claims a span the series has data in — whatever the declared floor', () => {
  // The release lane's floor is its repo's branch-model date, but the lane classifier
  // has a title escape hatch, so one gsm.safety PR really is a release candidate three
  // weeks before that repo's release lane is meant to exist. The band yields to the
  // data, not the other way round.
  const early = {
    ...cache,
    repos: ['jwildfire/gsm.safety'],
    issues: [{ repo: 'jwildfire/gsm.safety', number: 1, createdAt: '2026-07-01T00:00:00Z', cls: 'task' }],
    prs: [{ repo: 'jwildfire/gsm.safety', number: 2, createdAt: '2026-07-09T00:00:00Z', lane: 'release-candidate' }],
  }
  const rc = buildMetricsModel(early, now, { period: 365 }).tiles.find((t) => t.label === 'release candidates')
  assert.equal(rc.total, 1)
  assert.ok(rc.zone.unmeasuredUntil <= Date.parse('2026-07-09T00:00:00Z'),
    'the declared 2026-07-29 branch-model floor must yield to the release that predates it')
  assert.deepEqual(rc.buckets.filter((b) => b.n && b.end <= rc.zone.unmeasuredUntil), [])
})
