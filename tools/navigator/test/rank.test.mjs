// The ranked head: one declared order, everything else derived.
//
// Requirement: jwildfire/obot.roadmap#278. Its own acceptance test is the first
// block below — "if it cannot reproduce a ranking that already exists, it is not
// ready to produce one that does not" — so these tests read the REAL store in
// `rank/top10.json` rather than a fixture, and assert it against the ranking that
// was given to @jwildfire in the chat message this surface exists to replace.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import {
  RANK_PATH, rankFile, parseRank, readRank, rankTouched, joinRank, slotFindings,
} from '../rank.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rank-'))

// The ranking as given to him on 2026-08-19, transcribed from
// https://github.com/jwildfire/obot.roadmap/issues/278#issuecomment-5336239705.
const AS_GIVEN = [278, 275, 272, 279, 260, 263, 264, 251, 256, 274]

// ---------------------------------------------------------------------------
// The requirement's own acceptance test
// ---------------------------------------------------------------------------

// #278's acceptance test: "if it cannot reproduce a ranking that already exists, it is
// not ready to produce one that does not." It is asserted against a FIXTURE, not against
// the live store. Run against the live store it proved the reader worked for exactly one
// day and then froze the order permanently - so the first real re-rank failed the suite,
// which is the store refusing its owner (rank/README.md: prime edits it, and his steering
// overrides without discussion).
test('the reader reproduces a declared ranking exactly, in order', () => {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, 'rank'))
  fs.writeFileSync(rankFile(dir), JSON.stringify({
    repo: 'jwildfire/obot.roadmap',
    label: 'top10',
    bench: 'on-deck',
    boundary: 'The ten carrying `top10` are ranked; the bench carrying `on-deck` is what a slot is filled from.',
    rank: AS_GIVEN.map((issue) => ({ issue, why: 'the reason he was given for this rank' })),
  }))
  const r = readRank(dir)
  assert.equal(r.read, true, r.why)
  assert.deepEqual(r.declared.rank.map((i) => i.issue), AS_GIVEN)
})

test('the live store is readable and holds a full head of ten', () => {
  const r = readRank(REPO)
  assert.equal(r.read, true, r.why)
  assert.equal(r.declared.rank.length, 10, 'the ranked head is ten - a short head is a slot nobody filled')
  const issues = r.declared.rank.map((i) => i.issue)
  assert.equal(new Set(issues).size, issues.length, 'an issue is ranked twice')
})

test('every ranked item carries a one-line why, because a rank he cannot interrogate is one he cannot steer', () => {
  const { declared } = readRank(REPO)
  for (const it of declared.rank) {
    assert.ok(it.why && it.why.trim().length > 3, `#${it.issue} has no reason`)
    assert.ok(!it.why.includes('\n'), `#${it.issue}'s reason is not one line`)
  }
})

// The reasons he was given on 2026-08-19 are guarded against PARAPHRASE, not against
// re-ranking. An item leaves the head when it closes or when prime re-ranks — both are
// the store working — so this asserts only over the rows still present. Pinning the
// membership here once made a legitimate re-rank fail the suite, which is the opposite
// of what a store owned by prime should do (obot.roadmap#278).
const GIVEN = {
  278: /nothing below it means anything unless the order is real/,
  275: /nothing unattended runs before it/,
  272: /obot\.agent\/main is where the merge policy lives/,
  279: /removes the write-from-memory risk/,
}

test('a reason he was actually given is carried verbatim for as long as its row is on the head', () => {
  const why = Object.fromEntries(readRank(REPO).declared.rank.map((i) => [i.issue, i.why]))
  let checked = 0
  for (const [issue, pattern] of Object.entries(GIVEN)) {
    if (why[issue] === undefined) continue
    assert.match(why[issue], pattern, `#${issue}'s reason has been paraphrased away from the one he was given`)
    checked += 1
  }
  assert.ok(checked > 0, 'not one of the reasons he was given is still on the head - that is a rewrite, not a re-rank')
})

test('a rank prime has flagged says so in the store, so a re-rank is cheap', () => {
  const rows = readRank(REPO).declared.rank
  const flagged = rows.filter((i) => i.review)
  // A caveat has to say something. An empty or one-word review is a flag nobody can act on.
  for (const row of flagged) {
    assert.ok(typeof row.review === 'string' && row.review.trim().length > 10,
      `#${row.issue}'s review says nothing actionable`)
    assert.ok(!row.review.includes('\n'), `#${row.issue}'s review is not one line`)
  }
  // A caveat on every row is a caveat on none of them.
  assert.ok(flagged.length < rows.length / 2,
    `${flagged.length} of ${rows.length} rows are flagged for review - that is a queue prime has not ranked, not a set of caveats`)
})

test('the store holds the order and the reason and nothing GitHub already knows', () => {
  const raw = JSON.parse(fs.readFileSync(rankFile(REPO), 'utf8'))
  const allowed = new Set(['issue', 'why', 'review'])
  for (const row of raw.rank) {
    for (const k of Object.keys(row)) {
      assert.ok(allowed.has(k), `rank/top10.json #${row.issue} carries "${k}", which GitHub knows and this file will get wrong`)
    }
  }
})

test('the tier boundary is stated in one sentence', () => {
  const { declared } = readRank(REPO)
  assert.ok(declared.boundary.length > 40)
  assert.equal(declared.boundary.split(/(?<=[.!?])\s+(?=[A-Z`])/).length, 1, 'one sentence')
  assert.match(declared.boundary, /top10/)
  assert.match(declared.boundary, /on-deck/)
})

// ---------------------------------------------------------------------------
// Reading the store: absent is not unreadable
// ---------------------------------------------------------------------------

test('an absent store reads as absent, with the path named', () => {
  const dir = tmp()
  const r = readRank(dir)
  assert.equal(r.read, false)
  assert.equal(r.absent, true)
  assert.match(r.why, /rank\/top10\.json/)
  assert.deepEqual(r.declared.rank, [])
})

test('a store that is present and damaged is NOT reported as absent', () => {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, 'rank'))
  fs.writeFileSync(rankFile(dir), '{ this is not json')
  const r = readRank(dir)
  assert.equal(r.read, false)
  assert.equal(r.absent, false, 'a damaged file is a fault, not an empty list')
})

test('a store whose rank is not a list is refused rather than half-read', () => {
  const r = parseRank(JSON.stringify({ rank: { '1': 278 } }))
  assert.equal(r.read, false)
  assert.equal(r.absent, false)
  assert.match(r.why, /rank/)
})

test('a duplicated issue number is a fault — two rows cannot both be rank 3', () => {
  const r = parseRank(JSON.stringify({ rank: [{ issue: 1, why: 'a' }, { issue: 1, why: 'b' }] }))
  assert.equal(r.read, false)
  assert.match(r.why, /twice|duplicate/i)
})

// ---------------------------------------------------------------------------
// Ageing — derived from git, never from the clock and never from mtime
// ---------------------------------------------------------------------------

const gitRepo = () => {
  const dir = tmp()
  const run = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } })
  run('init', '-q', '-b', 'main')
  run('config', 'user.email', 'w0077@example.invalid')
  run('config', 'user.name', 'W0077')
  fs.mkdirSync(path.join(dir, 'rank'))
  fs.writeFileSync(rankFile(dir), JSON.stringify({ rank: [{ issue: 1, why: 'x' }] }))
  return { dir, run }
}

test('the rank\'s age comes from the commit that last touched it, not from the file on disk', () => {
  const { dir, run } = gitRepo()
  run('add', RANK_PATH.join('/'))
  execFileSync('git', ['commit', '-q', '-m', 'rank', '--date', '2026-08-16T09:00:00Z'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_COMMITTER_DATE: '2026-08-16T09:00:00Z', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  })
  // The file is touched now. A surface keyed on mtime would call this fresh; the
  // rank has not moved since the 16th and the page must say so.
  fs.utimesSync(rankFile(dir), new Date(), new Date())
  const t = rankTouched(dir, { now: new Date('2026-08-19T09:00:00Z') })
  assert.equal(t.read, true, t.why)
  assert.equal(t.iso.slice(0, 10), '2026-08-16')
  assert.equal(Math.round(t.ageMin / 60 / 24), 3, 'three days, which is exactly what "untouched for three days" means')
  assert.equal(t.dirty, false)
})

test('an uncommitted edit to the store is reported, because the commit date now understates it', () => {
  const { dir, run } = gitRepo()
  run('add', RANK_PATH.join('/'))
  run('commit', '-q', '-m', 'rank')
  fs.writeFileSync(rankFile(dir), JSON.stringify({ rank: [{ issue: 2, why: 'y' }] }))
  const t = rankTouched(dir)
  assert.equal(t.read, true, t.why)
  assert.equal(t.dirty, true)
})

test('a store git has never seen is unknown, never "just now"', () => {
  const { dir } = gitRepo()
  const t = rankTouched(dir)
  assert.equal(t.read, false)
  assert.equal(t.ageMin, null)
  assert.ok(t.why)
})

test('no git at all is unknown, never an age', () => {
  const t = rankTouched(tmp())
  assert.equal(t.read, false)
  assert.equal(t.ageMin, null)
})

// ---------------------------------------------------------------------------
// The join: rank declared here, everything else derived from GitHub
// ---------------------------------------------------------------------------

const declared = {
  repo: 'jwildfire/obot.roadmap', label: 'top10', bench: 'on-deck', boundary: 'b',
  rank: [{ issue: 10, why: 'first' }, { issue: 20, why: 'second' }, { issue: 30, why: 'third' }],
}
const row = (number, over = {}) => ({
  number, state: 'open', title: `Requirement ${number}`,
  url: `https://github.com/jwildfire/obot.roadmap/issues/${number}`,
  labels: ['requirement', 'top10'], milestone: '2026q3',
  sub: { completed: 0, total: 0 }, closedAt: null, ...over,
})

test('the panel row is derived from GitHub — only rank and why come from the store', () => {
  const { items } = joinRank(declared, [row(20), row(10), row(30)])
  assert.deepEqual(items.map((i) => i.rank), [1, 2, 3])
  assert.deepEqual(items.map((i) => i.issue), [10, 20, 30])
  assert.equal(items[0].why, 'first')
  assert.equal(items[0].title, 'Requirement 10')
  assert.equal(items[0].milestone, '2026q3')
  assert.equal(items[0].state, 'open')
  assert.equal(items[0].present, true)
})

test('blocked-ness and sub-issue progress are derived, never declared', () => {
  const { items } = joinRank(declared, [
    row(10, { labels: ['requirement', 'top10', 'blocked'] }),
    row(20, { sub: { completed: 2, total: 3 } }),
    row(30),
  ])
  assert.equal(items[0].blocked, true)
  assert.equal(items[1].blocked, false)
  assert.deepEqual(items[1].sub, { completed: 2, total: 3 })
})

test('an issue in the store that GitHub did not return is marked absent, not dropped', () => {
  const { items, findings } = joinRank(declared, [row(10), row(20)])
  assert.equal(items.length, 3, 'a row that vanished must still occupy its rank')
  assert.equal(items[2].present, false)
  assert.equal(items[2].title, null)
  assert.ok(findings.some((f) => f.kind === 'missing' && f.issue === 30))
})

// ---------------------------------------------------------------------------
// Slot-open: a computed condition, reported and never acted on
// ---------------------------------------------------------------------------

test('a top10 label on a closed issue is a slot open', () => {
  const f = slotFindings(declared, [row(10), row(20, { state: 'closed', closedAt: '2026-08-19T12:00:00Z' }), row(30)])
  const slot = f.filter((x) => x.kind === 'slot-open')
  assert.equal(slot.length, 1)
  assert.equal(slot[0].issue, 20)
  assert.equal(slot[0].rank, 2)
  assert.equal(slot[0].closedAt, '2026-08-19T12:00:00Z')
})

test('a slot-open finding names no replacement — choosing one is prime\'s call', () => {
  const f = slotFindings(declared, [row(10, { state: 'closed' }), row(20), row(30)])
  const slot = f.find((x) => x.kind === 'slot-open')
  const fields = JSON.stringify(slot)
  assert.doesNotMatch(fields, /replace|promote|candidate|next/i,
    'a finding that suggests a successor has made the strategy call it is forbidden to make')
})

test('a labelled issue nobody ranked, and a ranked issue that lost its label, are both findings', () => {
  const f = slotFindings(declared, [row(10), row(20, { labels: ['requirement'] }), row(30), row(40)])
  assert.ok(f.some((x) => x.kind === 'unlabelled-rank' && x.issue === 20))
  assert.ok(f.some((x) => x.kind === 'unranked-member' && x.issue === 40))
})

test('a head that does not hold ten says so', () => {
  const f = slotFindings(declared, [row(10), row(20), row(30)])
  const c = f.find((x) => x.kind === 'count')
  assert.equal(c.n, 3)
})

test('a clean head produces no findings at all', () => {
  assert.deepEqual(
    slotFindings({ ...declared, rank: Array.from({ length: 10 }, (_, i) => ({ issue: i + 1, why: 'w' })) },
      Array.from({ length: 10 }, (_, i) => row(i + 1))),
    [],
  )
})

test('an unread live list produces no findings — an unread list is not a clean one', () => {
  assert.deepEqual(slotFindings(declared, null), [])
  assert.deepEqual(joinRank(declared, null).items.map((i) => i.present), [false, false, false])
})

// A finished requirement usually loses the label on the way out. The slot is the
// finding; saying the label disagrees as well would double every completion.
test('a closed member that has lost the label is a slot, and only a slot', () => {
  const f = slotFindings(declared, [row(10), row(20, { state: 'closed', labels: ['requirement'] }), row(30)])
    .filter((x) => x.kind !== 'count')
  assert.deepEqual(f.map((x) => x.kind), ['slot-open'])
})

test('an OPEN issue that lost the label is still a disagreement, because the two lists differ', () => {
  const f = slotFindings(declared, [row(10), row(20, { labels: ['requirement'] }), row(30)])
  assert.ok(f.some((x) => x.kind === 'unlabelled-rank' && x.issue === 20))
})
