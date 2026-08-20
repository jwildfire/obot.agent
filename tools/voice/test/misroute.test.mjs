// The misroutes an adversarial review actually reproduced, each as its own test.
//
// jwildfire/obot.roadmap#265 and the review of jwildfire/obot.agent#279. Every case
// below was a real sentence that produced a real record against a decision he was not
// talking about, at confidence 1, on the live queue. They are here rather than in
// match.test.mjs because they are not variations on matching — they are the failure the
// module's own header claims is impossible, and they should be read as a list of what
// that claim has already cost.
import assert from 'node:assert/strict';
import test from 'node:test';

import { allocateHandles } from '../lib/handles.mjs';
import { matchSpoken, normalizeSpoken } from '../lib/match.mjs';

const q = (...slugs) => ({
  at: '2026-08-20T12:00:00.000Z',
  fingerprint: 'fp-test',
  decisions: allocateHandles(slugs.map(([id, slug]) => ({ id, slug, title: `${id} title` }))),
});

const QUEUE = q(
  ['D0019', '2026-08-16-scheduled-sessions-assessment'],
  ['D0022', '2026-08-20-branch-protections'],
);
const opts = { currentFingerprint: 'fp-test', now: new Date('2026-08-20T13:00:00Z') };

test('"No, two weeks is plenty" is a refusal, not a position in a queue', () => {
  // "no" was an ordinal marker, so the most common first word of a dictated answer
  // read as "decision number two" and filed against it at confidence 1.
  const r = matchSpoken('No, two weeks is plenty.', QUEUE, opts);
  assert.notEqual(r.kind, 'match', 'a refusal must never resolve to a queue position');
});

test('"No one has asked for that" is not decision number one', () => {
  const r = matchSpoken('No one has asked for that.', QUEUE, opts);
  assert.notEqual(r.kind, 'match');
});

test('a sentence that names a decision is not overruled by a number in front of it', () => {
  // The ordinal branch returned before the handle scorer ever ran, so this filed
  // against decision one while the sentence names decision two by its published name.
  const r = matchSpoken('Number one priority: leave branch protections alone.', QUEUE, opts);
  assert.notEqual(r.kind, 'match', 'a position and a name that disagree is exactly the ambiguous case');
  if (r.kind === 'ambiguous') assert.match(r.reason, /position|number/i);
});

test('an ordinal and a name that agree still route', () => {
  const r = matchSpoken('number two, branch protections, option A', QUEUE, opts);
  assert.equal(r.kind, 'match');
  assert.equal(r.decision.id, 'D0022');
});

test('a plain ordinal with no name in the sentence still routes', () => {
  const r = matchSpoken('number two, option A', QUEUE, opts);
  assert.equal(r.kind, 'match');
  assert.equal(r.decision.id, 'D0022');
});

test('a handle whose first word is a filler word is still answerable by its own name', () => {
  // LEADING_FILLER and DECLARE are stripped before scoring, and both lists contain
  // words that are plausible first words of a decision's name. "note format" lost the
  // word "note" and could never score above half.
  const two = q(['D0031', '2026-08-05-note-format'], ['D0032', '2026-08-06-plain-text']);
  const o = { ...opts, currentFingerprint: two.fingerprint };
  const r = matchSpoken('note format, and your answer', two, o);
  assert.equal(r.kind, 'match', 'the sentence the script tells him to say must route');
  assert.equal(r.decision.id, 'D0031');
});

test('and it does not hand the sentence to whichever other decision his answer mentions', () => {
  const two = q(['D0031', '2026-08-05-note-format'], ['D0032', '2026-08-06-plain-text']);
  const o = { ...opts, currentFingerprint: two.fingerprint };
  const r = matchSpoken('Note format: plain text, please.', two, o);
  assert.equal(r.decision?.id, 'D0031', 'he named note format; plain text is his answer');
});

test('the same for a handle beginning with a word that declares an answer', () => {
  const two = q(['D0033', '2026-08-05-decision-log'], ['D0032', '2026-08-06-plain-text']);
  const o = { ...opts, currentFingerprint: two.fingerprint };
  const r = matchSpoken('decision log, plain text please', two, o);
  assert.equal(r.decision?.id, 'D0033');
});

test('stripping still works when the filler really is filler', () => {
  assert.deepEqual(normalizeSpoken('obot, branch protections, option A').tokens,
    ['branch', 'protections', 'option', 'a']);
  const r = matchSpoken('obot, branch protections, option A', QUEUE, opts);
  assert.equal(r.kind, 'match');
  assert.equal(r.decision.id, 'D0022');
});

test('a queue longer than ten still answers to a position', () => {
  // NUMBER_WORDS stopped at ten, so "number eleven" parsed as no ordinal at all and the
  // sentence fell through to the idea queue — which posts it to a public board.
  const many = q(...Array.from({ length: 12 }, (_, i) => [`D00${40 + i}`, `2026-08-0${(i % 9) + 1}-decision-number-${i + 1}`]));
  const o = { currentFingerprint: many.fingerprint, now: new Date('2026-08-20T13:00:00Z') };
  const r = matchSpoken('number eleven, option A', many, o);
  assert.equal(r.kind, 'match');
  assert.equal(r.decision.ordinal, 11);
  const d = matchSpoken('number 12, option A', many, o);
  assert.equal(d.decision.ordinal, 12);
});

test('a position past the end of a long queue is still refused, not wrapped', () => {
  const many = q(...Array.from({ length: 12 }, (_, i) => [`D00${40 + i}`, `2026-08-0${(i % 9) + 1}-decision-number-${i + 1}`]));
  const r = matchSpoken('number twenty, option A', many, { currentFingerprint: many.fingerprint, now: new Date('2026-08-20T13:00:00Z') });
  assert.equal(r.kind, 'ambiguous');
});

test('the longer of two names, one a prefix of the other, is answerable by its own name', () => {
  // Both scored 1.0 when he said the longer name, so the pair was permanently
  // ambiguous and the longer decision could never be answered at all.
  const two = q(['D0050', '2026-08-01-census'], ['D0051', '2026-08-02-census-metric']);
  const o = { currentFingerprint: two.fingerprint, now: new Date('2026-08-20T13:00:00Z') };
  const longer = matchSpoken('census metric, keep it weekly', two, o);
  assert.equal(longer.kind, 'match');
  assert.equal(longer.decision.id, 'D0051');
});

test('and the shorter one on its own goes to the decision actually named that', () => {
  // He said the whole of one name and half of the other. Refusing that would make the
  // pair unanswerable in both directions, which is worse than either failure it avoids.
  const two = q(['D0050', '2026-08-01-census'], ['D0051', '2026-08-02-census-metric']);
  const o = { currentFingerprint: two.fingerprint, now: new Date('2026-08-20T13:00:00Z') };
  const r = matchSpoken('census, keep it weekly', two, o);
  assert.equal(r.kind, 'match');
  assert.equal(r.decision.id, 'D0050');
});
