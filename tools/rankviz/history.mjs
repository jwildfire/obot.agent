// The history of the ranked head, reconstructed from the store's own commits.
//
// `rank/top10.json` is the one declaration of what comes next (jwildfire/obot.roadmap#278)
// and every re-rank is a commit against it. That makes the file's git history the only
// record of how the order has MOVED, and this module turns it into frames a surface can
// animate: one frame per commit, each holding the order as it stood, the commit whose
// message argues for it, and what changed since the frame before.
//
// WHY `git show <sha>:<path>` RATHER THAN PARSING `git log -p`. Both read the same
// history. A patch has to be replayed to be understood and a mis-replay produces a
// plausible order that never existed; asking git for the blob at that commit produces
// the bytes that were actually committed or an error, with nothing in between. The
// failure mode of the first is a wrong answer, the failure mode of the second is a
// missing one, and this program has decided repeatedly that a missing answer is the
// better one.
//
// THE INTERPOLATION BAN. A commit whose blob will not parse yields a frame with
// `reconstructed: false` and `order: null`, and BOTH the transitions into it and the
// transitions out of it are `known: false`. Filling that hole by carrying the previous
// order forward would render a frame nobody can vouch for, indistinguishable on screen
// from five that are real. The tests assert the hole rather than the fill.
//
// THE PARSER IS BORROWED ON PURPOSE. `parseRank` from tools/navigator/rank.mjs is the
// one definition of what a valid store is — including that a duplicated issue number
// makes a store unreadable rather than half-read. A second parser here would be a
// second answer to "what is rank 3".
import { execFileSync } from 'node:child_process'

import { parseRank, RANK_REL } from '../navigator/rank.mjs'

/** The store, as git sees it. One spelling, shared with the sweep. */
export const HISTORY_PATH = RANK_REL

/** Record separators that will not occur in a commit message. No surrounding spaces:
 *  git's own output and the trim below both eat edge whitespace, and a separator whose
 *  match depends on a space that was trimmed away silently swallows the next field. */
const REC = '<<<REC>>>'
const FLD = '<<<FLD>>>'

/**
 * Every commit that has touched the store, oldest first.
 *
 * `{ read, why, commits }`. `read: true` with an empty list is the honest emptiness —
 * a checkout in which the file has no history yet — and is not the same as `read: false`,
 * which is git refusing to answer.
 */
export function listCommits(repoRoot, { path = HISTORY_PATH, git = 'git' } = {}) {
  const fmt = ['%H', '%h', '%cI', '%an', '%s', '%b'].join(FLD) + REC
  let out
  try {
    out = execFileSync(git, ['log', '--reverse', `--format=${fmt}`, '--', path], {
      cwd: repoRoot, encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20, stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    const said = String(e?.stderr || e?.message || '').split('\n').map((l) => l.trim()).filter(Boolean)[0]
    return { read: false, why: said || `git could not be asked for the history of ${path}`, commits: [] }
  }
  const commits = out.split(REC).map((rec) => rec.trim()).filter(Boolean).map((rec) => {
    const [sha, short, iso, author, subject, body] = rec.split(FLD)
    return {
      sha: (sha || '').trim(),
      short: (short || '').trim(),
      iso: (iso || '').trim(),
      author: (author || '').trim(),
      subject: (subject || '').trim(),
      body: (body || '').trim(),
    }
  }).filter((c) => c.sha)
  return { read: true, why: '', commits }
}

/**
 * The store's bytes at one commit.
 *
 * `{ read, why, text }`. A commit that git will not hand a blob for is a read failure,
 * never an empty file — the difference decides whether the frame says "the order was
 * empty" or "the order could not be read", and only one of those is true.
 */
export function blobAt(repoRoot, sha, { path = HISTORY_PATH, git = 'git' } = {}) {
  try {
    return {
      read: true,
      why: '',
      text: execFileSync(git, ['show', `${sha}:${path}`], {
        cwd: repoRoot, encoding: 'utf8', timeout: 30000, maxBuffer: 8 << 20, stdio: ['ignore', 'pipe', 'pipe'],
      }),
    }
  } catch (e) {
    const said = String(e?.stderr || e?.message || '').split('\n').map((l) => l.trim()).filter(Boolean)[0]
    return { read: false, why: said || `git could not show ${path} at ${String(sha).slice(0, 7)}`, text: null }
  }
}

/**
 * What moved between two orders.
 *
 * Either side may be `null`, meaning "this state is not known". That produces
 * `{ known: false }` with every list null — see the interpolation ban in the header.
 * `delta` is positive when an item moved UP the list (toward rank 1), which is the
 * direction a reader means by "rose".
 */
export function diffOrders(prev, next, why = '') {
  if (!Array.isArray(prev) || !Array.isArray(next)) {
    return { known: false, why: why || 'one of the two states is not known', entered: null, left: null, moved: null, held: null }
  }
  const rankOf = (list) => new Map(list.map((r, i) => [r.issue, i + 1]))
  const p = rankOf(prev)
  const n = rankOf(next)
  const entered = []
  const left = []
  const moved = []
  const held = []
  for (const [issue, rank] of n) {
    if (!p.has(issue)) { entered.push({ issue, rank }); continue }
    const from = p.get(issue)
    if (from === rank) held.push({ issue, rank })
    else moved.push({ issue, from, to: rank, delta: from - rank })
  }
  for (const [issue, rank] of p) if (!n.has(issue)) left.push({ issue, rank })
  return { known: true, why: '', entered, left, moved, held }
}

/**
 * One frame per commit.
 *
 * `readBlob(sha)` returns `{ read, why, text }` — injected so the tests can drive the
 * failure paths without inventing a broken repository for each one, while the end-to-end
 * tests still run against a real `git`.
 */
export function buildFrames(commits, readBlob) {
  const frames = []
  let prevOrder = null
  let prevWhy = ''
  commits.forEach((c, i) => {
    const blob = readBlob(c.sha)
    let order = null
    let why = ''
    if (!blob.read) {
      why = `the store could not be read at this commit: ${blob.why}`
    } else {
      const parsed = parseRank(blob.text, `${HISTORY_PATH} at ${c.short || c.sha.slice(0, 7)}`)
      if (parsed.read) order = parsed.declared.rank.map((r) => ({ issue: r.issue, why: r.why ?? null, review: r.review ?? null }))
      else why = parsed.why
    }
    const first = i === 0
    const change = first
      ? { known: false, why: 'the first commit in the record — there is no earlier state to compare it against', entered: null, left: null, moved: null, held: null }
      : diffOrders(prevOrder, order, order === null
        ? 'this frame could not be reconstructed, so what changed at it cannot be stated'
        : `the previous frame could not be reconstructed${prevWhy ? ` (${prevWhy})` : ''}, so what changed here cannot be stated`)
    frames.push({
      index: i + 1,
      sha: c.sha,
      short: c.short || c.sha.slice(0, 7),
      iso: c.iso,
      author: c.author ?? null,
      subject: c.subject,
      body: c.body,
      first,
      reconstructed: order !== null,
      why,
      order,
      change,
    })
    prevOrder = order
    prevWhy = why
  })
  return frames
}

/**
 * Items that left the head and came back.
 *
 * The reason this exists as its own function rather than falling out of the per-frame
 * diff: a reversal is a statement about the whole record, and the honest version of it
 * has to say how much of the record it could see. `unseen` is the number of frames the
 * search could not read — a reversal search over a history with a hole in it is still
 * useful, and quietly presenting it as complete is not.
 */
export function findReversals(frames) {
  const readable = frames.filter((f) => f.reconstructed && Array.isArray(f.order))
  const unseen = frames.length - readable.length
  const state = new Map()
  const reversals = []
  for (const f of readable) {
    const here = new Set(f.order.map((r) => r.issue))
    for (const [, s] of state) {
      if (s.present && !here.has(s.issue)) { s.present = false; s.leftAt = f }
    }
    for (const issue of here) {
      const s = state.get(issue)
      if (!s) { state.set(issue, { issue, present: true, leftAt: null }); continue }
      if (!s.present) {
        reversals.push({
          issue,
          leftAt: { index: s.leftAt.index, sha: s.leftAt.sha, short: s.leftAt.short, iso: s.leftAt.iso, subject: s.leftAt.subject },
          returnedAt: { index: f.index, sha: f.sha, short: f.short, iso: f.iso, subject: f.subject },
          rankOnReturn: f.order.findIndex((r) => r.issue === issue) + 1,
        })
        s.present = true
        s.leftAt = null
      }
    }
  }
  return { reversals, unseen }
}

/** The true reach of the record — never rounded up, never a zero for an empty one. */
export function spanOf(frames) {
  if (!frames.length) return { frames: 0, from: null, to: null, days: null }
  const from = frames[0].iso
  const to = frames.at(-1).iso
  const days = new Set(frames.map((f) => String(f.iso).slice(0, 10))).size
  return { frames: frames.length, from, to, days }
}

/** Everything a surface needs about the history, from a checkout. */
export function readHistory(repoRoot, { path = HISTORY_PATH, git = 'git' } = {}) {
  const got = listCommits(repoRoot, { path, git })
  if (!got.read) {
    return { read: false, why: got.why, frames: [], span: spanOf([]), reversals: [], unreconstructed: 0, unseenInReversals: 0 }
  }
  const frames = buildFrames(got.commits, (sha) => blobAt(repoRoot, sha, { path, git }))
  const { reversals, unseen } = findReversals(frames)
  return {
    read: true,
    why: '',
    frames,
    span: spanOf(frames),
    reversals,
    unreconstructed: frames.filter((f) => !f.reconstructed).length,
    unseenInReversals: unseen,
  }
}
