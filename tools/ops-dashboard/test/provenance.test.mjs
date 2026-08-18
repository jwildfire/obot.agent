// What the page says about itself: the commit it is running, and the commit its
// decisions came from. Both halves went wrong on 2026-08-16 and neither said so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  autoUpdate, captureCode, codeState, commitInfo, hubDirty, materialiseHub, resolveHub,
} from '../lib/provenance.mjs';
import { provenanceLine } from '../lib/render.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prov-'));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], {
  encoding: 'utf8',
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
}).trim();

/** A repo with one commit, plus a file to move it forward with. */
function repo({ decisions = 'seed' } = {}) {
  const dir = tmp();
  git(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'reports', 'decisions'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'reports', 'decisions', 'README.md'), decisions);
  fs.writeFileSync(path.join(dir, 'scripts', 'status-repos.csv'), 'repo\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'seed');
  return dir;
}

test('the running commit is the one captured at load, not the one on disk now', () => {
  const dir = repo();
  const captured = captureCode(dir);
  const served = commitInfo(dir).short;

  // The checkout moves on beneath the running process — two merges land.
  for (const n of [1, 2]) {
    fs.writeFileSync(path.join(dir, `f${n}`), 'x');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', `later ${n}`);
  }

  const state = codeState(captured);
  assert.equal(state.short, served, 'it must still name the commit it is serving');
  assert.equal(state.behind, 2);
  assert.equal(state.ok, false);
  assert.notEqual(state.head, served);
});

test('a current process says so rather than saying nothing', () => {
  const dir = repo();
  const state = codeState(captureCode(dir));
  assert.equal(state.ok, true);
  assert.equal(state.behind, 0);
  // The healthy path still carries the sha and the age — a line that only appears
  // when something is late would not have caught either 2026-08-16 case.
  const html = provenanceLine({ code: state });
  assert.match(html, new RegExp(state.short));
  assert.match(html, /current with this checkout/);
  assert.match(html, /class="prov ok"/);
});

test('a stale build names the commit, the gap and how to fix it', () => {
  const html = provenanceLine({ code: { short: 'abc1234', ageMin: 700, behind: 11 } });
  assert.match(html, /abc1234/);
  assert.match(html, /11 commits behind this checkout/);
  assert.match(html, /pkill -f/);
  assert.match(html, /class="prov warn"/);
  assert.match(html, /12h old/);
  // No inline bold anywhere (@jwildfire, 2026-08-16) — the warn tone is the callout.
  assert.doesNotMatch(html, /<strong>/);
});

test('an unknown commit is reported as unknown, never as fine', () => {
  const state = codeState(captureCode(tmp()));
  assert.equal(state.unknown, true);
  assert.match(provenanceLine({ code: state }), /could not be read/);
  assert.match(provenanceLine({ code: state }), /class="prov warn"/);
});

test('a clone level with its upstream is read as-is', () => {
  const origin = repo();
  const clone = tmp();
  execFileSync('git', ['clone', '-q', origin, clone]);
  const r = resolveHub(clone, tmp());
  assert.equal(r.source, 'clone');
  assert.equal(r.root, clone);
  assert.equal(r.behind, 0);
  assert.equal(r.warn, null);
});

test('a clean clone behind its upstream is read at the upstream, not left stale', () => {
  // This is D0018: decided in the morning, pushed, and still listed as awaiting him
  // that night because the clone the dashboard reads had never pulled.
  const origin = repo({ decisions: 'Awaiting @jwildfire' });
  const clone = tmp();
  execFileSync('git', ['clone', '-q', origin, clone]);
  fs.writeFileSync(path.join(origin, 'reports', 'decisions', 'README.md'), 'Decided 2026-08-16');
  git(origin, 'add', '-A');
  git(origin, 'commit', '-qm', 'decided');
  execFileSync('git', ['-C', clone, 'fetch', '-q', 'origin']);

  const r = resolveHub(clone, tmp());
  assert.equal(r.behind, 1);
  assert.notEqual(r.root, clone);
  assert.match(r.source, /origin\/main/);
  assert.equal(r.warn, null);
  assert.equal(fs.readFileSync(path.join(r.root, 'reports', 'decisions', 'README.md'), 'utf8'), 'Decided 2026-08-16');
  // His checkout is never moved to get that answer.
  assert.equal(fs.readFileSync(path.join(clone, 'reports', 'decisions', 'README.md'), 'utf8'), 'Awaiting @jwildfire');
  assert.equal(commitInfo(clone).sha, commitInfo(clone, 'HEAD').sha);

  assert.match(provenanceLine({ hub: r }), /your clone is 1 commit behind it/);
});

test('uncommitted decision edits outrank a tidier upstream, and say so', () => {
  const origin = repo();
  const clone = tmp();
  execFileSync('git', ['clone', '-q', origin, clone]);
  fs.writeFileSync(path.join(origin, 'reports', 'decisions', 'README.md'), 'moved on');
  git(origin, 'add', '-A');
  git(origin, 'commit', '-qm', 'upstream');
  execFileSync('git', ['-C', clone, 'fetch', '-q', 'origin']);
  fs.writeFileSync(path.join(clone, 'reports', 'decisions', 'README.md'), 'his unsaved work');

  assert.equal(hubDirty(clone), true);
  const r = resolveHub(clone, tmp());
  assert.equal(r.root, clone, 'his uncommitted work is never dropped for a fresher copy');
  assert.match(r.warn, /uncommitted decision edits/);
  assert.match(provenanceLine({ hub: r }), /class="prov warn"/);
});

test('materialising is idempotent and keeps only the tree it is serving', () => {
  const origin = repo();
  const cache = tmp();
  const sha = commitInfo(origin).sha;
  const a = materialiseHub(origin, sha, cache);
  assert.equal(materialiseHub(origin, sha, cache), a, 'a second call reuses the tree');
  assert.ok(fs.existsSync(path.join(a, 'scripts', 'status-repos.csv')));

  fs.writeFileSync(path.join(origin, 'f'), 'x');
  git(origin, 'add', '-A');
  git(origin, 'commit', '-qm', 'next');
  const b = materialiseHub(origin, commitInfo(origin).sha, cache);
  assert.notEqual(b, a);
  assert.deepEqual(fs.readdirSync(cache).filter((n) => n.startsWith('hub-')), [path.basename(b)]);
});

test('a hub that is not a repository is read as-is and admits it', () => {
  const r = resolveHub(tmp(), tmp());
  assert.equal(r.source, 'clone');
  assert.match(r.warn, /not a git repository/);
});

// ── The third half: is anything pulling new code onto this machine at all ──────────
//
// jwildfire/obot.roadmap#243. The first two halves report the snapshot; this one
// reports the mechanism, because the mechanism is the part that fails invisibly. An
// updater that has quietly stopped looks exactly like one with nothing to do.

const wsWith = (record) => {
  const ws = tmp();
  const dir = path.join(ws, '.claude', 'session-hub', 'cache');
  fs.mkdirSync(dir, { recursive: true });
  if (record) fs.writeFileSync(path.join(dir, 'selfupdate.json'), JSON.stringify(record));
  return ws;
};

const ok = (over = {}) => ({
  at: new Date().toISOString(),
  checkout: { ok: true, code: 'current', moved: false, to: 'abc1234deadbeef', reason: 'already at `origin/main`' },
  consumers: [],
  ...over,
});

test('a machine with no updater says so rather than saying nothing', () => {
  const u = autoUpdate(wsWith(null));
  assert.equal(u.state, 'absent');
  assert.match(u.why, /only when somebody restarts it/);
});

test('an updater that stopped running is a failure of its own, not a quiet success', () => {
  const old = ok({ at: new Date(Date.now() - 47 * 60000).toISOString() });
  const u = autoUpdate(wsWith(old));
  assert.equal(u.state, 'stale');
  assert.equal(u.ageMin, 47);
  assert.match(u.why, /has stopped/);
});

test('a refused fast-forward reaches the page with its reason', () => {
  const u = autoUpdate(wsWith(ok({
    checkout: { ok: false, code: 'dirty', reason: 'the checkout has uncommitted changes to 2 tracked files' },
  })));
  assert.equal(u.state, 'failed');
  assert.match(u.why, /uncommitted changes to 2 tracked files/);
});

test('a checkout that moved while the restart failed is a failure, not a success', () => {
  const u = autoUpdate(wsWith(ok({
    checkout: { ok: true, code: 'moved', moved: true, to: 'newsha0', reason: 'fast-forwarded 2 commits' },
    consumers: [{ id: 'ops-dashboard', act: 'restart', ok: false, reason: 'nothing answered on http://127.0.0.1:7326/' }],
  })));
  assert.equal(u.state, 'failed');
  assert.match(u.why, /ops-dashboard could not be restarted/);
});

test('a healthy run reports the commit it landed on and when the page restarted', () => {
  const at = new Date().toISOString();
  const u = autoUpdate(wsWith(ok({
    checkout: { ok: true, code: 'moved', moved: true, to: 'abcdef1234567', reason: 'fast-forwarded 1 commit' },
    consumers: [{ id: 'ops-dashboard', act: 'restart', ok: true, at, reason: 'the dashboard answered' }],
  })));
  assert.equal(u.state, 'ok');
  assert.equal(u.head, 'abcdef1');
  assert.equal(u.restartedAt, at);
});

test('a stale build with the sweep armed is told to wait, not told to run pkill', () => {
  const html = provenanceLine({
    code: { short: 'abc1234', ageMin: 30, behind: 3 },
    update: { state: 'ok', ageMin: 1, head: 'def5678', deferred: '1 request is in flight', deferrals: 2, deferralLimit: 3 },
  });
  assert.match(html, /waiting for the page to settle/);
  assert.doesNotMatch(html, /pkill/, 'telling him to restart a page that restarts itself is how a true line becomes noise');
  // The wait has to carry its own end. "Waiting for the page to be idle" was an
  // unbounded wait written as an imminent one, and the person reading it was the
  // reason it was waiting (jwildfire/obot.agent#258).
  assert.match(html, /deferral 2 of 3/);
  assert.match(html, /restarts regardless/);
});

test('and the promise underneath it is bounded too, since it is the one he acts on', () => {
  const html = provenanceLine({
    code: { short: 'abc1234', ageMin: 30, behind: 3 },
    update: { state: 'ok', ageMin: 1, head: 'def5678', deferred: null },
  });
  assert.match(html, /within fifteen whether it does or not/,
    'the old line promised a restart "once nobody is reading it", which is a promise a reader falsifies by reading');
});

test('a record from before the count existed still reports the deferral, rather than reporting nothing', () => {
  const u = autoUpdate(wsWith(ok({
    consumers: [{ id: 'ops-dashboard', act: 'skip', code: 'busy', ok: true, reason: 'the page was opened 4s ago' }],
  })));
  assert.equal(u.state, 'ok');
  assert.match(String(u.deferred), /the page was opened/);
  assert.equal(u.deferrals, null, 'an old record has no count, and a count must never be invented');
});

test('a stale build with no updater still names the command, and warns', () => {
  const html = provenanceLine({
    code: { short: 'abc1234', ageMin: 30, behind: 11 },
    update: { state: 'absent', why: 'nothing on this machine records an automatic update' },
  });
  assert.match(html, /pkill/);
  assert.match(html, /class="prov warn"/);
});

test('a failed update warns even when the running code is current', () => {
  const html = provenanceLine({
    code: { short: 'abc1234', ageMin: 5, behind: 0 },
    update: { state: 'failed', why: 'the checkout could not be updated — the checkout has uncommitted changes to 2 tracked files' },
  });
  assert.match(html, /class="prov warn"/, 'a checkout that cannot move is a warning even when this process is current');
  assert.match(html, /uncommitted changes/);
  assert.doesNotMatch(html, /<strong>/);
});

test('a current machine says which commit it is current with, on the healthy path too', () => {
  const html = provenanceLine({
    code: { short: 'abc1234', ageMin: 5, behind: 0 },
    update: { state: 'ok', ageMin: 2, head: 'abc1234', restartedAt: null, deferred: null },
  });
  assert.match(html, /updates: checked 2m ago; the checkout is current with its remote/);
  assert.match(html, /class="prov ok"/);
});

test('the page says when this process started, not only how old its code is', () => {
  // Two different questions, and #243 asks for both: "is this build recent" and "did
  // this page actually restart". A sha answers neither on its own.
  const dir = tmp();
  const captured = { started: { sha: 'a'.repeat(40), short: 'abc1234', at: '2026-08-17T21:00:00Z' },
                     startedAt: '2026-08-17T21:30:00Z', root: dir };
  const st = codeState(captured, new Date('2026-08-17T21:42:00Z'));
  assert.equal(st.upMin, 12);
  assert.match(provenanceLine({ code: { ...st, behind: 0, unknown: false } }), /started 12m ago/);
});

test('a process whose start time is unknown says nothing rather than "just now"', () => {
  const st = codeState({ started: { sha: 'b'.repeat(40), short: 'def5678', at: '2026-08-17T21:00:00Z' }, root: tmp() },
    new Date('2026-08-17T21:42:00Z'));
  assert.equal(st.upMin, null);
  assert.doesNotMatch(provenanceLine({ code: { ...st, behind: 0 } }), /started/);
});

test('the restart time survives the five minutes after a restart', () => {
  // The obvious source is the automatic-update record, and it is the wrong one: it
  // describes the most recent sweep, so the answer would blink out while the process
  // it described was still running.
  const html = provenanceLine({
    code: { short: 'abc1234', ageMin: 5, upMin: 200, behind: 0 },
    update: { state: 'ok', ageMin: 2, head: 'abc1234', restartedAt: null, deferred: null },
  });
  assert.match(html, /started 3h ago/);
});
