// The three ways a dictated answer of his could still be lost or published, each
// reproduced by an adversarial review of jwildfire/obot.agent#279 before it could
// happen to him.
//
//   1. NOTHING OPEN. The registry read fine and returned no open decisions — the normal
//      state five minutes after his last answer was applied — so a sentence that named
//      a decision was not an answer to anything, fell through to "idea", and was POSTED
//      to the public board and completed. The narration had just promised him that
//      anything unmatched "stays on the list, so you will see it did not land".
//   2. A STALE SENTENCE, A NEW QUEUE. `poll` re-reads every uncompleted item every five
//      minutes and leaves ideas on the list. When a new decision was published whose
//      name matched the front of an old idea, that idea became his answer to it, was
//      stamped and completed. An answer has to have been said AFTER he was read the
//      list it is an answer to.
//   3. A STAMP THAT FAILED. The rename and the completion are what stop an item being
//      read again, and their results were discarded.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { pendingAnswers } from '../../ops-dashboard/lib/answers.mjs';
import { buildQueue, openDecisions } from '../lib/handles.mjs';
import { pollReminders } from '../lib/reminders.mjs';
import { isPrivate, keepPrivate } from '../lib/private.mjs';
import { readUnrouted, routeSpoken } from '../lib/route.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const NOW = new Date('2026-08-20T14:00:00Z');
const FS_ = String.fromCharCode(31);
const RS_ = String.fromCharCode(30);

const D22 = (state, extra = {}) => ({
  id: 'D0022', slug: '2026-08-20-branch-protections', date: '2026-08-20', state, status: state,
  title: 'Branch protections', questions: [], ...extra,
});

function hub(reg) {
  const dir = tmp('leak-hub-');
  fs.mkdirSync(path.join(dir, 'reports', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'reports', 'decisions', 'registry.json'), JSON.stringify(reg));
  return dir;
}

test('NOTHING OPEN: a sentence naming a decision he answered yesterday is UNROUTED, never an idea', () => {
  const h = hub({ prefix: 'D', artifacts: [D22('decided', { decidedOn: '2026-08-19' })] });
  const ws = tmp('leak-ws-');
  const r = routeSpoken('branch protections, actually make it option C', { workspace: ws, hub: h, queue: null, now: NOW });
  assert.equal(r.kind, 'unrouted', 'this must never be posted to a public board');
  assert.equal(r.reasonKind, 'already-decided');
  assert.match(r.reason, /decided|answered/i);
  assert.equal(readUnrouted(ws).items[0].text, 'branch protections, actually make it option C');
});

test('and a decision decided long ago does not swallow an ordinary idea', () => {
  const h = hub({ prefix: 'D', artifacts: [D22('decided', { decidedOn: '2026-01-05' })] });
  const ws = tmp('leak-ws-');
  const r = routeSpoken('branch protections would be a good blog post', { workspace: ws, hub: h, queue: null, now: NOW });
  assert.equal(r.kind, 'idea');
});

test('a registry with no artifacts key at all is a FAILED READ, not an empty decision set', () => {
  // Schema drift reads as "he has decided everything", and from then on every answer
  // he dictates is an idea and is published.
  const open = openDecisions(hub({ prefix: 'D', decisions: [D22('open')] }));
  assert.equal(open.read, false);
  assert.match(open.why, /artifacts/i);
});

test('and with the registry unreadable, a naming sentence is refused rather than posted', () => {
  const ws = tmp('leak-ws-');
  const r = routeSpoken('branch protections, option A', { workspace: ws, hub: hub({ prefix: 'D' }), queue: null, now: NOW });
  assert.equal(r.kind, 'unrouted');
});

/** A fake Reminders app that carries creation dates and can be told to fail a write. */
function fake(items, { failWrites = false } = {}) {
  const sent = [];
  let payload = items.map((i) => [i.id, i.name, i.body ?? '', i.created ?? ''].join(FS_)).join(RS_);
  return {
    sent,
    run(script) {
      sent.push(script);
      if (/repeat with r in/.test(script)) return { ok: true, out: payload };
      if (failWrites) return { ok: false, why: 'osascript: the reminder could not be written' };
      if (/set completed of/.test(script)) {
        const id = /whose id is "([^"]+)"/.exec(script)?.[1];
        payload = payload.split(RS_).filter(Boolean).filter((rec) => rec.split(FS_)[0] !== id).join(RS_);
      }
      return { ok: true, out: '' };
    },
  };
}

const OPEN_HUB = () => hub({ prefix: 'D', artifacts: [D22('open')] });

test('STALE: a sentence said before the queue was read to him can never be an answer to it', () => {
  const h = OPEN_HUB();
  const ws = tmp('leak-ws-');
  const queue = buildQueue(h, { now: NOW });                       // read to him at 14:00
  const f = fake([{ id: 'a1', name: 'branch protections, option A', created: '2026-08-18T09:00:00.000Z' }]);
  const out = pollReminders({ workspace: ws, hub: h, queue, run: f.run, now: NOW });

  assert.equal(out.routed.length, 0, 'two days older than the list it would be answering');
  assert.equal(out.stale.length, 1);
  assert.equal(pendingAnswers(ws, { hub: h }).length, 0);
  assert.equal(f.sent.some((s) => /set name of|set completed of/.test(s)), false, 'and it is left exactly as it is');
});

test('a sentence said after the queue was read to him routes as normal', () => {
  const h = OPEN_HUB();
  const ws = tmp('leak-ws-');
  const queue = buildQueue(h, { now: NOW });
  const f = fake([{ id: 'a1', name: 'branch protections, option A', created: '2026-08-20T14:30:00.000Z' }]);
  const out = pollReminders({ workspace: ws, hub: h, queue, run: f.run, now: NOW });
  assert.equal(out.routed.length, 1);
  assert.equal(pendingAnswers(ws, { hub: h }).length, 1);
});

test('with no queue ever read to him, the scheduled poll answers nothing and says so', () => {
  const h = OPEN_HUB();
  const ws = tmp('leak-ws-');
  const f = fake([{ id: 'a1', name: 'branch protections, option A', created: '2026-08-20T14:30:00.000Z' }]);
  const out = pollReminders({ workspace: ws, hub: h, queue: null, run: f.run, now: NOW });
  assert.equal(out.routed.length, 0);
  assert.equal(out.stale.length, 1);
  assert.match(out.why, /ever been read/i);
});

test('a reminder with no creation date is treated as stale rather than routed on a guess', () => {
  const h = OPEN_HUB();
  const ws = tmp('leak-ws-');
  const queue = buildQueue(h, { now: NOW });
  const f = fake([{ id: 'a1', name: 'branch protections, option A', created: '' }]);
  const out = pollReminders({ workspace: ws, hub: h, queue, run: f.run, now: NOW });
  assert.equal(out.routed.length, 0);
  assert.equal(out.stale.length, 1);
});

test('A FAILED STAMP is reported, not discarded — the stamp is what stops a re-read', () => {
  const h = OPEN_HUB();
  const ws = tmp('leak-ws-');
  const queue = buildQueue(h, { now: NOW });
  const f = fake([{ id: 'a1', name: 'branch protections, option A', created: '2026-08-20T14:30:00.000Z' }],
    { failWrites: true });
  const out = pollReminders({ workspace: ws, hub: h, queue, run: f.run, now: NOW });
  assert.equal(out.routed.length, 1, 'the answer itself was recorded and that stands');
  assert.equal(out.unstamped.length, 1, 'but the receipt did not happen and something has to say so');
  assert.match(out.unstamped[0].why, /could not be written/);
});

test('a private note is REFUSED rather than written into a git checkout', () => {
  const repo = tmp('leak-repo-');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  const dest = path.join(repo, 'sub', 'private-inbox.md');
  const r = keepPrivate(repo, 'private: something', { file: dest });
  assert.equal(r.written, false);
  assert.match(r.why, /git repository/i);
  assert.equal(fs.existsSync(dest), false, 'and nothing is left behind on the way to refusing');
});

test('a private note outside a checkout is written, with the marker stripped', () => {
  const ws = tmp('leak-ws-');
  const dest = path.join(ws, '.claude', 'private-inbox.md');
  const r = keepPrivate(ws, ' Private : my salary thoughts', { file: dest, now: NOW });
  assert.equal(r.written, true, r.why);
  const body = fs.readFileSync(dest, 'utf8');
  assert.match(body, /my salary thoughts/);
  assert.doesNotMatch(body, /Private/i, 'the marker is routing, not content');
});

test('every spelling of private is the same spelling to the router', () => {
  for (const said of ['private: x', 'Private: x', ' private : x', 'PRIVATE:x']) {
    assert.equal(isPrivate(said), true, said);
  }
  assert.equal(isPrivate('privately I think option A'), false);
});

test('routing a private sentence actually writes it, and says so', () => {
  const ws = tmp('leak-ws-');
  const h = OPEN_HUB();
  const r = routeSpoken('Private: my salary thoughts', { workspace: ws, hub: h, queue: null, now: NOW });
  assert.equal(r.kind, 'private');
  assert.equal(r.kept, true, r.why);
  assert.match(fs.readFileSync(r.file, 'utf8'), /my salary thoughts/);
});

test('a machine that cannot read the registry does not brand his ideas as unroutable', () => {
  // routeSpoken refuses everything when the registry is unreadable, which is right —
  // but the poll then renamed every ordinary idea on the list to "⚠️ could not route"
  // and recorded it, stranding notes that were never answers behind a failure of this
  // machine. A machine fault is not his sentence's fault.
  const ws = tmp('leak-ws-');
  const broken = tmp('leak-nohub-');
  const f = fake([{ id: 'a1', name: 'a goals page in the hub would be good', created: '2026-08-20T14:30:00.000Z' }]);
  const out = pollReminders({ workspace: ws, hub: broken, queue: buildQueue(OPEN_HUB(), { now: NOW }), run: f.run, now: NOW });

  assert.equal(out.unrouted.length, 0, 'nothing is branded unroutable on a failed read');
  assert.equal(out.blocked.length, 1);
  assert.match(out.blocked[0].reason, /registry/i);
  assert.match(out.why, /could not be read/i);
  assert.equal(f.sent.some((s) => /set name of|set completed of/.test(s)), false, 'and the item is left exactly as it is');
  assert.equal(readUnrouted(ws).items.length, 0);
});
