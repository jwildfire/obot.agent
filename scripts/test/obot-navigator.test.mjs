// The Navigator's launcher — the singleton rule and the launch flags.
//
// obot-prime's equivalent is untestable because it hardcodes the jobs directory;
// this one honours OBOT_JOBS_DIR so the rule that matters can be proved rather
// than asserted. Two officers writing requirements for the same ask is the
// failure mode D0017 designs out on day one, and a singleton check that has never
// been exercised is exactly the kind of capability that looks armed and is not.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LAUNCHER = join(REPO, 'scripts', 'obot-navigator')

const jobsDir = (jobs) => {
  const root = mkdtempSync(join(tmpdir(), 'jobs-'))
  for (const [id, state] of Object.entries(jobs)) {
    mkdirSync(join(root, id), { recursive: true })
    writeFileSync(join(root, id, 'state.json'), JSON.stringify(state))
  }
  return root
}

const run = (jobsRoot, args = ['--preflight-only']) => spawnSync(LAUNCHER, args, {
  env: { ...process.env, OBOT_JOBS_DIR: jobsRoot, OBOT_WORKSPACE: REPO },
  encoding: 'utf8',
})

test('preflight prints the launch command, and every flag D0017 named is in it', () => {
  const r = run(jobsDir({}))
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /--bg/)
  assert.match(r.stdout, /--permission-mode auto/)
  assert.match(r.stdout, /--remote-control/)
  assert.match(r.stdout, /--model opus/)
  assert.match(r.stdout, /s-navigator/)
  assert.match(r.stdout, /🧭🤖 obot-navigator/)
})

test('singleton: a live Navigator blocks a second one and prints how to reach it', () => {
  const r = run(jobsDir({ abc123: { name: '🧭🤖 obot-navigator', state: 'working' } }))
  assert.equal(r.status, 0)
  assert.match(r.stdout, /already running/)
  assert.match(r.stdout, /abc123/)
  assert.doesNotMatch(r.stdout, /would run/)
})

test('singleton: a waiting Navigator still counts as live', () => {
  // A standing session that thinks only on a trigger sits in `blocked` between
  // wakings — treating that as dead would start a second officer every quiet hour.
  const r = run(jobsDir({ def456: { name: '🧭🤖 obot-navigator', state: 'blocked' } }))
  assert.match(r.stdout, /already running/)
})

test('singleton: a finished Navigator does not block a new one', () => {
  const r = run(jobsDir({ old999: { name: '🧭🤖 obot-navigator', state: 'done' } }))
  assert.match(r.stdout, /would run/)
})

test('singleton: the concierge and the workers are not the Navigator', () => {
  const r = run(jobsDir({
    p1: { name: '🎩🤖 obot-prime', state: 'working' },
    w1: { name: '👯🤖 W0002 2026-08-16 navstandup', state: 'working' },
  }))
  assert.match(r.stdout, /would run/)
})
