// The vocabulary — the words he is told to say, decided in exactly one place.
//
// Requirement jwildfire/obot.roadmap#265: "The subject words come from the episodes
// themselves. Whatever the scripts tell him to say IS the vocabulary — inventing a
// parallel list is the two-sources-of-truth defect that cost ten decisions their
// state this week."
//
// So this module derives a handle for every OPEN decision from the one fact that is
// already the decision's name — its artifact slug — and both consumers read it:
// the narration script that gets rendered to audio, and the router that has to
// recognise what he says back. Neither keeps a list.
//
// ## A handle is the slug, said out loud
//
// `2026-08-20-branch-protections` is "branch protections". The slug is written by a
// person naming the decision, which is why it already reads as English; the date on
// the front is filing, not name, so it comes off.
//
// ## Two words unless two words are not enough
//
// A handle starts at two words and grows only when it has to. It has to when another
// open decision would answer to the same words — either literally, or after a
// transcription has had its way with them. "branch protections" and "branch
// protection" are the same sound; a router that resolved between them by score would
// be guessing, and a guess here files his words against the wrong decision, where
// nothing looks wrong afterwards.
//
// When growing cannot separate two handles, that is recorded on both of them
// (`collidesWith`) rather than hidden. The router refuses to resolve either by
// handle, and the episode can say so. A vocabulary that knows two of its words sound
// alike is honest; one that does not is a trap.
//
// ## The queue snapshot
//
// `buildQueue` also stamps a `fingerprint` of the open set. That is what makes
// "number two" answerable: an ordinal only means anything against the list that was
// actually read to him, and if the open set has moved since, the ordinal is refused
// instead of being resolved against a different decision.
//
// Local-only, like everything under `.claude/ops/`: the snapshot is written there and
// never committed or published.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ensureStore, opsDir, SENTINEL } from '../../ops-dashboard/lib/store.mjs';

/** Where the queue snapshot lives. Inside the ops store, so it cannot be published. */
export const voiceDir = (workspace) => path.join(opsDir(workspace), 'voice');

const DATE_RE = /^\d{4}-\d{2}-\d{2}-/;

/** How long after he decides one a sentence naming it still reads as a late answer. */
export const RECENT_DAYS = 21;

/** The slug as spoken words: the date is filing, the rest is the name. */
export const deriveHandleWords = (slug) => String(slug ?? '')
  .replace(DATE_RE, '')
  .split('-')
  .map((w) => w.trim().toLowerCase())
  .filter(Boolean);

/**
 * What a word sounds like, roughly — enough to catch what dictation confuses.
 *
 * Not Soundex and not trying to be: the job is to notice that two handles in a
 * queue of three would arrive at the router as the same tokens. Vowels go (they are
 * what a transcription reallocates most freely), the common consonant spellings are
 * folded together, and a trailing plural is dropped, because "protections" and
 * "protection" are one word as far as a dictated sentence is concerned.
 */
export function phoneticKey(word) {
  let s = String(word ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return '';
  s = s.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/ch/g, 'k').replace(/gh/g, 'g');
  s = s.replace(/[cq]/g, 'k').replace(/x/g, 'ks').replace(/z/g, 's');
  const head = /^[aeiou]/.test(s) ? s[0] : '';
  s = head + s.slice(head ? 1 : 0).replace(/[aeiouy]/g, '');
  s = s.replace(/(.)\1+/g, '$1');
  if (s.length > 3 && s.endsWith('s')) s = s.slice(0, -1);
  return s;
}

const soundOf = (words) => words.map(phoneticKey).join(' ');

/**
 * Open decisions, in the order the registry carries them.
 *
 * A registry that cannot be read is a failed read and says so. It is NOT reported as
 * an empty queue even when the failure is ENOENT: an absent registry inside a hub
 * clone means the clone is wrong, not that he has decided everything. The one place
 * absence is a real answer is the snapshot (`readQueue`), which legitimately does not
 * exist until the first episode is written.
 */
export function openDecisions(hub, { now = new Date(), recentDays = RECENT_DAYS } = {}) {
  const file = path.join(hub ?? '', 'reports', 'decisions', 'registry.json');
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { decisions: [], recent: [], read: false, why: `no readable decision registry at ${file} (${e.code ?? e.message})` };
  }
  // Schema drift is a FAILED READ, not an empty decision set. `(reg.artifacts ?? [])`
  // turned a renamed key into "he has decided everything", which reads as success and
  // makes every answer he dictates from then on an idea — and ideas are published.
  if (!Array.isArray(reg.artifacts)) {
    return { decisions: [], recent: [], read: false, why: `${file} has no artifacts array — the registry's shape has changed` };
  }
  const row = (a) => ({
    id: a.id, slug: a.slug, title: a.title ?? null, date: a.date ?? null,
    state: a.state ?? null, decidedOn: a.decidedOn ?? a.closedOn ?? a.date ?? null,
    questions: a.questions ?? [],
  });
  const decisions = reg.artifacts.filter((a) => a && a.state === 'open').map(row);
  // Decisions he answered recently. Not answerable, but a sentence that names one is an
  // answer arriving late — a correction, or a second thought — and it must be kept and
  // shown rather than filed as an idea on a public board.
  const cut = now.getTime() - recentDays * 86400000;
  const recent = reg.artifacts
    .filter((a) => a && a.state !== 'open')
    .map(row)
    .filter((a) => {
      const t = Date.parse(a.decidedOn ?? '');
      return Number.isFinite(t) && t >= cut;
    });
  return { decisions, recent, read: true, why: '' };
}

/**
 * The handle for each decision: short, distinct, and honest about what it cannot
 * separate. Also the ordinal, which is the other way he can name one out loud.
 */
export function allocateHandles(entries = []) {
  const rows = entries.map((e, i) => ({
    ...e,
    ordinal: i + 1,
    all: deriveHandleWords(e.slug),
    len: 0,
    collidesWith: [],
  }));
  for (const r of rows) r.len = Math.min(2, r.all.length) || r.all.length;

  const words = (r) => r.all.slice(0, r.len);
  const canGrow = (r) => r.len < r.all.length;

  // Grow any group that would answer to the same words — literally first, then by
  // sound. Bounded by the longest slug in the set, so it always terminates.
  for (let pass = 0; pass < 12; pass++) {
    let grew = false;
    for (const key of [(r) => words(r).join(' '), (r) => soundOf(words(r))]) {
      const groups = new Map();
      for (const r of rows) {
        const k = key(r);
        groups.set(k, [...(groups.get(k) ?? []), r]);
      }
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const growable = group.filter(canGrow);
        if (!growable.length) continue;
        for (const r of growable) r.len += 1;
        grew = true;
      }
    }
    if (!grew) break;
  }

  // What growing could not separate is recorded on both, never smoothed over.
  const bySound = new Map();
  for (const r of rows) {
    const k = soundOf(words(r));
    bySound.set(k, [...(bySound.get(k) ?? []), r]);
  }
  for (const group of bySound.values()) {
    if (group.length < 2) continue;
    for (const r of group) r.collidesWith = group.filter((o) => o.id !== r.id).map((o) => o.id);
  }

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title ?? null,
    questions: r.questions ?? [],
    ordinal: r.ordinal,
    handle: words(r).join(' '),
    words: words(r),
    collidesWith: r.collidesWith,
  }));
}

/** The fingerprint of an open set — what an ordinal is only valid against. */
export const queueFingerprint = (decisions = []) => crypto.createHash('sha256')
  .update(JSON.stringify(decisions.map((d) => [d.id, d.slug])))
  .digest('hex').slice(0, 16);

/** The open decisions, handled, numbered and fingerprinted. */
export function buildQueue(hub, { now = new Date() } = {}) {
  const open = openDecisions(hub, { now });
  const decisions = allocateHandles(open.decisions);
  return {
    at: now.toISOString(),
    read: open.read,
    why: open.why,
    fingerprint: queueFingerprint(decisions),
    decisions,
    // Carried, never numbered: he is never told to say one of these, and an ordinal
    // must never resolve into them.
    recent: allocateHandles(open.recent ?? []).map((d) => ({ ...d, ordinal: null })),
  };
}

const queueFile = (workspace) => path.join(voiceDir(workspace), 'queue.json');

/**
 * Persist the queue as it was read to him. Written by the script generator, because
 * the moment the narration is produced is the moment the vocabulary is fixed.
 */
export function writeQueue(workspace, queue) {
  ensureStore(workspace);
  fs.mkdirSync(voiceDir(workspace), { recursive: true });
  fs.writeFileSync(queueFile(workspace), `${JSON.stringify({ _note: SENTINEL, ...queue }, null, 2)}\n`);
  return queue;
}

/**
 * The queue he was last read. `{queue, read, why}`.
 *
 * Absent is a real answer here — no episode has been produced on this machine yet —
 * so ENOENT reads as `{queue: null, read: true}`. Anything else is a failed read.
 */
export function readQueue(workspace) {
  const file = queueFile(workspace);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e?.code === 'ENOENT') return { queue: null, read: true, why: '' };
    return { queue: null, read: false, why: `${file} could not be read (${e.code ?? e.message})` };
  }
  try {
    return { queue: JSON.parse(text), read: true, why: '' };
  } catch {
    return { queue: null, read: false, why: `${file} is not readable JSON` };
  }
}
