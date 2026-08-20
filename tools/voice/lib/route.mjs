// Where a dictated sentence goes — four destinations, and no fifth.
//
// jwildfire/obot.roadmap#265, in his words: "A leading subject word that names an
// open decision routes the rest as an answer to it. Anything else stays an idea,
// exactly as today. `private:` still keeps it local." Plus the rule that is most of
// the work: "An answer whose subject word matches nothing must surface as UNROUTED
// with the text preserved verbatim. Never silently dropped, never quietly filed as
// an idea. A dictated sentence is the one input we cannot ask him to repeat, because
// he does not know it failed."
//
// ## The asymmetry this module is built around
//
// An UNROUTED sentence costs him one repeat. A MISROUTED one costs a decision: his
// words land on a page he was not talking about, an agent applies them there, and
// the decision he was answering is still open with nothing on it. Nothing looks
// wrong from any surface. So every close call resolves to UNROUTED, and the answer
// store is written only when exactly one decision is both a good fit and clearly the
// best one.
//
// ## Sounding like an answer, and saying you are giving one
//
// Two ways in. Saying the subject is enough — that is the shape he asked for
// ("census, deprecate"). Saying "answer" first DECLARES one, and a declared answer
// can never fall through to the idea queue no matter what it matches; it becomes
// UNROUTED instead. That is the difference between "he mentioned a decision in an
// idea" and "he answered and we lost it".
//
// ## Nothing here is committed or published
//
// The unrouted store sits in `.claude/ops/voice/`, beside the answers, for the same
// reason: it holds his verbatim words.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { recordAnswer } from '../../ops-dashboard/lib/answers.mjs';
import { ensureStore, SENTINEL } from '../../ops-dashboard/lib/store.mjs';
import { readArtifact, verdictFrom } from './artifact.mjs';
import { buildQueue, readQueue, voiceDir } from './handles.mjs';
import { matchSpoken, normalizeSpoken } from './match.mjs';
import { isPrivate, keepPrivate } from './private.mjs';

/** The channel stamped on the record, so an answer says where it came from. */
export const VOICE_CHANNEL = 'voice (dictated)';
export const VOICE_BY = 'voice-router';

/** How long an unrouted sentence may sit before the sweep calls it a gap. */
export const UNROUTED_OVERDUE_MIN = 30;

const unroutedDir = (workspace) => path.join(voiceDir(workspace), 'unrouted');
const key = (text) => crypto.createHash('sha256')
  .update(normalizeSpoken(text).tokens.join(' ')).digest('hex').slice(0, 12);

/** His words, clipped for a line on his own page. The full text stays on the record. */
const clip = (s, n = 160) => (String(s ?? '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ''));

/**
 * Keep a sentence that reached no decision.
 *
 * Deduplicated on what was actually said, so the same reminder read twice is one
 * item heard twice rather than a growing pile — and so a lane that polls every five
 * minutes cannot manufacture an alarm out of one sentence.
 */
export function recordUnrouted(workspace, { text, reason, reasonKind, candidates = [], now = new Date() }) {
  ensureStore(workspace);
  fs.mkdirSync(unroutedDir(workspace), { recursive: true });
  const k = key(text);
  const existing = readUnrouted(workspace, { all: true }).items.find((i) => i.key === k && i.status === 'open');
  const at = now.toISOString();
  if (existing) {
    existing.heard = (existing.heard ?? 1) + 1;
    existing.lastHeardAt = at;
    existing.history = [...(existing.history ?? []), { at, note: 'heard again' }];
    return writeUnrouted(workspace, existing);
  }
  return writeUnrouted(workspace, {
    _note: SENTINEL,
    id: `${at.replace(/[:.]/g, '-')}-${k}`,
    key: k,
    at,
    lastHeardAt: at,
    status: 'open',
    text: String(text ?? '').trim(),
    reason,
    reasonKind,
    candidates: candidates.map((c) => ({ id: c.id, handle: c.handle, slug: c.slug })),
    heard: 1,
    resolvedAt: null,
    resolvedBy: null,
    note: null,
    history: [{ at, note: 'heard' }],
  });
}

const writeUnrouted = (workspace, item) => {
  fs.writeFileSync(path.join(unroutedDir(workspace), `${item.id}.json`), `${JSON.stringify(item, null, 2)}\n`);
  return item;
};

/**
 * Every sentence that reached no decision. `{items, read, why}` — open ones by
 * default, all of them with `{all: true}`, because nothing here is ever deleted.
 */
export function readUnrouted(workspace, { all = false } = {}) {
  let names;
  try { names = fs.readdirSync(unroutedDir(workspace)).filter((n) => n.endsWith('.json')); } catch (e) {
    if (e?.code === 'ENOENT') return { items: [], read: true, why: '' };
    return { items: [], read: false, why: `the unrouted store could not be read (${e.code ?? e.message})` };
  }
  const items = names
    .map((n) => { try { return JSON.parse(fs.readFileSync(path.join(unroutedDir(workspace), n), 'utf8')); } catch { return null; } })
    .filter(Boolean)
    .filter((i) => all || i.status === 'open')
    .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  return { items, read: true, why: '' };
}

/** He said it again and it landed, or an agent worked out what he meant. Kept, not removed. */
export function resolveUnrouted(workspace, id, { by = 'an agent', note = null, now = new Date() } = {}) {
  const item = readUnrouted(workspace, { all: true }).items.find((i) => i.id === id || i.key === id);
  if (!item) throw new Error(`no unrouted sentence ${id}`);
  const at = now.toISOString();
  item.status = 'resolved';
  item.resolvedAt = at;
  item.resolvedBy = by;
  item.note = note;
  item.history = [...(item.history ?? []), { at, note: `resolved by ${by}${note ? ` — ${note}` : ''}` }];
  return writeUnrouted(workspace, item);
}

/**
 * Route one dictated sentence.
 *
 * Returns `{kind}` — `private`, `answer`, `unrouted` or `idea` — plus whatever that
 * destination needs. Writes only for `answer` and `unrouted`; `idea` and `private`
 * are handed straight back to the lane that already handles them.
 */
export function routeSpoken(text, {
  workspace, hub, queue, now = new Date(), channel = VOICE_CHANNEL, by = VOICE_BY, dryRun = false,
} = {}) {
  const raw = String(text ?? '');
  // One rule, and the write happens here rather than in a caller that spelled the rule
  // differently. `kept` used to be a counter incremented next to no write at all.
  if (isPrivate(raw)) {
    const kept = dryRun ? { written: true, file: null, why: '' } : keepPrivate(workspace, raw, { now });
    return { kind: 'private', text: raw, by, kept: kept.written, file: kept.file, why: kept.why };
  }

  const live = buildQueue(hub, { now });
  if (!live.read) {
    // The registry could not be read, so "this matches no open decision" and "this
    // machine cannot see the open decisions" are indistinguishable — and one of them
    // is an answer of his. Refusing is the only honest move (obot.agent#206/#215).
    const reason = `the open decision list could not be read, so nothing here can say what this is an answer to — ${live.why}`;
    // Recorded only when a caller is handling one sentence deliberately. The scheduled
    // poll checks `reasonKind` and leaves the item alone instead, because branding every
    // idea on the list "could not route" is this machine's fault being written onto his
    // notes.
    return {
      kind: 'unrouted', reasonKind: 'registry-unreadable', reason, by,
      item: dryRun ? null : recordUnrouted(workspace, { text: raw, reason, reasonKind: 'registry-unreadable', now }),
    };
  }

  const snapshot = queue === undefined ? readQueue(workspace).queue : queue;
  const m = matchSpoken(raw, live, { snapshot, currentFingerprint: live.fingerprint, now });

  if (m.kind === 'match') {
    const art = readArtifact(hub, m.decision.slug);
    const verdict = verdictFrom(m.rest, art.options);
    // His whole sentence is the answer, subject and all. Nothing is trimmed into a
    // tidier one: #265 is explicit that what is recorded is what he said.
    // `dryRun` writes nothing at all. It is how `voice-decisions route` shows what
    // WOULD happen — a preview that records an answer of his is not a preview.
    const { record, duplicate } = dryRun
      ? { record: { verdict: verdict || 'words-only', words: raw.trim() }, duplicate: false }
      : recordAnswer(workspace, { artifact: m.decision.slug, verdict, words: raw.trim(), by, channel }, { hub, now });
    return {
      kind: 'answer', by, channel, decision: m.decision, matchedBy: m.by, confidence: m.confidence,
      verdict: record.verdict, rest: m.rest, record, duplicate,
    };
  }

  if (m.kind === 'ambiguous' || m.kind === 'unsure') {
    const reasonKind = m.kind === 'ambiguous' ? 'ambiguous' : 'unsure';
    return {
      kind: 'unrouted', reasonKind, reason: m.reason, candidates: m.candidates ?? [], by,
      item: dryRun ? null : recordUnrouted(workspace, { text: raw, reason: m.reason, reasonKind, candidates: m.candidates ?? [], now }),
    };
  }

  // Before anything becomes an idea: does it name a decision he answered RECENTLY?
  // That is an answer arriving late — a correction, or a second thought — and with the
  // decision no longer open there is nothing for it to match. Filing it as an idea
  // publishes it, completes the reminder, and leaves him with the narration's promise
  // that an unmatched sentence "stays on the list" being false on exactly the path he
  // is most likely to take.
  const late = matchSpoken(raw, { ...live, decisions: live.recent ?? [] }, { snapshot: null, now });
  if (late.kind === 'match') {
    const reason = `"${late.decision.handle}" was already decided${late.decision.decidedOn ? ` on ${late.decision.decidedOn}` : ''}, `
      + 'so there is no open question for this to be an answer to. It is kept exactly as you said it, '
      + 'because a second thought about a decision is not an idea for the queue.';
    return {
      kind: 'unrouted', reasonKind: 'already-decided', reason, candidates: [late.decision], by,
      item: dryRun ? null : recordUnrouted(workspace, { text: raw, reason, reasonKind: 'already-decided', candidates: [late.decision], now }),
    };
  }

  // Nothing here is about the queue. If he SAID he was answering, that is a loss and
  // is kept; if he did not, it is an idea and goes where ideas have always gone.
  if (m.declared) {
    const reason = live.decisions.length
      ? `you said this was an answer and it matches none of the ${live.decisions.length} open decisions`
      : 'you said this was an answer and there are no open decisions right now, so there was nothing for it to answer';
    return {
      kind: 'unrouted', reasonKind: 'declared-no-match', reason, candidates: live.decisions, by,
      item: dryRun ? null : recordUnrouted(workspace, { text: raw, reason, reasonKind: 'declared-no-match', candidates: live.decisions, now }),
    };
  }
  return { kind: 'idea', text: raw, best: m.best ?? 0, by };
}

const ageMin = (at, now = new Date()) => Math.max(0, Math.round((now.getTime() - Date.parse(at)) / 60000));
const ago = (min) => (min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`);

/**
 * The Navigator's section for sentences that reached no decision.
 *
 * THE VERDICT IS AN UNINDENTED LINE, not a bullet, and its headline is spelled for
 * `ALARM_RE` — both learned the hard way (obot.agent#223, hub#241): `parseNavigatorState`
 * alarm-tests preamble notes and unindented plain lines and nothing else, so a `- `
 * bullet can never render as an alarm however it is worded.
 *
 * HIS WORDS ARE ON THE ROWS, CLIPPED. Everywhere else in this program a log line
 * carries the decision and the verdict and never his prose, because log lines flow
 * into surfaces that can be published. Here the sentence IS the finding — a routing
 * failure he cannot act on without seeing what was heard — so it is on the row,
 * clipped, in a file that lives under `.claude/` and is never committed.
 */
export function unroutedSection(items = [], { now = new Date(), lane = null, read = true, why = '' } = {}) {
  const lines = ['## Voice answers that reached no decision — his words, kept whole', ''];

  // A store that could not be opened is not a store with nothing in it. This section
  // used to be handed `.items` alone, so an unreadable directory rendered the clean
  // line — a positive claim about his dictated sentences, made from a failed read.
  if (read === false) {
    lines.push(`voice: **UNROUTED STORE READING BROKEN** — the sentences that reached no decision could not be read`
      + `${why ? ` (${why})` : ''}. Nothing here says any landed, and nothing here says none were lost.`);
    return `${lines.join('\n')}\n`;
  }

  // THE LANE ITSELF IS A FINDING. A section that only ever reports unrouted sentences
  // is silent in exactly two situations that look identical from here — nothing was
  // said, and nothing is listening — and the second is the one that would go unnoticed
  // for days while he dictates into a list nothing reads.
  if (lane) {
    if (!lane.armed) {
      lines.push('voice: the car lane is NOT ARMED on this machine, so nothing polls the Reminders list and '
        + 'nothing he dictates can land. Arm it with `obot.agent/tools/voice-decisions arm`. '
        + 'It is not an alarm: it has never been armed, and the lane still works run by hand.');
    } else if (lane.read === null || lane.read === undefined) {
      // Armed, but this particular reading did not poll — the CLI renders the section
      // by hand and must not claim a read it did not do.
      lines.push('voice: armed. This reading did not poll the Reminders list; the five-minute sweep does that.');
    } else if (lane.read === false) {
      lines.push(`voice: **VOICE LANE BROKEN** — the Reminders list could not be read this sweep`
        + `${lane.why ? ` (${lane.why})` : ''}. Nothing he dictated has been routed, and this is not a quiet lane — `
        + 'it is a lane nobody can hear.');
    } else if (lane.queueRead === false) {
      // The snapshot is what the vocabulary and every ordinal are resolved against. A
      // file that exists and cannot be parsed is a different fault from one that was
      // never written, and reporting the second for the first sends whoever reads it
      // to produce an episode that already exists.
      lines.push(`voice: **VOICE QUEUE READING BROKEN** — the queue snapshot he was last read could not be parsed`
        + `${lane.queueWhy ? ` (${lane.queueWhy})` : ''}. Nothing dictated can be matched to a position, and the `
        + 'vocabulary this lane matches against is unknown.');
    } else {
      lines.push(`voice: armed and read${lane.routed ? `, ${lane.routed} answer(s) routed this sweep` : ', nothing new dictated'}.`);
    }
    // Left alone because they pre-date the queue he was read. Counted rather than
    // silent: a growing number here means the ideas lane is not draining the list.
    if (lane.stale) {
      lines.push(`  ${lane.stale} item(s) on the list are older than the queue he was last read, so they were left alone `
        + 'rather than answered against a list that did not exist when he said them. They are ideas waiting for `reminders-to-ideas`.');
    }
    // And the one that must shout: the stamp is the mechanism that stops an item being
    // read again, so a failed one repeats every sweep with nothing saying why.
    // UNINDENTED, and it took a second pass to notice why. The two-space indent this
    // line carried until 2026-08-20 made `parseNavigatorState` file it as a DETAIL of the
    // line above, and a detail carries no `alarm` key at all — so a headline spelled
    // exactly for `ALARM_RE` rendered grey on his page for as long as it existed. The
    // test asserted the string matched the regex, which it did, and never asserted the
    // line was one the parser alarm-tests (hub#241).
    if (lane.unstamped) {
      lines.push(`**VOICE RECEIPT FAILED** — ${lane.unstamped} receipt(s) could not be written back to the reminder. `
        + 'The answer is recorded, but the item was not stamped, so he has no confirmation and the sweep will read it again.');
    }
    lines.push('');
  }

  if (!items.length) {
    lines.push('voice: none unrouted — every sentence dictated into the lane reached a decision or was an idea');
    return `${lines.join('\n')}\n`;
  }
  const late = items.filter((i) => ageMin(i.at, now) > UNROUTED_OVERDUE_MIN);
  const oldest = items.reduce((a, b) => (ageMin(a.at, now) > ageMin(b.at, now) ? a : b));
  lines.push(`voice: **VOICE ANSWER GAP** — ${items.length} dictated sentence(s) reached no decision`
    + `${late.length ? `, ${late.length} past the ${UNROUTED_OVERDUE_MIN}m bar` : ''}, oldest ${ago(ageMin(oldest.at, now))}. `
    + 'He does not know one failed, because a dictated sentence gives no receipt on its own.');
  lines.push('');
  for (const i of items) {
    lines.push(`- **${i.reasonKind}** heard ${ago(ageMin(i.at, now))} ago${i.heard > 1 ? ` (${i.heard}×)` : ''} — `
      + `"${clip(i.text)}" · ${i.reason}${i.candidates?.length ? ` · candidates: ${i.candidates.map((c) => c.handle).join(', ')}` : ''}`);
  }
  lines.push('', 'Read them: `obot.agent/tools/voice-decisions unrouted` · resolve one once he has said it again.');
  return `${lines.join('\n')}\n`;
}

export { ageMin, ago, clip };
