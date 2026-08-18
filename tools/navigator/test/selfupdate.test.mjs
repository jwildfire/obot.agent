// Merging is not deploying on this machine, and the three ways that went wrong in two
// days are the three things this file holds down: the checkout that never moved, the
// consumer that was never restarted, and the failure that said nothing.
//
// Requirement jwildfire/obot.roadmap#243, issue jwildfire/obot.agent#186.
//
// The refusals get the most attention here on purpose. A fast-forward that works is
// one path; the guards are seven, they are the difference between an automatic update
// and an automatic loss of somebody's work, and every one of them is a worker's
// uncommitted afternoon.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  CONSUMER_POLICY, QUIET_MS, buildStamp, fastForward, lastLookMs, planFastForward,
  planRestart, readCheckout, recordPath, renderSelfUpdate, restartDashboard, restartEnv,
  selfUpdate,
} from '../selfupdate.mjs'
import { parseNavigatorState } from '../../ops-dashboard/lib/navigator.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'selfupd-'))

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], {
  encoding: 'utf8',
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
}).trim()

/** An origin with one commit, and a clone of it. The clone is what gets updated. */
const pair = () => {
  const root = tmp()
  const origin = path.join(root, 'origin')
  fs.mkdirSync(origin)
  git(origin, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(origin, 'code.txt'), 'one\n')
  git(origin, 'add', '-A')
  git(origin, 'commit', '-qm', 'one')
  const clone = path.join(root, 'clone')
  git(root, 'clone', '-q', origin, clone)
  return { root, origin, clone }
}

const advance = (origin, text) => {
  fs.writeFileSync(path.join(origin, 'code.txt'), text)
  git(origin, 'add', '-A')
  git(origin, 'commit', '-qm', text.trim())
}

// ── The fast-forward ──────────────────────────────────────────────────────────────

test('a clone behind its remote is fast-forwarded, and says how far', () => {
  const { origin, clone } = pair()
  advance(origin, 'two\n')
  advance(origin, 'three\n')
  const r = fastForward(clone)
  assert.equal(r.ok, true)
  assert.equal(r.moved, true)
  assert.equal(r.commits, 2)
  assert.equal(fs.readFileSync(path.join(clone, 'code.txt'), 'utf8'), 'three\n')
})

test('a clone already level with its remote is left alone and still reports', () => {
  const { clone } = pair()
  const r = fastForward(clone)
  assert.equal(r.ok, true)
  assert.equal(r.moved, false)
  assert.equal(r.code, 'current')
  assert.match(r.reason, /already at/)
})

test('untracked files never block — his drafts folder is permanently full of them', () => {
  const { origin, clone } = pair()
  advance(origin, 'two\n')
  fs.writeFileSync(path.join(clone, 'DRAFT_note.md'), 'not committed, not a reason to refuse\n')
  const r = fastForward(clone)
  assert.equal(r.moved, true, 'an untracked file must not stop an update')
  assert.ok(fs.existsSync(path.join(clone, 'DRAFT_note.md')), 'and it must still be there afterwards')
})

test('an uncommitted change to a tracked file refuses, and nothing is stashed or reset', () => {
  const { origin, clone } = pair()
  advance(origin, 'two\n')
  fs.writeFileSync(path.join(clone, 'code.txt'), 'somebody was working here\n')
  const head = git(clone, 'rev-parse', 'HEAD')
  const r = fastForward(clone)
  assert.equal(r.ok, false)
  assert.equal(r.code, 'dirty')
  assert.match(r.reason, /nothing is stashed, reset or forced/)
  assert.equal(git(clone, 'rev-parse', 'HEAD'), head, 'HEAD must not move')
  assert.equal(fs.readFileSync(path.join(clone, 'code.txt'), 'utf8'), 'somebody was working here\n',
    'their work must still be there')
})

test('a diverged branch is refused rather than merged — a merge here could conflict', () => {
  const { origin, clone } = pair()
  advance(origin, 'two\n')
  fs.writeFileSync(path.join(clone, 'mine.txt'), 'local commit\n')
  git(clone, 'add', '-A')
  git(clone, 'commit', '-qm', 'mine')
  const head = git(clone, 'rev-parse', 'HEAD')
  const r = fastForward(clone)
  assert.equal(r.ok, false)
  assert.equal(r.code, 'diverged')
  assert.equal(git(clone, 'rev-parse', 'HEAD'), head)
})

test('a checkout on a feature branch is left alone — somebody is working there', () => {
  const { origin, clone } = pair()
  advance(origin, 'two\n')
  git(clone, 'checkout', '-q', '-b', 'w0038-admiral')
  const r = fastForward(clone)
  assert.equal(r.ok, false)
  assert.equal(r.code, 'not-main')
  assert.match(r.reason, /w0038-admiral/)
})

test('a linked worktree is never moved, even one sitting on main — a worker owns it', () => {
  const { origin, clone } = pair()
  advance(origin, 'two\n')
  // The worktree has to be the one holding `main`, since that is the only case where
  // a fast-forward would otherwise look reasonable. Git allows exactly one worktree on
  // a branch at a time, so the main clone moves off it first.
  git(clone, 'checkout', '-q', '-b', 'parked')
  const wt = path.join(clone, '.claude', 'worktrees', 'w0038')
  git(clone, 'worktree', 'add', '-q', wt, 'main')
  const state = readCheckout(wt)
  assert.equal(state.linked, true)
  assert.equal(state.branch, 'main', 'the case worth guarding is the worktree that IS on main')
  assert.equal(fastForward(wt).code, 'linked-worktree')
})

test('a mid-rebase checkout is left alone', () => {
  const state = { repo: true, root: '/r', linked: false, branch: 'main', wanted: 'main', head: 'a', dirty: [], midOp: ['rebase-merge'] }
  const r = planFastForward(state, { sha: 'b', ancestor: true })
  assert.equal(r.code, 'mid-operation')
  assert.match(r.reason, /rebase/)
})

test('an unreachable remote is a refusal, not a silent success', () => {
  const state = { repo: true, root: '/r', linked: false, branch: 'main', wanted: 'main', remote: 'origin', head: 'a', dirty: [], midOp: [] }
  const r = planFastForward(state, { sha: null })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'no-upstream')
})

test('a directory that is not a repository is a state, not a crash', () => {
  const r = fastForward(tmp())
  assert.equal(r.ok, false)
  assert.equal(r.code, 'no-repo')
})

test('the build stamp names the commit the process loaded, not the one on disk later', () => {
  const { origin, clone } = pair()
  const stamp = buildStamp(clone)
  assert.equal(stamp.sha, git(clone, 'rev-parse', 'HEAD'))
  advance(origin, 'two\n')
  fastForward(clone)
  assert.notEqual(stamp.sha, git(clone, 'rev-parse', 'HEAD'),
    'the checkout moved, and the stamp must still describe the code this run is executing')
})

// ── Who gets restarted ────────────────────────────────────────────────────────────

const live = (over = {}) => ({ state: 'live', pid: 999, port: 7326, site: 'ops-dashboard', ...over })

test('a server on another port is never restarted — that is an agent test instance', () => {
  const r = planRestart({ marker: live({ port: 7399 }), health: null, headSha: 'abc', lastLookMs: 10 * 60000 })
  assert.equal(r.act, 'skip')
  assert.equal(r.code, 'other-port')
})

test('no marker at all means nothing to restart, and it says so', () => {
  const r = planRestart({ marker: { state: 'none' }, health: null, headSha: 'abc', lastLookMs: null })
  assert.equal(r.act, 'skip')
  assert.equal(r.code, 'not-running')
})

test('a request in flight defers the restart — killing it is worse than five more stale minutes', () => {
  const r = planRestart({ marker: live(), health: { inflight: 1, idleMs: 10 * 60000, code: { sha: 'old' } }, headSha: 'new' })
  assert.equal(r.act, 'skip')
  assert.equal(r.code, 'busy')
  assert.match(r.reason, /in flight/)
})

test('a page opened seconds ago defers the restart too', () => {
  const r = planRestart({ marker: live(), health: { inflight: 0, idleMs: 3000, code: { sha: 'old' } }, headSha: 'new' })
  assert.equal(r.act, 'skip')
  assert.equal(r.code, 'busy')
})

test('a quiet server on old code is restarted', () => {
  const r = planRestart({ marker: live(), health: { inflight: 0, idleMs: QUIET_MS + 1000, code: { sha: 'old', short: 'old1234' } }, headSha: 'new' })
  assert.equal(r.act, 'restart')
})

test('a server already serving the checkout is left alone even when quiet', () => {
  const r = planRestart({ marker: live(), health: { inflight: 0, idleMs: 10 * 60000, code: { sha: 'new' } }, headSha: 'new' })
  assert.equal(r.act, 'skip')
  assert.equal(r.code, 'already-current')
})

test('a build with no health endpoint falls back to when he last opened a page', () => {
  const quiet = planRestart({ marker: live(), health: null, headSha: 'new', lastLookMs: QUIET_MS + 60000 })
  assert.equal(quiet.act, 'restart')
  const busy = planRestart({ marker: live(), health: null, headSha: 'new', lastLookMs: 2000 })
  assert.equal(busy.act, 'skip')
  assert.equal(busy.code, 'busy')
})

test('when neither source can say whether it is busy, it is left running and reported', () => {
  const r = planRestart({ marker: live(), health: null, headSha: 'new', lastLookMs: null })
  assert.equal(r.act, 'refuse')
  assert.equal(r.code, 'unknown-quiescence')
  assert.match(r.reason, /left running/)
})

test('a marker whose process is gone means start one — a failed restart must not cost two days', () => {
  const r = planRestart({ marker: { state: 'stale', pid: 5, port: 7326, site: 'ops-dashboard' }, health: null, headSha: 'new', lastLookMs: null })
  assert.equal(r.act, 'start')
})

test('the newest look across every surface is the one that counts', () => {
  const now = new Date('2026-08-17T21:00:00Z')
  const store = { surfaces: { '/': '2026-08-17T20:00:00Z', '/live.html': '2026-08-17T20:59:00Z' } }
  assert.equal(lastLookMs(store, now), 60000)
  assert.equal(lastLookMs({ surfaces: {} }, now), null, 'an empty store is unknown, never "long ago"')
})

test('a dashboard that will not exit is left running rather than killed', () => {
  let spawned = 0
  const r = restartDashboard({
    root: '/repo', workspace: '/ws', pid: 4242,
    isAlive: () => true, kill: () => true, sleep: () => {}, waitMs: 1000,
    spawnFn: () => { spawned += 1; return { pid: 1 } },
  })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'would-not-exit')
  assert.match(r.reason, /rather than killed/)
  assert.equal(spawned, 0, 'a second instance must never be started while the first still holds the port')
})

test('a replacement that never answers is a failure, not a success', () => {
  const root = tmp()
  fs.mkdirSync(path.join(root, 'tools', 'ops-dashboard'), { recursive: true })
  fs.writeFileSync(path.join(root, 'tools', 'ops-dashboard', 'ops-dashboard.mjs'), '// present\n')
  const r = restartDashboard({
    root, workspace: '/ws', pid: null, isAlive: () => false, sleep: () => {}, waitMs: 1000,
    spawnFn: () => ({ pid: 77, unref: () => {} }), probe: () => null,
  })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'no-answer')
  assert.match(r.reason, /DOWN/)
})

test('a replacement that answers reports the commit it is serving', () => {
  const root = tmp()
  fs.mkdirSync(path.join(root, 'tools', 'ops-dashboard'), { recursive: true })
  fs.writeFileSync(path.join(root, 'tools', 'ops-dashboard', 'ops-dashboard.mjs'), '// present\n')
  const r = restartDashboard({
    root, workspace: '/ws', pid: null, isAlive: () => false, sleep: () => {}, waitMs: 1000,
    spawnFn: () => ({ pid: 77, unref: () => {} }),
    probe: (url) => (url.endsWith('/healthz') ? { status: 200, body: JSON.stringify({ code: { short: 'abc1234' } }) } : null),
  })
  assert.equal(r.ok, true)
  assert.equal(r.serving, 'abc1234')
})

// ── The record and the page ───────────────────────────────────────────────────────

test('the record is written on a quiet run too — an absent record reads as a dead sweep', () => {
  const ws = tmp()
  const rec = selfUpdate({
    root: '/repo', workspace: ws, stamp: buildStamp(process.cwd()),
    ff: () => ({ ok: true, code: 'current', moved: false, from: 'a', to: 'a', branch: 'main', reason: 'already at `origin/main`' }),
    marker: { state: 'none' }, health: () => null, restart: () => { throw new Error('must not restart') },
  })
  assert.equal(rec.checkout.code, 'current')
  const onDisk = JSON.parse(fs.readFileSync(recordPath(ws), 'utf8'))
  assert.equal(onDisk.checkout.code, 'current')
  assert.ok(onDisk.at, 'the record must carry when it ran, or the page cannot tell stale from quiet')
})

test('a refused update reaches the page as an alarm, not as grey text', () => {
  const md = `# navigator\nswept: 2026-08-17 21:00 (cadence 5 min)\n\n${renderSelfUpdate({
    sweep: { short: 'abc1234', startedAt: new Date().toISOString() },
    checkout: { ok: false, code: 'dirty', branch: 'main', reason: 'the checkout has uncommitted changes to 2 tracked files — nothing is stashed, reset or forced' },
    consumers: [],
  })}`
  const parsed = parseNavigatorState(md, new Date('2026-08-17T21:01:00'))
  const section = parsed.sections.find((s) => s.title === 'Checkout')
  assert.ok(section, 'the section must be found under its own heading')
  const verdict = section.items.find((i) => i.alarm)
  assert.ok(verdict, 'a refusal must render as an alarm — a bullet never does, only a plain line')
  assert.match(verdict.text, /AUTO UPDATE FAILED/)
})

test('a failed restart is an alarm of its own', () => {
  const md = `# navigator\nswept: 2026-08-17 21:00 (cadence 5 min)\n\n${renderSelfUpdate({
    sweep: { short: 'abc1234', startedAt: new Date().toISOString() },
    checkout: { ok: true, code: 'moved', moved: true, branch: 'main', to: 'deadbee', reason: 'fast-forwarded 2 commits to `origin/main`' },
    consumers: [{ id: 'ops-dashboard', act: 'restart', ok: false, code: 'no-answer', reason: 'nothing answered on http://127.0.0.1:7326/ — the page is DOWN' }],
  })}`
  const parsed = parseNavigatorState(md, new Date('2026-08-17T21:01:00'))
  const section = parsed.sections.find((s) => s.title === 'Checkout')
  assert.ok(section.items.some((i) => i.alarm && /DASHBOARD RESTART FAILED/.test(i.text)))
})

test('a healthy run still prints — a check that only speaks on failure looks like a dead one', () => {
  const out = renderSelfUpdate({
    sweep: { short: 'abc1234', startedAt: new Date().toISOString() },
    checkout: { ok: true, code: 'current', moved: false, branch: 'main', to: 'abc1234deadbeef', reason: 'already at `origin/main`' },
    consumers: [{ id: 'ops-dashboard', act: 'skip', ok: true, code: 'already-current', reason: 'the running dashboard is already serving `abc1234`' }],
  })
  assert.match(out, /checkout: `abc1234` on `main`/)
  assert.match(out, /sweep: `abc1234`/)
  assert.doesNotMatch(out, /FAILED|BROKEN/)
})

test('the sessions that are never restarted are named on the page, not left implied', () => {
  const out = renderSelfUpdate({ sweep: null, checkout: { ok: true, code: 'current', branch: 'main', to: 'a' }, consumers: [] })
  assert.match(out, /never restarted:/)
  assert.match(out, /conversation/)
  assert.ok(CONSUMER_POLICY.never.length, 'the tier must exist as data, so the page and the code cannot drift')
})

test('a replacement is not quietly less capable than what it replaced', () => {
  // launchd gives the sweep a three-entry PATH; the dashboard it restarts was started
  // from a shell. A page that renders while its `gh` refresh fails looks exactly like
  // a page that is fine, which is this requirement's own failure in a different hat.
  const env = restartEnv({ PATH: '/nvm/bin:/usr/bin:/bin', HOME: '/Users/t' })
  const parts = env.PATH.split(':')
  assert.equal(parts[0], '/nvm/bin', "the caller's own resolution order must still win")
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', '/Users/t/.local/bin']) {
    assert.ok(parts.includes(dir), `${dir} must be reachable from a restarted dashboard`)
  }
  assert.equal(new Set(parts).size, parts.length, 'a PATH that grows a duplicate every restart is a leak')
})

test('the replacement is started with that environment, not the sweep bare', () => {
  const root = tmp()
  fs.mkdirSync(path.join(root, 'tools', 'ops-dashboard'), { recursive: true })
  fs.writeFileSync(path.join(root, 'tools', 'ops-dashboard', 'ops-dashboard.mjs'), '// present\n')
  let opts = null
  restartDashboard({
    root, workspace: '/ws', pid: null, isAlive: () => false, sleep: () => {}, waitMs: 500,
    spawnFn: (_cmd, _args, o) => { opts = o; return { pid: 7, unref: () => {} } },
    probe: () => ({ status: 200, body: '{}' }),
  })
  assert.ok(opts?.env?.PATH, 'the spawn must carry an explicit PATH')
  assert.ok(opts.env.PATH.includes('/usr/bin'))
})

test('an unreadable checkout restarts nothing — there is no commit to restart onto', () => {
  const r = planRestart({ marker: live(), health: { inflight: 0, idleMs: 10 * 60000, code: { sha: 'old' } }, headSha: null })
  assert.equal(r.act, 'skip')
  assert.equal(r.code, 'unknown-head')
})
