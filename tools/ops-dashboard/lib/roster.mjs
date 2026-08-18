// The agent roster — one row per agent with its id, status, cost and roadmap impact.
//
// @jwildfire, 2026-08-16, in one line while approving the Navigator design: "I want
// the opsdb/sessions page refactored to show a list of all agents along with thier
// ID, status, cost and the impact they had on the roadmap." Requirement:
// jwildfire/obot.roadmap#199; task: jwildfire/obot.agent#138.
//
// The question behind it is whether an agent earned its tokens, and until this
// morning it could not be asked: every issue, pull request, comment and commit an
// agent writes is authored by the same `obotclaw[bot]` identity, so GitHub has no
// field that separates one agent from another. The permanent `W0001` worker id is
// the only reliable join, which is why this could not have been built a day ago.
//
// FOUR SOURCES, EACH READ FOR WHAT IT ACTUALLY KNOWS:
//
//   identifier  .claude/workers.journal      the ledger, append-only, the only truth
//   status      ~/.claude/jobs/<id>/         state.json AND timeline.jsonl, see below
//   cost        <hub>/site/usage/usage.json  priced by the hub's build_usage_data.py
//   impact      .claude/session-hub/delivery.md  the Navigator's verdicts
//
// TWO TRAPS, BOTH PAID FOR ONCE ALREADY.
//
// A job's own `state` is not proof it finished. One worker died on 2026-08-15 with
// `done` in its state file and a normal-looking completion note; the only surviving
// evidence is the append-only timeline, whose last entry is still `working` an hour
// before the terminal stamp. So status is a JOIN of the two files and a disagreement
// between them is reported as death, not smoothed over.
//
// Impact is not read from the job records' `children` list. That list is empty for
// nearly half of measured jobs, including one that merged three pull requests and
// filed two issues, so an impact column built on it would under-report exactly the
// agents that did the most. It comes from the delivery record instead — the
// Navigator's verdicts, each already checked against GitHub — and every reference
// renders as a link so any row can be verified in one click.
//
// This module only reads. It never queries GitHub (a page render is the wrong place
// for a network call, and the verdicts it reads are already GitHub-checked) and it
// never prices anything itself: the arithmetic stays in the hub's script so there is
// one priced source and one place to change a rate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { nothingYet } from './absent.mjs';

// Printed on the page rather than left to be discovered. Both are things a reader
// would otherwise have to be told in person, which is the same as not being told.
export const PRICE_NOTE = 'Costs are list-price arithmetic over recorded token counts at API rates — an estimate of what this usage would bill, not a copy of an invoice.';
export const ID_NOTE = 'Worker ids are forward-only from 2026-08-16. Agents that ran before the ledger carry none; they are collapsed into one unattributed row rather than dropped.';

// `W0042`, and `W0042.1` for a subagent claimed under it.
export const ID_RE = /\bW\d{4}(?:\.\d+)?\b/;

// A worker is an agent that produces something. The tags are the ledger's own
// (tools/lib/worker_ledger.py): a standing session is an agent too and gets a row,
// but it is not judged by a worker's rules — most of all `blocked`, which for a
// worker is where it stopped and for a standing session is an ordinary wait.
export const WORKER_TAGS = ['\u{1F46F}\u{1F916}', '\u{1F9BE}\u{1F916}'];

const TERMINAL = new Set(['done', 'stopped']);

// How long a `working` session may say nothing before the page stops calling it
// running. A live agent stamps its timeline every minute or so; an hour of silence
// means the process is probably gone, and "running" would be the reassuring lie.
export const QUIET_MIN = 60;

// The usage artifact is rebuilt by hand (the hub's script reads a local transcript
// store the site build cannot see), so a day is the point past which a cost figure
// stops describing today.
export const STALE_HOURS = 24;

// How many agents that died before the id era keep a named row. A death never ages
// out, but the list of them is bounded and says how many it did not show.
export const DEAD_SHOWN = 8;

const HUB_WORDS = new Set(['hub', 'goal', 'goals', 'roadmap', 'obot.roadmap']);

// What a caller that does not say is assumed to have read. `assumed` marks it as an
// assumption rather than an observation, so nothing downstream can quote it as one.
const DEFAULT_SOURCES = {
  jobs: { path: null, present: true, assumed: true },
  workers: { path: null, present: true, assumed: true },
  usage: { path: null, present: true, assumed: true },
  delivery: { path: null, present: true, assumed: true },
};

const money = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const day = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10); };
const clock = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(11, 16); };

/**
 * The model a session was launched with, from the harness's own record of its launch.
 *
 * @jwildfire, 2026-08-17: "also show me the model in the table." The priced usage
 * artifact cannot answer this — its cells carry no model at all and its `models`
 * breakdown is portfolio-wide — but every session here is launched with an explicit
 * `--model`, and the harness keeps the launch flags. Measured on this machine: 95 of
 * 95 job records carry one, and on every session sampled against its transcript the
 * flag agrees with the model that actually served the turns (`opus` →
 * `claude-opus-5`, `fable` → `claude-fable-5`).
 *
 * Read as what it is — the flag, verbatim, with no version resolved onto it and no
 * default supplied when it is missing. A session launched without the flag inherits
 * its parent's model and the record does not say what that was; naming a likely one
 * would put a model beside a cost figure on no evidence, and those two columns exist
 * to be read against each other.
 */
export function modelFlag(flags) {
  if (!Array.isArray(flags)) return null;
  const i = flags.indexOf('--model');
  if (i === -1) return null;
  const v = flags[i + 1];
  return typeof v === 'string' && v && !v.startsWith('-') ? v : null;
}

function minutesSince(iso, now) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((now.getTime() - t) / 60000));
}

const humanMin = (m) => (m < 90 ? `${m} min` : `${Math.round(m / 60)}h`);

// ---- the ledger ----------------------------------------------------------

/**
 * The worker journal as data: when the convention was adopted, and every id it has
 * issued. The journal is the only truth (see worker_ledger.py) — the rendered
 * roster is never a second copy, and an id is never read out of prose.
 */
export function parseWorkers(text = '') {
  const claims = [];
  let epoch = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.op === 'seed' && rec.epoch) epoch = rec.epoch;
    if (rec.op !== 'claim' || !rec.id) continue;
    claims.push({
      id: String(rec.id), parent: rec.parent ? String(rec.parent) : null,
      slug: rec.slug ?? '', task: rec.task ?? '', at: rec.ts ?? null,
    });
  }
  return { epoch, claims };
}

// ---- status --------------------------------------------------------------

/**
 * Text that is structurally a document rather than a sentence about this agent.
 *
 * The harness writes a one-line `detail` per timeline entry, and that line is the
 * best short description of what an agent is doing that exists anywhere on this
 * machine — which is also what makes it dangerous to render unchecked. Three kinds
 * of text arrive in that field and none of them is a status:
 *
 * - The sibling-briefing template's opening HTML comment, on sixteen entries across
 *   ten jobs (jwildfire/obot.agent#177). It is not inert: one of those entries
 *   re-asserted `blocked` forty-five seconds before a clean close-out.
 * - The state word itself — `stopped` written as its own detail on every stopped
 *   job, which says nothing the status column has not already said.
 * - An unfilled template placeholder, which means a briefing was sampled rather
 *   than a session.
 *
 * The filter lives here rather than in the template because a template fix cannot
 * reach the entries already written: sixteen of them are on disk now and no future
 * change unwrites them. Fixing the template as well is #177's own job.
 */
const TEMPLATE_TEXT = [
  /^\s*<!--/,                                     // opens as a comment
  /-->/,                                          // carries the close of one
  /\{[A-Za-z][\w-]*\}/,                            // an unfilled {placeholder}
  /^#{1,6}\s/,                                    // a markdown heading is a document
  /this is the briefing a lead session hands/i,   // the known offender, by name
];

/**
 * The harness talking about its own transport, rather than the session describing
 * its work.
 *
 * "API Error: Unable to connect to API: SSL certificate hostname mismatch" is a true
 * sentence and it is not a task. Rendered in the task column under the label "the
 * agent's own account of what it finished" it was actively false — the agent
 * accounted for nothing; a connection failed. So these are held apart: they never
 * become a tag, and they surface on expand as what ended the session, beside a
 * status column that already reads `died`.
 *
 * Anchored at the start of the line, deliberately. A worker's own close-out sentence
 * may well mention an error it found and fixed, and a loose match on the word would
 * take that away — which is the same defect in the other direction.
 */
const HARNESS_ERROR = [
  /^API Error\b/i,
  /^You(?:'|\u2019)?ve hit your (?:session|usage) limit/i,
  /^Credit balance is too low/i,
  /^Request timed out/i,
  /^Connection error/i,
  /^Prompt is too long/i,
  /^Invalid API key/i,
  /^Claude(?: Code)? (?:usage|API) limit/i,
];

export const isHarnessError = (text) => HARNESS_ERROR.some((re) => re.test(String(text ?? '').trim()));

// Words the harness writes as a detail when it has nothing to say. Rendering one as
// a task tag would put the status column's own word in a second column.
const BARE_STATE = new Set(['stopped', 'done', 'working', 'idle', 'running', 'blocked', 'failed', 'error', 'completed', 'none', '']);

/**
 * One harness detail line, or null if it is not a sentence about this agent.
 *
 * Null rather than a cleaned-up string: text that is structurally a comment has no
 * salvageable status inside it, and half a template rendered as a task is the same
 * defect one character shorter.
 */
export function cleanDetail(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (BARE_STATE.has(t.toLowerCase())) return null;
  if (TEMPLATE_TEXT.some((re) => re.test(t))) return null;
  return t;
}

/**
 * The append-only timeline, read for where it actually ended — and for the last
 * thing the agent said it was doing.
 *
 * `detail` is the newest entry whose detail survives `cleanDetail`, which is not
 * always the newest entry: a session that died on a limit writes the limit message
 * as its last detail, and that is the status column's sentence rather than this
 * one's. Reading backwards for the last real line is what lets a stopped job — whose
 * state file says only `stopped` — still say what it was doing when it stopped.
 */
export function timelineClose(text = '') {
  let last = null;
  let at = null;
  let entries = 0;
  let detail = null;
  let detailAt = null;
  let error = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec.state) continue;
    entries += 1;
    last = String(rec.state);
    at = rec.at ?? at;
    const d = cleanDetail(rec.detail);
    if (!d) continue;
    if (isHarnessError(d)) error = d;
    else { detail = d; detailAt = rec.at ?? at; }
  }
  return { last, at, entries, closed: TERMINAL.has(last), detail, detailAt, error };
}

/**
 * What the harness itself says this agent is doing, or said it had done.
 *
 * Two records, and the state file wins when it has something: on a finished job it
 * holds the close-out line the agent wrote about its own work ("obot.agent#169
 * merged — pinning live in main"), which is the best sentence anywhere about what
 * that agent did. On a stopped or dead job it holds only the state word, so the
 * timeline's last real line is what is left — and on a working job the two are the
 * same live line.
 */
export function jobLine(job) {
  if (!job) return null;
  const fromState = cleanDetail(job.detail);
  if (fromState && !isHarnessError(fromState)) return { text: fromState, at: job.updatedAt ?? null, source: 'job record' };
  const tl = job.timeline ?? {};
  if (tl.detail) return { text: tl.detail, at: tl.detailAt ?? null, source: 'job timeline' };
  return null;
}

/** What ended a session, when what ended it was the transport rather than the work. */
export function jobError(job) {
  if (!job) return null;
  const fromState = cleanDetail(job.detail);
  if (fromState && isHarnessError(fromState)) return fromState;
  return job.timeline?.error ?? null;
}

/**
 * What the agent is actually doing, from the two records together.
 *
 * The state file alone cannot answer this. It is written last-wins by whatever
 * touched the job, so a session that fell over can leave `done` behind it; the
 * timeline is append-only and cannot. Where they disagree, the timeline wins and
 * the disagreement itself is the finding.
 */
export function statusOf(o = {}, now = new Date()) {
  // `jobsRead: false` means `~/.claude/jobs` is not on this machine, so "no session
  // ever started under this id" is a verdict from an unread directory — and it was
  // demonstrably wrong on rows that simultaneously showed priced spend and a
  // confirmed delivery verdict (jwildfire/obot.roadmap#223).
  if (!o.job && o.claimed && o.jobsRead === false && !o.sub) {
    return { status: 'no job record', note: `id claimed; no job record for it on this machine — either the session never started, or ~/.claude/jobs is not here` };
  }
  if (!o.state) {
    if (o.sub) return { status: 'subagent', note: 'no session of its own — its parent worker is accountable for what it wrote' };
    return o.claimed === false
      ? { status: 'no job record', note: 'it appears in the priced transcript store but the harness kept no job record for it' }
      : { status: 'not launched', note: 'id claimed, no session ever started under it — burned, not lost' };
  }
  const tl = o.timeline ?? { last: null, closed: false, at: null };
  const detail = String(o.detail ?? '').trim();

  if (o.state === 'working') {
    const quiet = minutesSince(o.updatedAt, now);
    if (quiet !== null && quiet > QUIET_MIN) {
      return {
        status: 'stale',
        note: `no heartbeat for ${humanMin(quiet)} — the process may be gone${detail ? `; last said ${detail}` : ''}`,
      };
    }
    return { status: 'running', note: detail || 'working' };
  }

  if (o.state === 'blocked') {
    if (o.worker) {
      const needs = o.needs ? ` — needs ${o.needs}` : '';
      return { status: 'died', note: `blocked: ${detail || 'no reason recorded'}${needs}` };
    }
    return { status: 'waiting', note: detail || 'blocked — the ordinary wait for a standing session' };
  }

  if (o.state === 'stopped') {
    return { status: 'died', note: `stopped${detail && detail !== 'stopped' ? `: ${detail}` : ''} — ended before it closed out` };
  }

  if (o.state === 'done') {
    if (!tl.closed) {
      return {
        status: 'died',
        note: `the state file says done and the timeline never recorded a close — last ${tl.last ?? 'nothing'}${tl.at ? ` at ${clock(tl.at)}` : ''}${detail ? `; it claims ${detail}` : ''}`,
      };
    }
    return { status: 'finished', note: detail || 'closed out' };
  }

  return { status: String(o.state), note: detail };
}

// ---- impact --------------------------------------------------------------

const DELIVERY_LINE = /^-\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(\S+)\s+·\s+produced\s+(.*?)\s+·\s+requirement\s+(.*?)\s+·\s+(confirmed|drift|none)(?:\s+·\s+(.*))?$/;

/**
 * The delivery record's closeout verdicts. Call lines (`· call n0001 ·`) are the
 * Navigator's own decisions rather than an agent's delivery, so they are skipped
 * here — counting them as impact would credit the judge for the work.
 */
export function parseDelivery(md = '') {
  const rows = [];
  for (const raw of String(md).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('- ') || line.includes(' · call ')) continue;
    const m = DELIVERY_LINE.exec(line);
    if (!m) continue;
    rows.push({
      date: m[1], time: m[2], worker: m[3], produced: m[4],
      requirement: m[5], verdict: m[6], note: (m[7] ?? '').trim(),
    });
  }
  return rows;
}

/**
 * A GitHub link for a reference as the record writes it. `hub` and `goal` are both
 * obot.roadmap. A bare `#183` names no repository and gets no link: a guessed link
 * is checkable-looking and wrong, which is worse than an honest number.
 */
export function refUrl(ref) {
  const m = /^([A-Za-z][\w.-]*)\s*#(\d+)$/.exec(String(ref ?? '').trim());
  if (!m) return null;
  const repo = HUB_WORDS.has(m[1].toLowerCase()) ? 'obot.roadmap' : m[1];
  return `https://github.com/jwildfire/${repo}/issues/${m[2]}`;
}

/**
 * Does this job earn a row of its own, rather than a place in the collapsed count?
 *
 * Two ways in. It ran in the id era, or it died — and a death never ages out. Ids
 * are never recycled precisely so history cannot be erased, and a roster that
 * quietly drops the agents that failed reads as complete while hiding the rows most
 * worth seeing (🧭🤖 obot-navigator, 2026-08-16). Everything else older sits behind
 * an explicit count.
 */
export function isCurrent(job, epochDay = null, now = new Date()) {
  const d = day(job.updatedAt ?? job.startedAt);
  if (!epochDay || !d || d >= epochDay) return true;
  const { status } = statusOf({ ...job, worker: isWorkerName(job.name) }, now);
  return status === 'died' || status === 'stale';
}

/**
 * The agents that earn a named row, by display name.
 *
 * The two windows have to agree. A worker that started at 22:48 and ran to 04:03
 * has all its priced usage on yesterday's date and all its job activity on today's
 * — window the job on one and the usage on the other and the same agent appears as
 * a named row reading `no usage recorded` beside a collapsed row holding its money.
 */
export function currentLabels(jobs = [], epochDay = null, now = new Date()) {
  const out = new Set();
  for (const j of jobs) {
    if (j.name && isCurrent(j, epochDay, now)) out.add(j.name);
  }
  return out;
}

// Parenthesised text is evidence, not the subject: `hub#195 (#134 parent verified)`
// names one requirement and the task that proves it, and counting #134 as a
// requirement would inflate every confirmed row.
const stripParens = (s) => String(s ?? '').replace(/\([^)]*\)/g, ' ');

/**
 * References in a fragment, left to right, each normalised to `repo#N`.
 *
 * A bare `#137` inherits the repository last named to its left — the record writes
 * `obot.agent#135 + #137 merged` and both are obot.agent.
 *
 * The prefix has to touch the hash. `Q&A #183` names no repository, and reading the
 * `A` as one produced a link to github.com/jwildfire/A — a reference that looks
 * checkable and goes nowhere is worse than one that admits it is unresolved. With
 * nothing to inherit, a bare number keeps its number and gets no link, except in
 * the requirement field where a bare number is a hub issue by construction.
 */
function refsIn(text, carry = { repo: null }, fallback = null) {
  const out = [];
  const re = /([A-Za-z][\w.-]*)?#(\d+)/g;
  let m;
  while ((m = re.exec(String(text ?? '')))) {
    let repo = m[1];
    if (repo && HUB_WORDS.has(repo.toLowerCase())) repo = 'hub';
    if (repo) carry.repo = repo;
    const resolved = repo ?? carry.repo ?? fallback;
    out.push(resolved ? `${resolved}#${m[2]}` : `#${m[2]}`);
  }
  return out;
}

const VERB = /\b(merged|closed|filed|rewritten|updated|published|recorded|boarded|reviewed)\b/;

/**
 * One agent's impact, in the three buckets the design fixed and in that order:
 * requirements whose stage moved, issues and pull requests closed or merged, and
 * references that moved nothing.
 *
 * A requirement counts as moved only under a `confirmed` verdict. Under `drift` the
 * Navigator has already found that the requirement did not actually gain the work —
 * that is what drift means — so the reference lands in the third bucket, which is
 * the bucket worth reading.
 */
export function impactOf(rows = []) {
  const moved = [];
  const closed = [];
  const mentioned = [];
  const verdicts = [];
  const seen = new Set();
  const add = (bucket, name, ref, verb) => {
    const key = `${name}:${ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    bucket.push({ ref, verb, url: refUrl(ref) });
  };

  for (const r of rows) {
    verdicts.push({ verdict: r.verdict, note: r.note, produced: r.produced, at: `${r.date} ${r.time}` });

    // A bare number in the requirement field is a hub issue: that is where every
    // requirement and goal lives, so `goal #79` resolves without guessing.
    for (const ref of refsIn(stripParens(r.requirement), { repo: null }, 'hub')) {
      if (r.verdict === 'confirmed') add(moved, 'moved', ref, 'moved');
      else add(mentioned, 'ref', ref, 'named, and did not move');
    }

    // Segments share a verb: `obot.agent#113 merged, #65 + #75 closed` is two.
    const carry = { repo: null };
    for (const seg of String(r.produced).split(/[;,]/)) {
      const refs = refsIn(seg, carry);
      if (!refs.length) continue;
      const verb = VERB.exec(seg)?.[1] ?? null;
      const landed = verb === 'merged' || verb === 'closed';
      for (const ref of refs) {
        if (landed) add(closed, 'closed', ref, verb);
        else if (!seen.has(`moved:${ref}`)) add(mentioned, 'ref', ref, verb ?? 'named');
      }
    }
  }

  const parts = [];
  if (moved.length) parts.push(`${plural(moved.length, 'requirement')} moved`);
  if (closed.length) parts.push(`${closed.length} closed or merged`);
  if (mentioned.length) parts.push(`${mentioned.length} referenced`);
  return {
    moved, closed, mentioned, verdicts,
    empty: parts.length === 0,
    // Never a blank cell. A row with nothing in it is the row worth seeing, and a
    // blank reads as "not measured" when it means "measured, and nothing moved".
    summary: parts.length ? parts.join(', ') : 'none',
  };
}

// ---- cost ----------------------------------------------------------------

/**
 * The hub's priced usage artifact, indexed for the join.
 *
 * By id, because the id is inside the agent label the pricing script already
 * records (`👯🤖 W0001 2026-08-16 nobold`), and by label for the agents that have
 * no id. Freshness travels with it: a stale artifact and a zero look identical on
 * a page, and the second one is a lie.
 */
export function usageIndex(usage, { epochDay = null, now = new Date(), current = new Set() } = {}) {
  const byId = new Map();
  const byLabel = new Map();
  if (!usage || !Array.isArray(usage.cells)) {
    return {
      missing: true, stale: true, byId, byLabel, unattributed: null, generatedAt: null,
      ageHours: null, note: 'no usage artifact — run python3 obot.roadmap/scripts/build_usage_data.py',
    };
  }

  const generatedAt = usage.generatedAt ?? null;
  const ageMin = generatedAt ? minutesSince(generatedAt, now) : null;
  const ageHours = ageMin === null ? null : Math.round(ageMin / 60);
  const stale = ageHours === null || ageHours >= STALE_HOURS;

  const blank = () => ({ cost: 0, calls: 0, subCost: 0, subCalls: 0, days: new Set() });
  const bump = (bucket, c) => {
    bucket.cost += c.cost ?? 0;
    bucket.calls += c.calls ?? 0;
    bucket.subCost += c.subCost ?? 0;
    bucket.subCalls += c.subCalls ?? 0;
    bucket.days.add(c.day);
  };

  // Group first, split second. An agent's last active day decides which side it
  // falls on, and then its whole cost goes with it — splitting one agent across
  // both would show a named row a fraction of what it spent while the rest sat in
  // a row saying nobody knows whose it was.
  const cellsByLabel = new Map();
  for (const c of usage.cells) {
    if (!cellsByLabel.has(c.agent)) cellsByLabel.set(c.agent, []);
    cellsByLabel.get(c.agent).push(c);
  }

  const pre = { cost: 0, calls: 0, labels: new Set(), days: new Set() };
  const preByLabel = new Map();

  for (const [label, cells] of cellsByLabel) {
    const lastDay = cells.map((c) => c.day).sort().at(-1);
    if (epochDay && lastDay < epochDay && !current.has(label)) {
      pre.labels.add(label);
      for (const c of cells) {
        pre.cost += c.cost ?? 0;
        pre.calls += c.calls ?? 0;
        pre.days.add(c.day);
        preByLabel.set(label, (preByLabel.get(label) ?? 0) + (c.cost ?? 0));
      }
      continue;
    }
    const id = ID_RE.exec(label ?? '')?.[0] ?? null;
    for (const c of cells) {
      if (id) {
        if (!byId.has(id)) byId.set(id, blank());
        bump(byId.get(id), c);
      }
      if (!byLabel.has(label)) byLabel.set(label, blank());
      bump(byLabel.get(label), c);
    }
  }

  const preDays = [...pre.days].sort();
  const unattributed = pre.labels.size ? {
    agents: pre.labels.size, cost: pre.cost, calls: pre.calls,
    first: preDays[0] ?? null, last: preDays.at(-1) ?? null, days: preDays,
    top: [...preByLabel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([label, cost]) => ({ label, cost })),
  } : null;

  return {
    missing: false, stale, generatedAt, ageHours, byId, byLabel, unattributed,
    totalCost: usage.totals?.cost ?? null,
    note: stale
      ? `the priced usage artifact is ${ageHours === null ? 'undated' : `${ageHours}h`} old — figures below are as of ${generatedAt ? `${generatedAt.slice(0, 10)} ${clock(generatedAt)}` : 'an unknown time'}; refresh with python3 obot.roadmap/scripts/build_usage_data.py`
      : `priced from the hub usage artifact, built ${clock(generatedAt)}`,
  };
}

/**
 * One row's cost cell. Four honest outcomes and no fifth: a figure, a stale figure
 * that says so, an agent the artifact is too old to know about, and no artifact at
 * all. None of them is `$0.00`, which is what an unread file looks like.
 *
 * Each carries a `short` as well as its sentence. The sentence is the explanation
 * and belongs where explanations go; the short is what sits in a column. Putting
 * the sentence in the column is what @jwildfire saw on 2026-08-16 — "not yet priced
 * — it started after the last usage build" occupying the cost position of most
 * current rows, so the column he asked for held prose and no number could be
 * compared with any other. `code` names the case, so the page can print one legend
 * line for each short it actually used rather than repeating the sentence per row.
 */
function costCell(usage, { id, label, startedAt }) {
  if (!usage || usage.missing) {
    return { value: null, code: 'unavailable', short: 'n/a', text: 'cost unavailable — no usage artifact', sub: null, days: [] };
  }
  const bucket = (id && usage.byId.get(id)) || (label && usage.byLabel.get(label)) || null;
  if (!bucket) {
    if (startedAt && usage.generatedAt && Date.parse(startedAt) > Date.parse(usage.generatedAt)) {
      return { value: null, code: 'unpriced', short: 'unpriced', text: 'not yet priced — it started after the last usage build', sub: null, days: [] };
    }
    return { value: null, code: 'none', short: '—', text: 'no usage recorded', sub: null, days: [] };
  }
  const days = [...bucket.days].sort();
  return {
    value: bucket.cost,
    code: usage.stale ? 'stale' : 'priced',
    short: money(bucket.cost),
    text: `${money(bucket.cost)}${usage.stale ? ' as of the last usage build' : ''}`,
    calls: bucket.calls,
    sub: bucket.subCost > 0 ? { cost: bucket.subCost, calls: bucket.subCalls } : null,
    // A long-lived session's total is its whole life, not today — say which days.
    span: days.length > 1 ? `${days[0]} to ${days.at(-1)}` : null,
    // The priced days themselves, so a date filter can be built out of the same
    // feed the money comes from rather than out of a second guess at when an
    // agent ran (jwildfire/obot.roadmap#227).
    days,
  };
}

// ---- the roster ----------------------------------------------------------

const isWorkerName = (name) => WORKER_TAGS.some((t) => String(name ?? '').startsWith(t));
const idIn = (name) => ID_RE.exec(String(name ?? ''))?.[0] ?? null;

/**
 * The slug out of a worker's display name — `👯🤖 2026-08-16 d0014b` is `d0014b`.
 *
 * It is what stood in for an identity before the ledger, and it is the key the
 * delivery record uses for every worker that ran before this morning. Without this
 * join those rows would read `none` while the record beside them lists merged pull
 * requests, which is the failure this whole page exists to end.
 */
function slugOfName(name) {
  if (!isWorkerName(name)) return null;
  const parts = String(name).trim().split(/\s+/);
  return parts.length >= 3 ? parts.at(-1) : null;
}

/**
 * The roster: one row per agent, ids first.
 *
 * Scope is the id era. Everything before it is one collapsed row — the design's
 * call, and the honest one: a backfill could never be complete (three workers from
 * the night before left no machine-recoverable trace at all) and a partial one
 * rendered as clean rows would assert a completeness it does not have.
 */
export function buildRoster({
  workers, jobs = [], usage = null, delivery = [], sources = null, now = new Date(),
  // Which display names he has pinned (obot.agent#169). A pinned agent is exempt
  // from every rule below that drops a row for being out of scope or for being one
  // corpse too many: pinning means "always tell me about this one", and the moment
  // that most matters is when the thing has died. A pin that drops its subject on
  // death is worse than no pin, because the absence reads as health. A caller that
  // says nothing pins nothing, so the scope rules are unchanged for everyone else.
  pinned = () => false,
} = {}) {
  const isPinnedName = (name) => { try { return !!pinned(name); } catch { return false; } };
  const epoch = workers?.epoch ?? null;
  // Which of the four files were actually read. Absent means the whole record is
  // silent; empty means it was read and had nothing to say. By the time a renderer
  // holds `delivery: []` it can no longer tell those apart, and every honest
  // sentence on the page turns on the difference (jwildfire/obot.roadmap#223).
  // A caller that says nothing is taken at its word — `collectRoster` always
  // reports for real, and it is the only caller that reads a disk.
  const src = { ...DEFAULT_SOURCES, ...(sources ?? {}) };
  const deliveryRead = src.delivery.present !== false;
  const epochDay = epoch ? epoch.slice(0, 10) : null;

  const byWorker = new Map();
  for (const r of delivery) {
    if (!byWorker.has(r.worker)) byWorker.set(r.worker, []);
    byWorker.get(r.worker).push(r);
  }

  const jobsFor = (id) => jobs.filter((j) => idIn(j.name) === id);
  const rows = [];
  const claimed = workers?.claims ?? [];

  const rowFor = ({ id, label, slug, task, claimedAt, matched, sub = false }) => {
    // The newest session wins the status: a worker that was resumed is one agent.
    const job = matched.slice().sort((a, b) => Date.parse(b.startedAt ?? 0) - Date.parse(a.startedAt ?? 0))[0] ?? null;
    const worker = job ? isWorkerName(job.name) : true;
    const status = statusOf(job ? { ...job, worker, sub } : { sub, claimed: !!id, jobsRead: src.jobs.present !== false }, now);
    const startedAt = matched.map((j) => j.startedAt).filter(Boolean).sort()[0] ?? claimedAt ?? null;
    const cost = costCell(usage, { id, label, startedAt });
    const key = slug || slugOfName(job?.name ?? label);
    const entries = (id && byWorker.get(id)) || (key && byWorker.get(key)) || [];
    // Last activity, from whichever record saw the agent most recently. A date
    // filter reading only the job record would date an agent by when the harness
    // last wrote a heartbeat and miss the spend recorded against it.
    const lastAt = [...matched.map((j) => j.updatedAt ?? j.startedAt), claimedAt]
      .filter(Boolean).sort().at(-1) ?? null;
    // Every day this agent is known to have been alive, from both records. The
    // priced days come from the shared usage feed; the job days come from the
    // harness. Neither alone is complete: a worker that started at 22:48 and ran
    // to 04:03 has its money on one date and its job activity on the next.
    const days = [...new Set([
      ...(cost.days ?? []),
      ...matched.flatMap((j) => [day(j.startedAt), day(j.updatedAt)]),
      day(claimedAt),
    ].filter(Boolean))].sort();
    return {
      id: id ?? null,
      idText: id ?? 'no worker id',
      label: label ?? id,
      slug: slug || slugOfName(job?.name ?? label) || '',
      task: task ?? '',
      claimedAt: claimedAt ?? null,
      startedAt,
      lastAt,
      days,
      sessions: matched.length,
      tokens: matched.reduce((n, j) => n + (j.tokens ?? 0), 0),
      // Every model this agent's sessions were launched with. Plural because a
      // resumed worker is one agent that may have run under two, and collapsing that
      // to one would hide the resume that changed the model mid-task.
      models: [...new Set(matched.map((j) => j.model).filter(Boolean))].sort(),
      status,
      cost,
      // The harness's own sentence about this agent — the live line while it works,
      // the close-out line once it has finished. Carried on the row rather than
      // resolved in the view because the view holds no job record, and because the
      // filtering that keeps template text off the page belongs next to the read
      // that produces it (jwildfire/obot.agent#177).
      line: jobLine(job),
      // Held apart from `line` rather than dropped: the transport failure that ended
      // a session is worth reading, and the task column is the wrong place to read it.
      ended: jobError(job),
      // `unjudged` rides on the impact so every view gets the distinction without
      // a new parameter: a silent delivery record is not a verdict of silence.
      impact: { ...impactOf(entries), unjudged: !deliveryRead },
      subs: [],
    };
  };

  for (const c of claimed) {
    if (c.parent) continue;
    const matched = jobsFor(c.id);
    const row = rowFor({
      id: c.id, label: c.slug ? `${c.id} ${c.slug}` : c.id, slug: c.slug,
      task: c.task, claimedAt: c.at, matched,
    });
    // A subagent has no session of its own, so it rolls into the worker that
    // claimed it — which is also who is accountable for whatever it wrote.
    row.subs = claimed.filter((s) => s.parent === c.id).map((s) => ({
      id: s.id, slug: s.slug, task: s.task, at: s.at,
    }));
    rows.push(row);
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));

  // Agents with no id that were active in the id era: standing sessions, and any
  // worker that skipped the claim. Named rather than folded into the unattributed
  // row, which would say they predate the ledger when they do not.
  const named = new Map();
  const deadEarlier = [];
  for (const j of jobs) {
    if (idIn(j.name)) continue;
    // Last activity, not first: a standing session opened yesterday and still
    // answering this morning is an agent that ran in the id era, and the whole
    // point of this row is that it is spending money right now. A death gets in
    // whatever its date — see isCurrent.
    if (!isCurrent(j, epochDay, now) && !isPinnedName(j.name)) continue;
    const d = day(j.updatedAt ?? j.startedAt);
    if (epochDay && d && d < epochDay && !isPinnedName(j.name)) deadEarlier.push(j.name);
    if (!named.has(j.name)) named.set(j.name, []);
    named.get(j.name).push(j);
  }
  // Bounded, and it says what it dropped: an unbounded list of every corpse the
  // machine has ever produced would push today off the top of a phone screen.
  const dropped = [...new Set(deadEarlier)].slice(DEAD_SHOWN);
  for (const name of dropped) named.delete(name);
  if (usage && !usage.missing) {
    for (const label of usage.byLabel.keys()) {
      if (ID_RE.test(label) || named.has(label)) continue;
      named.set(label, []);
    }
  }
  const extras = [...named.entries()].map(([label, matched]) => rowFor({ id: null, label, matched }));
  extras.sort((a, b) => (b.cost.value ?? -1) - (a.cost.value ?? -1) || a.label.localeCompare(b.label));

  return {
    rows: [...rows, ...extras],
    sources: src,
    droppedDeaths: dropped.length,
    unattributed: usage?.unattributed ?? null,
    usage: usage ? {
      missing: !!usage.missing, stale: !!usage.stale, note: usage.note,
      generatedAt: usage.generatedAt ?? null,
    } : null,
    epoch, epochDay,
    generated: now.toISOString(),
  };
}

/**
 * What a roster with no rows says — and it depends entirely on WHY there are none.
 *
 * "No agent has run since the worker ledger was adopted" is a measurement: the
 * ledger was read and holds no claim. On a machine where the ledger does not exist
 * it is a claim about history made out of a file nobody opened, which is the exact
 * confusion jwildfire/obot.roadmap#223 exists to end.
 */
export function emptyRoster(model) {
  const src = model?.sources ?? {};
  const ledger = src.workers?.present !== false;
  const jobs = src.jobs?.present !== false;
  if (!ledger && !jobs) {
    return nothingYet(
      'Nothing has been recorded on this machine yet',
      'no worker ledger and no job records; the first agent to claim an id starts both',
    );
  }
  if (!ledger) {
    return nothingYet(
      'No worker ledger on this machine yet',
      'agents may have run, but nothing can be attributed until one claims an id (obot.agent/tools/worker-id)',
    );
  }
  if (!jobs) {
    return nothingYet(
      'No job records on this machine yet',
      'the ledger is here but ~/.claude/jobs is not, so no session can be matched to an id',
    );
  }
  return 'No agent has run since the worker ledger was adopted.';
}

// ---- the section --------------------------------------------------------

/**
 * The roster as a `## Heading` section — the TEXT form, not the page.
 *
 * The page is `roster-view.mjs`. This stays because a flat, greppable dump of the
 * same model is genuinely useful (a terminal, a paste into an issue) and because it
 * renders through the generic section seam with no layout of its own. It is one
 * rendering of one model, never a second source: both read `buildRoster`.
 */
export function rosterMarkdown(model) {
  const out = ['## Agents', ''];

  // The same sentence the page renders, from the same function. This is the
  // greppable, paste-into-an-issue form of one model, and it used to contradict the
  // HTML — it was the dishonest half (jwildfire/obot.roadmap#223).
  if (!model.rows.length) out.push(`- ${emptyRoster(model)}`);

  for (const r of model.rows) {
    // An id nobody launched is not an agent that produced nothing — it is an id
    // that never became an agent, and reading it as the first would put a phantom
    // at the top of a page whose whole job is saying who earned their tokens.
    const phantom = r.status.status === 'not launched';
    // The handle first, because that is what he scans down: the id when there is
    // one, the agent's own name when there is not.
    const head = [r.id ? r.id : r.label, r.id ? (r.slug || null) : 'no worker id',
      r.status.status, r.cost.text, phantom ? 'no agent ran under this id' : r.impact.summary]
      .filter(Boolean).join(' · ');
    out.push(`- ${head}`);
    if (r.id && r.label !== r.id && !r.slug) out.push(`  - ${r.label}`);
    out.push(`  - status: ${r.status.status} — ${r.status.note}`);
    for (const m of r.impact.moved) out.push(`  - requirement moved: ${m.ref}${m.url ? ` ${m.url}` : ''}`);
    for (const c of r.impact.closed) out.push(`  - ${c.verb ?? 'landed'}: ${c.ref}${c.url ? ` ${c.url}` : ''}`);
    for (const n of r.impact.mentioned) out.push(`  - referenced, moved nothing: ${n.ref} (${n.verb ?? 'named'})${n.url ? ` ${n.url}` : ''}`);
    if (r.impact.empty) {
      out.push(phantom
        ? '  - roadmap impact: not applicable — no session ever started, so there is nothing to have moved'
        : '  - roadmap impact: none recorded');
    }
    for (const v of r.impact.verdicts) out.push(`  - verdict ${v.verdict}: produced ${v.produced}${v.note ? ` — ${v.note}` : ''}`);
    const usageBits = [
      `${plural(r.sessions, 'session')}`,
      r.tokens ? `${r.tokens.toLocaleString('en-US')} tokens` : null,
      r.cost.calls ? `${r.cost.calls.toLocaleString('en-US')} API calls` : null,
      r.cost.sub ? `subagents ${money(r.cost.sub.cost)} of it` : null,
      r.cost.span ? `spend across ${r.cost.span}` : null,
    ].filter(Boolean);
    out.push(`  - ${usageBits.join(' · ')}`);
    if (r.claimedAt) out.push(`  - claimed ${r.claimedAt.slice(0, 10)} ${clock(r.claimedAt)}${r.task ? ` for ${r.task}` : ''}`);
    for (const s of r.subs) out.push(`  - subagent ${s.id}${s.slug ? ` ${s.slug}` : ''} — rolled into this row`);
  }

  if (model.droppedDeaths) {
    out.push(`- ${plural(model.droppedDeaths, 'earlier agent')} that also ended badly, not shown here — the list of deaths is capped at ${DEAD_SHOWN}`);
  }

  const u = model.unattributed;
  if (u) {
    out.push(`- unattributed (before worker ids) · ${plural(u.agents, 'agent')} · ${money(u.cost)} · impact not attributable`);
    out.push(`  - ${u.first ?? '?'} to ${u.last ?? '?'}, before the ledger existed — no id, so nothing they wrote can be traced to them`);
    for (const t of u.top) out.push(`  - ${t.label} — ${money(t.cost)}`);
    if (u.agents > u.top.length) out.push(`  - and ${u.agents - u.top.length} more`);
  }

  out.push('', '## About these numbers', '');
  if (model.usage?.missing) {
    out.push('- cost unavailable: the hub has not produced a priced usage artifact, so no cost on this page is a figure — none of them is zero either');
  } else if (model.usage?.note) {
    out.push(`- ${model.usage.note}`);
  }
  out.push(`- ${PRICE_NOTE}`);
  out.push(`- ${ID_NOTE}`);
  out.push('- Status is the job record joined to its append-only timeline: where the two disagree the timeline wins, because a state file can say done over a session that fell over.');
  out.push('- Impact is the Navigator delivery record, checked against GitHub, and never the job records own child list — that list is empty for nearly half of measured jobs.');
  if (model.epochDay) out.push(`- Scope: agents active since the ledger was adopted on ${model.epochDay}.`);
  return `${out.join('\n')}\n`;
}

// ---- reading it off disk -------------------------------------------------

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

/** The harness's own record of what ran. Read, never written. */
export function readJobs(jobsDir) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(jobsDir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(jobsDir, e.name);
    const s = readJson(path.join(dir, 'state.json'));
    if (!s) continue;
    out.push({
      job: e.name,
      name: String(s.name ?? ''),
      state: String(s.state ?? ''),
      detail: s.detail ?? '',
      needs: s.needs ?? '',
      tokens: s.tokens ?? 0,
      startedAt: s.createdAt ?? s.startedAt ?? null,
      updatedAt: s.updatedAt ?? null,
      model: modelFlag(s.respawnFlags),
      firstTerminalAt: s.firstTerminalAt ?? null,
      timeline: timelineClose(readText(path.join(dir, 'timeline.jsonl'))),
    });
  }
  return out;
}

/**
 * The whole roster, assembled from the four files and nothing else.
 *
 * Returns the MODEL. It used to return markdown, so that the dashboard's generic
 * `## Heading` renderer could lay the roster out with no table code — which was the
 * right call for shipping it and the wrong one for reading it. That renderer can
 * only produce a flat list of identically-weighted bullets, so twenty-five agents
 * arrived as a wall of prose with the cost buried mid-sentence and no way to tell a
 * worker that moved a requirement from a probe that died. `rosterMarkdown` is still
 * here as the text form; `roster-view.mjs` is what the page renders.
 *
 * The usage artifact carries no build stamp of its own, so its file time is what
 * dates it — which is the right reading anyway: the question is when the pricing
 * last ran, not which day it counted.
 */
export function collectRoster({ workspace, hub, jobsDir, now = new Date(), pinned = () => false }) {
  const jobsPath = jobsDir ?? path.join(os.homedir(), '.claude', 'jobs');
  const workersPath = path.join(workspace, '.claude', 'workers.journal');
  const deliveryPath = path.join(workspace, '.claude', 'session-hub', 'delivery.md');
  // The record is two files. `/session/log` renders the typed journal and the roster
  // reads the markdown, so keying "was the delivery record read" on delivery.md alone
  // lets the page say "no delivery record on this machine" two screens above a table
  // built from the journal (jwildfire/obot.roadmap#223).
  const journalPath = path.join(workspace, '.claude', 'session-hub', 'delivery.journal');

  const jobs = readJobs(jobsPath);
  const workers = parseWorkers(readText(workersPath));
  const delivery = parseDelivery(readText(deliveryPath));

  const usageFile = path.join(hub, 'site', 'usage', 'usage.json');
  const raw = readJson(usageFile);
  let stamped = null;
  if (raw) {
    let mtime = null;
    try { mtime = fs.statSync(usageFile).mtime.toISOString(); } catch { /* unreadable stat, treat as undated */ }
    stamped = { ...raw, generatedAt: raw.generatedAt ?? mtime };
  }
  const epochDay = workers.epoch ? workers.epoch.slice(0, 10) : null;
  const usage = usageIndex(stamped, { epochDay, now, current: currentLabels(jobs, epochDay, now) });

  // Observed, not assumed. On a machine that has never run an agent all four of
  // these are false, and a page that cannot tell that from four empty files is the
  // one that greets @jwildfire on his first morning with a confident set of zeros.
  const sources = {
    jobs: { path: jobsPath, present: fs.existsSync(jobsPath) },
    workers: { path: workersPath, present: fs.existsSync(workersPath) },
    usage: { path: usageFile, present: fs.existsSync(usageFile) },
    delivery: {
      path: deliveryPath,
      present: fs.existsSync(deliveryPath) || fs.existsSync(journalPath),
      note: fs.existsSync(deliveryPath) ? '' : 'read from the typed journal; delivery.md is not on this machine',
    },
  };

  return buildRoster({ workers, jobs, usage, delivery, sources, now, pinned });
}
