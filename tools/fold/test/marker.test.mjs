// The day boundary, written again (obot.agent#201, under jwildfire/obot.roadmap#238).
//
// findSessionMarker() scopes the dashboard's Agents and Roadmap-activity panels
// to the current session by reading a marker comment out of the day's scratchpad.
// That marker was written BY HAND, by the model, as step 3 of interactive
// session-init — and nobody runs interactive session-init any more. The last
// scratchpad containing one is 2026-08-04.
//
// The consequence was never an error. The boundary resolved to local midnight,
// the panels widened to the whole day, and their labels kept reading "since
// session start" while showing since-midnight data. The requirement called this
// the one genuinely silent break in the migration. It was right about the
// mechanism and wrong about the tense.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeDayBoundary, MARKER_RE } from '../lib/marker.mjs'
import { findSessionMarker } from '../../session-hub/lib/scratchpad.mjs'

const SKELETON = '# Session scratchpad — 2026-08-18\n\n## Overview\n\n## Todo\n\n## Notes\n\n## Scaffold\n\n## Session log\n'
const ws = () => mkdtempSync(join(tmpdir(), 'foldmarker-'))
const notes = (w, date, body) => {
  mkdirSync(join(w, '.claude/session-notes'), { recursive: true })
  writeFileSync(join(w, '.claude/session-notes', `${date}.md`), body)
  return join(w, '.claude/session-notes', `${date}.md`)
}

test('the marker it writes is one findSessionMarker actually finds', () => {
  const w = ws()
  const f = notes(w, '2026-08-18', SKELETON)
  writeDayBoundary(w, { date: '2026-08-18', time: '07:00' })
  const m = findSessionMarker(readFileSync(f, 'utf8'))
  assert.ok(m, 'a marker the reader cannot parse changes nothing at all')
  assert.equal(m.date, '2026-08-18')
  assert.equal(m.time, '07:00')
})

test('it lands under ## Overview, where the reader and the convention expect it', () => {
  const w = ws()
  const f = notes(w, '2026-08-18', SKELETON)
  writeDayBoundary(w, { date: '2026-08-18', time: '07:00' })
  const lines = readFileSync(f, 'utf8').split('\n')
  const iOverview = lines.findIndex((l) => l.trim() === '## Overview')
  const iMarker = lines.findIndex((l) => MARKER_RE.test(l))
  const iTodo = lines.findIndex((l) => l.trim() === '## Todo')
  assert.ok(iOverview < iMarker && iMarker < iTodo, `marker at ${iMarker}, Overview ${iOverview}, Todo ${iTodo}`)
})

test('it never rewrites the file wholesale — a concurrent append survives', () => {
  const w = ws()
  const f = notes(w, '2026-08-18', SKELETON)
  // A night sibling's line, already in the file when the 07:00 fold fires.
  writeFileSync(f, readFileSync(f, 'utf8').replace('## Session log\n', '## Session log\n- 00:02 👯🤖 W0043 — a thing happened\n'))
  writeDayBoundary(w, { date: '2026-08-18', time: '07:00' })
  const after = readFileSync(f, 'utf8')
  assert.match(after, /W0043 — a thing happened/, 'the scratchpad is shared by the lead, every sibling and every unattended job')
  for (const h of ['## Overview', '## Todo', '## Notes', '## Scaffold', '## Session log']) {
    assert.ok(after.includes(h), `${h} survived`)
  }
})

test('a missing scratchpad is created with the skeleton rather than skipped', () => {
  const w = ws()
  const r = writeDayBoundary(w, { date: '2026-08-18', time: '07:00' })
  assert.equal(r.created, true)
  const md = readFileSync(join(w, '.claude/session-notes/2026-08-18.md'), 'utf8')
  // MARKER_RE is line-anchored on purpose — it is what identifies THIS writer's
  // marker for replacement, so it must not match loosely inside a larger blob.
  assert.ok(md.split('\n').some((l) => MARKER_RE.test(l.trim())))
  assert.match(md, /## Session log/)
})

test('writing twice in a day replaces the fold’s own marker, never accumulating them', () => {
  const w = ws()
  const f = notes(w, '2026-08-18', SKELETON)
  writeDayBoundary(w, { date: '2026-08-18', time: '07:00' })
  writeDayBoundary(w, { date: '2026-08-18', time: '07:05' })
  const md = readFileSync(f, 'utf8')
  const all = md.split('\n').filter((l) => MARKER_RE.test(l))
  assert.equal(all.length, 1, 'a late launchd fire must not leave two boundaries behind')
  assert.match(all[0], /07:05/)
})

test('an interactive session-init marker is left alone and still wins if it is later', () => {
  const w = ws()
  const f = notes(w, '2026-08-18', SKELETON)
  writeDayBoundary(w, { date: '2026-08-18', time: '07:00' })
  // session-init still exists and still writes its own; this task adds a second
  // writer rather than removing the first (#240 owns every retirement).
  const md = readFileSync(f, 'utf8').replace(
    '## Todo', '<!-- session-init 2026-08-18 09:30 session #2 (job abc123) -->\n\n## Todo')
  writeFileSync(f, md)
  const m = findSessionMarker(readFileSync(f, 'utf8'))
  assert.equal(m.time, '09:30', 'findSessionMarker takes the LAST match; the newer boundary must win')
  assert.equal(m.sessionNumber, 2)
})

test('the time is passed in, never modelled — and it is the fold’s, not midnight', () => {
  const w = ws()
  const f = notes(w, '2026-08-18', SKELETON)
  // The fold has just folded the overnight work into the diary and the briefing,
  // so the live dashboard's new day starts at the fold. Anchoring at midnight
  // would leave the fold's own subject matter in the panel it was reported out of.
  const r = writeDayBoundary(w, { date: '2026-08-18', time: '07:00' })
  assert.equal(r.time, '07:00')
  assert.match(readFileSync(f, 'utf8'), /07:00/)
})
