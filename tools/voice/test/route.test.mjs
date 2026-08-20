// Where a dictated sentence ends up — and the two cases that decide whether this
// lane is trustworthy: the ambiguous one, and the applied one.
//
// jwildfire/obot.roadmap#265. Four destinations and nothing else:
//
//   private   stays on this machine, exactly as today
//   answer    the ops answer store, as his words, with the channel on the record
//   UNROUTED  kept whole, surfaced, and never quietly filed as an idea
//   idea      the hub Ideas queue, exactly as today
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { pendingAnswers, unappliedDetections, markApplied } from '../../ops-dashboard/lib/answers.mjs';
import { ALARM_RE } from '../../ops-dashboard/lib/navigator.mjs';
import { buildQueue } from '../lib/handles.mjs';
import { readUnrouted, resolveUnrouted, routeSpoken, unroutedSection } from '../lib/route.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

const REG = [
  {
    id: 'D0019',
    slug: '2026-08-16-scheduled-sessions-assessment',
    date: '2026-08-16',
    title: 'Scheduled sessions: what is ready, what is not',
    state: 'open',
    questions: [{ id: 'D0019.1', code: 'H1', question: 'Does the lane wait for a machine that does not sleep?' }],
  },
  {
    id: 'D0022',
    slug: '2026-08-20-branch-protections',
    date: '2026-08-20',
    title: 'Branch protections: what gets locked down',
    state: 'open',
    questions: [{ id: 'D0022.1', code: 'P1', question: 'Which set of branch protections is applied?' }],
  },
];

function hub(artifacts = REG) {
  const dir = tmp('voice-hub-');
  fs.mkdirSync(path.join(dir, 'reports', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'reports', 'decisions', 'registry.json'),
    JSON.stringify({ prefix: 'D', artifacts }, null, 2));
  return dir;
}

const NOW = new Date('2026-08-20T14:00:00Z');
const bed = (artifacts) => {
  const h = hub(artifacts);
  return { ws: tmp('voice-ws-'), hub: h, queue: buildQueue(h, { now: NOW }) };
};
const opts = (b) => ({ workspace: b.ws, hub: b.hub, queue: b.queue, now: NOW });

test('private: never leaves the machine and never becomes an answer', () => {
  const b = bed();
  const r = routeSpoken('private: branch protections, option A', opts(b));
  assert.equal(r.kind, 'private');
  assert.equal(pendingAnswers(b.ws, { hub: b.hub }).length, 0);
  assert.equal(readUnrouted(b.ws).items.length, 0);
});

test('APPLIED PATH: a routed sentence becomes his answer, verbatim, in the store the dashboard reads', () => {
  const b = bed();
  const r = routeSpoken('branch protections, option A please', opts(b));
  assert.equal(r.kind, 'answer');
  assert.equal(r.decision.id, 'D0022');

  const pending = pendingAnswers(b.ws, { hub: b.hub });
  assert.equal(pending.length, 1, 'exactly one answer, in the same store his dashboard clicks write to');
  const a = pending[0];
  assert.equal(a.artifact, '2026-08-20-branch-protections');
  assert.equal(a.decisionId, 'D0022', 'the decision id is joined at capture, not left null');
  assert.equal(a.status, 'captured');
  assert.match(a.words, /option A please/, 'his words are kept exactly as dictated');
  assert.match(a.channel, /voice/i, 'the channel is on the record');
  assert.equal(a.history[0].by, r.by);
});

test('APPLIED PATH: the answer is picked up by the answered-but-unapplied detection', () => {
  // The lane shipped today (hub#241 / obot.agent PR#278) has to cover this one for
  // free, or a car answer is a decision he makes twice.
  const b = bed();
  routeSpoken('branch protections, option A', opts(b));
  const later = new Date(NOW.getTime() + 3 * 3600 * 1000);
  const found = unappliedDetections(pendingAnswers(b.ws, { hub: b.hub }), { now: later });
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'D0022');
  assert.equal(found[0].condition, 'unclaimed');
});

test('APPLIED PATH: applying it clears it, by the documented command, under the id he was told', () => {
  const b = bed();
  routeSpoken('branch protections, option A', opts(b));
  markApplied(b.ws, 'D0022', { by: 'W0083', evidence: 'https://example.invalid/pr/1', hub: b.hub });
  assert.equal(pendingAnswers(b.ws, { hub: b.hub }).length, 0);
});

test('the verdict is never invented — his words carry an answer nothing recognised', () => {
  const b = bed();
  routeSpoken('scheduled sessions, wait for the new machine and build the gates meanwhile', opts(b));
  const a = pendingAnswers(b.ws, { hub: b.hub })[0];
  assert.equal(a.verdict, 'words-only');
  assert.match(a.words, /wait for the new machine/);
});

test('AMBIGUOUS: nothing is recorded against a decision, and the sentence is kept whole', () => {
  const b = bed([
    { ...REG[0] },
    { ...REG[0], id: 'D0023', slug: '2026-08-19-scheduled-sessions-readiness', date: '2026-08-19' },
  ]);
  const r = routeSpoken('scheduled sessions, wait for the machine', opts(b));
  assert.equal(r.kind, 'unrouted');
  assert.equal(r.reasonKind, 'ambiguous');

  assert.equal(pendingAnswers(b.ws, { hub: b.hub }).length, 0,
    'an ambiguous sentence must never reach the answer store — a wrong page answered confidently is the whole risk');

  const { items } = readUnrouted(b.ws);
  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'scheduled sessions, wait for the machine', 'preserved verbatim');
  assert.deepEqual(items[0].candidates.map((c) => c.id).sort(), ['D0019', 'D0023'],
    'and it names both, so he can say which one he meant');
  assert.match(items[0].reason, /which/i);
});

test('AMBIGUOUS: a declared answer that matches nothing is UNROUTED, never an idea', () => {
  const b = bed();
  const r = routeSpoken('answer: the thing about the branches, go with the safe one', opts(b));
  assert.equal(r.kind, 'unrouted');
  assert.equal(readUnrouted(b.ws).items.length, 1);
  assert.equal(pendingAnswers(b.ws, { hub: b.hub }).length, 0);
});

test('anything else is still an idea, exactly as today, and writes nothing locally', () => {
  const b = bed();
  const r = routeSpoken('a goals page in the hub would be good', opts(b));
  assert.equal(r.kind, 'idea');
  assert.equal(readUnrouted(b.ws).items.length, 0);
  assert.equal(pendingAnswers(b.ws, { hub: b.hub }).length, 0);
});

test('an empty queue cannot swallow an answer: with nothing open, a declared answer is UNROUTED', () => {
  const b = bed([{ ...REG[1], state: 'decided' }]);
  const r = routeSpoken('answer: branch protections, option A', opts(b));
  assert.equal(r.kind, 'unrouted');
  assert.match(readUnrouted(b.ws).items[0].reason, /open/i);
});

test('the same sentence dictated twice is one answer, counted twice', () => {
  const b = bed();
  routeSpoken('branch protections, option A', opts(b));
  routeSpoken('branch protections, option A', opts(b));
  const pending = pendingAnswers(b.ws, { hub: b.hub });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].clicks, 2);
});

test('the same sentence unrouted twice is one item, not a growing pile', () => {
  const b = bed();
  routeSpoken('answer: something that fits nothing', opts(b));
  routeSpoken('answer: something that fits nothing', opts(b));
  const { items } = readUnrouted(b.ws);
  assert.equal(items.length, 1);
  assert.equal(items[0].heard, 2);
});

test('an unrouted item is an alarm on the page, spelled so the alarm test can see it', () => {
  const b = bed();
  routeSpoken('answer: something that fits nothing', opts(b));
  const md = unroutedSection(readUnrouted(b.ws).items, { now: NOW });
  const headline = md.split('\n').find((l) => ALARM_RE.test(l));
  assert.ok(headline, 'the verdict line must match the real ALARM_RE, not a copy of it');
  assert.match(md, /something that fits nothing/, 'and it carries the sentence he actually said');
});

test('a clean lane still says so — a section that is silent when happy reads as dead', () => {
  const md = unroutedSection([], { now: NOW });
  assert.doesNotMatch(md, ALARM_RE);
  assert.match(md, /^## /m);
  assert.match(md, /none/i);
});

test('an unrouted item he answers again is resolved, and leaves the section', () => {
  const b = bed();
  routeSpoken('answer: something that fits nothing', opts(b));
  const { items } = readUnrouted(b.ws);
  resolveUnrouted(b.ws, items[0].id, { by: 'W0083', note: 're-dictated as "branch protections, option A"' });
  assert.equal(readUnrouted(b.ws).items.length, 0, 'open items only');
  assert.equal(readUnrouted(b.ws, { all: true }).items.length, 1, 'nothing is deleted, ever');
  assert.doesNotMatch(unroutedSection(readUnrouted(b.ws).items, { now: NOW }), ALARM_RE);
});

test('an unreadable decision registry refuses to route rather than routing to nothing', () => {
  const b = bed();
  const r = routeSpoken('branch protections, option A', { ...opts(b), hub: tmp('voice-nohub-'), queue: null });
  assert.equal(r.kind, 'unrouted');
  assert.equal(pendingAnswers(b.ws).length, 0);
});
