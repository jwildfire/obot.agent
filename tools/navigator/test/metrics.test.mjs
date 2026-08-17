// Release metrics (jwildfire/obot.roadmap#218): the pure core under test —
// classifiers, moving windows, the decisions record's two real sources, and the
// refresh contract (a failed refresh keeps the old cache and its honest age).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  classifyIssue, classifyPRLane, windowCounts, readDecisions, refreshMetrics, WINDOWS,
  bucketPlan, trendSeries, repoEpochs, collectCloses, collectMetrics, goalSlug,
} from '../metrics.mjs'

const HUB = 'jwildfire/obot.roadmap'

test('classifyIssue: labels name the class; the hub keeps its planning taxonomy', () => {
  assert.equal(classifyIssue({ labels: [{ name: 'goal' }] }, HUB), 'goal')
  assert.equal(classifyIssue({ labels: ['requirement', 'infrastructure'] }, HUB), 'requirement')
  // A requirement that is also labelled bug is a requirement — order matters.
  assert.equal(classifyIssue({ labels: ['requirement', 'bug'] }, HUB), 'requirement')
  assert.equal(classifyIssue({ labels: ['bug'] }, 'jwildfire/safety.viz'), 'bug')
  assert.equal(classifyIssue({ labels: ['audit-decision'] }, HUB), 'audit')
  // A bare hub issue with a parent is somebody's task; with neither it is honestly
  // unclassified — a data-quality figure, not something to hide inside "task".
  assert.equal(classifyIssue({ labels: [], parent_issue_url: 'https://api.github.com/x' }, HUB), 'task')
  assert.equal(classifyIssue({ labels: [] }, HUB), 'unclassified')
  // Implementation repos: everything that is not a bug is ordinary work.
  assert.equal(classifyIssue({ labels: ['enhancement'] }, 'jwildfire/safety.viz'), 'task')
  assert.equal(classifyIssue({}, 'jwildfire/gsm.safety'), 'task')
})

test('classifyPRLane: release-role base, guarded by the branch-model epoch', () => {
  const gs = { release: ['main'], integration: 'dev', epoch: '2026-07-29' }
  assert.equal(classifyPRLane({ base: { ref: 'main' }, created_at: '2026-08-15T10:00:00Z' }, gs), 'release-candidate')
  // gsm.safety's nine early PRs into main predate its branch model — ordinary work.
  assert.equal(classifyPRLane({ base: { ref: 'main' }, created_at: '2026-06-01T10:00:00Z' }, gs), 'standard')
  // …unless the title says RC outright.
  assert.equal(classifyPRLane({ base: { ref: 'main' }, created_at: '2026-06-01T10:00:00Z', title: 'gsm.safety v0.9.0-RC1' }, gs), 'release-candidate')
  assert.equal(classifyPRLane({ base: { ref: 'dev' } }, gs), 'standard')
  // A PR into neither lane is stacked feature-branch work — its own bucket.
  assert.equal(classifyPRLane({ base: { ref: 'participant-profile' } }, gs), 'stacked')
  // The hub has no release branch at all — nothing there is an RC.
  assert.equal(classifyPRLane({ base: { ref: 'main' } }, { release: [], integration: 'main' }), 'standard')
  // No context at all degrades to standard, never to a guess.
  assert.equal(classifyPRLane({ base: { ref: 'main' } }), 'standard')
})

test('windowCounts: day grain counts whole calendar days for dated-only series', () => {
  const now = new Date('2026-08-16T22:00:00Z')
  const c = windowCounts([
    { date: '2026-08-16' }, // today → every window
    { date: '2026-08-15' }, // 1 day ago → 3d and up
    { date: '2026-08-14' }, // 2 days ago → 3d and up
  ], now, (d) => d.date, { grain: 'day' })
  assert.deepEqual(c, { 1: 1, 3: 3, 7: 3, 30: 3, 365: 3 })
})

test('windowCounts: windows are inclusive, move with now, and ignore unparseable dates', () => {
  const now = new Date('2026-08-16T22:00:00Z')
  const items = [
    { createdAt: '2026-08-16T10:00:00Z' }, // today → every window
    { createdAt: '2026-08-14T10:00:00Z' }, // 2.5 days → 3d and up
    { createdAt: '2026-08-01T10:00:00Z' }, // 15 days → 30d and up
    { createdAt: '2026-01-01T10:00:00Z' }, // 227 days → 365d only
    { createdAt: 'not-a-date' },
  ]
  const c = windowCounts(items, now)
  assert.deepEqual(c, { 1: 1, 3: 2, 7: 2, 30: 3, 365: 4 })
  assert.deepEqual(Object.keys(c).map(Number).sort((a, b) => a - b), WINDOWS)
})

test('readDecisions: filed from the registry, decided from the artifacts themselves', () => {
  const hub = mkdtempSync(join(tmpdir(), 'metrics-hub-'))
  const dir = join(hub, 'reports', 'decisions')
  mkdirSync(join(dir, '2026-08-14-example'), { recursive: true })
  mkdirSync(join(dir, '2026-08-15-open'), { recursive: true })
  writeFileSync(join(dir, 'registry.json'), JSON.stringify({
    artifacts: [
      { id: 'D0001', slug: '2026-08-14-example', date: '2026-08-14', title: 'Example' },
      // The registry says nothing about this one being decided — the artifact decides.
      { id: 'D0002', slug: '2026-08-15-open', date: '2026-08-15', title: 'Open' },
      { id: 'D0003', slug: '2026-08-15-missing', date: '2026-08-15', title: 'No page yet' },
    ],
  }))
  writeFileSync(join(dir, '2026-08-14-example', 'index.html'), `
    <section id="decisions">
      <div data-date="2026-08-16" data-channel="chat" data-resolves="A1"></div>
      <div data-date="2026-08-16" data-channel="chat" data-resolves="A2"></div>
    </section>
    <div data-date="1999-01-01">outside the section — never counted</div>`)
  writeFileSync(join(dir, '2026-08-15-open', 'index.html'), '<p>awaiting him</p>')
  const d = readDecisions(hub)
  assert.deepEqual(d.filed.map((f) => f.id), ['D0001', 'D0002', 'D0003'])
  assert.equal(d.decided.length, 2)
  assert.ok(d.decided.every((x) => x.id === 'D0001' && x.date === '2026-08-16'))
})

test('refreshMetrics: fresh cache is returned untouched; a failed refresh keeps the old cache', () => {
  const now = new Date('2026-08-16T22:00:00Z')
  const prev = { fetchedAt: '2026-08-16T21:30:00Z', issues: [{ repo: 'r', number: 1 }] }
  const fresh = refreshMetrics({
    repos: [], hub: '/nowhere', cacheFile: 'f', ttlMin: 60, now,
    read: () => JSON.stringify(prev), write: () => { throw new Error('must not write') },
  })
  assert.equal(fresh.refreshed, false)
  assert.equal(fresh.cache.fetchedAt, prev.fetchedAt)

  const stale = { fetchedAt: '2026-08-16T10:00:00Z', issues: [] }
  const failed = refreshMetrics({
    repos: [{ repo: 'jwildfire/x', release: [] }], hub: '/nowhere', cacheFile: 'f', ttlMin: 60, now,
    read: () => JSON.stringify(stale),
    write: () => { throw new Error('must not write a failed collection') },
    exec: () => { throw new Error('offline') },
  })
  assert.equal(failed.refreshed, false)
  // The old numbers survive with their honest age — never replaced with zeros.
  assert.equal(failed.cache.fetchedAt, stale.fetchedAt)
  assert.ok(failed.failed.length >= 1)
})

test('refreshMetrics: a successful refresh writes and returns the new cache', () => {
  const now = new Date('2026-08-16T22:00:00Z')
  let written = null
  const r = refreshMetrics({
    repos: [{ repo: 'jwildfire/x', release: ['main'] }], hub: '/nowhere', cacheFile: 'f', ttlMin: 60, now,
    read: () => { throw new Error('no cache yet') },
    write: (_, body) => { written = JSON.parse(body) },
    exec: (args) => {
      const path = args[1] ?? ''
      if (path.includes('/issues')) {
        return JSON.stringify([
          { number: 5, created_at: '2026-08-16T09:00:00Z', labels: [{ name: 'requirement' }], state: 'open' },
          { number: 6, created_at: '2026-08-16T09:30:00Z', pull_request: {}, state: 'open' }, // a PR in issue clothing — not double-counted
        ])
      }
      if (path.includes('/pulls')) {
        return JSON.stringify([
          { number: 7, created_at: '2026-08-16T10:00:00Z', base: { ref: 'main' }, merged_at: '2026-08-16T11:00:00Z' },
        ])
      }
      if (path.includes('/releases')) {
        return JSON.stringify([{ tag_name: 'v1.0.0', name: 'v1.0.0', published_at: '2026-08-10T00:00:00Z' }])
      }
      throw new Error(`unexpected call: ${args.join(' ')}`)
    },
  })
  assert.equal(r.refreshed, true)
  assert.equal(written.issues.length, 1)
  assert.equal(written.issues[0].cls, 'requirement')
  assert.equal(written.prs.length, 1)
  assert.equal(written.prs[0].lane, 'release-candidate')
  assert.equal(written.prs[0].state, 'merged')
  assert.equal(written.releases.length, 1)
  // The decisions read failed against /nowhere — that is an error line, not a crash.
  assert.ok(written.errors.some((e) => e.startsWith('decisions:')))
})

// ---- trends over a selectable period (jwildfire/obot.agent#155) --------------

test('bucketPlan: the piece size fits the period, and a day-grain series never sub-divides a day', () => {
  assert.deepEqual(bucketPlan(1), { size: 3600000, count: 24, unit: 'hour' })
  assert.deepEqual(bucketPlan(7), { size: 86400000, count: 7, unit: 'day' })
  assert.deepEqual(bucketPlan(30), { size: 86400000, count: 30, unit: 'day' })
  assert.equal(bucketPlan(365).unit, 'week')
  assert.equal(bucketPlan(365).count * bucketPlan(365).size >= 365 * 86400000, true, 'the weeks must cover the year')
  // The decisions record holds dates and no times. Cutting it into hours would draw
  // every decision at midnight and invent a spike that is a recording artefact.
  assert.deepEqual(bucketPlan(1, { grain: 'day' }), { size: 86400000, count: 1, unit: 'day' })
  assert.deepEqual(bucketPlan(3, { grain: 'day' }), { size: 86400000, count: 3, unit: 'day' })
})

test('trendSeries: buckets end at now, and the delta compares the period before it', () => {
  const now = new Date('2026-08-17T12:00:00Z')
  const at = (iso) => ({ createdAt: iso })
  const items = [
    at('2026-08-17T11:00:00Z'), // today — last bucket
    at('2026-08-16T11:00:00Z'), // yesterday
    at('2026-08-16T13:00:00Z'),
    at('2026-08-12T11:00:00Z'), // inside 7d
    at('2026-08-05T11:00:00Z'), // inside the PREVIOUS 7d, not this one
    at('2026-07-01T11:00:00Z'), // outside both
  ]
  const t = trendSeries(items, { period: 7, now })
  assert.equal(t.total, 4)
  assert.equal(t.prevTotal, 1, 'the comparison period is the same length, immediately before')
  assert.equal(t.buckets.length, 7)
  assert.equal(t.buckets.reduce((s, b) => s + b.n, 0), t.total, 'every counted item lands in exactly one bucket')
  // Buckets are calendar days on the UTC grid, so the newest one is TODAY — partial,
  // and nameable. A now-anchored bucket would run noon to noon and name no day.
  assert.equal(new Date(t.end).toISOString(), '2026-08-18T00:00:00.000Z')
  assert.equal(new Date(t.buckets.at(-1).start).toISOString(), '2026-08-17T00:00:00.000Z')
  assert.equal(t.buckets.at(-1).n, 1, 'today, in progress')
  assert.equal(t.buckets.at(-2).n, 2, 'both of yesterday\'s, whatever the hour')
})

test('trendSeries: a day-grain series counts something filed today rather than dropping it', () => {
  const now = new Date('2026-08-17T12:00:00Z')
  const decided = [{ date: '2026-08-17' }, { date: '2026-08-16' }, { date: '2026-08-09' }]
  const t = trendSeries(decided, { period: 7, now, dateOf: (d) => d.date, grain: 'day' })
  // A window ending at noon would put a date-only item filed today in the future and
  // silently drop it — the failure that reads as "he decided nothing today".
  assert.equal(t.total, 2)
  assert.equal(t.buckets.at(-1).n, 1)
  assert.equal(t.prevTotal, 1)
})

test('trendSeries: an item exactly on a bucket edge is counted once, in the later bucket', () => {
  const now = new Date('2026-08-17T09:00:00Z')
  const t = trendSeries([{ createdAt: '2026-08-16T00:00:00Z' }], { period: 7, now })
  assert.equal(t.total, 1)
  assert.equal(t.buckets.filter((b) => b.n).length, 1)
  assert.equal(new Date(t.buckets.find((b) => b.n).start).toISOString(), '2026-08-16T00:00:00.000Z')
})

test('trendSeries: hourly buckets sit on the hour, not on the minute now happens to be', () => {
  const now = new Date('2026-08-17T12:34:00Z')
  const t = trendSeries([{ createdAt: '2026-08-17T12:05:00Z' }], { period: 1, now })
  assert.equal(t.buckets.length, 24)
  assert.equal(new Date(t.end).toISOString(), '2026-08-17T13:00:00.000Z')
  assert.equal(t.buckets.at(-1).n, 1)
})

test('repoEpochs: where each repo\'s record actually begins, derived not declared', () => {
  const epochs = repoEpochs({
    issues: [
      { repo: 'jwildfire/obot.agent', createdAt: '2026-05-26T00:00:00Z' },
      { repo: 'jwildfire/obot.agent', createdAt: '2026-08-01T00:00:00Z' },
      { repo: 'jwildfire/demo-301', createdAt: '2026-07-29T00:00:00Z' },
    ],
    prs: [{ repo: 'jwildfire/obot.agent', createdAt: '2026-05-20T00:00:00Z' }],
    releases: [{ repo: 'jwildfire/safety.viz', publishedAt: '2026-07-12T00:00:00Z' }],
  })
  assert.equal(epochs.get('jwildfire/obot.agent'), '2026-05-20', 'the earliest of anything the repo has')
  assert.equal(epochs.get('jwildfire/demo-301'), '2026-07-29')
  assert.equal(epochs.get('jwildfire/safety.viz'), '2026-07-12')
  assert.equal(epochs.get('jwildfire/nothing'), undefined)
})

test('collectCloses: a PR\'s closing issues, with the repo that owns them', () => {
  const calls = []
  const exec = (args) => {
    calls.push(args)
    return JSON.stringify({
      data: { repository: { pullRequests: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          { number: 153, createdAt: '2026-08-17T00:00:00Z', closingIssuesReferences: { nodes: [{ number: 151, repository: { nameWithOwner: 'jwildfire/obot.agent' } }] } },
          { number: 149, createdAt: '2026-08-16T00:00:00Z', closingIssuesReferences: { nodes: [{ number: 219, repository: { nameWithOwner: 'jwildfire/obot.roadmap' } }] } },
          { number: 129, createdAt: '2026-08-15T00:00:00Z', closingIssuesReferences: { nodes: [] } },
        ],
      } } },
    })
  }
  const { closes, truncated } = collectCloses('jwildfire/obot.agent', 0, { exec })
  assert.equal(truncated, null)
  assert.deepEqual(closes.get(153), ['jwildfire/obot.agent#151'])
  // A PR closing an issue in ANOTHER repo keeps that repo — the cross-repo link is
  // exactly how spoke work reaches a hub requirement.
  assert.deepEqual(closes.get(149), ['jwildfire/obot.roadmap#219'])
  assert.equal(closes.has(129), false, 'a PR that closes nothing is absent, not empty')
  assert.equal(calls[0][1], 'graphql')
})

test('collectMetrics: goals, parents and closing links ride along with the counts', () => {
  const cache = collectMetrics({
    repos: [{ repo: 'jwildfire/obot.roadmap', release: ['main'], integration: 'main' }],
    hub: '/nowhere',
    now: new Date('2026-08-17T12:00:00Z'),
    exec: (args) => {
      const path = args[1] ?? ''
      if (path === 'graphql') {
        return JSON.stringify({ data: { repository: { pullRequests: {
          pageInfo: { hasNextPage: false },
          nodes: [{ number: 9, createdAt: '2026-08-16T00:00:00Z', closingIssuesReferences: { nodes: [{ number: 227, repository: { nameWithOwner: 'jwildfire/obot.roadmap' } }] } }],
        } } } })
      }
      if (path.includes('/issues')) {
        return JSON.stringify([
          { number: 73, created_at: '2026-07-24T00:00:00Z', labels: [{ name: 'goal' }], title: 'Goal: autonomy', state: 'open', body: 'prose\n<!-- goal-slug: autonomy -->\n' },
          { number: 227, created_at: '2026-08-17T05:00:00Z', labels: [{ name: 'requirement' }], state: 'open', parent_issue_url: 'https://api.github.com/repos/jwildfire/obot.roadmap/issues/73' },
        ])
      }
      if (path.includes('/pulls')) {
        return JSON.stringify([{ number: 9, created_at: '2026-08-16T00:00:00Z', base: { ref: 'main' } }])
      }
      if (path.includes('/releases')) return JSON.stringify([])
      throw new Error(`unexpected call: ${args.join(' ')}`)
    },
  })
  assert.deepEqual(cache.goals, [{
    repo: 'jwildfire/obot.roadmap', number: 73, title: 'Goal: autonomy',
    createdAt: '2026-07-24T00:00:00Z', state: 'open', slug: 'autonomy',
  }])
  assert.deepEqual(cache.issues.find((i) => i.number === 227).parent, { repo: 'jwildfire/obot.roadmap', number: 73 })
  assert.equal(cache.issues.find((i) => i.number === 73).parent, undefined)
  assert.deepEqual(cache.prs[0].closes, ['jwildfire/obot.roadmap#227'])
  assert.deepEqual(cache.noCloses, [])
})

test('collectMetrics: PR links failing costs goal attribution for that repo, never its counts', () => {
  const cache = collectMetrics({
    repos: [{ repo: 'jwildfire/obot.agent', release: ['main'], integration: 'main' }],
    hub: '/nowhere',
    now: new Date('2026-08-17T12:00:00Z'),
    exec: (args) => {
      const path = args[1] ?? ''
      if (path === 'graphql') throw new Error('GraphQL: rate limited')
      if (path.includes('/issues')) return JSON.stringify([])
      if (path.includes('/pulls')) return JSON.stringify([{ number: 9, created_at: '2026-08-16T00:00:00Z', base: { ref: 'main' } }])
      if (path.includes('/releases')) return JSON.stringify([])
      throw new Error(`unexpected call: ${args.join(' ')}`)
    },
  })
  assert.equal(cache.prs.length, 1, 'the PR is still counted')
  assert.equal(cache.prs[0].closes, undefined)
  assert.deepEqual(cache.noCloses, ['jwildfire/obot.agent'], 'and the gap is named rather than drawn as zero')
  assert.equal(cache.failedRepos.length, 0, 'a links failure is not a repo failure')
})

test('goalSlug: the short name comes from the goal body, the same bit the hub site reads', () => {
  assert.equal(goalSlug('direction prose\n\n<!-- goal-slug: autonomy -->\n'), 'autonomy')
  assert.equal(goalSlug('<!--goal-slug:open-csr-->'), 'open-csr')
  // No comment, no slug — the filter falls back to the issue number rather than
  // inventing a name from a title (#78's own title carries a double space).
  assert.equal(goalSlug('Goal:  Keep adding charts (static + interactive)'), null)
  assert.equal(goalSlug(null), null)
})
