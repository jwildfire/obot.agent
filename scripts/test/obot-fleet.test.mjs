// The fleet launcher — the singleton rule, the launch flags, and the guarantee
// that a dry run writes nothing (obot.agent#167, under jwildfire/obot.roadmap#236).
//
// The launcher is the one component that CAUSES something. Everything else in the
// sweep observes. So the properties held here are the ones whose violation starts a
// process that should not have started, or fails to start one that should have —
// and both are silent.
//
// OBOT_JOBS_DIR and OBOT_WORKSPACE are honoured throughout so the rules can be
// proved against fabricated fleets rather than asserted. A singleton check that has
// never been exercised is exactly the kind of capability that looks armed and is not.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LAUNCHER = join(REPO, 'scripts', 'obot-fleet')

const jobsDir = (jobs) => {
  const root = mkdtempSync(join(tmpdir(), 'fleetjobs-'))
  for (const [id, state] of Object.entries(jobs)) {
    mkdirSync(join(root, id), { recursive: true })
    writeFileSync(join(root, id, 'state.json'), JSON.stringify(state))
  }
  return root
}

const workspace = () => {
  const root = mkdtempSync(join(tmpdir(), 'fleetws-'))
  mkdirSync(join(root, '.claude/session-hub/cache'), { recursive: true })
  return root
}

const run = (args = [], { jobs = {}, ws = workspace(), env = {} } = {}) => ({
  ws,
  r: spawnSync(LAUNCHER, args, {
    env: { ...process.env, OBOT_JOBS_DIR: jobsDir(jobs), OBOT_WORKSPACE: ws, ...env },
    encoding: 'utf8',
    timeout: 120000,
  }),
})

const fleetLog = (ws) => join(ws, '.claude/session-hub/fleet.log')

test('preflight prints the launch command, with every flag the design named', () => {
  const { r } = run(['--preflight-only'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /--bg/)
  assert.match(r.stdout, /--permission-mode auto/)
  assert.match(r.stdout, /--model opus/)
  assert.match(r.stdout, /\/s-fleet /)
  assert.match(r.stdout, /🚦🤖 obot-fleet/)
})

test('the manager launches UNBRIDGED — dropping the flag alone would be a no-op', () => {
  // Remote Control is for the roles he talks to from a phone. The manager talks to
  // nobody. The flag is OR-ed with the global setting, so it must be overridden
  // explicitly rather than merely omitted (obot.agent#116/#117).
  const { r } = run(['--preflight-only'])
  assert.match(r.stdout, /remoteControlAtStartup":false/)
  assert.doesNotMatch(r.stdout, /--remote-control/)
})

test('the session name is stable across launches — a pinned role cannot carry a slug', () => {
  // @jwildfire, 2026-08-17: pin prime, nav and fleet by default. A pinned row whose
  // name changes every run cannot be pinned.
  const a = run(['--preflight-only']).r.stdout
  const b = run(['--preflight-only']).r.stdout
  const name = (s) => /-n '([^']+)'/.exec(s)?.[1]
  assert.equal(name(a), name(b))
  assert.equal(name(a), '🚦🤖 obot-fleet')
  assert.doesNotMatch(name(a), /\d{4}-\d{2}-\d{2}/, 'no date, no per-run slug')
})

test('a dry run against the live fleet writes NOTHING', () => {
  // --check exists so this can be exercised for real without touching the record. A
  // HOLD line claiming the launcher declined, when it was never asked to launch,
  // would be a false entry in the one file that answers why nothing ran.
  const { ws, r } = run(['--check'], {
    jobs: { j1: { name: '👯🤖 W0099 x', state: 'blocked', tempo: 'blocked', needs: 'a ruling', updatedAt: '2020-01-01T00:00:00Z' } },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /## Fleet/)
  assert.equal(existsSync(fleetLog(ws)), false, 'a dry run must not append to the fleet log')
})

test('a dry run says it is a dry run, and never describes a refusal it did not make', () => {
  const { r } = run(['--check'], {
    jobs: { j1: { name: '👯🤖 W0099 x', state: 'blocked', tempo: 'blocked', needs: 'a ruling', updatedAt: '2020-01-01T00:00:00Z' } },
  })
  assert.match(r.stdout + r.stderr, /DRY RUN|dry run/)
})

test('a quiet fleet reports, launches nothing, and says why', () => {
  const { ws, r } = run(['--check'], { jobs: {} })
  assert.match(r.stdout, /nothing to act on/)
  assert.match(r.stdout, /an empty fleet never launches a manager/)
  assert.equal(existsSync(fleetLog(ws)), false)
})

test('--json is a reading, never an action', () => {
  const { ws, r } = run(['--json'], { jobs: {} })
  const out = JSON.parse(r.stdout)
  assert.equal(out.trigger.fired, false)
  assert.deepEqual(out.trigger.operational, ['jwildfire/obot.agent', 'jwildfire/obot.roadmap'])
  assert.equal(existsSync(fleetLog(ws)), false)
})

test('an unreadable policy is FLEET TRIGGER BROKEN, never a quiet fleet', () => {
  // The failure direction that matters, and the bug this actually caught: the first
  // draft read branch roles from a key the policy file spells differently, found no
  // operational repo, and had to be prevented from reporting that as nothing to do.
  // Silent success is this house's recurring defect.
  const { ws, r } = run(['--check'], { env: { OBOT_FLEET_POLICY: '/nonexistent/policy.json' } })
  assert.match(r.stdout, /\*\*FLEET TRIGGER BROKEN\*\*/)
  assert.match(r.stdout, /this is not a quiet fleet/)
  assert.doesNotMatch(r.stdout, /nothing to act on/)
  assert.equal(existsSync(fleetLog(ws)), false)
})

test('a policy with no OPERATIONAL repo is broken too, not clean', () => {
  // Distinct from unreadable: the file parses, and every lane in it is clinical. A
  // manager must never be launched for those, and reporting "clean" would hide that
  // the operational lanes went unread.
  const ws = workspace()
  const p = join(ws, 'clinical-only.json')
  writeFileSync(p, JSON.stringify({ repos: {
    'jwildfire/gsm.safety': { profile: 'auto', class: 'clinical', branches: { integration: 'dev' } },
  } }))
  const { r } = run(['--check'], { ws, env: { OBOT_FLEET_POLICY: p } })
  assert.match(r.stdout, /\*\*FLEET TRIGGER BROKEN\*\*/)
  assert.doesNotMatch(r.stdout, /nothing to act on/)
})

test('an unknown argument is refused rather than silently ignored', () => {
  const { r } = run(['--merge-everything'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /unknown argument/)
})

test('singleton: a live manager holds the launch and names the job holding it', () => {
  const { ws, r } = run([], {
    jobs: {
      mgr1: { name: '🚦🤖 obot-fleet', state: 'working', updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
      j1: { name: '👯🤖 W0099 x', state: 'blocked', tempo: 'blocked', needs: 'a ruling', updatedAt: '2020-01-01T00:00:00Z' },
    },
  })
  assert.match(r.stdout, /held: a manager is already running \(job mgr1/)
  assert.doesNotMatch(r.stdout, /launched manager/)
  // The hold IS logged — a log that records only what happened cannot answer the
  // question asked of it the morning after, which is why nothing ran.
  assert.match(readFileSync(fleetLog(ws), 'utf8'), /HOLD .* already running/)
})

test('the relaunch floor holds a second launch inside the hour', () => {
  const ws = workspace()
  const recent = new Date(Date.now() - 5 * 60000).toISOString()
  mkdirSync(join(ws, '.claude/session-hub'), { recursive: true })
  writeFileSync(fleetLog(ws), `${recent} LAUNCH some-other-signature — a previous run\n`)
  const { r } = run([], {
    ws,
    jobs: { j1: { name: '👯🤖 W0099 x', state: 'blocked', tempo: 'blocked', needs: 'a ruling', updatedAt: '2020-01-01T00:00:00Z' } },
  })
  assert.match(r.stdout, /held: last launch \d+m ago, floor is 60m/)
})

test('an overrunning manager is reported, and is NOT killed unless the kill is armed', () => {
  const old = new Date(Date.now() - 90 * 60000).toISOString()
  const { r } = run(['--check'], {
    jobs: { mgr1: { name: '🚦🤖 obot-fleet', state: 'working', createdAt: old, updatedAt: old } },
  })
  assert.match(r.stderr, /manager job mgr1 has run \d+m against a 30m budget/)
  assert.doesNotMatch(r.stderr, /SIGTERM/, 'terminating a process is not a default')
})
