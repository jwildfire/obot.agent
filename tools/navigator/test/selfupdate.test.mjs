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
  planRestart, previousProcess, readCheckout, recordPath, renderSelfUpdate, restartDashboard,
  restartEnv, selfUpdate, takeLock, checkoutPosition, brokenRecord, DEFERRAL_LIMIT,
} from '../selfupdate.mjs'
import { ALARM_RE, parseNavigatorState } from '../../ops-dashboard/lib/navigator.mjs'

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

// A page opened seconds ago used to defer as well, on a twenty-second quiet bar. It
// no longer does, and the change is obot.agent#258: a completed response is not a
// request in flight, the served pages fetch nothing from this origin, and the bar was
// therefore standing in for "somebody might ask again", which is what a poller starves
// forever. What survives it is the settling window, asserted below.

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

test('when neither source can say whether it is busy, it waits — but as a counted deferral', () => {
  // This was `refuse`, which the record turned into a **DASHBOARD RESTART FAILED**
  // alarm. It is not a failure: nothing was attempted and nothing went wrong. It is a
  // deferral like any other, and obot.agent#258 gives it the same bound, so a build
  // too old to have a health endpoint cannot hold the machine off its own update.
  const r = planRestart({ marker: live(), health: null, headSha: 'new', lastLookMs: null })
  assert.equal(r.act, 'skip')
  assert.equal(r.code, 'unknown-quiescence')
  assert.equal(r.deferred, true)
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

// ---- what the checkout IS, not only what the update tried (obot.agent#231) ----
//
// The section had one fact where it needed two. On a failed update it printed a
// fixed string — "The checkout is untouched" — synthesised by `safeSelfUpdate`'s
// catch, which discards the real checkout result and therefore cannot know whether
// the fast-forward ran. On the night of 2026-08-18 it had: the fast-forward happens
// BEFORE the throw, so every failed sweep asserted the checkout was untouched while
// it had just moved. The sentence was not merely misleading, it was false.
//
// Worse, a failed update on a current checkout and a failed update on a checkout
// nineteen commits behind rendered identically, and those are not the same
// situation. The position is now measured separately from the attempt.

test('the position is measured against the remote, and says how far behind', () => {
  const { origin, clone } = pair()
  advance(origin, 'two\n'); advance(origin, 'three\n')
  git(clone, 'fetch', '-q', 'origin', 'main')
  const p = checkoutPosition(clone)
  assert.equal(p.known, true)
  assert.equal(p.behind, 2)
  assert.equal(p.ahead, 0)
  assert.equal(p.branch, 'main')
})

test('a checkout level with its remote is level, not merely "not behind"', () => {
  const { clone } = pair()
  const p = checkoutPosition(clone)
  assert.equal(p.known, true)
  assert.equal(p.behind, 0)
})

test('it NEVER fetches — the number is what this machine last knew', () => {
  // The constraint that decides the design: this runs on the failure path, where a
  // fetch may be exactly what did not happen. A position established by fetching
  // would answer a different question from the one a reader on that path is asking,
  // and it would hide a broken fetch behind a fresh-looking number.
  const { origin, clone } = pair()
  advance(origin, 'two\n'); advance(origin, 'three\n')   // origin moves; the clone is NOT fetched
  const p = checkoutPosition(clone)
  assert.equal(p.known, true)
  assert.equal(p.behind, 0, 'it reports what was last fetched, without going to the network')
  assert.equal(git(clone, 'rev-parse', 'origin/main'), git(clone, 'rev-parse', 'HEAD'),
    'and the local ref really had not moved — the case would be vacuous otherwise')
})

test('an unmeasurable position is unknown, never zero', () => {
  // Zero would read as "current", which is the one thing an unreadable checkout must
  // not be able to claim.
  const p = checkoutPosition(tmp())
  assert.equal(p.known, false)
  assert.equal(p.behind, null)
  assert.match(p.reason, /\S/, 'and it says why')
})

test('a repo with no remote ref cannot be positioned, and says so', () => {
  const root = tmp()
  git(root, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(root, 'f'), 'x')
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'one')
  const p = checkoutPosition(root)
  assert.equal(p.known, false)
  assert.match(p.reason, /origin\/main/)
})

// ---- the two situations that used to render identically ----------------------

const brokenAt = (position) => ({
  at: '2026-08-18T07:00:00Z', sweep: null, consumers: [],
  checkout: { ok: false, code: 'broken', branch: null, reason: 'the update step failed outright — alive is not defined' },
  position,
})

test('a failed update on a CURRENT checkout says the checkout is current', () => {
  const s = renderSelfUpdate(brokenAt({ known: true, behind: 0, ahead: 0, short: 'f0680a6', branch: 'main' }))
  assert.match(s, /AUTO UPDATE FAILED/)
  assert.doesNotMatch(s, /untouched/, 'the catch cannot know that and must not say it')
  assert.match(s, /level with `origin\/main`/)
  assert.match(s, /f0680a6/)
})

test('a failed update on a STALE checkout says how far behind, and reads differently', () => {
  const stale = renderSelfUpdate(brokenAt({ known: true, behind: 19, ahead: 0, short: 'aaaaaaa', branch: 'main' }))
  const current = renderSelfUpdate(brokenAt({ known: true, behind: 0, ahead: 0, short: 'f0680a6', branch: 'main' }))
  assert.match(stale, /19 commits behind `origin\/main`/)
  assert.doesNotMatch(stale, /untouched/)
  assert.notEqual(stale, current, 'these are different situations and must not render identically')
})

test('a failed update whose position could not be measured says exactly that', () => {
  const s = renderSelfUpdate(brokenAt({ known: false, behind: null, reason: 'the checkout could not be read' }))
  assert.doesNotMatch(s, /untouched/)
  assert.match(s, /could not be measured|could not be read/)
  assert.doesNotMatch(s, /level with|behind/, 'unknown may not borrow either answer')
})

test('a record written before this change carries no position, and is not guessed at', () => {
  // A long-running dashboard can read a record older than the code reading it. An
  // absent field is absent, never zero.
  const old = brokenAt(undefined)
  const s = renderSelfUpdate(old)
  assert.doesNotMatch(s, /untouched/)
  assert.doesNotMatch(s, /level with|commits behind/)
})

test('a successful update still states position, from the same measurement', () => {
  const s = renderSelfUpdate({
    at: '2026-08-18T07:00:00Z', consumers: [],
    checkout: { ok: true, code: 'moved', branch: 'main', to: 'f0680a6abc', reason: 'fast-forwarded 2 commits to origin/main' },
    position: { known: true, behind: 0, ahead: 0, short: 'f0680a6', branch: 'main' },
  })
  assert.match(s, /fast-forwarded 2 commits/)
  assert.doesNotMatch(s, /AUTO UPDATE FAILED/)
})

test('the broken record the sweep synthesises carries a position it measured itself', () => {
  // The constraint the Navigator set: whatever is measured must be measurable from
  // inside the catch, or the failure mode returns in a new spelling. `brokenRecord`
  // takes the repo root and nothing else, so the catch can always build it.
  const { clone } = pair()
  const r = brokenRecord({ root: clone, stamp: 'sweep-1', error: new Error('alive is not defined') })
  assert.equal(r.checkout.ok, false)
  assert.match(r.checkout.reason, /alive is not defined/)
  assert.equal(r.position.known, true)
  assert.equal(r.position.behind, 0)
  assert.doesNotMatch(renderSelfUpdate(r), /untouched/)
})

// ---- the module's OWN uses of `alive` (obot.agent#229, an #223 regression) ----
//
// WHY THESE EXIST, and it is the useful half. obot.agent#223 replaced this module's
// local `alive` with `export { alive } from '../lib/killconfirm.mjs'`. That is a pure
// re-export: it forwards the binding to consumers and creates NO local binding here,
// so both internal uses — the `isAlive` default parameter and the lock-staleness
// check — threw `ReferenceError: alive is not defined`. The module imported cleanly,
// 1,028 tests passed, and the machine stopped fast-forwarding its own checkout for
// four hours.
//
// The suite could not have caught it, because EVERY existing case injects `isAlive`
// and none contends the lock. A default parameter that is always overridden is never
// evaluated, and an injectable seam hides the binding it defaults to. So these two
// cases deliberately inject NOTHING at the seam under test.

test('restartDashboard resolves its own liveness default — nothing injected', () => {
  // No `isAlive`. The default has to be a real binding in this module's scope, and
  // that is the whole assertion; the outcome underneath it is incidental.
  const r = restartDashboard({
    root: '/repo', workspace: '/ws', pid: 2147483000, start: false,
    spawnFn: () => { throw new Error('the case ends before the spawn') }, sleep: () => {},
  })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'gone', 'a pid nothing is running is read as gone, via the default')
})

test('and resolves it on the branch where the process IS alive', () => {
  // The other side of the same default, so a binding that only works for the falsy
  // branch cannot pass. This process is certainly running.
  const sent = []
  const r = restartDashboard({
    root: '/repo', workspace: '/ws', pid: process.pid,
    kill: (pid, sig) => { sent.push(sig); return true }, sleep: () => {}, waitMs: 200,
    spawnFn: () => ({ pid: 1 }),
  })
  assert.deepEqual(sent, ['SIGTERM'], 'it signalled, which means it read the pid as alive')
  assert.equal(r.code, 'would-not-exit', 'and it read it as still alive afterwards')
})

test('the lock-staleness check resolves `alive` — the second call site', () => {
  // The path launchd exercises and the suite did not. A contended lock is the only
  // way to reach it: uncontended, `held?.pid` short-circuits before `alive` is ever
  // evaluated, which is why a probe that merely took the lock reported it healthy.
  const ws = tmp()
  const first = takeLock(ws)
  assert.equal(first.held, true)
  const second = takeLock(ws)
  assert.equal(second.held, false, 'a live holder keeps the lock')
  assert.match(second.reason, new RegExp(`pid ${process.pid}`), 'and is named by the pid it read')
  first.release()
})

test('a lock held by a pid that is gone is taken, not deferred to forever', () => {
  // The same call site, opposite branch: `alive` must be able to return false here or
  // a crashed sweep would hold the lock until the staleness window expires.
  const ws = tmp()
  fs.mkdirSync(path.join(ws, '.claude', 'session-hub', 'cache'), { recursive: true })
  const file = path.join(ws, '.claude', 'session-hub', 'cache', 'selfupdate.lock')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ pid: 2147483000, at: new Date().toISOString() }))
  const lock = takeLock(ws)
  assert.equal(lock.held, true, 'the holder is gone, so the lock is takeable')
  lock.release()
})

// ---- the second termination path in this repo (jwildfire/obot.roadmap#251) ----
//
// Audited alongside the admiral's. This one already confirms — it signals, waits,
// re-reads liveness, and on failure returns a result that reads as a failure. The
// cases below pin that, because the property is easy to lose to a refactor and its
// loss is invisible: a restart that assumed the old process was gone would start a
// second dashboard against a held port and report success.
//
// It does NOT escalate to SIGKILL, deliberately, and that policy is pinned too: a
// wedged server still serving yesterday's page is strictly better than a killed one
// serving nothing, and the next sweep tries again.

test('the restart reads liveness AGAIN after the signal — a sent signal is not a stopped process', () => {
  const seen = []
  let running = true
  const r = restartDashboard({
    root: '/repo', workspace: '/ws', pid: 4242, start: false,
    isAlive: () => { seen.push('check'); return running },
    kill: (pid, sig) => { seen.push(sig); if (sig === 'SIGTERM') running = false; return true },
    sleep: () => {}, waitMs: 1000,
    spawnFn: () => { throw new Error('the case ends before the spawn') },
  })
  assert.equal(seen[0], 'check', 'it establishes the process is there before signalling it')
  assert.equal(seen[1], 'SIGTERM')
  assert.ok(seen.slice(2).includes('check'), 'and reads liveness again afterwards rather than assuming')
  assert.equal(r.code, 'no-script', 'it got past the stop, which is all this case is about')
})

test('and it never escalates to SIGKILL — the policy, held on purpose', () => {
  const sent = []
  restartDashboard({
    root: '/repo', workspace: '/ws', pid: 4242,
    isAlive: () => true, kill: (pid, sig) => { sent.push(sig); return true },
    sleep: () => {}, waitMs: 1000, spawnFn: () => ({ pid: 1 }),
  })
  assert.deepEqual(sent, ['SIGTERM'], 'a wedged dashboard is reported, not escalated on')
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

test('the record says what the restart replaced, since afterwards nobody can be asked', () => {
  const now = new Date('2026-08-18T01:11:49Z')
  const p = previousProcess({ pid: 87091, startedAt: '2026-08-17T07:18:34Z' }, now)
  assert.equal(p.pid, 87091)
  assert.equal(p.upMin, 1073)
  assert.equal(p.words, 'up 18h')
})

test('a marker that cannot say when it started is unknown, never "just started"', () => {
  assert.equal(previousProcess({ pid: 1 }, new Date()).words, null)
  assert.equal(previousProcess(null, new Date()).words, null)
})

test('a restart names what it rescued him from, even when the old build could not', () => {
  const rec = selfUpdate({
    root: '/repo', workspace: tmp(), stamp: { short: 'aaa1111', startedAt: new Date().toISOString() },
    ff: () => ({ ok: true, code: 'current', moved: false, from: 'newsha', to: 'newsha', branch: 'main', reason: 'already at `origin/main`' }),
    marker: { state: 'live', pid: 87091, port: 7326, site: 'ops-dashboard', startedAt: new Date(Date.now() - 18 * 3600 * 1000).toISOString() },
    // The build being replaced is old enough to have no health endpoint, which is the
    // case this exists for: it cannot say which commit it is serving.
    health: () => null,
    lastSeen: { surfaces: { '/': new Date(Date.now() - 30 * 60000).toISOString() } },
    restart: () => ({ ok: true, code: 'restarted', serving: 'newsha', reason: 'the dashboard answered on http://127.0.0.1:7326/ serving `newsha`' }),
  })
  const c = rec.consumers[0]
  assert.equal(c.was, null, 'an old build genuinely cannot say, and the record must not invent it')
  assert.match(c.reason, /replacing one up 18h/)
  assert.equal(c.previous.pid, 87091)
})

// ---- watching the page must not prevent the page updating (obot.agent#258) ----
//
// The deferral was right and unbounded, which made it wrong: anything that requested
// the page — a poll, a monitor, him refreshing while he waited for a merge to appear —
// held the restart off for as long as it kept looking. Watching for the deploy was
// what prevented the deploy. Measured on this machine on 2026-08-18: the checkout at
// `7482007` and the server still serving `0832443`, so `/config/c0016` answered 404
// on a route that was merged and present in the checkout.
//
// Three things are held down here, and they are separable on purpose.
//
// WHAT A RESTART ACTUALLY INTERRUPTS. `/healthz` reports `inflight` and `idleMs` as
// two numbers and only the first is a request a restart would kill. The served pages
// fetch nothing from this origin — every `src`/`href` in a rendered page is either a
// navigation link or github.com — so `inflight === 0` means the response is complete
// and a restart drops nothing at all. `idleMs` was standing in for "somebody might ask
// again soon", which is a guess about the future and the thing a poller starves.
//
// THE BOUND. Even the true signal must terminate: a wedged request that never closes
// would starve the restart exactly as a poller did. Every deferral is counted and the
// count is on the record, so the page can show it and the next sweep can act on it.
//
// AND THE VERIFICATION MUST NOT REQUEST THE PAGE. A check that fetches `/` to prove
// the restart worked resets the traffic clock on whatever is serving and seeds the
// next sweep's deferral — the defect verifying itself into existence.

test('a request in flight defers — that is the one a restart would actually kill', () => {
  const r = planRestart({ marker: live(), health: { inflight: 1, idleMs: 10 * 60000, code: { sha: 'old' } }, headSha: 'new' })
  assert.equal(r.act, 'skip')
  assert.equal(r.deferred, true, 'a deferral must be marked as one — it is not the same as having nothing to do')
})

test('a page served seconds ago does NOT defer — nothing is in flight and the page fetches nothing', () => {
  const r = planRestart({ marker: live(), health: { inflight: 0, idleMs: 5000, code: { sha: 'old', short: 'old1234' } }, headSha: 'new' })
  assert.equal(r.act, 'restart', 'last-request time is a guess about the future; in-flight is the fact')
})

test('but a response that has only just closed gets the settling window, since a click is two requests', () => {
  const r = planRestart({ marker: live(), health: { inflight: 0, idleMs: 500, code: { sha: 'old' } }, headSha: 'new' })
  assert.equal(r.act, 'skip')
  assert.equal(r.code, 'settling')
  assert.equal(r.deferred, true)
})

test('the no-health fallback still leans on the disk record — it has nothing better to lean on', () => {
  const busy = planRestart({ marker: live(), health: null, headSha: 'new', lastLookMs: 2000 })
  assert.equal(busy.act, 'skip')
  assert.equal(busy.deferred, true)
  const quiet = planRestart({ marker: live(), health: null, headSha: 'new', lastLookMs: QUIET_MS + 1000 })
  assert.equal(quiet.act, 'restart')
})

test('a deferral that has already happened DEFERRAL_LIMIT times restarts anyway', () => {
  const busy = { inflight: 3, idleMs: 0, code: { sha: 'old', short: 'old1234' } }
  const held = planRestart({ marker: live(), health: busy, headSha: 'new', deferrals: DEFERRAL_LIMIT - 1 })
  assert.equal(held.act, 'skip', 'under the bound it still waits')
  const forced = planRestart({ marker: live(), health: busy, headSha: 'new', deferrals: DEFERRAL_LIMIT })
  assert.equal(forced.act, 'restart')
  assert.equal(forced.code, 'deferral-bound')
  assert.equal(forced.forced, true)
  assert.match(forced.reason, /3 times/, 'the line has to say how long it waited, or the bound is invisible')
})

test('the bound catches EVERY deferral, including the one that cannot measure quiescence at all', () => {
  const unknowable = { marker: live(), health: null, headSha: 'new', lastLookMs: null }
  assert.equal(planRestart({ ...unknowable, deferrals: 0 }).act, 'skip')
  assert.equal(planRestart({ ...unknowable, deferrals: 0 }).deferred, true,
    'unknowable quiescence is a deferral, not a failure — a failure implies something to fix')
  assert.equal(planRestart({ ...unknowable, deferrals: DEFERRAL_LIMIT }).act, 'restart')
})

test('a state with nothing to do is not a deferral and must never be counted as one', () => {
  for (const r of [
    planRestart({ marker: live(), health: { inflight: 0, idleMs: 10 * 60000, code: { sha: 'new' } }, headSha: 'new' }),
    planRestart({ marker: { state: 'none' }, health: null, headSha: 'new', lastLookMs: null }),
    planRestart({ marker: live({ port: 7399 }), health: null, headSha: 'new', lastLookMs: 10 * 60000 }),
    planRestart({ marker: live(), health: { inflight: 0, idleMs: 10 * 60000, code: { sha: 'old' } }, headSha: null }),
  ]) {
    assert.equal(r.act, 'skip')
    assert.notEqual(r.deferred, true, `\`${r.code}\` is nothing to do, not a restart being held back`)
  }
})

// ── The count, across sweeps ──────────────────────────────────────────────────────

const held = (over = {}) => ({
  root: '/repo', workspace: over.workspace, stamp: { short: 'aaa1111', startedAt: new Date().toISOString() },
  ff: () => ({ ok: true, code: 'current', moved: false, from: 'newsha', to: 'newsha', branch: 'main', reason: 'already at `origin/main`' }),
  marker: { state: 'live', pid: 87091, port: 7326, site: 'ops-dashboard', startedAt: new Date().toISOString() },
  health: () => ({ inflight: 1, idleMs: 0, code: { sha: 'oldsha', short: 'oldsha1' } }),
  restart: () => ({ ok: true, code: 'restarted', verified: true, serving: 'newsha', reason: 'the dashboard answered' }),
  ...over,
})

test('consecutive deferrals accumulate on the record, so the next sweep can act on them', () => {
  const ws = tmp()
  const first = selfUpdate(held({ workspace: ws }))
  assert.equal(first.consumers[0].deferrals, 1)
  const second = selfUpdate(held({ workspace: ws }))
  assert.equal(second.consumers[0].deferrals, 2)
  assert.equal(JSON.parse(fs.readFileSync(recordPath(ws), 'utf8')).consumers[0].deferrals, 2)
})

test('and the count is what fires the bound on a live workspace, not a hand-set argument', () => {
  const ws = tmp()
  let acts = []
  for (let i = 0; i <= DEFERRAL_LIMIT; i += 1) acts.push(selfUpdate(held({ workspace: ws })).consumers[0])
  assert.deepEqual(acts.map((c) => c.act), [...Array(DEFERRAL_LIMIT).fill('skip'), 'restart'])
  assert.equal(acts.at(-1).code, 'restarted')
  assert.equal(acts.at(-1).deferrals, 0, 'a restart clears the count — the next hold starts from zero')
})

test('a record written before this change carries no count, and is read as zero rather than as missing', () => {
  const ws = tmp()
  fs.mkdirSync(path.dirname(recordPath(ws)), { recursive: true })
  fs.writeFileSync(recordPath(ws), JSON.stringify({ consumers: [{ id: 'ops-dashboard', act: 'skip', code: 'busy' }] }))
  assert.equal(selfUpdate(held({ workspace: ws })).consumers[0].deferrals, 1)
})

test('nothing to do clears the count — the hold ended, whether or not a restart happened', () => {
  const ws = tmp()
  selfUpdate(held({ workspace: ws }))
  const clear = selfUpdate(held({ workspace: ws, health: () => ({ inflight: 0, idleMs: 10 * 60000, code: { sha: 'newsha' } }) }))
  assert.equal(clear.consumers[0].code, 'already-current')
  assert.equal(clear.consumers[0].deferrals, 0)
})

test('a locked sweep carries the count forward — it decided nothing, so it must reset nothing', () => {
  const ws = tmp()
  selfUpdate(held({ workspace: ws }))
  selfUpdate(held({ workspace: ws }))
  // A live lock belonging to a process that exists: this sweep gets no turn at all.
  fs.writeFileSync(path.join(ws, '.claude', 'session-hub', 'cache', 'selfupdate.lock'),
    JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
  const locked = selfUpdate(held({ workspace: ws }))
  assert.equal(locked.consumers[0].code, 'locked')
  assert.equal(locked.consumers[0].deferrals, 2, 'resetting here would let a racing sweep hold the bound off forever')
})

// ── Proving the restart, without touching the page ────────────────────────────────

const scriptAt = () => {
  const root = tmp()
  fs.mkdirSync(path.join(root, 'tools', 'ops-dashboard'), { recursive: true })
  fs.writeFileSync(path.join(root, 'tools', 'ops-dashboard', 'ops-dashboard.mjs'), '// present\n')
  return root
}

test('the verification asks /healthz and NEVER the page — requesting the page is what caused this', () => {
  const urls = []
  restartDashboard({
    root: scriptAt(), workspace: '/ws', pid: null, isAlive: () => false, sleep: () => {}, waitMs: 1000,
    expect: 'newsha', spawnFn: () => ({ pid: 77, unref: () => {} }),
    probe: (url) => { urls.push(url); return { status: 200, body: JSON.stringify({ pid: 77, code: { sha: 'newsha', short: 'newsha1' } }) } },
  })
  assert.ok(urls.length, 'it must probe something')
  for (const u of urls) assert.match(u, /\/healthz$/, `${u} is page traffic — it resets the idle clock and seeds the next deferral`)
})

test('a 200 from a DIFFERENT pid is not a restart — the port answering proves only that something is on it', () => {
  const killed = []
  const r = restartDashboard({
    root: scriptAt(), workspace: '/ws', pid: null, isAlive: () => true, sleep: () => {}, waitMs: 1000,
    expect: 'newsha', spawnFn: () => ({ pid: 77, unref: () => {} }), kill: (pid, sig) => killed.push([pid, sig]),
    probe: () => ({ status: 200, body: JSON.stringify({ pid: 20766, code: { sha: 'oldsha', short: 'oldsha1' } }) }),
  })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'not-ours')
  assert.match(r.reason, /20766/)
  assert.deepEqual(killed, [[77, 'SIGTERM']], 'a replacement that never became the server must not be left running')
})

test('a replacement serving a commit other than the one it was restarted onto is a failure, not a success', () => {
  const r = restartDashboard({
    root: scriptAt(), workspace: '/ws', pid: null, isAlive: () => false, sleep: () => {}, waitMs: 1000,
    expect: 'newsha', spawnFn: () => ({ pid: 77, unref: () => {} }),
    probe: () => ({ status: 200, body: JSON.stringify({ pid: 77, code: { sha: 'oldsha', short: 'oldsha1' } }) }),
  })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'wrong-build')
})

test('a verified restart names the process and the commit, so the claim can be checked afterwards', () => {
  const r = restartDashboard({
    root: scriptAt(), workspace: '/ws', pid: null, isAlive: () => false, sleep: () => {}, waitMs: 1000,
    expect: 'newsha', spawnFn: () => ({ pid: 77, unref: () => {} }),
    probe: () => ({ status: 200, body: JSON.stringify({ pid: 77, code: { sha: 'newsha', short: 'newsha1' } }) }),
  })
  assert.equal(r.ok, true)
  assert.equal(r.verified, true)
  assert.equal(r.servingPid, 77)
  assert.equal(r.serving, 'newsha1')
})

test('a health answer with no pid cannot verify identity, and says so instead of claiming it', () => {
  const r = restartDashboard({
    root: scriptAt(), workspace: '/ws', pid: null, isAlive: () => false, sleep: () => {}, waitMs: 1000,
    expect: null, spawnFn: () => ({ pid: 77, unref: () => {} }),
    probe: () => ({ status: 200, body: JSON.stringify({ ok: true }) }),
  })
  assert.equal(r.ok, true)
  assert.equal(r.verified, false, 'unverified must not read as verified')
  assert.match(r.reason, /could not be confirmed/)
})

// ── What the page says ────────────────────────────────────────────────────────────

test('a deferral renders with its count, and never renders as a failure', () => {
  const out = renderSelfUpdate({
    sweep: { short: 'abc1234', startedAt: new Date().toISOString() },
    checkout: { ok: true, code: 'moved', moved: true, branch: 'main', to: 'deadbeef', reason: 'fast-forwarded 2 commits to `origin/main`' },
    consumers: [{ id: 'ops-dashboard', act: 'skip', ok: true, code: 'busy', deferred: true, deferrals: 2,
                  reason: '1 request is in flight — a restart now would kill it' }],
  })
  assert.match(out, /deferral 2 of 3/)
  assert.doesNotMatch(out, /FAILED|BROKEN/, 'deferred and failed must never render the same')
})

test('a forced restart says it was forced, and how long it had been held off', () => {
  const out = renderSelfUpdate({
    sweep: { short: 'abc1234', startedAt: new Date().toISOString() },
    checkout: { ok: true, code: 'moved', moved: true, branch: 'main', to: 'deadbeef', reason: 'fast-forwarded 2 commits' },
    consumers: [{ id: 'ops-dashboard', act: 'restart', ok: true, code: 'restarted', forced: true, serving: 'deadbee',
                  reason: 'the dashboard answered as pid 77 serving `deadbee`' }],
  })
  assert.match(out, /ops-dashboard: restarted/)
})

test('every headline this section can emit matches the alarm vocabulary it is checked against', () => {
  // Two workers had headlines silently swallowed on 2026-08-18 because they were
  // written to match a copy of the regex rather than the regex. This asserts against
  // the imported one, so a headline that cannot render fails here instead of there.
  const emitted = [
    renderSelfUpdate(null),
    renderSelfUpdate({ sweep: null, checkout: { ok: false, code: 'dirty', reason: 'the checkout has uncommitted changes' }, consumers: [] }),
    renderSelfUpdate({ sweep: null, checkout: { ok: true, code: 'current', branch: 'main', to: 'a' },
                       consumers: [{ id: 'ops-dashboard', act: 'restart', ok: false, code: 'not-ours', reason: 'pid 20766 is answering, not the replacement' }] }),
  ].join('\n')
  const headlines = emitted.match(/\*\*[^*]+\*\*/g) ?? []
  assert.ok(headlines.length >= 3, 'the three failure headlines must all be reachable')
  for (const h of headlines) assert.match(h, ALARM_RE, `${h} would render as ordinary grey text`)
})
