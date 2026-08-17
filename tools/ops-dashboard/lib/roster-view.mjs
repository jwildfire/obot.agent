// The agent roster, as a page rather than as a list.
//
// @jwildfire, 2026-08-16, at the keyboard: "the sessions page is still a mess." He
// was right, and the reason was not styling. The roster shipped through the
// dashboard's generic `## Heading` renderer — a deliberate choice that let it reach
// the page with no table code — and that renderer can only produce bullets of equal
// weight. So twenty-five agents arrived as a flat wall of run-on prose: no columns,
// no grouping, the cost buried mid-sentence, and the one number the page exists to
// show sitting in the last row.
//
// The requirement's own success test (jwildfire/obot.roadmap#199) is that he "can
// tell at a glance which agents earned their tokens and which produced nothing".
// A flat list cannot answer that at a glance whatever the rows say, because at a
// glance is a claim about structure. So the structure is the fix:
//
//   - the headline first, not last — workers today, what they cost, how many moved
//     something and how many did not, against the pre-id total;
//   - rows grouped by OUTCOME, because that is the question being asked. Running
//     now, then ended badly, then delivered, then produced nothing;
//   - four real columns, so a cost can be compared with the cost above it;
//   - one grid, two shapes: columns on a desktop, two lines on a phone with the
//     cost still in a fixed position. 390px is a gate here, not a nicety.
//
// WHAT THE BRIEF GOT WRONG, AND THE DATA CORRECTED.
//
// The complaint that came with this work was that seventeen of twenty-eight rows
// say "no worker id" and are therefore noise — probes and standing sessions padding
// out a list of real work. Measured against the live model that is not what they
// are. Of the fourteen rows with no id, ten are ordinary workers that ran earlier
// the same day, before the ledger was adopted at midday; between them they moved
// three requirements and carried more of the day's spend than the eleven that do
// have ids. Only two are probes and two are standing sessions.
//
// So the split that matters is not id versus no id — that is an accident of when
// the ledger landed — it is WORKER versus STANDING SESSION versus PROBE. A worker
// is judged on what it delivered. A standing session is a long-lived concierge and
// has no deliverable to judge, so it is shown apart rather than ranked as if it had
// produced nothing. Grouping on the id would have buried ten real workers, which is
// the same failure in the other direction.
import { esc } from './esc.mjs';
import { WORKER_TAGS, PRICE_NOTE, ID_NOTE, DEAD_SHOWN, emptyRoster } from './roster.mjs';

// Re-exported: the sentence is a fact about the model's sources, so it lives with
// the model — but the page and its tests reach for it here.
export { emptyRoster };
import { UNMEASURED, moneyFigure, nothingYet } from './absent.mjs';

const money = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The standing roles — the agents that are a ROLE rather than a piece of work.
 *
 * One registry, and the only place a standing role is declared. Everything that has
 * to know what a standing role is reads it from here: the kind a row is judged by,
 * the Kind filter, and which rows the Agents tab pins by default
 * (jwildfire/obot.agent#169). Declaring a fourth role is adding a line here, and it
 * then arrives pinned without anyone remembering to pin it — which is the whole
 * reason this is a registry and not three names spread across three modules.
 *
 * Keyed by TAG, because the tag is the one thing every session of a role shares: a
 * role's session name can change, and prime has been restarted more often than
 * anything else on the machine. Named by their own tags rather than by "has no
 * worker id", for the reason in the header.
 */
export const STANDING_ROLES = [
  {
    tag: '\u{1F3A9}\u{1F916}',
    name: '\u{1F3A9}\u{1F916} obot-prime',
    short: 'prime',
    role: 'the concierge',
    resting: 'no concierge session on this machine — nothing is answering questions',
  },
  {
    tag: '\u{1F9ED}\u{1F916}',
    name: '\u{1F9ED}\u{1F916} obot-navigator',
    short: 'nav',
    role: 'the operating officer',
    resting: 'no Navigator session on this machine — nothing is sweeping or judging',
  },
  {
    // The fleet manager (obot.agent#167). Short-lived by design: it launches when a
    // condition fires and exits, so absent is its ordinary state — which is exactly
    // why it needs a row that says so rather than a gap. The tag and session name
    // are `MANAGER_TAG` / `MANAGER_NAME` in tools/navigator/fleet.mjs; the guard in
    // test/pins.test.mjs holds the two in step once that module lands, rather than
    // importing across tools and coupling the dashboard to the launcher.
    tag: '\u{1F6A6}\u{1F916}',
    name: '\u{1F6A6}\u{1F916} obot-fleet',
    short: 'fleet',
    role: 'the fleet manager',
    resting: 'not running — it launches when a condition fires and exits, so this is its resting state, not a fault',
  },
];

export const STANDING_TAGS = STANDING_ROLES.map((r) => r.tag);

const startsWithAny = (s, tags) => tags.some((t) => String(s ?? '').startsWith(t));

/** Which standing role a row is, or null when it is not one. */
export const standingRoleOf = (row) => STANDING_ROLES.find(
  (r) => String(row?.label ?? '').startsWith(r.tag),
) ?? null;

/**
 * What kind of agent this row is — which decides how it is judged, not where it
 * sorts. `worker` covers both the id era and the workers that ran before it.
 */
export function kindOf(row) {
  if (startsWithAny(row.label, STANDING_TAGS)) return 'standing';
  if (row.id || startsWithAny(row.label, WORKER_TAGS)) return 'worker';
  return 'other';
}

const ENDED_BADLY = new Set(['died', 'stale']);
const NO_SESSION = new Set(['not launched', 'no job record', 'subagent']);

/**
 * The groups, in the order he reads them.
 *
 * Outcome-first and cost-descending inside each group, so the most expensive
 * failure is the first thing under "ended badly" and the most expensive agent that
 * produced nothing is the first thing under that. Ordering by id instead — which is
 * what a flat list does — sorts by when an agent happened to be spawned, which is
 * the one property nobody is asking about.
 */
export function groupRoster(model) {
  const rows = model.rows ?? [];
  const kinds = new Map(rows.map((r) => [r, kindOf(r)]));
  const workers = rows.filter((r) => kinds.get(r) === 'worker');
  const standing = rows.filter((r) => kinds.get(r) === 'standing');
  const other = rows.filter((r) => kinds.get(r) === 'other');

  const byCost = (a, b) => (b.cost.value ?? -1) - (a.cost.value ?? -1)
    || String(a.id ?? a.label).localeCompare(String(b.id ?? b.label));

  const live = workers.filter((r) => r.status.status === 'running');
  const bad = workers.filter((r) => ENDED_BADLY.has(r.status.status));
  const rest = workers.filter((r) => !live.includes(r) && !bad.includes(r) && !NO_SESSION.has(r.status.status));
  // With no delivery record every finished row looks identical to one the record
  // was silent about, so they are held apart rather than all sentenced together.
  const unjudged = rest.filter((r) => r.impact.unjudged);
  const judgedRest = rest.filter((r) => !r.impact.unjudged);
  const delivered = judgedRest.filter((r) => !r.impact.empty);
  const nothing = judgedRest.filter((r) => r.impact.empty);
  const quiet = [...workers.filter((r) => NO_SESSION.has(r.status.status)), ...other];

  // Only rows that carry a figure. `?? 0` made an unpriced row worth nothing, which
  // is how "$0.00 spent" appeared above a column of dashes — and it survived the
  // artifact-absent fix in the day-two case, where the artifact exists and simply
  // holds no cell for today's agents (jwildfire/obot.roadmap#223).
  const priced = (list) => list.filter((r) => r.cost.value !== null && r.cost.value !== undefined);
  const spend = (list) => priced(list).reduce((n, r) => n + r.cost.value, 0);

  // Two measurements the headline may not fake. `costRead` is false when the hub
  // has produced no priced usage artifact, and every cost below is then a dash
  // rather than a number — so a total of those dashes is not $0.00, it is nothing.
  // `judged` is false when the delivery record has never been written, and an
  // unwritten record is not a finding that nobody delivered.
  const artifactRead = !!model.usage && !model.usage.missing;
  const judged = !rows.some((r) => r.impact?.unjudged);
  // Read and priced are two questions. An artifact that opened but holds nothing for
  // any of these rows has measured none of them, and their sum is not zero.
  const costRead = artifactRead && priced(workers).length > 0;
  const standingCostRead = artifactRead && priced(standing).length > 0;

  return {
    headline: {
      workers: workers.length,
      cost: costRead ? spend(workers) : null,
      costRead,
      artifactRead,
      unpriced: workers.length - priced(workers).length,
      delivered: judged ? workers.filter((r) => !r.impact.empty).length : null,
      // The same set the "Produced nothing" group holds. It used to be every worker
      // with an empty impact, which swept in the ones still running — so the
      // headline said "1 produced nothing" over a row the page itself labelled
      // "still working" under "Running now". A verdict passed early is the same
      // defect as a verdict passed over an unread file.
      nothing: judged ? nothing.length : null,
      judged,
      standing: standing.length,
      standingCost: standingCostRead ? spend(standing) : null,
      standingCostRead,
      unattributed: model.unattributed ?? null,
    },
    groups: [
      { id: 'live', title: 'Running now', rows: live.sort(byCost),
        note: 'spending tokens as you read this' },
      { id: 'bad', title: 'Ended badly', rows: bad.sort(byCost),
        note: 'died, or went quiet with no closeout — the rows worth reading first' },
      { id: 'delivered', title: 'Delivered', rows: delivered.sort(byCost),
        note: 'moved a requirement, or closed or merged something' },
      { id: 'nothing', title: 'Produced nothing', rows: nothing.sort(byCost),
        note: 'finished, and the delivery record shows nothing moved' },
      { id: 'unjudged', title: 'Finished, not judged', rows: unjudged.sort(byCost),
        note: 'no delivery record on this machine yet, so nothing here has been weighed either way' },
      { id: 'standing', title: 'Standing sessions', rows: standing.sort(byCost),
        note: 'long-lived, and not judged on delivery — they answer and route rather than ship' },
    ].filter((g) => g.rows.length),
    quiet: quiet.sort(byCost),
    jobsRead: model.sources?.jobs?.present !== false,
    unjudgedRows: rows.some((r) => r.impact?.unjudged),
    unattributed: model.unattributed ?? null,
    droppedDeaths: model.droppedDeaths ?? 0,
    usage: model.usage ?? null,
    epochDay: model.epochDay ?? null,
  };
}

const STATUS_TONE = {
  running: 'live', died: 'bad', stale: 'bad', finished: 'done',
  waiting: 'wait', 'not launched': 'null', 'no job record': 'null', subagent: 'null',
};

const refLink = (r) => (r.url
  ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.ref)}</a>`
  : `<span class="ref-plain" title="no repository named, so no link can be built without guessing">${esc(r.ref)}</span>`);

/**
 * The impact cell: the summary, and the references themselves when there are few
 * enough to read. Requirements first — the question is whether the plan moved, and
 * a merged pull request that moved no requirement is a weaker answer than one that
 * did, so they must not render as the same thing.
 */
function impactCell(row, kind = kindOf(row)) {
  const i = row.impact;
  if (row.status.status === 'not launched') {
    return '<span class="im-none">no session ever ran under this id</span>';
  }
  if (i.unjudged) {
    // The verdict this cell usually carries requires a record to have been read
    // and found silent about this agent. An absent record is not that finding.
    return '<span class="im-none">not judged — no delivery record yet</span>';
  }
  if (i.empty) {
    // Three different silences, and rendering them as one sentence is how the page
    // told a lie about two of them. A standing session has no deliverable to have
    // moved, so "nothing moved" reads as a failed agent and directly contradicts the
    // heading above it; an agent still working has not finished producing anything
    // yet, so the same words are a verdict passed early.
    if (kind === 'standing') return '<span class="im-none">not judged on delivery</span>';
    if (row.status.status === 'running') return '<span class="im-none">still working</span>';
    return '<span class="im-none">nothing moved</span>';
  }
  const bits = [];
  if (i.moved.length) bits.push(`<span class="im-moved">${plural(i.moved.length, 'requirement')} moved</span> ${i.moved.map(refLink).join(' ')}`);
  if (i.closed.length) bits.push(`<span class="im-closed">${i.closed.length} landed</span> ${i.closed.map(refLink).join(' ')}`);
  if (i.mentioned.length) bits.push(`<span class="im-ref">${i.mentioned.length} named only</span>`);
  return bits.join('<span class="im-sep"> · </span>');
}

/** The row's evidence, shown only when he opens it. */
function rowDetail(row) {
  const li = [];
  li.push(`<li><span class="k">status</span> ${esc(row.status.note || row.status.status)}</li>`);
  if (row.cost.value === null || row.cost.code !== 'priced') {
    li.push(`<li><span class="k">cost</span> ${esc(row.cost.text)}</li>`);
  }
  for (const m of row.impact.moved) li.push(`<li><span class="k">moved</span> ${refLink(m)}</li>`);
  for (const c of row.impact.closed) li.push(`<li><span class="k">${esc(c.verb ?? 'landed')}</span> ${refLink(c)}</li>`);
  for (const n of row.impact.mentioned) li.push(`<li><span class="k">named only</span> ${refLink(n)} <span class="dim">${esc(n.verb ?? 'named')}</span></li>`);
  for (const v of row.impact.verdicts) {
    li.push(`<li><span class="k">verdict ${esc(v.verdict)}</span> ${esc(v.produced)}${v.note ? ` — ${esc(v.note)}` : ''}</li>`);
  }
  const usage = [
    plural(row.sessions, 'session'),
    row.tokens ? `${row.tokens.toLocaleString('en-US')} tokens` : null,
    row.cost.calls ? `${row.cost.calls.toLocaleString('en-US')} API calls` : null,
    row.cost.sub ? `subagents ${money(row.cost.sub.cost)} of it` : null,
    row.cost.span ? `across ${row.cost.span}` : null,
  ].filter(Boolean);
  li.push(`<li><span class="k">usage</span> ${esc(usage.join(' · '))}</li>`);
  if (row.claimedAt) li.push(`<li><span class="k">claimed</span> ${esc(row.claimedAt.slice(0, 16).replace('T', ' '))}${row.task ? ` — ${esc(row.task)}` : ''}</li>`);
  for (const s of row.subs) li.push(`<li><span class="k">subagent</span> ${esc(s.id)}${s.slug ? ` ${esc(s.slug)}` : ''} — rolled into this row</li>`);
  return `<ul class="ag-ev">${li.join('')}</ul>`;
}

/**
 * One agent. A four-column grid on a desktop and a two-line block on a phone, from
 * one piece of markup — the cost keeps a fixed position in both, which is the whole
 * reason it is a column and not a clause.
 */
export function agentRow(row, kind = kindOf(row)) {
  const name = row.id ?? row.label;
  const sub = row.id ? (row.slug || '') : '';
  const tone = STATUS_TONE[row.status.status] ?? 'done';
  return `<details class="ag" data-tone="${esc(tone)}">
  <summary>
    <span class="ag-name"><span class="ag-id">${esc(name)}</span>${sub ? `<span class="ag-slug">${esc(sub)}</span>` : ''}</span>
    <span class="ag-st tone-${esc(tone)}">${esc(row.status.status)}</span>
    <span class="ag-cost cost-${esc(row.cost.code ?? 'none')}" title="${esc(row.cost.text)}">${esc(row.cost.short ?? '—')}</span>
    <span class="ag-im">${impactCell(row, kind)}</span>
  </summary>
  ${rowDetail(row)}
</details>`;
}

const group = (g) => `<section class="ag-g">
  <h3 class="ag-gh">${esc(g.title)} <span class="ag-gn">${g.rows.length}</span><span class="ag-gnote">${esc(g.note)}</span></h3>
  ${g.rows.map((r) => agentRow(r)).join('\n')}
</section>`;

const tile = (label, big, sub) => `<div class="hl-t"><span class="hl-k">${esc(label)}</span><span class="hl-v">${big}</span><span class="hl-s">${sub}</span></div>`;

/** The three numbers the page exists to show, at the top where they belong. */
/** `$1,234.56 spent`, or the reason there is no figure — never `$0.00 spent`. */
const spentSub = (h) => {
  if (h.costRead) return `${esc(money(h.cost))} spent${h.unpriced ? ` · ${h.unpriced} not yet priced` : ''}`;
  return h.artifactRead
    ? 'spend not measured — the usage artifact holds no figure for any of these agents yet'
    : 'spend not measured — no priced usage artifact';
};

/** The delivery tile's big number, and the sentence under it. */
const movedBig = (h) => (h.judged ? `${h.delivered}` : UNMEASURED);
const movedSub = (h) => {
  if (!h.judged) return 'no delivery record yet — impact not measured';
  if (h.nothing) return `${h.nothing} produced nothing`;
  // `delivered === 0` with `nothing === 0` used to fall through to the
  // congratulation, so a page with nothing credited to anyone read "every one
  // delivered".
  return h.delivered ? 'every one delivered' : 'no agent has been credited with anything yet';
};

/** The standing tile: an empty group has no cost, rather than a cost of zero. */
const standingText = (h) => (h.standing
  ? esc(h.standingCostRead ? money(h.standingCost) : UNMEASURED)
  : UNMEASURED);
const standingSub = (h) => (h.standing
  ? 'concierge and officer, not judged on delivery'
  : 'no standing session on this machine yet');

function headline(h) {
  const u = h.unattributed;
  return `<div class="hl">
  ${tile('Workers today', `${h.workers}`, spentSub(h))}
  ${tile('Moved something', movedBig(h), movedSub(h))}
  ${tile('Standing sessions', standingText(h), standingSub(h))}
  ${u ? tile('Before worker ids', esc(h.artifactRead ? money(u.cost) : UNMEASURED), `${plural(u.agents, 'agent')}, none traceable`) : ''}
</div>`;
}

/**
 * The brief — his page's pieces (jwildfire/obot.roadmap#218): the headline, what
 * is running, what ended badly, and one line of counts pointing at the full
 * record. The delivered and produced-nothing rosters, the folds, the legend and
 * the old live view all live on /session/log now — the log is written for its
 * dense readers, and his page is written for someone who was not present. The
 * caller interleaves the what-changed feed between headline and groups.
 */
export function briefParts(model) {
  if (!model || !(model.rows ?? []).length) {
    return { empty: `<p class="ag-empty">${esc(emptyRoster(model))}</p>` };
  }
  const v = groupRoster(model);
  const h = v.headline;
  const u = h.unattributed;
  const g = (id) => v.groups.filter((x) => x.id === id).map(group).join('\n');
  const delivered = v.groups.find((x) => x.id === 'delivered')?.rows.length ?? 0;
  const nothing = v.groups.find((x) => x.id === 'nothing')?.rows.length ?? 0;
  const standing = v.groups.find((x) => x.id === 'standing')?.rows.length ?? 0;
  const unjudged = v.groups.find((x) => x.id === 'unjudged')?.rows.length ?? 0;
  const counts = [
    delivered ? `${delivered} delivered` : null,
    nothing ? `${nothing} produced nothing` : null,
    unjudged ? `${unjudged} not judged` : null,
    standing ? `${standing} standing` : null,
    v.quiet.length ? `${plural(v.quiet.length, 'quiet agent')}` : null,
  ].filter(Boolean).join(' · ');
  return {
    headline: `<div class="hl">
  ${tile('Workers today', `${h.workers}`, spentSub(h))}
  ${tile('Moved something', movedBig(h), movedSub(h))}
</div>
<p class="hl-clause">Standing sessions ${standingText(h)} — ${standingSub(h)}.${u ? ` Before worker ids: ${plural(u.agents, 'agent')}, ${esc(h.artifactRead ? money(u.cost) : UNMEASURED)} — in the full record.` : ''}</p>`,
    live: g('live'),
    bad: g('bad'),
    countsLine: `<p class="ag-more">${esc(counts)} — <a href="/session/log">the full record →</a> <span class="ag-morewhy">every agent as a table, every delivery verdict, every Navigator call</span></p>`,
    foot: foot(v),
  };
}

/**
 * The legend: one line per cost case the page actually used.
 *
 * Per case, not per row. The sentence "not yet priced — it started after the last
 * usage build" is true and worth saying once; saying it inside the cost column of
 * every current row is what made the column unreadable.
 */
function costLegend(groups, quiet) {
  const codes = new Set();
  for (const g of groups) for (const r of g.rows) codes.add(r.cost.code ?? 'none');
  for (const r of quiet) codes.add(r.cost.code ?? 'none');
  const say = {
    unpriced: '<code>unpriced</code> — the agent started after the last usage build, so it has a cost that has not been computed yet. Not zero.',
    none: '<code>&mdash;</code> — no usage recorded for this agent at all.',
    stale: 'Figures are as of the last usage build, not as of now.',
    unavailable: '<code>n/a</code> — there is no priced usage artifact, so no figure on this page is a number.',
  };
  const lines = [...codes].filter((c) => say[c]).map((c) => `<li>${say[c]}</li>`);
  return lines.length ? `<ul class="ag-legend">${lines.join('')}</ul>` : '';
}

const foot = (v) => `<details class="ag-foot">
  <summary>About these numbers</summary>
  <ul>
    ${v.usage?.missing
    ? '<li>Cost unavailable: the hub has not produced a priced usage artifact, so no cost here is a figure — and none of them is zero either.</li>'
    : (v.usage?.note ? `<li>${esc(v.usage.note)}</li>` : '')}
    <li>${esc(PRICE_NOTE)}</li>
    <li>${esc(ID_NOTE)}</li>
    <li>Workers that ran before the ledger are grouped as workers, not as unidentified agents: the id marks when the convention landed, not what kind of agent something is.</li>
    <li>Status is the job record joined to its append-only timeline. Where the two disagree the timeline wins, because a state file can say done over a session that fell over.</li>
    <li>Impact is the Navigator delivery record, checked against GitHub — never the job records' own child list, which is empty for nearly half of measured jobs.</li>
    ${v.unjudgedRows ? '<li>No delivery record has been written on this machine yet, so no row above has been judged. That is not a finding that nobody delivered — it is the absence of the file the finding would come from.</li>' : ''}
    ${v.droppedDeaths ? `<li>${plural(v.droppedDeaths, 'earlier agent')} that also ended badly are not shown; the list of deaths is capped at ${DEAD_SHOWN}.</li>` : ''}
    ${v.epochDay ? `<li>Scope: agents active since the ledger was adopted on ${esc(v.epochDay)}.</li>` : ''}
  </ul>
</details>`;

/** The roster page. */
export function rosterHtml(model) {
  if (!model || !(model.rows ?? []).length) {
    return `<p class="ag-empty">${esc(emptyRoster(model))}</p>`;
  }
  const v = groupRoster(model);
  const u = v.unattributed;
  return `${headline(v.headline)}
${v.groups.map(group).join('\n')}
${v.quiet.length ? `<details class="ag-fold">
  <summary>${plural(v.quiet.length, 'agent')} with no job record on this machine <span class="ag-gnote">${esc(v.jobsRead === false
    ? 'claimed, but ~/.claude/jobs is not here to match them against'
    : 'probes, and ids nothing ever ran under')}</span></summary>
  ${v.quiet.map((r) => agentRow(r)).join('\n')}
</details>` : ''}
${u ? `<details class="ag-fold">
  <summary>Before worker ids &mdash; ${plural(u.agents, 'agent')}, ${esc(money(u.cost))} <span class="ag-gnote">no id, so nothing they wrote can be traced to them</span></summary>
  <ul class="ag-pre">
    <li class="dim">${esc(u.first ?? '?')} to ${esc(u.last ?? '?')}, before the ledger existed.</li>
    ${u.top.map((t) => `<li>${esc(t.label)} <span class="ag-cost cost-priced">${esc(money(t.cost))}</span></li>`).join('')}
    ${u.agents > u.top.length ? `<li class="dim">and ${u.agents - u.top.length} more</li>` : ''}
  </ul>
</details>` : ''}
${costLegend(v.groups, v.quiet)}
${foot(v)}`;
}

export const ROSTER_CSS = `
  .ag-wrap { padding:0.7rem 0.8rem 1.4rem; max-width:64rem; margin:0 auto; }

  /* The headline, first. It used to be the last row on the page. */
  .hl { display:grid; grid-template-columns:repeat(auto-fit, minmax(9rem, 1fr)); gap:0.4rem; margin:0 0 0.5rem; }
  .hl-clause { font-size:0.68rem; color:var(--muted); margin:0 0 0.9rem; line-height:1.4; }
  .ag-more { font-size:0.76rem; margin:0.9rem 0 0; }
  .ag-more a { text-decoration:none; }
  .ag-morewhy { color:var(--faint); font-size:0.66rem; }
  .hl-t { border:1px solid var(--line); border-radius:8px; padding:0.5rem 0.6rem; min-width:0; }
  .hl-k { display:block; font-size:0.6rem; letter-spacing:0.1em; text-transform:uppercase; color:var(--faint); }
  .hl-v { display:block; font-size:1.35rem; line-height:1.15; margin:0.1rem 0; font-variant-numeric:tabular-nums; }
  .hl-s { display:block; font-size:0.66rem; color:var(--muted); line-height:1.3; }

  .ag-g { margin:0 0 1rem; }
  .ag-gh { display:flex; align-items:baseline; gap:0.4rem; flex-wrap:wrap; margin:0 0 0.3rem;
           font-size:0.7rem; letter-spacing:0.09em; text-transform:uppercase; color:var(--ink); font-weight:600; }
  .ag-gn { font-variant-numeric:tabular-nums; color:var(--faint); font-weight:400; }
  .ag-gnote { font-size:0.64rem; letter-spacing:0; text-transform:none; color:var(--faint); font-weight:400; }

  /* One row. Four columns on a desktop; two lines on a phone, cost still in a
     fixed position both times — that is the point of it being a column. */
  .ag { border-left:3px solid var(--line); border-bottom:1px solid var(--line); }
  .ag[data-tone="live"] { border-left-color:#4ea1ff; }
  .ag[data-tone="bad"]  { border-left-color:var(--crit); }
  .ag[data-tone="wait"] { border-left-color:#c9a227; }
  .ag > summary { display:grid; gap:0.1rem 0.5rem; align-items:baseline; cursor:pointer;
                  padding:0.3rem 0.45rem; list-style:none;
                  grid-template-columns:minmax(0,1fr) auto;
                  grid-template-areas:"name cost" "st st" "im im"; }
  .ag > summary::-webkit-details-marker { display:none; }
  .ag > summary:hover { background:var(--accent-soft); }
  @media (min-width:44rem) {
    .ag > summary { grid-template-columns:14rem 5.5rem 5rem minmax(0,1fr);
                    grid-template-areas:"name st cost im"; align-items:baseline; }
  }
  .ag-name { grid-area:name; min-width:0; display:flex; gap:0.35rem; align-items:baseline; }
  .ag-id { font-family:var(--mono); font-size:0.76rem; white-space:nowrap; }
  .ag-slug { font-size:0.72rem; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ag-st { grid-area:st; font-size:0.64rem; letter-spacing:0.04em; text-transform:uppercase; }
  .tone-live { color:#4ea1ff; } .tone-bad { color:var(--crit); }
  .tone-wait { color:#c9a227; } .tone-done { color:var(--faint); } .tone-null { color:var(--faint); }
  .ag-cost { grid-area:cost; font-family:var(--mono); font-size:0.76rem; font-variant-numeric:tabular-nums;
             text-align:right; white-space:nowrap; }
  @media (min-width:44rem) { .ag-cost { text-align:right; } }
  .cost-unpriced, .cost-none, .cost-unavailable { color:var(--faint); font-size:0.68rem; }
  .ag-im { grid-area:im; font-size:0.7rem; color:var(--muted); line-height:1.35; min-width:0; }
  .im-moved { color:var(--ink); }
  .im-none { color:var(--faint); }
  .im-sep { color:var(--line); }
  .ag-im a { color:var(--muted); text-decoration:none; border-bottom:1px dotted var(--line); }
  .ag-im a:hover { color:var(--ink); }
  .ref-plain { color:var(--faint); }

  .ag-ev { list-style:none; margin:0; padding:0.1rem 0.45rem 0.5rem 0.9rem;
           display:flex; flex-direction:column; gap:0.12rem; font-size:0.7rem;
           color:var(--muted); line-height:1.4; }
  .ag-ev .k { display:inline-block; min-width:5.5rem; color:var(--faint); font-size:0.64rem;
              letter-spacing:0.04em; text-transform:uppercase; }
  .ag-ev .dim, .ag-pre .dim { color:var(--faint); }
  .ag-ev a { color:var(--muted); }

  .ag-fold { margin:0 0 0.7rem; }
  .ag-fold > summary { cursor:pointer; font-size:0.72rem; color:var(--muted); padding:0.25rem 0; }
  .ag-pre { list-style:none; margin:0.2rem 0 0; padding:0 0 0 0.9rem; font-size:0.72rem;
            color:var(--muted); display:flex; flex-direction:column; gap:0.1rem; }
  .ag-pre .ag-cost { text-align:left; }

  .ag-legend { list-style:none; margin:0.6rem 0 0; padding:0; font-size:0.66rem; color:var(--faint);
               display:flex; flex-direction:column; gap:0.15rem; line-height:1.4; }
  .ag-legend code { font-family:var(--mono); color:var(--muted); }

  .ag-foot { margin:0.9rem 0 0; }
  .ag-foot > summary { cursor:pointer; font-size:0.66rem; letter-spacing:0.09em; text-transform:uppercase;
                       color:var(--faint); padding:0.25rem 0; }
  .ag-foot ul { margin:0.3rem 0 0; padding-left:1rem; font-size:0.68rem; color:var(--faint);
                line-height:1.45; display:flex; flex-direction:column; gap:0.2rem; }
  .ag-empty { padding:1.2rem; color:var(--muted); font-size:0.85rem; }

  /* The older session-level view, kept and demoted. It answers a different question
     with the same word — its AGENTS card counts sessions reporting into the session
     hub, this page counts agents — and two live answers on one screen is worse than
     either, because a reader cannot tell which is true. */
  .livewrap { border-top:1px solid var(--line); margin-top:1.2rem; }
  .livewrap > summary { cursor:pointer; padding:0.5rem 0; font-size:0.7rem; letter-spacing:0.09em;
                        text-transform:uppercase; color:var(--faint); }
  .livewrap .why { font-size:0.66rem; letter-spacing:0; text-transform:none; color:var(--faint);
                   margin:0 0 0.4rem; line-height:1.4; }
  .livewrap iframe { width:100%; height:70vh; border:1px solid var(--line); border-radius:6px; display:block; }
`;
