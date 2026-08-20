// The vocabulary he is told to say, and the only place it is decided.
//
// Requirement jwildfire/obot.roadmap#265: "The subject words come from the episodes
// themselves. Whatever the scripts tell him to say IS the vocabulary — inventing a
// parallel list is the two-sources-of-truth defect."
//
// So the episode and the router both read this module and neither has its own list.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  allocateHandles, buildQueue, deriveHandleWords, openDecisions, phoneticKey, readQueue, writeQueue,
} from '../lib/handles.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'voice-handles-'));

/** A hub clone with just the one file the queue is derived from. */
function hub(artifacts) {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'reports', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'reports', 'decisions', 'registry.json'),
    JSON.stringify({ prefix: 'D', artifacts }, null, 2));
  return dir;
}

const entry = (id, slug, state = 'open', extra = {}) => ({
  id, slug, date: slug.slice(0, 10), title: `${id} title`, state, status: state, questions: [], ...extra,
});

test('a handle is the slug in words, with the date stripped', () => {
  assert.deepEqual(deriveHandleWords('2026-08-20-branch-protections'), ['branch', 'protections']);
  assert.deepEqual(deriveHandleWords('2026-08-16-scheduled-sessions-assessment'),
    ['scheduled', 'sessions', 'assessment']);
});

test('only open decisions are in the queue, and they are numbered for reading aloud', () => {
  const h = hub([
    entry('D0001', '2026-08-14-merge-lane-classifier-denials', 'decided'),
    entry('D0019', '2026-08-16-scheduled-sessions-assessment', 'open'),
    entry('D0022', '2026-08-20-branch-protections', 'open'),
    entry('D0002', '2026-08-14-app-plan-rewrite', 'closed'),
  ]);
  const open = openDecisions(h);
  assert.equal(open.read, true);
  assert.deepEqual(open.decisions.map((d) => d.id), ['D0019', 'D0022']);
  const q = allocateHandles(open.decisions);
  assert.deepEqual(q.map((d) => d.ordinal), [1, 2]);
  assert.equal(q[1].handle, 'branch protections');
});

test('an unreadable registry is a failed read, never an empty queue', () => {
  const open = openDecisions(tmp());
  assert.equal(open.read, false);
  assert.equal(open.decisions.length, 0);
  assert.match(open.why, /registry/i);
});

test('a shared prefix is extended until the handles are different words', () => {
  const q = allocateHandles([
    { id: 'D0019', slug: '2026-08-16-scheduled-sessions-assessment', title: 'a' },
    { id: 'D0023', slug: '2026-08-19-scheduled-sessions-readiness', title: 'b' },
  ]);
  assert.notEqual(q[0].handle, q[1].handle);
  assert.match(q[0].handle, /assessment/);
  assert.match(q[1].handle, /readiness/);
  for (const d of q) assert.deepEqual(d.collidesWith, []);
});

test('near-homophones are found and said out loud, not shipped as a vocabulary', () => {
  // "branch protection" and "branch protections" survive no transcription intact.
  const q = allocateHandles([
    { id: 'D0022', slug: '2026-08-20-branch-protections', title: 'a' },
    { id: 'D0024', slug: '2026-08-21-branch-protection', title: 'b' },
  ]);
  assert.deepEqual(q[0].collidesWith, ['D0024']);
  assert.deepEqual(q[1].collidesWith, ['D0022']);
});

test('the phonetic key ignores what a transcription mangles', () => {
  assert.equal(phoneticKey('protections'), phoneticKey('protection'));
  assert.equal(phoneticKey('census'), phoneticKey('censes'));
  assert.notEqual(phoneticKey('branch'), phoneticKey('spend'));
});

test('the queue is written and read back with the fingerprint of what was open', () => {
  const ws = tmp();
  const h = hub([entry('D0022', '2026-08-20-branch-protections', 'open')]);
  const q = buildQueue(h, { now: new Date('2026-08-20T12:00:00Z') });
  assert.equal(q.decisions.length, 1);
  assert.equal(q.decisions[0].handle, 'branch protections');
  assert.ok(q.fingerprint, 'a queue carries the fingerprint of the set it was read from');
  writeQueue(ws, q);
  const back = readQueue(ws);
  assert.equal(back.read, true);
  assert.equal(back.queue.fingerprint, q.fingerprint);
  assert.equal(back.queue.decisions[0].handle, 'branch protections');
});

test('a queue that was never written reads as absent, not as empty', () => {
  const back = readQueue(tmp());
  assert.equal(back.read, true, 'nothing written is a legitimate empty answer');
  assert.equal(back.queue, null);
});

test('the fingerprint changes when the open set changes, and not when it does not', () => {
  const a = buildQueue(hub([entry('D0022', '2026-08-20-branch-protections', 'open')]));
  const b = buildQueue(hub([entry('D0022', '2026-08-20-branch-protections', 'open')]));
  const c = buildQueue(hub([
    entry('D0022', '2026-08-20-branch-protections', 'open'),
    entry('D0019', '2026-08-16-scheduled-sessions-assessment', 'open'),
  ]));
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, c.fingerprint);
});
