// THE ACCEPTANCE TEST for jwildfire/obot.roadmap#241 (task obot.agent#277):
//
//   "An answer he clicked which nothing has applied must reach someone."
//
// The evening of 2026-08-16 is the specification, and the whole point of this file is
// that the detection was never what failed. It fired 105 consecutive times over nine
// hours — `navigator-sweep.log` carries every one of them, `3 answers pending` — and
// the finding reached nothing that could act on it. So a test that asserts the
// detector detects would have passed on 16 August, at every single sweep, while three
// of his decisions sat on disk unapplied.
//
// Every test below therefore reads the FAR END: the bytes a listener on the wake
// channel actually received, the parse tree the Navigator tab actually renders from,
// the HTML an HTTP request to his dashboard actually got back. What the producer
// believes it emitted is never the evidence.
//
// The four reasons nothing reached him, each with a test that fails without its fix:
//
//   1. the wake channel had no answer detection at all, and reads job records only
//   2. `**OVERDUE**` is not an alarm word, AND a section bullet is never alarm-tested
//   3. `item.computed` — the critical pin's own documented route — has no producer
//   4. the panel alarm counts `captured` only, so an answer picked up and then
//      dropped, which is exactly this incident, can never reach it
//
// And the negative half everywhere, because a check that cannot go red is not a
// check: a fresh answer must produce no wake, no alarm and no critical row.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  recordAnswer, markDelivered, pendingAnswers, answersSection,
  unappliedDetections, attachUnapplied, OVERDUE_MIN,
} from '../lib/answers.mjs';
import { collectQueue } from '../lib/collect.mjs';
// The real regex, never a copy. A headline that does not match this renders as
// ordinary grey text, which is failure 2 and is what a copy would let back in
// (obot.agent#223).
import { ALARM_RE, parseNavigatorState } from '../lib/navigator.mjs';
import { deliverable, parseWakeLog, wakeLine, REWAKE_MIN } from '../../navigator/wake.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const ENTRY = path.join(HERE, '..', 'ops-dashboard.mjs');
const LISTEN = path.join(REPO, 'tools', 'navigator', 'wake-listen');

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
const tmp = (p = 'answers-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

const children = [];
const dirs = [];
after(() => {
  for (const c of children) { try { c.kill('SIGTERM'); } catch { /* already gone */ } }
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* the OS will */ } }
});

// The three decisions of 2026-08-16, by their real ids and slugs. His words are on
// the records exactly as they were, because half of what this file checks is that
// they never leave the store.
const D0014 = '2026-08-15-scheduled-sessions-readiness';
const D0007 = '2026-08-15-post-session-model';
const HIS_WORDS = 'This doc is a mess. Close it out and re-assess what gaps exist.';

const MIN = 60000;

/** A hub clone with the id registry the answer pipeline joins against. */
function hubWith(artifacts) {
  const hub = tmp('answers-hub-');
  const dir = path.join(hub, 'reports', 'decisions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ prefix: 'D', artifacts }));
  return hub;
}

const REGISTRY = [
  { id: 'D0014', slug: D0014, title: 'Scheduled sessions readiness', questions: [] },
  { id: 'D0007', slug: D0007, title: 'Post-session model', questions: [] },
];

/**
 * The 16 August store, rebuilt: he answers, the sweep announces it minutes later,
 * and then nothing happens for as long as the caller says.
 *
 * `deliveredMinAgo` is deliberately separate from `agoMin`. The Data Requirement
 * turns on exactly that gap — the current clock measures from his click and therefore
 * cannot tell "nobody ever picked this up" from "somebody picked it up and dropped
 * it", which are different failures with different remedies.
 */
function answered(ws, hub, { slug, words = '', verdict = 'words-only', agoMin, deliveredMinAgo = null }) {
  const now = Date.now();
  const at = new Date(now - agoMin * MIN);
  const { record } = recordAnswer(ws, { artifact: slug, verdict, words }, { hub, now: at });
  if (deliveredMinAgo !== null) {
    markDelivered(ws, record.id, {}, new Date(now - deliveredMinAgo * MIN));
  }
  return record;
}

// ---- 1. the condition, and the distinction the current clock cannot make ----

test('an answer picked up and then dropped is told apart from one nobody ever picked up', () => {
  const hub = hubWith(REGISTRY);
  const ws = tmp(); dirs.push(ws, hub);

  // The 16 August case: delivered inside six minutes, unapplied for nearly nine hours.
  answered(ws, hub, { slug: D0014, words: HIS_WORDS, agoMin: 530, deliveredMinAgo: 524 });
  // And the other failure entirely: nothing ever announced it.
  answered(ws, hub, { slug: D0007, verdict: 'adopt-all', agoMin: 120 });

  const found = unappliedDetections(pendingAnswers(ws, { hub }));
  assert.equal(found.length, 2, 'both are unapplied past the bar');

  const dropped = found.find((d) => d.line.includes('D0014'));
  const unclaimed = found.find((d) => d.line.includes('D0007'));
  assert.equal(dropped.condition, 'dropped', 'announced to the fleet, and then nothing');
  assert.equal(unclaimed.condition, 'unclaimed', 'never announced at all');

  // The remedies differ, so the lines have to differ. An operator reading either one
  // must know whether to go looking for an agent or for the deliverer.
  assert.match(dropped.line, /announced/, 'says an agent was told');
  assert.match(unclaimed.line, /never announced|nothing has picked/,
    'says the deliverer is the suspect, not an agent');
});

test('the dropped clock runs from the announcement, not from his click', () => {
  const hub = hubWith(REGISTRY);
  const ws = tmp(); dirs.push(ws, hub);
  // Clicked well past the bar, announced thirty seconds ago. Nobody has dropped
  // anything yet: the agent has had half a minute.
  answered(ws, hub, { slug: D0014, agoMin: 600, deliveredMinAgo: 0.5 });
  assert.deepEqual(unappliedDetections(pendingAnswers(ws, { hub })), [],
    'an answer announced seconds ago is in flight, however long ago he clicked');
});

test('a fresh answer is not a finding — the bar is real', () => {
  const hub = hubWith(REGISTRY);
  const ws = tmp(); dirs.push(ws, hub);
  answered(ws, hub, { slug: D0014, words: HIS_WORDS, agoMin: OVERDUE_MIN - 5 });
  assert.deepEqual(unappliedDetections(pendingAnswers(ws, { hub })), [],
    'inside the hour it is in flight, and calling that a finding trains him to ignore the real one');
});

test('no detection ever carries his words', () => {
  const hub = hubWith(REGISTRY);
  const ws = tmp(); dirs.push(ws, hub);
  answered(ws, hub, { slug: D0014, words: HIS_WORDS, agoMin: 530, deliveredMinAgo: 524 });
  const [d] = unappliedDetections(pendingAnswers(ws, { hub }));
  assert.doesNotMatch(d.line, /This doc is a mess/,
    'these lines flow to the scratchpad and a scratchpad can end up published');
  assert.match(d.line, /D0014/, 'the id and the verdict are what an agent needs');
});

// ---- 2. the wake channel, read off the listener ----

test('the wake channel DELIVERS an unapplied answer to a live listener', async () => {
  const hub = hubWith(REGISTRY);
  const ws = tmp(); dirs.push(ws, hub);
  const log = path.join(ws, '.claude/session-hub/navigator-wake.log');
  const beat = path.join(ws, '.claude/session-hub/cache/navigator-wake.listener');
  fs.mkdirSync(path.dirname(log), { recursive: true });

  const listener = spawn('bash', [LISTEN], {
    env: { ...process.env, OBOT_WORKSPACE: ws, OBOT_WAKE_LOG: log, OBOT_WAKE_BEAT: beat },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(listener);
  let heard = '';
  listener.stdout.on('data', (c) => { heard += c; });
  for (let i = 0; i < 100 && !/armed/.test(heard); i += 1) await wait(50);
  assert.match(heard, /wake channel armed/, 'the listener is up before anything is sent');
  const before = heard;

  answered(ws, hub, { slug: D0014, words: HIS_WORDS, agoMin: 530, deliveredMinAgo: 524 });

  // The sweep's own code path, verbatim: detections in, one appended line out.
  const now = new Date();
  const { deliver } = deliverable(unappliedDetections(pendingAnswers(ws, { hub }), { now }), [], now);
  assert.equal(deliver.length, 1);
  fs.appendFileSync(log, `${wakeLine(deliver[0], now.toISOString())}\n`);

  for (let i = 0; i < 200 && heard === before; i += 1) await wait(50);
  const received = heard.slice(before.length);
  assert.match(received, /D0014/, 'the far end names the decision');
  assert.match(received, /ops-answers apply/, 'and the command that clears it');
  assert.doesNotMatch(received, /This doc is a mess/, 'and never his prose');
});

test('an unapplied answer keeps nagging on a floor — it is a condition, not an event', () => {
  const hub = hubWith(REGISTRY);
  const ws = tmp(); dirs.push(ws, hub);
  answered(ws, hub, { slug: D0014, agoMin: 530, deliveredMinAgo: 524 });
  const now = new Date();
  const found = unappliedDetections(pendingAnswers(ws, { hub }), { now });

  // Inside the floor: held, and the reason is stated.
  const recent = wakeLine(found[0], new Date(now.getTime() - 5 * MIN).toISOString());
  const held = deliverable(found, parseWakeLog(recent), now);
  assert.equal(held.deliver.length, 0);
  assert.match(held.held[0].why, /floor/);

  // Past it: it goes again. A completion would be silenced here for ever, and this
  // is the opposite kind — the condition persists until somebody acts on it, which
  // is the whole reason 16 August lasted nine hours.
  const old = wakeLine(found[0], new Date(now.getTime() - (REWAKE_MIN.unapplied + 5) * MIN).toISOString());
  assert.equal(deliverable(found, parseWakeLog(old), now).deliver.length, 1,
    'it must not go quiet while his answer is still unapplied');
});

// ---- 3. the Navigator's state file, and whether the page can see it ----

test('the answers section carries a headline that ALARM_RE actually matches', () => {
  const hub = hubWith(REGISTRY);
  const ws = tmp(); dirs.push(ws, hub);
  answered(ws, hub, { slug: D0014, words: HIS_WORDS, agoMin: 530, deliveredMinAgo: 524 });

  const md = answersSection(pendingAnswers(ws, { hub }));
  const headline = md.split('\n').find((l) => ALARM_RE.test(l));
  assert.ok(headline, 'an unapplied answer past the bar is an alarm the sweep vocabulary recognises');
  assert.doesNotMatch(headline, /^-/, 'and it is not a bullet — a bullet is never alarm-tested');
  assert.doesNotMatch(md, /This doc is a mess/);
});

test('and the page renders it as an alarm — the effect, not the regex', () => {
  const hub = hubWith(REGISTRY);
  const ws = tmp(); dirs.push(ws, hub);
  answered(ws, hub, { slug: D0014, agoMin: 530, deliveredMinAgo: 524 });

  const state = `# state\n\nswept: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · cadence 5m\n\n`
    + answersSection(pendingAnswers(ws, { hub }));
  const parsed = parseNavigatorState(state);
  const section = parsed.sections.find((s) => /Decision answers/.test(s.title));
  assert.ok(section, 'the section reaches the parser');
  assert.ok(section.items.some((i) => i.alarm),
    'something in it renders red — on 16 August every row was a bullet, so nothing could');
});

test('a clean section says so out loud rather than going silent', () => {
  const hub = hubWith(REGISTRY);
  const ws = tmp(); dirs.push(ws, hub);
  answered(ws, hub, { slug: D0014, agoMin: 10 });
  const md = answersSection(pendingAnswers(ws, { hub }));
  assert.doesNotMatch(md, ALARM_RE, 'nothing is past the bar, so nothing is an alarm');
  assert.match(md, /D0014/, 'the row is still listed — pending is not the same as overdue');
});

// ---- 4. his own page: the critical pin, fetched over HTTP ----

/** A hub clone whose decision collector reports these decisions open. */
function hubClone(open) {
  const hub = hubWith(REGISTRY);
  const lib = path.join(hub, 'scripts', 'lib', 'collect');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'decision-log.mjs'),
    `export async function collectDecisionLog() { return { open: ${JSON.stringify(open)}, folded: [] }; }\n`);
  return hub;
}

const OPEN = [{
  id: 'D0014', slug: D0014, title: 'Scheduled sessions readiness',
  date: '2026-08-15', statusPlain: 'Open', questions: [],
}];

test('an answered-but-unapplied decision pins itself to the top of his critical section', async () => {
  const hub = hubClone(OPEN);
  const ws = tmp(); dirs.push(ws, hub);
  answered(ws, hub, { slug: D0014, words: HIS_WORDS, agoMin: 530, deliveredMinAgo: 524 });

  const queue = await collectQueue(ws, hub);
  assert.equal(queue.critical.length, 1, 'the seam rank.mjs documents for exactly this case is filled');
  assert.match(queue.critical[0].criticalClaim, /answered/,
    'and the claim says why, so he can judge it at a glance');
  assert.equal(queue.decisions.moved, 1, 'the section it came from says one moved up');
});

test('a decision he answered five minutes ago is not critical', async () => {
  const hub = hubClone(OPEN);
  const ws = tmp(); dirs.push(ws, hub);
  answered(ws, hub, { slug: D0014, agoMin: 5 });
  const queue = await collectQueue(ws, hub);
  assert.deepEqual(queue.critical, [], 'a clock decides this, and the clock says it is in flight');
});

test('attachUnapplied never invents a claim for a decision he has not answered', () => {
  const items = [{ kind: 'decision', key: D0014, artifact: D0014 }];
  assert.equal(attachUnapplied(items, [])[0].computed, undefined,
    'there is still no field an agent can write to call its own work important');
});

test('the page he reads says it, and says it without quoting him', async () => {
  const hub = hubClone(OPEN);
  const ws = tmp(); dirs.push(ws, hub);
  answered(ws, hub, { slug: D0014, words: HIS_WORDS, agoMin: 530, deliveredMinAgo: 524 });

  const child = spawn(process.execPath, [ENTRY, '--workspace', ws, '--hub', hub, '--serve', '--port', '0'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let out = ''; let err = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { err += c; });
  let base = null;
  for (let i = 0; i < 600 && !base; i += 1) {
    const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(out);
    if (m) base = `http://127.0.0.1:${m[1]}`; else await wait(50);
  }
  assert.ok(base, `server did not start: ${out}${err}`);

  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /answered, not applied/,
    'the one page he actually reads says his own answer is stuck');
  assert.match(html, /past the hour/i,
    'the panel alarm fires for an answer that was picked up and then dropped, which is this incident');
  assert.doesNotMatch(html, /This doc is a mess/,
    'and his words stay in the store — the page is local, but the rule is the rule');
});
