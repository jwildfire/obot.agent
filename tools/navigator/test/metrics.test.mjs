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
