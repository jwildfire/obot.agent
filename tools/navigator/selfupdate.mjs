#!/usr/bin/env node
// selfupdate — the local checkout tracks `main`, and the consumers that read it restart.
//
// Requirement: jwildfire/obot.roadmap#243. Issue: jwildfire/obot.agent#186.
//
// Merging is not deploying on this machine. Everything here runs from one local
// checkout, and a merge to `main` does not move it: nothing pulls, so nothing
// changes, and the failure is silent by construction because a server serving old
// code looks exactly like a server serving new code. Three instances of that one
// mechanism landed in two days — the wake channel that merged and had no effect, the
// dashboard that served an eleven-merge-old build twice, and the audit findings file
// quoted as current at twenty-two hours old.
//
// The sweep already walks past this every five minutes from the checkout itself, so
// the pull is a step on a walk it already makes. This module is that step, and the
// restart that has to follow it, kept out of sweep.mjs because the decisions below
// are the whole of the work and they deserve to be read in one place.
//
// TWO DECISIONS, MADE HERE RATHER THAN IMPLIED
//
// D1 — what counts as a consumer worth restarting. Restarting one mid-request is
// worse than serving stale for five more minutes, so the bar is deliberately high and
// the tiers are written down rather than left to whatever the code happens to do:
//
//   * RESTARTED automatically — a long-running local server whose entire state is on
//     disk, started from this checkout, holding a declared start command, and
//     quiescent right now. Today that is exactly one process: the Operations
//     Dashboard holding the serve marker on the default port. A test server never
//     holds that marker (obot.agent#142), which is what keeps this from ever reaching
//     an agent's scratch instance.
//   * NOTHING TO DO — anything that re-execs per run already picks up new code by
//     itself: the launchd sweep, and the admiral, which is spawned fresh per trigger.
//     Restarting these would be a no-op at best.
//   * NEVER RESTARTED, ONLY REPORTED — Claude Code sessions (prime, the Navigator,
//     workers). Their state is a conversation, not a file; killing one destroys
//     context nothing can rebuild and loses work in flight. The page names them and
//     how old their code is, and @jwildfire decides. An agent must not restart an
//     agent to save a page a refresh.
//
// D2 — what happens when the fast-forward is refused. It reports, and it never
// forces. There is no reset, no stash, no checkout, no `git pull`, no merge that
// could conflict, and nothing that could touch a worktree — other workers hold
// worktrees off this same repository and a dashboard refresh must never disturb work
// in progress. Every refusal carries a stable code and a plain sentence, and both
// reach the page, because the whole point of this requirement is that a failure to
// update is visible rather than silent.
//
// Untracked files never block. His drafts folder is permanently full of them, and a
// guard that demanded a spotless tree would refuse every run and be true exactly once.
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'

// The reads come from the module that already answers "what commit is this", rather
// than from a second copy of it here. That question has one implementation on this
// machine and the argument for keeping it that way was made once already, in
// jwildfire/obot.roadmap#225: across a boundary the honest fix is for one side to
// publish and the other to quote. Only the two commands that touch the network or
// the index get their own budget below — a fetch is not an eight-second read.
import { captureCode, git as gitRead } from '../ops-dashboard/lib/provenance.mjs'
// The marker is the answer to "which process is the machine's dashboard", and the
// last-seen store is the answer to "was anybody reading it". Both already exist and
// both are already the authority for those questions elsewhere; reading them here
// rather than re-deriving either is what keeps a test server safe from this module.
import { readLastSeen } from '../ops-dashboard/lib/last-seen.mjs'
import { markerPath, readMarker } from '../ops-dashboard/lib/serve-marker.mjs'

const GIT_TIMEOUT = 45000

/**
 * The port the machine's dashboard lives on. A server anywhere else is not it.
 *
 * Read from the environment so a scratch machine can move it, and read from the same
 * variable the server itself reads: the restart works by finding the process holding
 * the serve marker, the server claims that marker only on its default port, and two
 * halves that disagree about which port is "the" port would restart nothing and
 * report that everything was fine.
 */
export const DASHBOARD_PORT = Number(process.env.OBOT_DASHBOARD_PORT) || 7326

/**
 * How quiet the dashboard has to have been before it may be restarted.
 *
 * The page does not poll — it is rendered per request — so a gap this long means
 * nobody is reading it right now. Erring long is free: the next sweep is five
 * minutes away and stale-for-five-more-minutes is the outcome this bar prefers.
 */
export const QUIET_MS = 20000

/** The tiers of D1, in the words the page prints. Data, so the page and the code cannot drift. */
export const CONSUMER_POLICY = {
  restarted: [
    { id: 'ops-dashboard', what: 'the Operations Dashboard server', why: 'a long-running server whose state is all on disk' },
  ],
  selfUpdating: [
    { id: 'navigator-sweep', what: 'the five-minute sweep', why: 'launchd runs the file on disk fresh every time' },
    { id: 'admiral', what: 'the admiral', why: 'spawned as a fresh process per trigger' },
  ],
  never: [
    { id: 'sessions', what: 'standing Claude sessions (prime, Navigator, workers)', why: 'their state is a conversation — restarting one destroys context nothing can rebuild' },
  ],
}

/**
 * One git command, or null. Never throws: an update step must not be able to kill the
 * sweep, and every refusal in D2 is a value rather than an exception for that reason.
 *
 * The long budget is for `fetch` and `merge` alone. `provenance.git` reads with an
 * eight-second timeout, which is right for a page render and wrong for a network
 * round trip on a bad connection — and a fetch that times out here would report as a
 * refusal, which is a lie about the state of the checkout.
 */
export function gitRun(root, args) {
  try {
    return String(execFileSync('git', ['-C', root, ...args], {
      timeout: GIT_TIMEOUT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })).trim()
  } catch { return null }
}

/**
 * The commit a process was loaded from, captured at load rather than read at use.
 *
 * This is the sweep's missing build stamp. It is the component every other check
 * trusts and the one most likely to be running old code unnoticed, because nothing
 * reported what version of itself it was: the dashboard says what it serves, the
 * audit says how old its findings are, and the sweep said neither. Captured, not
 * read live, for the reason the dashboard learned first — after this run
 * fast-forwards the checkout, `HEAD` describes precisely the code that is *not*
 * running, and printing it would be wrong in the one moment the answer matters.
 */
export function buildStamp(root, { capture = captureCode } = {}) {
  const c = capture(root)
  return {
    sha: c?.started?.sha ?? null,
    short: c?.started?.short ?? null,
    at: c?.started?.at ?? null,
    startedAt: c?.startedAt ?? new Date().toISOString(),
    root,
  }
}

/** Everything the fast-forward decision needs, read once so the decision itself stays pure. */
export function readCheckout(root, { git = gitRead, remote = 'origin', branch = 'main' } = {}) {
  const inside = git(root, ['rev-parse', '--is-inside-work-tree'])
  if (inside !== 'true') return { repo: false, root }
  // A linked worktree shares the object store but is somebody's work in progress.
  // The sweep normally runs from the main checkout; if it is ever run from a
  // worktree, this is what stops it from moving a branch out from under a worker.
  const gitDir = git(root, ['rev-parse', '--path-format=absolute', '--git-dir'])
  const common = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const linked = Boolean(gitDir && common && resolve(gitDir) !== resolve(common))
  const on = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  // `--untracked-files=no` is the whole of the untracked-files decision: his drafts
  // are untracked and permanent, and they are not a reason to refuse.
  const porcelain = git(root, ['status', '--porcelain', '--untracked-files=no'])
  const midOp = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-merge', 'rebase-apply']
    .filter((f) => common && existsSync(join(common, f)))
  return {
    repo: true,
    root,
    linked,
    branch: on || null,
    wanted: branch,
    remote,
    head: git(root, ['rev-parse', 'HEAD']),
    dirty: porcelain ? porcelain.split('\n').filter(Boolean) : [],
    midOp,
  }
}

/**
 * May this checkout be fast-forwarded, and if not, why — in a sentence a page can print.
 *
 * Pure on purpose. Every refusal in D2 is a branch here, so the refusals are testable
 * without a repository and the sentences cannot drift from the conditions that
 * produce them.
 */
export function planFastForward(state, upstream) {
  const no = (code, reason) => ({ ok: false, code, reason })
  if (!state?.repo) return no('no-repo', `${state?.root ?? 'the checkout'} is not a git repository — nothing to update`)
  if (state.linked) return no('linked-worktree', 'this is a linked worktree, not the main checkout — a worker owns it, so it is left alone')
  if (!state.branch) return no('detached', 'the checkout is not on a branch (detached HEAD) — nothing is forced onto it')
  if (state.branch !== state.wanted) return no('not-main', `the checkout is on \`${state.branch}\`, not \`${state.wanted}\` — someone is working here, so it is left alone`)
  if (state.midOp.length) return no('mid-operation', `a ${state.midOp[0].startsWith('rebase') ? 'rebase' : 'merge or cherry-pick'} is in progress — the checkout is mid-operation and is left alone`)
  if (state.dirty.length) {
    const n = state.dirty.length
    return no('dirty', `the checkout has uncommitted changes to ${n} tracked file${n === 1 ? '' : 's'} — nothing is stashed, reset or forced`)
  }
  if (!upstream?.sha) return no('no-upstream', `\`${state.remote}/${state.wanted}\` could not be read — the fetch failed or the remote is unreachable`)
  if (!state.head) return no('no-head', 'the checkout has no HEAD commit')
  if (state.head === upstream.sha) return { ok: true, code: 'current', reason: `already at \`${state.remote}/${state.wanted}\`` }
  if (!upstream.ancestor) {
    return no('diverged', `the checkout has commits \`${state.remote}/${state.wanted}\` does not — this is not a fast-forward, so nothing is merged`)
  }
  return { ok: true, code: 'moved', reason: `fast-forward to \`${state.remote}/${state.wanted}\`` }
}

/**
 * Fetch, decide, and fast-forward — or refuse and say why.
 *
 * `--ff-only` is not belt and braces on top of the ancestor test; it is the guarantee
 * that survives a race. The fetch and the merge are separate commands and a worker can
 * commit between them, so the plan is advice and the flag is the contract.
 */
export function fastForward(root, { git = gitRead, slow = gitRun, remote = 'origin', branch = 'main' } = {}) {
  const before = readCheckout(root, { git, remote, branch })
  const pre = planFastForward(before, { sha: 'unknown', ancestor: true })
  // Refuse before touching the network when the reason is local: a dirty tree is a
  // refusal whether or not the remote has moved.
  if (!pre.ok && pre.code !== 'no-upstream') return { ...pre, moved: false, from: before.head, to: before.head, branch: before.branch }

  const fetched = slow(root, ['fetch', '--quiet', remote, branch]) !== null
  const ref = `${remote}/${branch}`
  const upSha = fetched ? git(root, ['rev-parse', ref]) : null
  const upstream = {
    sha: upSha,
    ancestor: upSha && before.head ? git(root, ['merge-base', '--is-ancestor', before.head, upSha]) !== null : false,
  }
  const plan = planFastForward(before, upstream)
  if (!plan.ok) return { ...plan, moved: false, from: before.head, to: before.head, branch: before.branch }
  if (plan.code === 'current') return { ...plan, moved: false, from: before.head, to: before.head, branch: before.branch }

  const merged = slow(root, ['merge', '--ff-only', ref])
  const after = git(root, ['rev-parse', 'HEAD'])
  if (merged === null || after === before.head) {
    return { ok: false, code: 'ff-failed', reason: `\`git merge --ff-only ${ref}\` was refused — the checkout is untouched`, moved: false, from: before.head, to: before.head, branch: before.branch }
  }
  const count = git(root, ['rev-list', '--count', `${before.head}..${after}`])
  return {
    ok: true, code: 'moved', moved: true, from: before.head, to: after, branch: before.branch,
    commits: count === null ? null : Number(count),
    reason: `fast-forwarded ${count ?? '?'} commit${count === '1' ? '' : 's'} to ${ref}`,
  }
}

// ── The consumer half ────────────────────────────────────────────────────────────

/**
 * One local HTTP GET, synchronously, or null.
 *
 * The sweep is a synchronous program and this is not the place to make it otherwise:
 * a restart that has to be verified before the run may claim success is a step in a
 * sequence, not a background wish. A child `node -e` costs about fifty milliseconds
 * and keeps the dependency list at zero — `curl` is not guaranteed on a machine and
 * the answer here has to be parsed, not just received.
 */
export function probe(url, { exec = execFileSync, timeoutMs = 3000 } = {}) {
  const script = `const http=require('node:http');const req=http.get(process.argv[1],{timeout:${timeoutMs}},res=>{let b='';res.on('data',d=>{b+=d});res.on('end',()=>{process.stdout.write(JSON.stringify({status:res.statusCode,body:b.slice(0,8192)}))})});req.on('timeout',()=>{req.destroy();process.exit(3)});req.on('error',()=>process.exit(4))`
  try {
    const out = exec(process.execPath, ['-e', script, url], {
      timeout: timeoutMs + 2000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    })
    return JSON.parse(out)
  } catch { return null }
}

/** The dashboard's own account of itself, or null when it does not answer or is too old to have one. */
export function health(port, { probe: p = probe } = {}) {
  const r = p(`http://127.0.0.1:${port}/healthz`)
  if (!r || r.status !== 200) return null
  try {
    const h = JSON.parse(r.body)
    return h && typeof h === 'object' ? h : null
  } catch { return null }
}

/** The newest look recorded across every surface — the fallback quiescence signal. */
export function lastLookMs(store, now = new Date()) {
  const stamps = Object.values(store?.surfaces ?? {})
    .map((s) => Date.parse(s))
    .filter((t) => Number.isFinite(t))
  if (!stamps.length) return null
  return Math.max(0, now.getTime() - Math.max(...stamps))
}

/**
 * Should the dashboard be restarted, left alone, or started — and why, in one sentence.
 *
 * Pure, like `planFastForward`, and for the same reason: D1 is a policy and a policy
 * that only exists as control flow cannot be reviewed. `act` is what to do; every
 * outcome carries a code and a sentence, including the boring ones, because a page
 * that speaks only when something is wrong cannot be trusted when it is silent.
 */
export function planRestart({ marker, health: h, headSha, lastLookMs: lookMs, quietMs = QUIET_MS, port = DASHBOARD_PORT }) {
  const out = (act, code, reason) => ({ act, code, reason })

  if (!marker || marker.state === 'none') {
    return out('skip', 'not-running', 'no dashboard has advertised itself on this machine — nothing to restart')
  }
  if (marker.state === 'unreadable') {
    return out('skip', 'marker-unreadable', 'the serve marker is not readable, so which process is the dashboard cannot be established — nothing is signalled')
  }
  if (marker.site && marker.site !== 'ops-dashboard') {
    return out('skip', 'not-dashboard', `the serve marker names \`${marker.site}\`, not the dashboard — left alone`)
  }
  // A test server never holds the marker (obot.agent#142); this is the second lock on
  // the same door, so an agent's scratch instance can never be the thing restarted.
  if (marker.port !== port) {
    return out('skip', 'other-port', `the marked server is on port ${marker.port}, not the dashboard port ${port} — left alone`)
  }
  if (marker.state === 'stale') {
    // It advertised itself and then died without releasing. Starting it again is the
    // only reason a failed restart is survivable while he is away: without this, one
    // bad restart is two days with no dashboard, and with it the gap is one sweep.
    //
    // And it cannot resurrect a server he stopped on purpose, which is the thing that
    // would make it obnoxious. A SIGTERM — what `pkill -f 'ops-dashboard.mjs --serve'`
    // sends, the command the page itself prints — runs the marker's release hook, so a
    // deliberate stop leaves no marker and reads as `none` above. Only a crash leaves
    // one behind. The two cases were never distinguished on purpose; they are
    // distinguished because the marker already had exactly the right shape.
    return out('start', 'stale-marker', `the dashboard advertised port ${marker.port} and its process (pid ${marker.pid}) is gone — starting it again`)
  }
  // Nothing to restart onto. Only reachable when the checkout could not be read at
  // all, and restarting a server against an unknown target is motion without a reason.
  if (!headSha) {
    return out('skip', 'unknown-head', 'the checkout could not be read, so there is no commit to restart onto — the running dashboard is left alone')
  }
  if (h && h.code && h.code.sha === headSha) {
    return out('skip', 'already-current', `the running dashboard is already serving \`${headSha.slice(0, 7)}\``)
  }
  if (!h) {
    // An older build has no health endpoint. The disk record of when he last opened a
    // page is the fallback, and when even that cannot be read the answer is to refuse
    // rather than to guess — a guess here is a killed request.
    if (lookMs === null || lookMs === undefined) {
      return out('refuse', 'unknown-quiescence', 'the running dashboard predates the health endpoint and no page-visit record could be read, so whether it is mid-request is unknowable — it is left running')
    }
    if (lookMs < quietMs) {
      return out('skip', 'busy', `the page was opened ${Math.round(lookMs / 1000)}s ago — a restart now could land mid-request, so it waits for the next sweep`)
    }
    return out('restart', 'stale-code-quiet', `the running dashboard is serving older code and the page has been quiet for ${Math.round(lookMs / 1000)}s`)
  }
  if (h.inflight > 0) {
    return out('skip', 'busy', `${h.inflight} request${h.inflight === 1 ? ' is' : 's are'} in flight — a restart now would kill ${h.inflight === 1 ? 'it' : 'them'}, so it waits for the next sweep`)
  }
  const idle = Number.isFinite(h.idleMs) ? h.idleMs : (lookMs ?? null)
  if (idle === null) {
    return out('refuse', 'unknown-quiescence', 'the dashboard reports no idle time, so whether it is being read is unknowable — it is left running')
  }
  if (idle < quietMs) {
    return out('skip', 'busy', `the page was last served ${Math.round(idle / 1000)}s ago — a restart now could land mid-request, so it waits for the next sweep`)
  }
  return out('restart', 'stale-code-quiet', `the running dashboard is serving \`${h.code?.short ?? 'unknown'}\` and has been quiet for ${Math.round(idle / 1000)}s`)
}

const sleepMs = (ms) => { try { execFileSync(process.execPath, ['-e', `setTimeout(()=>{},${ms})`], { timeout: ms + 4000, stdio: 'ignore' }) } catch { /* a sleep that fails is a shorter sleep */ } }

/** Is that pid still running? `EPERM` counts: alive, just not ours to signal. */
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

/**
 * Stop the old dashboard, start one from the current checkout, and prove it answers.
 *
 * SIGTERM and then patience: the marker's own exit hook releases it on that signal,
 * so the replacement can claim it. If the old process will not go, the restart is
 * abandoned rather than escalated — a wedged server still serving yesterday's page is
 * strictly better than a killed one serving nothing, and the next sweep will try
 * again. Nothing here sends SIGKILL.
 */
export function restartDashboard({ root, workspace, port = DASHBOARD_PORT, pid, start = true,
                                   spawnFn = spawn, kill = process.kill.bind(process), isAlive = alive,
                                   probe: p = probe, sleep = sleepMs, waitMs = 12000, logFile = null } = {}) {
  const url = `http://127.0.0.1:${port}/`
  if (pid && isAlive(pid)) {
    try { kill(pid, 'SIGTERM') } catch (e) { return { ok: false, code: 'signal-failed', reason: `the running dashboard (pid ${pid}) could not be signalled: ${e.code ?? e.message}` } }
    let waited = 0
    while (isAlive(pid) && waited < waitMs) { sleep(250); waited += 250 }
    if (isAlive(pid)) {
      return { ok: false, code: 'would-not-exit', reason: `the dashboard (pid ${pid}) did not exit within ${Math.round(waitMs / 1000)}s of SIGTERM — it is left running rather than killed, and the next sweep will try again` }
    }
  } else if (!start) {
    return { ok: false, code: 'gone', reason: 'the dashboard process was already gone and starting one was not asked for' }
  }

  const script = join(root, 'tools', 'ops-dashboard', 'ops-dashboard.mjs')
  if (!existsSync(script)) return { ok: false, code: 'no-script', reason: `${script} is missing — nothing was started` }
  let out = 'ignore'
  try {
    if (logFile) { mkdirSync(dirname(logFile), { recursive: true }); out = openSyncAppend(logFile) }
  } catch { out = 'ignore' }
  let child
  try {
    // `--exclusive` rather than the default roll-forward: a replacement that quietly
    // lands on 7327 is a dashboard nobody can find and a serve marker nobody holds,
    // and it would report as a success here. Better it refuses to start and says so.
    child = spawnFn(process.execPath, [script, '--serve', '--exclusive', '--workspace', workspace], {
      detached: true, stdio: ['ignore', out, out], cwd: workspace, env: restartEnv(),
    })
    child.unref?.()
  } catch (e) {
    return { ok: false, code: 'spawn-failed', reason: `the replacement dashboard could not be started: ${e.message}` }
  }

  // Started is not serving. The whole requirement is that a failure to update is
  // visible, and a spawn that exits two seconds later on a syntax error is exactly
  // the failure this would otherwise report as a success.
  let waited = 0
  while (waited < waitMs) {
    const r = p(`${url}healthz`)
    if (r && r.status === 200) {
      let code = null
      try { code = JSON.parse(r.body)?.code ?? null } catch { /* answering is the point; parsing is a bonus */ }
      return { ok: true, code: 'restarted', pid: child.pid ?? null, serving: code?.short ?? null, reason: `the dashboard answered on ${url} serving \`${code?.short ?? 'unknown'}\`` }
    }
    // An older build has no health endpoint; a 200 on the page itself still proves it
    // is serving, and this path exists only until one restart has happened.
    const root200 = p(url)
    if (root200 && root200.status === 200) {
      return { ok: true, code: 'restarted', pid: child.pid ?? null, serving: null, reason: `the dashboard answered on ${url} (no health endpoint — this build predates it)` }
    }
    sleep(500); waited += 500
  }
  return { ok: false, code: 'no-answer', reason: `a replacement dashboard was started (pid ${child.pid ?? '?'}) but nothing answered on ${url} within ${Math.round(waitMs / 1000)}s — the page is DOWN and the next sweep will start it again` }
}

// ── The run ──────────────────────────────────────────────────────────────────────

/** Where the record lives. A NEW file, deliberately: see the header of `writeRecord`. */
export const RECORD = ['.claude', 'session-hub', 'cache', 'selfupdate.json']
const LOCK = ['.claude', 'session-hub', 'cache', 'selfupdate.lock']
const LOCK_STALE_MS = 120000

export const recordPath = (workspace) => join(workspace, ...RECORD)

/**
 * One restart at a time.
 *
 * launchd will not run two sweeps under one label, but a hand-run `node sweep.mjs`
 * alongside the scheduled one is a normal thing to do while working on it — and two
 * restarters would race for port 7326, which is obot.agent#142 with an extra process.
 * The lock covers the restart alone; the fast-forward is safe to repeat because git
 * takes its own.
 */
export function takeLock(workspace, { now = Date.now } = {}) {
  const file = join(workspace, ...LOCK)
  mkdirSync(dirname(file), { recursive: true })
  const mine = JSON.stringify({ pid: process.pid, at: new Date().toISOString() })
  try {
    writeFileSync(file, mine, { flag: 'wx' })
    return { held: true, release: () => { try { rmSync(file, { force: true }) } catch { /* gone is fine */ } } }
  } catch {
    let held = null
    try { held = JSON.parse(readFileSync(file, 'utf8')) } catch { /* unreadable */ }
    const age = held?.at ? now() - Date.parse(held.at) : Infinity
    if (held?.pid && alive(held.pid) && age < LOCK_STALE_MS) {
      return { held: false, reason: `another sweep (pid ${held.pid}) is restarting consumers right now`, release: () => {} }
    }
    // Stale: the holder is gone or has been in there longer than any restart can take.
    try { writeFileSync(file, mine) } catch { /* if this fails the next branch is honest anyway */ }
    return { held: true, release: () => { try { rmSync(file, { force: true }) } catch { /* gone is fine */ } } }
  }
}

/**
 * The process about to be replaced, described from the marker alone.
 *
 * `upMin` is how long it had been serving, which is the only thing an old build can
 * still tell us about itself: a process that predates the health endpoint cannot name
 * the commit it is running, and once it has been signalled it cannot name anything.
 */
export function previousProcess(marker, now = new Date()) {
  const since = marker?.startedAt ?? null
  const t = since ? Date.parse(since) : NaN
  const upMin = Number.isFinite(t) ? Math.max(0, Math.round((now.getTime() - t) / 60000)) : null
  return {
    pid: marker?.pid ?? null,
    since,
    upMin,
    words: upMin === null ? null : (upMin < 60 ? `up ${upMin}m` : `up ${Math.round(upMin / 60)}h`),
  }
}

/**
 * The whole step, in the order the failure modes demand.
 *
 * Fast-forward first, restart second, record third — and the record is written on
 * every path including the boring ones, because the page has to be able to say "this
 * was checked two minutes ago and there was nothing to do". A record that only
 * appears when something happened is indistinguishable from a sweep that stopped
 * running, which is the failure this requirement exists to end.
 */
export function selfUpdate({ root, workspace, stamp, now = () => new Date(),
                             marker = readMarker(markerPath(workspace)),
                             health: readHealth = health, lastSeen = readLastSeen(workspace),
                             restart = restartDashboard, ff = fastForward, quietMs = QUIET_MS,
                             port = DASHBOARD_PORT, logFile = null } = {}) {
  const at = now().toISOString()
  const checkout = ff(root)
  const headSha = checkout.to ?? null

  const consumers = []
  const lock = takeLock(workspace)
  if (!lock.held) {
    consumers.push({ id: 'ops-dashboard', act: 'skip', code: 'locked', ok: true, reason: lock.reason })
  } else {
    try {
      const h = readHealth(port)
      const plan = planRestart({
        marker, health: h, headSha, quietMs, port,
        lastLookMs: lastLookMs(lastSeen, now()),
      })
      if (plan.act === 'restart' || plan.act === 'start') {
        // What the restart rescued him from, taken before it happens, because
        // afterwards there is nobody left to ask. A build old enough to have no health
        // endpoint cannot say which commit it was serving — the first real restart on
        // this machine replaced one eighteen hours and four merges old and the record
        // could only say `was: null`. How long it had been up is on disk in the marker,
        // it answers the same question well enough to act on, and it is the difference
        // between "a restart happened" and "a restart was overdue".
        const prev = previousProcess(marker, now())
        const r = restart({
          root, workspace, port, logFile,
          pid: plan.act === 'restart' ? marker?.pid : null,
          start: true,
        })
        consumers.push({ id: 'ops-dashboard', act: plan.act, code: r.code, ok: r.ok,
                         reason: r.ok ? `${r.reason}${prev.words ? `, replacing one ${prev.words}` : ''}` : `${plan.reason}, but ${r.reason}`,
                         was: h?.code?.short ?? null, previous: prev, serving: r.serving ?? null, at: now().toISOString() })
      } else {
        consumers.push({ id: 'ops-dashboard', act: plan.act, code: plan.code, ok: plan.act !== 'refuse',
                         reason: plan.reason, serving: h?.code?.short ?? null })
      }
    } finally { lock.release() }
  }

  const record = {
    at,
    sweep: stamp ?? null,
    checkout: {
      root, branch: checkout.branch ?? null, ok: checkout.ok, code: checkout.code,
      moved: Boolean(checkout.moved), from: checkout.from ?? null, to: checkout.to ?? null,
      commits: checkout.commits ?? null, reason: checkout.reason,
    },
    consumers,
    policy: CONSUMER_POLICY,
  }
  writeRecord(workspace, record)
  return record
}

/**
 * The record, in its own file.
 *
 * Its own, rather than a new section in one of the files already being written,
 * because a long-running server reads those and reaches a new shape before the code
 * that understands it is running — which is how the live queue page 500'd on
 * 2026-08-16. A new filename can only ever be absent to an old reader, and absent is
 * a state every reader here already handles.
 */
export function writeRecord(workspace, record) {
  try {
    const file = recordPath(workspace)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
    return file
  } catch { return null }
}

const openSyncAppend = (file) => openSync(file, 'a')

/**
 * The environment a replacement is started with.
 *
 * The restarter runs under launchd, whose `PATH` is three entries long, while the
 * dashboard it replaces was started from a shell with fifteen. A replacement that is
 * quietly less capable than what it replaced is this requirement's own failure wearing
 * a different hat: the page would render perfectly and its release-candidate refresh
 * would fail, because `gh` was no longer on the path — and nothing about the page would
 * look any different. On this machine `gh` happens to sit in a directory launchd does
 * carry, which is luck rather than a design, and luck is not what should be holding
 * his dashboard together while he is away.
 *
 * Appended rather than prepended: the caller's own resolution order wins, and this only
 * adds places to look.
 */
export function restartEnv(env = process.env) {
  const extra = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin',
                 env.HOME ? join(env.HOME, '.local/bin') : null, '/usr/bin', '/bin', '/usr/sbin', '/sbin']
  const seen = new Set()
  const parts = [...String(env.PATH ?? '').split(':'), ...extra]
    .filter((d) => d && !seen.has(d) && (seen.add(d), true))
  return { ...env, PATH: parts.join(':') }
}

/** Minutes, in the vocabulary the rest of the file already uses. */
const ageWords = (ms) => {
  if (!Number.isFinite(ms)) return null
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

/**
 * The section the state file prints, healthy or not.
 *
 * Healthy is printed for the reason the audit-freshness check settled on and the
 * dashboard's provenance line repeats: a detector that only speaks when something is
 * wrong is indistinguishable from one that has stopped.
 *
 * Two shapes, and the difference is load-bearing rather than cosmetic. The verdicts
 * are PLAIN lines and the detail is bullets, because the dashboard's parser only
 * alarm-tests plain lines inside a section — a bullet is a row and never an alarm
 * (ops-dashboard/lib/navigator.mjs). And the headlines are bold ALL-CAPS with no
 * punctuation inside the emphasis, because that test is a case-sensitive match on
 * exactly that shape: a hyphen in `AUTO-UPDATE` renders the alarm as ordinary grey
 * text, which is the bug obot.agent#152 fixed once already. Both traps are the same
 * trap — a verdict that cannot reach the page is indistinguishable from a clean one.
 */
export function renderSelfUpdate(record, now = new Date()) {
  const lines = ['## Checkout — the code this machine is running', '']
  if (!record) {
    lines.push('**AUTO UPDATE BROKEN** — no update was attempted this sweep. Nothing here says the checkout is current.')
    return `${lines.join('\n')}\n`
  }

  const c = record.checkout ?? {}
  lines.push(c.ok
    ? `checkout: \`${String(c.to ?? '').slice(0, 7)}\` on \`${c.branch}\` — ${c.reason}`
    : `**AUTO UPDATE FAILED** — ${c.reason}. The checkout is untouched.`)

  for (const con of record.consumers ?? []) {
    if (!con.ok) lines.push(`**DASHBOARD RESTART FAILED** — ${con.reason}`)
    else if (con.act === 'restart' || con.act === 'start') lines.push(`${con.id}: ${con.act === 'start' ? 'started' : 'restarted'} — ${con.reason}`)
  }

  lines.push('')
  const s = record.sweep
  // The sweep's own build stamp, and the one honest thing to say about a process that
  // updates the checkout it is running from: for the rest of this run it is older than
  // the disk beneath it. That window is a real mismatch — every tool this run shells
  // comes off the new tree — and it lasts exactly one cadence, so it is stated rather
  // than hidden. An invisible five-minute mismatch is this requirement's whole subject.
  const moved = s?.sha && c.to && s.sha !== c.to
  lines.push(s?.short
    ? `- sweep: \`${s.short}\` — the code this run is executing, loaded ${ageWords(now.getTime() - Date.parse(s.startedAt)) ?? 'just now'}${moved ? `; the checkout has since moved to \`${String(c.to).slice(0, 7)}\` and the next run executes that` : ''}`
    : '- sweep: which commit this run is executing could not be read')
  for (const con of record.consumers ?? []) {
    if (con.ok && con.act !== 'restart' && con.act !== 'start') lines.push(`- ${con.id}: not restarted — ${con.reason}`)
  }
  lines.push(`- never restarted: ${CONSUMER_POLICY.never.map((n) => `${n.what} — ${n.why}`).join('; ')}.`)
  return `${lines.join('\n')}\n`
}
