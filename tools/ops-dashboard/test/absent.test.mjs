// The vocabulary of absence, tested for the distinction it exists to hold: a source
// that was read and held nothing is not the same as a source nobody read.
// Requirement: jwildfire/obot.roadmap#223.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MEASUREMENT_BEGINS, UNMEASURED, absentNote, allRead, countPhrase, figure, money,
  moneyFigure, nothingYet, readFailure, source, unread,
} from '../lib/absent.mjs';

test('a notice names what is absent and what would populate it', () => {
  assert.equal(
    nothingYet('No delivery record yet', 'the Navigator writes one when it judges a worker'),
    'No delivery record yet — the Navigator writes one when it judges a worker.',
  );
});

test('a notice with no remedy is still a sentence, not a fragment', () => {
  assert.equal(nothingYet('No delivery record yet'), 'No delivery record yet.');
  assert.equal(nothingYet('No delivery record yet.', ''), 'No delivery record yet.');
});

test('the notice escapes what it is given — a path is not markup', () => {
  const html = absentNote('No sweep file at <b>x</b>', 'run the sweep');
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>/);
});

test('an unread figure is a dash carrying its reason, never a zero', () => {
  const f = moneyFigure(null, { read: false, why: 'no priced usage artifact on this machine' });
  assert.equal(f.text, UNMEASURED);
  assert.equal(f.measured, false);
  assert.match(f.title, /no priced usage artifact/);
  // The point of the whole module: this must not be $0.00.
  assert.notEqual(f.text, '$0.00');
});

test('a measured zero is still a zero — the rule is about unread sources, not about small numbers', () => {
  const f = moneyFigure(0, { read: true });
  assert.equal(f.text, '$0.00');
  assert.equal(f.measured, true);
});

test('a figure whose value is missing is unread even when the caller claims it read', () => {
  // A caller that read the file but found no cell for this row has not measured
  // this row. `read: true` with a null value is that case, and it must not print 0.
  assert.equal(figure(null, { read: true }).text, UNMEASURED);
  assert.equal(figure(undefined, { read: true }).measured, false);
});

test('money formats to cents so a cost never renders as a bare integer', () => {
  assert.equal(money(1234.5), '$1,234.50');
});

test('an unread count says so instead of counting to zero', () => {
  assert.equal(countPhrase(0, { read: false }), 'not read yet');
  assert.equal(countPhrase(0, { read: false, unread: 'the queue could not be collected' }), 'the queue could not be collected');
  assert.equal(countPhrase(0, { read: true, zero: 'all answered' }), 'all answered');
  assert.equal(countPhrase(3, { read: true }), '3');
  // A read source holding nothing may say so cheerfully; an unread one may not.
  assert.notEqual(countPhrase(0, { read: false, zero: 'all answered' }), 'all answered');
});

test('sources record what was read, and name what was not', () => {
  const s = {
    jobs: source('/home/.claude/jobs', { present: false }),
    ledger: source('/ws/.claude/workers.journal', { present: true }),
  };
  assert.equal(allRead(s), false);
  assert.deepEqual(unread(s), ['jobs']);
  assert.equal(allRead({ ledger: s.ledger }), true);
  assert.deepEqual(unread({ ledger: s.ledger }), []);
});

test('the first-morning line says the machine is not broken', () => {
  assert.match(MEASUREMENT_BEGINS, /measurement begins here/);
});

// The complement of the rule above, and the one #206 was filed for: a source that
// could not be read must not be explained as a source that holds nothing.
test('only ENOENT means the file is not there', () => {
  const enoent = Object.assign(new Error('no such file'), { code: 'ENOENT' });
  const f = readFailure(enoent, '/ws/.claude/blockers.md');
  assert.equal(f.absent, true);
  assert.equal(f.code, 'ENOENT');
  assert.match(f.why, /not on this machine/);
});

test('a refusal by a foreign guard is a fault, and says the file is fine', () => {
  const guarded = Object.assign(new Error('local-only guard'), { code: 'ELOCALONLY' });
  const f = readFailure(guarded, '/ws/.claude/blockers.md');
  assert.equal(f.absent, false, 'this is the exact case that was being reported as emptiness');
  assert.match(f.why, /Nothing is wrong with the file/);
});

test('a permission failure names the permission, not the file', () => {
  const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  const f = readFailure(denied, '/ws/.claude/blockers.md');
  assert.equal(f.absent, false);
  assert.match(f.why, /not allowed to open it/);
});

test('an errno nobody has seen yet is still a fault, never an absence', () => {
  const weird = Object.assign(new Error('the disk went away'), { code: 'EIO' });
  const f = readFailure(weird, '/ws/x');
  assert.equal(f.absent, false);
  assert.match(f.why, /\(EIO\)/);
  // And an error with no code at all: unknown is not absent.
  assert.equal(readFailure(new Error('mystery'), '/ws/x').absent, false);
});
