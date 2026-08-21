// The property jwildfire/obot.roadmap#267 asks for, stated as tests: the judge can see the
// constraints it is judging against, and a worker can see who is beside it.
//
// The fixtures in REAL_VERDICTS and REAL_CLAIMS are TRANSCRIBED FROM THIS MACHINE'S OWN
// RECORDS — `.claude/session-hub/delivery.md` and `.claude/workers.journal`, both on
// 2026-08-18 — rather than invented. That is deliberate and it is the discipline W0015
// established: a detector tested only against fixtures its author wrote is a detector that
// agrees with its author. These are the lines that were actually wrong.
//
// Every test is named after the failure it forbids.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ALARM_RE, parseNavigatorState } from '../../ops-dashboard/lib/navigator.mjs';
import {
  ConstraintRefused, HEDGE_RE, OBJECTION_RE,
  addConstraint, auditConstraints, inForce, journalPath, lastCited, readConstraints, recordPath, renderLine,
} from '../../lib/constraints.mjs';
import { adjacentWorkers, dispatchOverlap, requirementsOf } from '../../lib/dispatch.mjs';
import {
  ALARM_COVERAGE, ALARM_HALF, ALARM_OVERLAP, ALARM_READING, ALARM_UNCITED,
  collectConstraints, constraintsSection,
} from '../constraints.mjs';
import { renderState } from '../sweep.mjs';

const NOW = new Date('2026-08-21T04:00:00Z');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** His words, exactly as the withdrawal `n0220` quotes them. */
const SAID = '5 minutes or less is the guideline';
const EXCEPTION = 'though you can go over on critical items';

/**
 * Five real lines from `.claude/session-hub/delivery.md`, 2026-08-18, unedited except for
 * truncation of the tail. Four verdicts objecting to a number of his, and one call doing
 * the same against a different bound. All four verdicts were withdrawn by `n0220`.
 */
const REAL_VERDICTS = [
  '- 2026-08-18 06:20 W0065 · produced ep1-project-so-far.txt, 1543 words (~10 min TTS) — audio episode script · requirement hub#242 · none · not my dispatch; ~10 min against his stated "5 minute max" — querying prime rather than assuming the bound applies',
  '- 2026-08-18 06:20 W0066 · produced ep2 script, 1498 words (~10 min) — audio episode script · requirement hub#242 · none · same as W0065 — length queried with prime, not judged against a constraint that may not apply',
  '- 2026-08-18 06:36 W0067 · produced D0019 audio script revised, self-reported 7 min · requirement hub#242 · none · prime dispatch, no GitHub artifact; 7 min against his stated 5-minute max',
  '- 2026-08-18 06:36 W0068 · produced D0020 audio script, 759 words, 5.0 min — the only one of three inside his stated bound · requirement hub#242 · none · meets the 5-minute max exactly, so the bound is achievable',
  '- 2026-08-18 06:36 W0069 · produced D0021 audio script, 1018 words, 6.8 min · requirement hub#242 · none · 6.8 min against his 5-minute max; carries the correction that matters most',
  '- 2026-08-20 18:09 n0269 · call n0269 · finding · the on-deck bench is down to TWO open (238, 282) against his standing ask for at least ten maintained, while top10 holds nine',
].join('\n');

/**
 * The two claims behind the collision the Navigator recorded as `n0233`, copied from
 * `.claude/workers.journal`. Note what they carry: a slug, and nothing else. No task, no
 * requirement. That is why nothing could have detected the overlap on the night.
 */
const REAL_CLAIMS = [
  { ts: '2026-08-18T07:29:32-04:00', op: 'claim', id: 'W0071', actor: 'session:b510658b', slug: 'd0021fix' },
  { ts: '2026-08-18T07:30:27-04:00', op: 'claim', id: 'W0072', actor: 'session:b510658b', slug: 'claimcurrency' },
];

function ws({ claims = [], delivery = '' } = {}) {
  const dir = tmp('constraints-');
  fs.mkdirSync(path.join(dir, '.claude', 'session-hub'), { recursive: true });
  if (claims.length) {
    fs.writeFileSync(path.join(dir, '.claude', 'workers.journal'), `${claims.map((c) => JSON.stringify(c)).join('\n')}\n`);
  }
  if (delivery) fs.writeFileSync(path.join(dir, '.claude', 'session-hub', 'delivery.md'), delivery);
  return dir;
}

/** A jobs ledger where the named workers are still running. */
function jobsWith(ids, { terminal = [] } = {}) {
  const dir = tmp('constraints-jobs-');
  for (const id of [...ids, ...terminal]) {
    const jd = path.join(dir, `job-${id}`);
    fs.mkdirSync(jd, { recursive: true });
    fs.writeFileSync(path.join(jd, 'state.json'), JSON.stringify({
      name: `👯🤖 ${id} 2026-08-18 slug`, state: terminal.includes(id) ? 'done' : 'working',
      startedAt: '2026-08-18T11:29:32Z',
      ...(terminal.includes(id) ? { firstTerminalAt: '2026-08-18T12:00:00Z' } : {}),
    }));
  }
  return dir;
}

// ---------------------------------------------------------------- the record

test('a bound and its exception cannot be separated: the hedged half alone is refused', () => {
  const dir = ws();
  assert.throws(
    () => addConstraint(dir, { said: `${SAID}, ${EXCEPTION}`, scope: 'hub#242' }),
    ConstraintRefused,
    'the sentence that produced two wrong verdicts must not be recordable as half of itself',
  );
  // And the record stays empty: a refused write leaves nothing behind.
  assert.equal(readConstraints(dir).armed, false);
});

test('recorded whole, the exception travels on the same line as the bound', () => {
  const dir = ws();
  const rec = addConstraint(dir, { said: SAID, exception: EXCEPTION, scope: 'hub#242', kind: 'bound', heard: 'chat', on: '2026-08-18' });
  assert.equal(rec.id, 'K0001');
  const line = renderLine(rec);
  assert.match(line, /5 minutes or less/);
  assert.match(line, /go over on critical items/, 'the half that made the objection wrong is on the same line');
  assert.match(fs.readFileSync(recordPath(dir), 'utf8'), /K0001/);
  assert.match(fs.readFileSync(journalPath(dir), 'utf8'), /"id":"K0001"/);
});

test('only a bound, a grant or a forbid is writable — his conversation is not an input', () => {
  const dir = ws();
  assert.throws(() => addConstraint(dir, { said: 'that seems easier than a Siri link', kind: 'remark' }), ConstraintRefused);
  assert.throws(() => addConstraint(dir, { said: '   ' }), ConstraintRefused, 'a paraphrase with no words is not a constraint');
});

test('an unwritten record reads as unwritten, never as clean', () => {
  const dir = ws();
  const c = readConstraints(dir);
  assert.equal(c.read, true);
  assert.equal(c.armed, false);
  const md = constraintsSection(collectConstraints({ ws: dir, jobs: jobsWith([]), now: NOW }));
  assert.doesNotMatch(md, ALARM_RE, 'nothing has gone wrong yet — this is not an alarm');
  assert.match(md, /every judgment made today is made against bounds nobody wrote down/);
});

test('a record that exists and cannot be read is never rendered as an empty one', () => {
  const dir = ws();
  addConstraint(dir, { said: SAID, exception: EXCEPTION, scope: 'hub#242' });
  fs.chmodSync(journalPath(dir), 0o000);
  const c = readConstraints(dir);
  try {
    if (c.read) return; // running as a user that can read anything (root in CI): nothing to assert
    assert.equal(c.constraints.length, 0);
    const md = constraintsSection({ constraints: c, audit: auditConstraints({ read: false }), dispatch: { read: true, groups: [], coverage: { inFlight: 0, placed: 0 } } });
    assert.match(md.split('\n').find((l) => ALARM_RE.test(l)) ?? '', /^\S/, 'the alarm is on a plain unindented line, which is the only kind parseNavigatorState tests');
    assert.match(md, /Unknown, not clean/);
  } finally { fs.chmodSync(journalPath(dir), 0o600); }
});

test('scope binds by exact match or prefix, and a global constraint binds everything', () => {
  const dir = ws();
  addConstraint(dir, { said: SAID, exception: EXCEPTION, scope: 'hub#242' });
  addConstraint(dir, { said: 'never delete anything without approval', scope: '*', kind: 'forbid' });
  const all = readConstraints(dir).constraints;
  assert.deepEqual(inForce(all, 'hub#242').map((c) => c.id), ['K0001', 'K0002']);
  assert.deepEqual(inForce(all, 'hub#267').map((c) => c.id), ['K0002'], 'a bound on one requirement does not silently bind another');
});

// ---------------------------------------------------------------- the judging

test('THE REAL CASE: the four withdrawn audio verdicts are caught as judging against an unrecorded bound', () => {
  const a = auditConstraints({ constraints: [], deliveryText: REAL_VERDICTS, since: '2026-08-18' });
  const flagged = a.uncited.map((u) => u.who);
  assert.deepEqual(flagged, ['W0065', 'W0067', 'W0068', 'W0069', 'n0269'],
    'the four verdicts n0220 withdrew, plus the call that judged the bench against his standing ask');
  assert.ok(!flagged.includes('W0066'),
    'W0066 queried the bound instead of judging against it — asking is not objecting, and a detector that cannot tell them apart teaches the judge to stop asking too');
});

test('THE DONE-WHEN: with the sentence recorded and cited, the same verdict is not a finding', () => {
  const dir = ws();
  const rec = addConstraint(dir, { said: SAID, exception: EXCEPTION, scope: 'hub#242', on: '2026-08-18' });
  const cited = REAL_VERDICTS.split('\n').map((l) => (OBJECTION_RE.test(l) ? `${l} · against ${rec.id}` : l)).join('\n');
  const a = auditConstraints({ constraints: readConstraints(dir).constraints, deliveryText: cited, since: '2026-08-18' });
  assert.equal(a.uncited.length, 0);
  assert.equal(a.unresolved.length, 0);
  // And the citation resolves to the WHOLE sentence, which is the thing that would have
  // changed the verdict: the judge reads the exception at the moment it objects.
  const resolved = readConstraints(dir).constraints.find((c) => c.id === rec.id);
  assert.match(renderLine(resolved), /go over on critical items/);
});

test('declining to cite is loud: --against none clears the finding and stays on the line', () => {
  const line = '- 2026-08-18 06:36 W0067 · produced x · requirement hub#242 · none · against none · 7 min against his stated 5-minute max';
  const a = auditConstraints({ constraints: [], deliveryText: line, since: '2026-08-18' });
  assert.equal(a.uncited.length, 0, 'a judge that says out loud that nothing backs this is not the silent judge');
  assert.match(line, /against none/);
});

test('a citation that does not resolve is a finding, because it reads as checked', () => {
  const a = auditConstraints({
    constraints: [{ id: 'K0001', on: '2026-08-18', said: SAID, exception: EXCEPTION }],
    deliveryText: '- 2026-08-18 06:36 W0067 · produced x · requirement hub#242 · none · against K0009 · over his 5-minute max',
    since: '2026-08-18',
  });
  assert.equal(a.unresolved.length, 1);
  assert.equal(a.unresolved[0].id, 'K0009');
});

test('a hand-edited half constraint is caught even though the tool refuses to write one', () => {
  const a = auditConstraints({
    constraints: [{ id: 'K0001', on: '2026-08-18', said: `${SAID}, ${EXCEPTION}`, exception: null }],
    deliveryText: '',
  });
  assert.equal(a.half.length, 1);
  assert.match(HEDGE_RE.source, /though/);
});

test('the check can only speak about judgments made after the record existed', () => {
  const a = auditConstraints({
    constraints: [{ id: 'K0001', on: '2026-08-20', said: SAID, exception: EXCEPTION }],
    deliveryText: REAL_VERDICTS,
  });
  assert.equal(a.uncited.filter((u) => u.day === '2026-08-18').length, 0,
    'a pending list that can only grow gets ignored and then retired — the Navigator said so itself in n0072');
  assert.equal(a.uncited.length, 1, 'the 08-20 call is inside the window and stays');
});

test('the window opens when the record was armed, not on the day he said the thing', () => {
  // K0002 in the real record is from 2026-08-04, five days before any of this existed.
  // Defaulting the window to a constraint's own date would make every judgment ever
  // written a finding on the first sweep — a list that can only grow, which is the shape
  // of every check this programme has had to retire.
  const a = auditConstraints({
    constraints: [{ id: 'K0002', on: '2026-08-04', ts: '2026-08-21T03:00:00Z', said: 'i really don\'t want you to prompt me to enter worktrees' }],
    deliveryText: REAL_VERDICTS,
  });
  assert.equal(a.epoch, '2026-08-21');
  assert.equal(a.uncited.length, 0, 'nothing written before the mechanism existed is judged by it');
});

test('last cited is reported and alarms about nothing — it is the only symptom a silent judge has', () => {
  const dir = ws();
  addConstraint(dir, { said: SAID, exception: EXCEPTION, scope: 'hub#242', on: '2026-08-18' });
  const c = readConstraints(dir).constraints;
  assert.deepEqual(lastCited(c, ''), { K0001: null });
  assert.deepEqual(lastCited(c, '- 2026-08-19 06:36 W0067 · x · against K0001'), { K0001: '2026-08-19' });
  const md = constraintsSection(collectConstraints({ ws: dir, jobs: jobsWith([]), now: NOW }));
  assert.match(md, /last cited never/);
  assert.doesNotMatch(md, ALARM_RE, 'an uncited constraint is not an alarm; it is a reading');
});

// ---------------------------------------------------------------- the dispatch

test('THE REAL COLLISION: as it was recorded on the night, nothing could see it — and the section says so', () => {
  const dir = ws({ claims: REAL_CLAIMS });
  const jobs = jobsWith(['W0071', 'W0072']);
  const now = new Date('2026-08-18T11:35:00Z');
  const o = dispatchOverlap({ ws: dir, jobs, now });
  assert.deepEqual(o.groups, [], 'neither claim carried a requirement, so there is nothing to group on');
  assert.deepEqual(o.coverage, { inFlight: 2, placed: 0 });
  const md = constraintsSection(collectConstraints({ ws: dir, jobs, now }));
  const alarm = md.split('\n').find((l) => l.includes(ALARM_COVERAGE));
  assert.ok(alarm, 'two workers in flight and nothing placed must not render as "no overlap"');
  assert.match(alarm, /^\S/);
  assert.match(alarm, ALARM_RE);
});

test('with the requirement recorded, the collision is a finding before it happens', () => {
  const claims = REAL_CLAIMS.map((c) => ({ ...c, requirement: 'hub#266' }));
  const dir = ws({ claims });
  const jobs = jobsWith(['W0071', 'W0072']);
  const now = new Date('2026-08-18T11:35:00Z');
  const o = dispatchOverlap({ ws: dir, jobs, now });
  assert.equal(o.groups.length, 1);
  assert.equal(o.groups[0].requirement, 'hub#266');
  assert.deepEqual(o.groups[0].workers.map((w) => w.id).sort(), ['W0071', 'W0072']);
  const md = constraintsSection(collectConstraints({ ws: dir, jobs, now }));
  assert.match(md.split('\n').find((l) => l.includes(ALARM_OVERLAP)) ?? '', ALARM_RE);
});

test('a requirement is read from the task text when the dispatcher did not state one', () => {
  assert.deepEqual(requirementsOf({ task: 'build the currency mechanism for hub#264 and hub#266' }), ['hub#264', 'hub#266']);
  assert.deepEqual(requirementsOf({ requirement: 'obot.roadmap#267' }), ['hub#267'], 'one requirement, one spelling');
  assert.deepEqual(requirementsOf({ task: 'fix #266' }), [],
    'a bare number is not resolvable to a repo, and an overlap finding that is wrong is one the fleet learns to ignore');
});

test('a worker that has stopped is not reported as beside you', () => {
  const dir = ws({ claims: REAL_CLAIMS.map((c) => ({ ...c, requirement: 'hub#266' })) });
  const jobs = jobsWith(['W0072'], { terminal: ['W0071'] });
  const now = new Date('2026-08-18T11:35:00Z');
  const a = adjacentWorkers({ ws: dir, jobs, exclude: 'W0072', now });
  assert.deepEqual(a.workers.map((w) => w.id), []);
  assert.deepEqual(dispatchOverlap({ ws: dir, jobs, now }).groups, []);
});

// ---------------------------------------------- the ledger that is not there yet

test('an absent worker ledger is not a fleet of nobody', () => {
  // The first morning of the new machine. `.claude/workers.journal` is local-only and
  // does not travel, so no clone brings it — and `readClaims` answered ENOENT with an
  // empty claim list, which reached both readers as a measurement. The sweep printed
  // "0 worker(s) in flight, 0 of them placed under a requirement; no two are on the
  // same one", and the sibling briefing every worker opens with printed "Nobody else
  // is in flight right now" (jwildfire/obot.roadmap#223).
  const dir = ws();                          // no journal written at all
  const a = adjacentWorkers({ ws: dir, jobs: jobsWith([]), now: NOW });
  assert.equal(a.absent, true, 'the absence has to survive the join to be sayable');
  assert.deepEqual(a.workers, []);

  const md = constraintsSection(collectConstraints({ ws: dir, jobs: jobsWith([]), now: NOW }));
  assert.doesNotMatch(md, /no two are on the same one/,
    'a verdict on overlap, from a ledger nobody could open');
  assert.doesNotMatch(md, /0 worker\(s\) in flight/, 'a plausible zero from an unread source');
  assert.match(md, /no worker ledger on this machine/i);
  assert.match(md, /worker-id init/, 'a notice that does not say what would fill it is a dead end');
  assert.doesNotMatch(md, ALARM_RE, 'a machine nobody has dispatched on yet is not a fault');
});

test('a journal that exists and holds no live claim still reads as measured', () => {
  // The other side of the same distinction, and the reason this is not just a length
  // check: the ledger is armed, both its claims have stopped, and "no two are on the
  // same one" is then a thing that was actually looked at.
  const dir = ws({ claims: REAL_CLAIMS });
  const jobs = jobsWith([], { terminal: ['W0071', 'W0072'] });
  const a = adjacentWorkers({ ws: dir, jobs, now: new Date('2026-08-18T11:35:00Z') });
  assert.equal(a.absent, false);
  const md = constraintsSection(collectConstraints({ ws: dir, jobs, now: new Date('2026-08-18T11:35:00Z') }));
  assert.match(md, /0 worker\(s\) in flight/);
  assert.match(md, /no two are on the same one/);
});

// ---------------------------------------------------------------- the surface

test('every headline this section can print is one the real ALARM_RE matches, on a line it tests', () => {
  for (const [name, alarm] of Object.entries({ ALARM_READING, ALARM_UNCITED, ALARM_HALF, ALARM_OVERLAP, ALARM_COVERAGE })) {
    assert.match(alarm, ALARM_RE, `${name} would render as ordinary grey text`);
  }
  const dir = ws({ claims: REAL_CLAIMS.map((c) => ({ ...c, requirement: 'hub#266' })), delivery: REAL_VERDICTS });
  addConstraint(dir, { said: SAID, exception: EXCEPTION, scope: 'hub#242', on: '2026-08-18' });
  const md = constraintsSection(collectConstraints({ ws: dir, jobs: jobsWith(['W0071', 'W0072']), now: new Date('2026-08-18T11:35:00Z') }));
  const state = parseNavigatorState(`# navigator-state\n\nswept: x\n\n${md}`);
  const section = state.sections.find((s) => s.title.startsWith('Constraints in force'));
  assert.ok(section, 'the section has to survive the parser the dashboard actually uses');
  assert.ok(section.items.some((i) => i.alarm), 'the findings reach the page as alarms, not as grey rows');
});

test('the section renders every sweep, clean or not', () => {
  const dir = ws();
  addConstraint(dir, { said: SAID, exception: EXCEPTION, scope: 'hub#242', on: '2026-08-18' });
  const md = constraintsSection(collectConstraints({ ws: dir, jobs: jobsWith([]), now: NOW }));
  assert.match(md, /## Constraints in force/);
  assert.match(md, /### Dispatch/);
  assert.doesNotMatch(md, ALARM_RE, 'a section that only appears when something is wrong is indistinguishable from one that stopped running');
});

test('the sweep carries the section, and says so loudly when the pass did not run', () => {
  const meta = { sweptAt: '2026-08-21 04:00', cadenceMin: 5, repoCount: 7, ok: true, errors: [], lastGoodAt: '2026-08-21 04:00' };
  const withIt = renderState({ snapshot: {}, events: [], meta, constraints: '## Constraints in force — his words, where the judging happens\n\n1 constraint(s) recorded\n' });
  assert.match(withIt, /## Constraints in force/);
  // A section that simply vanished would read as a page with nothing to report, which is
  // the house defect this whole file is about.
  const without = renderState({ snapshot: {}, events: [], meta });
  assert.match(without, /## Constraints in force/);
  assert.match(without, ALARM_RE);
  assert.match(without, /Unknown, not clean/);
});

test('the section sits above the queue — his words are read before the judging starts', () => {
  const meta = { sweptAt: '2026-08-21 04:00', cadenceMin: 5, repoCount: 7, ok: true, errors: [], lastGoodAt: '2026-08-21 04:00' };
  const md = renderState({ snapshot: {}, events: [], meta, constraints: '## Constraints in force — his words, where the judging happens\n\nnone\n' });
  assert.ok(md.indexOf('## Constraints in force') < md.indexOf('## RC queue'));
});
