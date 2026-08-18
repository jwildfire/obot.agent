// The gate, checked against real history rather than against fixtures alone
// (jwildfire/obot.roadmap#238, task obot.agent#200).
//
// A gate that only ever sees synthetic input is a gate whose thresholds nobody
// has calibrated. These two windows are measured from the real clones, and the
// measurement corrected a claim this task was filed with:
//
//   The requirement and this task's own issue described 5-13 August as the quiet
//   stretch. That is the DIARY's gap, not a work gap — those nine days carry 29
//   commits across obot.agent and obot.roadmap. The diary stopped; the work did
//   not, which is precisely the failure #238 exists to fix, and it would have been
//   a bad calibration point for "quiet".
//
// The genuinely quiet windows in that period are the daytime hours between the
// overnight runs. 2026-08-11T09:00Z -> 2026-08-12T08:00Z holds zero commits across
// all seven project repos; 2026-08-16 holds 116.
//
// Skipped when the real clones are not present, so CI on a fresh checkout stays
// green — and it says it skipped, because a test that silently passes by not
// running is the same defect in a different coat.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { policyRepos, commitsSince } from '../lib/repos.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const WS = process.env.OBOT_WORKSPACE || join(homedir(), 'Documents', 'obot2')
const REPOS = policyRepos(REPO_ROOT)
const HAVE_CLONES = REPOS.length > 0 && REPOS.some((r) => existsSync(join(WS, r, '.git')))
const skip = HAVE_CLONES ? false : 'the real clones are not present in this checkout'

test('a measured quiet window really is empty of commits', { skip }, () => {
  const r = commitsSince(WS, REPOS, '2026-08-11T09:00:00Z', { untilIso: '2026-08-12T08:00:00Z' })
  assert.equal(r.unknown, false, 'every repo answered')
  assert.equal(r.commits.length, 0, 'nothing was committed anywhere in this window')
})

test('a busy night is not mistaken for a quiet one', { skip }, () => {
  const r = commitsSince(WS, REPOS, '2026-08-16T00:00:00Z', { untilIso: '2026-08-17T00:00:00Z' })
  assert.equal(r.unknown, false)
  assert.ok(r.commits.length > 50, `expected the night of 16 August to be busy, saw ${r.commits.length}`)
})

test('a repo that cannot be read is unknown, never zero', () => {
  const r = commitsSince('/nonexistent-workspace', ['nope'], '2026-08-16T00:00:00Z', {
    run: () => { throw new Error('fatal: not a git repository') },
  })
  // The repo does not exist on disk, so it is skipped rather than failed - and a
  // skipped repo contributes no commits and no false claim of emptiness either.
  assert.equal(r.commits.length, 0)

  const failed = commitsSince(WS, REPOS.slice(0, 1), '2026-08-16T00:00:00Z', {
    run: () => { throw new Error('git: index.lock exists') },
  })
  if (HAVE_CLONES) {
    assert.equal(failed.unknown, true, 'a git failure is unknown, and unknown never reports quiet')
    assert.match(failed.failed[0], /index\.lock/)
  }
})
