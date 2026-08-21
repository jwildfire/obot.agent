// The morning fold's queue line, on a machine with no history.
//
// Requirement: jwildfire/obot.roadmap#223, task jwildfire/obot.agent#306. Worker W0105.
//
// Rehearsed rather than reasoned about: `--dry-run --no-publish` against a scratch
// `HOME`, an empty workspace and an unauthenticated `gh` printed
//
//   queue: 0 RC · 4 decisions · 0 todos · ? config items
//
// Three of those four numbers are right. The config count already renders `?` when its
// source could not be read — the same fix, made once, in the same line — while the RC
// count came from a sweep snapshot that does not exist and the todo count from a
// scratchpad directory that does not exist. A `0` and an unread file look identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { render } from '../fold.mjs';
import { sweptEvents } from '../lib/collect.mjs';

const base = {
  at: '2026-08-21T15:00:00.000Z',
  window: { since: '2026-08-20T15:00:00.000Z', until: '2026-08-21T15:00:00.000Z' },
  verdict: 'unknown', diary: false, briefing: false, push: false,
  reasons: {}, unknowns: [], dryRun: true,
  counts: { rcs: 0, decisions: 4, todos: 0, blockers: null, commits: 69, events: 0 },
};

test('a queue line does not print a count for a source it could not read', () => {
  const out = render({ ...base, counts: { ...base.counts, rcsRead: false, todosRead: false } });
  const line = out.split('\n').find((l) => l.startsWith('queue:'));
  assert.ok(line, 'the queue line has to still be there');
  assert.doesNotMatch(line, /\b0 RC\b/, 'a sweep snapshot that does not exist is not zero release candidates');
  assert.doesNotMatch(line, /\b0 todos\b/, 'a scratchpad that does not exist is not zero todos');
  assert.match(line, /\? RC/);
  assert.match(line, /\? todos/);
  assert.match(line, /\? config items/, 'the one that was already right stays right');
  assert.match(line, /4 decisions/, 'and a source that WAS read still prints its number');
});

test('a sweep that has never once read GitHub does not supply a release-candidate count', () => {
  // The state the machine is actually in five minutes after its first boot: the sweep
  // has run, so a snapshot file exists and is fresh, and every repository in it failed
  // to list. `lastGoodAt: null` is the sweep saying so. Without this the fold read a
  // present, fresh, empty snapshot as a measured queue of zero.
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-fresh-'));
  fs.mkdirSync(path.join(ws, '.claude', 'session-hub', 'cache'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.claude', 'session-hub', 'cache', 'navigator-rc.json'),
    JSON.stringify({ lastGoodAt: null, sweptIso: new Date().toISOString(), snapshot: {}, events: [] }));
  const swept = sweptEvents(ws, null, { now: new Date() });
  assert.equal(swept.unknown, false, 'the file is there and fresh; that part was read');
  assert.equal(swept.snapshotRead, false, 'but no pass ever read GitHub, so the queue is unmeasured');

  fs.writeFileSync(path.join(ws, '.claude', 'session-hub', 'cache', 'navigator-rc.json'),
    JSON.stringify({ lastGoodAt: '2026-08-21T11:00:00.000Z', sweptIso: new Date().toISOString(), snapshot: {}, events: [] }));
  const good = sweptEvents(ws, null, { now: new Date() });
  assert.equal(good.snapshotRead, true, 'a sweep that has read GitHub reports a real zero');
});

test('a source that was read and holds nothing still prints its zero', () => {
  const out = render({ ...base, counts: { ...base.counts, blockers: 0, rcsRead: true, todosRead: true } });
  const line = out.split('\n').find((l) => l.startsWith('queue:'));
  assert.match(line, /0 RC/);
  assert.match(line, /0 todos/);
  assert.match(line, /0 config items/);
});
