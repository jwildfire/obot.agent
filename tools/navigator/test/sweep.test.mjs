// Tests for the Navigator RC-review sweep's pure core (hub#157, first capability).
// The gh-facing orchestration is exercised live; everything that decides or
// renders is pure and tested here so CI guards the contract:
//   - which PRs count as RCs (release-role base / review requested / reviewed)
//   - what deltas become events (new review, RC appeared/gone, decision change)
//   - the state file prime reads (proof-of-life header, provenance stamps,
//     failure mode that never masquerades as fresh)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoverRepos, classifyRC, diff, renderState } from '../sweep.mjs'

const policy = {
  repos: {
    'jwildfire/safety.viz': { class: 'clinical', branches: { integration: 'dev', release: ['main'] } },
    'jwildfire/obot.roadmap': { class: 'operational', branches: { integration: 'main', release: [] } },
  },
}

test('discoverRepos: every policy repo is swept; release roles carried', () => {
  const repos = discoverRepos(policy)
  assert.equal(repos.length, 2)
  const sv = repos.find(r => r.repo === 'jwildfire/safety.viz')
  assert.deepEqual(sv.release, ['main'])
  const rm = repos.find(r => r.repo === 'jwildfire/obot.roadmap')
  assert.deepEqual(rm.release, []) // no release branch — still swept via the review-requested lane
})

const pr = (over = {}) => ({
  number: 1, title: 't', url: 'u', baseRefName: 'dev', isDraft: false,
  reviewRequests: [], reviewDecision: '', updatedAt: '2026-08-15T00:00:00Z', ...over,
})

test('classifyRC: release-role base target is an RC', () => {
  assert.equal(classifyRC(pr({ baseRefName: 'main' }), ['main']), true)
})

test('classifyRC: review requested from jwildfire is an RC regardless of base', () => {
  assert.equal(classifyRC(pr({ reviewRequests: [{ login: 'jwildfire' }] }), ['main']), true)
})

test('classifyRC: an already-reviewed open PR stays in the queue', () => {
  // sv#131 case: review submitted → reviewRequests empties, but the PR is
  // still open and still his — reviewDecision keeps it visible.
  assert.equal(classifyRC(pr({ reviewDecision: 'CHANGES_REQUESTED' }), []), true)
})

test('classifyRC: drafts and ordinary integration PRs are not RCs', () => {
  assert.equal(classifyRC(pr({ baseRefName: 'main', isDraft: true }), ['main']), false)
  assert.equal(classifyRC(pr(), ['main']), false)
})

const rc = (over = {}) => ({
  repo: 'jwildfire/safety.viz', number: 131, title: 'RC v1.7.0',
  url: 'https://github.com/jwildfire/safety.viz/pull/131', base: 'main',
  reviewDecision: '', reviews: [], commentCount: 0, ...over,
})
const review = { author: 'jwildfire', state: 'CHANGES_REQUESTED', submittedAt: '2026-08-15T08:29:35Z', excerpt: 'major: dropdown' }

test('diff: identical snapshots yield no events', () => {
  const a = { 'jwildfire/safety.viz#131': rc({ reviews: [review] }) }
  assert.deepEqual(diff(a, a), [])
})

test('diff: a new review on a known RC is the headline event', () => {
  const prev = { 'jwildfire/safety.viz#131': rc() }
  const next = { 'jwildfire/safety.viz#131': rc({ reviewDecision: 'CHANGES_REQUESTED', reviews: [review] }) }
  const events = diff(prev, next)
  const kinds = events.map(e => e.type)
  assert.ok(kinds.includes('review-new'))
  const ev = events.find(e => e.type === 'review-new')
  assert.match(ev.line, /CHANGES_REQUESTED/)
  assert.match(ev.line, /safety\.viz#131/)
})

test('diff: RC appearing and disappearing are both events', () => {
  const appeared = diff({}, { 'jwildfire/safety.viz#131': rc() })
  assert.equal(appeared[0].type, 'rc-new')
  const gone = diff({ 'jwildfire/safety.viz#131': rc() }, {}, { 'jwildfire/safety.viz#131': 'MERGED' })
  assert.equal(gone[0].type, 'rc-gone')
  assert.match(gone[0].line, /MERGED/)
})

test('diff: comment growth and decision changes surface', () => {
  const prev = { 'jwildfire/safety.viz#131': rc({ commentCount: 1, reviewDecision: 'CHANGES_REQUESTED', reviews: [review] }) }
  const next = { 'jwildfire/safety.viz#131': rc({ commentCount: 3, reviewDecision: 'APPROVED', reviews: [review] }) }
  const kinds = diff(prev, next).map(e => e.type)
  assert.ok(kinds.includes('comments-new'))
  assert.ok(kinds.includes('decision-change'))
})

test('diff: a repo the sweep failed to list emits no rc-gone events', () => {
  const prev = { 'jwildfire/safety.viz#131': rc() }
  const events = diff(prev, {}, {}, new Set(['jwildfire/safety.viz']))
  assert.deepEqual(events, [])
})

const meta = { sweptAt: '2026-08-15 09:41', cadenceMin: 5, repoCount: 7, ok: true, errors: [] }

test('renderState: proof-of-life header, stamps, and review excerpt', () => {
  const md = renderState({ snapshot: { 'jwildfire/safety.viz#131': rc({ reviewDecision: 'CHANGES_REQUESTED', reviews: [review] }) }, events: [], meta })
  assert.match(md, /swept: 2026-08-15 09:41/)
  assert.match(md, /cadence 5m/)
  assert.match(md, /stale/i) // the staleness rule is stated in the file itself
  assert.match(md, /\[verified gh 09:41\]/)
  assert.match(md, /CHANGES_REQUESTED by @jwildfire/)
  assert.match(md, /major: dropdown/)
})

test('renderState: a failed sweep never reads as fresh', () => {
  const md = renderState({
    snapshot: { 'jwildfire/safety.viz#131': rc() }, events: [],
    meta: { ...meta, ok: false, errors: ['gh: auth'], sweptAt: '2026-08-15 09:46', lastGoodAt: '2026-08-15 09:41' },
  })
  assert.match(md, /FAILED/)
  assert.match(md, /09:41/) // last good sweep time is what the data is stamped to
})

test('renderState: empty queue says so explicitly', () => {
  const md = renderState({ snapshot: {}, events: [], meta })
  assert.match(md, /RC queue: EMPTY/)
})

// The Navigator is also the deliverer for decision answers (#120). It is the
// only observer that runs when no session does — launchd, every five minutes —
// so it is what turns "he clicked" into something an agent will see.
test('renderState: answers he has recorded appear in the state file prime reads', () => {
  const md = renderState({
    snapshot: {},
    events: [],
    meta,
    answers: [{
      id: 'a1', decisionId: 'D0003', artifact: '2026-08-14-demo-301-site-size',
      verdict: 'adopt-all', status: 'delivered', at: new Date().toISOString(), questions: {},
    }],
  })
  assert.match(md, /## Decision answers/)
  assert.match(md, /D0003/)
  assert.match(md, /adopt-all/)
})

test('renderState: no answers pending still says so, rather than dropping the section', () => {
  const md = renderState({ snapshot: {}, events: [], meta, answers: [] })
  assert.match(md, /## Decision answers/)
  assert.match(md, /none/i)
})

// The config list's ledger, carried by the sweep (obot.agent#126). The Navigator is
// the only thing running when no session is, so it is where a check on a local,
// history-less file actually fires. Rendering is what is pinned here; the reading
// itself is `blocker-log --audit`, tested against the tool in ops-dashboard/test.
test('renderState: a clean ledger is reported in one line, and reported at all', () => {
  const md = renderState({
    snapshot: {}, events: [], meta,
    ledger: { ok: true, summary: 'ledger clean — 13 id(s) allocated, 13 present', detail: [] },
  })
  assert.match(md, /config ledger: ledger clean — 13 id\(s\) allocated, 13 present/)
  // A detector that only ever speaks on failure cannot be told from a dead one.
  assert.doesNotMatch(md, /CONFIG LEDGER GAP/)
})

test('renderState: a gap is shouted, and brings its explanation with it', () => {
  const md = renderState({
    snapshot: {}, events: [], meta,
    ledger: {
      ok: false,
      summary: 'LEDGER GAP - 2 id(s) allocated with no entry: c0010, c0011',
      detail: ['A resolved entry MOVES to ## Resolved and is never deleted.'],
    },
  })
  assert.match(md, /\*\*CONFIG LEDGER GAP\*\* — LEDGER GAP - 2 id\(s\) allocated with no entry: c0010, c0011/)
  assert.match(md, /A resolved entry MOVES to ## Resolved/)
})

test('renderState: no reading says so rather than rendering nothing or a false all-clear', () => {
  const md = renderState({ snapshot: {}, events: [], meta })
  // Rendering nothing avoided the false all-clear and created a worse one: the
  // section's own rule is that a detector reports even when clean, precisely so its
  // silence cannot be read as health — and a detector that vanishes is silent
  // (jwildfire/obot.roadmap#223).
  assert.match(md, /config ledger: \*\*NO READING\*\*/)
  assert.match(md, /unknown, not clean/)
  assert.doesNotMatch(md, /ledger clean/)
})

test('renderState: a note is kept under a clean verdict, not dropped', () => {
  const md = renderState({
    snapshot: {}, events: [], meta,
    ledger: {
      ok: true,
      summary: 'ledger clean - 11 id(s) allocated, 11 present',
      detail: ['note - blockers.md changed outside this tool since 01:17.'],
    },
  })
  // The verdict is the headline; the note is what dates a gap if one turns up later.
  assert.match(md, /config ledger: ledger clean - 11 id\(s\) allocated, 11 present/)
  assert.match(md, /note - blockers\.md changed outside this tool/)
})

// The worker ledger, carried by the same sweep (#130). Rendering is what is pinned
// here; the reading itself is `worker-id --audit`, tested against the tool in
// worker-id.test.mjs beside this file.
test('renderState: a clean worker ledger is reported in one line, and reported at all', () => {
  const md = renderState({
    snapshot: {}, events: [], meta,
    workers: { ok: true, summary: 'ledger clean — 4 id(s) allocated, 4 worker(s) stamped', detail: [] },
  })
  assert.match(md, /worker ledger: ledger clean — 4 id\(s\) allocated, 4 worker\(s\) stamped/)
  assert.doesNotMatch(md, /WORKER LEDGER FINDING/)
})

test('renderState: an unstamped worker is shouted, and brings its instruction with it', () => {
  const md = renderState({
    snapshot: {}, events: [], meta,
    workers: {
      ok: false,
      summary: 'WORKER LEDGER - 1 unstamped worker(s) ran with no id: 👯🤖 2026-08-16 someslug',
      detail: ['Claim one with `worker-id claim --slug <slug>` BEFORE the spawn.'],
    },
  })
  assert.match(md, /\*\*WORKER LEDGER FINDING\*\* — WORKER LEDGER - 1 unstamped worker\(s\)/)
  // The finding has to carry the fix. A sweep line that only says something is
  // wrong makes the next agent go and rediscover what to do about it.
  assert.match(md, /Claim one with `worker-id claim --slug <slug>` BEFORE the spawn/)
})

test('renderState: no worker reading says so rather than rendering nothing', () => {
  const md = renderState({ snapshot: {}, events: [], meta })
  assert.match(md, /worker ledger: \*\*NO READING\*\*/)
  assert.match(md, /unknown, not clean/)
})

test('renderState: the two ledgers are independent — one silent does not silence the other', () => {
  const md = renderState({
    snapshot: {}, events: [], meta,
    ledger: { ok: true, summary: 'ledger clean - 13 id(s) allocated, 13 present', detail: [] },
    workers: { ok: false, summary: 'WORKER LEDGER - 2 unstamped worker(s) ran with no id', detail: [] },
  })
  assert.match(md, /config ledger: ledger clean/)
  assert.match(md, /\*\*WORKER LEDGER FINDING\*\*/)
})

// ---- typed events for the dashboard feed (jwildfire/obot.roadmap#218) ----
//
// The state file wants the sentence; the dashboard's Navigator feed wants the
// parts. Every event carries ref and url beside line so the feed never has to
// recover structure from prose with a regex.

test('diff: every event type carries ref and url beside its line', () => {
  const withReview = rc({ reviews: [review], reviewDecision: 'CHANGES_REQUESTED', commentCount: 3 })
  const appeared = diff({}, { k: withReview })
  for (const e of appeared) {
    assert.equal(e.ref, 'safety.viz#131', `${e.type} ref`)
    assert.equal(e.url, 'https://github.com/jwildfire/safety.viz/pull/131', `${e.type} url`)
  }
  const changed = diff({ k: rc() }, { k: withReview })
  for (const e of changed) {
    assert.equal(e.ref, 'safety.viz#131', `${e.type} ref`)
    assert.equal(e.url, 'https://github.com/jwildfire/safety.viz/pull/131', `${e.type} url`)
  }
  const gone = diff({ k: rc() }, {}, { k: 'MERGED' })
  assert.equal(gone[0].type, 'rc-gone')
  assert.equal(gone[0].ref, 'safety.viz#131')
  assert.equal(gone[0].url, 'https://github.com/jwildfire/safety.viz/pull/131')
})

test('renderState: shows at most MAX_EVENTS even when the snapshot remembers more', () => {
  const events = Array.from({ length: 40 }, (_, i) => ({ type: 'rc-new', at: '09:00', line: `EVENT ${i}` }))
  const md = renderState({
    snapshot: {}, events,
    meta: { sweptAt: '2026-08-16 22:30', cadenceMin: 5, repoCount: 7, ok: true },
  })
  assert.match(md, /EVENT 0\b/)
  assert.match(md, /EVENT 14\b/)
  assert.doesNotMatch(md, /EVENT 15\b/)
})

// ---- the first sweep on a machine with no history ------------------------
//
// jwildfire/obot.roadmap#223. Every source this sweep joins is absent on a new
// machine, and the state file it writes is read by 🎩🤖 prime and rendered whole on
// the dashboard's Navigator tab — so a confident sentence here reaches him twice.

const FRESH = { sweptAt: '2026-08-17 06:00', cadenceMin: 5, repoCount: 0, ok: false, errors: ['gh: not authenticated'], lastGoodAt: null }

test('an unread RC queue is not an empty one, and carries no verification stamp', () => {
  const md = renderState({ snapshot: {}, events: [], meta: FRESH })
  // `snapshot: {}` is what an absent snapshot file and a genuinely empty queue both
  // produce. Rendering both as "**RC queue: EMPTY.** [verified gh]" claims a
  // verification that did not happen.
  assert.match(md, /\*\*RC queue: UNREAD\*\*/)
  assert.match(md, /This is not an empty queue/)
  assert.doesNotMatch(md, /RC queue: EMPTY/)
  assert.doesNotMatch(md, /verified gh/)
})

test('a first sweep that failed does not describe a last good sweep it never had', () => {
  const md = renderState({ snapshot: {}, events: [], meta: FRESH })
  assert.doesNotMatch(md, /last good sweep unknown/)
  assert.match(md, /first sweep on this machine and it failed/)
})

test('a queue that was read and is empty still says EMPTY', () => {
  const md = renderState({ snapshot: {}, events: [], meta: { ...FRESH, ok: true, repoCount: 7, errors: [] } })
  assert.match(md, /\*\*RC queue: EMPTY\.\*\*/)
  assert.doesNotMatch(md, /UNREAD/)
})

test('the first sweep records a baseline rather than announcing week-old RCs as news', () => {
  const open = {
    'safety.viz#124': { repo: 'jwildfire/safety.viz', number: 124, title: 'nep-explorer Phase 1', base: 'main', url: 'u1', reviews: [], reviewDecision: null, commentCount: 0 },
    'obot.agent#131': { repo: 'jwildfire/obot.agent', number: 131, title: 'v0.4.0', base: 'stable', url: 'u2', reviews: [], reviewDecision: null, commentCount: 0 },
  }
  const baseline = diff({}, open, {}, new Set(), { baseline: true })
  assert.equal(baseline.length, 1)
  assert.equal(baseline[0].type, 'baseline')
  assert.match(baseline[0].line, /First sweep on this machine — 2 RCs already open/)
  // Without the flag these are two NEW RC events stamped with this morning's clock
  // and pushed to the scratchpad, which is history invented from an absent file.
  assert.equal(diff({}, open).filter((e) => e.type === 'rc-new').length, 2)
})
