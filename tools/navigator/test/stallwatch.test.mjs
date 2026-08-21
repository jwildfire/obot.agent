// stallwatch — the parked-session reading (obot.agent#317, under jwildfire/obot.roadmap#212).
//
// WHAT THESE TESTS ARE FOR. This programme shipped nine checks in one week that could not
// fail, so the two cases that matter here are asserted against each other rather than
// separately: a session at a real permission prompt must be reported, and a session whose
// `blocked` is a classifier reading its own prose must NOT be — from the same fixture, in the
// same call. A detector that cannot tell those apart is worse than none, because the second
// one is healthy and the response to the first is to stop it.
//
// The fixtures are the three probes measured in obot.agent#315 (`docs/session-reachability.md`),
// spelled exactly as `claude agents --json` and `~/.claude/jobs/{id}/state.json` produced them:
//
//   A  status=waiting  state=blocked   a real permission prompt, enqueued message never read
//   B  status=idle     state=blocked   prose misread, answered a message in 8ms
//   C  status=busy     state=working   mid-tool, answered 65s later
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { HEADING, STALL_PROMPT_MIN, collectStalls, queueDepth, readAgents, readTail,
         stallBroken, stallDetections, stallSection } from '../stallwatch.mjs';
import { REWAKE_MIN, deliverable, parseWakeLog, readJobs, wakeLine } from '../wake.mjs';
// The real one, never a copy. A punctuation difference between a copy here and the
// expression the page actually runs is invisible in a passing test and fatal on the page.
import { ALARM_RE, parseNavigatorState } from '../../ops-dashboard/lib/navigator.mjs';
import { renderState } from '../sweep.mjs';

const WS = '/Users/jwildfire/Documents/obot2';
const MIN = 60_000;
const NOW = new Date('2026-08-21T21:00:00.000Z');
const ago = (min) => new Date(NOW.getTime() - min * MIN).toISOString();

/** The pending approval W0110 actually sat on for 59 minutes. */
const NEEDS = 'approve Bash: cd /Users/jwildfire/Documents/obot2/obot.agent && node --test tools/navigator/test/*.test.mjs';

const agent = (over = {}) => ({
  pid: 1, id: 'aaaa1111', kind: 'background', cwd: WS,
  sessionId: 'aaaa1111-0000-0000-0000-000000000000',
  name: '👯🤖 W0110 2026-08-21 slug', status: 'waiting', state: 'blocked', ...over,
});

const job = (over = {}) => ({
  id: 'aaaa1111', name: '👯🤖 W0110 2026-08-21 slug', state: 'blocked', tempo: 'blocked',
  detail: '', needs: NEEDS, updatedAt: ago(20), sessionId: 'aaaa1111-0000-0000-0000-000000000000',
  queued: 0, firstTerminalAt: null, cwd: WS, children: [], ...over,
});

const dirs = [];
test.after(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

// ---- 1. the discriminator, which is the whole detector ----------------------

test('a session at a real permission prompt is reported, with its age and its needs verbatim', () => {
  const r = collectStalls({ agents: [agent()], jobs: [job()], ws: WS, now: NOW });
  assert.equal(r.read, true);
  assert.equal(r.stalls.length, 1);
  assert.equal(r.stalls[0].worker, 'W0110', 'named by worker id — "job aaaa1111" is unactionable');
  assert.equal(Math.round(r.stalls[0].ageMin), 20);
  assert.equal(r.stalls[0].needs, NEEDS, 'verbatim: a lead has to answer it without a round trip');
});

test('and a session whose blocked came from its own prose is NOT reported — same call, opposite verdict', () => {
  // Probe B. `state: blocked`, so anything keyed on `state` reports it; `status: idle`, so
  // this does not. It answered a message in 8ms — the response to it is a message, and the
  // response to the one above is to stop it.
  const proseBlocked = agent({ id: 'bbbb2222', status: 'idle', name: '👯🤖 W0111 2026-08-21 slug' });
  const r = collectStalls({
    agents: [agent(), proseBlocked],
    jobs: [job(), job({ id: 'bbbb2222', name: '👯🤖 W0111 2026-08-21 slug', needs: 'a decision from the Navigator' })],
    ws: WS, now: NOW,
  });
  assert.deepEqual(r.stalls.map((s) => s.worker), ['W0110'], 'exactly one of the two is parked');
  assert.deepEqual(r.reachable.map((x) => x.worker), ['W0111'], 'and the other is named as reachable, not dropped');
});

test('a busy session mid-tool is neither parked nor reported as blocked', () => {
  const r = collectStalls({
    agents: [agent({ status: 'busy', state: 'working' })],
    jobs: [job({ state: 'working', tempo: 'active' })], ws: WS, now: NOW,
  });
  assert.equal(r.stalls.length, 0);
  assert.equal(r.reachable.length, 0, 'probe C is ordinary work and belongs in no list here');
});

// ---- 2. the bounds ---------------------------------------------------------

test('a prompt younger than the threshold is not yet a finding, and one past it is', () => {
  const young = collectStalls({ agents: [agent()], jobs: [job({ updatedAt: ago(STALL_PROMPT_MIN - 1) })], ws: WS, now: NOW });
  assert.equal(young.stalls.length, 0);
  const old = collectStalls({ agents: [agent()], jobs: [job({ updatedAt: ago(STALL_PROMPT_MIN + 1) })], ws: WS, now: NOW });
  assert.equal(old.stalls.length, 1);
});

test('the threshold fires far ahead of the wake — that is the reason this exists', () => {
  // The wake's own waiting reading needs WAITING_GRACE_MIN + WAITING_SETTLE_MIN = 15 minutes,
  // ten of grace and five to tell a real prompt from a prose misread. `status` makes that
  // distinction for free, so none of the fifteen is inherited. Three stalls this week ran 67,
  // 81 and 59 minutes.
  assert.ok(STALL_PROMPT_MIN < 15, 'a slower reading than the one it supplements is not a fix');
  assert.ok(STALL_PROMPT_MIN <= 5, 'and it has to fire on the first sweep that can see it');
});

test('an age we cannot measure is not an age below the threshold', () => {
  // The daemon says it is parked and the job record is missing or unreadable. Holding it back
  // for a clock we do not have would be a detector going quiet on a missing field (hub#215).
  const r = collectStalls({ agents: [agent()], jobs: [], ws: WS, now: NOW });
  assert.equal(r.stalls.length, 1);
  assert.equal(r.stalls[0].ageMin, null);
  assert.equal(r.stalls[0].recordRead, false);
  assert.match(stallSection(r), /age unknown, its job record could not be read/);
  assert.match(stallSection(r), /needs: unknown, its job record could not be read/,
    'unreadable is said as unreadable — never as "no pending approval"');
});

test('interactive sessions and other workspaces are not watched', () => {
  const r = collectStalls({
    agents: [
      agent({ id: 'cccc3333', kind: 'interactive', name: 'gbot-c4' }),
      agent({ id: 'dddd4444', cwd: '/Users/jwildfire/Documents/gbot' }),
    ],
    jobs: [], ws: WS, now: NOW,
  });
  assert.equal(r.stalls.length, 0);
  assert.equal(r.watched, 0, 'a person sitting at a prompt can see it; a foreign session is not ours to report');
});

// ---- 3. what the finding has to say ----------------------------------------

test('the finding says it cannot be messaged — a lead who does not know that will try and wait', () => {
  const md = stallSection(collectStalls({ agents: [agent()], jobs: [job()], ws: WS, now: NOW }));
  assert.match(md, /cannot be messaged/);
  assert.match(md, /success/, 'and that the send will claim to have worked');
  assert.match(md, /docs\/session-reachability\.md/, 'with the measurement behind it');
});

test('queued messages are named when there are any and silent when there are none', () => {
  const loud = stallSection(collectStalls({ agents: [agent()], jobs: [job({ queued: 2 })], ws: WS, now: NOW }));
  assert.match(loud, /2 message\(s\) queued and undelivered/);
  assert.match(loud, /die with the session/, 'somebody may be waiting on an answer that will never come');
  const quiet = stallSection(collectStalls({ agents: [agent()], jobs: [job()], ws: WS, now: NOW }));
  assert.doesNotMatch(quiet, /queued and undelivered/, 'nought is the ordinary case and printing it buries the number that matters');
});

// ---- 4. does it reach the page red ------------------------------------------

test('the verdict matches the real ALARM_RE, on a line that is actually alarm-tested', () => {
  const md = stallSection(collectStalls({ agents: [agent()], jobs: [job()], ws: WS, now: NOW }));
  const headline = md.split('\n').find((l) => ALARM_RE.test(l));
  assert.ok(headline, 'the verdict line must match the real ALARM_RE, not a copy of it');
  assert.doesNotMatch(headline, /^-/, 'a bullet is never alarm-tested, however it is spelled (hub#241)');
  assert.match(headline, /^\S/, 'and an indented line arrives as somebody else\'s detail');
});

test('and the page renders it red — the effect, not the regex', () => {
  const md = `# state\n\nswept: ${NOW.toISOString()} · cadence 5m\n\n`
    + stallSection(collectStalls({ agents: [agent()], jobs: [job()], ws: WS, now: NOW }));
  const section = parseNavigatorState(md).sections.find((s) => /Stalled at a prompt/.test(s.title));
  assert.ok(section, 'the section reaches the parser');
  assert.ok(section.items.some((i) => i.alarm), 'something in it renders red');
});

test('a clear reading says so out loud and is not an alarm', () => {
  const md = stallSection(collectStalls({ agents: [agent({ status: 'busy', state: 'working' })], jobs: [job({ state: 'working', tempo: 'active' })], ws: WS, now: NOW }));
  assert.doesNotMatch(md, ALARM_RE, 'nobody is parked, so nothing is red');
  assert.match(md, /stalls: clear/, 'and it still speaks — a detector that only speaks on failure looks the same as a dead one');
  assert.match(md, /1 watched/, 'with what it looked at, so a reading of nothing cannot read as a clean fleet');
});

test('a reading that did not happen is an alarm, never a clear one', () => {
  const unread = collectStalls({ agents: null, jobs: [job()], ws: WS, now: NOW });
  assert.equal(unread.read, false);
  const md = stallSection(unread);
  assert.match(md, ALARM_RE, 'unknown must not be able to render as clear');
  assert.doesNotMatch(md, /stalls: clear/, 'the clean verdict is the one thing it must never print');
  assert.match(md, /Unknown, not clear/, 'and it says which of the two it is');
  assert.match(stallBroken('the daemon is not running'), ALARM_RE);
  assert.ok(md.startsWith(HEADING), 'broken and rendered land in one section, so the page keeps one tab');
});

test('readAgents returns null rather than throwing when the daemon cannot be read', () => {
  assert.equal(readAgents({ run: () => { throw new Error('ENOENT'); } }), null);
  assert.equal(readAgents({ run: () => 'not json' }), null);
  assert.equal(readAgents({ run: () => '{"not":"an array"}' }), null);
});

// ---- 5. delivery: it is pushed, not only published --------------------------

test('a parked session becomes a wake detection the existing channel can carry', () => {
  const d = stallDetections(collectStalls({ agents: [agent()], jobs: [job({ queued: 1 })], ws: WS, now: NOW }), { now: NOW });
  assert.equal(d.length, 1);
  assert.equal(d[0].kind, 'stall');
  assert.equal(d[0].key, 'stall:aaaa1111');
  assert.match(d[0].line, /CANNOT be messaged/);
  assert.match(d[0].line, /queued and undelivered/);
  assert.equal(deliverable(d, [], NOW).deliver.length, 1);
});

test('it nags on its own floor — an open prompt is a condition, not an event', () => {
  const d = stallDetections(collectStalls({ agents: [agent()], jobs: [job()], ws: WS, now: NOW }), { now: NOW });
  const fresh = wakeLine(d[0], new Date(NOW.getTime() - (REWAKE_MIN.stall - 1) * MIN).toISOString());
  assert.equal(deliverable(d, parseWakeLog(fresh), NOW).deliver.length, 0, 'not every five minutes');
  const old = wakeLine(d[0], new Date(NOW.getTime() - (REWAKE_MIN.stall + 1) * MIN).toISOString());
  assert.equal(deliverable(d, parseWakeLog(old), NOW).deliver.length, 1,
    'and it must not go quiet while nobody can reach the session');
});

test('a broken reading delivers nothing rather than a fabricated all-clear', () => {
  assert.deepEqual(stallDetections({ read: false, stalls: [] }, { now: NOW }), []);
});

// ---- 6. the one reader of the job records ----------------------------------

test('readJobs carries the two fields this reading needs, from the record the wake already reads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stallwatch-')); dirs.push(dir);
  mkdirSync(join(dir, 'aaaa1111'));
  writeFileSync(join(dir, 'aaaa1111', 'state.json'), JSON.stringify({
    name: '👯🤖 W0110 2026-08-21 slug', state: 'blocked', tempo: 'blocked', needs: NEEDS,
    updatedAt: ago(20), sessionId: 'aaaa1111-0000-0000-0000-000000000000',
    inFlight: { tasks: 0, queued: 3, kinds: [] },
  }));
  const [j] = readJobs(dir);
  assert.equal(j.queued, 3, 'inFlight.queued — the messages that die with the session');
  assert.equal(j.sessionId, 'aaaa1111-0000-0000-0000-000000000000', 'the fallback join key');
  // And the join itself, on the id, against a record read the way the sweep reads it.
  const r = collectStalls({ agents: [agent()], jobs: readJobs(dir), ws: WS, now: NOW });
  assert.equal(r.stalls[0].queued, 3);
  assert.equal(r.stalls[0].needs, NEEDS);
});

test('a record with no inFlight at all reads as nought queued rather than throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stallwatch-')); dirs.push(dir);
  mkdirSync(join(dir, 'eeee5555'));
  writeFileSync(join(dir, 'eeee5555', 'state.json'), JSON.stringify({ name: '👯🤖 W0110 x', state: 'working' }));
  assert.equal(readJobs(dir)[0].queued, 0);
});

test('the join falls back to sessionId when the agent row carries no job id', () => {
  const r = collectStalls({
    agents: [agent({ id: undefined })],
    jobs: [job()], ws: WS, now: NOW,
  });
  assert.equal(r.stalls.length, 1);
  assert.equal(r.stalls[0].needs, NEEDS, 'the record was found, so the pending approval is not lost');
});

// ---- 7. the queued count, which the obvious field gets wrong -----------------

const qop = (op, at) => JSON.stringify({ type: 'queue-operation', operation: op, timestamp: at });

test('the queue depth comes from the transcript, because the record freezes at the prompt', () => {
  // Measured 2026-08-21 on a real parked probe: message enqueued at 21:48:27.301Z, its job
  // record still read `queued: 0` half a minute later and stayed there, because a session at
  // a prompt publishes no state. Trusting the field alone is a check that cannot fire.
  const j = job({ queued: 0, updatedAt: ago(20), transcript: '/transcript.jsonl' });
  const depth = queueDepth(j, { now: NOW, read: () => [qop('enqueue', ago(5)), qop('enqueue', ago(2))].join('\n') });
  assert.equal(depth, 2, 'both messages are sitting there unread');
});

test('messages read before the prompt opened are not counted, and delivered ones subtract', () => {
  const j = job({ queued: 0, updatedAt: ago(20), transcript: '/transcript.jsonl' });
  const lines = [qop('enqueue', ago(90)), qop('dequeue', ago(89)), qop('enqueue', ago(4)), qop('remove', ago(3))];
  assert.equal(queueDepth(j, { now: NOW, read: () => lines.join('\n') }), 0,
    'nothing is waiting: the old pair predates the prompt and the new one was removed');
});

test('the record is a floor the transcript can never argue down', () => {
  const j = job({ queued: 3, updatedAt: ago(20), transcript: '/transcript.jsonl' });
  assert.equal(queueDepth(j, { now: NOW, read: () => qop('dequeue', ago(1)) }), 3);
});

test('an unreadable or absent transcript costs the count, never the reading', () => {
  const j = job({ queued: 1, updatedAt: ago(20), transcript: '/transcript.jsonl' });
  assert.equal(queueDepth(j, { now: NOW, read: () => { throw new Error('ENOENT'); } }), 1);
  assert.equal(queueDepth(job({ queued: 2, transcript: null }), { now: NOW }), 2);
  assert.equal(queueDepth({}, { now: NOW }), 0, 'a record with nothing in it is not a throw');
  assert.throws(() => readTail('/no/such/transcript.jsonl'), 'and the reader itself does not swallow it');
});

test('a torn line in the tail is skipped rather than taking the count with it', () => {
  const j = job({ queued: 0, updatedAt: ago(20), transcript: '/transcript.jsonl' });
  const lines = ['ration","timestamp":"cut-first-line', qop('enqueue', ago(2))];
  assert.equal(queueDepth(j, { now: NOW, read: () => lines.join('\n') }), 1);
});

test('the section and the wake line both carry a depth the record did not know about', () => {
  const jobs = [job({ queued: 0, updatedAt: ago(20), transcript: '/transcript.jsonl' })];
  const depth = () => 2;
  const r = collectStalls({ agents: [agent()], jobs, ws: WS, now: NOW, depth });
  assert.match(stallSection(r), /2 message\(s\) queued and undelivered/);
  assert.match(stallDetections(r, { now: NOW })[0].line, /2 message\(s\) queued and undelivered/);
});

test('the daemon\'s own word for the wait is repeated when it is not a permission prompt', () => {
  // Every row measured on this machine carries `waitingFor: "permission prompt"`, which is
  // what the headline asserts. The day one does not, the headline must not be able to assert
  // it anyway — a detector whose verdict can outlive its evidence is worse than a quiet one.
  const ordinary = collectStalls({ agents: [agent({ waitingFor: 'permission prompt' })], jobs: [job()], ws: WS, now: NOW });
  assert.doesNotMatch(stallSection(ordinary), /the daemon calls this wait/);
  const novel = collectStalls({ agents: [agent({ waitingFor: 'a thing nobody has seen' })], jobs: [job()], ws: WS, now: NOW });
  assert.match(stallSection(novel), /the daemon calls this wait "a thing nobody has seen"/);
  assert.match(stallSection(novel), /may not be one/);
});

// ---- 8. the wiring, so the reading cannot be built and then never rendered ----

const META = { sweptAt: '2026-08-21 21:51', cadenceMin: 5, repoCount: 7, ok: true, errors: [] };

test('the state file carries the section, above the wake', () => {
  const stalls = stallSection(collectStalls({ agents: [agent()], jobs: [job()], ws: WS, now: NOW }));
  const md = renderState({ snapshot: {}, events: [], meta: META, stalls, wake: '## Wake — workers that stopped\n\nwake: clear\n' });
  assert.ok(md.indexOf(HEADING) > -1, 'the section reaches the file at all');
  assert.ok(md.indexOf(HEADING) < md.indexOf('## Wake'), 'and above the wake: a session stuck NOW outranks one waiting to be judged');
  assert.match(md, /W0113|W0110/, 'with the parked worker named');
});

test('a sweep that produced no stall reading says so loudly rather than dropping the section', () => {
  // The failure mode this whole programme keeps repeating: a section that vanishes reads as a
  // machine with nothing to report. `#311` was a check with no caller; this is the same shape
  // one layer down, and the guard is that the absent case is alarmed rather than silent.
  const md = renderState({ snapshot: {}, events: [], meta: META, stalls: null });
  assert.match(md, /STALL READING BROKEN/);
  const section = parseNavigatorState(md).sections.find((x) => /Stalled at a prompt/.test(x.title));
  assert.ok(section?.items.some((i) => i.alarm), 'and it renders red on his page');
});
