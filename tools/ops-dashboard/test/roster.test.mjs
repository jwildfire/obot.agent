// The agent roster: what the sessions tab says about every agent that ran.
//
// The two traps this file exists to hold shut, both paid for once already:
// a job's own `state` is not proof it finished (a worker died on 2026-08-15 with
// `done` in its state file), and the job records' `children` list is wrong for
// nearly half of measured jobs. Both have a test below that fails if the code
// starts believing either one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildRoster, collectRoster, currentLabels, impactOf, modelFlag, parseDelivery, parseWorkers,
  cleanDetail, isHarnessError, jobError, jobLine, readJobs, refUrl, rosterMarkdown, statusOf, timelineClose, usageIndex,
} from '../lib/roster.mjs';
import {
  agentRow, groupRoster, kindOf, rosterHtml,
} from '../lib/roster-view.mjs';
import {
  DEAD_SHOWN, PRICE_NOTE, ID_NOTE,
} from '../lib/roster.mjs';
import { parseNavigatorState } from '../lib/navigator.mjs';
import { sessionShell, sessionLogShell } from '../lib/render.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'roster-'));

const JOURNAL = [
  { ts: '2026-08-16T07:07:34+02:00', op: 'seed', epoch: '2026-08-16T07:07:34+02:00', high: 0 },
  { ts: '2026-08-16T07:42:19+02:00', op: 'claim', id: 'W0001', slug: 'nobold' },
  { ts: '2026-08-16T07:59:02+02:00', op: 'claim', id: 'W0002', slug: 'navstandup' },
  { ts: '2026-08-16T09:12:56+02:00', op: 'claim', id: 'W0003', slug: 'roster', task: 'the agent roster' },
  { ts: '2026-08-16T09:20:00+02:00', op: 'claim', id: 'W0003.1', parent: 'W0003', slug: 'probe' },
].map((r) => JSON.stringify(r)).join('\n');

const NOW = new Date('2026-08-16T10:00:00+02:00');

// ---- the ledger ----------------------------------------------------------

test('the roster reads the journal, and a sub-id belongs to its parent', () => {
  const w = parseWorkers(JOURNAL);
  assert.equal(w.epoch, '2026-08-16T07:07:34+02:00');
  assert.deepEqual(w.claims.map((c) => c.id), ['W0001', 'W0002', 'W0003', 'W0003.1']);
  assert.equal(w.claims.at(-1).parent, 'W0003');
  assert.equal(w.claims[2].task, 'the agent roster');
});

test('a journal that does not exist yet is an empty roster, not a throw', () => {
  const w = parseWorkers('');
  assert.deepEqual(w.claims, []);
  assert.equal(w.epoch, null);
});

// ---- status, read from the timeline and not from the boast ---------------

test('a state file saying done over a timeline that never closed reads as died', () => {
  // ce5e435d, 2026-08-15: `state: done`, a normal-looking completion note, and a
  // timeline whose last entry is still `working` an hour before the terminal stamp.
  const s = statusOf({
    worker: true,
    state: 'done',
    detail: 'I built nothing, per instruction.',
    firstTerminalAt: '2026-08-15T23:02:54.967Z',
    updatedAt: '2026-08-15T23:02:54.967Z',
    timeline: { last: 'working', closed: false, at: '2026-08-15T22:02:40.482Z' },
  }, NOW);
  assert.equal(s.status, 'died');
  assert.match(s.note, /timeline/i);
});

test('done in the state file and done in the timeline is finished', () => {
  const s = statusOf({
    worker: true, state: 'done', detail: 'shipped',
    firstTerminalAt: '2026-08-16T06:02:16.908Z', updatedAt: '2026-08-16T06:02:16.908Z',
    timeline: { last: 'done', closed: true, at: '2026-08-16T06:02:16.908Z' },
  }, NOW);
  assert.equal(s.status, 'finished');
});

test('blocked is death for a worker and an ordinary wait for a standing session', () => {
  const shared = {
    state: 'blocked', detail: 'awaiting hub#199', updatedAt: '2026-08-16T09:50:00+02:00',
    firstTerminalAt: null, timeline: { last: 'blocked', closed: false, at: '2026-08-16T09:50:00+02:00' },
  };
  assert.equal(statusOf({ ...shared, worker: true }, NOW).status, 'died');
  assert.equal(statusOf({ ...shared, worker: false }, NOW).status, 'waiting');
});

test('working with an hour of silence is not reported as running', () => {
  const live = statusOf({
    worker: true, state: 'working', detail: 'building', updatedAt: '2026-08-16T09:58:00+02:00',
    timeline: { last: 'working', closed: false, at: '2026-08-16T09:58:00+02:00' },
  }, NOW);
  assert.equal(live.status, 'running');
  const quiet = statusOf({
    worker: true, state: 'working', detail: 'building', updatedAt: '2026-08-16T07:10:00+02:00',
    timeline: { last: 'working', closed: false, at: '2026-08-16T07:10:00+02:00' },
  }, NOW);
  assert.notEqual(quiet.status, 'running');
  assert.match(quiet.note, /heartbeat/i);
});

test('an id claimed but never launched says so instead of looking finished', () => {
  assert.equal(statusOf({ worker: true, job: null }, NOW).status, 'not launched');
  assert.equal(statusOf({ worker: true, job: null, sub: true }, NOW).status, 'subagent');
});

test('the timeline is read for its last state, not its length', () => {
  const t = timelineClose([
    '{"at":"2026-08-16T05:59:41.916Z","state":"working","detail":"a"}',
    '{"at":"2026-08-16T06:00:00.310Z","state":"working","detail":"b"}',
    'not json at all',
    '{"at":"2026-08-16T06:02:16.908Z","state":"done","detail":"c"}',
  ].join('\n'));
  assert.equal(t.last, 'done');
  assert.equal(t.closed, true);
  assert.equal(t.at, '2026-08-16T06:02:16.908Z');
});

// ---- impact, from the delivery record and never from job children --------

const DELIVERY = `# delivery

- 2026-08-16 08:26 W0001 · produced obot.agent#133 merged; hub main 5ff0cd8; hub#198 closed · requirement hub#198 (filed first, parent=goal #73) · confirmed · the PR names its requirement in prose only
- 2026-08-16 08:43 W0002 · produced obot.agent#135 + #137 merged; obot.agent#134 + #136 closed; hub#199 filed · requirement hub#195 (#134 parent verified) and hub#200 (#136 parent verified) · confirmed · two requirements advanced
- 2026-08-16 08:26 opsux · produced obot.agent#124 merged (v0.5.0) · requirement hub#180 (not linked — obot.agent#122 parent=NONE) · drift · #180 gained no sub-issue
- 2026-08-16 08:26 firstmate · produced nothing · requirement none · none · built nothing by instruction
- 2026-08-16 08:28 n0001 · call n0001 · requirement-amended · backfilled 8 orphaned task issues
`;

test('a confirmed verdict moves its requirement; a drift verdict only mentions it', () => {
  const rows = parseDelivery(DELIVERY);
  assert.equal(rows.length, 4, 'call lines are not closeouts and must not become rows');
  const w1 = impactOf(rows.filter((r) => r.worker === 'W0001'));
  assert.deepEqual(w1.moved.map((r) => r.ref), ['hub#198']);
  assert.deepEqual(w1.closed.map((r) => r.ref).sort(), ['hub#198', 'obot.agent#133']);

  const ux = impactOf(rows.filter((r) => r.worker === 'opsux'));
  assert.deepEqual(ux.moved, [], 'drift moved nothing');
  assert.deepEqual(ux.mentioned.map((r) => r.ref), ['hub#180']);
  assert.deepEqual(ux.closed.map((r) => r.ref), ['obot.agent#124']);
});

test('a requirement in the record keeps its own number, not the task number beside it', () => {
  const w2 = impactOf(parseDelivery(DELIVERY).filter((r) => r.worker === 'W0002'));
  assert.deepEqual(w2.moved.map((r) => r.ref), ['hub#195', 'hub#200']);
  assert.deepEqual(w2.closed.map((r) => r.ref).sort(),
    ['obot.agent#134', 'obot.agent#135', 'obot.agent#136', 'obot.agent#137'],
    'a bare #137 inherits the repo named to its left');
  assert.deepEqual(w2.mentioned.map((r) => r.ref), ['hub#199'], 'filed is not closed or merged');
});

test('an agent that moved nothing renders none, never a blank', () => {
  const fm = impactOf(parseDelivery(DELIVERY).filter((r) => r.worker === 'firstmate'));
  assert.equal(fm.empty, true);
  assert.equal(fm.summary, 'none');
});

test('impact never comes from the job children list', () => {
  // 21a86715 records two children and the delivery record judged it separately.
  // A job with children and no closeout must still read `none` — the children
  // list is wrong for nearly half of measured jobs, so it is not a source here.
  const model = buildRoster({
    workers: parseWorkers(JOURNAL),
    jobs: [{
      job: 'aaa', name: '👯🤖 W0001 2026-08-16 nobold', state: 'done',
      updatedAt: '2026-08-16T06:02:16.908Z', firstTerminalAt: '2026-08-16T06:02:16.908Z',
      timeline: { last: 'done', closed: true, at: '2026-08-16T06:02:16.908Z' },
      children: [{ id: '133', kind: 'pr' }, { id: '198', kind: 'issue' }],
    }],
    usage: null,
    delivery: [],
    now: NOW,
  });
  const w1 = model.rows.find((r) => r.id === 'W0001');
  assert.equal(w1.impact.summary, 'none');
  assert.equal(JSON.stringify(model).includes('children'), false);
});

test('a reference resolves to the repo it names, and hub means obot.roadmap', () => {
  assert.equal(refUrl('hub#199'), 'https://github.com/jwildfire/obot.roadmap/issues/199');
  assert.equal(refUrl('obot.agent#133'), 'https://github.com/jwildfire/obot.agent/issues/133');
  assert.equal(refUrl('goal #79'), 'https://github.com/jwildfire/obot.roadmap/issues/79');
  assert.equal(refUrl('nonsense'), null);
});

// ---- cost, read from the hub's priced artifact ---------------------------

const USAGE = {
  schema: 1,
  days: ['2026-08-15', '2026-08-16'],
  cells: [
    { day: '2026-08-16', agent: '👯🤖 W0001 2026-08-16 nobold', role: 'sibling', cost: 6.2, calls: 40, subCost: 0.5, subCalls: 3 },
    { day: '2026-08-16', agent: '🎩🤖 obot-prime', role: 'interactive', cost: 12.6, calls: 90, subCost: 2.94, subCalls: 8 },
    { day: '2026-08-15', agent: '👯🤖 2026-08-15 firstmate', role: 'sibling', cost: 80.0, calls: 10, subCost: 0, subCalls: 0 },
    { day: '2026-08-14', agent: 'session summary', role: 'interactive', cost: 20.3, calls: 71, subCost: 1.5, subCalls: 8 },
  ],
  totals: { cost: 119.1 },
};

const usageAt = (iso) => ({ ...USAGE, generatedAt: iso });

test('cost joins on the id inside the agent label', () => {
  const u = usageIndex(usageAt('2026-08-16T09:55:00+02:00'), { epochDay: '2026-08-16', now: NOW });
  assert.equal(u.byId.get('W0001').cost, 6.2);
  assert.equal(u.byId.get('W0001').subCost, 0.5);
  assert.equal(u.stale, false);
});

test('an artifact older than a day says so rather than passing as current', () => {
  const u = usageIndex(usageAt('2026-08-14T09:00:00+02:00'), { epochDay: '2026-08-16', now: NOW });
  assert.equal(u.stale, true);
  assert.match(u.note, /\d+\s*h/);
});

test('no artifact at all is unavailable, and unavailable is never zero', () => {
  const u = usageIndex(null, { epochDay: '2026-08-16', now: NOW });
  assert.equal(u.missing, true);
  const model = buildRoster({ workers: parseWorkers(JOURNAL), jobs: [], usage: u, delivery: [], now: NOW });
  for (const row of model.rows) {
    assert.match(row.cost.text, /unavailable/);
    assert.doesNotMatch(row.cost.text, /^\$0/);
  }
  assert.match(rosterMarkdown(model), /cost unavailable/i);
});

test('an agent that started after the priced artifact was built is not priced at zero', () => {
  const u = usageIndex(usageAt('2026-08-16T08:00:00+02:00'), { epochDay: '2026-08-16', now: NOW });
  const model = buildRoster({
    workers: parseWorkers(JOURNAL),
    jobs: [{
      job: 'ccc', name: '👯🤖 W0003 2026-08-16 roster', state: 'working',
      startedAt: '2026-08-16T09:13:18.659Z', updatedAt: '2026-08-16T09:59:00+02:00',
      timeline: { last: 'working', closed: false, at: '2026-08-16T09:59:00+02:00' },
    }],
    usage: u, delivery: [], now: NOW,
  });
  const w3 = model.rows.find((r) => r.id === 'W0003');
  assert.match(w3.cost.text, /not yet priced/);
  assert.doesNotMatch(w3.cost.text, /\$0/);
});

// ---- the shape of the roster --------------------------------------------

function fullModel() {
  return buildRoster({
    workers: parseWorkers(JOURNAL),
    usage: usageIndex(usageAt('2026-08-16T09:55:00+02:00'), { epochDay: '2026-08-16', now: NOW }),
    delivery: parseDelivery(DELIVERY),
    now: NOW,
    jobs: [
      {
        job: 'aaa', name: '👯🤖 W0001 2026-08-16 nobold', state: 'done', tokens: 66580,
        startedAt: '2026-08-16T05:42:51.129Z', updatedAt: '2026-08-16T06:02:16.908Z',
        firstTerminalAt: '2026-08-16T06:02:16.908Z',
        timeline: { last: 'done', closed: true, at: '2026-08-16T06:02:16.908Z' },
      },
      {
        job: 'bbb', name: '👯🤖 W0002 2026-08-16 navstandup', state: 'blocked', tokens: 124519,
        startedAt: '2026-08-16T05:59:36.202Z', updatedAt: '2026-08-16T06:43:27.668Z',
        firstTerminalAt: null, detail: 'awaiting hub#199 & #200 decisions',
        timeline: { last: 'blocked', closed: false, at: '2026-08-16T06:43:27.668Z' },
      },
      {
        job: 'ddd', name: '🎩🤖 obot-prime', state: 'working', tokens: 500,
        startedAt: '2026-08-16T05:00:00.000Z', updatedAt: '2026-08-16T09:59:00+02:00',
        timeline: { last: 'working', closed: false, at: '2026-08-16T09:59:00+02:00' },
      },
    ],
  });
}

test('one row per agent, ids first, and a standing session is named rather than hidden', () => {
  const m = fullModel();
  const ids = m.rows.map((r) => r.id);
  assert.deepEqual(ids.slice(0, 3), ['W0001', 'W0002', 'W0003']);
  const prime = m.rows.find((r) => r.label.includes('obot-prime'));
  assert.ok(prime, 'an agent with no worker id still gets a row');
  assert.equal(prime.id, null);
  assert.match(prime.idText, /no worker id/);
});

test('a subagent rolls into its parent and never gets a row of its own', () => {
  const m = fullModel();
  assert.equal(m.rows.some((r) => r.id === 'W0003.1'), false);
  const w3 = m.rows.find((r) => r.id === 'W0003');
  assert.deepEqual(w3.subs.map((s) => s.id), ['W0003.1']);
});

test('agents from before the ledger are one collapsed row, never omitted and never merged in', () => {
  const m = fullModel();
  assert.ok(m.unattributed, 'the pre-id era keeps a row');
  assert.equal(m.unattributed.agents, 2, 'both pre-epoch agents counted');
  assert.equal(Math.round(m.unattributed.cost * 100) / 100, 100.3);
  for (const row of m.rows) {
    assert.ok(row.cost.value === null || row.cost.value < 100, 'pre-id spend never lands on a named row');
  }
  const md = rosterMarkdown(m);
  assert.match(md, /unattributed \(before worker ids\)/);
});

test('the row says id, status, cost and impact — the four he asked for', () => {
  const md = rosterMarkdown(fullModel());
  const row = md.split('\n').find((l) => l.startsWith('- W0001'));
  assert.match(row, /W0001/);
  assert.match(row, /finished/);
  assert.match(row, /\$6\.20/);
  assert.match(row, /1 requirement moved/);
});

test('the two disclosures are printed, not left to be discovered', () => {
  const md = rosterMarkdown(fullModel());
  assert.ok(md.includes(PRICE_NOTE), 'list price, not a bill');
  assert.ok(md.includes(ID_NOTE), 'ids are forward-only from 2026-08-16');
});

test('a died worker keeps the reason on the row where he will read it', () => {
  const m = fullModel();
  const w2 = m.rows.find((r) => r.id === 'W0002');
  assert.equal(w2.status.status, 'died');
  assert.match(rosterMarkdown(m), /awaiting hub#199/);
});

// ---- the rendering seam -------------------------------------------------

test('the roster is markdown the existing seam parses — no bespoke table', () => {
  const state = parseNavigatorState(rosterMarkdown(fullModel()));
  const agents = state.sections.find((s) => /agent/i.test(s.title));
  assert.ok(agents, 'the roster arrives as a ## section');
  assert.ok(agents.items.length >= 4);
});

test('an indented bullet attaches to the row above it as its detail', () => {
  const state = parseNavigatorState([
    '## Agents', '', '- W0001 · finished', '  - merged obot.agent#133 https://github.com/jwildfire/obot.agent/issues/133',
    '  - moved hub#198', '- W0002 · died',
  ].join('\n'));
  const [a, b] = state.sections[0].items;
  assert.equal(state.sections[0].items.length, 2, 'a detail is not a row');
  assert.equal(a.details.length, 2);
  assert.equal(a.details[0].url, 'https://github.com/jwildfire/obot.agent/issues/133');
  assert.equal(a.details[0].text, 'merged obot.agent#133');
  assert.deepEqual(b.details, []);
});

test('the record page carries the roster above the live view and keeps both', () => {
  // The live view moved to /session/log with the rest of the record
  // (jwildfire/obot.roadmap#218); the brief carries neither roster wall nor iframe.
  const html = sessionLogShell({ roster: fullModel() });
  assert.match(html, /W0001/);
  assert.match(html, /<details/, 'the row expands rather than printing everything');
  assert.match(html, /iframe/, 'the live session view is still there');
  assert.match(html, /aria-current="page"/);
});

test('an agent label is escaped — a session name is not trusted markup', () => {
  const m = buildRoster({
    workers: { epoch: '2026-08-16T07:07:34+02:00', claims: [] },
    jobs: [{
      job: 'xxx', name: '👯🤖 <img src=x onerror=alert(1)>', state: 'done',
      startedAt: '2026-08-16T08:00:00Z', updatedAt: '2026-08-16T08:10:00Z',
      firstTerminalAt: '2026-08-16T08:10:00Z',
      timeline: { last: 'done', closed: true, at: '2026-08-16T08:10:00Z' },
    }],
    usage: usageIndex(usageAt('2026-08-16T09:55:00+02:00'), { epochDay: '2026-08-16', now: NOW }),
    delivery: [], now: NOW,
  });
  const html = sessionShell({ roster: rosterMarkdown(m) });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
});

test('the roster still renders when nothing has been claimed yet', () => {
  const m = buildRoster({ workers: { epoch: null, claims: [] }, jobs: [], usage: usageIndex(null, { now: NOW }), delivery: [], now: NOW });
  const md = rosterMarkdown(m);
  assert.match(md, /## /);
  assert.ok(!md.includes('undefined'));
  assert.doesNotThrow(() => sessionShell({ roster: md }));
});

// ---- against files on disk ----------------------------------------------

test('the roster is assembled from the four files and nothing else', () => {
  const ws = tmp();
  const hub = tmp();
  const jobs = tmp();
  fs.mkdirSync(path.join(ws, '.claude', 'session-hub'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.claude', 'workers.journal'), `${JOURNAL}\n`);
  fs.writeFileSync(path.join(ws, '.claude', 'session-hub', 'delivery.md'), DELIVERY);
  fs.mkdirSync(path.join(hub, 'site', 'usage'), { recursive: true });
  fs.writeFileSync(path.join(hub, 'site', 'usage', 'usage.json'), JSON.stringify(USAGE));
  const jd = path.join(jobs, 'aaa');
  fs.mkdirSync(jd, { recursive: true });
  fs.writeFileSync(path.join(jd, 'state.json'), JSON.stringify({
    name: '👯🤖 W0001 2026-08-16 nobold', state: 'done', tokens: 66580,
    createdAt: '2026-08-16T05:42:51.129Z', updatedAt: '2026-08-16T06:02:16.908Z',
    firstTerminalAt: '2026-08-16T06:02:16.908Z',
  }));
  fs.writeFileSync(path.join(jd, 'timeline.jsonl'),
    '{"at":"2026-08-16T06:02:16.908Z","state":"done","detail":"shipped"}\n');

  // collectRoster returns the MODEL now, not markdown — the page renders it
  // (roster-view.mjs) and rosterMarkdown is the text form of the same model.
  const model = collectRoster({ workspace: ws, hub, jobsDir: jobs, now: NOW });
  const row = model.rows.find((r) => r.id === 'W0001');
  assert.ok(row, 'the claimed worker earns a row');
  assert.equal(row.status.status, 'finished');
  assert.equal(row.cost.short, '$6.20');
  assert.deepEqual(row.impact.moved.map((m) => m.ref), ['hub#198']);
  // and the text form still renders the same facts
  assert.match(rosterMarkdown(model), /W0001[\s\S]*finished[\s\S]*\$6\.20/);
});

test('a workspace with none of the four files degrades to a sentence', () => {
  const model = collectRoster({ workspace: tmp(), hub: tmp(), jobsDir: tmp(), now: NOW });
  assert.deepEqual(model.rows, []);
  assert.match(rosterMarkdown(model), /## /);
  assert.match(rosterMarkdown(model), /unavailable/i);
  // The page says so rather than rendering an empty roster, which would read as
  // "no agents ran" when it means "nothing could be read". This assertion used to
  // read `/No agent has run/` — the very sentence the comment above rules out, and
  // it passed because nothing distinguished an absent ledger from an empty one
  // (jwildfire/obot.roadmap#223). The jobs directory here exists and is empty; the
  // worker ledger does not exist at all, and only the second is worth a sentence.
  assert.doesNotMatch(rosterHtml(model), /No agent has run/i);
  assert.match(rosterHtml(model), /No worker ledger on this machine yet/i);
});

// ---- what the live data caught -------------------------------------------

test('a worker that ran before ids still joins to its verdicts by slug', () => {
  // Found against real data: these rows read `none` while the delivery record
  // beside them listed a merged pull request. A roster that hides what it cannot
  // name reads as complete when it is not.
  const m = buildRoster({
    workers: parseWorkers(JOURNAL),
    jobs: [{
      job: 'eee', name: '👯🤖 2026-08-16 opsux', state: 'done',
      startedAt: '2026-08-16T04:00:00Z', updatedAt: '2026-08-16T05:00:00Z',
      firstTerminalAt: '2026-08-16T05:00:00Z',
      timeline: { last: 'done', closed: true, at: '2026-08-16T05:00:00Z' },
    }],
    usage: usageIndex(usageAt('2026-08-16T09:55:00+02:00'), { epochDay: '2026-08-16', now: NOW }),
    delivery: parseDelivery(DELIVERY), now: NOW,
  });
  const row = m.rows.find((r) => r.label.includes('opsux'));
  assert.equal(row.id, null);
  assert.deepEqual(row.impact.closed.map((c) => c.ref), ['obot.agent#124']);
  assert.deepEqual(row.impact.mentioned.map((c) => c.ref), ['hub#180']);
});

test('a standing session opened yesterday and still answering today keeps its row', () => {
  // Also from live data: 🎩🤖 obot-prime started before the ledger and is the
  // largest live cost on the page. Windowing on when a session STARTED dropped it.
  const m = buildRoster({
    workers: parseWorkers(JOURNAL),
    jobs: [{
      job: 'fff', name: '🎩🤖 obot-prime', state: 'working', tokens: 900,
      startedAt: '2026-08-15T18:00:00Z', updatedAt: '2026-08-16T09:59:00+02:00',
      timeline: { last: 'working', closed: false, at: '2026-08-16T09:59:00+02:00' },
    }],
    usage: usageIndex(usageAt('2026-08-16T09:55:00+02:00'), { epochDay: '2026-08-16', now: NOW }),
    delivery: [], now: NOW,
  });
  const prime = m.rows.find((r) => r.label.includes('obot-prime'));
  assert.equal(prime.status.status, 'running');
  assert.equal(prime.sessions, 1, 'its session is counted, not lost to the date window');
  assert.equal(prime.cost.value, 12.6);
  assert.match(rosterMarkdown(m).split('\n').find((l) => l.includes('obot-prime')), /no worker id/);
});

test('a reference with no repository to inherit keeps its number and gets no link', () => {
  // `Q&A #183 comment` names no repository. Reading the A of Q&A as one produced
  // github.com/jwildfire/A — a link that looks checkable and goes nowhere.
  const rows = parseDelivery(
    '- 2026-08-16 08:26 d0014b · produced D0014 published; Q&A #183 comment; obot.agent#113 note · requirement none · none · retracted a false claim\n',
  );
  const i = impactOf(rows);
  const bare = i.mentioned.find((r) => r.ref.endsWith('#183'));
  assert.equal(bare.ref, '#183');
  assert.equal(bare.url, null, 'an unresolved reference must not invent a repository');
  assert.ok(i.mentioned.some((r) => r.ref === 'obot.agent#113'));
});

test('one agent is one row: a session spanning the epoch is not split across the collapsed row', () => {
  // 👯🤖 2026-08-16 d0014fix started at 22:48 the night before and ran into the
  // morning. Splitting by cell put its spend in the unattributed row while its own
  // row read "no usage recorded".
  const usage = usageIndex({
    cells: [
      { day: '2026-08-15', agent: '👯🤖 2026-08-16 d0014fix', cost: 3, calls: 5, subCost: 0, subCalls: 0 },
      { day: '2026-08-16', agent: '👯🤖 2026-08-16 d0014fix', cost: 2, calls: 4, subCost: 0, subCalls: 0 },
      { day: '2026-08-15', agent: '👯🤖 2026-08-15 gone', cost: 7, calls: 9, subCost: 0, subCalls: 0 },
    ],
    generatedAt: '2026-08-16T09:55:00+02:00',
  }, { epochDay: '2026-08-16', now: NOW });
  assert.equal(usage.byLabel.get('👯🤖 2026-08-16 d0014fix').cost, 5, 'both days land on the agent');
  assert.equal(usage.unattributed.agents, 1);
  assert.equal(usage.unattributed.cost, 7);
  const m = buildRoster({
    workers: parseWorkers(JOURNAL), usage, delivery: [], now: NOW,
    jobs: [{
      job: 'ggg', name: '👯🤖 2026-08-16 d0014fix', state: 'stopped',
      startedAt: '2026-08-15T20:48:00Z', updatedAt: '2026-08-16T02:03:00Z',
      firstTerminalAt: '2026-08-16T02:03:00Z',
      timeline: { last: 'working', closed: false, at: '2026-08-15T20:56:00Z' },
    }],
  });
  const row = m.rows.find((r) => r.label.includes('d0014fix'));
  assert.equal(row.cost.value, 5);
  assert.equal(row.cost.span, '2026-08-15 to 2026-08-16');
});

test('the job window and the cost window agree about who ran in the id era', () => {
  // d0014fix started 22:48 and ran to 04:03: all its usage is dated yesterday and
  // all its job activity today. Windowed apart, it was a named row reading "no
  // usage recorded" next to a collapsed row quietly holding its money.
  const jobs = [{
    job: 'ggg', name: '👯🤖 2026-08-16 d0014fix', state: 'stopped',
    startedAt: '2026-08-15T20:48:00Z', updatedAt: '2026-08-16T02:03:00Z',
    firstTerminalAt: '2026-08-16T02:03:00Z',
    timeline: { last: 'working', closed: false, at: '2026-08-15T20:56:00Z' },
  }];
  const usage = usageIndex({
    cells: [
      { day: '2026-08-15', agent: '👯🤖 2026-08-16 d0014fix', cost: 3.4, calls: 5, subCost: 0, subCalls: 0 },
      { day: '2026-08-15', agent: '👯🤖 2026-08-15 gone', cost: 7, calls: 9, subCost: 0, subCalls: 0 },
    ],
    generatedAt: '2026-08-16T09:55:00+02:00',
  }, { epochDay: '2026-08-16', now: NOW, current: currentLabels(jobs, '2026-08-16') });
  const m = buildRoster({ workers: parseWorkers(JOURNAL), jobs, usage, delivery: [], now: NOW });
  const row = m.rows.find((r) => r.label.includes('d0014fix'));
  assert.equal(row.cost.value, 3.4);
  assert.equal(m.unattributed.agents, 1, 'only the agent that really predates the ledger is collapsed');
  assert.equal(m.unattributed.cost, 7);
});

test('every dollar in the artifact lands on exactly one row', () => {
  // The reconciliation that makes the page trustworthy: named rows plus the one
  // collapsed row add up to what the hub priced. Nothing counted twice, nothing
  // quietly dropped — the two failure modes a per-agent split has.
  const jobs = [
    {
      job: 'a', name: '👯🤖 W0001 2026-08-16 nobold', state: 'done',
      startedAt: '2026-08-16T05:42:00Z', updatedAt: '2026-08-16T06:02:00Z',
      timeline: { last: 'done', closed: true, at: '2026-08-16T06:02:00Z' },
    },
    {
      job: 'b', name: '🎩🤖 obot-prime', state: 'working',
      startedAt: '2026-08-15T18:00:00Z', updatedAt: '2026-08-16T09:59:00+02:00',
      timeline: { last: 'working', closed: false, at: '2026-08-16T09:59:00+02:00' },
    },
  ];
  const usage = usageIndex(usageAt('2026-08-16T09:55:00+02:00'),
    { epochDay: '2026-08-16', now: NOW, current: currentLabels(jobs, '2026-08-16') });
  const m = buildRoster({ workers: parseWorkers(JOURNAL), jobs, usage, delivery: [], now: NOW });
  const rows = m.rows.reduce((n, r) => n + (r.cost.value ?? 0), 0);
  const total = USAGE.cells.reduce((n, c) => n + c.cost, 0);
  assert.equal(Math.round((rows + m.unattributed.cost) * 100) / 100, Math.round(total * 100) / 100);
});

// ---- what the Navigator settled on 2026-08-16 ----------------------------

test('a death keeps its row however old it is, and says what it was doing', () => {
  // 🧭🤖 obot-navigator: "A dead row never disappears. Worker ids are never reused
  // precisely so history cannot be erased, and a roster that quietly drops the
  // agents that failed reads as complete while hiding the rows most worth seeing."
  const dead = {
    job: 'hhh', name: '👯🤖 2026-08-15 d0003', state: 'blocked',
    detail: 'API Error: Connection refused', tokens: 31948,
    startedAt: '2026-08-15T20:45:12Z', updatedAt: '2026-08-15T22:06:43Z',
    firstTerminalAt: null,
    timeline: { last: 'blocked', closed: false, at: '2026-08-15T22:06:43Z' },
  };
  const finishedYesterday = {
    job: 'iii', name: '👯🤖 2026-08-15 km', state: 'done',
    startedAt: '2026-08-15T10:00:00Z', updatedAt: '2026-08-15T12:00:00Z',
    firstTerminalAt: '2026-08-15T12:00:00Z',
    timeline: { last: 'done', closed: true, at: '2026-08-15T12:00:00Z' },
  };
  const jobs = [dead, finishedYesterday];
  const usage = usageIndex(usageAt('2026-08-16T09:55:00+02:00'),
    { epochDay: '2026-08-16', now: NOW, current: currentLabels(jobs, '2026-08-16', NOW) });
  const m = buildRoster({
    workers: parseWorkers(JOURNAL), jobs, usage, now: NOW,
    delivery: parseDelivery('- 2026-08-16 08:26 d0003 · produced nothing landed; 5 undocumented GitHub writes · requirement hub#143 · drift · died blocked without a closeout\n'),
  });
  const row = m.rows.find((r) => r.label.includes('d0003'));
  assert.ok(row, 'a death from yesterday still has a row');
  assert.equal(row.status.status, 'died');
  assert.match(row.status.note, /Connection refused/, 'the row says what it was doing when it died');
  assert.deepEqual(row.impact.mentioned.map((r) => r.ref), ['hub#143'],
    'its impact comes from the record, not from the job saying it produced nothing');
  assert.equal(m.rows.some((r) => r.label.includes(' km')), false,
    'an agent that finished yesterday is behind the count, not on the page');
});

test('an id that was never launched is not an agent that produced nothing', () => {
  // 🧭🤖 obot-navigator: "Collapsing the two would put a phantom row in a roster
  // whose entire purpose is telling him which agents earned their tokens."
  const m = buildRoster({
    workers: parseWorkers(JOURNAL), jobs: [], delivery: [], now: NOW,
    usage: usageIndex(usageAt('2026-08-16T09:55:00+02:00'), { epochDay: '2026-08-16', now: NOW }),
  });
  const w3 = m.rows.find((r) => r.id === 'W0003');
  assert.equal(w3.status.status, 'not launched');
  const line = rosterMarkdown(m).split('\n').find((l) => l.startsWith('- W0003'));
  assert.match(line, /no agent ran under this id/);
  assert.doesNotMatch(line, /· none$/, 'it must not read as an agent that moved nothing');
});

test('the list of old deaths is capped, and says how many it did not show', () => {
  const jobs = Array.from({ length: DEAD_SHOWN + 3 }, (_, i) => ({
    job: `d${i}`, name: `👯🤖 2026-08-1${i % 5} corpse${i}`, state: 'stopped',
    startedAt: '2026-08-14T10:00:00Z', updatedAt: '2026-08-14T11:00:00Z',
    firstTerminalAt: '2026-08-14T11:00:00Z',
    timeline: { last: 'working', closed: false, at: '2026-08-14T10:30:00Z' },
  }));
  const m = buildRoster({
    workers: parseWorkers(JOURNAL), jobs, delivery: [], now: NOW,
    usage: usageIndex(usageAt('2026-08-16T09:55:00+02:00'), { epochDay: '2026-08-16', now: NOW }),
  });
  assert.equal(m.rows.filter((r) => r.label.includes('corpse')).length, DEAD_SHOWN);
  assert.equal(m.droppedDeaths, 3);
  assert.match(rosterMarkdown(m), /3 earlier agents that also ended badly, not shown/);
});

// ---- the page, not the list ----------------------------------------------
//
// These are the assertions that survive a redesign. @jwildfire has commissioned a
// spike on how this page should read (feed, table, metrics), so the row layout is
// deliberately not tested here — only the things that are wrong under any answer.

const twoWorkers = () => buildRoster({
  workers: { epoch: '2026-08-16T00:00:00Z', claims: [] },
  jobs: [
    { name: '\u{1F46F}\u{1F916} 2026-08-16 preid', state: 'done', detail: 'shipped',
      startedAt: '2026-08-16T05:00:00Z', updatedAt: '2026-08-16T06:00:00Z',
      timeline: { last: 'done', closed: true, at: '2026-08-16T06:00:00Z' } },
    { name: '\u{1F3A9}\u{1F916} obot-prime', state: 'blocked', detail: 'waiting',
      startedAt: '2026-08-16T01:00:00Z', updatedAt: '2026-08-16T06:00:00Z',
      timeline: { last: 'blocked', closed: false, at: '2026-08-16T06:00:00Z' } },
  ],
  usage: usageIndex(null, { now: NOW }),
  delivery: [],
  now: NOW,
});

test('a worker that ran before the ledger is a worker, not an unidentified agent', () => {
  // The id marks when the convention landed, not what kind of agent something is.
  // Ten of the fourteen id-less rows on the live page were ordinary workers that had
  // moved three requirements between them; grouping on the id would have buried them.
  const model = twoWorkers();
  const pre = model.rows.find((r) => r.label.includes('preid'));
  const prime = model.rows.find((r) => r.label.includes('obot-prime'));
  assert.equal(kindOf(pre), 'worker');
  assert.equal(kindOf(prime), 'standing');
  const v = groupRoster(model);
  assert.equal(v.headline.workers, 1, 'the standing session is not counted as a worker');
});

test('a standing session is not reported as having produced nothing', () => {
  // It has no deliverable to have moved, so the worker verdict is not its verdict —
  // and printing one directly contradicts the heading it sits under.
  const model = twoWorkers();
  const prime = model.rows.find((r) => r.label.includes('obot-prime'));
  assert.match(agentRow(prime, 'standing'), /not judged on delivery/);
  assert.doesNotMatch(agentRow(prime, 'standing'), /nothing moved/);
});

test('every row is rendered with its own kind, not with its index', () => {
  // `.map(agentRow)` passes (element, index, array), so the index landed in the
  // `kind` argument and every row rendered as if kindOf had never run — the standing
  // sessions were labelled "nothing moved" on the live page. Caught in a browser,
  // not by a test, which is why this one exists.
  const html = rosterHtml(twoWorkers());
  assert.match(html, /not judged on delivery/);
});

test('the record keeps the older view collapsed and explained; the brief carries neither', () => {
  // It used to be the roster stacked on the whole older session view, each with its
  // own agent count — 23 against 28 — so a reader could not tell which was true.
  const log = sessionLogShell({ roster: twoWorkers() });
  assert.match(log, /class="ag-wrap"/);
  assert.match(log, /class="livewrap"/, 'the older view is kept');
  // Kept, but collapsed and explained: one live answer on screen at a time.
  assert.match(log, /<details class="livewrap">[\s\S]*?<summary>/);
  assert.match(log, /different population/i);
  // And the brief holds one answer only: counts plus a link to this record.
  const brief = sessionShell({ roster: twoWorkers() });
  assert.doesNotMatch(brief, /class="livewrap"/);
  assert.match(brief, /\/session\/log/);
});

test('an unassemblable roster says so instead of rendering an empty page', () => {
  const html = sessionShell({ roster: 'the roster could not be assembled: EACCES' });
  assert.match(html, /could not be assembled/);
  assert.doesNotMatch(html, /class="hl-t"/, 'no headline built out of nothing');
});

test('a cost cell carries a short form as well as its sentence', () => {
  // The sentence "not yet priced - it started after the last usage build" is true and
  // belongs in the explanation; it was sitting in the cost column of most rows, so
  // the column held prose and no figure could be compared with any other.
  const model = buildRoster({
    workers: { epoch: '2026-08-16T00:00:00Z', claims: [] },
    jobs: [{ name: '\u{1F46F}\u{1F916} 2026-08-16 late', state: 'done',
      startedAt: '2026-08-16T09:00:00Z', updatedAt: '2026-08-16T09:30:00Z',
      timeline: { last: 'done', closed: true, at: '2026-08-16T09:30:00Z' } }],
    usage: usageIndex({ cells: [], totals: { cost: 0 }, generatedAt: '2026-08-16T07:00:00Z' },
      { epochDay: '2026-08-16', now: NOW }),
    delivery: [], now: NOW,
  });
  const row = model.rows[0];
  assert.equal(row.cost.code, 'unpriced');
  assert.equal(row.cost.short, 'unpriced');
  assert.match(row.cost.text, /after the last usage build/);
  // The column shows the short form; the sentence survives as the cell's tooltip and
  // in the row's evidence, and is spelled out once for the page in the legend.
  const html = rosterHtml(model);
  assert.match(html, /<span class="ag-cost cost-unpriced"[^>]*>unpriced<\/span>/);
  assert.equal((html.match(/<ul class="ag-legend">/g) ?? []).length, 1);
  assert.match(html, /<li><code>unpriced<\/code>[^<]*started after the last usage build/);
});

test('an empty roster still carries the record link — CI has no job records', () => {
  // The red build on obot.agent#149: locally the workstation's real ~/.claude/jobs
  // made the roster non-empty, so the page always took the populated branch; in CI
  // the roster is empty and the page rendered one sentence with no way out. The
  // frame must not depend on the roster having rows.
  const html = sessionShell({ roster: { rows: [] } });
  assert.match(html, /No agent has run/);
  assert.match(html, /\/session\/log/);
  // The what-changed feed moved to the record with the outcome groups when the tab
  // became a table (jwildfire/obot.agent#154). It must still render there, and in
  // its empty state too — a feed that only appears when populated cannot be told
  // apart from a feed that broke.
  assert.match(sessionLogShell({ roster: { rows: [] }, feed: [] }), /What changed/);
});

// ---- a machine with no history -------------------------------------------
//
// jwildfire/obot.roadmap#223. Every source the roster joins is absent on the first
// morning of a new machine, and until now the page answered that by making the
// numbers up: the cost cells said "cost unavailable — no usage artifact" while the
// headline above them said "$0.00 spent", and every row landed under "produced
// nothing" because the delivery record it would have been judged against had never
// been written. A zero and an unread file look identical, which is the whole reason
// these pages exist.

const JOBS_ONLY = [{
  job: 'aaa11122', name: '👯🤖 W0001 nobold', state: 'working', detail: 'day two',
  startedAt: '2026-08-16T08:00:00Z', updatedAt: '2026-08-16T09:50:00Z', tokens: 1234,
  timeline: { state: 'working', at: '2026-08-16T09:50:00Z', entries: 3 },
}];

test('with no usage artifact the headline does not invent a total', () => {
  const model = buildRoster({
    workers: parseWorkers(JOURNAL), jobs: JOBS_ONLY,
    usage: usageIndex(null), delivery: [], now: NOW,
  });
  const html = rosterHtml(model);
  // The cells were already honest. The headline was not, and it is the biggest
  // type on the page.
  assert.doesNotMatch(html, /\$0\.00/);
  assert.match(html, /—/);
  assert.match(html, /no priced usage artifact|cost unavailable|not been priced/i);
});

test('with no delivery record no agent is called one that produced nothing', () => {
  const model = buildRoster({
    workers: parseWorkers(JOURNAL), jobs: JOBS_ONLY,
    usage: usageIndex(null), delivery: [], now: NOW,
    sources: { delivery: { present: false } },
  });
  const html = rosterHtml(model);
  // "Produced nothing" is a verdict. It requires a delivery record to have been
  // read and found silent about this agent — not for the file to be absent.
  assert.doesNotMatch(html, /produced nothing/i);
  assert.doesNotMatch(html, /nothing moved/i);
  assert.match(html, /no delivery record/i);
});

test('the model says which of its four sources it actually read', () => {
  const model = buildRoster({
    workers: parseWorkers(JOURNAL), jobs: [], usage: usageIndex(null), delivery: [],
    sources: {
      jobs: { path: '/home/.claude/jobs', present: false },
      workers: { path: '/ws/.claude/workers.journal', present: true },
      usage: { path: '/hub/site/usage/usage.json', present: false },
      delivery: { path: '/ws/.claude/session-hub/delivery.md', present: false },
    },
    now: NOW,
  });
  assert.equal(model.sources.workers.present, true);
  assert.equal(model.sources.jobs.present, false);
});

test('an absent worker ledger and an empty one say different things', () => {
  const absent = rosterHtml(buildRoster({
    workers: parseWorkers(''), jobs: [], usage: usageIndex(null), delivery: [], now: NOW,
    sources: { workers: { path: '/ws/.claude/workers.journal', present: false } },
  }));
  const empty = rosterHtml(buildRoster({
    workers: parseWorkers(JSON.stringify({ ts: NOW.toISOString(), op: 'seed', epoch: NOW.toISOString() })),
    jobs: [], usage: usageIndex(null), delivery: [], now: NOW,
    sources: { workers: { path: '/ws/.claude/workers.journal', present: true } },
  }));
  // Absent: nothing can be claimed about what has run. Present-and-empty: the
  // ledger exists and nobody has claimed an id under it, which IS a measurement.
  assert.notEqual(absent, empty);
  assert.doesNotMatch(absent, /No agent has run/);
  assert.match(absent, /not been (created|started)|no worker ledger/i);
  assert.match(empty, /No agent has run/);
});

test('collectRoster on a machine with nothing at all reports every source unread', () => {
  const ws = tmp();
  const model = collectRoster({ workspace: ws, hub: path.join(ws, 'obot.roadmap'), jobsDir: path.join(ws, 'no-jobs-here'), now: NOW });
  assert.deepEqual(model.rows, []);
  for (const key of ['jobs', 'workers', 'usage', 'delivery']) {
    assert.equal(model.sources[key].present, false, `${key} should be reported unread`);
  }
});

// ---- which model ran it (jwildfire/obot.agent#168) --------------------------
//
// @jwildfire: "also show me the model in the table." The priced usage artifact
// cannot answer it — its cells carry no model and its `models` breakdown is
// portfolio-wide — but the harness job record can: every session is launched with
// an explicit `--model` and the flag is kept in `respawnFlags`. Measured on this
// machine: 95 of 95 job records carry one, and on every sampled session the flag
// agrees with the model that actually served the transcript's turns (`opus` →
// `claude-opus-5`, `fable` → `claude-fable-5`).
//
// So the column is the launch flag, read as the launch flag, and nothing is
// derived from cost or behaviour to fill a gap.

test('the model comes off the job record launch flag, verbatim', () => {
  assert.equal(modelFlag(['--permission-mode', 'auto', '--model', 'fable']), 'fable');
  assert.equal(modelFlag(['--model', 'opus', '-n', 'name']), 'opus');
});

test('a job record with no model flag yields no model rather than a default', () => {
  // A session launched with no flag inherits its parent's model, and the record
  // does not say what that was. Naming a likely one here would put a model beside
  // a cost figure on no evidence, and those two are read against each other.
  assert.equal(modelFlag([]), null);
  assert.equal(modelFlag(['--model']), null);
  assert.equal(modelFlag(null), null);
});

test('readJobs carries the model through from state.json', () => {
  const jobs = tmp();
  const jd = path.join(jobs, 'aaa');
  fs.mkdirSync(jd, { recursive: true });
  fs.writeFileSync(path.join(jd, 'state.json'), JSON.stringify({
    name: '👯🤖 W0001 2026-08-16 nobold', state: 'done',
    createdAt: '2026-08-16T05:42:51.129Z', updatedAt: '2026-08-16T06:02:16.908Z',
    respawnFlags: ['--permission-mode', 'auto', '--model', 'opus'],
  }));
  assert.equal(readJobs(jobs)[0].model, 'opus');
});

test('a row names every model its sessions ran under, and a resumed agent can have two', () => {
  const m = buildRoster({
    workers: parseWorkers(JOURNAL),
    jobs: [
      { name: '👯🤖 W0001 2026-08-16 nobold', state: 'done', model: 'fable', startedAt: '2026-08-16T05:42:00.000Z', updatedAt: '2026-08-16T06:00:00.000Z', timeline: null },
      { name: '👯🤖 W0001 2026-08-16 nobold', state: 'done', model: 'opus', startedAt: '2026-08-16T09:00:00.000Z', updatedAt: '2026-08-16T09:30:00.000Z', timeline: null },
    ],
    usage: usageIndex(null),
    delivery: [],
    now: NOW,
  });
  const w1 = m.rows.find((r) => r.id === 'W0001');
  assert.deepEqual(w1.models, ['fable', 'opus']);
});

test('an id that never launched has no model, and the roster says nothing about it', () => {
  const m = buildRoster({
    workers: parseWorkers(JOURNAL), jobs: [], usage: usageIndex(null), delivery: [], now: NOW,
  });
  for (const r of m.rows) assert.deepEqual(r.models, []);
});


// ---- what an agent says it is doing (jwildfire/obot.agent#177, #179) -------
//
// The harness's `detail` field is the best short description of what an agent is
// doing that exists on this machine, and it is also where the sibling briefing's
// opening HTML comment lands — on sixteen entries across ten jobs, and NOT inertly:
// one of those entries re-asserted `blocked` forty-five seconds before a clean
// close-out. Any surface that renders the field unchecked renders a template as a
// session's status, and the Agents tab is one of those surfaces.

const BRIEFING = '<!-- how to use: this is the briefing a lead session hands a spawned sibling. Copy the block below, fill in every `{…}` placeholder -->';

test('template text is refused as a detail, rather than trimmed into a shorter lie', () => {
  // Null, not a cleaned-up string: there is no salvageable status inside a template,
  // and half a briefing rendered as a task is the same defect one character shorter.
  assert.equal(cleanDetail(BRIEFING), null);
  assert.equal(cleanDetail('<!-- anything at all'), null);
  assert.equal(cleanDetail('## Your identity'), null);
  assert.equal(cleanDetail('You are worker {W-id} and it is yours permanently'), null);
});

test('the state word written as its own detail is not a description of anything', () => {
  // Every stopped job carries `detail: "stopped"`. Rendered as a task tag that is the
  // status column's own word, printed twice, in the column that was added to say
  // something the status column could not.
  assert.equal(cleanDetail('stopped'), null);
  assert.equal(cleanDetail('  DONE '), null);
  assert.equal(cleanDetail('resolving merge conflicts: #164 landed'), 'resolving merge conflicts: #164 landed');
});

test('the timeline keeps the last real line, not merely the last one', () => {
  // A session that died on a limit writes the limit message last, and a stopped
  // session leaves only the state word behind — so reading the newest entry would
  // give a status column sentence to a task column, or nothing at all. This is what
  // lets a stopped job still say what it was doing when it stopped.
  const t = timelineClose([
    JSON.stringify({ at: '2026-08-17T07:34:26.572Z', state: 'working', detail: 'Reading obot.agent issue 174' }),
    JSON.stringify({ at: '2026-08-17T07:35:54.962Z', state: 'working', detail: 'reading spawn briefing template' }),
    JSON.stringify({ at: '2026-08-17T07:36:40.968Z', state: 'done', detail: BRIEFING }),
    JSON.stringify({ at: '2026-08-17T07:37:05.956Z', state: 'stopped', detail: 'stopped' }),
  ].join('\n'));
  assert.equal(t.last, 'stopped');
  assert.equal(t.detail, 'reading spawn briefing template');
  assert.equal(t.detailAt, '2026-08-17T07:35:54.962Z');
});

test('a finished job speaks with its own close-out line, a stopped one with its timeline', () => {
  const done = jobLine({
    state: 'done', detail: 'obot.agent#169 merged — pinning live in main (#171, #175)',
    updatedAt: '2026-08-17T08:17:00.000Z', timeline: { detail: 'wiring tests + cycle evidence' },
  });
  assert.equal(done.source, 'job record');
  assert.match(done.text, /pinning live in main/);

  const stopped = jobLine({
    state: 'stopped', detail: 'stopped', updatedAt: '2026-08-17T08:20:00.000Z',
    timeline: { detail: 'wiring tests + cycle evidence', detailAt: '2026-08-17T08:19:00.000Z' },
  });
  assert.equal(stopped.source, 'job timeline');
  assert.equal(stopped.text, 'wiring tests + cycle evidence');
});

test('a job whose every line is template text speaks not at all', () => {
  // A blank tag that says why is honest. A tag reading "how to use: this is the
  // briefing a lead session hands a spawned sibling" is the worst possible version of
  // this column, on the surface he has just started trusting.
  const j = jobLine({ state: 'done', detail: BRIEFING, timeline: { detail: null } });
  assert.equal(j, null);
});

test('the transport talking about itself is held apart from the agent talking about its work', () => {
  // Narrow and anchored on purpose: a worker's close-out sentence may well name an
  // error it found and fixed, and a loose match on the word would take that away.
  assert.ok(isHarnessError('API Error: Unable to connect to API: SSL certificate hostname mismatch'));
  assert.ok(isHarnessError("You've hit your session limit · resets 10:20am (Europe/London)"));
  assert.ok(!isHarnessError('root cause found: session-reviews chaining logic; fix in PR #163, CI green'));
  assert.ok(!isHarnessError('fixed the API error handling in the wake channel'));
});

test('a session ended by the transport reports the failure, and claims no work', () => {
  const job = {
    state: 'stopped', detail: 'stopped', updatedAt: '2026-08-17T13:52:00.000Z',
    timeline: {
      detail: 'checking the trigger condition',
      detailAt: '2026-08-17T13:50:00.000Z',
      error: 'API Error: Unable to connect to API: SSL certificate hostname mismatch',
    },
  };
  assert.equal(jobLine(job).text, 'checking the trigger condition');
  assert.match(jobError(job), /^API Error/);
});

test('an error is never the last real line, however late it arrives', () => {
  const t = timelineClose([
    JSON.stringify({ at: '2026-08-17T13:50:00.000Z', state: 'working', detail: 'checking the trigger condition' }),
    JSON.stringify({ at: '2026-08-17T13:51:32.000Z', state: 'stopped', detail: 'API Error: Unable to connect to API' }),
  ].join('\n'));
  assert.equal(t.detail, 'checking the trigger condition');
  assert.match(t.error, /^API Error/);
});
