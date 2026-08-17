// The four checks that missed the night of 2026-08-15 (D0017, adopted 2026-08-16).
//
// Six pieces of work shipped that night with nothing in the roadmap recording them,
// and the nightly audit caught one of the six. These are the mechanical half of the
// fix — the half that belongs in the five-minute sweep rather than in the session,
// because none of them needs judgment.
//
// One of the four turned out to already exist: an answer unapplied past an hour is
// already marked OVERDUE by the answers module. It is covered here anyway, because a
// check nobody has exercised is indistinguishable from one that is not there.
//
// The rule that keeps the first check usable is @jwildfire's: gate on work done, not
// on filing. The blunt version — every spoke issue needs a hub parent — fires on 26
// of the 41 open spoke issues, and a list nobody trusts is muted inside a week.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  orphanedWork, registryDisagreement, emptyCloseouts, checksSection, WINDOW_DAYS,
} from '../checks.mjs'
import { OVERDUE_MIN } from '../../ops-dashboard/lib/answers.mjs'

const day = (n) => new Date(Date.parse('2026-08-16T06:00:00Z') - n * 86400000).toISOString()
const NOW = new Date('2026-08-16T06:00:00Z')

// ---------------------------------------------------------------- orphaned work

test('an issue closed with no hub ancestor is a finding', () => {
  const found = orphanedWork([
    { repo: 'jwildfire/obot.agent', number: 116, kind: 'issue', state: 'CLOSED', closedAt: day(0.5), parent: null, title: 'unbridge siblings' },
  ], NOW)
  assert.equal(found.length, 1)
  assert.match(found[0].line, /obot\.agent#116/)
})

test('an OPEN issue with no ancestor is not a finding — the gate is work done, not filing', () => {
  const found = orphanedWork([
    { repo: 'jwildfire/obot.agent', number: 200, kind: 'issue', state: 'OPEN', parent: null, title: 'someday' },
  ], NOW)
  assert.deepEqual(found, [])
})

test('a merged pull request with no ancestor is a finding', () => {
  const found = orphanedWork([
    { repo: 'jwildfire/safety.viz', number: 9, kind: 'pr', state: 'MERGED', closedAt: day(1), parent: null, title: 'ship it' },
  ], NOW)
  assert.equal(found.length, 1)
  assert.match(found[0].line, /safety\.viz#9/)
})

test('a pull request closed unmerged is not a finding — nothing shipped', () => {
  assert.deepEqual(orphanedWork([
    { repo: 'jwildfire/safety.viz', number: 10, kind: 'pr', state: 'CLOSED', closedAt: day(1), parent: null, title: 'abandoned' },
  ], NOW), [])
})

test('an ancestor of any kind clears it — a parent in prose does not', () => {
  const found = orphanedWork([
    { repo: 'jwildfire/obot.agent', number: 130, kind: 'issue', state: 'CLOSED', closedAt: day(1), parent: { repo: 'jwildfire/obot.roadmap', number: 194 }, title: 'worker ids' },
    { repo: 'jwildfire/obot.agent', number: 118, kind: 'issue', state: 'CLOSED', closedAt: day(1), parent: null, title: 'dashboard pass — see roadmap#180', body: 'implements jwildfire/obot.roadmap#180' },
  ], NOW)
  assert.equal(found.length, 1, 'a reference in the body is not the link GitHub records')
  assert.match(found[0].line, /#118/)
})

test('the window is bounded, and what falls outside it is reported rather than dropped', () => {
  const items = [
    { repo: 'jwildfire/obot.agent', number: 1, kind: 'issue', state: 'CLOSED', closedAt: day(1), parent: null, title: 'recent' },
    { repo: 'jwildfire/obot.agent', number: 2, kind: 'issue', state: 'CLOSED', closedAt: day(WINDOW_DAYS + 5), parent: null, title: 'ancient' },
  ]
  const found = orphanedWork(items, NOW)
  assert.equal(found.length, 1)
  assert.match(found[0].line, /#1\b/)
  const rendered = checksSection({ orphans: found, orphansOutsideWindow: 1 }, NOW)
  assert.match(rendered, /1 older than/, 'a silent cap reads as full coverage')
})

// ------------------------------------------------------- registry vs the index

test('the registry and the index disagreeing about one artifact is a finding', () => {
  const found = registryDisagreement(
    { artifacts: [{ id: 'D0017', slug: 'nav', status: 'decided' }] },
    [{ slug: 'nav', decided: false }],
  )
  assert.equal(found.length, 1)
  assert.match(found[0].line, /D0017/)
})

test('agreement in either direction is silence', () => {
  assert.deepEqual(registryDisagreement(
    { artifacts: [{ id: 'D0017', slug: 'nav', status: 'decided' }] },
    [{ slug: 'nav', decided: true }],
  ), [])
  assert.deepEqual(registryDisagreement(
    { artifacts: [{ id: 'D0018', slug: 'open' }] },
    [{ slug: 'open', decided: false }],
  ), [])
})

test('an artifact the registry knows and the index does not is itself the disagreement', () => {
  const found = registryDisagreement({ artifacts: [{ id: 'D0020', slug: 'ghost', status: 'decided' }] }, [])
  assert.equal(found.length, 1)
  assert.match(found[0].line, /ghost/)
})

// ------------------------------------------------------------- empty closeouts

test('a worker that went terminal having produced nothing is a finding', () => {
  const found = emptyCloseouts([
    { id: 'abc', name: '👯🤖 W0009 2026-08-16 slug', state: 'done', firstTerminalAt: day(0.1), children: [] },
  ], NOW)
  assert.equal(found.length, 1)
  assert.match(found[0].line, /W0009/)
})

test('a worker that produced something is silence, and so is one still running', () => {
  assert.deepEqual(emptyCloseouts([
    { id: 'a', name: '👯🤖 W0010 x', state: 'done', firstTerminalAt: day(0.1), children: [{ kind: 'pr', id: '1' }] },
    { id: 'b', name: '👯🤖 W0011 x', state: 'working', children: [] },
  ], NOW), [])
})

test('the concierge and his own sessions are not workers and are never marked down', () => {
  assert.deepEqual(emptyCloseouts([
    { id: 'p', name: '🎩🤖 obot-prime', state: 'done', firstTerminalAt: day(0.1), children: [] },
    { id: 'n', name: '🧭🤖 obot-navigator', state: 'done', firstTerminalAt: day(0.1), children: [] },
  ], NOW), [])
})

test('a closeout older than the window is not re-reported every five minutes forever', () => {
  assert.deepEqual(emptyCloseouts([
    { id: 'old', name: '👯🤖 W0001 x', state: 'done', firstTerminalAt: day(WINDOW_DAYS + 3), children: [] },
  ], NOW), [])
})

// --------------------------------------------------------------- the rendering

test('the section leads with its verdict, so a summariser cannot swallow it', () => {
  const clean = checksSection({ orphans: [], registry: [], closeouts: [] }, NOW)
  assert.match(clean.split('\n').filter(Boolean)[1] || '', /clean|no findings/i)
})

test('findings lead with the count and name each one', () => {
  const out = checksSection({
    orphans: [{ line: 'obot.agent#116 closed with no requirement above it' }],
    registry: [{ line: 'D0017 — the registry says decided, the index does not' }],
    closeouts: [{ line: 'W0009 finished having produced nothing' }],
  }, NOW)
  const verdict = out.split('\n').filter(Boolean)[1]
  assert.match(verdict, /3 finding/)
  assert.match(out, /obot\.agent#116/)
  assert.match(out, /D0017/)
  assert.match(out, /W0009/)
})

test('the answers check that already exists still holds its threshold at an hour', () => {
  assert.equal(OVERDUE_MIN, 60)
})

// ------------------------------------------------------------- shaping the API

test('shapeRepo: a merged pull request that closes an issue has an ancestor', async () => {
  const { shapeRepo } = await import('../checks.mjs')
  const items = shapeRepo('jwildfire/obot.agent', {
    repository: {
      issues: { nodes: [{ number: 1, title: 'i', closedAt: day(1), parent: null }] },
      pullRequests: {
        nodes: [
          { number: 2, title: 'linked', mergedAt: day(1), closingIssuesReferences: { nodes: [{ number: 1 }] } },
          { number: 3, title: 'loose', mergedAt: day(1), closingIssuesReferences: { nodes: [] } },
        ],
      },
    },
  })
  const found = orphanedWork(items, NOW)
  // The issue is the row that carries the failure; the PR that closes it is not a
  // second one. The PR closing nothing at all is its own finding.
  assert.deepEqual(found.map((f) => `${f.repo}#${f.number}`).sort(),
    ['jwildfire/obot.agent#1', 'jwildfire/obot.agent#3'])
})

test('shapeRepo: an unreadable repository yields nothing rather than throwing', async () => {
  const { shapeRepo } = await import('../checks.mjs')
  assert.deepEqual(shapeRepo('jwildfire/x', null), [])
  assert.deepEqual(shapeRepo('jwildfire/x', { repository: null }), [])
})

test('a long list is capped in the section but its size is never hidden', async () => {
  const { SHOW_PER_GROUP } = await import('../checks.mjs')
  const rows = Array.from({ length: SHOW_PER_GROUP + 12 }, (_, i) => ({ line: `finding ${i}` }))
  const out = checksSection({ orphans: rows }, NOW)
  assert.ok(out.includes(`(${rows.length})`), 'the group heading carries the true count')
  assert.match(out, /and 12 more not shown/)
  assert.equal((out.match(/^- finding /gm) || []).length, SHOW_PER_GROUP)
})

// ------------------------------------------------------- the audit's own age

test('even a healthy audit line dates the snapshot and says what it cannot see', async () => {
  // The 2026-08-16 misreading happened at 22 hours old — inside any sane staleness
  // threshold — so the caveat has to ride on the healthy line, not only the alarm.
  const { auditFreshness } = await import('../checks.mjs')
  const r = auditFreshness({ generatedAt: '2026-08-16T04:00:00Z', counts: { total: 4 } }, NOW)
  assert.equal(r.ok, true)
  assert.match(r.summary, /2026-08-16T04:00:00Z/)
  assert.match(r.summary, /4 finding/)
  assert.match(r.summary, /invisible to it/)
})

test('the exact 2026-08-16 situation: a day-old audit is stale, and says so', async () => {
  const { auditFreshness } = await import('../checks.mjs')
  const r = auditFreshness({ generatedAt: '2026-08-15T07:52:02Z', counts: { total: 4 } }, new Date('2026-08-16T18:00:00Z'))
  assert.equal(r.ok, false)
  assert.match(r.summary, /STALE/)
  assert.match(r.summary, /as it was, not as it is/)
})

test('no findings file at all is a finding, not silence', async () => {
  const { auditFreshness } = await import('../checks.mjs')
  const r = auditFreshness(null, NOW)
  assert.equal(r.ok, false)
  assert.match(r.summary, /NO FINDINGS FILE/)
})

test('a stale audit is emphasised in the section; a fresh one is a plain line', async () => {
  const { auditFreshness } = await import('../checks.mjs')
  const stale = checksSection({ audit: auditFreshness({ generatedAt: '2026-08-14T07:00:00Z', counts: { total: 4 } }, NOW) }, NOW)
  assert.match(stale, /\*\*nightly audit: STALE/)
  const fresh = checksSection({ audit: auditFreshness({ generatedAt: '2026-08-16T04:00:00Z', counts: { total: 0 } }, NOW) }, NOW)
  assert.match(fresh, /nightly audit: last run/)
  assert.doesNotMatch(fresh, /\*\*nightly audit/)
})

test('nothing read is not a clean roadmap', () => {
  // jwildfire/obot.roadmap#223. On a machine where every `gh` call fails and there
  // is no hub clone, all three finding lists are empty because no source could be
  // opened — and the headline read "roadmap discipline: clean", two lines above its
  // own "an absent audit reads as a clean one". Callers summarise by the first line.
  const md = checksSection({
    orphans: [], registry: [], closeouts: [],
    errors: ['jwildfire/safety.viz: gh api failed', 'decisions: ENOENT'],
  })
  assert.match(md.split('\n')[2], /NOT CHECKED/)
  assert.match(md, /No finding here means no reading, not a clean roadmap/)
  assert.doesNotMatch(md, /discipline: clean/)
})

test('every source read and nothing found is still clean', () => {
  const md = checksSection({ orphans: [], registry: [], closeouts: [], errors: [] })
  assert.match(md.split('\n')[2], /roadmap discipline: clean/)
  assert.doesNotMatch(md, /NOT CHECKED/)
})
