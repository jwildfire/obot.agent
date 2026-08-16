// The session feed — what changed, as events, for a reader who was not present
// (jwildfire/obot.roadmap#218).
//
// The roster answers "who are the agents and how did each end up"; it is a set of
// entities with their history collapsed, and no re-rendering makes it a feed. This
// is the second projection over the same sources, emitting events instead of
// agents, plus the one source the roster never reads: the session hub's GitHub
// sweep, which is what actually landed on the roadmap.
//
// Sources, each with its own provenance stamp — one stamp for all would be a lie
// (the sweep's own rule):
//
//   .claude/session-hub/delivery.journal   the TYPED delivery record — verdicts
//                                          and Navigator calls with real seconds.
//                                          The markdown render loses the calls and
//                                          the seconds; the journal is the source.
//   .claude/workers.journal                worker-id claims; the claim's `task` is
//                                          a ready-made headline.
//   ~/.claude/jobs/<id>/                   terminal transitions — finished, died —
//                                          with the agent's own last words when it
//                                          died mid-sentence.
//   .claude/session-hub/cache/gh-sweep.json  merged PRs, closed issues, new
//                                          requirements, releases. The old page
//                                          carried these only inside the collapsed
//                                          live view's iframe.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { timelineClose, refUrl, WORKER_TAGS } from './roster.mjs';

const REF_RE = /\b([\w][\w.-]*#\d+)\b/;
const DEATH_RE = /API Error|Connection refused|ENOTFOUND|Can'?t reach|rate limit|ECONNRESET|ETIMEDOUT/i;

const clip = (s, n = 170) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const firstRefUrl = (text) => {
  const ref = REF_RE.exec(String(text ?? ''))?.[1];
  return ref ? refUrl(ref) : null;
};

/** The typed delivery record: verdicts always; calls only when they are his business. */
export function deliveryEvents(journal = '') {
  const events = [];
  for (const line of journal.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.op === 'verdict') {
      events.push({
        type: `verdict-${rec.verdict ?? 'none'}`,
        ts: rec.at,
        line: `${rec.worker} · ${clip(rec.produced)}${rec.note ? ` — ${clip(rec.note, 120)}` : ''}`,
        url: firstRefUrl(rec.produced),
        stamp: '[delivery record]',
      });
      continue;
    }
    // The Navigator's calls are its own operations record and stay in the full
    // log — except the ones that are about his authority: approvals, invariants,
    // boundaries, exemptions. Those are news to the person whose authority it is.
    if (rec.op === 'call' && /approval|invariant|boundary|exemption/.test(rec.kind ?? '')) {
      events.push({
        type: 'call',
        ts: rec.at,
        line: `${rec.id} ${rec.kind} — ${clip(rec.summary)}`,
        url: null,
        stamp: '[delivery record]',
      });
    }
  }
  return events;
}

/** Worker-id claims. The task text on the claim is the headline the ledger already wrote. */
export function claimEvents(journal = '') {
  const events = [];
  for (const line of journal.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.op !== 'claim') continue;
    events.push({
      type: 'claim',
      ts: rec.ts,
      line: `${rec.id} ${rec.slug ?? ''} claimed${rec.task ? ` — ${clip(rec.task)}` : ''}`,
      url: null,
      stamp: '[worker ledger]',
    });
  }
  return events;
}

/**
 * Terminal transitions from the job records. Only jobs whose state is terminal
 * NOW emit one — `firstTerminalAt` is the first close, not the last word, and a
 * standing session that closed once at dawn and worked all day must not read as
 * "finished at 06:38" (measured on the Navigator's own record).
 *
 * A `done` state over a timeline that never recorded a close is a death, not a
 * finish — the exact defect the roster's status join was built for, kept here.
 */
export function jobEvents(jobs = []) {
  const events = [];
  for (const j of jobs) {
    const ts = j.firstTerminalAt ?? j.updatedAt;
    if (!ts) continue;
    const name = j.name ?? j.id;
    const worker = WORKER_TAGS.some((t) => String(name).startsWith(t)) || /\bW\d{4}\b/.test(String(name));
    if (j.state === 'done') {
      if (j.timeline && !timelineClose(j.timeline).closed) {
        events.push({ type: 'death', ts, line: `${name} died — the state file says done and the timeline never recorded a close`, url: null, stamp: '[job record]' });
      } else {
        events.push({ type: 'done', ts, line: `${name} finished${j.detail ? ` — ${clip(j.detail)}` : ''}`, url: null, stamp: '[job record]' });
      }
      continue;
    }
    if (j.state === 'stopped' || (j.state === 'blocked' && worker)) {
      const words = [j.detail, j.lastText].find((t) => DEATH_RE.test(t ?? ''));
      events.push({
        type: 'death', ts,
        line: `${name} died${words ? ` — in its own words: ${clip(words, 140)}` : ''}`,
        url: null, stamp: '[job record]',
      });
    }
  }
  return events;
}

/** What landed on GitHub, from the session hub's sweep cache. */
export function ghEvents(sweep = null) {
  if (!sweep) return [];
  const events = [];
  for (const it of sweep.items ?? []) {
    const ref = `${it.repo}#${it.number}`;
    const isReq = (it.labels ?? []).some((l) => String(l?.name ?? l).toLowerCase() === 'requirement');
    if (it.isPullRequest && it.state === 'merged') {
      events.push({ type: 'gh-merged', ts: it.closedAt ?? it.updatedAt, line: `${ref} merged — ${clip(it.title, 120)}`, url: it.url, stamp: '[gh sweep]' });
    } else if (!it.isPullRequest && it.state === 'closed') {
      events.push({ type: 'gh-closed', ts: it.closedAt ?? it.updatedAt, line: `${ref} closed — ${clip(it.title, 120)}`, url: it.url, stamp: '[gh sweep]' });
    } else if (!it.isPullRequest && isReq && it.createdAt && (!sweep.sinceIso || it.createdAt >= sweep.sinceIso)) {
      events.push({ type: 'gh-requirement', ts: it.createdAt, line: `${ref} requirement filed — ${clip(it.title, 120)}`, url: it.url, stamp: '[gh sweep]' });
    }
  }
  for (const r of sweep.releases ?? []) {
    events.push({
      type: 'gh-release',
      ts: r.publishedAt ?? r.published_at,
      line: `${r.repo ?? ''} ${r.name ?? r.tag ?? r.tag_name ?? 'release'} published`,
      url: r.url ?? r.html_url ?? null,
      stamp: '[gh sweep]',
    });
  }
  return events;
}

const readText = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

/** The jobs a feed can see: state.json plus the timeline tail, bounded to the window. */
function readJobs(jobsDir, sinceMs) {
  const out = [];
  let names = [];
  try { names = readdirSync(jobsDir); } catch { return out; }
  for (const id of names) {
    const state = readJson(join(jobsDir, id, 'state.json'));
    if (!state) continue;
    const touched = Date.parse(state.updatedAt ?? state.createdAt ?? '');
    if (Number.isNaN(touched) || touched < sinceMs) continue;
    const timeline = readText(join(jobsDir, id, 'timeline.jsonl'));
    let lastText = null;
    for (const line of timeline.trim().split('\n').slice(-5).reverse()) {
      try { const ev = JSON.parse(line); if (ev.text) { lastText = ev.text; break; } } catch { /* skip */ }
    }
    out.push({
      id, name: state.name, state: state.state, detail: state.detail,
      createdAt: state.createdAt, updatedAt: state.updatedAt,
      firstTerminalAt: state.firstTerminalAt, timeline, lastText,
    });
  }
  return out;
}

/**
 * The feed: every source's events inside the window, newest first, capped. Events
 * are shaped for the shared feed renderer (metrics-view.mjs): {type, ts, line,
 * url, stamp}.
 */
export function buildSessionFeed({ workspace, jobsDir = join(homedir(), '.claude', 'jobs'), now = new Date(), days = 3, cap = 60 } = {}) {
  const sinceMs = now.getTime() - days * 86400000;
  const hub = join(workspace, '.claude', 'session-hub');
  const events = [
    ...deliveryEvents(readText(join(hub, 'delivery.journal'))),
    ...claimEvents(readText(join(workspace, '.claude', 'workers.journal'))),
    ...jobEvents(readJobs(jobsDir, sinceMs)),
    ...ghEvents(readJson(join(hub, 'cache', 'gh-sweep.json'))),
  ];
  return events
    .filter((e) => { const t = Date.parse(e.ts ?? ''); return !Number.isNaN(t) && t >= sinceMs && t <= now.getTime() + 60000; })
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    .slice(0, cap);
}
