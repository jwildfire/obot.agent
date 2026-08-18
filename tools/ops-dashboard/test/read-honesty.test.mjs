// A count is never stated about a source nobody read, and a write never proceeds on
// a read that failed.
//
// Requirement: jwildfire/obot.agent#215, the tail of #206. The guard that caused #206
// is gone, but the habits that made it invisible were spread across this tool: views
// re-deriving "was it read" from an error string, read-modify-write functions treating
// a failed read as an empty file, and an unreadable heartbeat becoming an accusation
// against a service that is fine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { render } from '../lib/render.mjs';
import { fsIntegrity } from '../lib/hub-collect.mjs';
import { readPins, writePin } from '../lib/pins.mjs';
import { readAnswers, recordAnswer, UNREADABLE, STORELESS } from '../lib/answers.mjs';
import { delivererState } from '../ops-dashboard.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ops-honesty-'));
const page = (over = {}) => render({
  queue: { rcs: { items: [], refreshing: false }, decisions: { items: [] }, config: { items: [] }, items: [] },
  ...over,
});

// --- the confident zero -----------------------------------------------------

test('a never-swept RC bucket is a dash with a reason, not a zero', () => {
  // Exactly what collectRCs returns with a sweep script present and no cache:
  // `error` is null on purpose, which is what made `!error` say "read".
  const html = page({
    queue: {
      rcs: { items: [], read: false, error: null, refreshing: true },
      decisions: { items: [] }, config: { items: [] }, items: [],
    },
  });
  assert.doesNotMatch(html, /0 release candidates/, 'zero is a measurement, and none was made');
  assert.match(html, /— release candidates/);
  assert.match(html, /no GitHub sweep has completed on this machine yet/);
});

test('a swept bucket that really is empty still says zero', () => {
  const html = page({
    queue: {
      rcs: { items: [], read: true, error: null, refreshing: false },
      decisions: { items: [] }, config: { items: [] }, items: [],
    },
  });
  assert.match(html, /0 release candidates/);
});

test('a fixture with no read flag keeps the old behaviour', () => {
  assert.match(page(), /0 release candidates/);
});

// --- the canary -------------------------------------------------------------

test('the canary is quiet in a clean process and names what changed in a dirty one', () => {
  assert.deepEqual(fsIntegrity(), { intact: true, replaced: [] });
  const real = fs.readFileSync;
  fs.readFileSync = () => { throw new Error('not today'); };
  try {
    const i = fsIntegrity();
    assert.equal(i.intact, false);
    assert.deepEqual(i.replaced, ['fs.readFileSync']);
  } finally {
    fs.readFileSync = real;
  }
  assert.equal(fsIntegrity().intact, true, 'and it clears again when the reader is put back');
});

test('a disarmed process says so above everything else on the page', () => {
  const html = page({ integrity: { intact: false, replaced: ['fs.readFileSync', 'fs.readdirSync'] } });
  assert.match(html, /This page cannot be trusted right now/);
  assert.match(html, /fs\.readFileSync, fs\.readdirSync/);
  // Above the header: he must not have to scroll past three panels of wrong numbers.
  assert.ok(html.indexOf('cannot be trusted') < html.indexOf('<header class="top">'));
});

test('an intact process adds nothing to the page', () => {
  assert.doesNotMatch(page({ integrity: { intact: true, replaced: [] } }), /cannot be trusted/);
  assert.doesNotMatch(page({ integrity: null }), /cannot be trusted/);
});

// --- writes that must not proceed on a failed read --------------------------

test('a pin is never written on top of a pin file that could not be read', () => {
  const ws = tmp();
  fs.mkdirSync(path.join(ws, '.claude', 'ops'), { recursive: true });
  // A directory where the pin file goes: readable path, unreadable file (EISDIR).
  fs.mkdirSync(path.join(ws, '.claude', 'ops', 'pins.json'), { recursive: true });

  assert.equal(readPins(ws).read, false);
  assert.throws(() => writePin(ws, { key: 'W0001', pinned: true }), /will not be overwritten/);
});

test('a pin still writes on a machine that has simply never pinned anything', () => {
  const ws = tmp();
  assert.equal(readPins(ws).read, true, 'absent is a real empty set, not a failure');
  const out = writePin(ws, { key: 'W0001', pinned: true });
  assert.equal(out.overrides.W0001, true);
  assert.equal(readPins(ws).overrides.W0001, true);
});

test('an answer is not recorded against a store that could not be listed', (t) => {
  const ws = tmp();
  const dir = path.join(ws, '.claude', 'ops', 'answers');
  fs.mkdirSync(dir, { recursive: true });
  fs.chmodSync(dir, 0o000);
  try {
    // Running as root defeats the permission bits, and there is no honest way to
    // stage the failure then. Skipping beats a test that silently proves nothing.
    try { fs.readdirSync(dir); t.skip('running as a user that ignores mode 000'); return; } catch { /* good */ }

    const all = readAnswers(ws);
    assert.equal(all.length, 0);
    assert.ok(all[UNREADABLE], 'and it is marked as unreadable rather than as storeless');
    assert.equal(all[STORELESS], undefined);
    assert.throws(
      () => recordAnswer(ws, { artifact: '2026-08-18-x', verdict: 'yes', words: 'go' }),
      /could not be told what it replaces/,
    );
  } finally {
    fs.chmodSync(dir, 0o755);
  }
});

test('a first answer on a fresh machine still records', () => {
  const ws = tmp();
  const all = readAnswers(ws);
  assert.ok(all[STORELESS], 'no store yet is storeless, not unreadable');
  assert.equal(all[UNREADABLE], undefined);
});

// --- an unknown is not an accusation ----------------------------------------

const answersWaiting = [{ artifact: 'a', status: 'captured', at: '2026-08-18T00:00:00.000Z', verdict: 'yes' }];

test('an unreadable sweep file never accuses a healthy Navigator', () => {
  const ws = tmp();
  fs.mkdirSync(path.join(ws, '.claude', 'session-hub', 'navigator-state.md'), { recursive: true });
  const d = delivererState(ws);
  assert.equal(d.alive, null, 'not false — this process does not know');
  assert.equal(d.unreadable, true);

  const html = page({ answers: answersWaiting, deliverer: d });
  assert.doesNotMatch(html, /going nowhere/);
  assert.doesNotMatch(html, /launchctl kickstart/);
  assert.match(html, /Whether anything is listening could not be determined/);
});

test('a sweep that genuinely is not installed still gets the alarm and the remedy', () => {
  const ws = tmp();
  const d = delivererState(ws);
  assert.equal(d.alive, false);
  assert.equal(d.missing, true);

  const html = page({ answers: answersWaiting, deliverer: d });
  assert.match(html, /going nowhere/);
  assert.match(html, /launchctl kickstart/);
});

// --- the roster's honesty, no longer keyed on the call that cannot fail ------

const { collectRoster } = await import('../lib/roster.mjs');

test('a source that exists and cannot be read is not counted as read', () => {
  const ws = tmp();
  fs.mkdirSync(path.join(ws, '.claude'), { recursive: true });
  // The worker ledger, present and unopenable.
  fs.mkdirSync(path.join(ws, '.claude', 'workers.journal'), { recursive: true });

  const r = collectRoster({ workspace: ws, hub: tmp(), jobsDir: path.join(tmp(), 'nope') });
  assert.equal(r.sources.workers.present, false, 'existsSync says yes; the read did not');
  assert.match(r.sources.workers.note, /could not be read/);
});

test('a source that is simply not there stays the first-morning case', () => {
  const ws = tmp();
  const r = collectRoster({ workspace: ws, hub: tmp(), jobsDir: path.join(tmp(), 'nope') });
  assert.equal(r.sources.workers.present, false);
  assert.equal(r.sources.workers.note, '', 'absent carries no fault — it has its own notice and remedy');
});

test('a readable ledger reads', () => {
  const ws = tmp();
  fs.mkdirSync(path.join(ws, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.claude', 'workers.journal'), '');
  const r = collectRoster({ workspace: ws, hub: tmp(), jobsDir: path.join(tmp(), 'nope') });
  assert.equal(r.sources.workers.present, true);
});

// --- a damaged cache is not a sweep that has not run yet ---------------------

const { collectRCs } = await import('../lib/collect.mjs');

test('a cache that cannot be parsed is reported, not waited on forever', () => {
  const ws = tmp();
  fs.mkdirSync(path.join(ws, '.claude', 'ops', 'cache'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.claude', 'ops', 'cache', 'rcs-lane.json'), '{ truncated');

  const r = collectRCs(ws, { agent: null });
  assert.equal(r.read, false);
  assert.match(r.error, /not readable JSON/);
  assert.equal(r.refreshing, false, 'a damaged cache is not a sweep in flight');
});

test('a machine that has simply never swept still says so in its own words', () => {
  const r = collectRCs(tmp(), { agent: null });
  assert.equal(r.read, false);
  assert.match(r.error, /no sweep script/);
});
