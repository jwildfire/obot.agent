// The admiral launcher — the singleton rule, the launch flags, and the guarantee
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
//
// THIS SUITE USED TO CREATE REAL SESSIONS (obot.agent#188). Several cases below run
// the launcher with no dry-run flag, so `MODE` stays `run` and the launch branch is
// reachable — and it was reached, four times on the evening of 2026-08-17, each time
// producing a genuine `claude --bg -n '⚓🤖 obot-admiral'` in the machine's real job
// ledger. Every consumer that asks "is this the admiral" asked it of the NAME, so a
// fixture was pinned into the admiral's slot on the Agents tab as RUNNING, two of
// them put **ADMIRAL KILLED ON A BREACHED BUDGET** on @jwildfire's dashboard, the
// singleton held every real launch behind them, and the wake raised four WAITING
// detections. Two agents diagnosed a runaway launcher off that row.
//
// So the cases keep their coverage and lose the side effect, two ways at once:
//
//   OBOT_ADMIRAL_SPAWN=0 in `run()` — the launcher takes the whole launch branch,
//     writes the brief, records the decision, and does not spawn. This is the
//     documented switch, and `guards` below holds every case to it.
//   A stub `claude` and `gh` on PATH — so a case that somehow reached a spawn could
//     still not create a session, could not aim a SIGTERM at a real pid, and cannot
//     make the trigger depend on whatever is open on GitHub this minute.
//
// The second matters as much as the first: a rule the suite must remember to obey is
// a rule the next case will forget.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { launches, openPR, settle, stubHarness } from './harness-stub.mjs'
import { ALARM_RE } from '../../tools/ops-dashboard/lib/navigator.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LAUNCHER = join(REPO, 'scripts', 'obot-admiral')
const STUB = stubHarness()

const jobsDir = (jobs) => {
  const root = mkdtempSync(join(tmpdir(), 'admiraljobs-'))
  for (const [id, state] of Object.entries(jobs)) {
    mkdirSync(join(root, id), { recursive: true })
    writeFileSync(join(root, id, 'state.json'), JSON.stringify(state))
  }
  return root
}

const workspace = () => {
  const root = mkdtempSync(join(tmpdir(), 'admiralws-'))
  mkdirSync(join(root, '.claude/session-hub/cache'), { recursive: true })
  return root
}

// The environment every case runs in. Held in one place and asserted on by
// `the suite cannot create a session, whatever a case forgets` below, so a case
// added later inherits the guarantee rather than having to remember it.
const SAFE_ENV = {
  // The launcher decides, records, and does not spawn.
  OBOT_ADMIRAL_SPAWN: '0',
  // And could not reach the real binaries if it tried.
  PATH: `${STUB.bin}:${process.env.PATH}`,
  // The open-PR condition is a fixture like everything else. Left live, every
  // assertion that the trigger did NOT fire was one idle operational pull request
  // away from failing, on a repo this suite does not control.
  FAKE_PR_LIST: '[]',
}

const run = (args = [], { jobs = {}, ws = workspace(), env = {}, prs = null } = {}) => {
  const log = STUB.nextLog()
  return {
    ws,
    log,
    r: spawnSync(LAUNCHER, args, {
      env: {
        ...process.env,
        ...SAFE_ENV,
        OBOT_STUB_LOG: log,
        OBOT_JOBS_DIR: jobsDir(jobs),
        OBOT_WORKSPACE: ws,
        ...(prs ? { FAKE_PR_LIST: JSON.stringify(prs) } : {}),
        ...env,
      },
      encoding: 'utf8',
      timeout: 120000,
    }),
  }
}

// A worker whose block has held far past the acting bar — the cheapest condition
// that makes the trigger fire, and the one the launch cases below are built on.
const stuckWorker = (id = 'j1') => ({
  [id]: {
    name: '👯🤖 W0099 x', state: 'blocked', tempo: 'blocked',
    needs: 'a ruling', updatedAt: '2020-01-01T00:00:00Z',
  },
})

// The launch log under the name it carries since obot.agent#182. Left pointing at
// the old fleet.log, every "writes NOTHING" assertion below would go on passing
// against a file the launcher no longer writes — silent success, which is the shape
// this suite exists to catch.
const admiralLog = (ws) => join(ws, '.claude/session-hub/admiral.log')

test('preflight prints the launch command, with every flag the design named', () => {
  const { r } = run(['--preflight-only'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /--bg/)
  assert.match(r.stdout, /--permission-mode auto/)
  assert.match(r.stdout, /--model opus/)
  assert.match(r.stdout, /\/s-admiral /)
  assert.match(r.stdout, /⚓🤖 obot-admiral/)
})

test('the admiral launches UNBRIDGED — dropping the flag alone would be a no-op', () => {
  // Remote Control is for the roles he talks to from a phone. The admiral talks to
  // nobody. The flag is OR-ed with the global setting, so it must be overridden
  // explicitly rather than merely omitted (obot.agent#116/#117).
  const { r } = run(['--preflight-only'])
  assert.match(r.stdout, /remoteControlAtStartup":false/)
  assert.doesNotMatch(r.stdout, /--remote-control/)
})

test('the session name is stable across launches — a pinned role cannot carry a slug', () => {
  // @jwildfire, 2026-08-17: pin prime, nav and fleet by default. The last of those
  // is the admiral since obot.agent#182, later the same day. A pinned row whose name
  // changes every run cannot be pinned.
  const a = run(['--preflight-only']).r.stdout
  const b = run(['--preflight-only']).r.stdout
  const name = (s) => /-n '([^']+)'/.exec(s)?.[1]
  assert.equal(name(a), name(b))
  assert.equal(name(a), '⚓🤖 obot-admiral')
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
  assert.match(r.stdout, /## Admiral/)
  assert.equal(existsSync(admiralLog(ws)), false, 'a dry run must not append to the admiral log')
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
  assert.match(r.stdout, /an empty fleet never launches an admiral/)
  assert.equal(existsSync(admiralLog(ws)), false)
})

test('--json is a reading, never an action', () => {
  const { ws, r } = run(['--json'], { jobs: {} })
  const out = JSON.parse(r.stdout)
  assert.equal(out.trigger.fired, false)
  assert.deepEqual(out.trigger.operational, ['jwildfire/obot.agent', 'jwildfire/obot.roadmap'])
  assert.equal(existsSync(admiralLog(ws)), false)
})

test('an unreadable policy is ADMIRAL TRIGGER BROKEN, never a quiet fleet', () => {
  // The failure direction that matters, and the bug this actually caught: the first
  // draft read branch roles from a key the policy file spells differently, found no
  // operational repo, and had to be prevented from reporting that as nothing to do.
  // Silent success is this house's recurring defect.
  const { ws, r } = run(['--check'], { env: { OBOT_ADMIRAL_POLICY: '/nonexistent/policy.json' } })
  assert.match(r.stdout, /\*\*ADMIRAL TRIGGER BROKEN\*\*/)
  assert.match(r.stdout, /this is not a quiet fleet/)
  assert.doesNotMatch(r.stdout, /nothing to act on/)
  assert.equal(existsSync(admiralLog(ws)), false)
})

test('a policy with no OPERATIONAL repo is broken too, not clean', () => {
  // Distinct from unreadable: the file parses, and every lane in it is clinical. An
  // admiral must never be launched for those, and reporting "clean" would hide that
  // the operational lanes went unread.
  const ws = workspace()
  const p = join(ws, 'clinical-only.json')
  writeFileSync(p, JSON.stringify({ repos: {
    'jwildfire/gsm.safety': { profile: 'auto', class: 'clinical', branches: { integration: 'dev' } },
  } }))
  const { r } = run(['--check'], { ws, env: { OBOT_ADMIRAL_POLICY: p } })
  assert.match(r.stdout, /\*\*ADMIRAL TRIGGER BROKEN\*\*/)
  assert.doesNotMatch(r.stdout, /nothing to act on/)
})

test('an unknown argument is refused rather than silently ignored', () => {
  const { r } = run(['--merge-everything'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /unknown argument/)
})

test('singleton: a live admiral holds the launch and names the job holding it', () => {
  const { ws, r } = run([], {
    jobs: {
      mgr1: { name: '⚓🤖 obot-admiral', state: 'working', updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
      j1: { name: '👯🤖 W0099 x', state: 'blocked', tempo: 'blocked', needs: 'a ruling', updatedAt: '2020-01-01T00:00:00Z' },
    },
  })
  assert.match(r.stdout, /held: an admiral is already running \(job mgr1/)
  assert.doesNotMatch(r.stdout, /launched admiral/)
  // The hold IS logged — a log that records only what happened cannot answer the
  // question asked of it the morning after, which is why nothing ran.
  assert.match(readFileSync(admiralLog(ws), 'utf8'), /HOLD .* already running/)
})

test('the relaunch floor holds a second launch inside the hour', () => {
  const ws = workspace()
  const recent = new Date(Date.now() - 5 * 60000).toISOString()
  mkdirSync(join(ws, '.claude/session-hub'), { recursive: true })
  writeFileSync(admiralLog(ws), `${recent} LAUNCH some-other-signature — a previous run\n`)
  const { r } = run([], {
    ws,
    jobs: { j1: { name: '👯🤖 W0099 x', state: 'blocked', tempo: 'blocked', needs: 'a ruling', updatedAt: '2020-01-01T00:00:00Z' } },
  })
  assert.match(r.stdout, /held: last launch \d+m ago, floor is 60m/)
})

test('an overrunning admiral is reported, and a DRY RUN never kills', () => {
  const old = new Date(Date.now() - 90 * 60000).toISOString()
  const { r } = run(['--check'], {
    jobs: { mgr1: { name: '⚓🤖 obot-admiral', state: 'working', createdAt: old, updatedAt: old } },
  })
  assert.match(r.stderr, /admiral job mgr1 has run \d+m against a 30m budget/)
  assert.doesNotMatch(r.stderr, /SIGTERM/, '--check reports; it never acts')
})

test('the hard ceiling is ARMED by default and OBOT_ADMIRAL_KILL=0 disarms it', () => {
  // The Navigator's call, 2026-08-17: a kill that ships disarmed is documentation.
  // The job id here matches nothing in `claude agents`, so the stop path runs and
  // reports a detection failure rather than terminating anything real.
  const old = new Date(Date.now() - 90 * 60000).toISOString()
  const mgr = { mgr1: { name: '⚓🤖 obot-admiral', state: 'working', createdAt: old, updatedAt: old } }
  const armed = run([], { jobs: mgr })
  assert.match(armed.r.stderr, /overrunning admiral mgr1/, 'the ceiling fired')
  const disarmed = run([], { jobs: mgr, env: { OBOT_ADMIRAL_KILL: '0' } })
  assert.doesNotMatch(disarmed.r.stderr, /STOP|KILL/, 'and disarmed, it does not')
})

// ---- a stop this house reports is a stop it confirmed (obot.roadmap#251) ------

test('the no-pid path never says killed — not in the log, the section, or the console', () => {
  // The named case, end to end. `.claude/session-hub/admiral.log` carried six lines
  // reading `killed overrunning admiral <id>: no pid found — reported only` on the
  // night of 2026-08-18: the success wording emitted on the branch that admits
  // nothing happened, in the file that answers what the guard did.
  const old = new Date(Date.now() - 90 * 60000).toISOString()
  const ws = workspace()
  const { r } = run([], {
    ws,
    jobs: { mgr1: { name: '⚓🤖 obot-admiral', state: 'working', createdAt: old, updatedAt: old, cwd: ws } },
    env: { FAKE_AGENTS_JSON: '[]' },
  })
  const log = readFileSync(admiralLog(ws), 'utf8')

  assert.doesNotMatch(r.stderr, /killed/i, 'the console never says it')
  assert.doesNotMatch(log, /killed/i, 'nor the record')
  assert.doesNotMatch(r.stdout, /killed/i, 'nor the section that reaches his page')
  assert.match(log, /KILL-UNCONFIRMED mgr1 — /, 'the record says what it actually was')
  assert.match(r.stdout, /ADMIRAL PID RESOLUTION FAILED/, 'and it reaches the page as a finding')
  assert.match(r.stdout, ALARM_RE)
})

test('a stop is never reported against a pid running something else', () => {
  // Clause 4. The ledger names a pid; whatever answers to it here is this test
  // process's own parent — certainly not the admiral. Signalling it would terminate
  // an unrelated program and report a stop of a session nothing touched.
  const old = new Date(Date.now() - 90 * 60000).toISOString()
  const ws = workspace()
  const { r } = run([], {
    ws,
    jobs: { mgr1: { name: '⚓🤖 obot-admiral', state: 'working', createdAt: old, updatedAt: old, cwd: ws } },
    env: {
      FAKE_AGENTS_JSON: JSON.stringify([
        { sessionId: 'mgr1-0000-0000-0000-000000000000', name: '⚓🤖 obot-admiral', pid: 1 },
      ]),
    },
  })
  // pid 1 is launchd on this platform: alive, signallable by nobody here, and about
  // as far from a claude session host as a pid can get.
  assert.doesNotMatch(r.stderr, /killed/i)
  assert.match(readFileSync(admiralLog(ws), 'utf8'), /KILL-UNCONFIRMED mgr1/)
  assert.match(r.stdout, /ADMIRAL PID RESOLUTION FAILED/)
})

test('the repeat is carried into the record, so a stop that keeps failing says so', () => {
  // Session 1cc6cc32 was recorded as killed five times in twenty-one minutes.
  // Nothing read the record back, so the second attempt knew nothing the first did.
  const old = new Date(Date.now() - 90 * 60000).toISOString()
  const ws = workspace()
  const jobs = { mgr1: { name: '⚓🤖 obot-admiral', state: 'working', createdAt: old, updatedAt: old, cwd: ws } }
  run([], { ws, jobs, env: { FAKE_AGENTS_JSON: '[]' } })
  const second = run([], { ws, jobs, env: { FAKE_AGENTS_JSON: '[]' } })
  assert.match(second.r.stdout, /1 earlier attempt/, 'the second run knows about the first')
  assert.doesNotMatch(readFileSync(admiralLog(ws), 'utf8'), /killed/i)
})

// ---- the spawn switch: the launch branch, without the launch -----------------

test('the launch branch is REACHED and nothing is spawned', () => {
  // The property the suite could not previously hold, because holding it meant
  // reaching the branch that creates a session. With the switch the branch runs in
  // full — brief written, decision recorded — and the spawn is the only thing
  // missing. A test that avoided the branch instead would prove the opposite of
  // what is wanted: that the launch path is never exercised.
  const { ws, r, log } = run([], { jobs: stuckWorker() })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stderr, /SPAWN DISARMED/, 'it says it did not launch')
  assert.equal(launches(log).length, 0, 'no background session was started')
  assert.equal(r.stderr.includes('--bg'), true, 'and it still says what it would have run')
  assert.equal(existsSync(join(ws, '.claude/session-hub/cache/admiral-brief.json')), true,
    'the brief is still written — the decision ran in full')
})

test('a disarmed launch is an ALARM on his page, never a quiet hold', () => {
  // An env var that silently turned the launcher off would be the worst possible
  // shape of this fix: the section would read as a launcher that considered the
  // fleet and declined, which is exactly what a working one says. So it is spelled
  // to match the dashboard's alarm regex — ALL-CAPS, no punctuation between the
  // asterisks, keyed on DOWN (tools/ops-dashboard/lib/navigator.mjs).
  const { r } = run([], { jobs: stuckWorker() })
  assert.match(r.stdout, /\*\*ADMIRAL LAUNCH DOWN\*\*/)
  assert.match(r.stdout, /OBOT_ADMIRAL_SPAWN=0/, 'and it names the reason, not just the symptom')
})

test('a stubbed launch does not arm the relaunch floor', () => {
  // The floors are read back out of the log, so a stub that wrote LAUNCH would hold
  // the next REAL launch for an hour on the strength of a launch that never
  // happened. STUB is its own word for that reason, and `parseAdmiralLog` reads
  // LAUNCH and HOLD only.
  const { ws, r } = run([], { jobs: stuckWorker() })
  assert.equal(r.status, 0, r.stderr)
  const log = readFileSync(admiralLog(ws), 'utf8')
  assert.match(log, /^\S+ STUB /m)
  assert.doesNotMatch(log, /^\S+ LAUNCH /m, 'nothing launched, so nothing may say LAUNCH')
})

test('the suite cannot create a session, whatever a case forgets', async () => {
  // The guard. `run()` is the only door into the launcher in this file, and this
  // holds it shut: both halves are set for every case, so a case added later
  // inherits them without knowing they exist.
  assert.equal(SAFE_ENV.OBOT_ADMIRAL_SPAWN, '0', 'the launcher is disarmed')
  assert.ok(SAFE_ENV.PATH.startsWith(STUB.bin), 'and the real claude is not on PATH first')
  const { log } = run(['--check'], { jobs: stuckWorker() })
  assert.deepEqual(await settle(log), [], 'and nothing appeared once the dust settled')
})

test('with the switch unset the launcher WOULD spawn — the disarm is not the default', async () => {
  // The other direction, and the one that decides whether any of this is load
  // bearing. A switch that was quietly on in production would disable the admiral
  // exactly as thoroughly as a runaway one launches it, and the failure would look
  // like a quiet fleet. Safe to run here only because `claude` on PATH is the stub.
  const { r, log } = run([], { jobs: stuckWorker(), env: { OBOT_ADMIRAL_SPAWN: '' } })
  assert.equal(r.status, 0, r.stderr)
  // The spawn is DETACHED, so its record arrives after the launcher has exited —
  // reading the log straight after `spawnSync` measures the race, not the launch.
  const got = await settle(log, { want: 1 })
  assert.equal(got.length, 1, 'the launch branch really does spawn when armed')
  assert.match(got[0], /--bg .*-n ⚓🤖 obot-admiral/)
  assert.doesNotMatch(r.stdout, /ADMIRAL LAUNCH DOWN/)
})

// ---- a session wearing the role's name from somewhere else -------------------

test('a session running outside the workspace does not hold the singleton', () => {
  // obot.agent#188 itself. Four fixture-spawned admirals sat in the real job ledger
  // with `cwd` under the system temp directory, and the singleton — which asks the
  // name — held every real launch behind them. The bar is where a session RAN, not
  // what it is called, so the next fixture under a different name is caught by the
  // same rule with nothing added to it.
  const foreign = new Date().toISOString()
  const { r } = run([], {
    jobs: {
      ...stuckWorker(),
      mgr1: {
        name: '⚓🤖 obot-admiral', state: 'working', createdAt: foreign, updatedAt: foreign,
        cwd: '/var/folders/_9/T/fleetws-skwFFQ',
      },
    },
  })
  assert.doesNotMatch(r.stdout, /an admiral is already running/)
  assert.match(r.stderr, /SPAWN DISARMED/, 'it got as far as deciding to launch')
})

test('and it is never killed on a budget it was never given', () => {
  // The two false **ADMIRAL KILLED ON A BREACHED BUDGET** headlines that reached his
  // dashboard on 2026-08-18, and the real SIGTERM that went with one of them.
  const old = new Date(Date.now() - 90 * 60000).toISOString()
  const { r } = run([], {
    jobs: {
      mgr1: {
        name: '⚓🤖 obot-admiral', state: 'working', createdAt: old, updatedAt: old,
        cwd: '/var/folders/_9/T/fleetws-skwFFQ',
      },
    },
  })
  assert.doesNotMatch(r.stdout, /BREACHED|ADMIRAL KILLED/)
  assert.doesNotMatch(r.stderr, /SIGTERM/)
})

test('but the suppression is SAID, because a silent one is the same defect', () => {
  const { r } = run([], {
    jobs: {
      mgr1: {
        name: '⚓🤖 obot-admiral', state: 'working', createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), cwd: '/var/folders/_9/T/fleetws-skwFFQ',
      },
    },
  })
  assert.match(r.stdout, /not this workspace/)
  assert.match(r.stdout, /fleetws-skwFFQ/, 'and names where it actually ran')
})

test('a session inside the workspace is the role, exactly as before', () => {
  // The guard must not be able to make a REAL admiral invisible. Same fixture as the
  // singleton case above, with the one field that decides it pointed at the
  // workspace the launcher was given.
  const ws = workspace()
  const now = new Date().toISOString()
  const { r } = run([], {
    ws,
    jobs: { ...stuckWorker(), mgr1: { name: '⚓🤖 obot-admiral', state: 'working', createdAt: now, updatedAt: now, cwd: ws } },
  })
  assert.match(r.stdout, /held: an admiral is already running \(job mgr1/)
})

// ---- the kill join ----------------------------------------------------------

test('the kill joins on the session id, never on the role name', () => {
  // The fallback that made this dangerous: `killAdmiral` matched a row in
  // `claude agents` whose NAME equalled the job's, so with a fixture in the ledger
  // wearing `⚓🤖 obot-admiral` the ceiling could aim a SIGTERM at the real admiral
  // instead. The stub returns a live session under that name with a pid this test
  // would notice being used; the job id matches nothing, so nothing is killed.
  const old = new Date(Date.now() - 90 * 60000).toISOString()
  const ws = workspace()
  const { r } = run([], {
    ws,
    jobs: { mgr1: { name: '⚓🤖 obot-admiral', state: 'working', createdAt: old, updatedAt: old, cwd: ws } },
    env: {
      FAKE_AGENTS_JSON: JSON.stringify([
        { sessionId: '9f9f9f9f-0000-0000-0000-000000000000', name: '⚓🤖 obot-admiral', pid: 999999 },
      ]),
    },
  })
  assert.match(r.stderr, /overrunning admiral mgr1/)
  assert.doesNotMatch(r.stderr, /999999/, 'a name is not an identity, so that pid was never resolved')
  assert.doesNotMatch(r.stderr, /killed/i, 'and a session it could not find was not killed')
})

test('the stop path IS reached when the session id matches, and reports what it found', () => {
  // The other half, so the join is proved rather than merely narrowed: a real overrun
  // still reaches the stop path. The pid here is in the ledger and not in the process
  // table, which is a stale record — reported as one, and nothing is signalled.
  const old = new Date(Date.now() - 90 * 60000).toISOString()
  const ws = workspace()
  const { r } = run([], {
    ws,
    jobs: { mgr1: { name: '⚓🤖 obot-admiral', state: 'working', createdAt: old, updatedAt: old, cwd: ws } },
    env: {
      FAKE_AGENTS_JSON: JSON.stringify([
        { sessionId: 'mgr1-0000-0000-0000-000000000000', name: '⚓🤖 obot-admiral', pid: 2147483000 },
      ]),
    },
  })
  assert.match(r.stderr, /2147483000/, 'the join found the row')
  assert.match(readFileSync(admiralLog(ws), 'utf8'), /KILL-UNCONFIRMED mgr1 — the ledger names pid 2147483000/)
  assert.doesNotMatch(r.stderr, /killed/i)
})

// ---- the pull-request condition, now a fixture ------------------------------

test('an idle operational pull request fires the trigger on its own', () => {
  // Previously unprovable without an idle PR happening to be open on GitHub. It is
  // the condition most likely to launch an admiral in practice, so it is worth
  // holding rather than hoping.
  const { r } = run(['--check'], { jobs: {}, prs: [openPR({ number: 42, minsIdle: 600 })] })
  // The stub answers for both operational repos, so one fixture PR is two
  // conditions — which is itself the shape the launcher sees in production.
  assert.match(r.stdout, /obot\.agent#42 has not moved in \d+m on main/)
  assert.match(r.stdout, /obot\.roadmap#42 has not moved in \d+m on main/)
  assert.match(r.stdout, /2 idle operational PR/)
})

test('a repo that failed to list is named, never counted as empty', () => {
  const { r } = run(['--check'], { jobs: {}, env: { FAKE_PR_LIST_FAIL: '1' } })
  assert.match(r.stdout, /unread: jwildfire\/obot\.agent/)
})
