// The Agents tab as a table with a filter sidebar.
//
// @jwildfire, 2026-08-17: "I want the db session manager view to be a table with a
// sidebar with filters. Each row is an agent. It should share a data feed as the
// price analytics page." Requirement jwildfire/obot.roadmap#227, task
// jwildfire/obot.agent#154.
//
// That is the third and most concrete of three descriptions of this view, and the
// escalating concreteness is the finding: each previous build improved on the ask
// instead of meeting it. So this is literal. A table. A sidebar of filters. One row
// per agent, and no grouping — the sidebar does the grouping now, which is what a
// filter is for.
//
// WHAT IS NOT REBUILT HERE. The model is `roster.mjs` untouched: the same four
// sources, the same join, the same priced feed. The load-bearing constraint of the
// requirement is that the cost on this page and the cost on the hub's analytics page
// are the same number, and the only way to keep that true is to have one pricing
// path — `obot.roadmap/scripts/build_usage_data.py` — which this reads through
// `collectRoster` and never recomputes. Two cost numbers that disagree is the
// registry-versus-index failure again, and this time it is about money.
//
// FILTER SEMANTICS. Within a group the boxes are OR; across groups they are AND.
// The counts beside each option are over the whole roster, not over the current
// selection: a count that changes as you tick boxes cannot tell you what ticking the
// next one would give you, which is the only reason to print it.
//
// 390px. The sidebar is a `<details>` at every width — open beside the table on a
// desktop, collapsed to one summary bar above it on a phone. That is a decision, not
// a collapse that happened: a media query that reflows a sidebar under the content
// leaves a screenful of checkboxes between him and the table he came for. The table
// stays a table on a phone and scrolls sideways inside its own box, with the agent
// column pinned so a row never loses its name.
import { esc } from './esc.mjs';
import { PRICE_NOTE, ID_NOTE, DEAD_SHOWN } from './roster.mjs';
import { kindOf } from './roster-view.mjs';

const money = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Statuses that mean no session ever ran under this row, so it has nothing to have
// produced. Kept in step with roster-view.mjs, where the same set decides grouping.
const NO_SESSION = new Set(['not launched', 'no job record', 'subagent']);

// The order statuses appear in the sidebar when they appear at all. Anything the
// roster invents that is not on this list sorts after it rather than vanishing —
// a filter that silently omits a status hides exactly the rows worth seeing.
const STATUS_ORDER = ['running', 'stale', 'died', 'waiting', 'finished', 'not launched', 'no job record', 'subagent'];

const KIND_LABEL = {
  worker: 'Worker',
  standing: 'Standing session',
  other: 'Probe or unnamed',
  'pre-ledger': 'Before worker ids',
};

const PRODUCED = [
  ['moved', 'Moved a requirement'],
  ['landed', 'Closed or merged'],
  ['named', 'Named something only'],
  ['nothing', 'Produced nothing'],
  ['unrun', 'Never ran'],
  ['notjudged', 'Not judged on delivery'],
];

const VERDICT_LABEL = {
  confirmed: 'Confirmed', drift: 'Drift', none: 'None', unjudged: 'No verdict recorded',
};

// The periods the Navigator tab already uses (jwildfire/obot.roadmap#218), so the
// two views of the same programme do not each invent their own word for a week.
export const PERIODS = [
  { value: '', label: 'Any time', days: null },
  { value: 'd1', label: 'Today', days: 1 },
  { value: 'd3', label: 'Last 3 days', days: 3 },
  { value: 'd7', label: 'Last 7 days', days: 7 },
  { value: 'd30', label: 'Last 30 days', days: 30 },
];

const dayString = (d) => d.toISOString().slice(0, 10);

/** The cutoff day for each period, resolved once at render so no client does date maths. */
export function periodCutoffs(now = new Date()) {
  const out = {};
  for (const p of PERIODS) {
    if (!p.days) continue;
    const t = new Date(now.getTime() - (p.days - 1) * 86400000);
    out[p.value] = dayString(t);
  }
  return out;
}

/** Every reference this row touched, across all three impact buckets. */
const refsOf = (impact) => [...(impact?.moved ?? []), ...(impact?.closed ?? []), ...(impact?.mentioned ?? [])];

/**
 * The repositories a row touched, as the delivery record names them.
 *
 * `hub` is obot.roadmap under another name and must not become a second repo in the
 * list. A reference with no repository (`#137` with nothing to its left) contributes
 * none: guessing one would put a row under a filter it never touched.
 */
export function reposOf(row) {
  const out = new Set();
  for (const r of refsOf(row.impact)) {
    const m = /^([A-Za-z][\w.-]*)#\d+$/.exec(String(r.ref ?? ''));
    if (!m) continue;
    out.add(m[1].toLowerCase() === 'hub' ? 'obot.roadmap' : m[1]);
  }
  return [...out].sort();
}

/**
 * The facets one row can be filtered by.
 *
 * Multi-valued where the truth is multi-valued: an agent that moved a requirement
 * AND merged a pull request answers both of those filters, and forcing it into one
 * bucket is how a filtered list starts under-reporting the agents that did the most.
 */
export function facetsOf(row) {
  const kind = row.kind ?? kindOf(row);
  const status = row.status?.status ?? '';
  const i = row.impact ?? { moved: [], closed: [], mentioned: [], verdicts: [], empty: true };

  const produced = [];
  if (i.moved?.length) produced.push('moved');
  if (i.closed?.length) produced.push('landed');
  if (i.mentioned?.length) produced.push('named');
  if (!produced.length) {
    if (NO_SESSION.has(status)) produced.push('unrun');
    else if (kind === 'standing') produced.push('notjudged');
    else produced.push('nothing');
  }

  const verdicts = [...new Set((i.verdicts ?? []).map((v) => v.verdict))];
  return {
    kind,
    status,
    produced,
    verdict: verdicts.length ? verdicts : ['unjudged'],
    repo: reposOf(row),
    days: row.days ?? [],
    lastDay: (row.days ?? []).at(-1) ?? '',
    cost: row.cost?.value ?? null,
  };
}

/**
 * The synthetic row for everything that ran before the worker ledger.
 *
 * One row standing for 147 agents, which is not one row per agent — and is the
 * requirement's own instruction: "pre-id sessions keep their collapsed unattributed
 * row". Grouping on whether a row has an id would bury the ten pre-ledger workers
 * that carried most of one day's spend, so the alternative to this row is not a
 * cleaner table, it is a table that lost the money.
 */
export function unattributedRow(u) {
  if (!u) return null;
  return {
    id: null,
    idText: 'no worker id',
    label: 'Before worker ids',
    slug: `${plural(u.agents, 'agent')}, none traceable`,
    kind: 'pre-ledger',
    task: '',
    claimedAt: null,
    startedAt: null,
    lastAt: u.last ?? null,
    days: u.days ?? [u.first, u.last].filter(Boolean),
    sessions: 0,
    tokens: 0,
    synthetic: true,
    status: { status: 'before the ledger', note: `${u.first ?? '?'} to ${u.last ?? '?'}, before worker ids existed — nothing they wrote can be traced to them` },
    cost: {
      value: u.cost, code: 'priced', short: money(u.cost), text: `${money(u.cost)} across ${plural(u.agents, 'agent')}`,
      calls: u.calls ?? 0, sub: null, span: u.first && u.last ? `${u.first} to ${u.last}` : null, days: u.days ?? [],
    },
    impact: { moved: [], closed: [], mentioned: [], verdicts: [], empty: true, summary: 'not attributable' },
    subs: [],
    top: u.top ?? [],
  };
}

/**
 * The rows the table renders, and the facet of each — the roster in the order it is
 * first painted, which is most expensive first because the question the page exists
 * to answer is whether an agent earned its tokens.
 */
export function tableRows(model, { now = new Date() } = {}) {
  const rows = (model.rows ?? []).map((r) => ({ ...r, kind: kindOf(r) }));
  const pre = unattributedRow(model.unattributed);
  if (pre) rows.push(pre);
  const withFacets = rows.map((row) => ({ row, f: facetsOf(row) }));
  // The pre-ledger bucket sorts last whatever it cost. It is not an agent — it is
  // 147 of them added together — so ranking it against single agents by money puts
  // a sum at the top of a table whose first question is which agent spent the most.
  withFacets.sort((a, b) => (a.row.synthetic ? 1 : 0) - (b.row.synthetic ? 1 : 0)
    || (b.f.cost ?? -1) - (a.f.cost ?? -1)
    || String(a.row.id ?? a.row.label).localeCompare(String(b.row.id ?? b.row.label)));
  return { rows: withFacets, cutoffs: periodCutoffs(now) };
}

/**
 * The filter groups, with a count per option over the whole roster.
 *
 * Options are only offered when something has them. A "drift" box that can never
 * match anything teaches the reader that the filter is decorative, and after that
 * an empty result is indistinguishable from a broken one.
 */
export function buildFilters(rows) {
  const tally = (pick) => {
    const m = new Map();
    for (const { f } of rows) for (const v of [].concat(pick(f))) m.set(v, (m.get(v) ?? 0) + 1);
    return m;
  };

  const status = tally((f) => f.status);
  const kind = tally((f) => f.kind);
  const produced = tally((f) => f.produced);
  const verdict = tally((f) => f.verdict);
  const repo = tally((f) => f.repo);

  const ordered = (m, order, label = (k) => k) => [
    ...order.filter((k) => m.has(k)),
    ...[...m.keys()].filter((k) => !order.includes(k)).sort(),
  ].map((k) => ({ value: k, label: label(k), count: m.get(k) }));

  // `checkbox`, spelled the way the HTML spec spells it. An input whose `type` is a
  // word the spec does not know falls back to a text box, which is what shipped for
  // one render of this page: every filter was a text field with its own value typed
  // into it. Nothing errored — the page just quietly stopped being a filter.
  return [
    { id: 'status', title: 'Status', type: 'checkbox', options: ordered(status, STATUS_ORDER) },
    { id: 'produced', title: 'Produced', type: 'checkbox', options: ordered(produced, PRODUCED.map(([v]) => v), (k) => (PRODUCED.find(([v]) => v === k)?.[1] ?? k)) },
    { id: 'active', title: 'Active', type: 'radio', options: PERIODS.map((p) => ({ value: p.value, label: p.label, count: null })) },
    {
      id: 'repo',
      title: 'Repo touched',
      type: 'checkbox',
      options: [...repo.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([k, n]) => ({ value: k, label: k, count: n })),
      empty: 'No agent in this list has a reference the delivery record could resolve to a repository.',
    },
    { id: 'verdict', title: 'Closeout verdict', type: 'checkbox', options: ordered(verdict, ['confirmed', 'drift', 'none', 'unjudged'], (k) => VERDICT_LABEL[k] ?? k) },
    { id: 'kind', title: 'Kind', type: 'checkbox', options: ordered(kind, ['worker', 'standing', 'other', 'pre-ledger'], (k) => KIND_LABEL[k] ?? k) },
  ].filter((g) => g.options.length || g.empty);
}

// ---- markup --------------------------------------------------------------

const refLink = (r) => (r.url
  ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.ref)}</a>`
  : `<span class="ref-plain" title="no repository named, so no link can be built without guessing">${esc(r.ref)}</span>`);

/**
 * The impact cell. The three silences stay three: a standing session has no
 * deliverable to have moved, an agent still working has not finished producing
 * anything, and an agent that finished having moved nothing is the row worth
 * reading. Rendering them as one sentence told a lie about two of them.
 */
function impactCell(row, f) {
  const i = row.impact;
  if (row.synthetic) return '<span class="im-none">not attributable — no id, so nothing they wrote can be traced to them</span>';
  if (row.status.status === 'not launched') return '<span class="im-none">no session ever ran under this id</span>';
  if (i.empty) {
    if (f.kind === 'standing') return '<span class="im-none">not judged on delivery</span>';
    if (row.status.status === 'running') return '<span class="im-none">still working</span>';
    return '<span class="im-none">nothing moved</span>';
  }
  const bits = [];
  if (i.moved.length) bits.push(`<span class="im-moved">${plural(i.moved.length, 'requirement')} moved</span> ${i.moved.map(refLink).join(' ')}`);
  if (i.closed.length) bits.push(`<span class="im-closed">${i.closed.length} landed</span> ${i.closed.map(refLink).join(' ')}`);
  if (i.mentioned.length) bits.push(`<span class="im-ref">${i.mentioned.length} named only</span>`);
  return bits.join('<span class="im-sep"> · </span>');
}

const verdictCell = (f) => (f.verdict.includes('unjudged')
  ? '<span class="vd-none" title="no closeout verdict recorded for this agent">—</span>'
  : f.verdict.map((v) => `<span class="vd vd-${esc(v)}">${esc(VERDICT_LABEL[v] ?? v)}</span>`).join(' '));

/** The evidence under a row — everything the columns had to leave out. */
function evidence(row) {
  const li = [];
  li.push(`<li><span class="k">status</span> ${esc(row.status.note || row.status.status)}</li>`);
  if (row.cost.value === null || row.cost.code !== 'priced') li.push(`<li><span class="k">cost</span> ${esc(row.cost.text)}</li>`);
  for (const m of row.impact.moved) li.push(`<li><span class="k">moved</span> ${refLink(m)}</li>`);
  for (const c of row.impact.closed) li.push(`<li><span class="k">${esc(c.verb ?? 'landed')}</span> ${refLink(c)}</li>`);
  for (const n of row.impact.mentioned) li.push(`<li><span class="k">named only</span> ${refLink(n)} <span class="dim">${esc(n.verb ?? 'named')}</span></li>`);
  for (const v of row.impact.verdicts) li.push(`<li><span class="k">verdict ${esc(v.verdict)}</span> ${esc(v.produced)}${v.note ? ` — ${esc(v.note)}` : ''}</li>`);
  const usage = [
    row.synthetic ? null : plural(row.sessions, 'session'),
    row.tokens ? `${row.tokens.toLocaleString('en-US')} tokens` : null,
    row.cost.calls ? `${row.cost.calls.toLocaleString('en-US')} API calls` : null,
    row.cost.sub ? `subagents ${money(row.cost.sub.cost)} of it` : null,
    row.cost.span ? `across ${row.cost.span}` : null,
  ].filter(Boolean);
  if (usage.length) li.push(`<li><span class="k">usage</span> ${esc(usage.join(' · '))}</li>`);
  if (row.claimedAt) li.push(`<li><span class="k">claimed</span> ${esc(row.claimedAt.slice(0, 16).replace('T', ' '))}${row.task ? ` — ${esc(row.task)}` : ''}</li>`);
  for (const s of row.subs) li.push(`<li><span class="k">subagent</span> ${esc(s.id)}${s.slug ? ` ${esc(s.slug)}` : ''} — rolled into this row</li>`);
  for (const t of (row.top ?? [])) li.push(`<li><span class="k">${esc(money(t.cost))}</span> ${esc(t.label)}</li>`);
  return `<ul class="ag-ev">${li.join('')}</ul>`;
}

const STATUS_TONE = {
  running: 'live', died: 'bad', stale: 'bad', finished: 'done', waiting: 'wait',
  'not launched': 'null', 'no job record': 'null', subagent: 'null', 'before the ledger': 'null',
};

const COLS = 6;

/** One agent: the row, and the evidence row beneath it that opens on a tap. */
export function tableRow({ row, f }, index) {
  const tone = STATUS_TONE[f.status] ?? 'done';
  const name = row.id ?? row.label;
  const sub = row.id ? (row.slug || '') : (row.synthetic ? row.slug : '');
  const evId = `ev-${index}`;
  return `<tr class="ar" data-tone="${esc(tone)}" tabindex="0" role="button" aria-expanded="false" aria-controls="${evId}"
  data-status="${esc(f.status)}" data-kind="${esc(f.kind)}" data-produced="${esc(f.produced.join(' '))}"
  data-verdict="${esc(f.verdict.join(' '))}" data-repo="${esc(f.repo.join(' '))}"
  data-last="${esc(f.lastDay)}" data-cost="${f.cost === null ? '' : f.cost}"
  data-name="${esc(String(name).toLowerCase())}">
  <td class="c-name"><span class="ag-id">${esc(name)}</span>${sub ? `<span class="ag-slug">${esc(sub)}</span>` : ''}<span class="ag-kind">${esc(KIND_LABEL[f.kind] ?? f.kind)}</span></td>
  <td class="c-st"><span class="tone-${esc(tone)}">${esc(f.status)}</span></td>
  <td class="c-cost cost-${esc(row.cost.code ?? 'none')}" title="${esc(row.cost.text)}">${esc(row.cost.short ?? '—')}</td>
  <td class="c-vd">${verdictCell(f)}</td>
  <td class="c-im">${impactCell(row, f)}</td>
  <td class="c-last">${esc(f.lastDay || '—')}</td>
</tr>
<tr class="ev-row" id="${evId}" hidden><td colspan="${COLS}">${evidence(row)}</td></tr>`;
}

const option = (group, type, o, cutoffs) => `<label class="at-o"><input type="${type}" data-group="${esc(group)}" value="${esc(o.value)}"${
  type === 'radio' ? ` name="at-${esc(group)}"${o.value === '' ? ' checked' : ''}` : ''}${
  cutoffs && cutoffs[o.value] ? ` data-cutoff="${esc(cutoffs[o.value])}"` : ''}><span class="at-ol">${esc(o.label)}</span>${
  o.count === null || o.count === undefined ? '' : `<span class="at-on">${o.count}</span>`}</label>`;

const filterGroup = (g, cutoffs) => `<fieldset class="at-g">
  <legend>${esc(g.title)}</legend>
  ${g.options.length ? g.options.map((o) => option(g.id, g.type, o, cutoffs)).join('\n  ') : `<p class="at-empty">${esc(g.empty)}</p>`}
</fieldset>`;

/**
 * The sidebar. A `<details>` at every width so there is one code path and one
 * answer for a narrow screen: open beside the table on a desktop, and on a phone
 * one summary bar he taps, with the count of what is showing already on it so the
 * bar is worth reading closed.
 */
function sidebar(filters, cutoffs, total, cost) {
  return `<details class="at-side" id="at-side">
  <summary><span class="at-sh">Filters</span> <span class="at-shown" id="at-shown">${total} of ${total} · ${esc(money(cost))}</span></summary>
  <div class="at-fbody">
    <div class="at-f">
      ${filters.map((g) => filterGroup(g, cutoffs)).join('\n      ')}
    </div>
    <button type="button" class="at-clear" id="at-clear" hidden>Clear all filters</button>
  </div>
</details>`;
}

const th = (key, label, cls = '') => `<th${cls ? ` class="${cls}"` : ''} data-sort="${esc(key)}" tabindex="0" role="button" aria-sort="none"><span>${esc(label)}</span></th>`;

const foot = (model) => `<details class="ag-foot">
  <summary>About these numbers</summary>
  <ul>
    ${model.usage?.missing
    ? '<li>Cost unavailable: the hub has not produced a priced usage artifact, so no cost here is a figure — and none of them is zero either.</li>'
    : (model.usage?.note ? `<li>${esc(model.usage.note)}</li>` : '')}
    <li>Cost comes from the same priced feed as the hub's analytics page — <code>obot.roadmap/scripts/build_usage_data.py</code>. This page never prices anything itself, so the two cannot disagree.</li>
    <li>${esc(PRICE_NOTE)}</li>
    <li>${esc(ID_NOTE)}</li>
    <li>Status is the job record joined to its append-only timeline. Where the two disagree the timeline wins, because a state file can say done over a session that fell over.</li>
    <li>Impact is the Navigator delivery record, checked against GitHub — never the job records' own child list, which is empty for nearly half of measured jobs.</li>
    <li>Filter counts are over the whole roster, not over the current selection, so they say what ticking a box would give you.</li>
    ${model.droppedDeaths ? `<li>${plural(model.droppedDeaths, 'earlier agent')} that also ended badly are not shown; the list of deaths is capped at ${DEAD_SHOWN}.</li>` : ''}
    ${model.epochDay ? `<li>Scope: agents active since the ledger was adopted on ${esc(model.epochDay)}, plus every agent that ended badly whenever it ran.</li>` : ''}
  </ul>
</details>`;

/** The Agents table: sidebar, table, and the note about what the numbers are. */
export function agentsTableHtml(model, { now = new Date() } = {}) {
  if (!model || typeof model !== 'object' || !Array.isArray(model.rows)) {
    return `<p class="ag-empty">${esc(String(model ?? 'The roster could not be assembled.'))}</p>`;
  }
  const { rows, cutoffs } = tableRows(model, { now });
  if (!rows.length) return '<p class="ag-empty">No agent has run since the worker ledger was adopted.</p>';
  const filters = buildFilters(rows);
  const cost = rows.reduce((n, r) => n + (r.f.cost ?? 0), 0);

  return `<div class="at" id="agents">
${sidebar(filters, cutoffs, rows.length, cost)}
<div class="at-main">
  <div class="at-scroll">
    <table class="at-table">
      <thead><tr>
        ${th('name', 'Agent', 'c-name')}
        ${th('status', 'Status', 'c-st')}
        ${th('cost', 'Cost', 'c-cost')}
        ${th('verdict', 'Verdict', 'c-vd')}
        ${th('impact', 'Roadmap impact', 'c-im')}
        ${th('last', 'Last active', 'c-last')}
      </tr></thead>
      <tbody>
${rows.map((r, i) => tableRow(r, i)).join('\n')}
      </tbody>
    </table>
  </div>
  <p class="at-none" id="at-none" hidden>No agent matches these filters. <button type="button" class="at-clear2">Clear them</button></p>
  <p class="ag-more"><a href="/session/log">The full record →</a> <span class="ag-morewhy">every delivery verdict, every Navigator call, and what changed</span></p>
  ${foot(model)}
</div>
</div>
<script>${TABLE_JS}</script>`;
}

// The page's own behaviour: filter, sort, expand. Inline and dependency-free, like
// every other script on this server — the dashboard has no build step and a page
// that needs one stops being servable from a file on his machine.
const TABLE_JS = `
(function () {
  var root = document.getElementById('agents');
  if (!root) return;
  var side = document.getElementById('at-side');
  var body = root.querySelector('tbody');
  var rows = Array.prototype.slice.call(root.querySelectorAll('tr.ar'));
  var inputs = Array.prototype.slice.call(root.querySelectorAll('.at-f input'));
  var shown = document.getElementById('at-shown');
  var clear = document.getElementById('at-clear');
  var none = document.getElementById('at-none');
  var wide = window.matchMedia('(min-width: 60rem)');

  function evOf(tr) {
    var n = tr.nextElementSibling;
    return n && n.classList.contains('ev-row') ? n : null;
  }
  function picked(group) {
    return inputs.filter(function (i) { return i.dataset.group === group && i.checked && i.value; });
  }
  function values(group) { return picked(group).map(function (i) { return i.value; }); }
  function hits(attr, want) {
    if (!want.length) return true;
    var have = (attr || '').split(' ');
    for (var i = 0; i < want.length; i++) if (have.indexOf(want[i]) !== -1) return true;
    return false;
  }
  function money(n) {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function apply() {
    var f = {
      status: values('status'), produced: values('produced'), repo: values('repo'),
      verdict: values('verdict'), kind: values('kind')
    };
    var period = picked('active')[0];
    var cutoff = period ? (period.dataset.cutoff || '') : '';
    var active = f.status.length + f.produced.length + f.repo.length + f.verdict.length + f.kind.length + (cutoff ? 1 : 0);
    var n = 0, cost = 0, unpriced = 0;
    rows.forEach(function (tr) {
      var d = tr.dataset;
      var ok = hits(d.status, f.status) && hits(d.produced, f.produced) && hits(d.repo, f.repo)
        && hits(d.verdict, f.verdict) && hits(d.kind, f.kind)
        && (!cutoff || (d.last && d.last >= cutoff));
      tr.hidden = !ok;
      var ev = evOf(tr);
      if (ev) ev.hidden = !ok || tr.getAttribute('aria-expanded') !== 'true';
      if (ok) { n++; if (d.cost) cost += parseFloat(d.cost); else unpriced++; }
    });
    var text = n + ' of ' + rows.length + ' · ' + money(cost);
    if (unpriced) text += ' · ' + unpriced + ' unpriced';
    shown.textContent = text;
    clear.hidden = active === 0;
    none.hidden = n !== 0;
    root.setAttribute('data-filtered', active ? 'yes' : 'no');
  }

  inputs.forEach(function (i) { i.addEventListener('change', apply); });

  function clearAll() {
    inputs.forEach(function (i) { i.checked = i.type === 'radio' && i.value === ''; });
    apply();
  }
  clear.addEventListener('click', clearAll);
  Array.prototype.slice.call(root.querySelectorAll('.at-clear2')).forEach(function (b) {
    b.addEventListener('click', clearAll);
  });

  // Sort. The pair moves together or the evidence ends up under someone else's row.
  var dir = {};
  function sortBy(key) {
    // First click on a column shows the end of it he came for: the biggest number,
    // the most recent day, and — for a name — the top of the alphabet.
    var desc = dir[key] === 'desc' ? false : true;
    if (key === 'name') desc = dir[key] === 'asc' ? true : false;
    dir = {}; dir[key] = desc ? 'desc' : 'asc';
    var pairs = rows.map(function (tr) { return [tr, evOf(tr)]; });
    pairs.sort(function (a, b) {
      var x = a[0].dataset, y = b[0].dataset, r;
      if (key === 'cost') {
        var cx = x.cost === '' ? -1 : parseFloat(x.cost), cy = y.cost === '' ? -1 : parseFloat(y.cost);
        r = cx - cy;
      } else if (key === 'impact') {
        r = (a[0].querySelector('.im-moved') ? 2 : 0) + (a[0].querySelector('.im-closed') ? 1 : 0)
          - (b[0].querySelector('.im-moved') ? 2 : 0) - (b[0].querySelector('.im-closed') ? 1 : 0);
      } else {
        r = String(x[key] || '').localeCompare(String(y[key] || ''));
      }
      if (r === 0) r = String(x.name).localeCompare(String(y.name));
      return desc ? -r : r;
    });
    pairs.forEach(function (p) { body.appendChild(p[0]); if (p[1]) body.appendChild(p[1]); });
    Array.prototype.slice.call(root.querySelectorAll('th[data-sort]')).forEach(function (h) {
      h.setAttribute('aria-sort', h.dataset.sort === key ? (desc ? 'descending' : 'ascending') : 'none');
    });
  }
  Array.prototype.slice.call(root.querySelectorAll('th[data-sort]')).forEach(function (h) {
    h.addEventListener('click', function () { sortBy(h.dataset.sort); });
    h.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(h.dataset.sort); }
    });
  });

  // A tap opens the row's evidence — the same affordance a pointer gets, because a
  // hover-only disclosure is unreachable on the screen he actually reads this on.
  function toggle(tr) {
    var ev = evOf(tr);
    if (!ev) return;
    var open = tr.getAttribute('aria-expanded') === 'true';
    tr.setAttribute('aria-expanded', open ? 'false' : 'true');
    ev.hidden = open;
  }
  rows.forEach(function (tr) {
    tr.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      toggle(tr);
    });
    tr.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(tr); }
    });
  });

  function fit() { if (wide.matches) side.open = true; }
  fit();
  if (wide.addEventListener) wide.addEventListener('change', fit);
  apply();
})();
`;

export const TABLE_CSS = `
  .at-wrap { padding:0.6rem 0.7rem 1.4rem; max-width:88rem; margin:0 auto; }
  .at { display:block; }
  @media (min-width:60rem) {
    .at { display:grid; grid-template-columns:15rem minmax(0,1fr); gap:1rem; align-items:start; }
  }

  /* The sidebar: one element at every width. Closed it is a bar he taps; open on a
     desktop it sits beside the table and stays put while the table scrolls. */
  .at-side { border:1px solid var(--line); border-radius:8px; background:var(--card); min-width:0; }
  .at-side > summary { cursor:pointer; padding:0.4rem 0.6rem; font-size:0.76rem; display:flex;
                       gap:0.5rem; align-items:baseline; flex-wrap:wrap; list-style:none; }
  .at-side > summary::-webkit-details-marker { display:none; }
  .at-side > summary::before { content:"▸"; color:var(--faint); font-size:0.7rem; }
  .at-side[open] > summary::before { content:"▾"; }
  .at-sh { font-weight:600; letter-spacing:0.02em; }
  .at-shown { font-family:var(--mono); font-size:0.7rem; color:var(--muted); font-variant-numeric:tabular-nums; }
  .at-fbody { padding:0 0.6rem 0.6rem; }
  @media (min-width:60rem) {
    .at-side { position:sticky; top:calc(var(--header) + 0.6rem); max-height:calc(100vh - var(--header) - 2rem);
               overflow-y:auto; }
  }

  .at-g { border:0; border-top:1px solid var(--line); margin:0; padding:0.45rem 0 0.15rem; }
  .at-g legend { font-size:0.6rem; letter-spacing:0.11em; text-transform:uppercase; color:var(--faint);
                 padding:0; margin:0 0 0.15rem; }
  .at-o { display:flex; align-items:baseline; gap:0.35rem; font-size:0.74rem; padding:0.1rem 0;
          cursor:pointer; line-height:1.3; }
  .at-o input { margin:0; flex:none; accent-color:var(--accent); }
  .at-ol { flex:1; min-width:0; overflow-wrap:anywhere; }
  .at-on { font-family:var(--mono); font-size:0.66rem; color:var(--faint); font-variant-numeric:tabular-nums; }
  .at-empty { font-size:0.68rem; color:var(--faint); margin:0.1rem 0; line-height:1.35; }
  .at-clear, .at-clear2 { margin-top:0.5rem; font-size:0.72rem; padding:0.25rem 0.5rem; border-radius:7px;
                          border:1px solid var(--line); background:var(--paper); color:var(--accent); cursor:pointer; }

  /* The table. It stays a table at 390px and scrolls sideways in its own box; the
     agent column is pinned so a row never loses its name mid-swipe. */
  .at-main { min-width:0; }
  .at-scroll { overflow-x:auto; border:1px solid var(--line); border-radius:8px; background:var(--card); }
  .at-table { border-collapse:separate; border-spacing:0; width:100%; font-size:0.76rem; }
  .at-table th, .at-table td { text-align:left; padding:0.3rem 0.5rem; border-bottom:1px solid var(--line);
                               vertical-align:top; }
  .at-table thead th { position:sticky; top:0; z-index:3; background:var(--card); font-size:0.6rem;
                       letter-spacing:0.09em; text-transform:uppercase; color:var(--faint); font-weight:600;
                       cursor:pointer; white-space:nowrap; }
  .at-table thead th[aria-sort="descending"] span::after { content:" ↓"; color:var(--accent); }
  .at-table thead th[aria-sort="ascending"] span::after { content:" ↑"; color:var(--accent); }
  .at-table tbody tr.ar { cursor:pointer; }
  .at-table tbody tr.ar:hover td, .at-table tbody tr.ar:focus-visible td { background:var(--accent-soft); }
  .at-table tbody tr.ar[aria-expanded="true"] td { background:var(--accent-soft); }

  /* Pinned first column. It needs its own background or the scrolled cells show
     through it, and a right edge so the seam is visible while swiping. */
  .at-table .c-name { position:sticky; left:0; z-index:2; background:var(--card);
                      border-right:1px solid var(--line); min-width:8.5rem; max-width:12rem; }
  .at-table thead .c-name { z-index:4; }
  .at-table tbody tr.ar:hover .c-name, .at-table tbody tr.ar[aria-expanded="true"] .c-name { background:var(--accent-soft); }
  .at-table tbody tr.ar { border-left:3px solid transparent; }
  .at-table tbody tr.ar[data-tone="live"] .c-name { box-shadow:inset 3px 0 0 #4ea1ff; }
  .at-table tbody tr.ar[data-tone="bad"] .c-name { box-shadow:inset 3px 0 0 var(--crit); }
  .at-table tbody tr.ar[data-tone="wait"] .c-name { box-shadow:inset 3px 0 0 #c9a227; }

  /* A long agent name is one unbreakable mono token — 👯🤖 2026-08-16 roadmapfirst —
     and without this it runs straight out of the pinned column and over the status
     beside it. Measured, not guessed: it did exactly that on the first two renders.
     white-space:normal is the load-bearing half — the roster list view's own .ag-id
     sets nowrap, and overflow-wrap cannot break a line that is not allowed to break
     at all. */
  .at-table .ag-id { font-family:var(--mono); font-size:0.76rem; display:block;
                     white-space:normal; overflow-wrap:anywhere; }
  .at-table .ag-slug { display:block; font-size:0.68rem; color:var(--muted);
                       white-space:normal; overflow:visible; overflow-wrap:anywhere; }
  .at-table .ag-kind { display:block; font-size:0.6rem; letter-spacing:0.06em; text-transform:uppercase;
                       color:var(--faint); }
  .at-table .c-st { white-space:nowrap; font-size:0.68rem; letter-spacing:0.03em; text-transform:uppercase; }
  .at-table .c-cost { font-family:var(--mono); text-align:right; white-space:nowrap;
                      font-variant-numeric:tabular-nums; }
  .at-table .c-vd { white-space:nowrap; font-size:0.68rem; }
  .at-table .c-im { min-width:14rem; color:var(--muted); line-height:1.35; }
  .at-table .c-last { font-family:var(--mono); font-size:0.68rem; color:var(--muted); white-space:nowrap; }
  .vd { font-size:0.66rem; letter-spacing:0.04em; text-transform:uppercase; }
  .vd-confirmed { color:var(--good); }
  .vd-drift { color:var(--warn); }
  .vd-none { color:var(--faint); }
  .at-table .ev-row td { background:var(--paper); }
  .at-none { font-size:0.78rem; color:var(--muted); margin:0.7rem 0 0; }
`;
