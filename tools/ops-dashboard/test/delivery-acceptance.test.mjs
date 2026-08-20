// THE ACCEPTANCE TEST for jwildfire/obot.roadmap#257, in the words of its scope note:
//
//   "A requirement closed by an agent, with no human in the loop, produces a summary
//    in @jwildfire's language and that summary reaches him — verified by fetching what
//    he actually received, not by an agent asserting it was sent."
//
// So nothing below asserts that something was delivered. Each test goes and FETCHES
// what came out the far end: the bytes a listener on the wake channel actually
// received, and the bytes an HTTP request to his dashboard actually got back.
//
// That distinction is the whole point. This programme's defining defect is an
// operation that reports success while doing nothing — nine instances in one night on
// 2026-08-15/16 — and every one of them would have passed a test that checked an exit
// code. `landing-log closure` exiting 0 proves nothing about whether a person will
// ever see the sentence.
//
// The second trap the requirement names by name is that a check which cannot fail is
// not a check. So the negative halves here are seeded on purpose: a summary that is a
// list of issue numbers must be REFUSED and must therefore be absent from both
// surfaces, and the test would pass vacuously if it only looked for the good sentence.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { completionDetections, closedRequirements, unsummarised } from '../../navigator/closures.mjs';
import { deliverable, parseWakeLog, wakeLine } from '../../navigator/wake.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const ENTRY = path.join(HERE, '..', 'ops-dashboard.mjs');
const LANDING = path.join(REPO, 'tools', 'landing-log');
const LISTEN = path.join(REPO, 'tools', 'navigator', 'wake-listen');

// What an agent closing a requirement with no human in the loop would write, and
// what four workers wrote instead on 2026-08-20.
const SUMMARY = 'When the system says it stopped a runaway agent, it now has to prove the process died.';
const NUMBERS = '#251, #256 and #264 closed';

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const landing = (ws, args) => spawnSync(LANDING, args, {
  env: { ...process.env, OBOT_WORKSPACE: ws, OBOT_ACTOR: 'W0080' }, encoding: 'utf8',
});

const children = [];
const dirs = [];
after(() => {
  for (const c of children) { try { c.kill('SIGTERM'); } catch { /* already gone */ } }
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* the OS will */ } }
});

function boot(ws) {
  const child = spawn(process.execPath, [ENTRY, '--workspace', ws, '--hub', path.join(ws, 'obot.roadmap'), '--serve', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let out = ''; let err = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { err += c; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out}${err}`)), 30000);
    const tick = setInterval(() => {
      const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(out);
      if (!m) return;
      clearInterval(tick); clearTimeout(timer);
      resolve({ child, base: `http://127.0.0.1:${m[1]}` });
    }, 50);
    child.on('exit', (code) => { clearInterval(tick); clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}${err}`)); });
  });
}

// ---- hop 1: the closure is created, with no human anywhere in it ----

test('an agent closing a requirement records a sentence, and a list of numbers is refused', () => {
  const ws = tmp('accept-bar-'); dirs.push(ws);
  const good = landing(ws, ['closure', '--issue', 'hub#257', '--summary', SUMMARY, '--worker', 'W0080']);
  assert.equal(good.status, 0, good.stderr);

  const bad = landing(ws, ['closure', '--issue', 'hub#258', '--summary', NUMBERS, '--worker', 'W0080']);
  assert.equal(bad.status, 1, 'the sentence that failed on 2026-08-20 must not be writable');

  const state = JSON.parse(landing(ws, ['list', '--json']).stdout);
  assert.equal(state.closures.length, 1, 'one recorded, one refused — the bar is not decorative');
  assert.equal(state.closures[0].summary, SUMMARY);
});

// ---- hop 2: it reaches the lead, and this is what the lead actually received ----

test('the wake channel DELIVERS the sentence to a live listener — read off the listener, not the sender', async () => {
  const ws = tmp('accept-wake-'); dirs.push(ws);
  const log = path.join(ws, '.claude/session-hub/navigator-wake.log');
  const beat = path.join(ws, '.claude/session-hub/cache/navigator-wake.listener');
  fs.mkdirSync(path.dirname(log), { recursive: true });

  // The Navigator's ears, exactly as the skill starts them: a persistent Monitor
  // whose every printed line becomes one notification inside that session.
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

  // An agent closes a requirement. Nobody is watching.
  landing(ws, ['closure', '--issue', 'hub#257', '--summary', SUMMARY, '--worker', 'W0080']);
  const state = JSON.parse(landing(ws, ['list', '--json']).stdout);

  // The sweep's own code path, verbatim: detections in, one appended line out.
  const now = new Date();
  const { deliver } = deliverable(completionDetections(state.closures, { now }), [], now);
  assert.equal(deliver.length, 1);
  fs.appendFileSync(log, `${wakeLine(deliver[0], now.toISOString())}\n`);

  // And now the only question that matters: what did the far end actually get?
  for (let i = 0; i < 200 && heard === before; i += 1) await wait(50);
  const received = heard.slice(before.length);
  assert.match(received, /prove the process died/,
    'the lead receives the SENTENCE — this is read off the listener, not off the sender');
  assert.match(received, /hub#257/, 'with the citation trailing it');
  assert.ok(received.indexOf('prove the process died') < received.indexOf('hub#257'),
    'and in that order: the summary is the deliverable, the number is a citation');
});

test('a completion already delivered is not delivered twice — a finish is an event, not a nag', () => {
  const ws = tmp('accept-once-'); dirs.push(ws);
  landing(ws, ['closure', '--issue', 'hub#257', '--summary', SUMMARY]);
  const state = JSON.parse(landing(ws, ['list', '--json']).stdout);
  const now = new Date();
  const detections = completionDetections(state.closures, { now });
  // THREE DAYS ago, deliberately past every re-wake floor there is. An hour would
  // have been caught by the floor alone and the test would have passed with the
  // once-only rule switched off — measured, not assumed.
  const sent = wakeLine(detections[0], new Date(now.getTime() - 3 * 86400000).toISOString());
  const { deliver, held } = deliverable(detections, parseWakeLog(sent), now);
  assert.equal(deliver.length, 0, 'the key is in the log, so it has already reached a person');
  assert.match(held[0].why, /already delivered/);
});

// ---- hop 3: it reaches HIM, fetched over HTTP from his own dashboard ----

test('the summary is on the page he reads — fetched over HTTP, not asserted', async () => {
  const ws = tmp('accept-page-'); dirs.push(ws);
  landing(ws, ['closure', '--issue', 'hub#257', '--summary', SUMMARY, '--worker', 'W0080']);

  const server = await boot(ws);
  const html = await (await fetch(`${server.base}/`)).text();

  assert.match(html, /prove the process died/,
    'the sentence he was owed is in the bytes his browser receives');
  assert.ok(html.indexOf('prove the process died') < html.lastIndexOf('hub#257'),
    'the summary leads and the citation trails, on the page as on the wire');
  assert.doesNotMatch(html, /#251, #256 and #264 closed/);
});

test('a page with nothing recorded does not claim a quiet day — the negative half of the same check', async () => {
  const ws = tmp('accept-empty-'); dirs.push(ws);
  const server = await boot(ws);
  const html = await (await fetch(`${server.base}/`)).text();
  assert.match(html, /Nothing has been written on this machine yet/,
    'an unwritten record and a day with no completions are different facts (hub#223)');
  assert.doesNotMatch(html, /prove the process died/,
    'and the positive assertion above is therefore not passing vacuously');
});

// ---- and the structural half: skipping the sentence is not a quiet way out ----

test('closing a requirement WITHOUT a sentence is a finding — the detector, seeded and fired', () => {
  const ws = tmp('accept-gap-'); dirs.push(ws);
  const now = new Date();
  // What GitHub returns for a requirement an agent closed twenty minutes ago and
  // said nothing about. This is the 2026-08-20 incident, in one object.
  const closedOnGitHub = [{
    repo: 'jwildfire/obot.roadmap', number: 251, kind: 'issue', state: 'CLOSED',
    title: 'Requirement: a kill has to prove the process died',
    closedAt: new Date(now.getTime() - 20 * 60000).toISOString(),
    parent: null, labels: ['requirement'],
  }];
  const recorded = JSON.parse(landing(ws, ['list', '--json']).stdout).closures;
  const missing = unsummarised(closedRequirements(closedOnGitHub, { now }), recorded);
  assert.equal(missing.length, 1, 'a closure with no sentence does not pass quietly');

  // And the same input stops being a finding the moment somebody writes one.
  landing(ws, ['closure', '--issue', 'hub#251', '--summary', SUMMARY]);
  const after = JSON.parse(landing(ws, ['list', '--json']).stdout).closures;
  assert.deepEqual(unsummarised(closedRequirements(closedOnGitHub, { now }), after), [],
    'and it clears — a check that cannot go green is as useless as one that cannot go red');
});
