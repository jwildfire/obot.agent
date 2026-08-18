// A frozen record does not get overwritten by the next one (obot.agent#201).
//
// The report slug comes from the marker's `session #N`, defaulting to 1 when the
// marker is absent. It has been absent since 2026-08-04 — so every session of a
// day resolves to the same slug and `--report` writes over the previous
// session's frozen operational record.
//
// Nobody noticed because the failure produces a correct-looking file. The
// evidence that it used to work is in the hub: reports/sessions/ holds
// 2026-07-24.html beside 2026-07-24-3.html, and 2026-08-04.html beside
// 2026-08-04-2.html, from when the marker was still being written.
//
// The rule here is the safe direction. Overwriting is only correct when it is the
// same session re-rendering, and with no marker we cannot tell — so an existing
// file is never clobbered, a free suffix is taken instead, and the chosen path is
// reported. Nothing is lost, and a stray extra file is a far cheaper mistake than
// a destroyed record.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reportPath } from '../lib/report-path.mjs'

const dir = () => {
  const d = mkdtempSync(join(tmpdir(), 'reports-'))
  mkdirSync(join(d, 'reports', 'sessions'), { recursive: true })
  return d
}
const sessions = (hub) => join(hub, 'reports', 'sessions')
const put = (hub, name, body) => writeFileSync(join(sessions(hub), name), body)

test('a free slug is used as-is', () => {
  const hub = dir()
  const r = reportPath({ hub, slug: '2026-08-18', boundaryStart: '2026-08-18T11:00:00Z' })
  assert.equal(r.path, join(sessions(hub), '2026-08-18.html'))
  assert.equal(r.reused, false)
})

test('re-rendering the SAME session overwrites in place', () => {
  const hub = dir()
  put(hub, '2026-08-18.html', '<html data-session-start="2026-08-18T11:00:00Z">old</html>')
  const r = reportPath({ hub, slug: '2026-08-18', boundaryStart: '2026-08-18T11:00:00Z' })
  assert.equal(r.path, join(sessions(hub), '2026-08-18.html'))
  assert.equal(r.reused, true, 'a wrapup that runs --report twice must not litter')
})

test('a DIFFERENT session takes the next free suffix instead of destroying the record', () => {
  const hub = dir()
  put(hub, '2026-08-18.html', '<html data-session-start="2026-08-18T07:00:00Z">the morning fold</html>')
  const r = reportPath({ hub, slug: '2026-08-18', boundaryStart: '2026-08-18T19:30:00Z' })
  assert.equal(r.path, join(sessions(hub), '2026-08-18-2.html'))
  assert.match(readFileSync(join(sessions(hub), '2026-08-18.html'), 'utf8'), /the morning fold/,
    'the earlier record survives, which is the entire point')
})

test('it keeps counting up rather than stopping at two', () => {
  const hub = dir()
  put(hub, '2026-08-18.html', '<html data-session-start="2026-08-18T07:00:00Z">a</html>')
  put(hub, '2026-08-18-2.html', '<html data-session-start="2026-08-18T12:00:00Z">b</html>')
  const r = reportPath({ hub, slug: '2026-08-18', boundaryStart: '2026-08-18T19:30:00Z' })
  assert.equal(r.path, join(sessions(hub), '2026-08-18-3.html'))
})

test('an existing file with no recorded boundary is never overwritten', () => {
  const hub = dir()
  // Every report written during the two silent weeks is in this state.
  put(hub, '2026-08-18.html', '<html>written before the boundary was stamped</html>')
  const r = reportPath({ hub, slug: '2026-08-18', boundaryStart: '2026-08-18T11:00:00Z' })
  assert.equal(r.path, join(sessions(hub), '2026-08-18-2.html'))
  assert.equal(readdirSync(sessions(hub)).length, 1, 'nothing written yet — but the path chosen is the safe one')
})

test('an explicit --out is honoured exactly, because someone asked for it by name', () => {
  const hub = dir()
  put(hub, '2026-08-18.html', '<html data-session-start="2026-08-18T07:00:00Z">a</html>')
  const r = reportPath({ hub, slug: '2026-08-18', boundaryStart: '2026-08-18T19:30:00Z', explicitOut: '/tmp/x.html' })
  assert.equal(r.path, '/tmp/x.html')
  assert.equal(r.explicit, true)
})
