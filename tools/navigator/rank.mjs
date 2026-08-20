// rank — the ranked head of the requirement queue: one declared order, everything
// else derived (jwildfire/obot.roadmap#278).
//
// WHAT IS DECLARED AND WHAT IS NOT. `rank/top10.json` holds an order and a one-line
// reason per item. That is all it holds, and the shape is asserted by a test rather
// than trusted: rank is a judgement and cannot be computed, and every other thing a
// reader wants to know — the title, whether it is still open, its milestone, whether
// it is blocked, how far its sub-issues have got — GitHub already knows. Anything of
// GitHub's copied into that file is a second store of one fact, and this program has
// already paid for that once: ten decisions disagreed with themselves because two
// stores were both hand-writable, and the fix was one declaration with everything
// else derived from it.
//
// MEMBERSHIP IS THE LABEL, ORDER IS THE FILE. @jwildfire, 2026-08-19: "Let's just make
// a 'top10' label for those requirements so that it's discoverable and it becomes a
// simple github api call to get the list." The label says WHICH TEN and the file says
// IN WHAT ORDER, and because those are two mechanisms they can disagree — so every
// disagreement between them is a finding here rather than a silent tiebreak. The
// alternatives were weighed on the requirement and both rejected: a rank line in each
// of ten issue bodies drifts, and ten ordered labels clutter every issue view.
//
// THIS MODULE NEVER ACTS. It computes conditions and returns them. A `top10` label on
// a closed issue is a slot open, and saying so is the whole of what may happen here:
// choosing the replacement is strategy, it belongs to 🎩🤖 obot-prime, and a finding
// that named a successor would have made that call by implication. `slotFindings` is
// tested for the absence of one.
//
// OWNERSHIP, from the requirement: prime ranks (this file's contents), the Navigator
// keeps the list accurate (this module), and the Operations Dashboard renders it. The
// dashboard imports from here rather than restating the join, for the same reason
// `collect.mjs` imports `classify.mjs`: two definitions of one list is how the sweep
// and the page come to disagree about what is in it.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { readFailure } from '../ops-dashboard/lib/absent.mjs'

/** The store, as path segments — so callers and messages spell it one way. */
export const RANK_PATH = ['rank', 'top10.json']

/** The store inside a given obot.agent checkout. */
export const rankFile = (repoRoot) => join(repoRoot, ...RANK_PATH)

/** The one spelling of the file for a reader: `rank/top10.json`. */
export const RANK_REL = RANK_PATH.join('/')

/** What a store that could not be read still hands back, so no caller has to null-check. */
const EMPTY = { repo: null, label: null, bench: null, boundary: null, rank: [] }

/**
 * Parse the declaration.
 *
 * `{ read, absent, why, declared }`. `read: false` with `absent: false` is a fault and
 * says so; `absent: true` is the one honest emptiness. Nothing half-parsed is ever
 * returned — a store with a duplicated issue number cannot say what rank 3 is, and a
 * surface that picked one of the two would be inventing the answer.
 */
export function parseRank(text, file = RANK_REL) {
  let raw
  try { raw = JSON.parse(text) } catch (e) {
    return { read: false, absent: false, why: `${file} is not readable JSON (${e.message})`, declared: EMPTY }
  }
  if (!Array.isArray(raw?.rank)) {
    return { read: false, absent: false, why: `${file} has no "rank" list, so there is no order to show`, declared: EMPTY }
  }
  const rank = []
  const seen = new Set()
  for (const row of raw.rank) {
    const issue = Number(row?.issue)
    if (!Number.isInteger(issue) || issue <= 0) {
      return { read: false, absent: false, why: `${file} has a rank row with no issue number`, declared: EMPTY }
    }
    if (seen.has(issue)) {
      return { read: false, absent: false, why: `${file} lists #${issue} twice, so it does not say what its rank is`, declared: EMPTY }
    }
    seen.add(issue)
    rank.push({
      issue,
      why: typeof row.why === 'string' ? row.why : null,
      ...(typeof row.review === 'string' && row.review ? { review: row.review } : {}),
    })
  }
  return {
    read: true,
    absent: false,
    why: '',
    declared: {
      repo: raw.repo ?? null,
      label: raw.label ?? null,
      bench: raw.bench ?? null,
      boundary: typeof raw.boundary === 'string' ? raw.boundary : null,
      rank,
    },
  }
}

/** The declaration, from a checkout. ENOENT is the only failure allowed to read as absence. */
export function readRank(repoRoot) {
  const file = rankFile(repoRoot)
  let text
  try { text = readFileSync(file, 'utf8') } catch (e) {
    const f = readFailure(e, file)
    return {
      read: false,
      absent: f.absent,
      why: f.absent ? `${RANK_REL} is not on this machine` : f.why,
      declared: EMPTY,
    }
  }
  return parseRank(text, RANK_REL)
}

/**
 * When the rank was last touched — from the commit that last changed the store.
 *
 * NOT from the file's mtime, and the difference is the whole point of the function.
 * A fresh clone stamps every file with the moment it was written, so an mtime reading
 * would report a rank nobody has looked at in a week as minutes old on any machine
 * that had just updated its checkout — which is precisely the "stale and does not
 * admit it" failure this requirement was filed about.
 *
 * The commit date understates in exactly one direction: an edit that has not been
 * committed yet is newer than the commit. So the working tree is asked too, and a
 * dirty store is reported rather than dated.
 *
 * `{ read, why, iso, ageMin, dirty }`. `read: false` means unknown — never "just now",
 * never zero.
 */
export function rankTouched(repoRoot, { now = new Date() } = {}) {
  const git = (args) => execFileSync('git', args, {
    cwd: repoRoot, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let iso
  try {
    iso = git(['log', '-1', '--format=%cI', '--', RANK_REL]).trim()
  } catch (e) {
    return { read: false, why: `git could not be asked when ${RANK_REL} last changed (${String(e.message).split('\n')[0].slice(0, 120)})`, iso: null, ageMin: null, dirty: null }
  }
  if (!iso) {
    return { read: false, why: `no commit in this checkout has touched ${RANK_REL}, so how old the rank is cannot be said`, iso: null, ageMin: null, dirty: null }
  }
  let dirty = null
  try { dirty = git(['status', '--porcelain', '--', RANK_REL]).trim().length > 0 } catch { /* the age is the answer; dirtiness is the footnote */ }
  return { read: true, why: '', iso, ageMin: (now.getTime() - Date.parse(iso)) / 60000, dirty }
}

/**
 * The declared order joined to what GitHub says about each item.
 *
 * `live` is the rows for the label, or `null` when nothing was read. Null is not an
 * empty list: an unread GitHub produces rows marked `present: false` and NO findings
 * at all, because every finding here is a statement about what GitHub holds and none
 * of them can be made without having looked.
 *
 * `{ items, findings }`.
 */
export function joinRank(declared, live) {
  const read = Array.isArray(live)
  const byNumber = new Map((live ?? []).map((r) => [Number(r.number), r]))
  const ranked = new Set(declared.rank.map((r) => r.issue))

  const items = declared.rank.map((r, i) => {
    const g = byNumber.get(r.issue)
    if (!g) {
      return {
        rank: i + 1, issue: r.issue, why: r.why, review: r.review ?? null,
        present: false, title: null, url: issueUrl(declared.repo, r.issue), state: null,
        milestone: null, labels: [], blocked: false, sub: null, member: null, closedAt: null,
      }
    }
    const labels = (g.labels ?? []).map(String)
    return {
      rank: i + 1, issue: r.issue, why: r.why, review: r.review ?? null,
      present: true,
      title: g.title ?? null,
      url: g.url ?? issueUrl(declared.repo, r.issue),
      state: g.state ?? null,
      milestone: g.milestone ?? null,
      labels,
      blocked: labels.includes('blocked'),
      sub: g.sub && Number(g.sub.total) > 0
        ? { completed: Number(g.sub.completed) || 0, total: Number(g.sub.total) }
        : null,
      // Does the label still agree that this is a member? The label carries
      // membership; disagreeing with the order's own file is a finding, not a
      // detail the row may quietly absorb.
      member: declared.label ? labels.includes(declared.label) : null,
      closedAt: g.closedAt ?? null,
    }
  })

  const findings = []
  if (read) {
    for (const it of items) {
      if (!it.present) { findings.push({ kind: 'missing', issue: it.issue, rank: it.rank }); continue }
      if (it.state === 'closed') {
        findings.push({ kind: 'slot-open', issue: it.issue, rank: it.rank, title: it.title, closedAt: it.closedAt })
      }
      // A CLOSED issue that has lost the label is the normal, correct end state — the
      // slot finding above already says everything there is to say, and raising a
      // membership disagreement beside it would double every completion. Only an OPEN
      // ranked issue that is no longer a member is a disagreement, because then the
      // label and the file really do return different tens.
      if (it.member === false && it.state !== 'closed') findings.push({ kind: 'unlabelled-rank', issue: it.issue, rank: it.rank })
    }
    for (const g of live) {
      if (!ranked.has(Number(g.number))) findings.push({ kind: 'unranked-member', issue: Number(g.number), title: g.title ?? null })
    }
    if (declared.rank.length !== 10) findings.push({ kind: 'count', n: declared.rank.length })
  }
  return { items, findings }
}

/** Just the findings — what the sweep reports and never acts on. */
export function slotFindings(declared, live) {
  return joinRank(declared, live).findings
}

const issueUrl = (repo, n) => (repo ? `https://github.com/${repo}/issues/${n}` : null)
