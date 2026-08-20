// Recognising which decision he just answered — and refusing to when it is close.
//
// jwildfire/obot.roadmap#265: he dictates a sentence with no identifier in it, and
// something has to decide which of the open decisions it belongs to. Two failures are
// possible and they are not equally bad:
//
//   unmatched   nothing here fits. He finds out, because the reminder he dictated
//               stays on the list wearing the reason, and the sentence is kept whole.
//   MISMATCHED  it fitted two and one was picked. Nothing looks wrong afterwards:
//               the answer store shows an answer, the sweep announces it, an agent
//               applies it to a page he was not talking about, and the decision he
//               *was* answering is still open. Nobody discovers this for days.
//
// So this module has a third outcome between match and none, and it is a first-class
// result rather than a low score: `ambiguous` returns NO decision, ever, under any
// score. Everything below is arranged so that the only way to get a decision back is
// for exactly one candidate to be both good enough and clearly better than the next.
//
// ## Loose on purpose
//
// "Transcription will mangle words" (#265). Matching is therefore per-token and
// fuzzy: an exact word, a word that sounds the same (`protection` for
// `protections`), or a word that shares most of its letters. A handle that must be
// said perfectly is a handle he cannot use at 70mph.
//
// ## Ordinals are only valid against the list he was actually read
//
// "number two" is the most natural thing a person says, and the most dangerous: it
// means nothing except against a specific queue in a specific order. So an ordinal
// resolves only when the snapshot's fingerprint still matches the open set. If a
// decision was answered or a new one published since the episode, the ordinal is
// refused with that reason rather than resolved against a list that has moved.
import { phoneticKey } from './handles.mjs';

/** Below this, nothing here looks like an answer at all — it is an idea. */
export const ANSWER_FLOOR = 0.5;
/** At or above this, one candidate is good enough to route — if it is also clear. */
export const MATCH_FLOOR = 0.6;
/** And it must beat the runner-up by this much, or neither is taken. */
export const MARGIN = 0.15;
/** How old the queue he was read may be before an ordinal stops meaning anything. */
export const QUEUE_MAX_H = 72;

// Words Siri and a person leave on the front of a dictated sentence. Stripped only
// from the head: "the" in the middle of an answer is part of his answer.
const LEADING_FILLER = new Set([
  'obot', 'oh', 'o', 'bot', 'hey', 'siri', 'um', 'uh', 'er', 'ah', 'ok', 'okay', 'so',
  'note', 'add', 'to', 'the', 'my', 'list', 'reminder', 'reminders', 'please', 'for',
]);

// Saying any of these declares an answer. A declared answer that matches nothing is
// UNROUTED and can never be quietly filed as an idea (#265).
const DECLARE = new Set(['answer', 'answers', 'answering', 'answered', 'decision', 'decide', 'reply', 'verdict']);
const DECLARE_TAIL = new Set(['to', 'for', 'is', 'on', 'the']);

const ORDINAL_WORDS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7, '8th': 8, '9th': 9, '10th': 10,
};
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10,
};
const ORDINAL_MARKERS = new Set(['number', 'no', 'num', 'decision', 'item', 'question', 'one']);
const spell = (n) => Object.keys(NUMBER_WORDS).find((k) => NUMBER_WORDS[k] === n && Number.isNaN(Number(k))) ?? String(n);

const bigrams = (s) => {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
};

/** Sørensen–Dice over letter pairs: how much of one word is the other word. */
export function dice(a, b) {
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return (2 * shared) / (A.size + B.size);
}

/**
 * How alike two spoken words are. Exact, then sounds-the-same, then mostly-the-same
 * letters — and below a real resemblance, zero rather than a small number, so noise
 * in a long sentence cannot accumulate into a match.
 */
export function tokenSim(a, b) {
  if (a === b) return 1;
  const ka = phoneticKey(a);
  const kb = phoneticKey(b);
  if (ka && ka === kb && ka.length >= 3) return 0.92;
  const d = dice(a, b);
  return d >= 0.6 ? d : 0;
}

/**
 * The dictated sentence, reduced to what survives being said out loud in a car.
 *
 * Returns the tokens, the original words with their offsets (so the rest of the
 * sentence can be handed back exactly as he said it), and whether he declared an
 * answer.
 */
export function normalizeSpoken(text) {
  const src = String(text ?? '');
  const words = [];
  const re = /[A-Za-z0-9']+/g;
  let m;
  while ((m = re.exec(src))) words.push({ raw: m[0], norm: m[0].toLowerCase().replace(/'/g, ''), start: m.index });

  let i = 0;
  while (i < words.length && LEADING_FILLER.has(words[i].norm)) i++;
  let declared = false;
  if (i < words.length && DECLARE.has(words[i].norm)) {
    declared = true;
    i++;
    while (i < words.length && DECLARE_TAIL.has(words[i].norm)) i++;
  }
  // A declaration can carry its own filler behind it ("answer to the census one").
  while (i < words.length && LEADING_FILLER.has(words[i].norm)) i++;

  const kept = words.slice(i);
  return { tokens: kept.map((w) => w.norm), words: kept, declared, text: src };
}

/** The rest of the sentence, verbatim, from the nth kept word onwards. */
const restFrom = (n, words, src) => (n < words.length ? src.slice(words[n].start).trim() : '');

/**
 * How well the head of what he said matches one handle.
 *
 * The window is the handle's length plus one, so a stray word in front does not cost
 * the match, and `lastIdx` is where the subject stopped — everything after it is his
 * answer and is kept exactly as dictated.
 */
export function handleScore(spoken, handle) {
  if (!handle.length) return { score: 0, lastIdx: -1 };
  const window = spoken.slice(0, Math.min(spoken.length, handle.length + 1));
  let total = 0;
  let lastIdx = -1;
  for (const h of handle) {
    let best = 0;
    let bi = -1;
    window.forEach((s, i) => {
      const v = tokenSim(s, h);
      if (v > best) { best = v; bi = i; }
    });
    total += best;
    if (best >= 0.6 && bi > lastIdx) lastIdx = bi;
  }
  return { score: total / handle.length, lastIdx };
}

/** A symmetric-enough score between two token lists. Used by the vocabulary checks. */
export const similarity = (a, b) => {
  if (!b.length) return 0;
  let total = 0;
  for (const h of b) {
    let best = 0;
    for (const s of a) best = Math.max(best, tokenSim(s, h));
    total += best;
  }
  return total / b.length;
};

const ambiguous = (reason, candidates = [], extra = {}) => ({ kind: 'ambiguous', reason, candidates, ...extra });

function parseOrdinal(tokens) {
  if (!tokens.length) return null;
  const [a, b] = tokens;
  if (ORDINAL_MARKERS.has(a) && b !== undefined && NUMBER_WORDS[b] !== undefined) {
    return { n: NUMBER_WORDS[b], consumed: 2, said: b };
  }
  if (ORDINAL_WORDS[a] !== undefined) {
    return { n: ORDINAL_WORDS[a], consumed: b === 'one' ? 2 : 1, said: a };
  }
  return null;
}

/**
 * Which decision he named, or why that cannot be said.
 *
 * `{kind}` is one of:
 *   match      exactly one candidate, good enough and clearly ahead. Carries the
 *              decision, the rest of the sentence verbatim, and how it was found.
 *   ambiguous  it fits more than one, or the ordinal cannot be trusted. NO decision.
 *   unsure     it fits one, but not well enough to act on. NO decision.
 *   none       nothing here is about the queue at all.
 */
export function matchSpoken(text, queue, { snapshot, currentFingerprint = null, now = new Date(), maxAgeH = QUEUE_MAX_H } = {}) {
  const n = normalizeSpoken(text);
  const decisions = queue?.decisions ?? [];
  // A handle is matched against what is open NOW; an ordinal against the list he was
  // actually read, which may be older. They are the same object whenever nothing has
  // moved, and when they differ the ordinal is refused rather than resolved.
  const snap = snapshot === undefined ? queue : snapshot;
  const snapDecisions = snap?.decisions ?? [];
  const base = { declared: n.declared, spoken: n.text };

  const ord = parseOrdinal(n.tokens);
  if (ord) {
    if (!snap || !snapDecisions.length) {
      return ambiguous('you named a position, and this machine has no record of a decision queue ever being read to you — '
        + 'so there is no list for "number one" to be a position in', [], base);
    }
    if (currentFingerprint && snap.fingerprint !== currentFingerprint) {
      return ambiguous('the queue has changed since that episode was read to you — a decision was answered or published, '
        + 'so the position you named is no longer the decision it named then', snapDecisions, base);
    }
    const ageH = (now.getTime() - Date.parse(snap.at || 0)) / 3600000;
    if (Number.isFinite(ageH) && ageH > maxAgeH) {
      return ambiguous(`the queue you were read is ${Math.round(ageH)} hours old, past the ${maxAgeH}-hour bar, `
        + 'so a position in it is not safe to resolve', snapDecisions, base);
    }
    if (ord.n > snapDecisions.length) {
      return ambiguous(`you said ${ord.said}, and the queue read to you had only ${snapDecisions.length} `
        + `decision${snapDecisions.length === 1 ? '' : 's'} in it`, snapDecisions, base);
    }
    const decision = snapDecisions[ord.n - 1];
    return { kind: 'match', by: 'ordinal', decision, confidence: 1, rest: restFrom(ord.consumed, n.words, n.text), ...base };
  }

  if (!decisions.length) return { kind: 'none', best: 0, candidates: [], ...base };

  const scored = decisions
    .map((d) => ({ d, ...handleScore(n.tokens, d.words ?? []) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best.score < ANSWER_FLOOR) {
    return { kind: 'none', best: best.score, candidates: [], ...base };
  }

  let near = scored.filter((s) => s.score >= ANSWER_FLOOR && best.score - s.score < MARGIN);
  // A handle the vocabulary already knows it cannot separate is never resolved by
  // score. `allocateHandles` found the collision when the episode was written; this
  // is where that finding is honoured rather than being a comment on a page.
  const collides = (best.d.collidesWith ?? []).filter((id) => decisions.some((d) => d.id === id));
  if (collides.length) {
    const extra = scored.filter((s) => collides.includes(s.d.id) && !near.includes(s));
    near = [...near, ...extra];
  }
  if (near.length > 1) {
    const names = near.map((s) => `"${s.d.handle}"`).join(' and ');
    return ambiguous(`that fits ${near.length} open decisions — ${names} — so it does not say which one you answered`,
      near.map((s) => s.d), { ...base, best: best.score });
  }
  if (best.score < MATCH_FLOOR) {
    return {
      kind: 'unsure',
      reason: `the closest open decision is "${best.d.handle}", and what you said is not close enough to it to be sure`,
      candidates: [best.d],
      best: best.score,
      ...base,
    };
  }
  return {
    kind: 'match',
    by: 'handle',
    decision: best.d,
    confidence: best.score,
    rest: restFrom(best.lastIdx + 1, n.words, n.text),
    ...base,
  };
}

export { spell };
