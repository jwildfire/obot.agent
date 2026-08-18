// The daily brief's shape, counted rather than intended (obot.agent#252, under
// jwildfire/obot.roadmap#238).
//
// @jwildfire specified it on 18 August: "I want the text version SHORT one
// paragraph about progress and a bulleted overview of my todo list (1 line per
// bulleted)." One paragraph and one line per item are countable, which is the
// whole reason this is a test and not a style note. Every daily output this
// programme has produced has been longer than the last — the openclaw summaries
// grew from 136 words to 865 against a template whose slots had to be filled — so
// the bound is enforced on the composer's real output and on adversarial input.
//
// The shape checker itself is tested against injected malformations. A checker
// nobody has seen fail is indistinguishable from one that passes everything, and
// this house has nine instances in one night of an operation reporting success
// while doing nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  composeBrief, violations, visibleWords,
  MAX_PARAGRAPH_WORDS, MAX_BULLET_WORDS, BULLET_BUDGET,
} from '../lib/brief.mjs'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { queueHash } from '../lib/decide.mjs'

const LANDED = [
  { repo: 'obot.agent', title: 'The day boundary is written again, and its absence stops being silent', pr: 214, at: '2026-08-18T05:41:23Z' },
  { repo: 'obot.agent', title: 'A quiet night is provably quiet: the morning fold decides whether there is anything to say', pr: 208, at: '2026-08-18T05:10:00Z' },
  { repo: 'obot.roadmap', title: 'The briefing exists, at one URL, in ten lines, with the ask first', pr: 248, at: '2026-08-18T04:55:00Z' },
]

const RCS = [
  { key: 'jwildfire/open.gismo#10', title: 'open.gismo v0.2.0-RC1', url: 'https://github.com/jwildfire/open.gismo/pull/10' },
]

const DECISIONS = [
  { key: 'D0021', title: 'SafetyCensus(): stays or goes, before v1.1.0 publishes', url: 'https://github.com/jwildfire/obot.roadmap/discussions/235' },
  { key: 'D0019', title: 'Scheduled sessions: what is ready, what is not, and what would make it ready', url: 'https://github.com/jwildfire/obot.roadmap/discussions/222' },
]

const FIXTURE = () => ({
  landed: LANDED, rcs: RCS, decisions: DECISIONS, todos: [], configOpen: 13,
})


const put = (w, rel, body) => {
  mkdirSync(join(w, rel, '..'), { recursive: true })
  writeFileSync(join(w, rel), body)
}

// A workspace the fold can read end to end: a fresh sweep so nothing is unknown,
// a blockers file, a scratchpad, and a watermark. `hashOfEmpty` records the hash
// of the queue this workspace actually holds, which is what makes the run quiet
// rather than a fold — a made-up value would make every run look like a change.
function workspace({ rcs = 0, blockers = 0, hashOfEmpty = false } = {}) {
  const w = mkdtempSync(join(tmpdir(), 'foldbrief-'))
  const snapshot = {}
  for (let i = 0; i < rcs; i++) {
    snapshot[`jwildfire/open.gismo#${10 + i}`] = { title: `open.gismo v0.2.${i}-RC1`, url: `https://github.com/jwildfire/open.gismo/pull/${10 + i}` }
  }
  put(w, '.claude/session-hub/cache/navigator-rc.json', JSON.stringify({
    sweptIso: '2026-08-18T10:55:00.000Z', snapshot, events: [],
  }))
  put(w, '.claude/blockers.md', `# blockers\n\n## Open\n\n${'- [ ] c0017 something only his keyboard can do\n'.repeat(blockers)}`)
  put(w, '.claude/session-notes/2026-08-18.md', '# s\n\n## Todo\n\n## Session log\n')
  put(w, '.claude/fold/state.json', JSON.stringify({
    lastFoldAt: '2026-08-18T10:00:00.000Z',
    queueHash: hashOfEmpty
      ? queueHash({ rcs: [], decisions: [], todos: [], blockers })
      : 'sha256:0000000000000000000000',
    sessionLog: { '2026-08-18.md': 0 },
  }))
  return w
}

// A hub whose decision collector answers, so the queue is known.
function hub() {
  const h = mkdtempSync(join(tmpdir(), 'foldbriefhub-'))
  mkdirSync(join(h, 'scripts/lib/collect'), { recursive: true })
  writeFileSync(join(h, 'scripts/lib/collect/decision-log.mjs'),
    'export async function collectDecisionLog() { return { open: [] } }\n')
  return h
}

const NOW = new Date('2026-08-18T11:00:00.000Z')

const lines = (brief) => brief.replace(/\n+$/, '').split('\n')
const bulletsOf = (brief) => lines(brief).filter((l) => l.startsWith('- '))

// --- the two countable claims ----------------------------------------------

test('one paragraph: everything before the first bullet is a single line', () => {
  const brief = composeBrief(FIXTURE())
  const all = lines(brief)
  const firstBullet = all.findIndex((l) => l.startsWith('- '))
  assert.ok(firstBullet > 0, 'the brief has bullets')
  const head = all.slice(0, firstBullet).filter((l) => l.trim())
  assert.equal(head.length, 1, `one paragraph, not ${head.length}: ${JSON.stringify(head)}`)
  assert.equal(head[0].includes('\n'), false)
  // Two blocks separated by a blank line is two paragraphs even when both are
  // short. This is the assertion that fails six weeks from now when someone adds
  // "and here is what that means".
  assert.equal(all.slice(0, firstBullet).filter((l) => !l.trim()).length, 1,
    'exactly one blank line, between the paragraph and the list')
})

test('one line per bullet: no sub-bullets, no continuations, no blank lines', () => {
  const brief = composeBrief(FIXTURE())
  const all = lines(brief)
  const firstBullet = all.findIndex((l) => l.startsWith('- '))
  for (const l of all.slice(firstBullet)) {
    assert.match(l, /^- \S/, `not a single top-level bullet: ${JSON.stringify(l)}`)
  }
  assert.equal(bulletsOf(brief).length, all.length - firstBullet)
})

test('the queue is his three classes, in the order he set on 2026-08-15', () => {
  const b = bulletsOf(composeBrief(FIXTURE()))
  assert.equal(b.length, 4, '1 RC + 2 decisions + 1 config line')
  assert.match(b[0], /open\.gismo v0\.2\.0-RC1/)
  assert.match(b[1], /D0021/)
  assert.match(b[2], /D0019/)
  assert.match(b[3], /13 config items/)
})

test('every bullet leads with the verb, and carries its link', () => {
  const b = bulletsOf(composeBrief(FIXTURE()))
  assert.match(b[0], /^- Review /)
  assert.match(b[1], /^- Answer /)
  assert.match(b[0], /\(https:\/\/github\.com\/jwildfire\/open\.gismo\/pull\/10\)/)
})

// --- what it refuses to carry ----------------------------------------------

test('the paragraph is about progress, and says so in words he can read', () => {
  const p = lines(composeBrief(FIXTURE()))[0]
  assert.match(p, /3 changes landed/)
  assert.match(p, /obot\.agent/)
  assert.match(p, /waiting on you/)
  // Not a digest of the 33 pull requests. The place for those is the issue each
  // one belongs to, and the diary, where they already are.
  assert.equal(p.includes('#208'), false, 'the paragraph carries no identifiers')
})

test('a night with nothing in it says so in one sentence', () => {
  const brief = composeBrief({ landed: [], rcs: [], decisions: [], todos: [], configOpen: 0 })
  assert.deepEqual(violations(brief), [])
  assert.equal(bulletsOf(brief).length, 0, 'an empty queue produces no bullets at all')
  assert.match(brief, /Nothing landed overnight/)
  assert.match(brief, /Nothing is waiting on you/)
})

test('config is a count and never item text, whatever it is handed', () => {
  const leaked = composeBrief({ ...FIXTURE(), configOpen: ['c0017 arm the 07:00 fold', 'c0018 arm a scheduled wake'] })
  assert.equal(leaked.includes('c0017'), false, 'the blockers list is local-only; only the count may leave')
  assert.equal(leaked.includes('arm the'), false)
  assert.equal(bulletsOf(leaked).some((l) => /config item/.test(l)), false,
    'a non-numeric count is no count: the line is dropped rather than invented')
})

test('nothing else survives: no headings, no meta, no footer, no coda', () => {
  const brief = composeBrief(FIXTURE())
  assert.equal(/^#/m.test(brief), false, 'no headings')
  assert.equal(brief.includes('**'), false, 'no inline bold anywhere')
  assert.equal(/^>/m.test(brief), false, 'no block quotes')
  assert.equal(brief.includes('```'), false, 'no fenced blocks')
  assert.equal(/drafted by/i.test(brief), false, 'no attribution coda')
  assert.equal(/session report/i.test(brief), false, 'no report links')
  assert.equal(brief.endsWith('\n'), true)
  assert.equal(brief.endsWith('\n\n'), false, 'exactly one trailing newline')
})

// --- the bounds hold under pressure ----------------------------------------

test('the paragraph stays under its word bound however long the titles are', () => {
  const long = Array.from({ length: 40 }, (_, i) => ({
    repo: `repo-${i % 5}`,
    title: 'An outcome sentence of quite considerable length that would happily run past any budget it was not held to, again and again',
    pr: 100 + i,
    at: '2026-08-18T05:00:00Z',
  }))
  const brief = composeBrief({ ...FIXTURE(), landed: long })
  assert.deepEqual(violations(brief), [])
  assert.ok(visibleWords(lines(brief)[0]) <= MAX_PARAGRAPH_WORDS,
    `paragraph ran to ${visibleWords(lines(brief)[0])} words`)
})

test('a long title is elided rather than allowed to run', () => {
  const brief = composeBrief({
    ...FIXTURE(),
    decisions: [{ key: 'D9999', title: 'A decision whose title was written by someone who had not been told that a briefing line is fifteen words and not fifty, and who kept going', url: 'https://example.com/d' }],
  })
  assert.deepEqual(violations(brief), [])
  for (const b of bulletsOf(brief)) {
    assert.ok(visibleWords(b) <= MAX_BULLET_WORDS, `bullet ran to ${visibleWords(b)} words: ${b}`)
  }
  assert.match(brief, /…/, 'the elision is visible rather than silent')
})

test('a queue too long for the budget is cut with the remainder counted, never dropped in silence', () => {
  const todos = Array.from({ length: 12 }, (_, i) => ({ title: `A mechanical todo number ${i}` }))
  const brief = composeBrief({ ...FIXTURE(), todos })
  assert.deepEqual(violations(brief), [])
  const b = bulletsOf(brief)
  assert.ok(b.length <= BULLET_BUDGET, `${b.length} bullets, budget ${BULLET_BUDGET}`)
  assert.ok(b.some((l) => /\d+ more waiting/.test(l)), 'the remainder is counted on one line')
})

test('the headline classes are never cut, even when they alone exceed the budget', () => {
  const rcs = Array.from({ length: 8 }, (_, i) => ({ key: `jwildfire/r#${i}`, title: `pkg v1.${i}.0-RC1`, url: `https://x/${i}` }))
  const decisions = Array.from({ length: 8 }, (_, i) => ({ key: `D00${i}`, title: `A decision ${i}`, url: `https://y/${i}` }))
  const brief = composeBrief({ ...FIXTURE(), rcs, decisions, todos: [{ title: 'a mechanical todo' }] })
  assert.deepEqual(violations(brief), [])
  const b = bulletsOf(brief)
  assert.equal(b.filter((l) => l.startsWith('- Review')).length, 8, 'a release candidate is never hidden')
  assert.equal(b.filter((l) => l.startsWith('- Answer')).length, 8, 'a decision is never hidden')
  assert.equal(b.some((l) => /mechanical todo/.test(l)), false, 'everything else yields to them')
})

// --- the checker itself, tested against malformations -----------------------

test('violations() is empty on the real composed brief', () => {
  assert.deepEqual(violations(composeBrief(FIXTURE())), [])
})

test('violations() catches every malformation it exists to catch', () => {
  const good = composeBrief(FIXTURE())
  const head = lines(good)[0]
  const body = bulletsOf(good).join('\n')

  const cases = [
    ['a second paragraph', `${head}\n\nAnd here is what that means for the week.\n\n${body}\n`],
    ['a heading', `${head}\n\n## Todo\n${body}\n`],
    ['a sub-bullet', `${head}\n\n${body}\n  - and one nested under it\n`],
    ['a continuation line', `${head}\n\n${body}\n  which continues the bullet above\n`],
    ['a blank line inside the list', `${head}\n\n- Review one\n\n- Answer two\n`],
    ['inline bold', `${head.replace('changes', '**changes**')}\n\n${body}\n`],
    ['a block quote', `${head}\n\n${body}\n> he said\n`],
    ['a trailing coda', `${head}\n\n${body}\n\nDrafted by an agent.\n`],
    ['an overlong paragraph', `${'word '.repeat(MAX_PARAGRAPH_WORDS + 5).trim()}\n\n${body}\n`],
    ['an overlong bullet', `${head}\n\n- ${'word '.repeat(MAX_BULLET_WORDS + 5).trim()}\n`],
    ['no trailing newline', `${head}\n\n${body}`],
    ['a paragraph that is a bullet', `- Review one\n\n${body}\n`],
  ]
  for (const [what, bad] of cases) {
    assert.ok(violations(bad).length > 0, `the checker missed ${what}`)
  }
})

test('visibleWords ignores the URL, because a link is not prose', () => {
  assert.equal(visibleWords('- Review [open.gismo v0.2.0-RC1](https://github.com/jwildfire/open.gismo/pull/10)'), 3)
  // A line that wraps on his phone is still one line: length in characters is
  // deliberately not a rule here.
  assert.equal(visibleWords('- Answer D0021: [SafetyCensus(): stays or goes](https://example.com/a-very-long-url-that-goes-on)'), 6)
})

// --- the fold actually writes it -------------------------------------------
//
// The assertion is on the filesystem, not on the run report. This programme has
// nine instances in one night of an operation reporting success while having no
// effect, and a composer nothing calls is exactly that shape.

test('a run whose queue changed writes the brief, and it passes its own check', async () => {
  const { run } = await import('../fold.mjs')
  const { readBrief, BRIEF_REL } = await import('../lib/brief.mjs')
  const w = workspace({ rcs: 1, blockers: 2 })
  const { report } = await run(['--no-publish'], { workspace: w, hub: hub(), now: NOW })

  assert.equal(report.briefing, true)
  assert.equal(report.brief.written, true, report.brief?.violations?.join('; '))
  assert.equal(report.brief.file, BRIEF_REL)

  const text = readBrief(w)
  assert.deepEqual(violations(text), [])
  assert.match(text, /^Overnight|^Nothing landed overnight/)
  assert.ok(bulletsOf(text).length >= 2)
})

test('a quiet night writes no brief at all', async () => {
  const { run } = await import('../fold.mjs')
  const { readBrief } = await import('../lib/brief.mjs')
  const w = workspace({ rcs: 0, blockers: 0, hashOfEmpty: true })
  const { report } = await run(['--no-publish'], { workspace: w, hub: hub(), now: NOW })
  assert.equal(report.verdict, 'quiet')
  assert.equal(report.brief, undefined)
  assert.equal(readBrief(w), null, 'no brief file exists after a quiet night')
})

test('--brief prints the brief and writes nothing', async () => {
  const { run } = await import('../fold.mjs')
  const { readBrief } = await import('../lib/brief.mjs')
  const w = workspace({ rcs: 1, blockers: 2 })
  const { brief, exit } = await run(['--brief'], { workspace: w, hub: hub(), now: NOW })
  assert.equal(exit, 0)
  assert.deepEqual(violations(brief), [])
  assert.equal(readBrief(w), null, 'a read is a read')
  assert.equal(existsSync(join(w, '.claude/fold/runs.jsonl')), false, 'and does not even record a run')
})
