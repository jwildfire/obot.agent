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

// Every date on this page is a LOCAL day now (jwildfire/obot.agent#174), so these
// tests have to know which local. Pinned rather than inherited: this machine runs at
// UTC-04:00 and CI runs at UTC, and a suite that passes on one and fails on the other
// would be testing the runner instead of the page. -04:00 is chosen because it is his
// zone, so the fixtures below are the same rows he is looking at.
process.env.TZ = 'America/New_York';

import { buildRoster, usageIndex } from '../lib/roster.mjs';
import { STANDING_ROLES } from '../lib/roster-view.mjs';
import {
  TABLE_CSS, TABLE_JS, agentsTableHtml, buildFilters, clip, createdOf, facetsOf, lastOf, localZone,
  modelText, periodCutoffs, reposOf, TAG_MAX, tableRows, taskOf, unattributedRow,
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
  // One row per agent IN THE MODEL. A pinned standing role with no session of its own
  // also gets a row (obot.agent#169) — an absent pinned role would read as health —
  // but it is not an agent the model reported, so it is excluded from this count
  // rather than inflating it.
  assert.equal((html.match(/<tr class="ar"(?![^>]*data-resting)/g) ?? []).length, 1);
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
// The rows of the model, without the pinned band above them (obot.agent#169): a
// standing role with no session in the fixture now renders its own row at the top of
// the table, and `td` takes the first cell it finds. Scoping here rather than
// unpinning in each fixture keeps these tests about the column they are named for.
//
// The marker is REQUIRED rather than optional. A fallback to the whole document would
// hand these tests back the pinned row the moment the attribute moved — passing
// wrongly or failing somewhere unrelated — and a helper that silently reverts to the
// thing it exists to prevent cannot report that it stopped working.
const agents = (html) => {
  const i = html.indexOf('data-sec="rest"');
  assert.ok(i !== -1, 'the table should carry a rest band to scope these reads to');
  return html.slice(i);
};

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

test('the created cell carries the local day and time, and the stamp it came from verbatim', () => {
  // Verbatim, offset included. Reformatting a local stamp into UTC — or the reverse —
  // is the same defect as the column mixing clocks, one row at a time. So the cell
  // shows his clock and the tooltip keeps the record's own characters, and the test
  // holds both: 07:40:55+01:00 is 02:40 at UTC-04:00, and the ledger's own text is
  // still there to be checked against.
  const model = { rows: [row({ id: 'W0001', claimedAt: '2026-08-16T07:40:55+01:00' })], unattributed: null };
  const html = agentsTableHtml(model, { now: NOW });
  const cell = td(agents(html), 'c-created');
  assert.match(cell, /<span class="dt-d">2026-08-16<\/span>/);
  assert.match(cell, /<span class="dt-t">02:40<\/span>/);
  assert.match(html, /data-created="\d{10,}"/);
  assert.match(html, /title="[^"]*written as 2026-08-16T07:40:55\+01:00/);
});

test('the evidence row names the record that dated the agent, for the screen with no hover', () => {
  // A tooltip is unreachable on a phone, and the phone is where he reads this.
  const model = { rows: [row({ label: '\u{1F3A9}\u{1F916} obot-prime', startedAt: '2026-08-15T09:00:00.000Z' })], unattributed: null };
  const html = agentsTableHtml(model, { now: NOW });
  assert.match(html, /<span class="k">created<\/span>[^<]*first session started 2026-08-15 05:00 UTC-04:00, written as 2026-08-15T09:00:00Z/);
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
  assert.equal(text(td(agents(html), 'c-model')), 'opus');
  assert.match(html, /title="[^"]*--model opus, from the harness job record/);
  assert.match(html, /data-model="opus"/);
});

test('an agent whose model nothing records reads unknown, never a default', () => {
  // The priced feed has no model per cell and its breakdown is portfolio-wide. A row
  // with no job record on this machine has nothing to read, and says so.
  const model = { rows: [row({ id: 'W0001', models: [] })], unattributed: null };
  const html = agentsTableHtml(model, { now: NOW });
  assert.equal(text(td(agents(html), 'c-model')), 'unknown');
  assert.doesNotMatch(text(td(agents(html), 'c-model')), /opus|fable|sonnet|haiku/);
  assert.match(html, /data-model="unknown"/);
});

test('a resumed agent that ran under two models shows both', () => {
  const model = { rows: [row({ id: 'W0001', models: ['fable', 'opus'] })], unattributed: null };
  const html = agentsTableHtml(model, { now: NOW });
  assert.match(text(td(agents(html), 'c-model')), /fable.*opus/);
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

test('the page script parses as JavaScript', () => {
  // Paid for while building the created column: a comment inside the script's template
  // literal contained a backtick, which closed the string early. The module stopped
  // loading, which every test in this file catches — but the class of failure that
  // does NOT is an interpolation left in by accident, so parse it here on purpose.
  assert.doesNotThrow(() => new Function(TABLE_JS));
  assert.doesNotMatch(TABLE_JS, /\$\{/, 'the page script must not interpolate at render time');
});

test('on a phone the sort key rides in the pinned column, and says the same date', () => {
  // Measured at a real 390px viewport: the Created cell is about 475px into the
  // sideways swipe. Sorting by a column he cannot see reads as no order at all.
  const model = { rows: [row({ id: 'W0001', claimedAt: '2026-08-16T07:40:55+01:00' })], unattributed: null };
  const html = agentsTableHtml(model, { now: NOW });
  assert.match(td(agents(html), 'c-name'), /class="ag-born">created 2026-08-16 02:40</);
  assert.match(td(agents(html), 'c-created'), /2026-08-16<\/span><span class="dt-t">02:40</);
  // Hidden on a desktop, where the column itself is on screen: the same date twice in
  // one row is noise, not redundancy.
  assert.match(TABLE_CSS, /\.ag-born \{ display:none; \}/);
});

test('an undated row says so in the pinned column too, rather than going blank', () => {
  const model = { rows: [row({ id: 'W0001' })], unattributed: null };
  assert.match(td(agents(agentsTableHtml(model, { now: NOW })), 'c-name'), /ag-born">created unknown</);
});


// ---- one day boundary, his (jwildfire/obot.agent#178, closing #174) --------
//
// The failure these hold shut is a page that dates a row correctly in one column and
// wrongly in the one beside it, with nothing erroring. Every date, time and period
// cutoff turns over at the same local midnight now; a test that only checked the
// displayed date would let a filter keep a UTC boundary and silently drop the rows it
// had just dated right.

const at = (html, cls) => td(agents(html), cls);
const one = (o) => ({ rows: [row(o)], unattributed: null });

test('an evening stamp keeps his day, rather than becoming tomorrow in UTC', () => {
  // 2026-08-18T02:00Z is 22:00 on the 17th at UTC-04:00. This is the live case rather
  // than a constructed one: every agent claimed on his evening of the 17th read as the
  // 18th, which is #174 seen from the other end of the day it was reported from.
  const f = facetsOf(row({ id: 'W0001', claimedAt: '2026-08-18T02:00:00.000Z' }));
  assert.equal(f.createdDay, '2026-08-17');
});

test('a session that ran at 00:30 local reads as today, and Today includes it', () => {
  // #174's own done-when, both halves in one test on purpose. The displayed day and
  // the period cutoff have to turn over at the same midnight, or the filter drops the
  // row the column just dated correctly — and a row missing from a filtered list is
  // the one failure on this page that looks like no failure at all.
  const now = new Date('2026-08-17T12:00:00Z');              // 08:00 local
  const ranAt = '2026-08-17T04:30:00.000Z';                  // 00:30 local
  const f = facetsOf(row({ id: 'W0001', claimedAt: ranAt, lastAt: ranAt }));
  const cutoff = periodCutoffs(now).d1;
  assert.equal(f.createdDay, '2026-08-17');
  assert.equal(f.lastDay, '2026-08-17');
  assert.equal(cutoff, '2026-08-17');
  assert.ok(f.lastDay >= cutoff, 'the 1-day period must include a session that ran at 00:30 local');
});

test('the two records that write different clocks land on one day and one clock', () => {
  // The trap this column was already bitten by once: the worker ledger writes local
  // time with an offset, the harness writes UTC. Slicing both strings would print
  // 07:40 beside 06:40 under one heading and nothing would error. Same instant, two
  // spellings, one answer — and the instant, not the characters, is what says so.
  const ledger = facetsOf(row({ id: 'W0001', claimedAt: '2026-08-17T07:40:55+01:00' }));
  const harness = facetsOf(row({ label: 'probe', startedAt: '2026-08-17T06:40:55.000Z' }));
  assert.equal(ledger.createdDay, harness.createdDay);
  assert.equal(ledger.createdTs, harness.createdTs);
});

test('the page names the zone it is speaking, on the columns and at the foot', () => {
  // A timestamp whose zone is ambiguous is worse than a date: it invites a wrong
  // inference rather than no inference. Read at render, never hardcoded — this
  // machine's own offset moved from +01:00 to -04:00 inside one day of the ledger.
  const html = agentsTableHtml(one({ id: 'W0001', claimedAt: '2026-08-16T07:40:55+01:00' }), { now: NOW });
  assert.match(html, /Created \(UTC-04:00\)/);
  assert.match(html, /Last active \(UTC-04:00\)/);
  assert.match(html, /America\/New_York \(UTC-04:00\)/);
  assert.equal(localZone(NOW).offset, 'UTC-04:00');
});

test('times are absolute, because a static render cannot keep a relative one true', () => {
  const html = agentsTableHtml(one({
    id: 'W0001', claimedAt: '2026-08-16T07:40:55+01:00', lastAt: '2026-08-17T09:00:00.000Z',
  }), { now: NOW });
  assert.match(at(html, 'c-last'), /<span class="dt-t">05:00<\/span>/);
  assert.doesNotMatch(at(html, 'c-created'), / ago|just now/i);
  assert.doesNotMatch(at(html, 'c-last'), / ago|just now/i);
});

test('a row nothing dates gains no plausible time to go with its unknown day', () => {
  const html = agentsTableHtml(one({ id: 'W0001' }), { now: NOW });
  assert.match(at(html, 'c-created'), /unknown/);
  assert.doesNotMatch(at(html, 'c-created'), /\d\d:\d\d/);
  assert.doesNotMatch(at(html, 'c-last'), /\d\d:\d\d/);
});

test('a priced UTC day never outranks an instant, however it sorts as a string', () => {
  // Found on the live page rather than reasoned about. The priced feed counts UTC
  // days; the column beside it counts local ones. Preferring the priced day whenever
  // it sorted higher as a string put "2026-08-18, no time recorded" against three
  // sessions that were running as the page rendered, on his evening of the 17th —
  // the two-clock trap one level up from the cell it was fixed in.
  const l = lastOf(row({ id: 'W0001', lastAt: '2026-08-18T02:00:00.000Z', days: ['2026-08-18'] }));
  assert.equal(l.source, 'record');
  assert.equal(l.day, '2026-08-17');
  assert.equal(at(agentsTableHtml(one({ id: 'W0001', lastAt: '2026-08-18T02:00:00.000Z', days: ['2026-08-18'] }), { now: NOW }), 'c-last'),
    at(agentsTableHtml(one({ id: 'W0001', lastAt: '2026-08-18T02:00:00.000Z' }), { now: NOW }), 'c-last'));
});

test('the priced day is used only when nothing on this machine timed the agent', () => {
  // Then it is all there is, and it shows a date with no clock rather than a clock
  // for a moment nothing recorded.
  const o = { id: 'W0001', lastAt: null, days: ['2026-08-15', '2026-08-16'] };
  const l = lastOf(row(o));
  assert.equal(l.source, 'priced');
  assert.equal(l.day, '2026-08-16');
  assert.equal(l.at, null);
  const html = agentsTableHtml(one(o), { now: NOW });
  assert.match(at(html, 'c-last'), /2026-08-16/);
  assert.match(at(html, 'c-last'), /no time recorded/);
});

test('a transport failure is not the agent\'s account of its own work', () => {
  // Also found on the live page: fleet's row read "closed out: API Error: Unable to
  // connect to API: SSL certificate hostname mismatch", under a label saying that was
  // the agent's own account of what it finished. The agent accounted for nothing; a
  // connection failed, and the status column beside it already read `died`. It stays
  // on the page, on expand, labelled as the harness rather than the agent.
  const o = {
    id: 'W0001',
    status: { status: 'died', note: 'stopped — ended before it closed out' },
    ended: 'API Error: Unable to connect to API: SSL certificate hostname mismatch',
  };
  assert.equal(taskOf(row(o)), null);
  const html = agentsTableHtml(one(o), { now: NOW });
  assert.doesNotMatch(at(html, 'c-task'), /API Error/);
  assert.match(html, /<li><span class="k">ended on<\/span> API Error[^<]*<span class="dim">— the harness, not the agent/);
});

// ---- the task tag (jwildfire/obot.agent#179) -------------------------------
//
// @jwildfire: "Can't really tell what the agents are doing... would be nice for each
// agent to have a short tag (<100 char) describing it's task in the table and then a
// longer 1-2 sentence summary on expand."
//
// The failure these hold shut is a tag that reads plausibly and describes the wrong
// thing, which is worse than a blank one: the slug rendered as a description, a
// close-out read as a live status, or template text rendered as either.

const jline = (text, o = {}) => ({ text, at: '2026-08-17T09:30:00.000Z', source: 'job record', ...o });
const verdict = (produced) => impact({ verdicts: [{ verdict: 'confirmed', produced, note: '' }], empty: false });
const tagOf = (html) => /<span class="tk tk-[\w-]+"[^>]*><span class="tk-k">[^<]*<\/span>([^<]*)<\/span>/.exec(at(html, 'c-task'))?.[1] ?? null;

test('a live agent says what it is doing now', () => {
  const t = taskOf(row({
    id: 'W0001', status: { status: 'running', note: '' },
    line: jline('resolving merge conflicts: #164 landed'),
  }));
  assert.equal(t.kind, 'doing');
  assert.equal(t.text, 'resolving merge conflicts: #164 landed');
});

test('a finished agent says what it did, from the record that was checked against GitHub', () => {
  // Two authored sentences exist for a finished agent and they are not equally good:
  // the delivery record's is the Navigator's, written at close-out and verified, and
  // the job record's is the agent's own account of itself.
  const t = taskOf(row({
    id: 'W0001',
    line: jline('shipped and confirmed'),
    impact: verdict('obot.agent#171 merged — pinning live in main'),
  }));
  assert.equal(t.kind, 'delivered');
  assert.match(t.text, /obot\.agent#171 merged/);
});

test('an unjudged finished agent falls back to its own close-out line', () => {
  const t = taskOf(row({ id: 'W0001', line: jline('root cause found: session-reviews chaining logic; fix in PR #163, CI green') }));
  assert.equal(t.kind, 'closed');
  assert.match(t.text, /root cause found/);
});

test('an agent with no session at all still says what it was sent to do', () => {
  // The honest fallback, and it already exists: 33 of 50 ledger claims carry a
  // one-line task under 100 characters. An id claimed that never launched has nothing
  // else, and "no session ever ran" belongs in the status column, not this one.
  const t = taskOf(row({
    id: 'W0005', task: 'ops-answers id defect + blocked-fleet detection (oa#180, #181)',
    status: { status: 'not launched', note: 'burned, not lost' },
  }));
  assert.equal(t.kind, 'dispatched');
  assert.match(t.text, /ops-answers id defect/);
});

test('the tag is never the worker slug', () => {
  // "mergegate" and "landseven" are addresses, not descriptions, and a table of them
  // is what this change exists to remove.
  const o = { id: 'W0028', slug: 'mergegate', task: 'root-cause the merge gate that stalled two RCs' };
  assert.match(taskOf(row(o)).text, /root-cause the merge gate/);
  assert.doesNotMatch(at(agentsTableHtml(one(o), { now: NOW }), 'c-task'), /mergegate/);
});

test('a row no record describes gets a blank tag and a reason, never a guess', () => {
  assert.equal(taskOf(row({ id: 'W0001' })), null);
  const html = agentsTableHtml(one({ id: 'W0001' }), { now: NOW });
  assert.match(at(html, 'c-task'), /class="tk-none"/);
  assert.match(html, /no task recorded/);
});

test('the tag holds under 100 characters and is cut at a word, not mid-word', () => {
  const long = 'milestone backfill complete across all 17 published releases in 4 repos — 8 milestones created, 9 closed, 52 issues attached';
  const t = taskOf(row({ id: 'W0001', impact: verdict(long) }));
  assert.ok(t.text.length <= 100, `tag was ${t.text.length} characters`);
  assert.match(t.text, /\u2026$/);
  assert.ok(long.startsWith(t.text.slice(0, -1)), 'the clipped tag must be a prefix of the sentence it came from');
  assert.equal(clip('short enough').length, 12);
});

test('the row carries the tag and the expansion carries the whole sentence', () => {
  const long = 'obot.agent#171 merged 07:13:47Z and #175 merged 07:15:49Z; obot.agent#169 closed — pinning is live with the standing roles pinned by default';
  const html = agentsTableHtml(one({ id: 'W0001', impact: verdict(long) }), { now: NOW });
  const tag = tagOf(html);
  assert.ok(tag.length <= 100);
  assert.doesNotMatch(tag, /standing roles pinned by default/);
  assert.match(html, /<li><span class="k">delivered<\/span> [^<]*standing roles pinned by default/);
});

test('the expansion says what it was sent to do as well as what it did', () => {
  // What an agent was dispatched to do and what it then did are different facts, and
  // the row only ever has room for one of them.
  const html = agentsTableHtml(one({
    id: 'W0001', task: 'times + one local day boundary on the Agents tab',
    impact: verdict('obot.agent#178 merged'),
  }), { now: NOW });
  assert.match(html, /<li><span class="k">delivered<\/span> obot\.agent#178 merged/);
  assert.match(html, /<li><span class="k">dispatched to<\/span> times \+ one local day boundary/);
});

test('roadmap impact and the closeout verdict expand, and stay filters', () => {
  // @jwildfire: "Roadmap impact can be shown on expand." The verdict came with it —
  // it is the delivery record's judgement of the very references impact listed, and a
  // Confirmed chip with nothing beside it to confirm is not a fact anyone can act on.
  const html = agentsTableHtml(one({
    id: 'W0001',
    impact: impact({ moved: [ref('hub#195')], verdicts: [{ verdict: 'confirmed', produced: 'obot.agent#171 merged', note: '' }], empty: false }),
  }), { now: NOW });
  assert.doesNotMatch(html, /<th[^>]*data-sort="impact"/);
  assert.doesNotMatch(html, /<th[^>]*data-sort="verdict"/);
  assert.doesNotMatch(html, /class="c-im"|class="c-vd"/);
  assert.match(html, /<li><span class="k">moved<\/span>[^<]*<[^>]*>hub#195/);
  assert.match(html, /<li><span class="k">verdict confirmed<\/span>/);
  assert.match(html, /data-group="verdict"/);
  assert.match(html, /data-group="produced"/);
});

test('an agent that moved nothing keeps its three separate silences on expand', () => {
  // Collapsing them told a lie about two, and that stays true in an expansion: a
  // standing session has no deliverable to have moved, and an agent still working has
  // not finished producing anything.
  const running = agentsTableHtml(one({ id: 'W0001', status: { status: 'running', note: 'live' } }), { now: NOW });
  assert.match(running, /still working \u2014 nothing to judge yet/);
  const standing = agentsTableHtml(one({ label: '\u{1F3A9}\u{1F916} obot-prime' }), { now: NOW });
  assert.match(standing, /not judged on delivery/);
  const done = agentsTableHtml(one({ id: 'W0001' }), { now: NOW });
  assert.match(done, /nothing moved \u2014 the delivery record has no reference/);
});

test('the expansion spans exactly the columns the header declares', () => {
  // A column added or removed without moving COLS with it leaves the evidence row
  // short or long by one cell, which does not error and does not look wrong until the
  // table is read on a phone.
  const html = agentsTableHtml(one({ id: 'W0001' }), { now: NOW });
  const headers = (html.match(/<th[^>]*data-sort=/g) ?? []).length;
  const spans = [...html.matchAll(/colspan="(\d+)"/g)].map((m) => Number(m[1]));
  assert.ok(spans.length > 0, 'there should be at least one spanning row to check');
  assert.ok(spans.every((n) => n === headers), `header count ${headers} vs colspans ${spans.join(',')}`);
});

test('every standing role has a resting line short enough to be a task tag', () => {
  // A pinned role with no session renders its `resting` line as its task tag, so that
  // string is now a table cell rather than a sentence in a tooltip. Enforced rather
  // than trusted, at 👯🤖 W0038's suggestion: one of the three was 101 characters and
  // would have shipped clipped the day this column landed, and the next role will be
  // written by someone who never saw that exchange.
  for (const r of STANDING_ROLES) {
    assert.ok(r.resting.length <= TAG_MAX, `${r.role} resting line is ${r.resting.length} characters`);
  }
});
