// The fold's own durable state (jwildfire/obot.roadmap#238, task obot.agent#200).
//
// It lives under {workspace}/.claude/fold/ and nowhere else. The Navigator's
// sweep is the declared sole writer of everything under .claude/session-hub/ —
// its own state file says so in its header — and a second writer there is
// reported as a ledger fault. The one exception is the timing ledger, which the
// bookends already share.
//
// The state exists because launchd does not defer a calendar fire missed while
// the machine slept: it runs once on wake, at an arbitrary hour, and D0019
// measured that missed runs are lost rather than replayed. So the fold folds the
// window its watermark defines and never the window its wall clock implies.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readState, writeState, recordRun, STATE_REL, RUNS_REL } from '../lib/state.mjs'

const ws = () => mkdtempSync(join(tmpdir(), 'foldstate-'))

test('a fresh machine reads a first-run state rather than throwing', () => {
  const s = readState(ws())
  assert.equal(s.lastFoldAt, null)
  assert.equal(s.queueHash, null)
  assert.deepEqual(s.sessionLog, {})
})

test('state round-trips, and lands in the fold’s own directory', () => {
  const w = ws()
  writeState(w, { lastFoldAt: '2026-08-18T11:00:00Z', queueHash: 'sha256:x', sessionLog: { '2026-08-18.md': 3172 } })
  assert.ok(existsSync(join(w, STATE_REL)), `state must be at ${STATE_REL}`)
  assert.ok(!existsSync(join(w, '.claude/session-hub/fold.json')), 'the sweep owns session-hub, not the fold')
  const s = readState(w)
  assert.equal(s.lastFoldAt, '2026-08-18T11:00:00Z')
  assert.equal(s.sessionLog['2026-08-18.md'], 3172)
})

test('a quiet run is still recorded, because silence has to be distinguishable from death', () => {
  const w = ws()
  recordRun(w, { at: '2026-08-18T11:00:00Z', verdict: 'quiet', diary: false, briefing: false, push: false })
  const lines = readFileSync(join(w, RUNS_REL), 'utf8').trim().split('\n')
  assert.equal(lines.length, 1)
  assert.equal(JSON.parse(lines[0]).verdict, 'quiet')
})

test('the run log appends and never rewrites', () => {
  const w = ws()
  recordRun(w, { at: '2026-08-18T11:00:00Z', verdict: 'quiet' })
  recordRun(w, { at: '2026-08-19T11:00:00Z', verdict: 'fold' })
  const lines = readFileSync(join(w, RUNS_REL), 'utf8').trim().split('\n')
  assert.equal(lines.length, 2)
  assert.equal(JSON.parse(lines[0]).verdict, 'quiet', 'the earlier run survives the later one')
})

test('a corrupt state file reads as first-run and does not take the fold down', () => {
  const w = ws()
  mkdirSync(join(w, '.claude/fold'), { recursive: true })
  writeFileSync(join(w, STATE_REL), '{ this is not json')
  const s = readState(w)
  assert.equal(s.lastFoldAt, null)
  assert.equal(s.corrupt, true, 'but it says so, rather than pretending it was a fresh machine')
})
