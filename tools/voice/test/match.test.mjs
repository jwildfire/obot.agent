// Matching a dictated sentence to a decision, and refusing to when it is close.
//
// jwildfire/obot.roadmap#265. The failure that matters here is not the sentence that
// matches nothing — he finds out about that from the receipt. It is the sentence that
// matches two decisions and gets filed against one of them anyway, because nothing
// then looks wrong: the answer store shows an answer, the dashboard shows it
// delivered, an agent applies it, and the decision he was actually answering is still
// open with his words attached to the wrong page.
//
// So AMBIGUOUS is its own outcome with its own tests, and it never returns a decision.
import assert from 'node:assert/strict';
import test from 'node:test';

import { allocateHandles } from '../lib/handles.mjs';
import { MATCH_FLOOR, matchSpoken, normalizeSpoken, similarity } from '../lib/match.mjs';

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

test('dictation is normalised down to what survives a transcription', () => {
  const n = normalizeSpoken('  Branch Protections, option A!  ');
  assert.deepEqual(n.tokens, ['branch', 'protections', 'option', 'a']);
});

test('the wake words Siri leaves on the front are not part of the subject', () => {
  const n = normalizeSpoken('obot, branch protections, option A');
  assert.deepEqual(n.tokens, ['branch', 'protections', 'option', 'a']);
});

test('a clean subject routes, and the rest of the sentence is kept whole', () => {
  const r = matchSpoken('branch protections, option A', QUEUE, opts);
  assert.equal(r.kind, 'match');
  assert.equal(r.decision.id, 'D0022');
  assert.equal(r.rest, 'option A');
  assert.ok(r.confidence >= MATCH_FLOOR);
});

test('a mangled subject still routes — matching is loose, not exact', () => {
  const r = matchSpoken('branch protection option a', QUEUE, opts);
  assert.equal(r.kind, 'match');
  assert.equal(r.decision.id, 'D0022');
});

test('AMBIGUOUS: a subject that fits two decisions returns neither, and names both', () => {
  // The case that will actually happen: two decisions whose names start the same way,
  // and he says the part they share. Both are exactly as good a fit, and picking the
  // higher score would be picking by coin toss.
  const two = q(
    ['D0019', '2026-08-16-scheduled-sessions-assessment'],
    ['D0023', '2026-08-19-scheduled-sessions-readiness'],
  );
  const r = matchSpoken('scheduled sessions, wait for the machine', two, { ...opts, currentFingerprint: two.fingerprint });
  assert.equal(r.kind, 'ambiguous', 'a tie is refused, never resolved by score alone');
  assert.equal(r.decision, undefined, 'an ambiguous match hands back no decision at all');
  assert.deepEqual(r.candidates.map((c) => c.id).sort(), ['D0019', 'D0023']);
  assert.match(r.reason, /which/i);
});

test('the fuller of two names still wins outright when he says all of it', () => {
  // Not everything that shares a prefix is ambiguous. "branch protections" names one
  // of these exactly, and refusing that would train him to distrust the lane.
  const two = q(
    ['D0022', '2026-08-20-branch-protections'],
    ['D0024', '2026-08-21-branch-protection-rules'],
  );
  const r = matchSpoken('branch protections, option A', two, { ...opts, currentFingerprint: two.fingerprint });
  assert.equal(r.kind, 'match');
  assert.equal(r.decision.id, 'D0022');
});

test('a handle that collides phonetically is never routed by handle at all', () => {
  const two = q(
    ['D0022', '2026-08-20-branch-protections'],
    ['D0024', '2026-08-21-branch-protection'],
  );
  const r = matchSpoken('branch protections, option A', two, { ...opts, currentFingerprint: two.fingerprint });
  assert.equal(r.kind, 'ambiguous');
  assert.deepEqual(r.candidates.map((c) => c.id).sort(), ['D0022', 'D0024']);
});

test('a sentence about nothing in the queue matches nothing, and says how far off it was', () => {
  const r = matchSpoken('pick up milk on the way home', QUEUE, opts);
  assert.equal(r.kind, 'none');
  assert.ok(r.best < MATCH_FLOOR);
  assert.equal(r.declared, false);
});

test('saying the word answer declares one, so a miss can never be filed as an idea', () => {
  const r = matchSpoken('answer: buy milk', QUEUE, opts);
  assert.equal(r.kind, 'none');
  assert.equal(r.declared, true);
});

test('an ordinal resolves against the queue he was actually read', () => {
  const r = matchSpoken('number two, option A', QUEUE, opts);
  assert.equal(r.kind, 'match');
  assert.equal(r.decision.id, 'D0022');
  assert.equal(r.by, 'ordinal');
  assert.equal(r.rest, 'option A');
});

test('the second one is the same thing said the way a person says it', () => {
  const r = matchSpoken('the second one, option A', QUEUE, opts);
  assert.equal(r.kind, 'match');
  assert.equal(r.decision.id, 'D0022');
});

test('an ordinal against a queue that has since changed is refused, not guessed', () => {
  const r = matchSpoken('number two, option A', QUEUE, { ...opts, currentFingerprint: 'fp-moved-on' });
  assert.equal(r.kind, 'ambiguous');
  assert.equal(r.decision, undefined);
  assert.match(r.reason, /changed/i);
});

test('an ordinal past the end of the queue is refused rather than clamped', () => {
  const r = matchSpoken('number nine, option A', QUEUE, opts);
  assert.equal(r.kind, 'ambiguous');
  assert.match(r.reason, /nine|9|only/i);
});

test('an ordinal with no queue snapshot at all is refused', () => {
  const r = matchSpoken('number two, option A', null, opts);
  assert.equal(r.kind, 'ambiguous');
  assert.match(r.reason, /queue|episode/i);
});

test('similarity is a number between nothing in common and the same words', () => {
  assert.equal(similarity(['branch', 'protections'], ['branch', 'protections']), 1);
  assert.equal(similarity(['branch', 'protections'], ['buy', 'milk']), 0);
  const partial = similarity(['branch', 'protections'], ['branch', 'rules']);
  assert.ok(partial > 0 && partial < 1);
});
