// The constraint ledger — what @jwildfire actually said, kept where the judging happens.
//
// jwildfire/obot.agent#293, under jwildfire/obot.roadmap#267.
//
// ## The failure this exists for, measured
//
// The Navigator objected twice, on the record, that three audio episodes ran over his
// five-minute maximum. Two of three did. The objection was wrong, because he had granted
// the exception in the same sentence that set the number:
//
//     "5 minutes or less is the guideline, though you can go over on critical items."
//
// All five numbers in question were his. The withdrawal is `n0220` in the delivery record.
//
// Constraints arrive in chat, with the concierge. Work arrives in the queue, with the
// Navigator. The party that knows the exception is not the party doing the judging, and
// until this file nothing carried one to the other. That makes a class of wrong verdict
// STRUCTURALLY LIKELY rather than accidental, and the dangerous consequence is neither of
// the two wrong verdicts: an objection that turns out wrong twice teaches the judge to stop
// objecting, and a silent judge and a satisfied one look identical from outside.
//
// ## What is writable here, and what is not
//
// The test is narrow, and it is enforced by the tool rather than stated in prose: did he
// set a bound, grant an exception, or forbid something. Nothing else is a constraint, and
// nothing else belongs on any surface. #267 is explicit that this is not a relay — "a
// channel that carries everything carries nothing" — so `constraint-log` writes exactly
// three kinds of record and refuses everything else. His conversation is not an input to
// this file; a bound he set is.
//
// ## A bound and its exception are one record
//
// `add` REFUSES a quote that hedges — though, unless, except, you can go over — with no
// exception recorded. Half of that sentence was worse than neither half: the Navigator
// holding only "5 minutes or less" objected, where the Navigator holding neither half would
// have asked. So half a sentence is not a writable state, which is the only version of
// "they travel together" that survives a tired agent at three in the morning.
//
// ## Local only
//
// The record holds his words. It lives in the workspace's `.claude/`, beside the config
// list, which is the folder in this workspace that cannot reach a published site by
// accident. Ids and quotes are printed to LOCAL surfaces — the sweep's state file, the
// Operations Dashboard, a worker's brief. Nothing here is published anywhere.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { readFailure } from '../ops-dashboard/lib/absent.mjs';

/** The record he could read. Append-only; the file only ever grows. */
export const recordPath = (ws) => path.join(ws, '.claude', 'constraints.md');
/** The append-only journal every id comes from. Ids are NEVER read back out of prose. */
export const journalPath = (ws) => path.join(ws, '.claude', 'constraints.journal');

const LOCK_WAIT_MS = 5000;

export const HEADER = [
  '# constraints — what @jwildfire said, kept where the judging happens',
  '',
  'Written only by `obot.agent tools/constraint-log`, append-only. One record per bound he',
  'set, exception he granted, or thing he forbade — his words, the date, and what they',
  'attach to. Nothing else from his conversation belongs here (jwildfire/obot.roadmap#267).',
  '',
];

/**
 * The three kinds, and there are deliberately only three.
 *
 * `bound` a number or a limit — five minutes, ten on the bench, one PR per session.
 * `grant` an exception or a permission — you can go over on critical items, merge your own.
 * `forbid` a "do not" — never delete, never call EnterWorktree, no writes outside the org.
 */
export const KINDS = ['bound', 'grant', 'forbid'];

/**
 * The hedge vocabulary — the words that say a second half of the sentence exists.
 *
 * Every one of these is in the sentence that produced the wrong verdict, or in a sentence
 * shaped like it. A quote carrying one of these and no recorded exception is half a
 * constraint, and this list is what makes that state unwritable rather than merely
 * discouraged.
 */
export const HEDGE_RE = /\b(though|unless|except|but you can|you can go over|go over on|caveat|other than|save for|apart from)\b/i;

/**
 * A verdict that judges against something HE said.
 *
 * Deliberately narrow, and calibrated against the real delivery record rather than
 * imagined. Measured on 2026-08-21 over the whole record — 141 verdicts and 279 calls — it
 * matches five lines: the four audio verdicts `n0220` withdrew, and `n0269`, which judged
 * the bench against "his standing ask for at least ten maintained". No false positive. A
 * wider pattern would fire on every line that mentions him and would be turned off within a
 * day, which is the same degradation as a judge that stops objecting.
 */
export const OBJECTION_RE = /\b(his|he) stated\b|\bagainst (his|what he)\b|\bhis \d+[- ](minute|hour|day|word)\b|\bhis (max|maximum|cap|bound|limit|guideline|standing ask)\b|\bover his\b/i;

/** A citation as it appears in a judgment line, e.g. `K0003`. */
export const CITE_RE = /\bK\d{4}\b/g;

/**
 * The declared-unbacked escape, written by `delivery-log verdict --against none`.
 *
 * A judge that cannot find a constraint behind its own objection has to be able to say so
 * and still record the judgment — the alternative is a tool that refuses the verdict, and a
 * judge with no way to speak is the silent judge this requirement is most afraid of. The
 * escape is loud rather than silent: it is written on the line, it is greppable, and the
 * sweep counts it, so declining to cite is visible instead of indistinguishable from
 * agreement.
 */
export const UNBACKED_RE = /·\s*against none\b/i;

/** `K0007`, from a number. Four digits, permanent, never reused. */
export const idOf = (n) => `K${String(n).padStart(4, '0')}`;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12);

const today = (now = new Date()) => now.toISOString().slice(0, 10);

// ------------------------------------------------------------------ the journal

/**
 * A lock nobody can hold forever.
 *
 * `wx` is the whole mechanism: the first process to create the file owns it. A stale lock
 * — an owner that died between creating and removing it — is taken over after the wait
 * rather than deadlocking the tool, because a constraint that cannot be recorded is a
 * constraint that will be judged against anyway.
 */
function withLock(jp, fn) {
  const lock = `${jp}.lock`;
  fs.mkdirSync(path.dirname(jp), { recursive: true });
  const started = Date.now();
  let fd = null;
  for (;;) {
    try { fd = fs.openSync(lock, 'wx'); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() - started > LOCK_WAIT_MS) {
        try { fs.unlinkSync(lock); } catch { /* somebody else won the takeover */ }
        continue;
      }
    }
  }
  try { return fn(); } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
    try { fs.unlinkSync(lock); } catch { /* already gone */ }
  }
}

/** Every journal record, oldest first. A malformed line is skipped, never guessed at. */
export function readJournal(jp) {
  let text;
  try { text = fs.readFileSync(jp, 'utf8'); } catch (e) {
    const f = readFailure(e, jp);
    if (f.absent) return { read: true, armed: false, records: [], why: null };
    return { read: false, armed: false, records: [], why: f.why };
  }
  const records = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* a torn line is not a record */ }
  }
  return { read: true, armed: true, records, why: null };
}

// ------------------------------------------------------------------ writing

export class ConstraintRefused extends Error {}

/**
 * One constraint, recorded whole.
 *
 * `said` is his words, verbatim and unedited — a paraphrase is exactly the thing that lost
 * the second half of the sentence. `exception` is the other half where there is one, in the
 * same record, so no reader can hold one without the other.
 */
export function addConstraint(ws, {
  said, exception = null, scope = '*', kind = 'bound', heard = 'chat', on = null, note = null, actor = null, now = new Date(),
} = {}) {
  const words = String(said ?? '').trim();
  if (!words) throw new ConstraintRefused('a constraint is his words — --said is required, verbatim and unedited');
  if (!KINDS.includes(kind)) {
    throw new ConstraintRefused(`--kind must be one of ${KINDS.join(', ')} — a constraint is a bound he set, an exception he granted, or something he forbade, and nothing else from his conversation is writable here (hub#267)`);
  }
  const ex = exception ? String(exception).trim() : null;
  if (!ex && HEDGE_RE.test(words)) {
    const hedge = words.match(HEDGE_RE)[0];
    throw new ConstraintRefused(
      `REFUSED — the quote hedges ("${hedge}") and no exception is recorded with it. `
      + 'Half of that sentence was worse than neither half: holding only "5 minutes or less" '
      + 'produced two wrong verdicts, where holding neither half would have produced a question. '
      + 'Record the other half with --exception, or quote the sentence whole in --said.');
  }
  const jp = journalPath(ws);
  return withLock(jp, () => {
    const { records } = readJournal(jp);
    const high = records.reduce((m, r) => Math.max(m, Number(String(r.id ?? '').slice(1)) || 0), 0);
    const id = idOf(high + 1);
    const rec = {
      op: 'constraint', id, ts: new Date(now).toISOString(), actor: actor || process.env.OBOT_ACTOR || null,
      kind, scope: String(scope || '*').trim() || '*', said: words, exception: ex,
      heard: String(heard || 'chat').trim(), on: on || today(now), note: note || null,
    };
    rec.digest = sha(`${id}|${rec.said}|${rec.exception ?? ''}`);
    fs.appendFileSync(jp, `${JSON.stringify(rec)}\n`);
    appendRecord(ws, rec);
    return rec;
  });
}

/** The line he could read, in the file he could read. */
export function renderLine(rec) {
  const bits = [`- ${rec.id} · ${rec.on} · ${rec.kind} · scope ${rec.scope} · heard: ${rec.heard}`,
    `"${rec.said}"`];
  if (rec.exception) bits.push(`EXCEPTION, same breath: "${rec.exception}"`);
  if (rec.note) bits.push(rec.note);
  return bits.join(' · ');
}

function appendRecord(ws, rec) {
  const md = recordPath(ws);
  fs.mkdirSync(path.dirname(md), { recursive: true });
  if (!fs.existsSync(md)) fs.writeFileSync(md, `${HEADER.join('\n')}\n`);
  fs.appendFileSync(md, `${renderLine(rec)}\n`);
}

// ------------------------------------------------------------------ reading

/**
 * Every constraint on this machine.
 *
 * `armed` false with `read` true means nobody has recorded one yet, which is honest and is
 * NOT the same as clean. `read` false means the reading itself failed, which is the one
 * state that must never render as an empty list (hub#206: ENOENT is the only failure
 * allowed to read as absence).
 */
export function readConstraints(ws) {
  const { read, armed, records, why } = readJournal(journalPath(ws));
  if (!read) return { read: false, armed: false, constraints: [], why };
  return { read: true, armed, why: null, constraints: records.filter((r) => r.op === 'constraint' && r.id) };
}

/**
 * Which constraints bind a piece of work.
 *
 * `*` binds everything. Otherwise a constraint binds when its scope matches the work's
 * scope exactly, or is a prefix of it — `hub#242` binds `hub#242`, and `audio` binds
 * `audio/episodes`. Scope matching is deliberately dumb: a clever matcher that quietly
 * decided a constraint did not apply would reproduce the failure this file exists for.
 */
export function inForce(constraints, scope) {
  const want = String(scope ?? '').trim().toLowerCase();
  return constraints.filter((c) => {
    const s = String(c.scope ?? '*').trim().toLowerCase();
    if (s === '*') return true;
    if (!want) return false;
    return want === s || want.startsWith(`${s}/`) || want.startsWith(`${s}#`);
  });
}

/** Every citation of a constraint id anywhere in a body of text, with its line. */
export function citations(text = '') {
  const out = [];
  for (const line of String(text).split('\n')) {
    const found = line.match(CITE_RE);
    if (found) out.push({ line, ids: [...new Set(found)] });
  }
  return out;
}

/** When each constraint was last cited in the delivery record, or null. */
export function lastCited(constraints, deliveryText = '') {
  const seen = new Map();
  for (const { line, ids } of citations(deliveryText)) {
    const day = (line.match(/\b(\d{4}-\d{2}-\d{2})\b/) || [])[1] || null;
    for (const id of ids) if (day && (!seen.has(id) || seen.get(id) < day)) seen.set(id, day);
  }
  return Object.fromEntries(constraints.map((c) => [c.id, seen.get(c.id) ?? null]));
}

// ------------------------------------------------------------------ the audit

/**
 * Every judgment in the delivery record, split into the parts this check needs.
 *
 * The record's own grammar (`tools/lib/delivery_ledger.py`) is `- DATE TIME ID · ...`, and
 * a call line carries ` · call ` where a verdict does not. BOTH are read here, because both
 * judge: a verdict says a worker did or did not move the roadmap, and a call — `n0269`, "the
 * bench is down to two against his standing ask for at least ten maintained" — decides
 * something on his behalf against a bound of his. A checker that read only verdicts would
 * have covered four of the five real cases in the record and called that complete.
 */
export function judgements(deliveryText = '', { since = null } = {}) {
  const out = [];
  for (const raw of String(deliveryText).split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('- ')) continue;
    const m = line.match(/^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) (\S+) · (.*)$/);
    if (!m) continue;
    if (since && m[1] < since) continue;
    out.push({ day: m[1], time: m[2], who: m[3], kind: line.includes(' · call ') ? 'call' : 'verdict', rest: m[4], line: line.slice(2) });
  }
  return out;
}

/** Verdicts alone, for a caller that wants only the closeout half. */
export const verdictLines = (text, opts) => judgements(text, opts).filter((j) => j.kind === 'verdict');

/**
 * The findings, all three of them read-only.
 *
 * `uncited`    a judgment made against something he said which cites no constraint. This is
 *              the audio case exactly: four verdicts objecting to a number of his, none of
 *              them able to say where the number came from or whether it had a second half.
 * `unresolved` a citation to an id that is not in the ledger. A citation that does not
 *              resolve is worse than none, because it reads as checked.
 * `half`       a record that hedges with no exception. Unwritable through the tool, so this
 *              only ever fires on a hand-edited journal — which is precisely when nothing
 *              else would notice.
 *
 * Windowed by `since`, which defaults to the ledger's own first record. A check whose
 * pending list can only grow gets ignored and then retired (the Navigator said so itself in
 * `n0072`); this one can only ever speak about judgments written after the mechanism existed
 * to be used.
 */
export function auditConstraints({ constraints = [], deliveryText = '', since = null, read = true, armed = true } = {}) {
  const known = new Set(constraints.map((c) => c.id));
  // The window opens when the RECORD was armed on this machine, never at the date he
  // said the thing. A constraint's `on` can be weeks older than the mechanism — K0002 is
  // from 2026-08-04 — and defaulting to it would make every judgment ever written a
  // finding, which is a list that can only grow and therefore a check that gets ignored
  // and then retired (the Navigator's own n0072). `--since` re-opens it deliberately,
  // which is how the retrospective answer to "would any verdict this week have differed"
  // is produced.
  const epoch = since ?? (constraints.length
    ? constraints.map((c) => String(c.ts || c.on).slice(0, 10)).sort()[0]
    : null);
  const uncited = [];
  const unresolved = [];
  for (const j of judgements(deliveryText, { since: epoch })) {
    const ids = j.line.match(CITE_RE) || [];
    for (const id of ids) if (!known.has(id)) unresolved.push({ ...j, id });
    if (!ids.length && OBJECTION_RE.test(j.rest) && !UNBACKED_RE.test(j.rest)) uncited.push(j);
  }
  const half = constraints.filter((c) => !c.exception && HEDGE_RE.test(c.said || ''));
  return { read, armed, epoch, uncited, unresolved, half, count: constraints.length };
}

export const findings = (a) => Boolean(!a.read || a.uncited.length || a.unresolved.length || a.half.length);
