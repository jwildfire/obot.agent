// What the page is not allowed to imply.
//
// Every test here is one sentence of the brief turned into an assertion. The page shows
// a record that is one day deep; the defect it is being built against is a surface that
// renders a plausible shape over a record that does not support it. So: the true span
// has to be ON the page, a frame that could not be reconstructed has to SAY SO on that
// frame, the bench has to look unranked because it is, and nothing derived may be
// silently blank when GitHub did not answer.
import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import { fmt, renderPage, spanSentence } from '../render.mjs'

const frame = (i, issues, extra = {}) => ({
  index: i,
  sha: `${i}`.repeat(40),
  short: `sha000${i}`,
  iso: `2026-08-20T1${i}:00:00-04:00`,
  subject: `commit ${i}`,
  body: `the reason for commit ${i}`,
  first: i === 1,
  reconstructed: true,
  why: '',
  order: issues.map((issue) => ({ issue, why: `why ${issue}`, review: null })),
  change: { known: i !== 1, why: '', entered: [], left: [], moved: [], held: [] },
  ...extra,
})

const row = (rank, issue, extra = {}) => ({
  rank,
  issue,
  why: `why ${issue}`,
  review: null,
  present: true,
  title: `Requirement: thing ${issue}`,
  url: `https://github.com/jwildfire/obot.roadmap/issues/${issue}`,
  state: 'open',
  milestone: '2026q3',
  labels: ['top10'],
  blocked: false,
  sub: null,
  member: true,
  closedAt: null,
  ...extra,
})

const data = (over = {}) => ({
  generatedAt: '2026-08-21T03:00:00-04:00',
  tz: 'America/New_York',
  repo: 'jwildfire/obot.roadmap',
  label: 'top10',
  benchLabel: 'on-deck',
  boundary: 'the ten carrying top10 are ranked; the bench is what a slot is filled from',
  order: {
    read: true,
    why: '',
    touched: { read: true, iso: '2026-08-20T21:41:59-04:00', ageMin: 320, dirty: false },
    rows: [row(1, 279), row(2, 272)],
  },
  findings: [],
  live: { read: true, why: '', at: '2026-08-21T03:00:00-04:00' },
  bench: { read: true, why: '', rows: [row(null, 282, { labels: ['on-deck'], member: null })] },
  history: {
    read: true,
    why: '',
    frames: [frame(1, [279, 272]), frame(2, [272, 279])],
    span: { frames: 2, from: '2026-08-20T11:00:00-04:00', to: '2026-08-20T12:00:00-04:00', days: 1 },
    reversals: [],
    unreconstructed: 0,
    unseenInReversals: 0,
  },
  membership: {
    read: true,
    why: '',
    span: { from: '2026-08-19T01:32:55Z', to: '2026-08-21T01:41:31Z', events: 61, complete: true, why: '' },
    states: [{ iso: '2026-08-19T01:32:55Z', endIso: '2026-08-19T01:33:53Z', events: 10, changes: [{ action: 'labeled', label: 'top10', issue: 278 }], sets: { top10: [278], 'on-deck': [] } }],
    pages: 3,
  },
  issues: {},
  ...over,
})

describe('the page states the true reach of the record', () => {
  test('names the first ranked commit, to the minute, and the frame count', () => {
    const html = renderPage(data())
    assert.match(html, /2026-08-20/)
    assert.match(html, /11:00/)
    assert.match(html, /2 frames|2 commits/i)
  })

  test('says the ranked record is one day, in words a reader cannot miss', () => {
    const s = spanSentence(data())
    assert.match(s, /one day|1 day/i)
  })

  test('names both records separately — order from the store, membership from the labels', () => {
    const html = renderPage(data())
    assert.match(html, /rank\/top10\.json/)
    assert.match(html, /label/i)
    assert.match(html, /2026-08-18|2026-08-19/)
  })
})

describe('a frame that could not be reconstructed says so, on that frame', () => {
  const broken = data({
    history: {
      read: true,
      why: '',
      frames: [
        frame(1, [279, 272]),
        { ...frame(2, []), reconstructed: false, order: null, why: 'rank/top10.json at sha0002 is not readable JSON', change: { known: false, why: 'this frame could not be reconstructed', entered: null, left: null, moved: null, held: null } },
      ],
      span: { frames: 2, from: '2026-08-20T11:00:00-04:00', to: '2026-08-20T12:00:00-04:00', days: 1 },
      reversals: [],
      unreconstructed: 1,
      unseenInReversals: 1,
    },
  })

  test('the frame carries its own failure text, not an empty order', () => {
    const html = renderPage(broken)
    assert.match(html, /not readable JSON/)
    assert.match(html, /could not be reconstructed/i)
  })

  test('the page as a whole admits the history has a hole in it', () => {
    const html = renderPage(broken)
    assert.match(html, /1 of 2|one of the 2|1 frame/i)
  })

  test('a clean history does not print a hole that does not exist', () => {
    const html = renderPage(data())
    assert.doesNotMatch(html, /could not be reconstructed/i)
  })
})

describe('the two tiers look like what they are', () => {
  test('a ranked card carries its rank and a bench card carries none', () => {
    const html = renderPage(data())
    assert.match(html, /class="rank"[^>]*>1</)
    // The bench card exists...
    assert.match(html, /issues\/282/)
    // ...and the bench section says out loud that it is not an order.
    assert.match(html, /unranked/i)
  })

  test('a review note on a row is surfaced rather than swallowed', () => {
    const html = renderPage(data({
      order: { ...data().order, rows: [row(1, 260, { review: 'prime was wrong and the evidence arrived that night' })] },
    }))
    assert.match(html, /prime was wrong and the evidence arrived that night/)
  })
})

describe('derived fields that GitHub did not answer for are never blank', () => {
  test('a ranked row GitHub did not return says so in place of a title', () => {
    const html = renderPage(data({
      order: { ...data().order, rows: [row(1, 999, { present: false, title: null, state: null, milestone: null })] },
    }))
    assert.match(html, /not returned by GitHub/i)
  })

  test('an unread GitHub is stated at the top of the page, not implied by empty cards', () => {
    const html = renderPage(data({
      live: { read: false, why: 'gh exited 1: bad credentials', at: null },
    }))
    assert.match(html, /bad credentials/)
  })
})

describe('the page respects the house rules it inherits', () => {
  test('it inlines the shared stylesheet rather than restating the palette', () => {
    const html = renderPage(data())
    assert.match(html, /obot shared stylesheet/)
  })

  test('it carries a description the deploy check will accept', () => {
    const html = renderPage(data())
    const m = html.match(/<meta name="description" content="([^"]+)"/)
    assert.ok(m, 'no description meta')
    assert.ok(m[1].length >= 40 && m[1].length <= 260, `description is ${m[1].length} characters`)
  })

  test('it turns motion off for a reader who has asked for that', () => {
    assert.match(renderPage(data()), /prefers-reduced-motion/)
  })

  test('the animation is offered, not started', () => {
    const html = renderPage(data())
    assert.match(html, /data-autoplay="off"/)
  })

  test('markup arriving from GitHub is escaped', () => {
    const html = renderPage(data({
      order: { ...data().order, rows: [row(1, 279, { title: '<script>alert(1)</script>' })] },
    }))
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
    assert.match(html, /&lt;script&gt;/)
  })

  test('the inlined data cannot close the script tag it lives in', () => {
    const html = renderPage(data({
      order: { ...data().order, rows: [row(1, 279, { why: 'ends the block </script> like this' })] },
    }))
    assert.doesNotMatch(html, /ends the block <\/script>/)
  })
})

describe('fmt — one timezone, named on the page', () => {
  test('renders an instant in the zone the record was written in', () => {
    assert.match(fmt('2026-08-20T21:41:59-04:00', 'America/New_York'), /2026-08-20 21:41/)
  })

  test('a UTC instant is converted rather than printed as it arrived', () => {
    assert.match(fmt('2026-08-19T01:32:55Z', 'America/New_York'), /2026-08-18 21:32/)
  })

  test('an instant nobody recorded is said to be unknown, never dated to now', () => {
    assert.equal(fmt(null, 'America/New_York'), 'not known')
  })
})
