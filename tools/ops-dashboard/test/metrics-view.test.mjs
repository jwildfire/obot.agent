// The Navigator tab's metrics view (jwildfire/obot.roadmap#218): the model, the
// staleness contract (numbers always carry their age; three missed refreshes is
// stale), and the feed grouping rule that a dateless event never claims a day.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildMetricsModel, buildFeedModel, metricsHtml, feedHtml, METRICS_STALE_MIN,
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
