// What the page says about itself: the commit it is running, and the commit its
// decisions came from. Both halves went wrong on 2026-08-16 and neither said so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  captureCode, codeState, commitInfo, hubDirty, materialiseHub, resolveHub,
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
