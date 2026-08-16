// The delivery record — the Navigator's own file, and the only one the session
// writes (D0017, adopted 2026-08-16).
//
// Two properties are load-bearing and both come from failures already on the
// record. The file is append-only, because the last two nights produced repeated
// cases of one process quietly overwriting another's; and the calls the Navigator
// makes on @jwildfire's behalf carry permanent ids from a journal rather than from
// scraped prose, because an id read out of body text burned two numbers on
// 2026-08-15 (obot.agent#126).
//
// The audit's exit code is the verdict — 0 agree, 1 a finding — and the verdict is
// the FIRST line, because callers summarise by first line (obot.agent#129).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderState } from '../sweep.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const TOOL = join(REPO, 'tools', 'delivery-log')

const ws = () => mkdtempSync(join(tmpdir(), 'delivery-'))
const run = (workspace, args) => spawnSync(TOOL, args, {
  env: { ...process.env, OBOT_WORKSPACE: workspace, OBOT_ACTOR: 'W0002' },
  encoding: 'utf8',
})
const md = (workspace) => join(workspace, '.claude/session-hub/delivery.md')
const read = (workspace) => (existsSync(md(workspace)) ? readFileSync(md(workspace), 'utf8') : '')

test('verdict: one closeout becomes one line naming worker, work, requirement and verdict', () => {
  const w = ws()
  const r = run(w, ['verdict', '--worker', 'W0007', '--produced', 'obot.agent#132',
    '--requirement', 'hub#194', '--verdict', 'confirmed', '--note', 'stage moved to Review'])
  assert.equal(r.status, 0, r.stderr)
  const text = read(w)
  assert.match(text, /W0007/)
  assert.match(text, /obot\.agent#132/)
  assert.match(text, /hub#194/)
  assert.match(text, /confirmed/)
  assert.match(text, /stage moved to Review/)
})

test('verdict: the file only ever grows — a second entry never rewrites the first', () => {
  const w = ws()
  run(w, ['verdict', '--worker', 'W0007', '--produced', 'oa#1', '--requirement', 'hub#194', '--verdict', 'confirmed'])
  const first = read(w)
  run(w, ['verdict', '--worker', 'W0008', '--produced', 'oa#2', '--requirement', 'hub#195', '--verdict', 'drift'])
  const second = read(w)
  assert.ok(second.startsWith(first), 'the earlier content must survive verbatim')
  assert.match(second, /W0008/)
})

test('verdict: an unknown verdict is refused rather than recorded', () => {
  const w = ws()
  const r = run(w, ['verdict', '--worker', 'W0007', '--produced', 'oa#1', '--requirement', 'hub#194', '--verdict', 'probably-fine'])
  assert.equal(r.status, 1)
  assert.equal(read(w), '')
})

test('call: plan-changing calls get permanent ids, allocated in order and never reused', () => {
  const w = ws()
  const a = run(w, ['call', '--kind', 'requirement-filed', '--summary', 'filed the sessions-page requirement'])
  const b = run(w, ['call', '--kind', 'exemption', '--summary', 'a typo fix needs no requirement'])
  assert.equal(a.status, 0, a.stderr)
  assert.equal(a.stdout.trim(), 'n0001')
  assert.equal(b.stdout.trim(), 'n0002')
  const text = read(w)
  assert.match(text, /n0001/)
  assert.match(text, /n0002/)
  assert.match(text, /filed the sessions-page requirement/)
})

test('call: ids come from the journal, never from prose in the file', () => {
  const w = ws()
  run(w, ['call', '--kind', 'requirement-filed', '--summary', 'the first call'])
  // The exact 2026-08-15 incident: a forward reference typed into the body.
  appendFileSync(md(w), '- a note mentioning n0099 in passing\n')
  const next = run(w, ['call', '--kind', 'amendment', '--summary', 'the second call'])
  assert.equal(next.stdout.trim(), 'n0002', 'a mention in prose must not advance the counter')
})

test('render: the day renders as one ## Delivery section, calls set apart', () => {
  const w = ws()
  run(w, ['verdict', '--worker', 'W0007', '--produced', 'oa#132', '--requirement', 'hub#194', '--verdict', 'confirmed'])
  run(w, ['call', '--kind', 'requirement-filed', '--summary', 'filed hub#199'])
  const r = run(w, ['render'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^## Delivery/m)
  assert.match(r.stdout, /Calls made for you/)
  assert.match(r.stdout, /n0001/)
  assert.match(r.stdout, /W0007/)
})

test('render: an empty record says so rather than rendering as a clean day', () => {
  const r = run(ws(), ['render'])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^## Delivery/m)
  assert.match(r.stdout, /no closeouts recorded/i)
})

test('audit: the verdict is the first line, and a clean record exits 0', () => {
  const w = ws()
  run(w, ['call', '--kind', 'requirement-filed', '--summary', 'filed hub#199'])
  const r = run(w, ['--audit'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout.split('\n')[0], /clean/i)
})

test('audit: an allocated call id with no line behind it is a finding, verdict first', () => {
  const w = ws()
  run(w, ['call', '--kind', 'requirement-filed', '--summary', 'filed hub#199'])
  // Simulate the record being hand-edited out from under the journal.
  writeFileSync(md(w), '# delivery\n')
  const r = run(w, ['--audit'])
  assert.equal(r.status, 1)
  assert.match(r.stdout.split('\n')[0], /GAP|FINDING/i)
  assert.match(r.stdout, /n0001/)
})

test('audit: never armed is not the same as clean', () => {
  const r = run(ws(), ['--audit'])
  assert.equal(r.status, 0)
  assert.match(r.stdout.split('\n')[0], /not armed|no calls/i)
})

test('the sweep renders the delivery section it is handed, under its own heading', () => {
  const out = renderState({
    snapshot: {},
    events: [],
    meta: { sweptAt: '2026-08-16 09:00', cadenceMin: 5, repoCount: 7, ok: true },
    delivery: '## Delivery\n\n- 09:00 W0007 → hub#194 confirmed\n',
  })
  assert.match(out, /^## Delivery/m)
  assert.match(out, /W0007/)
})

test('the sweep is unharmed when there is no delivery record at all', () => {
  const out = renderState({
    snapshot: {}, events: [],
    meta: { sweptAt: '2026-08-16 09:00', cadenceMin: 5, repoCount: 7, ok: true },
  })
  assert.match(out, /navigator-state/)
  assert.doesNotMatch(out, /## Delivery/)
})
