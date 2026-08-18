// The ideas backstop, run by the clock instead of by nobody (obot.agent#203,
// under jwildfire/obot.roadmap#238).
//
// It last ran on 14 August. The watermark proves it: `.claude/ideas-watermark`
// reads 2026-08-14T21:33:59Z and its mtime is the same instant. It stopped
// because its only automatic trigger lived inside the interactive kickoff's
// recon sibling, and that lane has not run since 4 August.
//
// It is a BACKSTOP — the hub's ideas-triage Action handles each new post within
// minutes — so the expected result most mornings is nothing. That is exactly why
// nobody noticed it stop, and exactly why "nothing" and "broken" have to look
// different from each other here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sweepIdeas, newestUpdatedAt, PAGE_SIZE } from '../lib/ideas.mjs'

const ws = () => mkdtempSync(join(tmpdir(), 'foldideas-'))
const mark = (w, iso) => {
  mkdirSync(join(w, '.claude'), { recursive: true })
  writeFileSync(join(w, '.claude/ideas-watermark'), iso + '\n')
}
const idea = (n, updatedAt) => ({ number: n, title: `Idea ${n}`, url: `https://x/${n}`, updatedAt })

test('an empty sweep and a broken one do not look the same', () => {
  const w = ws(); mark(w, '2026-08-14T21:33:59Z')
  // The category is reachable and genuinely holds nothing new.
  const quiet = sweepIdeas(w, { sweep: () => [], categoryTotal: () => 33 })
  assert.equal(quiet.unknown, false)
  assert.equal(quiet.items.length, 0)
  assert.match(quiet.why, /no new ideas/i)

  // The category answered zero TOTAL, which is not a quiet inbox — the id is
  // hardcoded, so if it ever changes the sweep reports "no new ideas" forever
  // and looks perfectly healthy doing it.
  const broken = sweepIdeas(w, { sweep: () => [], categoryTotal: () => 0 })
  assert.equal(broken.unknown, true)
  assert.match(broken.why, /category/i)
})

test('a sweep that throws is unknown, and says what threw', () => {
  const w = ws(); mark(w, '2026-08-14T21:33:59Z')
  const r = sweepIdeas(w, {
    sweep: () => { throw new Error('gh: could not resolve to a Repository') },
    categoryTotal: () => 33,
  })
  assert.equal(r.unknown, true)
  assert.match(r.why, /could not resolve/)
  assert.deepEqual(r.items, [])
})

test('the watermark advances to what was actually swept, not to the wall clock', () => {
  const w = ws(); mark(w, '2026-08-14T21:33:59Z')
  const items = [idea(151, '2026-08-17T10:00:00Z'), idea(89, '2026-08-16T08:00:00Z')]
  assert.equal(newestUpdatedAt(items), '2026-08-17T10:00:00Z')

  const r = sweepIdeas(w, { sweep: () => items, categoryTotal: () => 33, advance: true })
  assert.equal(readFileSync(join(w, '.claude/ideas-watermark'), 'utf8').trim(), '2026-08-17T10:00:00Z',
    'stamping `now` skips anything updated between the read and the advance, permanently')
})

test('nothing swept leaves the watermark exactly where it was', () => {
  const w = ws(); mark(w, '2026-08-14T21:33:59Z')
  sweepIdeas(w, { sweep: () => [], categoryTotal: () => 33, advance: true })
  assert.equal(readFileSync(join(w, '.claude/ideas-watermark'), 'utf8').trim(), '2026-08-14T21:33:59Z')
})

test('an unknown sweep never advances the watermark', () => {
  const w = ws(); mark(w, '2026-08-14T21:33:59Z')
  sweepIdeas(w, { sweep: () => { throw new Error('boom') }, categoryTotal: () => 33, advance: true })
  assert.equal(readFileSync(join(w, '.claude/ideas-watermark'), 'utf8').trim(), '2026-08-14T21:33:59Z',
    'advancing past a window nobody could read loses whatever was in it')
})

test('a full page is reported, because the query filters client-side', () => {
  const w = ws(); mark(w, '2026-08-14T21:33:59Z')
  const full = Array.from({ length: PAGE_SIZE }, (_, i) => idea(i, '2026-08-17T10:00:00Z'))
  const r = sweepIdeas(w, { sweep: () => full, categoryTotal: () => 200 })
  assert.equal(r.truncated, true)
  assert.match(r.why, /may be more/i)
})

test('a first run with no watermark does not sweep the whole history', () => {
  const w = ws()   // no watermark file at all
  let asked = null
  sweepIdeas(w, { sweep: (since) => { asked = since; return [] }, categoryTotal: () => 33 })
  assert.notEqual(asked, '1970-01-01T00:00:00Z',
    'the epoch default would hand a fold every idea ever filed as if it were new this morning')
  assert.ok(Date.parse(asked) > Date.parse('2026-01-01T00:00:00Z'))
})

test('the Reminders ingest is deliberately not part of this', () => {
  const src = readFileSync(new URL('../lib/ideas.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /reminders-to-ideas/,
    'it shells osascript into Apple Reminders and can stall on a permission prompt; at 07:00 nobody can answer it')
})

test('the fold detects and never advances — it is a backstop, not a processor', async () => {
  const { run } = await import('../fold.mjs')
  const w = ws()
  mark(w, '2026-08-14T21:33:59Z')
  mkdirSync(join(w, '.claude/session-hub/cache'), { recursive: true })
  writeFileSync(join(w, '.claude/session-hub/cache/navigator-rc.json'),
    JSON.stringify({ sweptIso: '2026-08-18T11:00:00Z', snapshot: {}, events: [] }))
  writeFileSync(join(w, '.claude/blockers.md'), '# b\n\n## Open\n\n')
  mkdirSync(join(w, '.claude/session-notes'), { recursive: true })
  writeFileSync(join(w, '.claude/session-notes/2026-08-18.md'), '# s\n\n## Overview\n\n## Todo\n\n## Session log\n')

  const before = readFileSync(join(w, '.claude/ideas-watermark'), 'utf8')
  await run([], { workspace: w, hub: join(w, 'nohub'), now: new Date('2026-08-18T11:00:00Z') })
  assert.equal(readFileSync(join(w, '.claude/ideas-watermark'), 'utf8'), before,
    'advancing without replying hides the ideas from whoever triages them next')
})
