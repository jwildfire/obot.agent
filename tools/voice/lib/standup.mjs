// The spoken standup — what a voice session reads aloud when he asks where things are.
//
// @jwildfire is moving his daily check-in to Claude voice mode. The inbound half of
// that pathway already exists and is not rebuilt here: a note or question dictated in
// voice lands in the hub's Ideas discussions and the existing triage picks it up
// (`scripts/ideas-file`, `reminders-to-ideas`, the `session-inbox` skill). This is the
// OUTBOUND half — one plain-text file, derived every sweep, that answers four
// questions out loud: what is running, what is blocked, what wants a decision, and
// which release candidates are waiting on him.
//
// ## Why it is derived and never written
//
// Because the alternative is a second store of a fact the Navigator sweep already
// recomputes every five minutes, and this programme has paid three times in one week
// for two hand-writable stores of one fact. Everything here comes from
// `navigator-state.md`, the hub's decision registry, the episode ledger and the job
// records. Nothing is typed, so nothing can be stale in a way the file cannot see.
//
// ## Read aloud, which changes the shape
//
// He cannot see this page. So: short sentences, one thought per paragraph, no tables,
// no nested bullets, no URLs — a URL read out loud is noise, and every address in here
// has a name instead ("discussion 301", not a link). Counts up to ten are words,
// because "3" and "three" sound the same only if something spells it for the reader.
//
// ## The public rule, which is why half this file is refusals
//
// The hub is PUBLIC. Config items — the jobs only his hands can do — are local-only by
// his standing rule (BL2/BL4, 2026-08-15), and their text must never reach a public
// surface. That is not a footnote here, it is the design:
//
//   1. This module reads `navigator-state.md` and takes FOUR things out of it — the
//      sweep stamp, the stall verdict, the ranked head, the RC queue. It never reads
//      `.claude/blockers.md`, and the config lines that ARE in navigator-state (the
//      ledger line, the currency section, the carve-out routing) are not parsed at all.
//   2. Counts are refused too, not just text. "You have nine config items" identifies
//      one when there are few of them, and the standup says nothing about the list
//      beyond that it exists and is not covered here.
//   3. `leakScan` is the gate at the narrow end: the publisher refuses to publish a
//      composed file that carries a config id, a local path, a Spotify uri or a
//      `private:` marker. A guard at the composing end could be edited out by the same
//      change that introduces the leak; a guard at the publishing end cannot.
//
// The episode ledger is local-only for the same reason, so what crosses from it is a
// boolean and a number of minutes keyed by a decision id that is already public — and
// never the episode's uri, which is a private-library identifier for a show that is
// private to his account.
import fs from 'node:fs';
import path from 'node:path';

import { parseNavigatorState } from '../../ops-dashboard/lib/navigator.mjs';

/** How long a job record can go untouched and still be counted as a live session. */
export const LIVE_JOB_HOURS = 2;

/** Counts up to ten are words. Above that a digit is what a reader would say anyway. */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const said = (n) => (Number.isInteger(n) && n >= 0 && n <= 10 ? WORDS[n] : String(n));
const plural = (n, one, many) => `${said(n)} ${n === 1 ? one : many}`;
/** A sentence read aloud still starts with a capital when it starts with a word-number. */
const Cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The things that must never appear in a published standup, and what each one is.
 *
 * This is the publish gate, not a formatter. A hit here stops the file going out.
 */
const LEAKS = [
  [/\bc\d{4}\b/, 'a config item id'],
  [/blockers\.md/i, 'the config list itself'],
  [/(^|[\s(])\/(Users|home)\//, 'a path on his machine'],
  [/spotify:/i, 'a private-library episode uri'],
  [/^\s*private\s*:/im, 'the marker that means keep this off the hub'],
];

/** Every reason this text may not be published, in this module's own words. */
export function leakScan(text = '') {
  return LEAKS.filter(([re]) => re.test(String(text))).map(([, why]) => why);
}

// --------------------------------------------------------- reading the sweep file

/**
 * The sweep's own stamp, and whether it is still alive.
 *
 * The stale rule is `parseNavigatorState`'s, deliberately: the state file writes down
 * "older than 3× the cadence and the observer is dead", one reader already implements
 * it, and a second implementation here would be a second opinion about whether he is
 * being told something current.
 */
export function sweepReading(md = '', now = new Date()) {
  const s = parseNavigatorState(String(md), now);
  return {
    read: Boolean(s.sweptAt),
    sweptAt: s.sweptAt,
    cadenceMin: s.cadenceMin,
    ageMin: s.ageMin,
    stale: s.stale,
  };
}

/** The lines of one `## section`, raw, so a quoted title survives to be read out. */
function sectionLines(md = '', title = '') {
  const lines = String(md).split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${title}\\b`).test(l));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).filter((l) => l.trim());
}

/**
 * The release candidates the sweep verified against GitHub this pass.
 *
 * Read from the sweep rather than from `gh` directly, so the standup and the Navigator
 * can never disagree about what is waiting on him.
 */
export function rcRows(md = '') {
  const lines = sectionLines(md, 'RC queue') ?? [];
  const rows = [];
  for (const l of lines) {
    const m = /^-\s+\*\*([\w.-]+)#(\d+)\*\*\s+"([^"]+)"/.exec(l);
    if (!m) continue;
    const owner = /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\//.exec(l);
    rows.push({
      repo: owner ? `${owner[1]}/${owner[2]}` : m[1],
      number: Number(m[2]),
      title: m[3],
    });
  }
  return rows;
}

/**
 * The ranked head, with the one flag GitHub itself owns: `blocked` is a label on the
 * hub issue, not a judgement made here, so a blocked item is blocked because somebody
 * said so on the issue.
 */
export function rankRows(md = '') {
  const lines = sectionLines(md, 'Ranked head') ?? [];
  const rows = [];
  for (const l of lines) {
    const m = /^\s*(\d+)\.\s+#(\d+)\s+(.*)$/.exec(l);
    if (!m) continue;
    const rest = m[3];
    const title = /"([^"]+)"/.exec(rest)?.[1] ?? null;
    rows.push({
      rank: Number(m[1]),
      issue: Number(m[2]),
      blocked: /·\s*blocked\s*·/.test(rest),
      title: title ? title.replace(/^Requirement:\s*/, '') : null,
    });
  }
  return rows;
}

/**
 * Is any session parked on a permission prompt nobody can reach?
 *
 * `read: false` when the section is absent — which is NOT "clear". A stall section
 * that failed to render would otherwise publish "nothing is waiting on you" over a
 * session that has been waiting all night.
 */
export function stallVerdict(md = '') {
  const lines = sectionLines(md, 'Stalled at a prompt') ?? [];
  const line = lines.find((l) => /^stalls:/.test(l.trim()));
  if (!line) return { read: false, clear: false, text: '' };
  const body = line.trim().replace(/^stalls:\s*/, '');
  return { read: true, clear: /^clear\b/.test(body), text: body };
}

// ------------------------------------------------------------------ the fleet

/**
 * How many sessions are actually working, from the job records this machine keeps.
 *
 * An unreadable directory is `read: false` and never zero. On 2026-08-15 the same
 * projection published `idle · 0 agents` from a machine with no job records at all,
 * byte-identical to a genuinely quiet one (jwildfire/obot.roadmap#223), and a standup
 * that says "nothing is running" when it cannot see is the same defect said out loud.
 *
 * A record untouched for `LIVE_JOB_HOURS` is not counted however it is labelled: a job
 * that died mid-flight keeps `working` in its state file forever.
 */
export function fleetCounts(dir, { now = new Date() } = {}) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return { read: false, why: `${e.code === 'ENOENT' ? 'this machine has no job records' : 'the job records could not be read'}`, working: null, total: null, needsInput: null };
  }
  let working = 0;
  let needsInput = 0;
  let total = 0;
  for (const id of names) {
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(dir, id, 'state.json'), 'utf8')); } catch { continue; }
    total += 1;
    const at = Date.parse(s.updatedAt ?? s.startedAt ?? '');
    const fresh = Number.isFinite(at) && (now.getTime() - at) <= LIVE_JOB_HOURS * 3600000;
    if (!fresh) continue;
    if (s.state === 'working') working += 1;
    else if (s.state === 'blocked' || s.state === 'needs-input') needsInput += 1;
  }
  return { read: true, why: '', working, needsInput, total };
}

// --------------------------------------------------------------- the decisions

/** `open` and `partially decided` both still want something from him. Nothing else does. */
const AWAITING = new Set(['open', 'partially decided']);

/**
 * Every decision still waiting on him, with the thread to answer it on.
 *
 * `partially decided` is carried through as itself and never folded into either
 * neighbour: D0019 is a decision he made with three questions inside it he never
 * answered, and a standup that calls that "open" sends him back over settled ground
 * while one that calls it "decided" drops three questions on the floor.
 *
 * WHICH questions are outstanding is deliberately not computed. The hub's own
 * `decision-state.mjs` says why: the per-question labels are free-form across the
 * artifacts, so coverage "cannot be computed from them today without inventing
 * answers" — and an invented answer read aloud is indistinguishable from a measured one.
 */
export function awaitingDecisions(hub, { now = new Date() } = {}) {
  const file = path.join(hub ?? '', 'reports', 'decisions', 'registry.json');
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { read: false, why: 'the decision registry could not be read', rows: [] };
  }
  // Schema drift is a failed read, not an empty queue — the same rule `handles.mjs`
  // records, for the same reason: "he has decided everything" is the loudest possible
  // wrong answer and it arrives silently.
  if (!Array.isArray(reg.artifacts)) {
    return { read: false, why: "the decision registry's shape has changed", rows: [] };
  }

  const threads = discussionsBySlug(hub);
  const rows = reg.artifacts
    .filter((a) => a && AWAITING.has(a.state))
    .map((a) => {
      const t = Date.parse(a.date ?? '');
      return {
        id: a.id,
        slug: a.slug,
        title: a.title ?? a.slug ?? a.id,
        state: a.state,
        date: a.date ?? null,
        waitingDays: Number.isFinite(t) ? Math.floor((now.getTime() - t) / 86400000) : null,
        questions: (a.questions ?? []).length,
        discussion: threads.get(a.slug) ?? null,
        episode: { exists: false, current: false, minutes: null },
      };
    });
  // Newest first, and the partly-decided one last. He answers the freshest thing most
  // often, and a decision he has already ruled on once is a different kind of ask.
  rows.sort((a, b) => (a.state === b.state ? String(b.date).localeCompare(String(a.date))
    : (a.state === 'open' ? -1 : 1)));
  return { read: true, why: '', rows };
}

/**
 * The Q&A thread number for each artifact, from the published index table.
 *
 * A `DISCUSSION_PLACEHOLDER` cell is a thread that was never opened, and it comes back
 * as null so the standup can say so rather than sending him to a discussion that does
 * not exist.
 */
function discussionsBySlug(hub) {
  const out = new Map();
  let md;
  try { md = fs.readFileSync(path.join(hub ?? '', 'reports', 'decisions', 'README.md'), 'utf8'); } catch { return out; }
  for (const line of md.split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) continue;
    const slug = /\[[^\]]+\]\((\d{4}-\d{2}-\d{2}-[\w.-]+)\/\)/.exec(line)?.[1];
    if (!slug) continue;
    const n = /discussions\/(\d+)/.exec(line)?.[1];
    out.set(slug, n ? Number(n) : null);
  }
  return out;
}

/**
 * Fold the episode ledger's coverage rows onto the decision rows.
 *
 * What crosses is existence, currency and minutes. The uri does not, and neither does
 * anything else the ledger holds — it records what he was told and when, which is why
 * it lives in the ops store rather than in a checkout.
 */
export function withEpisodes(rows, coverage) {
  if (!coverage || coverage.read === false) return rows;
  const by = new Map((coverage.rows ?? []).map((r) => [r.id, r]));
  return rows.map((r) => {
    const c = by.get(r.id);
    if (!c) return r;
    return {
      ...r,
      episode: {
        exists: Boolean(c.episode),
        current: c.state === 'current',
        minutes: c.episode?.minutes ?? null,
      },
    };
  });
}

// ------------------------------------------------------------------- composing

/** `gsm.safety v1.2.0-RC1` is a filename. This is what a person would say. */
export function spokenRelease(title = '') {
  const m = /^(.*?)\s*v(\d+\.\d+\.\d+)(?:-RC(\d+))?$/.exec(String(title).trim());
  if (!m) return String(title);
  const bits = [m[1].replace(/[\s—–-]+$/, ''), `version ${m[2]}`];
  if (m[3]) bits.push(`release candidate ${m[3]}`);
  return bits.filter(Boolean).join(', ');
}

const MINUTES = (m) => {
  const n = Math.round(Number(m));
  if (!Number.isFinite(n) || n <= 0) return null;
  const word = said(n);
  // "a eight minute episode" is the sound of a template. The article agrees with the
  // WORD he hears, not with the digit behind it.
  return `${/^[aeiou8]/.test(word) ? 'an' : 'a'} ${word} minute`;
};

/** 8:44 pm, said the way a clock is read rather than the way a log line is written. */
function clock(stamp) {
  const t = /(\d{2}):(\d{2})/.exec(String(stamp ?? ''));
  if (!t) return null;
  let h = Number(t[1]);
  const suffix = h >= 12 ? 'pm' : 'am';
  if (h === 0) h = 12; else if (h > 12) h -= 12;
  return `${h}:${t[2]} ${suffix}`;
}

/**
 * A title the sweep clipped, made sayable again.
 *
 * `navigator-state.md` clips a ranked title at seventy characters, so it can end
 * "…since 2026-08-03 — a…". Read aloud that is a sentence that stops. The ellipsis
 * comes off with whatever dangling fragment it left behind, and what is left is a
 * shorter title rather than a broken one.
 */
export function unclip(title = '') {
  let t = String(title).trim();
  if (!/[…]|\.\.\.$/.test(t)) return t;
  t = t.replace(/\s*(?:…|\.\.\.)\s*$/, '');
  // The clip usually lands a word or two past a dash or a colon; anything that short
  // after one is a fragment, not a clause.
  t = t.replace(/\s*[—–:-]\s*\S{0,24}$/, '');
  return t.replace(/[\s,;—–-]+$/, '');
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordinal = (n) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};
const spokenDate = (d) => `${DAYS[d.getDay()]} the ${ordinal(d.getDate())} of ${MONTHS[d.getMonth()]}`;

/**
 * The standup, as text.
 *
 * Order is deliberate and is the same every time, because he is listening rather than
 * scanning: the age first (so a stale file is caught before its content is believed),
 * then what is running, what is blocked, what wants him, what is waiting for his
 * review — then what this file does NOT cover, then how to send something back.
 */
export function composeStandup({ now = new Date(), md = '', fleet, rcs, decisions, titles = null } = {}) {
  const sweep = sweepReading(md, now);
  const out = [];
  const p = (s) => out.push(s, '');

  p('# The obot standup');
  p('This file is generated from the Navigator sweep on his laptop. Nobody writes it by hand, and anything typed into it is overwritten on the next pass.');

  // ---- age, cadence, round trip. First, because everything below depends on it.
  if (!sweep.read) {
    p('I cannot tell you how old this is. The sweep that feeds it has not run, or its reading could not be read, so nothing below has been measured and none of it should be taken as today.');
  } else if (sweep.stale) {
    p(`This is out of date. The last reading was taken at ${clock(sweep.sweptAt)}, which is ${sweep.ageMin} minutes ago, and the sweep behind it runs every ${said(sweep.cadenceMin)} minutes — so it has stopped. Treat everything below as the last thing that was true rather than as what is true now, and check anything you are about to act on.`);
  } else {
    p(`Read at ${clock(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)} on ${spokenDate(now)}. The reading behind it was taken at ${clock(sweep.sweptAt)}, ${plural(sweep.ageMin, 'minute', 'minutes')} ago.`);
    p(`The sweep runs every ${said(sweep.cadenceMin)} minutes and this file is rewritten each time, so nothing here is more than about ten minutes old. The same loop sets the round trip the other way: something you send back now shows up on the next pass, not straight away.`);
  }

  // ---- what is running
  out.push('## What is running');
  out.push('');
  if (!fleet || fleet.read === false) {
    p(`I cannot see the fleet from here — ${fleet?.why || 'the job records could not be read'}. That is not the same as nothing running, and I would rather say I cannot see than tell you it is quiet.`);
  } else if (fleet.working === 0) {
    p('No agent session is working right now.');
  } else {
    p(`${Cap(plural(fleet.working, 'agent session is', 'agent sessions are'))} working.`);
  }
  const stalls = stallVerdict(md);
  if (!stalls.read) {
    p('Whether any session is parked on a permission prompt was not measured this pass, so I cannot tell you either way.');
  } else if (stalls.clear) {
    p('No session is parked on a permission prompt, so nothing is held up waiting for you to approve it.');
  } else {
    p('At least one session is parked on a permission prompt and cannot move until you clear it. That is the one thing here that stops work dead.');
  }

  // ---- blocked
  const rank = rankRows(md);
  const blocked = rank.filter((r) => r.blocked);
  out.push('## What is blocked');
  out.push('');
  if (!rank.length) {
    p('The ranked list was not read this pass, so I cannot tell you what is blocked.');
  } else if (!blocked.length) {
    p('Nothing on the ranked list is marked blocked.');
  } else {
    p(`${Cap(plural(blocked.length, 'item on the ranked list is', 'items on the ranked list are'))} marked blocked on GitHub.`);
    for (const b of blocked) {
      const full = titles?.[b.issue] ?? titles?.get?.(b.issue) ?? null;
      p(`${unclip(full ?? b.title ?? '') || `Roadmap item ${b.issue}`}. The roadmap issue records what it is waiting on, and I can read that to you if you ask.`);
    }
  }

  // ---- decisions
  out.push('## What needs a decision from you');
  out.push('');
  if (!decisions || decisions.read === false) {
    p(`I could not read the decision list — ${decisions?.why || 'the registry could not be read'} — so I cannot say what is waiting on you. Do not read that as nothing.`);
  } else if (!decisions.rows.length) {
    p('Nothing is waiting on a decision from you.');
  } else {
    const open = decisions.rows.filter((r) => r.state === 'open').length;
    const part = decisions.rows.length - open;
    p(`${Cap(plural(decisions.rows.length, 'decision is', 'decisions are'))} waiting on you`
      + (part ? `: ${said(open)} open, and ${plural(part, 'that you have partly decided', 'that you have partly decided')}.` : '.'));
    for (const d of decisions.rows) p(decisionSentence(d));
  }
  if (decisions?.behind) {
    p(`One caveat on that list: the copy of the roadmap this was read from is ${plural(decisions.behind, 'commit', 'commits')} behind GitHub, so a decision published since the last fetch would be invisible here rather than absent.`);
  }

  // ---- release candidates
  out.push('## Release candidates waiting for you');
  out.push('');
  if (!rcs || rcs.read === false) {
    p(`The release queue could not be read this pass — ${rcs?.why || 'GitHub was not reached'} — so I cannot tell you what is waiting for your review.`);
  } else if (!rcs.rows.length) {
    p('No release candidate is waiting for your review.');
  } else {
    p(`${Cap(plural(rcs.rows.length, 'release candidate is', 'release candidates are'))} open and waiting on you.`);
    for (const r of rcs.rows) p(rcSentence(r));
  }

  // ---- the gap. Unconditional: a clean night is exactly when a missing bucket passes
  // for a complete picture.
  out.push('## What this standup does not cover');
  out.push('');
  p('It says nothing about your config list — the jobs only your hands can do. That list stays on the laptop, because this file is public, and I have left it out on purpose rather than because there is nothing on it. Ask for it in a laptop session and you will get the whole thing.');
  p('It also leaves out spend, the health of the machinery, and anything an agent has written about itself. This is the short version: what is moving, what is stuck, and what is waiting on you.');

  // ---- the inbound half, which already exists
  out.push('## Sending something back');
  out.push('');
  p('Say it and it goes to the roadmap\'s Ideas discussions on GitHub. A triage run starts there within a minute or two of it landing and answers in the thread, so an idea usually has a reply before you have finished the drive.');
  p('One thing to know before you dictate: the Ideas board is public, and anything sent that way is public the moment it posts. If it should stay private, keep it for a laptop session instead — the private lane only exists on the machine.');

  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** One decision, said the way he would ask about it. */
function decisionSentence(d) {
  const bits = [];
  const name = String(d.title ?? '').replace(/\s*[—–-]\s*$/, '');
  bits.push(d.state === 'partially decided'
    ? `${name} — partly decided, so some of its questions are still yours and the page says which.`
    : `${name}.`);
  if (d.questions) bits.push(`${Cap(plural(d.questions, 'question', 'questions'))} in total.`);
  if (Number.isFinite(d.waitingDays) && d.waitingDays >= 3) bits.push(`It has been waiting ${plural(d.waitingDays, 'day', 'days')}.`);
  bits.push(d.discussion
    ? `Answer it on discussion ${d.discussion}.`
    : 'No thread has been opened for it yet, so the answer goes on the artifact page.');
  const ep = d.episode ?? {};
  if (ep.exists && ep.current) {
    const m = MINUTES(ep.minutes);
    bits.push(m ? `There is ${m} episode if you would rather listen than read.` : 'There is an episode if you would rather listen than read.');
  } else if (ep.exists) {
    bits.push('An episode shipped for it, but the page has changed since, so it is out of date and I have not offered it.');
  } else {
    bits.push('No episode has been made for it yet.');
  }
  return bits.join(' ');
}

/** One release candidate, named by what it does. */
function rcSentence(r) {
  if (r.isPublic === false) {
    return `One is in a private repository, so I will not read its title out on a public file. It is waiting on your review like the others.`;
  }
  const what = (r.summary && r.summary.trim()) ? r.summary.trim().replace(/\s*$/, '') : `${spokenRelease(r.title)}.`;
  const where = String(r.repo ?? '').split('/').pop();
  return `${what}${/[.!?]$/.test(what) ? '' : '.'} That one is in ${where}.`;
}

// ------------------------------------------------ what the Navigator says about it

/** Where the publisher records what happened, for the sweep to read on the next pass. */
export const STANDUP_STATUS = '.claude/session-hub/standup-status.json';

/** The address a voice session is pointed at, said as a path rather than a URL. */
export const STANDUP_ADDRESS = 'jwildfire/obot.roadmap@session-state/standup.md';

/**
 * The Navigator's line for this lane.
 *
 * The publisher runs AFTER the state file is written — it reads that file — so what
 * this renders is the PREVIOUS pass's outcome, and it says so. One cadence behind is
 * honest; pretending to report a publish that has not happened yet is not.
 *
 * The stale rule is the state file's own, applied to this lane: an outcome older than
 * three cadences means the publisher has stopped, and a spoken standup that has stopped
 * being written is the one failure he cannot see — the file still fetches, still reads
 * fluently, and is simply describing an earlier evening.
 *
 * THE VERDICT IS AN UNINDENTED PLAIN LINE and BROKEN is spelled for the real
 * `ALARM_RE`: a `- ` bullet can never go red however it is worded (hub#241).
 */
export function standupSection(status, { now = new Date(), cadenceMin = 5 } = {}) {
  const head = '## Spoken standup — the file voice mode reads aloud';
  if (!status) {
    return `${head}\n\nstandup: nothing has been published from this machine yet. The lane is wired and has not run, which is not the same as a lane that ran and found nothing to say.\n`;
  }
  if (status.read === false) {
    return `${head}\n\n**STANDUP PUBLISHING BROKEN** — the publisher's own record could not be read${status.why ? ` (${status.why})` : ''}, so whether the standup is being written is unknown. Unknown, not fine.\n`;
  }
  const at = Date.parse(status.at ?? '');
  const ageMin = Number.isFinite(at) ? Math.max(0, Math.round((now.getTime() - at) / 60000)) : null;
  const when = ageMin === null ? 'at an unrecorded time' : `${ageMin} minute(s) ago`;
  if (status.outcome === 'failed' || status.outcome === 'refused') {
    return `${head}\n\n**STANDUP PUBLISHING BROKEN** — the last attempt ${when} ${status.outcome === 'refused' ? 'was refused' : 'failed'}${status.detail ? `: ${status.detail}` : ''}. The file he hears is whatever was published before it, and it will read exactly as fluently as a current one.\n`;
  }
  if (ageMin !== null && ageMin > cadenceMin * 3) {
    return `${head}\n\n**STANDUP PUBLISHING BROKEN** — the last run was ${when}, more than three cadences, so the publisher has stopped. What voice mode reads is still fetchable and is describing an earlier evening.\n`;
  }
  const verb = status.outcome === 'published' ? 'published' : 'checked and found unchanged';
  return `${head}\n\nstandup: ${verb} ${when} — ${STANDUP_ADDRESS}\n`;
}
