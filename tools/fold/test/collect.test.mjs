// What the gate reads, and the three ways it has been lied to before
// (jwildfire/obot.roadmap#238, task obot.agent#200).
//
// 1. navigator-state.md is a PROSE render with a readability cap — it shows 15
//    events while the snapshot keeps 60, and truncates its lists with "…and N
//    more not shown here". Parsing it silently under-counts. Read the JSON.
// 2. The sweep's "config ledger: 14 id(s) allocated" line is an integrity audit,
//    not an open count. The open count today is 10. Shipping 14 as the blockers
//    number would be wrong by four.
// 3. Wall-clock strings are not instants. An event's `at` is a bare local HH:MM
//    with no date and no zone, and this machine's own records disagree with
//    themselves across the BST-to-EDT move: {at:'06:21', ts:'…T05:21:18Z'} is
//    01:21 EDT. Every comparison uses `ts`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sweptEvents, openBlockerCount, sessionLogSizes, scratchpadTodos } from '../lib/collect.mjs'

const ws = () => mkdtempSync(join(tmpdir(), 'foldcollect-'))
const put = (w, rel, body) => {
  mkdirSync(join(w, rel, '..'), { recursive: true })
  writeFileSync(join(w, rel), body)
}

const SNAPSHOT = {
  sweptIso: '2026-08-18T04:34:24.536Z',
  snapshot: { 'jwildfire/open.gismo#10': { repo: 'open.gismo', number: 10, title: 'v0.2.0-RC1' } },
  events: [
    { type: 'rc-new', ref: 'open.gismo#10', at: '06:21', ts: '2026-08-17T05:21:18.335Z' },
    { type: 'rc-gone', ref: 'gsm.safety#52', at: '10:41', ts: '2026-08-18T03:10:00.000Z' },
  ],
}

test('events are filtered on the instant, never on the printed clock time', () => {
  const w = ws()
  put(w, '.claude/session-hub/cache/navigator-rc.json', JSON.stringify(SNAPSHOT))
  // The clock is pinned: the freshness rule below is real, and a test that
  // borrows the wall clock passes today and fails tomorrow for no reason.
  const r = sweptEvents(w, '2026-08-18T00:00:00.000Z', { now: new Date('2026-08-18T04:40:00Z') })
  assert.equal(r.unknown, false)
  assert.equal(r.events.length, 1, 'only the 03:10Z event is after the watermark')
  assert.equal(r.events[0].ref, 'gsm.safety#52')
})

test('a missing snapshot is unknown, not empty', () => {
  const r = sweptEvents(ws(), '2026-08-18T00:00:00.000Z')
  assert.equal(r.unknown, true, 'no file is not the same claim as no events')
  assert.deepEqual(r.events, [])
})

test('a stale snapshot is unknown — the observer being dead is not a quiet night', () => {
  const w = ws()
  put(w, '.claude/session-hub/cache/navigator-rc.json',
      JSON.stringify({ ...SNAPSHOT, sweptIso: '2026-08-18T00:00:00.000Z' }))
  const r = sweptEvents(w, '2026-08-17T00:00:00.000Z', { now: new Date('2026-08-18T11:00:00Z') })
  assert.equal(r.unknown, true)
  assert.match(r.why, /stale/i)
})

test('the blocker count is unchecked bullets under ## Open, and nothing else', () => {
  const w = ws()
  put(w, '.claude/blockers.md', [
    '# blockers', '', '## Open', '',
    '- [ ] c0001 · filed 08-15 — **an allowlist line**',
    '- [x] c0006 · filed 08-15 — **already done**',
    '- [ ] c0013 · filed 08-16 — **another one**',
    '', '## Closed', '', '- [ ] c0099 · this section does not count',
  ].join('\n'))
  const r = openBlockerCount(w)
  assert.equal(r.count, 2)
  assert.equal(r.unknown, false)
})

test('no blockers file is unknown rather than zero', () => {
  const r = openBlockerCount(ws())
  assert.equal(r.unknown, true)
  assert.equal(r.count, null, 'zero open blockers is a claim; not knowing is not')
})

test('session-log growth is measured in bytes, because the timestamps cannot be trusted', () => {
  const w = ws()
  put(w, '.claude/session-notes/2026-08-17.md', '# s\n\n## Session log\n- 23:10 a line\n')
  put(w, '.claude/session-notes/2026-08-18.md', '# s\n\n## Session log\n- 00:02 a line\n- 00:07 another\n')
  put(w, '.claude/session-notes/2026-08-18-diary-draft.md', '# not a daily file\n\n## Session log\n- x\n')
  const sizes = sessionLogSizes(w)
  assert.deepEqual(Object.keys(sizes).sort(), ['2026-08-17.md', '2026-08-18.md'],
    'the strict ^YYYY-MM-DD.md$ filter, not the loose 2*.md glob that burns a slot on a draft')
  assert.ok(sizes['2026-08-18.md'] > sizes['2026-08-17.md'])
})

test('only the two newest daily scratchpads are read, per the midnight fix', () => {
  const w = ws()
  for (const d of ['2026-08-14', '2026-08-15', '2026-08-16']) {
    put(w, `.claude/session-notes/${d}.md`, '# s\n\n## Session log\n- 01:00 x\n')
  }
  assert.equal(Object.keys(sessionLogSizes(w)).length, 2)
})

test('todos are the unchecked ## Todo items in those scratchpads', () => {
  const w = ws()
  put(w, '.claude/session-notes/2026-08-18.md', [
    '# s', '', '## Todo', '',
    '- [ ] Arm a scheduled wake with pmset',
    '- [x] Already handled',
    '', '## Session log', '- 00:02 x',
  ].join('\n'))
  const t = scratchpadTodos(w)
  assert.equal(t.items.length, 1)
  assert.match(t.items[0].title, /pmset/)
})
