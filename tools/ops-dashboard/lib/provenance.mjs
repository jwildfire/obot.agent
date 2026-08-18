// What this page is actually made of — the code it is running and the data it read.
//
// The Operations Dashboard is a long-running local server. Nothing restarts it when
// obot.agent merges, and nothing pulls the hub clone it reads decisions from, so both
// halves can drift behind while the page keeps looking current. Both did on
// 2026-08-16: the running server was eleven merges behind `main` at one point in the
// day and said nothing, and the hub clone was four commits behind `origin/main`, which
// is the whole reason D0018 — decided by @jwildfire that morning, recorded in the
// artifact, the index row and the registry — was still listed as awaiting him.
//
// This module answers three questions, and the page prints all three whether or not
// the answer is bad. The third arrived with jwildfire/obot.roadmap#243 — is anything
// pulling new code onto this machine at all — because reporting the snapshot is only
// half of it: an updater that has quietly stopped looks exactly like one with nothing
// to do. That is deliberate, and it is the shape `auditFreshness` settled on
// in tools/navigator/checks.mjs: the 2026-08-16 misreading happened well inside any
// sane staleness threshold, so a line that only speaks up when something is late would
// not have caught it. What was missing was a sentence saying which snapshot this is,
// sitting next to the numbers somebody was about to act on.
//
// The code half can only be reported from in here, not fixed: a running process
// cannot reload its own modules, so a stale build says "restart me" — and since #243
// something outside it listens. The data half is fixed rather than reported, because
// it can be — the freshest committed hub state is one `git archive` away and reading
// it needs nobody's permission and no write to his checkout.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const GIT_TIMEOUT = 8000;

/** One git command, or null. Never throws: provenance must not be able to take the page down. */
export function git(dir, args, { buffer = false } = {}) {
  try {
    const out = execFileSync('git', ['-C', dir, ...args], {
      timeout: GIT_TIMEOUT, maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'],
      ...(buffer ? { encoding: 'buffer' } : { encoding: 'utf8' }),
    });
    return buffer ? out : String(out).trim();
  } catch { return null; }
}

/** `{sha, short, at}` for a ref, or null when the directory is not a repo. */
export function commitInfo(dir, ref = 'HEAD') {
  const out = git(dir, ['show', '-s', '--format=%H%n%cI', ref]);
  if (!out) return null;
  const [sha, at] = out.split('\n');
  return sha ? { sha, short: sha.slice(0, 7), at: at || null } : null;
}

const count = (dir, range) => {
  const n = git(dir, ['rev-list', '--count', range]);
  return n === null ? null : Number(n);
};

/**
 * The commit this *process* is running, captured when the module loads.
 *
 * It has to be captured, not read at render time: the checkout moves on while the
 * server runs, so `git rev-parse HEAD` during a request describes the code on disk,
 * which is exactly the code that is *not* being served. Reading it live is how a page
 * eleven merges behind could have printed the newest sha and been wrong twice over.
 */
export function captureCode(repoRoot) {
  return { started: commitInfo(repoRoot), startedAt: new Date().toISOString(), root: repoRoot };
}

/**
 * How far the running code has fallen behind the checkout it came from.
 *
 * `behind` counts commits on the checkout that this process does not have. A null
 * means the question could not be answered — not that the answer is zero — and the
 * page says so rather than rendering a reassuring blank.
 */
export function codeState(captured, now = new Date()) {
  const started = captured?.started ?? null;
  if (!started) return { ok: false, unknown: true };
  const head = commitInfo(captured.root);
  const behind = head && head.sha !== started.sha
    ? count(captured.root, `${started.sha}..${head.sha}`)
    : 0;
  const up = captured.startedAt ? Date.parse(captured.startedAt) : NaN;
  return {
    ok: behind === 0,
    unknown: behind === null,
    short: started.short,
    at: started.at,
    ageMin: started.at ? Math.max(0, Math.round((now.getTime() - Date.parse(started.at)) / 60000)) : null,
    // When this process started, which is a different question from how old its code
    // is and the one jwildfire/obot.roadmap#243 asks the page to answer: *when did it
    // restart*. It has to come from the captured stamp rather than from a record of
    // the last automatic restart, because that record only describes the most recent
    // sweep — five minutes later it says nothing, and the answer would blink out while
    // the process it described was still running.
    upMin: Number.isFinite(up) ? Math.max(0, Math.round((now.getTime() - up) / 60000)) : null,
    behind: behind ?? null,
    head: head?.short ?? null,
  };
}

/** Has anything under `reports/decisions` been changed but not committed? */
export const hubDirty = (hub) => Boolean(git(hub, ['status', '--porcelain', '--', 'reports/decisions']));

/** When `git fetch` last ran in this clone, from the file fetch writes. */
export function lastFetch(hub) {
  try { return fs.statSync(path.join(hub, '.git', 'FETCH_HEAD')).mtime.toISOString(); } catch { return null; }
}

/**
 * A bounded, read-only `git fetch`, off the event loop.
 *
 * Detached rather than synchronous on purpose: this runs on a timer inside the server,
 * and a remote that is slow or unreachable must cost freshness, never a request. It
 * updates remote-tracking refs and touches no branch and no working tree — the
 * dashboard reads his checkout and never moves it.
 */
export function fetchHub(hub, remote = 'origin') {
  try {
    const p = spawn('git', ['-C', hub, 'fetch', '--quiet', remote], { stdio: 'ignore', detached: false });
    p.on('error', () => { /* no git, or no network: the page says how old the data is */ });
    p.unref?.();
    return true;
  } catch { return false; }
}

/** The upstream this clone's checked-out branch tracks, e.g. `origin/main`. */
export const upstreamRef = (hub) => git(hub, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);

/**
 * Materialise one committed hub tree into the local ops cache and return its root.
 *
 * Only the two directories the decision collectors read — `scripts` (the collector
 * modules themselves, plus the repo list `repos.mjs` loads at import) and
 * `reports/decisions` (the index, the registry and the artifact pages). Importing the
 * collector *out of the materialised tree* is the point: it derives its own ROOT from
 * its module URL, so the same code that builds the published log reads the fresh data,
 * and there is no second parser here to drift from it.
 *
 * Never a checkout, a pull or a stash. His working tree is not this page's to move.
 */
export function materialiseHub(hub, sha, cacheDir) {
  const dir = path.join(cacheDir, `hub-${sha.slice(0, 12)}`);
  const done = path.join(dir, '.complete');
  if (fs.existsSync(done)) return dir;
  const tar = git(hub, ['archive', '--format=tar', sha, 'scripts', 'reports/decisions'], { buffer: true });
  if (!tar) return null;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    execFileSync('tar', ['-x', '-C', dir], { input: tar, timeout: GIT_TIMEOUT * 4, stdio: ['pipe', 'ignore', 'ignore'] });
  } catch { fs.rmSync(dir, { recursive: true, force: true }); return null; }
  fs.writeFileSync(done, `${sha}\n`);
  // One tree per sha, and only the current one kept: these are copies of a public
  // repo, but they are copies, and a cache that only grows is a cache nobody trusts.
  for (const name of fs.readdirSync(cacheDir)) {
    if (name.startsWith('hub-') && name !== path.basename(dir)) {
      fs.rmSync(path.join(cacheDir, name), { recursive: true, force: true });
    }
  }
  return dir;
}

/**
 * Which copy of the hub the decisions should be read from, and why.
 *
 * The clone is preferred, as it always was — a decision recorded five minutes ago is
 * in the working tree and in no published feed, and that is the reason this dashboard
 * reads a clone rather than the deployed `decisions.json` at all.
 *
 * It stops being preferred in exactly one case: the clone is clean and strictly behind
 * its upstream. Then the upstream is the clone plus more, with nothing of his to lose,
 * and reading it is the difference between a queue that lists a decision he made this
 * morning and one that does not. A dirty clone keeps priority even when behind, and
 * says so — his uncommitted work outranks a tidier answer.
 */
export function resolveHub(hub, cacheDir, { fetched = null } = {}) {
  const head = commitInfo(hub);
  const base = {
    root: hub, source: 'clone', head: head?.short ?? null, at: head?.at ?? null,
    behind: 0, dirty: false, fetchedAt: fetched ?? lastFetch(hub), warn: null,
  };
  // Three different states produced this one sentence, and two of them are not what
  // it says. On a new machine the likeliest is the third: there is no clone at all,
  // so nothing is being read and there is nothing to read it "as-is" from
  // (jwildfire/obot.roadmap#223).
  if (!head) {
    if (!fs.existsSync(hub)) {
      return { ...base, missing: true, warn: `no obot.roadmap clone at ${hub} — decisions cannot be read until one is cloned there` };
    }
    return { ...base, warn: 'the hub clone is not a git repository — reading the directory as-is' };
  }

  const up = upstreamRef(hub) ?? 'origin/main';
  const upstream = commitInfo(hub, up);
  const behind = upstream ? count(hub, `${head.sha}..${upstream.sha}`) : null;
  const dirty = hubDirty(hub);
  if (!behind || !upstream) return { ...base, dirty, upstream: up };

  if (dirty) {
    return { ...base, dirty: true, behind, upstream: up,
      warn: `the hub clone is ${behind} commit${behind === 1 ? '' : 's'} behind ${up} and has uncommitted decision edits — reading the clone, so anything merged since is not below` };
  }
  const fresh = materialiseHub(hub, upstream.sha, cacheDir);
  if (!fresh) {
    return { ...base, behind, upstream: up,
      warn: `the hub clone is ${behind} commit${behind === 1 ? '' : 's'} behind ${up} and could not be read at ${up} — the queue below may be out of date` };
  }
  return {
    root: fresh, source: up, head: upstream.short, at: upstream.at, behind, dirty: false,
    fetchedAt: fetched ?? lastFetch(hub), upstream: up, cloneHead: head.short, warn: null,
  };
}

/**
 * The third question this strip answers: is anything pulling new code onto this
 * machine, and did the last attempt work?
 *
 * The first two halves report the snapshot. This one reports the *mechanism* — and it
 * has to, because the mechanism is the part that fails invisibly. A server serving old
 * code looks exactly like a server serving new code, and an updater that has silently
 * stopped looks exactly like one with nothing to do. So the record is read live on
 * every render (unlike the code stamp, which must be captured), and the two failures
 * that matter are kept apart: the update ran and refused, or the update stopped
 * running at all.
 *
 * Written by the five-minute sweep — tools/navigator/selfupdate.mjs, requirement
 * jwildfire/obot.roadmap#243. Absent is a real answer and the commonest one on a
 * machine where the sweep is not installed, so it says that rather than nothing.
 */
export const UPDATE_STALE_MIN = 16;

export function autoUpdate(workspace, now = new Date()) {
  const file = path.join(workspace, '.claude', 'session-hub', 'cache', 'selfupdate.json');
  let rec;
  try {
    rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return e.code === 'ENOENT'
      ? { state: 'absent', why: 'nothing on this machine records an automatic update — new code reaches this page only when somebody restarts it' }
      : { state: 'unreadable', why: 'the automatic-update record could not be read, so whether new code is reaching this page is unknown' };
  }
  const at = Date.parse(rec?.at);
  if (!Number.isFinite(at)) {
    return { state: 'unreadable', why: 'the automatic-update record carries no time, so how recently it ran is unknown' };
  }
  const ageMin = Math.max(0, Math.round((now.getTime() - at) / 60000));
  if (ageMin > UPDATE_STALE_MIN) {
    return { state: 'stale', ageMin, at: rec.at, why: `the last automatic update ran ${ageMin} minutes ago — the five-minute sweep that pulls new code has stopped` };
  }
  const checkout = rec.checkout ?? {};
  if (!checkout.ok) {
    return { state: 'failed', ageMin, at: rec.at, checkout, why: `the checkout could not be updated — ${checkout.reason ?? 'no reason was recorded'}` };
  }
  // A consumer that could not be restarted is the other half of the same failure: the
  // checkout moved and this page did not, which from the outside is indistinguishable
  // from an update that never ran.
  const broken = (rec.consumers ?? []).find((c) => c.ok === false);
  if (broken) {
    return { state: 'failed', ageMin, at: rec.at, checkout, why: `${broken.id} could not be restarted — ${broken.reason}` };
  }
  const restarted = (rec.consumers ?? []).find((c) => c.act === 'restart' || c.act === 'start');
  return {
    state: 'ok', ageMin, at: rec.at, checkout,
    moved: Boolean(checkout.moved),
    head: checkout.to ? String(checkout.to).slice(0, 7) : null,
    restartedAt: restarted?.at ?? null,
    deferred: (rec.consumers ?? []).find((c) => c.code === 'busy')?.reason ?? null,
  };
}
