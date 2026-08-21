// What the history of the ranked head is allowed to claim.
//
// The page these frames drive animates one day of re-ranking, and the single way this
// program has repeatedly gone wrong is a surface that renders a plausible shape over a
// record that does not support it. So the tests below are mostly about the gaps: a
// commit whose blob will not parse must arrive as a frame that SAYS it could not be
// reconstructed, the transitions across it must be absent rather than interpolated,
// and a reversal search that could not see every frame must say how many it missed.
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'

import {
  buildFrames, diffOrders, findReversals, listCommits, readHistory, spanOf,
} from '../history.mjs'

const order = (...issues) => issues.map((issue) => ({ issue, why: `why ${issue}`, review: null }))

const frame = (i, issues, extra = {}) => ({
  index: i,
  sha: `sha${i}`,
  short: `sha${i}`,
  iso: `2026-08-20T0${i}:00:00-04:00`,
  subject: `commit ${i}`,
  body: '',
  reconstructed: true,
  why: '',
  order: order(...issues),
  ...extra,
})

// ---------------------------------------------------------------------------

describe('diffOrders — what moved between two states', () => {
  test('names entries, exits, and the direction of every move', () => {
    const d = diffOrders(order(1, 2, 3), order(3, 1, 4))
    assert.deepEqual(d.entered, [{ issue: 4, rank: 3 }])
    assert.deepEqual(d.left, [{ issue: 2, rank: 2 }])
    assert.deepEqual(d.moved.find((m) => m.issue === 3), { issue: 3, from: 3, to: 1, delta: 2 })
    assert.deepEqual(d.moved.find((m) => m.issue === 1), { issue: 1, from: 1, to: 2, delta: -1 })
    assert.deepEqual(d.held, [])
  })

  test('an item at the same rank is held, not moved', () => {
    const d = diffOrders(order(1, 2), order(1, 3))
    assert.deepEqual(d.held, [{ issue: 1, rank: 1 }])
    assert.equal(d.moved.length, 0)
  })

  // The interpolation ban, at its smallest. A null side is an unknown state, and an
  // unknown state produces NO transitions — not empty ones, which would render as
  // "nothing moved" on a frame where everything might have.
  test('an unknown state on either side yields no transitions at all', () => {
    for (const d of [diffOrders(null, order(1, 2)), diffOrders(order(1, 2), null)]) {
      assert.equal(d.known, false)
      assert.equal(d.entered, null)
      assert.equal(d.left, null)
      assert.equal(d.moved, null)
      assert.equal(d.held, null)
    }
  })
})

describe('buildFrames — one frame per commit, and a frame that failed says so', () => {
  const commits = [
    { sha: 'aaa', short: 'aaa', iso: '2026-08-20T12:39:14-04:00', subject: 'first', body: 'the first order', author: 'obotclaw[bot]' },
    { sha: 'bbb', short: 'bbb', iso: '2026-08-20T13:05:30-04:00', subject: 'second', body: 'a re-rank', author: 'obotclaw[bot]' },
  ]
  const store = (...issues) => JSON.stringify({
    repo: 'jwildfire/obot.roadmap', label: 'top10', bench: 'on-deck',
    rank: issues.map((issue) => ({ issue, why: `why ${issue}` })),
  })

  test('reconstructs each order and carries the commit its reason came from', () => {
    const frames = buildFrames(commits, (sha) => ({
      read: true, why: '', text: sha === 'aaa' ? store(1, 2, 3) : store(2, 1, 4),
    }))
    assert.equal(frames.length, 2)
    assert.equal(frames[0].reconstructed, true)
    assert.deepEqual(frames[0].order.map((r) => r.issue), [1, 2, 3])
    assert.equal(frames[1].subject, 'second')
    assert.equal(frames[1].body, 'a re-rank')
    assert.deepEqual(frames[1].change.entered, [{ issue: 4, rank: 3 }])
    assert.deepEqual(frames[1].change.left, [{ issue: 3, rank: 3 }])
  })

  test('the first frame has nothing to be compared against, and does not pretend otherwise', () => {
    const frames = buildFrames(commits, () => ({ read: true, why: '', text: store(1) }))
    assert.equal(frames[0].change.known, false)
    assert.equal(frames[0].first, true)
  })

  test('a blob that will not parse becomes a frame that states it, with no order', () => {
    const frames = buildFrames(commits, (sha) => (sha === 'bbb'
      ? { read: true, why: '', text: '{ not json' }
      : { read: true, why: '', text: store(1, 2) }))
    assert.equal(frames[1].reconstructed, false)
    assert.equal(frames[1].order, null)
    assert.match(frames[1].why, /not readable JSON/)
    assert.equal(frames[1].change.known, false)
  })

  test('a blob git could not hand over is a failure, not an empty order', () => {
    const frames = buildFrames(commits, (sha) => (sha === 'aaa'
      ? { read: false, why: 'git show failed', text: null }
      : { read: true, why: '', text: store(1) }))
    assert.equal(frames[0].reconstructed, false)
    assert.equal(frames[0].order, null)
    assert.match(frames[0].why, /git show failed/)
    // ...and the NEXT frame, which is readable, still cannot state what changed.
    assert.equal(frames[1].reconstructed, true)
    assert.equal(frames[1].change.known, false)
    assert.match(frames[1].change.why, /could not be reconstructed/)
  })
})

describe('findReversals — an item that left and came back', () => {
  test('finds the return and names both ends', () => {
    const frames = [frame(1, [1, 2]), frame(2, [1, 2]), frame(3, [1]), frame(4, [1, 2])]
    const { reversals, unseen } = findReversals(frames)
    assert.equal(unseen, 0)
    assert.equal(reversals.length, 1)
    assert.equal(reversals[0].issue, 2)
    assert.equal(reversals[0].leftAt.index, 3)
    assert.equal(reversals[0].returnedAt.index, 4)
  })

  test('an item that only ever entered once is not a reversal', () => {
    const { reversals } = findReversals([frame(1, [1]), frame(2, [1, 2]), frame(3, [1, 2])])
    assert.deepEqual(reversals, [])
  })

  test('frames that could not be reconstructed are counted, never skipped silently', () => {
    const frames = [
      frame(1, [1, 2]),
      { ...frame(2, []), reconstructed: false, order: null, why: 'unreadable' },
      frame(3, [1]),
      frame(4, [1, 2]),
    ]
    const { reversals, unseen } = findReversals(frames)
    assert.equal(unseen, 1)
    // The return is still real and still found across the hole; what changes is that
    // the caller is told the search had a hole in it.
    assert.equal(reversals.length, 1)
    assert.equal(reversals[0].issue, 2)
  })
})

describe('spanOf — the true reach of the record', () => {
  test('is the first and last commit, and the count of frames', () => {
    const s = spanOf([frame(1, [1]), frame(2, [1]), frame(3, [1])])
    assert.equal(s.frames, 3)
    assert.equal(s.from, '2026-08-20T01:00:00-04:00')
    assert.equal(s.to, '2026-08-20T03:00:00-04:00')
    assert.equal(s.days, 1)
  })

  test('no frames is not a zero-length day', () => {
    const s = spanOf([])
    assert.equal(s.frames, 0)
    assert.equal(s.from, null)
    assert.equal(s.days, null)
  })
})

// ---------------------------------------------------------------------------
// Against a real git repository, because the parts that break are the argv, the
// exit codes and the bytes — none of which a stubbed `git` exercises.
// ---------------------------------------------------------------------------

describe('listCommits and readHistory, against a real repository', () => {
  const dirs = []
  const repo = () => {
    const d = mkdtempSync(join(tmpdir(), 'rankviz-'))
    dirs.push(d)
    const git = (...a) => execFileSync('git', a, { cwd: d, stdio: ['ignore', 'pipe', 'pipe'] })
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'test')
    mkdirSync(join(d, 'rank'))
    return { dir: d, git }
  }
  after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

  const write = (dir, ...issues) => writeFileSync(join(dir, 'rank', 'top10.json'), JSON.stringify({
    repo: 'jwildfire/obot.roadmap', label: 'top10', bench: 'on-deck',
    rank: issues.map((issue) => ({ issue, why: `why ${issue}` })),
  }))

  test('returns commits oldest-first with their full message', () => {
    const { dir, git } = repo()
    write(dir, 1, 2)
    git('add', '-A'); git('commit', '-q', '-m', 'the first order\n\nbecause it had to start somewhere')
    write(dir, 2, 1)
    git('add', '-A'); git('commit', '-q', '-m', 'the swap')
    const got = listCommits(dir)
    assert.equal(got.read, true)
    assert.equal(got.commits.length, 2)
    assert.equal(got.commits[0].subject, 'the first order')
    assert.match(got.commits[0].body, /had to start somewhere/)
    assert.equal(got.commits[1].subject, 'the swap')
  })

  test('a repository the file has never been in is empty, and says why', () => {
    const { dir, git } = repo()
    writeFileSync(join(dir, 'other.txt'), 'x')
    git('add', '-A'); git('commit', '-q', '-m', 'nothing to do with rank')
    const got = listCommits(dir)
    assert.equal(got.read, true)
    assert.deepEqual(got.commits, [])
  })

  test('readHistory reconstructs every frame end to end', () => {
    const { dir, git } = repo()
    write(dir, 1, 2, 3)
    git('add', '-A'); git('commit', '-q', '-m', 'first')
    write(dir, 3, 1, 2)
    git('add', '-A'); git('commit', '-q', '-m', 'second')
    write(dir, 3, 1)
    git('add', '-A'); git('commit', '-q', '-m', 'third')
    const h = readHistory(dir)
    assert.equal(h.read, true)
    assert.equal(h.frames.length, 3)
    assert.ok(h.frames.every((f) => f.reconstructed))
    assert.deepEqual(h.frames.at(-1).order.map((r) => r.issue), [3, 1])
    assert.deepEqual(h.frames.at(-1).change.left, [{ issue: 2, rank: 3 }])
    assert.equal(h.span.frames, 3)
  })

  test('a commit holding a broken store yields an unreconstructed frame, not a crash', () => {
    const { dir, git } = repo()
    write(dir, 1, 2)
    git('add', '-A'); git('commit', '-q', '-m', 'first')
    writeFileSync(join(dir, 'rank', 'top10.json'), '{ broken')
    git('add', '-A'); git('commit', '-q', '-m', 'broken')
    write(dir, 2, 1)
    git('add', '-A'); git('commit', '-q', '-m', 'fixed')
    const h = readHistory(dir)
    assert.equal(h.frames.length, 3)
    assert.equal(h.frames[1].reconstructed, false)
    assert.equal(h.frames[2].change.known, false)
    assert.equal(h.unreconstructed, 1)
  })

  test('a directory that is not a repository is a failure with a reason', () => {
    const d = mkdtempSync(join(tmpdir(), 'rankviz-norepo-'))
    dirs.push(d)
    const got = listCommits(d)
    assert.equal(got.read, false)
    assert.ok(got.why.length > 0)
  })
})
