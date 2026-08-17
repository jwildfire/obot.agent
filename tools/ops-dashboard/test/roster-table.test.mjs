// The Agents tab as a table with a filter sidebar (jwildfire/obot.agent#154,
// requirement jwildfire/obot.roadmap#227).
//
// The tests that matter here are the ones that hold shut a failure the page can
// have while looking fine: a filter input whose `type` the HTML spec does not know
// (it renders as a text box and the page silently stops filtering), a facet that
// swallows the difference between "produced nothing" and "has no deliverable to
// produce", and a repository guessed from a reference that never named one.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRoster, usageIndex } from '../lib/roster.mjs';
import {
  TABLE_JS, agentsTableHtml, buildFilters, createdOf, facetsOf, modelText, periodCutoffs,
  reposOf, tableRows, unattributedRow,
} from '../lib/roster-table.mjs';
import { sessionShell } from '../lib/render.mjs';

const NOW = new Date('2026-08-17T10:00:00Z');

const impact = (o = {}) => ({
  moved: [], closed: [], mentioned: [], verdicts: [], empty: true, summary: 'none', ...o,
});

const row = (o = {}) => ({
  id: null, idText: 'no worker id', label: 'agent', slug: '', task: '',
  claimedAt: null, startedAt: null, lastAt: null, days: [], sessions: 1, tokens: 0,
  status: { status: 'finished', note: 'closed out' },
  cost: { value: 1, code: 'priced', short: '$1.00', text: '$1.00', calls: 1, sub: null, span: null, days: [] },
  impact: impact(), subs: [], ...o,
});

const ref = (r) => ({ ref: r, verb: 'merged', url: null });

// ---- facets ---------------------------------------------------------------

test('an agent that moved a requirement AND merged something answers both filters', () => {
  // Forcing a row into one bucket is how a filtered list starts under-reporting the
  // agents that did the most — the same failure grouping by worker id would have
  // caused, in the other direction.
  const f = facetsOf(row({
    id: 'W0002',
    impact: impact({ moved: [ref('hub#195')], closed: [ref('obot.agent#135')], empty: false }),
  }));
  assert.deepEqual(f.produced.sort(), ['landed', 'moved']);
});

test('a standing session is not judged on delivery, and never reads as producing nothing', () => {
  const f = facetsOf(row({ label: '\u{1F3A9}\u{1F916} obot-prime' }));
  assert.equal(f.kind, 'standing');
  assert.deepEqual(f.produced, ['notjudged']);
  assert.ok(!f.produced.includes('nothing'));
});

test('an id nothing ever ran under is never-ran, not produced-nothing', () => {
  const f = facetsOf(row({ id: 'W0005', status: { status: 'not launched', note: 'burned, not lost' } }));
  assert.deepEqual(f.produced, ['unrun']);
});

test('a worker that finished having moved nothing is the row worth seeing', () => {
  const f = facetsOf(row({ id: 'W0009' }));
  assert.deepEqual(f.produced, ['nothing']);
});

test('the verdict facet keeps every verdict a worker was given', () => {
  const f = facetsOf(row({
    id: 'W0003',
    impact: impact({
      empty: false,
      moved: [ref('hub#199')],
      verdicts: [{ verdict: 'confirmed' }, { verdict: 'drift' }],
    }),
  }));
  assert.deepEqual(f.verdict, ['confirmed', 'drift']);
});

test('a worker with no closeout is unjudged, which is not the same as a verdict of none', () => {
  assert.deepEqual(facetsOf(row({ id: 'W0001' })).verdict, ['unjudged']);
});

// ---- repositories ---------------------------------------------------------

test('hub is obot.roadmap and never a second repository in the list', () => {
  const r = reposOf(row({
    impact: impact({ empty: false, moved: [ref('hub#195')], closed: [ref('obot.roadmap#200')] }),
  }));
  assert.deepEqual(r, ['obot.roadmap']);
});

test('a reference that names no repository contributes none', () => {
  // `#137` with nothing to its left. Guessing a repo would file the row under a
  // filter it never touched, and a wrong filter is worse than a missing one.
  assert.deepEqual(reposOf(row({ impact: impact({ empty: false, mentioned: [ref('#137')] }) })), []);
});

// ---- the pre-ledger row ---------------------------------------------------

test('the collapsed pre-ledger row keeps its money and says how many agents it is', () => {
  const u = { agents: 147, cost: 4985.31, calls: 20, first: '2026-07-09', last: '2026-08-16', days: ['2026-07-09', '2026-08-16'], top: [] };
  const r = unattributedRow(u);
  assert.equal(r.cost.value, 4985.31);
  assert.match(r.slug, /147 agents/);
  assert.equal(facetsOf(r).kind, 'pre-ledger');
});

test('the pre-ledger bucket sorts last, whatever it cost', () => {
  // It is 147 agents added together, not an agent. Ranking a sum against single
  // agents by money puts it at the top of a table whose first question is which
  // agent spent the most.
  const model = {
    rows: [row({ id: 'W0001', cost: { value: 10, code: 'priced', short: '$10.00', text: '$10.00', days: [] } })],
    unattributed: { agents: 147, cost: 4985.31, calls: 0, first: '2026-07-09', last: '2026-08-16', days: [], top: [] },
  };
  const { rows } = tableRows(model, { now: NOW });
  assert.equal(rows.at(-1).row.synthetic, true);
  assert.equal(rows[0].row.id, 'W0001');
});

// ---- filters --------------------------------------------------------------

test('a filter option is only offered when something has it, and carries its count', () => {
  const model = {
    rows: [
      row({ id: 'W0001', status: { status: 'running', note: '' } }),
      row({ id: 'W0002', status: { status: 'running', note: '' } }),
      row({ id: 'W0003', status: { status: 'died', note: '' } }),
    ],
    unattributed: null,
  };
  const { rows } = tableRows(model, { now: NOW });
  const status = buildFilters(rows).find((g) => g.id === 'status');
  assert.deepEqual(status.options.map((o) => [o.value, o.count]), [['running', 2], ['died', 1]]);
  assert.ok(!status.options.some((o) => o.value === 'stale'));
});

test('every filter input is a type the HTML spec knows', () => {
  // The regression this exists for: the groups were typed `check`, which is not a
  // thing, so every checkbox rendered as a text field with its own value typed into
  // it. Nothing threw. The page just stopped being a filter.
  const model = { rows: [row({ id: 'W0001' })], unattributed: null };
  const html = agentsTableHtml(model, { now: NOW });
  const types = [...html.matchAll(/<input type="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(types.length > 0);
  for (const t of types) assert.ok(['checkbox', 'radio'].includes(t), `unknown input type: ${t}`);
});

test('the period options carry a resolved cutoff day so no client does date maths', () => {
  const cut = periodCutoffs(new Date('2026-08-17T10:00:00Z'));
  assert.equal(cut.d1, '2026-08-17');
  assert.equal(cut.d7, '2026-08-11');
  assert.equal(cut.d30, '2026-07-19');
});

// ---- the table ------------------------------------------------------------

test('one row per agent, each carrying its facets as data the sidebar filters on', () => {
  const model = {
    rows: [
      row({
        id: 'W0002',
        slug: 'navstandup',
        days: ['2026-08-16'],
        status: { status: 'died', note: 'blocked' },
        impact: impact({
          empty: false,
          moved: [{ ref: 'hub#195', verb: 'moved', url: 'https://github.com/jwildfire/obot.roadmap/issues/195' }],
          closed: [ref('obot.agent#135')],
          verdicts: [{ verdict: 'confirmed', produced: 'two PRs', note: '', at: '2026-08-16 09:00' }],
        }),
      }),
    ],
    unattributed: null,
  };
  const html = agentsTableHtml(model, { now: NOW });
  assert.equal((html.match(/<tr class="ar"/g) ?? []).length, 1);
  assert.match(html, /data-status="died"/);
  assert.match(html, /data-produced="moved landed"/);
  assert.match(html, /data-verdict="confirmed"/);
  assert.match(html, /data-repo="obot.agent obot.roadmap"/);
  assert.match(html, /data-last="2026-08-16"/);
  // The links survive the move to a table: a row's references are how a claim is
  // checked, and a table cell is not a reason to drop them.
  assert.match(html, /href="https:\/\/github.com\/jwildfire\/obot.roadmap\/issues\/195"/);
});

test('the kind cell says what kind it is, not where the row sat in the array', () => {
  // 2026-08-16: `.map(agentRow)` handed the index in as the `kind` argument and
  // every row rendered as if the classifier had never run.
  const model = {
    rows: [row({ id: 'W0001' }), row({ label: '\u{1F3A9}\u{1F916} obot-prime' })],
    unattributed: null,
  };
  const html = agentsTableHtml(model, { now: NOW });
  assert.match(html, /class="ag-kind">Worker</);
  assert.match(html, /class="ag-kind">Standing session</);
  assert.doesNotMatch(html, /class="ag-kind">\d+</);
});

test('every row has its own evidence row, and the ids line up', () => {
  const model = { rows: [row({ id: 'W0001' }), row({ id: 'W0002' })], unattributed: null };
  const html = agentsTableHtml(model, { now: NOW });
  const controls = [...html.matchAll(/aria-controls="(ev-\d+)"/g)].map((m) => m[1]);
  const ids = [...html.matchAll(/<tr class="ev-row" id="(ev-\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(controls, ids);
  assert.equal(ids.length, 2);
});

test('the page names the one pricing path, so nobody builds a second one', () => {
  const model = { rows: [row({ id: 'W0001' })], unattributed: null };
  assert.match(agentsTableHtml(model, { now: NOW }), /build_usage_data\.py/);
});

test('a roster that could not be assembled says so instead of rendering an empty table', () => {
  assert.match(agentsTableHtml('the roster could not be assembled: ENOENT'), /could not be assembled/);
  assert.doesNotMatch(agentsTableHtml('the roster could not be assembled: ENOENT'), /<table/);
});

// ---- the tab ---------------------------------------------------------------

test('the Agents tab is the table, and the outcome groups are gone from it', () => {
  const model = buildRoster({
    workers: { epoch: '2026-08-16T00:00:00Z', claims: [{ id: 'W0001', slug: 'nobold', at: '2026-08-16T07:00:00Z' }] },
    jobs: [],
    usage: usageIndex(null),
    delivery: [],
    now: NOW,
  });
  const html = sessionShell({ roster: model, now: NOW });
  assert.match(html, /<table class="at-table">/);
  assert.match(html, /id="at-side"/);
  // The brief's group headings moved to the record with the feed. Leaving one behind
  // would put two answers to "how are the agents doing" on one screen.
  assert.doesNotMatch(html, /Running now/);
  assert.doesNotMatch(html, /Produced nothing<\/h3>/);
  assert.match(html, /\/session\/log/);
});

// ---- created, and newest first (jwildfire/obot.agent#168) -------------------
//
// @jwildfire: "Add a 'date created' column. show most recently created at the top."
//
// The failure these hold shut is a date column that quietly measures something
// adjacent to what its header says. Two records date an agent and they are not the
// same clock: the ledger writes local time with an offset (`...T07:40:55+01:00`) and
// the harness writes UTC (`...T08:15:22.581Z`). A column that string-slices both
// prints two clocks under one heading and nothing errors.

const td = (html, cls) => {
  const m = new RegExp(`<td class="${cls}"[^>]*>([\\s\\S]*?)</td>`).exec(html);
  return m ? m[1] : null;
};
const text = (s) => String(s).replace(/<[^>]*>/g, '').trim();

test('a worker is created when its id was claimed, and the row says which record said so', () => {
  // The claim comes first and it is the act that creates the agent: the id is claimed
  // before the spawn, and an id claimed that never launched still has a creation time
  // while having no session at all.
  const c = createdOf(row({ id: 'W0001', claimedAt: '2026-08-16T07:40:55+01:00', startedAt: '2026-08-16T07:41:10.500Z' }));
  assert.equal(c.source, 'claim');
  assert.equal(c.at, '2026-08-16T07:40:55+01:00');
});

test('an agent that never claimed an id is created when its first session started', () => {
  // Standing sessions and probes never claim. Dating them by a claim they do not have
  // would leave two-fifths of the table blank.
  const c = createdOf(row({ label: '\u{1F3A9}\u{1F916} obot-prime', startedAt: '2026-08-15T09:00:00.000Z' }));
  assert.equal(c.source, 'session');
  assert.equal(c.at, '2026-08-15T09:00:00.000Z');
});

test('an agent neither record dates is created "none" — never a plausible stand-in', () => {
  const c = createdOf(row({ label: 'some-label', days: ['2026-08-01', '2026-08-02'] }));
  assert.equal(c.source, 'none');
  assert.equal(c.at, null);
});

test('the created day is derived from the instant, not sliced off the string', () => {
  // 00:30 on the 16th at +01:00 is 23:30 UTC on the 15th. Slicing the string would
  // print the 16th here and the UTC day in the column beside it, which is how one
  // heading comes to cover two clocks.
  const f = facetsOf(row({ id: 'W0001', claimedAt: '2026-08-16T00:30:00+01:00' }));
  assert.equal(f.createdDay, '2026-08-15');
  assert.equal(f.createdTs, Date.parse('2026-08-16T00:30:00+01:00'));
});

test('the table is sorted newest created first', () => {
  const model = {
    rows: [
      row({ id: 'W0001', claimedAt: '2026-08-16T07:00:00+01:00' }),
      row({ id: 'W0002', claimedAt: '2026-08-17T09:30:00+01:00' }),
      row({ id: 'W0003', claimedAt: '2026-08-17T06:15:00+01:00' }),
    ],
    unattributed: null,
  };
  const { rows } = tableRows(model, { now: NOW });
  assert.deepEqual(rows.map((r) => r.row.id), ['W0002', 'W0003', 'W0001']);
});

test('newest first orders within a day too, not just between days', () => {
  // Half a night's workers share one date. If the column only sorted by day, the top
  // of the table would look ordered while being arbitrary inside today.
  const model = {
    rows: [
      row({ id: 'W0010', claimedAt: '2026-08-17T05:00:00+01:00' }),
      row({ id: 'W0011', claimedAt: '2026-08-17T22:00:00+01:00' }),
    ],
    unattributed: null,
  };
  const { rows } = tableRows(model, { now: NOW });
  assert.deepEqual(rows.map((r) => r.row.id), ['W0011', 'W0010']);
});

test('an agent with no created date sorts below every dated one', () => {
  const model = {
    rows: [
      row({ id: 'W0020', label: 'undated' }),
      row({ id: 'W0021', claimedAt: '2026-07-20T09:00:00+01:00' }),
    ],
    unattributed: null,
  };
  const { rows } = tableRows(model, { now: NOW });
  assert.deepEqual(rows.map((r) => r.row.id), ['W0021', 'W0020']);
});

test('newest first does not float the collapsed pre-ledger row above live work', () => {
  // It is 147 agents added together and its activity runs to yesterday. Sorted with
  // the singles it would sit above the agents that are running now.
  const model = {
    rows: [row({ id: 'W0001', claimedAt: '2026-07-20T09:00:00+01:00', status: { status: 'running', note: '' } })],
    unattributed: { agents: 147, cost: 4985.31, calls: 0, first: '2026-07-09', last: '2026-08-16', days: ['2026-08-16'], top: [] },
  };
  const { rows } = tableRows(model, { now: NOW });
  assert.equal(rows.at(-1).row.synthetic, true);
  assert.equal(rows[0].row.id, 'W0001');
});

test('the pre-ledger row reads unknown, with no date anywhere in what it shows', () => {
  // A plausible wrong date is worse than an obvious absent one: these agents ran
  // before ids existed, so nothing recorded when any one of them started.
  const model = {
    rows: [row({ id: 'W0001', claimedAt: '2026-08-16T07:00:00+01:00' })],
    unattributed: { agents: 147, cost: 4985.31, calls: 0, first: '2026-07-09', last: '2026-08-16', days: ['2026-08-16'], top: [] },
  };
  const html = agentsTableHtml(model, { now: NOW });
  const rowsHtml = html.split('<tr class="ar"');
  const pre = rowsHtml.at(-1);
  assert.equal(text(td(pre, 'c-created')), 'unknown');
  assert.doesNotMatch(text(td(pre, 'c-created')), /2026-07-09|2026-08/);
  assert.match(pre, /data-created=""/);
});

test('the created cell carries the day, and the stamp it came from verbatim', () => {
  // Verbatim, offset included. Reformatting a local stamp into UTC — or the reverse —
  // is the same defect as the column mixing clocks, one row at a time.
  const model = { rows: [row({ id: 'W0001', claimedAt: '2026-08-16T07:40:55+01:00' })], unattributed: null };
  const html = agentsTableHtml(model, { now: NOW });
  assert.equal(text(td(html, 'c-created')), '2026-08-16');
  assert.match(html, /data-created="\d{10,}"/);
  assert.match(html, /title="[^"]*claimed 2026-08-16T07:40:55\+01:00/);
});

test('the evidence row names the record that dated the agent, for the screen with no hover', () => {
  // A tooltip is unreachable on a phone, and the phone is where he reads this.
  const model = { rows: [row({ label: '\u{1F3A9}\u{1F916} obot-prime', startedAt: '2026-08-15T09:00:00.000Z' })], unattributed: null };
  const html = agentsTableHtml(model, { now: NOW });
  assert.match(html, /<span class="k">created<\/span>[^<]*first session started 2026-08-15T09:00:00Z/);
});

test('the page states its own sort order in the markup, before any script runs', () => {
  const model = { rows: [row({ id: 'W0001', claimedAt: '2026-08-16T07:00:00+01:00' })], unattributed: null };
  const html = agentsTableHtml(model, { now: NOW });
  assert.match(html, /<th[^>]*data-sort="created"[^>]*aria-sort="descending"/);
  assert.equal((html.match(/aria-sort="descending"/g) ?? []).length, 1);
});

test('the evidence colspan covers every column there is', () => {
  // A column added without the colspan leaves the evidence row one cell short and the
  // table's last column collapses under it.
  const model = { rows: [row({ id: 'W0001', claimedAt: '2026-08-16T07:00:00+01:00' })], unattributed: null };
  const html = agentsTableHtml(model, { now: NOW });
  const heads = (html.match(/<th[^>]*data-sort=/g) ?? []).length;
  assert.ok(heads >= 7, `expected the created column among the headers, saw ${heads}`);
  assert.match(html, new RegExp(`colspan="${heads}"`));
});

test('filtering never reorders the table, so the sort survives it', () => {
  // The regression this exists for is a filter that rebuilds the tbody: the rows come
  // back in document order and the sort silently reverts, which looks like it worked.
  const apply = /function apply\(\)[\s\S]*?\n  }\n/.exec(TABLE_JS);
  assert.ok(apply, 'the filter function should be findable in the page script');
  assert.doesNotMatch(apply[0], /appendChild|insertBefore|\.sort\(/);
});

// ---- the model column (jwildfire/obot.agent#168) ----------------------------
//
// @jwildfire: "also show me the model in the table." It sits beside the cost because
// those two are read against each other, which is also the reason it must never be
// derived: a guessed model next to a real cost figure discredits the cost.

test('the model column is the launch flag, and the row says where it came from', () => {
  const model = { rows: [row({ id: 'W0001', models: ['opus'] })], unattributed: null };
  const html = agentsTableHtml(model, { now: NOW });
  assert.equal(text(td(html, 'c-model')), 'opus');
  assert.match(html, /title="[^"]*--model opus, from the harness job record/);
  assert.match(html, /data-model="opus"/);
});

test('an agent whose model nothing records reads unknown, never a default', () => {
  // The priced feed has no model per cell and its breakdown is portfolio-wide. A row
  // with no job record on this machine has nothing to read, and says so.
  const model = { rows: [row({ id: 'W0001', models: [] })], unattributed: null };
  const html = agentsTableHtml(model, { now: NOW });
  assert.equal(text(td(html, 'c-model')), 'unknown');
  assert.doesNotMatch(text(td(html, 'c-model')), /opus|fable|sonnet|haiku/);
  assert.match(html, /data-model="unknown"/);
});

test('a resumed agent that ran under two models shows both', () => {
  const model = { rows: [row({ id: 'W0001', models: ['fable', 'opus'] })], unattributed: null };
  const html = agentsTableHtml(model, { now: NOW });
  assert.match(text(td(html, 'c-model')), /fable.*opus/);
});

test('the pre-ledger fold claims no model, because the priced feed carries none', () => {
  const u = { agents: 147, cost: 4985.31, calls: 0, first: '2026-07-09', last: '2026-08-16', days: [], top: [] };
  assert.deepEqual(unattributedRow(u).models, []);
  assert.match(modelText(unattributedRow(u)), /^unknown/);
});

test('model is filterable, so "what did the expensive model get spent on" is one tick', () => {
  const model = {
    rows: [
      row({ id: 'W0001', models: ['opus'] }),
      row({ id: 'W0002', models: ['opus'] }),
      row({ id: 'W0003', models: ['fable'] }),
      row({ id: 'W0004', models: [] }),
    ],
    unattributed: null,
  };
  const { rows } = tableRows(model, { now: NOW });
  const g = buildFilters(rows).find((f) => f.id === 'model');
  assert.deepEqual(g.options.map((o) => [o.value, o.count]), [['opus', 2], ['fable', 1], ['unknown', 1]]);
  // Every option must be reachable: an unknown row carries the word in its data or
  // the box that says "unknown" matches nothing and the filter looks broken.
  const html = agentsTableHtml(model, { now: NOW });
  for (const o of g.options) assert.match(html, new RegExp(`data-model="[^"]*${o.value}`));
});

test('the model column is beside the cost, not at the far end of the table', () => {
  const model = { rows: [row({ id: 'W0001', models: ['opus'] })], unattributed: null };
  const heads = [...agentsTableHtml(model, { now: NOW }).matchAll(/data-sort="(\w+)"/g)].map((m) => m[1]);
  assert.equal(heads[heads.indexOf('cost') + 1], 'model');
});
