// The Operations Dashboard's load-bearing parts: what the queue reads, what the
// store writes, and what the server refuses to serve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectBlockers } from '../lib/collect.mjs';
import { ensureStore, writeAnswer, readAnswers, readCache, writeCache, SENTINEL } from '../lib/store.mjs';
import { artifactPath, parseArgs } from '../ops-dashboard.mjs';
import { render, esc } from '../lib/render.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opsdash-'));

const emptyQueue = {
  rcs: { items: [], refreshing: false },
  blockers: { items: [] },
  decisions: { items: [] },
  items: [],
};

test('the ops store carries the local-only sentinel on everything it writes', () => {
  const ws = tmp();
  const rec = writeAnswer(ws, { artifact: 'a-slug', verdict: 'adopt-all', words: 'go' });
  const onDisk = fs.readFileSync(path.join(ws, '.claude', 'ops', 'answers', `${rec.id}.json`), 'utf8');
  assert.ok(onDisk.includes(SENTINEL), 'answer file must carry the sentinel the hub deploy greps for');
  assert.ok(fs.readFileSync(path.join(ws, '.claude', 'ops', 'README.md'), 'utf8').includes(SENTINEL));
});

test('answers are append-only — a second answer never overwrites the first', () => {
  const ws = tmp();
  writeAnswer(ws, { artifact: 'a', verdict: 'defer', words: 'not yet' });
  writeAnswer(ws, { artifact: 'a', verdict: 'approve', words: 'now' });
  const all = readAnswers(ws);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((a) => a.verdict).sort(), ['approve', 'defer']);
  assert.equal(all.every((a) => a.status === 'staged'), true);
});

test('a fresh store has no answers and does not throw reading them', () => {
  assert.deepEqual(readAnswers(tmp()), []);
});

test('a cache entry goes stale on the age it was asked for', () => {
  const ws = tmp();
  ensureStore(ws);
  writeCache(ws, 'rcs', [{ key: 'r#1' }]);
  assert.equal(readCache(ws, 'rcs', 30).stale, false);
  assert.deepEqual(readCache(ws, 'rcs', 30).value, [{ key: 'r#1' }]);

  // An hour-old sweep, written by hand because writeCache always stamps "now".
  const old = { at: new Date(Date.now() - 60 * 60000).toISOString(), value: [] };
  fs.writeFileSync(path.join(ws, '.claude', 'ops', 'cache', 'rcs.json'), JSON.stringify(old));
  assert.equal(readCache(ws, 'rcs', 30).stale, true);

  assert.equal(readCache(ws, 'never-written'), null);
});

test('blockers come off the local file, headlines only', () => {
  const ws = tmp();
  fs.mkdirSync(path.join(ws, '.claude'), { recursive: true });
  // The list's real schema, wrapped lines and all — a headline is the bold run
  // after the dates, not the first line of the entry.
  fs.writeFileSync(path.join(ws, '.claude', 'blockers.md'), `# Blockers

## Open

- [ ] filed 2026-08-15 \u00b7 verified 2026-08-15 \u2014 **workspace allowlist line for
  the thing** \u2014 fix: paste this. Provenance: a session hit it.

- [ ] filed 2026-08-15 \u00b7 UNVERIFIED tonight (device-side) \u2014 **an Apple Reminders list**
  \u2014 fix: make it.

- [x] filed 2026-08-01 \u2014 **already done** \u2014 should not appear.

## Resolved (kept as lifecycle evidence)

- [x] **An old one** \u2014 done.
`);
  const { items } = collectBlockers(ws);
  assert.deepEqual(items.map((i) => i.title), ['workspace allowlist line for the thing', 'an Apple Reminders list']);
  assert.equal(items[0].date, '2026-08-15');
  // The body is the sensitive half; a queue row must not carry it.
  assert.equal(items.every((i) => !i.detail), true);
});

test('a workspace with no blockers file degrades instead of throwing', () => {
  const { items, error } = collectBlockers(tmp());
  assert.deepEqual(items, []);
  assert.ok(error);
});

test('the artifact route refuses anything that is not a decision folder', () => {
  const hub = tmp();
  const dir = path.join(hub, 'reports', 'decisions', '2026-08-15-real');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<p>hi</p>');

  assert.ok(artifactPath(hub, '/artifact/2026-08-15-real/'));
  assert.equal(artifactPath(hub, '/artifact/2026-08-15-real/'), path.join(dir, 'index.html'));
  // Traversal, absolute escapes, and dotfiles: the server can reach the whole disk,
  // so a request path is not a filename until this says it is.
  assert.equal(artifactPath(hub, '/artifact/..%2F..%2Fetc/'), null);
  assert.equal(artifactPath(hub, '/artifact/../../../../etc/passwd'), null);
  assert.equal(artifactPath(hub, '/artifact/.ssh/'), null);
  assert.equal(artifactPath(hub, '/artifact/does-not-exist/'), null);
  assert.equal(artifactPath(hub, '/'), null);
  assert.equal(artifactPath(hub, '/answer'), null);
});

test('args default the hub to the clone inside the workspace', () => {
  const a = parseArgs(['--workspace', '/w']);
  assert.equal(a.hub, path.resolve('/w/obot.roadmap'));
  assert.equal(a.port, 7326);
  assert.equal(parseArgs(['--port', '9000']).port, 9000);
});

test('the page renders the three counts and the persistent header', () => {
  const html = render({
    queue: {
      ...emptyQueue,
      rcs: { items: [{ kind: 'rc', key: 'r#1', title: 'A release', detail: 'repo' }], refreshing: false },
      blockers: { items: [{ kind: 'blocker', key: 'b1', title: 'Your hands' }] },
      decisions: { items: [{ kind: 'decision', key: 's', title: 'A call', artifact: 's', detail: 'Awaiting' }] },
    },
    staged: [],
  });
  assert.ok(html.includes('1 release candidate<'), 'singular, not "1 release candidates"');
  assert.ok(html.includes('1 your hands'));
  assert.ok(html.includes('1 decision<'));
  assert.ok(html.includes('header class="top"'));
  assert.ok(html.includes('Adopt all recommendations'), '"adopt all" must be one action');
});

test('an empty queue says so rather than rendering an empty frame', () => {
  const html = render({ queue: emptyQueue, staged: [] });
  assert.ok(html.includes('Nothing is waiting on you.'));
});

test('queue text is escaped — artifact titles are not trusted markup', () => {
  const html = render({
    queue: { ...emptyQueue, decisions: { items: [{ kind: 'decision', key: 'x', artifact: 'x', title: '<img src=x onerror=alert(1)>' }] } },
    staged: [],
  });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x'));
  assert.equal(esc('a&b<c>'), 'a&amp;b&lt;c&gt;');
});
