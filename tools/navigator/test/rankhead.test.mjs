// The sweep's ranked-head section: a slot is a computed condition, reported and
// never acted on (jwildfire/obot.roadmap#278).
//
// Two properties carry the whole requirement and both are asserted here rather than
// documented: the section NEVER chooses a replacement, and it NEVER asks @jwildfire
// for anything. The ranked head sits below his three buckets by design — the moment
// it demands an action it is a fourth obligation and the three-bucket rule
// (jwildfire/obot.roadmap#220) dies quietly.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ALARM_RE } from '../../ops-dashboard/lib/navigator.mjs'
import {
  SECTION_HEAD, ALARM_READ_BROKEN, readingBroken, rankheadSection, collectRankHead,
} from '../rankhead.mjs'
import { rankFile } from '../rank.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rankhead-'))

const declared = {
  repo: 'jwildfire/obot.roadmap', label: 'top10', bench: 'on-deck',
  boundary: 'The ten carrying `top10` are ranked; `on-deck` is the bench.',
  rank: Array.from({ length: 10 }, (_, i) => ({ issue: 100 + i, why: `reason ${i}` })),
}
const row = (number, over = {}) => ({
  number, state: 'open', title: `Requirement ${number}`,
  url: `https://github.com/jwildfire/obot.roadmap/issues/${number}`,
  labels: ['requirement', 'top10'], milestone: '2026q3',
  sub: { completed: 0, total: 0 }, closedAt: null, ...over,
})
const live = () => Array.from({ length: 10 }, (_, i) => row(100 + i))
const section = (over = {}) => rankheadSection({
  declared, live: live(), read: true,
  touched: { read: true, iso: '2026-08-19T01:00:00Z', ageMin: 60, dirty: false },
  bench: { read: true, open: 10 },
  ...over,
})

// --- it reports, and it stops there ----------------------------------------

test('a clean head still prints — a detector that only speaks up on failure is indistinguishable from a dead one', () => {
  const s = section()
  assert.ok(s.startsWith(SECTION_HEAD))
  assert.match(s, /10 ranked/)
  assert.doesNotMatch(s, ALARM_RE)
})

test('a closed member is reported as a slot open, by rank and by number', () => {
  const rows = live()
  rows[3] = row(103, { state: 'closed', closedAt: '2026-08-19T12:00:00Z' })
  const s = rankheadSection({ ...{ declared, read: true, touched: { read: true, iso: '2026-08-19T01:00:00Z', ageMin: 60, dirty: false }, bench: { read: true, open: 10 } }, live: rows })
  assert.match(s, /slot open/i)
  assert.match(s, /rank 4/)
  assert.match(s, /#103/)
})

test('the slot line names no successor, and cannot — the bench is a count, never a list', () => {
  const rows = live()
  rows[0] = row(100, { state: 'closed' })
  const s = rankheadSection({
    declared, live: rows, read: true,
    touched: { read: true, iso: '2026-08-19T01:00:00Z', ageMin: 60, dirty: false },
    // Ten real bench issues are handed in. Not one number may appear.
    bench: { read: true, open: 10, issues: [282, 281, 280, 266, 265, 261, 257, 252, 241, 238] },
  })
  for (const n of [282, 281, 280, 266, 265, 261, 257, 252, 241, 238]) {
    assert.doesNotMatch(s, new RegExp(`#${n}\\b`), `the section named #${n} — that is prime's call to make, not this sweep's`)
  }
  assert.match(s, /prime/i, 'it must say whose call it is, so the silence is explained rather than merely empty')
})

test('the section never asks @jwildfire for anything', () => {
  const rows = live()
  rows[2] = row(102, { state: 'closed' })
  rows[5] = row(105, { labels: ['requirement'] })
  const s = rankheadSection({
    declared, live: [...rows, row(999)], read: true,
    touched: { read: false, why: 'no commit has touched it', iso: null, ageMin: null, dirty: null },
    bench: { read: false, why: 'gh failed' },
  })
  assert.doesNotMatch(s, /@jwildfire/, 'this surface is a preview, never a fourth bucket')
})

test('nothing here raises a config item — the escalation lane is not imported', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'rankhead.mjs'), 'utf8')
  assert.doesNotMatch(src, /blocker-log|blockers\.md|raiseArgs/,
    'a slot opening is normal; routing it to his keyboard would make the preview an obligation')
})

// --- a disagreement between the label and the file is visible ---------------

test('a ranked issue that lost the label, and a labelled issue nobody ranked, are both named', () => {
  const rows = live()
  rows[1] = row(101, { labels: ['requirement'] })
  const s = rankheadSection({
    declared, live: [...rows, row(999)], read: true,
    touched: { read: true, iso: '2026-08-19T01:00:00Z', ageMin: 60, dirty: false },
    bench: { read: true, open: 10 },
  })
  assert.match(s, /#101/)
  assert.match(s, /#999/)
  assert.match(s, ALARM_RE, 'the label and the file disagreeing about membership is a finding, not a footnote')
})

// --- ageing --------------------------------------------------------------

test('the section says when the rank was last touched', () => {
  assert.match(section(), /2026-08-19/)
})

test('a rank untouched for three days says three days', () => {
  const s = section({ touched: { read: true, iso: '2026-08-16T09:00:00Z', ageMin: 3 * 24 * 60, dirty: false } })
  assert.match(s, /3d/)
})

test('an unknown age is unknown, never absent and never zero', () => {
  const s = section({ touched: { read: false, why: 'no commit has touched rank/top10.json', iso: null, ageMin: null, dirty: null } })
  assert.match(s, /how old the rank is|not known|unknown/i)
  assert.doesNotMatch(s, /0m old|just now/)
})

// --- unread is never clean -------------------------------------------------

test('a read that did not happen is loud, and says nothing about slots', () => {
  const s = readingBroken('gh exited 1')
  assert.ok(s.startsWith(SECTION_HEAD))
  assert.match(s, ALARM_RE)
  assert.match(s, /gh exited 1/)
  assert.doesNotMatch(s, /slot open/i, 'a list nobody read has no slots, open or otherwise')
})

test('the alarm headline actually matches the regex that renders it', () => {
  assert.match(ALARM_READ_BROKEN, ALARM_RE)
})

test('an unread live list is not an empty head', () => {
  const s = rankheadSection({
    declared, live: null, read: false, why: 'gh is not authenticated',
    touched: { read: true, iso: '2026-08-19T01:00:00Z', ageMin: 60, dirty: false },
    bench: { read: false, why: 'gh is not authenticated' },
  })
  assert.match(s, ALARM_RE)
  assert.match(s, /gh is not authenticated/)
  assert.doesNotMatch(s, /nothing to report|clean/i)
})

test('an absent store says the store is absent rather than that the head is empty', () => {
  const s = rankheadSection({
    declared: { repo: null, label: null, bench: null, boundary: null, rank: [] },
    declaredRead: false, declaredAbsent: true, declaredWhy: 'rank/top10.json is not on this machine',
    live: null, read: false,
    touched: { read: false, why: 'x', iso: null, ageMin: null, dirty: null },
    bench: { read: false, why: 'x' },
  })
  assert.match(s, /rank\/top10\.json is not on this machine/)
  assert.doesNotMatch(s, /0 ranked/)
})

// --- the collector, against a real gh ---------------------------------------
//
// A real child process, a real argv, real JSON on stdout. Not a stub returning a
// literal: the parse, the flags and the failure path are the parts that break.

const fakeGh = (dir, body) => {
  const p = path.join(dir, 'gh')
  fs.writeFileSync(p, body)
  fs.chmodSync(p, 0o755)
  return p
}
const ROWS = (label) => JSON.stringify([{
  number: 100, state: 'open', title: 'Requirement 100', html_url: 'https://example.invalid/100',
  labels: [{ name: 'requirement' }, { name: label }], milestone: { title: '2026q3' },
  sub_issues_summary: { completed: 1, total: 2 }, closed_at: null,
}])

test('the collector shells one gh call per label and parses GitHub\'s own shape', () => {
  const dir = tmp()
  const gh = fakeGh(dir, `#!/bin/sh
echo "$@" >> "${dir}/argv"
case "$*" in
  *top10*) cat <<'J'
${ROWS('top10')}
J
  ;;
  *) echo '[]' ;;
esac
`)
  fs.mkdirSync(path.join(dir, 'rank'))
  fs.writeFileSync(rankFile(dir), JSON.stringify({
    repo: 'jwildfire/obot.roadmap', label: 'top10', bench: 'on-deck', boundary: 'b',
    rank: [{ issue: 100, why: 'first' }],
  }))
  const got = collectRankHead(dir, { gh })
  assert.equal(got.read, true, got.why)
  assert.equal(got.live.length, 1)
  assert.deepEqual(got.live[0], {
    number: 100, state: 'open', title: 'Requirement 100', url: 'https://example.invalid/100',
    labels: ['requirement', 'top10'], milestone: '2026q3',
    sub: { completed: 1, total: 2 }, closedAt: null,
  })
  const argv = fs.readFileSync(path.join(dir, 'argv'), 'utf8')
  assert.match(argv, /labels=top10/)
  assert.match(argv, /labels=on-deck/)
  assert.match(argv, /state=all/)
})

test('a gh that fails leaves read false with its own last line, never an empty head', () => {
  const dir = tmp()
  const gh = fakeGh(dir, '#!/bin/sh\necho "gh: not authenticated" >&2\nexit 1\n')
  fs.mkdirSync(path.join(dir, 'rank'))
  fs.writeFileSync(rankFile(dir), JSON.stringify({ repo: 'r', label: 'top10', bench: 'on-deck', rank: [] }))
  const got = collectRankHead(dir, { gh })
  assert.equal(got.read, false)
  assert.equal(got.live, null)
  assert.match(got.why, /not authenticated/)
})

test('a gh that prints something that is not JSON is a fault, not an empty list', () => {
  const dir = tmp()
  const gh = fakeGh(dir, '#!/bin/sh\necho "<html>rate limited</html>"\n')
  fs.mkdirSync(path.join(dir, 'rank'))
  fs.writeFileSync(rankFile(dir), JSON.stringify({ repo: 'r', label: 'top10', bench: 'on-deck', rank: [] }))
  const got = collectRankHead(dir, { gh })
  assert.equal(got.read, false)
  assert.equal(got.live, null)
})

test('the bench failing does not cost the head its reading', () => {
  const dir = tmp()
  const gh = fakeGh(dir, `#!/bin/sh
case "$*" in
  *top10*) cat <<'J'
${ROWS('top10')}
J
  ;;
  *) echo "gh: boom" >&2; exit 1 ;;
esac
`)
  fs.mkdirSync(path.join(dir, 'rank'))
  fs.writeFileSync(rankFile(dir), JSON.stringify({
    repo: 'r', label: 'top10', bench: 'on-deck', rank: [{ issue: 100, why: 'first' }],
  }))
  const got = collectRankHead(dir, { gh })
  assert.equal(got.read, true)
  assert.equal(got.bench.read, false)
  assert.match(got.bench.why, /boom/)
})

// --- the sweep folds it in, and says so when it did not ---------------------

test('the sweep renders the section above the RC queue', async () => {
  const { renderState } = await import('../sweep.mjs')
  const md = renderState({
    snapshot: {}, events: [], meta: { sweptAt: '2026-08-20 09:00:00', cadenceMin: 5, repoCount: 7, ok: true, errors: [] },
    rankhead: section(),
  })
  assert.ok(md.includes(SECTION_HEAD))
  assert.ok(md.indexOf(SECTION_HEAD) < md.indexOf('## RC queue'), 'what comes next belongs above what is waiting now')
})

test('a sweep that produced no reading says so rather than dropping the section', async () => {
  const { renderState } = await import('../sweep.mjs')
  const md = renderState({
    snapshot: {}, events: [], meta: { sweptAt: '2026-08-20 09:00:00', cadenceMin: 5, repoCount: 7, ok: true, errors: [] },
  })
  assert.ok(md.includes(SECTION_HEAD), 'a section that vanishes reads as a head with nothing to report')
  assert.match(md, ALARM_RE)
})

test('a ranked issue the label query cannot see is fetched by number, not written off', () => {
  const dir = tmp()
  const gh = fakeGh(dir, `#!/bin/sh
case "$*" in
  *issues/101*) cat <<'J'
{"number":101,"state":"closed","title":"Requirement 101","html_url":"https://example.invalid/101","labels":[{"name":"requirement"}],"milestone":null,"sub_issues_summary":{"completed":0,"total":0},"closed_at":"2026-08-20T10:00:00Z"}
J
  ;;
  *labels=top10*) cat <<'J'
${ROWS('top10')}
J
  ;;
  *) echo '[]' ;;
esac
`)
  fs.mkdirSync(path.join(dir, 'rank'))
  fs.writeFileSync(rankFile(dir), JSON.stringify({
    repo: 'jwildfire/obot.roadmap', label: 'top10', bench: 'on-deck', boundary: 'b',
    rank: [{ issue: 100, why: 'first' }, { issue: 101, why: 'second' }],
  }))
  const got = collectRankHead(dir, { gh })
  assert.equal(got.read, true, got.why)
  assert.equal(got.live.length, 2)
  const s = rankheadSection(got)
  assert.match(s, /slot open at rank 2/)
  assert.match(s, /#101/)
  // The finished issue lost the label on the way out; that is the normal end state and
  // must not be reported a second time as a membership disagreement.
  assert.doesNotMatch(s, /MEMBERSHIP FINDING/)
})

test('a ranked issue that cannot be fetched at all stays absent and says so', () => {
  const dir = tmp()
  const gh = fakeGh(dir, `#!/bin/sh
case "$*" in
  *labels=top10*) cat <<'J'
${ROWS('top10')}
J
  ;;
  *issues/101*) echo "gh: Not Found" >&2; exit 1 ;;
  *) echo '[]' ;;
esac
`)
  fs.mkdirSync(path.join(dir, 'rank'))
  fs.writeFileSync(rankFile(dir), JSON.stringify({
    repo: 'r', label: 'top10', bench: 'on-deck',
    rank: [{ issue: 100, why: 'first' }, { issue: 101, why: 'second' }],
  }))
  const got = collectRankHead(dir, { gh })
  assert.equal(got.read, true)
  assert.equal(got.live.length, 1)
  assert.match(rankheadSection(got), /#101 is ranked 2 and GitHub did not return it/)
})
