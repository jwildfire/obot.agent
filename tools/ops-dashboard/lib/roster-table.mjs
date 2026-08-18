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
import { STANDING_ROLES, kindOf, standingRoleOf } from './roster-view.mjs';
import { emptyPins, pinState, pinnedRoles } from './pins.mjs';
import { tagsOf } from '../../lib/roles.mjs';

const money = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Statuses that mean no session ever ran under this row, so it has nothing to have
// produced. Kept in step with roster-view.mjs, where the same set decides grouping.
// `not running` is this view's own: a pinned role with no session at all.
const NO_SESSION = new Set(['not launched', 'no job record', 'subagent', 'not running']);

// The order statuses appear in the sidebar when they appear at all. Anything the
// roster invents that is not on this list sorts after it rather than vanishing —
// a filter that silently omits a status hides exactly the rows worth seeing.
const STATUS_ORDER = ['running', 'stale', 'died', 'waiting', 'finished', 'not launched', 'no job record', 'subagent', 'not running'];

const KIND_LABEL = {
  worker: 'Worker',
  standing: 'Standing session',
  other: 'Probe or unnamed',
  // A session carrying a role's name that ran somewhere other than this workspace —
  // in practice a test fixture in a `mkdtemp` directory (obot.agent#188). Its own
  // kind rather than folded into "Probe or unnamed", because the question a reader
  // has when they see the admiral's name twice is answerable in three words, and
  // because it makes the sidebar able to isolate them.
  foreign: 'Ran outside this workspace',
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

const pad = (n) => String(n).padStart(2, '0');

/**
 * The one day boundary on this page: his, not either record's.
 *
 * Every date here used to be a UTC day, so between midnight and 01:00 local a row
 * read as yesterday — and the rows it misdated were the overnight ones this page
 * exists to report on (jwildfire/obot.agent#174). These two build a day and a clock
 * out of the local calendar, and every date, time and period cutoff below goes
 * through them, so there is one boundary rather than one per column.
 */
const dayString = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clockString = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * The zone the page was rendered in, named rather than implied.
 *
 * A timestamp whose zone is ambiguous is worse than a date, because it invites a
 * wrong inference rather than no inference — and this system genuinely mixes clocks:
 * the worker ledger writes local time with an offset, the harness writes UTC, the
 * priced feed counts UTC days. So the page says which one it is speaking, on the
 * column header and at the foot.
 *
 * Read at render, never hardcoded. The machine's own offset moved from +01:00 to
 * -04:00 inside one day of the ledger this reads, and a zone baked into the source
 * would have been wrong by five hours without anything erroring.
 */
export function localZone(now = new Date()) {
  let name = '';
  try { name = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { name = ''; }
  const mins = -now.getTimezoneOffset();
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  const offset = `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return { name, offset, label: name ? `${name} (${offset})` : offset };
}

/**
 * The local day a stamp falls on, from the instant rather than from the characters.
 *
 * The two records that date an agent do not write the same clock: the worker ledger
 * writes local time with its offset (`2026-08-17T07:40:55+01:00`) and the harness
 * writes UTC (`2026-08-17T06:40:55.129Z`). Slicing the string would print 07:40 next
 * to 06:40 for one moment and nothing would error, so both go through `Date.parse`
 * and come out on one calendar.
 */
const isoDay = (iso) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : dayString(new Date(t));
};

/** The local wall clock of an instant, `HH:MM`, or '' if nothing parses. */
const isoClock = (iso) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : clockString(new Date(t));
};

// Milliseconds are noise in a stamp a human reads; the offset is not, and stays —
// this is the record's own characters, kept verbatim so provenance survives.
const stamp = (iso) => String(iso).replace(/\.\d+/, '');

/** A record's stamp as this page reads it: the local day and clock, then the zone. */
const localStamp = (iso, zone) => {
  const day = isoDay(iso);
  return day ? `${day} ${isoClock(iso)} ${zone.offset}` : '';
};

/**
 * When an agent came into existence, and which record says so.
 *
 * @jwildfire, 2026-08-17: "Add a 'date created' column." Two records could answer,
 * and they answer different questions (jwildfire/obot.agent#168):
 *
 * - The ledger's claim time is when the agent was created. The id is claimed *before*
 *   the spawn, by whoever is spawning it, and an id claimed that never launched is a
 *   real row with a real creation time and no session at all — so the claim is the
 *   only record that dates every worker.
 * - The harness's session start is when the agent began *working*, which is a later
 *   and different fact. It is the only record for the rows that never claimed an id
 *   at all — standing sessions and probes — so it is the fallback, not the primary.
 *
 * The two are minutes apart, which is exactly why this is written down rather than
 * decided by whichever field was nearer to hand: a column measuring something
 * adjacent to its own heading is the defect this dashboard already shipped once with
 * a cost number drawn from a second source.
 *
 * `none` when neither record dates the row — a label that appears only in the priced
 * feed, and the pre-ledger fold. Those read as unknown on the page. The first priced
 * day is *not* borrowed to stand in for a creation time: it is a plausible date, and
 * a plausible wrong date is worse than an obvious absent one.
 */
export function createdOf(row) {
  if (row.claimedAt) return { at: row.claimedAt, source: 'claim' };
  if (row.startedAt) return { at: row.startedAt, source: 'session' };
  return { at: null, source: 'none' };
}

/** What dated this row, in a sentence, for the cell's tooltip and its evidence. */
export function createdText(row, zone = localZone()) {
  const { at, source } = createdOf(row);
  if (source === 'claim') {
    return `worker id claimed ${localStamp(at, zone)}, written as ${stamp(at)}${row.task ? ` for ${row.task}` : ''}`;
  }
  if (source === 'session') {
    return `first session started ${localStamp(at, zone)}, written as ${stamp(at)} — this agent never claimed a worker id, so the harness is the only record that dates it`;
  }
  if (row.synthetic) {
    return 'unknown — these agents ran before worker ids existed, and nothing recorded when any one of them started';
  }
  const first = (row.days ?? [])[0];
  return `unknown — no id claim and no session record on this machine${first ? `; the earliest day it was priced on is ${first}, which is not when it started` : ''}`;
}

/**
 * The cutoff day for each period, resolved once at render so no client does date maths.
 *
 * Counted on the local calendar rather than by subtracting multiples of 24 hours: a
 * period boundary and a displayed date that disagree by an hour is the same defect
 * as a displayed date and a real one that do, one layer further in. `Today` is since
 * local midnight, which is what makes a session that ran at 00:30 fall inside it.
 */
export function periodCutoffs(now = new Date()) {
  const out = {};
  for (const p of PERIODS) {
    if (!p.days) continue;
    out[p.value] = dayString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (p.days - 1)));
  }
  return out;
}

/**
 * When this agent was last seen, and by which record.
 *
 * `lastAt` is an instant — the newest of the harness's session stamps and the
 * ledger's claim — so it can carry a clock. The priced feed cannot: it counts UTC
 * days and keeps no instants, so on the rare row whose priced activity runs past the
 * last harness stamp the day is all there is, and that row shows a date with no time
 * rather than a clock for a moment nothing recorded.
 */
export function lastOf(row) {
  const ts = row.lastAt ? Date.parse(row.lastAt) : NaN;
  if (!Number.isNaN(ts)) return { at: row.lastAt, ts, day: dayString(new Date(ts)), source: 'record' };
  // Only when nothing timed this agent at all. The priced days cannot be compared
  // with the day above them: they are UTC days and that one is local, so `later` is
  // not a question those two can answer about each other. Preferring the priced day
  // whenever it sorted higher as a string is the two-clock trap one level up, and it
  // shipped for one render — every session running on his evening read as tomorrow,
  // with no time, while it was still working.
  const pricedDay = (row.days ?? []).at(-1) ?? '';
  if (pricedDay) return { at: null, ts: null, day: pricedDay, source: 'priced' };
  return { at: null, ts: null, day: '', source: 'none' };
}

/** What the last-active cell knows, and how — the sentence its tooltip carries. */
export function lastText(row, zone = localZone()) {
  const l = lastOf(row);
  if (l.source === 'record') {
    return `last seen ${localStamp(l.at, zone)} — the newest stamp on this agent across the harness job record and the worker ledger, written as ${stamp(l.at)}`;
  }
  if (l.source === 'priced') {
    return `last priced on ${l.day}, a UTC day from the shared usage feed — nothing on this machine timed this agent, and that feed keeps no instants, so this row has a date and no clock`;
  }
  if (row.resting) return 'never — this role has no session on this machine at all';
  return 'unknown — no session stamp and no priced day for this agent';
}

export const TAG_MAX = 100;
const SUMMARY_MAX = 300;

/**
 * A tag that fits a table cell, cut at a word rather than mid-word.
 *
 * 100 characters is his number and it is a hard ceiling, not a target: a tag that
 * overflows its column is a tag that pushed the table sideways on a phone.
 */
export function clip(text, n = TAG_MAX) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const sp = cut.lastIndexOf(' ');
  const kept = sp > n * 0.55 ? cut.slice(0, sp) : cut;
  return `${kept.replace(/[\s,;:.\u2013\u2014-]+$/, '')}\u2026`;
}

// Statuses where the agent is still in the middle of something, so "what is it
// doing" is a live question with a live answer. `stale` is in here on purpose: an
// agent that stopped writing heartbeats was doing something when it stopped, and
// that line is still the last true answer to what it was doing.
const LIVE_STATUS = new Set(['running', 'waiting', 'stale']);

const TASK_KIND = {
  doing: 'doing now',
  delivered: 'delivered',
  closed: 'closed out',
  dispatched: 'dispatched to',
  role: 'its standing job',
  prior: 'before the ledger',
};

/**
 * What this agent is doing, or what it did — the row's task tag.
 *
 * The question the tag answers changes with the state, and papering that over with
 * one source is how a table ends up describing the wrong thing plausibly. Four
 * authored records answer it, in this order, and each says which one it used:
 *
 * 1. A live agent gets the harness's own line for this minute. That is the field
 *    `claude agents` renders, and it is why that view reads better than this one did.
 * 2. A finished agent gets the delivery record's `produced` line — written by the
 *    Navigator at close-out and checked against GitHub, so it is what the agent did
 *    rather than what it said it did.
 * 3. Failing that, the close-out line the agent itself wrote into the job record.
 * 4. Failing that, the one-line task on the worker-ledger claim, which every
 *    dispatch is meant to carry and 33 of 50 claims already do.
 *
 * Nothing here is inferred, and the worker slug is never used: `mergegate` and
 * `landseven` are addresses, not descriptions, and a table of them is the thing this
 * change exists to remove. A row no record describes gets no tag — a blank cell that
 * says why on expand is honest, and a plausible-sounding guess is not.
 */
export function taskOf(row) {
  const live = LIVE_STATUS.has(row.status?.status ?? '');
  const line = row.line ?? null;
  const verdict = (row.impact?.verdicts ?? []).at(-1) ?? null;
  const produced = String(verdict?.produced ?? '').trim();
  const ledger = String(row.task ?? '').trim();
  const at = (iso) => (iso ? ` at ${stamp(iso)}` : '');

  const made = (kind, text, source) => ({
    kind, text: clip(text), full: clip(text, SUMMARY_MAX), source,
  });

  if (live && line) {
    return made('doing', line.text, `the harness ${line.source}, written${at(line.at)} — what it is doing now, not what it was sent to do`);
  }
  if (produced) {
    return made('delivered', produced, 'the Navigator delivery record at close-out, checked against GitHub');
  }
  if (line) {
    return made('closed', line.text, `the harness ${line.source}, written${at(line.at)} — the agent's own account of what it finished`);
  }
  if (ledger) {
    return made('dispatched', ledger, 'the task on its worker-ledger claim — what it was sent to do, not a report of what it did');
  }
  if (row.resting) {
    return made('role', row.role?.resting ?? row.status?.note ?? '', 'the standing-role registry — this role has no session to describe');
  }
  if (row.synthetic) {
    return made('prior', 'ran before worker ids existed, so nothing they did can be traced to any one of them', 'the priced feed, which is all that survives of these agents');
  }
  return null;
}

/** Why a row has no tag, said in the place a reader will look for one. */
export function taskText(row) {
  const t = taskOf(row);
  if (t) return `${TASK_KIND[t.kind] ?? t.kind}: ${t.source}`;
  if (row.status?.status === 'not launched') return 'no task recorded — the id was claimed with no task line and no session ever ran under it';
  return 'no task recorded — no live line, no close-out verdict, and no task on the ledger claim';
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
  const kind = row.foreignRole ? 'foreign' : (row.kind ?? kindOf(row));
  const status = row.status?.status ?? '';
  const i = row.impact ?? { moved: [], closed: [], mentioned: [], verdicts: [], empty: true };

  const produced = [];
  if (i.moved?.length) produced.push('moved');
  if (i.closed?.length) produced.push('landed');
  if (i.mentioned?.length) produced.push('named');
  if (!produced.length) {
    if (NO_SESSION.has(status)) produced.push('unrun');
    // A foreign session is judged where it ran, if anywhere. Calling it "produced
    // nothing" here would be a verdict passed on work this workspace never asked for
    // — the same early verdict the running-agent case fixed.
    else if (kind === 'standing' || kind === 'foreign') produced.push('notjudged');
    else produced.push('nothing');
  }

  const verdicts = [...new Set((i.verdicts ?? []).map((v) => v.verdict))];
  const created = createdOf(row);
  const last = lastOf(row);
  return {
    kind,
    status,
    produced,
    verdict: verdicts.length ? verdicts : ['unjudged'],
    repo: reposOf(row),
    days: row.days ?? [],
    // The local day it was last seen, from the instant where there is one. It was
    // the last of the priced UTC days until now, which put the Last active column
    // on a different calendar from the period filter it feeds (obot.agent#174).
    lastDay: last.day,
    lastAt: last.at,
    lastSource: last.source,
    task: taskOf(row),
    cost: row.cost?.value ?? null,
    // The instant sorts and the day is what is shown. Sorting on the day alone would
    // leave the top of the table arbitrary inside today, which is where half the
    // roster lives on any night the machine is busy.
    created: created.at,
    createdSource: created.source,
    createdDay: created.at ? isoDay(created.at) : '',
    createdTs: created.at ? Date.parse(created.at) : null,
    models: row.models ?? [],
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
    // No model, and none to be had: the priced feed this row is built from carries no
    // model per agent, and these sessions have no job record left to read a flag off.
    models: [],
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
 * A row for a pinned role that has no session on this machine at all.
 *
 * The admiral is short-lived by design (obot.agent#167): it launches when a
 * condition fires, acts, and exits, so ABSENT is its ordinary state. A pinned role
 * with no row leaves a gap, and a gap cannot say whether the role is resting or
 * broken — which is the same failure as a pin that drops its subject on death, one
 * step earlier. So the row exists and says which it is.
 *
 * `cost.value` is null, never 0: a role that has not run has no cost, and $0.00
 * would be a figure this page did not measure.
 */
export function restingRow(role) {
  return {
    id: null,
    idText: 'no session',
    label: role.name,
    slug: role.role,
    kind: 'standing',
    task: '',
    claimedAt: null,
    startedAt: null,
    lastAt: null,
    days: [],
    sessions: 0,
    tokens: 0,
    resting: true,
    role,
    status: { status: 'not running', note: role.resting },
    cost: { value: null, code: 'none', short: '—', text: 'no session, so nothing to price', calls: 0, sub: null, span: null, days: [] },
    impact: { moved: [], closed: [], mentioned: [], verdicts: [], empty: true, summary: 'no session' },
    subs: [],
  };
}

/** One resting row per pinned role the roster has no row for. */
export function restingRows(rows = [], pins = emptyPins()) {
  // Present under ANY tag the role has carried, not just its current one — otherwise
  // a role renamed today gets both a live row under the old tag and a "not running"
  // row under the new one, which is two rows saying opposite things about one role
  // (obot.agent#182).
  //
  // And a row that merely WEARS the tag does not count as present (obot.agent#188).
  // A test fixture in a `mkdtemp` workspace satisfied this check by name, so the
  // role's own "not running" row was suppressed and the band had no row for it at
  // all — the gap that `restingRow` exists to prevent, reintroduced by the fix for
  // the row that caused it.
  const present = (role) => rows.some(
    (r) => !r.foreignRole && tagsOf(role).some((t) => String(r.label ?? '').startsWith(t)),
  );
  return pinnedRoles(pins).filter((role) => !present(role)).map(restingRow);
}

/**
 * The rows the table renders, and the facet of each — the roster in the order it is
 * first painted, which is newest created first.
 *
 * @jwildfire, 2026-08-17: "show most recently created at the top." It painted most
 * expensive first until now, on the reasoning that the page's first question is
 * whether an agent earned its tokens. His is which agent is newest, and cost is one
 * click away in the header, so the default belongs to him.
 */
export function tableRows(model, { now = new Date() } = {}) {
  const rows = (model.rows ?? []).map((r) => ({ ...r, kind: kindOf(r) }));
  const pre = unattributedRow(model.unattributed);
  if (pre) rows.push(pre);
  const withFacets = rows.map((row) => ({ row, f: facetsOf(row) }));
  // Undated rows sort below every dated one rather than above them: an unknown is not
  // a fresh agent, and newest-first would otherwise open the table on the rows that
  // know least. -1 stands in for unknown because every real stamp is ~1.7e12.
  const at = (f) => (f.createdTs === null ? -1 : f.createdTs);
  // The pre-ledger bucket sorts last whatever it cost and whenever it ran. It is not
  // an agent — it is 147 of them added together, with activity running to yesterday —
  // so ranking it with the singles puts a sum above the agents working right now.
  withFacets.sort((a, b) => (a.row.synthetic ? 1 : 0) - (b.row.synthetic ? 1 : 0)
    || at(b.f) - at(a.f)
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
  const model = tally((f) => (f.models.length ? f.models : ['unknown']));

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
    // Filterable because the allocation question is a filter: "what did the expensive
    // model get spent on" is one tick, and the answer is the rows it leaves.
    { id: 'model', title: 'Model', type: 'checkbox', options: ordered(model, ['opus', 'fable', 'sonnet', 'haiku', 'unknown']) },
    { id: 'verdict', title: 'Closeout verdict', type: 'checkbox', options: ordered(verdict, ['confirmed', 'drift', 'none', 'unjudged'], (k) => VERDICT_LABEL[k] ?? k) },
    { id: 'kind', title: 'Kind', type: 'checkbox', options: ordered(kind, ['worker', 'standing', 'other', 'pre-ledger'], (k) => KIND_LABEL[k] ?? k) },
  ].filter((g) => g.options.length || g.empty);
}

// ---- markup --------------------------------------------------------------

const refLink = (r) => (r.url
  ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.ref)}</a>`
  : `<span class="ref-plain" title="no repository named, so no link can be built without guessing">${esc(r.ref)}</span>`);

/**
 * Why a row moved nothing — the sentence that used to be the impact cell.
 *
 * The three silences stay three: a standing session has no deliverable to have
 * moved, an agent still working has not finished producing anything, and an agent
 * that finished having moved nothing is the row worth reading. Rendering them as one
 * sentence told a lie about two of them, and that stays true in an expansion.
 */
function impactNone(row, f) {
  if (row.resting) return row.status.note;
  if (row.synthetic) return 'not attributable — no id, so nothing they wrote can be traced to them';
  if (row.status.status === 'not launched') return 'no session ever ran under this id';
  if ((f?.kind ?? kindOf(row)) === 'standing') return 'not judged on delivery — standing roles are not closed out against a requirement';
  if (row.status.status === 'running') return 'still working — nothing to judge yet';
  return 'nothing moved — the delivery record has no reference for this agent';
}

/**
 * The created cell: the day, and what dated it in the tooltip.
 *
 * A row nothing dates reads `unknown` and shows no date at all, not even the one in
 * its tooltip — the sentence there says what is actually known and why it is not a
 * creation time.
 */
/**
 * The model cell, beside the cost it should be read against.
 *
 * Why this column earns its width: the allocation grant says model choice is
 * deliberate per task — the workhorse for leads and most spawns, the expensive one
 * for judgement-heavy work, a light one for mechanical jobs — and until now nothing
 * made it possible to see whether that is what happens. An expensive model on a
 * mechanical task, or a cheap one on something that needed judgement, is visible at a
 * glance once the model sits next to the money.
 */
function modelCell(row, f) {
  if (!f.models.length) return `<span class="md-none" title="${esc(modelText(row))}">unknown</span>`;
  return f.models.map((m) => `<span class="md md-${esc(m)}" title="${esc(modelText(row))}">${esc(m)}</span>`).join('<span class="im-sep"> · </span>');
}

/** What the model cell knows, and how — the sentence its tooltip and evidence carry. */
export function modelText(row) {
  const models = row.models ?? [];
  if (models.length === 1) return `launched with --model ${models[0]}, from the harness job record`;
  if (models.length > 1) return `ran under ${models.length} models across its sessions: ${models.map((m) => `--model ${m}`).join(', ')}`;
  if (row.synthetic) return 'unknown — the priced feed records no model per agent, and these agents have no job record left to read one from';
  return 'unknown — no job record on this machine carries a launch flag for this agent, and the priced feed records no model per agent';
}

function createdCell(row, f, zone) {
  const why = createdText(row, zone);
  if (!f.created) return `<span class="cr-none" title="${esc(why)}">unknown</span>`;
  return `<span class="cr-${esc(f.createdSource)}" title="${esc(why)}"><span class="dt-d">${esc(f.createdDay)}</span><span class="dt-t">${esc(isoClock(f.created))}</span></span>`;
}

/**
 * The last-active cell: a local day, and the clock under it where a record kept one.
 *
 * The time is stacked under the date rather than beside it so the column is exactly
 * as wide as it was before the time existed — which is the whole of the 390px cost
 * of this change. A row with no instant shows the date alone: a blank where a clock
 * would be is the honest shape of "this day, and no record of when".
 */
function lastCell(row, f, zone) {
  const why = lastText(row, zone);
  if (!f.lastDay) return `<span class="cr-none" title="${esc(why)}">\u2014</span>`;
  const t = f.lastAt ? isoClock(f.lastAt) : '';
  return `<span class="cr-${esc(f.lastSource)}" title="${esc(why)}"><span class="dt-d">${esc(f.lastDay)}</span>${t ? `<span class="dt-t">${esc(t)}</span>` : '<span class="dt-t dt-none">no time recorded</span>'}</span>`;
}

/**
 * The task tag: the one cell that answers "what is this agent doing".
 *
 * The kind chip in front of it is load-bearing rather than decorative. The same
 * column carries "what it is doing now" for a live agent and "what it did" for a
 * finished one, and a reader who cannot tell which is being shown will read a
 * close-out as a live status — which is the failure that made the old table useless
 * in the other direction.
 */
function taskCell(row, f) {
  const t = f.task;
  const why = taskText(row);
  if (!t) return `<span class="tk-none" title="${esc(why)}">\u2014</span>`;
  return `<span class="tk tk-${esc(t.kind)}" title="${esc(why)}"><span class="tk-k">${esc(TASK_KIND[t.kind] ?? t.kind)}</span>${esc(t.text)}</span>`;
}

// The verdict chip that used to sit in the table is gone with the impact column it
// belonged to; `VERDICT_LABEL` still names the sidebar's filter options, which is
// where a question about verdicts across the whole roster is better asked anyway.

/**
 * The evidence under a row — everything the columns had to leave out.
 *
 * @jwildfire, 2026-08-17: "Roadmap impact can be shown on expand." The principle
 * under that ask is that the row says what a thing is and what it is doing, and
 * everything else expands — so the closeout verdict came down here with it. The two
 * were one concept split across a row and its expansion: the verdict is the delivery
 * record's judgement of the very references the impact column listed, and reading
 * `Confirmed` in a table with nothing beside it to confirm is not a fact anyone can
 * act on. Both stay filterable in the sidebar, which is where a whole-table question
 * about impact or verdict was always answered better than by a column of chips.
 */
function evidence(row, f) {
  const li = [];
  const t = f?.task ?? taskOf(row);
  if (t) {
    li.push(`<li><span class="k">${esc(TASK_KIND[t.kind] ?? t.kind)}</span> ${esc(t.full)} <span class="dim">\u2014 ${esc(t.source)}</span></li>`);
  } else {
    li.push(`<li><span class="k">task</span> <span class="dim">${esc(taskText(row))}</span></li>`);
  }
  // The dispatched task as well as the tag, whenever the tag came from somewhere
  // else: what an agent was sent to do and what it then did are different facts, and
  // the row only ever has space for one of them.
  const ledger = String(row.task ?? '').trim();
  if (ledger && t?.kind !== 'dispatched') {
    li.push(`<li><span class="k">dispatched to</span> ${esc(ledger)} <span class="dim">\u2014 the task on its worker-ledger claim</span></li>`);
  }
  li.push(`<li><span class="k">status</span> ${esc(row.status.note || row.status.status)}</li>`);
  // The whole answer to "why is the admiral's name on two rows". Said in the row
  // rather than only in a group heading, because the row is what he taps.
  if (row.foreignRole) {
    li.push(`<li><span class="k">ran in</span> ${esc((row.cwds ?? []).join(' · ') || 'a directory the record does not name')} <span class="dim">— outside this workspace, so it is not this workspace's role however it is named</span></li>`);
  }
  // What ended the session, when the transport ended it rather than the work. It is
  // kept out of the task tag — the agent accounted for nothing, a connection failed —
  // and it is far too useful to drop on the way out.
  if (row.ended) li.push(`<li><span class="k">ended on</span> ${esc(row.ended)} <span class="dim">— the harness, not the agent</span></li>`);
  if (row.cost.value === null || row.cost.code !== 'priced') li.push(`<li><span class="k">cost</span> ${esc(row.cost.text)}</li>`);
  // The demoted impact column keeps its three separate silences down here. They were
  // separated because collapsing them told a lie about two: a standing session has
  // no deliverable to have moved, an agent still working has not finished producing
  // anything, and an agent that finished having moved nothing is the row worth
  // reading. Losing that distinction on the way out of the table would have made
  // this change a regression dressed as a demotion.
  if (row.impact.empty) li.push(`<li><span class="k">roadmap impact</span> <span class="dim">${esc(impactNone(row, f))}</span></li>`);
  for (const m of row.impact.moved) li.push(`<li><span class="k">moved</span> ${refLink(m)}</li>`);
  for (const c of row.impact.closed) li.push(`<li><span class="k">${esc(c.verb ?? 'landed')}</span> ${refLink(c)}</li>`);
  for (const n of row.impact.mentioned) li.push(`<li><span class="k">named only</span> ${refLink(n)} <span class="dim">${esc(n.verb ?? 'named')}</span></li>`);
  for (const v of row.impact.verdicts) li.push(`<li><span class="k">verdict ${esc(v.verdict)}</span> ${esc(v.produced)}${v.note ? ` — ${esc(v.note)}` : ''}</li>`);
  // The demoted verdict column's own silence, which is two different silences: a
  // delivery record that was read and said nothing about this agent, and one that
  // was never read at all. The chip could only ever show the first as a dash.
  if (!row.impact.verdicts.length) {
    li.push(`<li><span class="k">verdict</span> <span class="dim">${esc(row.impact.unjudged
      ? 'no delivery record on this machine, so no verdict either way'
      : 'no close-out verdict recorded for this agent')}</span></li>`);
  }
  const usage = [
    row.synthetic ? null : plural(row.sessions, 'session'),
    row.tokens ? `${row.tokens.toLocaleString('en-US')} tokens` : null,
    row.cost.calls ? `${row.cost.calls.toLocaleString('en-US')} API calls` : null,
    row.cost.sub ? `subagents ${money(row.cost.sub.cost)} of it` : null,
    row.cost.span ? `across ${row.cost.span}` : null,
  ].filter(Boolean);
  if (usage.length) li.push(`<li><span class="k">usage</span> ${esc(usage.join(' · '))}</li>`);
  // Which record dated this agent, spelled out where a tooltip cannot reach: the
  // phone is where he reads this table, and a hover-only provenance is no provenance.
  li.push(`<li><span class="k">created</span> ${esc(createdText(row))}</li>`);
  li.push(`<li><span class="k">model</span> ${esc(modelText(row))}</li>`);
  for (const s of row.subs) li.push(`<li><span class="k">subagent</span> ${esc(s.id)}${s.slug ? ` ${esc(s.slug)}` : ''} — rolled into this row</li>`);
  for (const t of (row.top ?? [])) li.push(`<li><span class="k">${esc(money(t.cost))}</span> ${esc(t.label)}</li>`);
  return `<ul class="ag-ev">${li.join('')}</ul>`;
}

const STATUS_TONE = {
  running: 'live', died: 'bad', stale: 'bad', finished: 'done', waiting: 'wait',
  'not launched': 'null', 'no job record': 'null', subagent: 'null', 'before the ledger': 'null',
};

// Agent, Task, Status, Cost, Model, Created, Last active. Two columns came out and
// one went in: the row now answers what a thing is and what it is doing, and the
// delivery record's two columns — impact and verdict — expand.
const COLS = 7;

/**
 * The pin control. Rendered on every row, not only on the pinned ones: a control
 * that appears when you already have the thing cannot be used to get it, and there
 * is no hover on the screen he reads this on.
 *
 * `title` says why the pin is on when he never clicked it — a default he cannot
 * account for is indistinguishable from a bug.
 */
function pinButton(row, p) {
  const name = row.id ?? row.label;
  const why = p.pinned
    ? (p.explicit
      ? 'Pinned — click to unpin.'
      : 'Pinned by default: it is a standing role rather than a piece of work. Click to unpin.')
    : 'Not pinned — click to pin it to the top.';
  return `<button type="button" class="at-pin" data-key="${esc(p.key)}" data-pinned="${p.pinned ? 'yes' : 'no'}"
    aria-pressed="${p.pinned ? 'true' : 'false'}" title="${why}"
    aria-label="${p.pinned ? 'Unpin' : 'Pin'} ${esc(String(name))}">📌</button>`;
}

/** One agent: the row, and the evidence row beneath it that opens on a tap. */
export function tableRow({ row, f }, index, { pins = emptyPins(), zone = localZone() } = {}) {
  const tone = STATUS_TONE[f.status] ?? 'done';
  const name = row.id ?? row.label;
  const sub = row.id ? (row.slug || '') : ((row.synthetic || row.resting) ? row.slug : '');
  const evId = `ev-${index}`;
  const p = pinState(row, pins);
  return `<tr class="ar" data-tone="${esc(tone)}" tabindex="0" role="button" aria-expanded="false" aria-controls="${evId}"
  data-status="${esc(f.status)}" data-kind="${esc(f.kind)}" data-produced="${esc(f.produced.join(' '))}"
  data-verdict="${esc(f.verdict.join(' '))}" data-repo="${esc(f.repo.join(' '))}"
  data-last="${esc(f.lastDay)}" data-cost="${f.cost === null ? '' : f.cost}"
  data-created="${f.createdTs === null ? '' : f.createdTs}" data-createdday="${esc(f.createdDay)}"
  data-model="${esc(f.models.join(' ') || 'unknown')}"
  data-pinned="${p.pinned ? 'yes' : 'no'}"${row.resting ? ' data-resting="yes"' : ''}
  data-name="${esc(String(name).toLowerCase())}"
  data-task="${esc((f.task?.text ?? '').toLowerCase())}">
  <td class="c-name">${pinButton(row, p)}<span class="ag-id">${esc(name)}</span>${sub ? `<span class="ag-slug">${esc(sub)}</span>` : ''}<span class="ag-kind">${esc(KIND_LABEL[f.kind] ?? f.kind)}</span><span class="ag-born">${f.createdDay ? `created ${esc(f.createdDay)} ${esc(isoClock(f.created))}` : 'created unknown'}</span></td>
  <td class="c-task">${taskCell(row, f)}</td>
  <td class="c-st"><span class="tone-${esc(tone)}">${esc(f.status)}</span></td>
  <td class="c-cost cost-${esc(row.cost.code ?? 'none')}" title="${esc(row.cost.text)}">${esc(row.cost.short ?? '—')}</td>
  <td class="c-model">${modelCell(row, f)}</td>
  <td class="c-created">${createdCell(row, f, zone)}</td>
  <td class="c-last">${lastCell(row, f, zone)}</td>
</tr>
<tr class="ev-row" id="${evId}" hidden><td colspan="${COLS}">${evidence(row, f)}</td></tr>`;
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

/**
 * A sortable header.
 *
 * `sorted` is the order the rows arrive in, stated in the markup rather than left for
 * the script to add: the server sorts, so a page whose header claims `none` while the
 * body is already ordered is lying to a reader who has JavaScript off — and to the
 * screen reader of one who does not.
 */
const th = (key, label, cls = '', { sorted = 'none', title = '' } = {}) => `<th${cls ? ` class="${cls}"` : ''} data-sort="${esc(key)}" tabindex="0" role="button" aria-sort="${esc(sorted)}"${title ? ` title="${esc(title)}"` : ''}><span>${esc(label)}</span></th>`;

// Said on the header itself, not only in the note at the foot: whoever reads a date
// here should be able to find out what it measures without scrolling past the table.
const MODEL_TITLE = 'The model each of this agent’s sessions was launched with, as the harness job record has it — the `--model` flag, verbatim. It sits beside the cost because those two are read against each other: the allocation grant says model choice is deliberate per task, and this is the first column that makes it checkable. Subagent models are not in here, and an agent with no job record on this machine reads unknown.';

const TASK_TITLE = 'What this agent is doing, or what it did — never its slug, which is an address rather than a description. A live agent shows the harness job record\u2019s own line for this minute; a finished one shows the delivery record\u2019s produced line, written at close-out and checked against GitHub; failing that, the close-out line the agent wrote itself; failing that, the one-line task on its worker-ledger claim. The chip in front of the tag says which of those you are reading, because "doing now" and "did" are different questions in one column. Nothing is inferred: a row no record describes shows a dash and says why on expand. Template text is filtered out rather than rendered as a status (obot.agent#177).';

const LAST_TITLE = 'The newest stamp on this agent across the harness job record and the worker ledger, on the local calendar. A row whose only later activity is in the priced usage feed shows that day with no clock, because that feed counts UTC days and keeps no instants.';

const CREATED_TITLE = 'When the agent first appears in the record. Workers are dated by the moment their id was claimed in the ledger, which is before they were spawned; every other row — standing sessions, probes — never claimed an id, so it is dated by its first session start. Each cell names its own source; a row neither record dates reads unknown.';

const foot = (model, zone = localZone()) => `<details class="ag-foot">
  <summary>About these numbers</summary>
  <ul>
    ${model.usage?.missing
    ? '<li>Cost unavailable: the hub has not produced a priced usage artifact, so no cost here is a figure — and none of them is zero either.</li>'
    : (model.usage?.note ? `<li>${esc(model.usage.note)}</li>` : '')}
    <li>Cost comes from the same priced feed as the hub's analytics page — <code>obot.roadmap/scripts/build_usage_data.py</code>. This page never prices anything itself, so the two cannot disagree.</li>
    <li>${esc(PRICE_NOTE)}</li>
    <li>${esc(ID_NOTE)}</li>
    <li>Model is the <code>--model</code> flag each of an agent's sessions was launched with, read verbatim off the harness job record. It is beside the cost on purpose: the allocation grant says model choice is deliberate per task, and these two columns together are the first way to check that — an expensive model on a mechanical job, or a light one on something that needed judgement, shows up at a glance. Two caveats it cannot cover: the flag is what the session was launched with rather than a receipt for every call it made, and subagent models are not in it. The priced feed carries no model per agent at all, so an agent with no job record on this machine reads unknown.</li>
    <li>Created is when the agent first appears in the record, and the table opens on it, newest first. A worker is dated by the moment its id was claimed in the ledger — the claim happens before the spawn, and it is the only record that dates an id that was claimed and never launched. Every other row never claimed an id, so it is dated by its first session start from the harness instead. Each cell says which in its tooltip and in the evidence under the row, and a row neither record dates reads unknown rather than borrowing the first day it was priced on.</li>
    <li>Every date and time on this page is ${esc(zone.label)} — this machine's zone at the moment the page was rendered, read rather than assumed. That is one day boundary for the whole page: the dates, the times and the period filters all turn over at local midnight, so a session that ran at 00:30 reads as today and Today includes it. Until now they were UTC days, which misdated exactly the overnight rows this page exists to report on.</li>
    <li>Times are absolute, never "12m ago". This is a static render — a relative time is right only at the instant it is written, and this page can sit open for hours. A row with a date and no time under it is a row whose only record of that day is the priced feed, which counts UTC days and keeps no instants.</li>
    <li>The two records disagree about the clock — the worker ledger writes local time with an offset, the harness writes UTC — so every stamp is parsed as an instant and shown on the one calendar above, never sliced out of the characters. The record's own text, offset and all, is in each cell's tooltip and in the evidence under the row.</li>
    <li>Task is what the agent is doing, or what it did, and never its slug — a slug is an address, not a description. A live agent shows the harness job record's line for this minute, which is the same field <code>claude agents</code> renders; a finished one shows the delivery record's produced line, written at close-out and checked against GitHub; failing that, the close-out line the agent wrote itself; failing that, the one-line task on its worker-ledger claim. The chip in front of each tag says which. Nothing is inferred — a row no record describes shows a dash and says why on expand, because a plausible tag describing the wrong thing is worse than a blank one. Text that is structurally a template rather than a status is filtered out (obot.agent#177): it reaches this field on sixteen entries and carried a status with it.</li>
    <li>Roadmap impact and the close-out verdict are under each row rather than in it: the row answers what an agent is and what it is doing, and everything else expands. Both are still filters in the sidebar, which is the better place to ask either question across the whole roster.</li>
    <li>Status is the job record joined to its append-only timeline. Where the two disagree the timeline wins, because a state file can say done over a session that fell over.</li>
    <li>Impact is the Navigator delivery record, checked against GitHub — never the job records' own child list, which is empty for nearly half of measured jobs.</li>
    <li>Filter counts are over the whole roster, not over the current selection, so they say what ticking a box would give you.</li>
    <li>Pinned rows sit at the top and are never dropped from this table — not when they end, and not when they die. The standing roles (${esc(STANDING_ROLES.map((r) => r.role).join(', '))}) are pinned by default because of what they are, not by name; unpinning one sticks. Pins are yours, kept on this machine, and never published.</li>
    <li>A pinned role with no session at all still gets a row, reading <code>not running</code>. An absent row would read as health, and a quiet system must not look like a broken one.</li>
    ${model.droppedDeaths ? `<li>${plural(model.droppedDeaths, 'earlier agent')} that also ended badly are not shown; the list of deaths is capped at ${DEAD_SHOWN}.</li>` : ''}
    ${model.epochDay ? `<li>Scope: agents active since the ledger was adopted on ${esc(model.epochDay)}, plus every agent that ended badly whenever it ran.</li>` : ''}
  </ul>
</details>`;

const secRow = (label, note, extra = '') => `<tr class="at-sec"><td colspan="${COLS}"><span class="at-secl">${esc(label)}</span><span class="at-secn">${esc(note)}</span>${extra}</td></tr>`;

/** The Agents table: sidebar, table, and the note about what the numbers are. */
export function agentsTableHtml(model, { now = new Date(), pins = emptyPins() } = {}) {
  if (!model || typeof model !== 'object' || !Array.isArray(model.rows)) {
    return `<p class="ag-empty">${esc(String(model ?? 'The roster could not be assembled.'))}</p>`;
  }
  // A pinned role with no session gets its row here rather than in the model: the
  // model reports what ran, and a role that has not run is a fact about his pins.
  const resting = restingRows(model.rows, pins);
  const { rows, cutoffs } = tableRows(
    resting.length ? { ...model, rows: [...model.rows, ...resting] } : model, { now },
  );
  if (!rows.length) return '<p class="ag-empty">No agent has run since the worker ledger was adopted.</p>';
  const zone = localZone(now);
  const filters = buildFilters(rows);
  const cost = rows.reduce((n, r) => n + (r.f.cost ?? 0), 0);

  // Pinned first, and the order inside each block is the order the sort produced —
  // pinning changes which block a row is in, never how a block is ranked.
  //
  // ONE ROW PER ROLE IN THE BAND. A role that has been renamed has sessions under
  // more than one tag, and all of them resolve to it, so without this the band showed
  // four rows for three roles the day the admiral was renamed — one saying RUNNING
  // under the new tag and one saying DIED under the old, about the same role
  // (obot.agent#182). The band answers "what is each of my roles doing"; the rows are
  // already sorted newest-first, so the first one a role produces is its current
  // session and the older ones drop to the table below rather than out of the page.
  const seen = new Set();
  const claimsBand = (r) => {
    const role = standingRoleOf(r.row);
    if (!role) return true;
    if (seen.has(role.tag)) return false;
    seen.add(role.tag);
    return true;
  };
  const pinnedAll = rows.filter((r) => pinState(r.row, pins).pinned);
  const pinned = pinnedAll.filter(claimsBand);
  const demoted = new Set(pinnedAll.filter((r) => !pinned.includes(r)));
  const rest = rows.filter((r) => !pinState(r.row, pins).pinned || demoted.has(r));
  const bodies = pinned.length
    ? `<tbody class="at-b" data-sec="pinned">
        ${secRow('Pinned', 'always here, whatever their status', '<span class="at-sechid" id="at-pinhid" hidden></span>')}
${pinned.map((r, i) => tableRow(r, `p${i}`, { pins, zone })).join('\n')}
      </tbody>
      <tbody class="at-b" data-sec="rest">
        ${secRow('Everything else', 'newest first, until you sort a column')}
${rest.map((r, i) => tableRow(r, i, { pins, zone })).join('\n')}
      </tbody>`
    : `<tbody class="at-b" data-sec="rest">
${rest.map((r, i) => tableRow(r, i, { pins, zone })).join('\n')}
      </tbody>`;

  return `<div class="at" id="agents">
${sidebar(filters, cutoffs, rows.length, cost)}
<div class="at-main">
  <div class="at-scroll">
    <table class="at-table">
      <thead><tr>
        ${th('name', 'Agent', 'c-name')}
        ${th('task', 'Task', 'c-task', { title: TASK_TITLE })}
        ${th('status', 'Status', 'c-st')}
        ${th('cost', 'Cost', 'c-cost')}
        ${th('model', 'Model', 'c-model', { title: MODEL_TITLE })}
        ${th('created', `Created (${zone.offset})`, 'c-created', { sorted: 'descending', title: CREATED_TITLE })}
        ${th('last', `Last active (${zone.offset})`, 'c-last', { title: LAST_TITLE })}
      </tr></thead>
${bodies}
    </table>
  </div>
  <p class="at-none" id="at-none" hidden>No agent matches these filters. <button type="button" class="at-clear2">Clear them</button></p>
  <p class="ag-more"><a href="/session/log">The full record →</a> <span class="ag-morewhy">every delivery verdict, every Navigator call, and what changed</span></p>
  ${foot(model, zone)}
</div>
</div>
<script>${TABLE_JS}</script>`;
}

// The page's own behaviour: filter, sort, expand. Inline and dependency-free, like
// every other script on this server — the dashboard has no build step and a page
// that needs one stops being servable from a file on his machine.
export const TABLE_JS = `
(function () {
  var root = document.getElementById('agents');
  if (!root) return;
  var side = document.getElementById('at-side');
  var bodies = Array.prototype.slice.call(root.querySelectorAll('tbody.at-b'));
  var rows = Array.prototype.slice.call(root.querySelectorAll('tr.ar'));
  var inputs = Array.prototype.slice.call(root.querySelectorAll('.at-f input'));
  var shown = document.getElementById('at-shown');
  var clear = document.getElementById('at-clear');
  var none = document.getElementById('at-none');
  var pinhid = document.getElementById('at-pinhid');
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
      verdict: values('verdict'), kind: values('kind'), model: values('model')
    };
    var period = picked('active')[0];
    var cutoff = period ? (period.dataset.cutoff || '') : '';
    var active = f.status.length + f.produced.length + f.repo.length + f.verdict.length
      + f.kind.length + f.model.length + (cutoff ? 1 : 0);
    var n = 0, cost = 0, unpriced = 0, pinHidden = 0;
    rows.forEach(function (tr) {
      var d = tr.dataset;
      var ok = hits(d.status, f.status) && hits(d.produced, f.produced) && hits(d.repo, f.repo)
        && hits(d.verdict, f.verdict) && hits(d.kind, f.kind) && hits(d.model, f.model)
        && (!cutoff || (d.last && d.last >= cutoff));
      tr.hidden = !ok;
      var ev = evOf(tr);
      if (ev) ev.hidden = !ok || tr.getAttribute('aria-expanded') !== 'true';
      // A row for a role that has never run is not an agent whose cost is unknown.
      // Counting it as unpriced would put "1 unpriced" on a page where nothing is.
      if (ok) { n++; if (d.cost) cost += parseFloat(d.cost); else if (d.resting !== 'yes') unpriced++; }
      if (!ok && d.pinned === 'yes') pinHidden++;
    });
    var text = n + ' of ' + rows.length + ' · ' + money(cost);
    if (unpriced) text += ' · ' + unpriced + ' unpriced';
    shown.textContent = text;
    clear.hidden = active === 0;
    none.hidden = n !== 0;
    root.setAttribute('data-filtered', active ? 'yes' : 'no');
    // A pin means "always tell me about this one", so when a filter he ticked hides
    // one, the section says so. Silently obeying the filter would leave the pinned
    // block looking complete while a pinned role is missing from it.
    if (pinhid) {
      pinhid.hidden = pinHidden === 0;
      pinhid.textContent = pinHidden ? pinHidden + ' pinned hidden by a filter' : '';
    }
    // A section with nothing left in it says nothing at all.
    bodies.forEach(function (tb) {
      var head = tb.querySelector('tr.at-sec');
      if (!head) return;
      var live = Array.prototype.slice.call(tb.querySelectorAll('tr.ar')).some(function (tr) { return !tr.hidden; });
      head.hidden = !(live || (tb.dataset.sec === 'pinned' && pinHidden > 0));
    });
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
  // Seeded with the order the server already painted, so the first click on Created
  // reverses it instead of re-applying what is on the screen.
  var dir = { created: 'desc' };
  function sortBy(key) {
    // First click on a column shows the end of it he came for: the biggest number,
    // the most recent day, and — for a name — the top of the alphabet.
    var desc = dir[key] === 'desc' ? false : true;
    // Words read forwards. A first click on a name or a model gives the top of the
    // alphabet, not the bottom of it.
    if (key === 'name' || key === 'model' || key === 'task') desc = dir[key] === 'asc' ? true : false;
    dir = {}; dir[key] = desc ? 'desc' : 'asc';
    // Sorted inside each section, never across them: a sort is a question about
    // ranking and pinning is a question about what he is watching, so a click on a
    // column must not scatter the pinned rows back into the table.
    bodies.forEach(function (tb) { sortRows(tb, key, desc); });
  }
  function sortRows(tb, key, desc) {
    var pairs = Array.prototype.slice.call(tb.querySelectorAll('tr.ar')).map(function (tr) { return [tr, evOf(tr)]; });
    pairs.sort(function (a, b) {
      var x = a[0].dataset, y = b[0].dataset, r;
      if (key === 'cost') {
        var cx = x.cost === '' ? -1 : parseFloat(x.cost), cy = y.cost === '' ? -1 : parseFloat(y.cost);
        r = cx - cy;
      } else if (key === 'created') {
        // The instant, not the day: two agents claimed nine hours apart share a date,
        // and sorting on the date alone would leave today arbitrary.
        var ax = x.created === '' ? null : parseFloat(x.created), ay = y.created === '' ? null : parseFloat(y.created);
        // An undated row is no more an answer to "which is oldest" than to "which is
        // newest", so it stays at the bottom whichever way the column points. Returning
        // here is deliberate: it skips the flip below, which is the only way to pin a
        // row against the direction of the sort.
        if (ax === null || ay === null) {
          return (ax === null ? 1 : 0) - (ay === null ? 1 : 0)
            || String(x.name).localeCompare(String(y.name));
        }
        r = ax - ay;
      } else {
        r = String(x[key] || '').localeCompare(String(y[key] || ''));
      }
      // The tie-break returns rather than folding into the comparison, so it is not
      // flipped with the sort. Two workers claimed in the same second tie on every
      // column that can rank them, and a tie-break that reverses with the direction
      // made the client disagree with the server about the same column pointed the
      // same way: W0015 above W0016 on the painted page, below it after one round
      // trip through the header. The server breaks ties by id ascending; so does this.
      if (r === 0) return String(x.name).localeCompare(String(y.name));
      return desc ? -r : r;
    });
    pairs.forEach(function (p) { tb.appendChild(p[0]); if (p[1]) tb.appendChild(p[1]); });
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
      // A control inside the row is not the row. Without the button in this guard a
      // pin click also expands the evidence, and one click appears to do two things.
      if (e.target.closest('a, button')) return;
      toggle(tr);
    });
    tr.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(tr); }
    });
  });

  // Pin and unpin. The click persists to the local ops store and the page re-renders
  // from it, so what he sees after the click is what the store now holds — an
  // optimistic move that the write then failed to record is a pin that appears to
  // stick until the next reload, which is the worst of the three outcomes.
  Array.prototype.slice.call(root.querySelectorAll('.at-pin')).forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      if (b.disabled) return;
      var want = b.dataset.pinned !== 'yes';
      b.disabled = true;
      fetch('/pin', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: b.dataset.key, pinned: want })
      }).then(function (r) { return r.ok ? r.json() : r.json().then(function (j) { throw new Error(j.error || 'refused'); }); })
        .then(function () { window.location.reload(); })
        .catch(function (err) {
          // Said out loud on the control itself. A pin that silently did nothing is
          // the failure this whole feature exists to avoid, one level down.
          b.disabled = false;
          b.classList.add('at-pin-err');
          b.title = 'Could not save that pin: ' + err.message + '. Nothing changed.';
        });
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
  /* The pin control lives in this cell, so it needs back the width the control took
     — otherwise a name as short as obot-prime wraps mid-word on a desktop screen. */
  @media (min-width:44rem) { .at-table .c-name { max-width:14rem; } }
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

  /* The sort key, repeated inside the pinned column on a phone only. Measured at a
     real 390px viewport: the Created cell sits about 475px into the sideways swipe,
     so a table sorted by a column he cannot see reads as a table in no order at all.
     On a desktop the column itself is visible and this would be the same date twice. */
  .at-table .ag-born { display:none; }
  @media (max-width:59.9375rem) {
    .at-table .ag-born { display:block; font-family:var(--mono); font-size:0.6rem; color:var(--faint); }
  }
  .at-table .c-st { white-space:nowrap; font-size:0.68rem; letter-spacing:0.03em; text-transform:uppercase; }
  .at-table .c-cost { font-family:var(--mono); text-align:right; white-space:nowrap;
                      font-variant-numeric:tabular-nums; }
  /* The task tag. It is the widest column and the one he is here to read, so it gets
     a real minimum and wraps to two short lines rather than pushing the dates further
     out of reach on a phone. 100 characters at this size is three lines at 390px and
     one on a desktop — measured, which is why the ceiling is 100 and not 140. */
  .at-table .c-task { min-width:13rem; max-width:26rem; line-height:1.3; }
  .tk { display:block; font-size:0.72rem; color:var(--ink); overflow-wrap:anywhere; }
  /* The chip says whether you are reading "doing now" or "did". Without it the same
     column carries two different questions and nothing distinguishes them. */
  .tk-k { display:block; font-size:0.58rem; letter-spacing:0.08em; text-transform:uppercase;
          color:var(--faint); }
  .tk-doing .tk-k { color:#4ea1ff; }
  .tk-delivered .tk-k { color:var(--good); }
  .tk-dispatched .tk-k { color:var(--warn); }
  .tk-none { color:var(--faint); }

  .at-table .c-created, .at-table .c-last { font-family:var(--mono); font-size:0.68rem; color:var(--muted);
                                           white-space:nowrap; }
  /* The two dates read as a pair, so the sort column is the brighter of them and the
     one the eye lands on when the table opens. */
  .at-table .c-created { color:var(--ink); }
  /* The clock sits under the date rather than beside it, so adding a time costs the
     column no width at all — which is the whole 390px budget for this change. */
  .dt-d { display:block; }
  .dt-t { display:block; font-size:0.62rem; color:var(--faint); }
  .dt-none { font-family:var(--sans, inherit); font-style:italic; letter-spacing:0; }
  .cr-none { color:var(--faint); font-family:var(--sans, inherit); font-style:italic; }

  /* Model, next to the money. Mono so a column of them lines up, and one tone per
     model so a run of the expensive one is visible without reading any of them. */
  .at-table .c-model { font-family:var(--mono); font-size:0.68rem; white-space:nowrap; }
  .md { letter-spacing:0.01em; }
  .md-fable { color:var(--warn); }
  .md-opus { color:var(--accent); }
  .md-sonnet, .md-haiku { color:var(--muted); }
  .md-none { color:var(--faint); font-family:var(--sans, inherit); font-style:italic; }
  .at-table .ev-row td { background:var(--paper); }

  /* The evidence wraps to the screen, not to the table. Inside a box that scrolls
     sideways the cell is as wide as the table (935px at 390px of viewport), so a
     sentence in here used to lay itself out past the right edge and had to be swiped
     to be read — measured, on the row's own provenance line. Sticky at left:0 keeps it
     in front of him however far the table has been swiped; on a desktop, where the
     table already fits, both rules are inert. */
  .at-table .ag-ev { position:sticky; left:0; max-width:calc(100vw - 1.9rem); }
  .at-none { font-size:0.78rem; color:var(--muted); margin:0.7rem 0 0; }

  /* The section bands. Pinned first, and the band is sticky under the header so a
     long pinned block still says what it is while he scrolls. */
  .at-table tr.at-sec td { background:var(--paper); border-bottom:1px solid var(--line);
                           padding:0.25rem 0.5rem; position:sticky; left:0; }
  .at-secl { font-size:0.6rem; letter-spacing:0.11em; text-transform:uppercase; font-weight:600; color:var(--ink); }
  .at-secn { font-size:0.62rem; color:var(--faint); margin-left:0.4rem; }
  .at-sechid { font-size:0.62rem; color:var(--accent); margin-left:0.4rem; }

  /* The pin. Always rendered, because there is no hover on a phone and a control
     that only appears once you have the thing cannot be used to get it. Filled when
     pinned, faint when not — and the tap target stays finger-sized at 390px. */
  .at-pin { float:left; margin:0 0.3rem 0 0; padding:0; width:1.5rem; height:1.5rem; line-height:1.5rem;
            border:0; background:none; cursor:pointer; font-size:0.8rem; text-align:center;
            border-radius:5px; color:inherit; }
  .at-pin[aria-pressed="false"] { opacity:0.25; filter:grayscale(1); }
  .at-pin:hover, .at-pin:focus-visible { opacity:1; filter:none; background:var(--accent-soft); }
  .at-pin[disabled] { opacity:0.5; cursor:progress; }
  .at-pin-err { outline:1px solid var(--crit); opacity:1; filter:none; }
  .at-table tr.ar[data-pinned="yes"] .ag-id { font-weight:600; }
  .at-table tr.ar[data-resting="yes"] .ag-id { font-weight:400; color:var(--muted); }
`;
