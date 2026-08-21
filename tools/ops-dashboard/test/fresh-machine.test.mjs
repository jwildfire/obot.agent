// Every surface, rendered on a machine with no history.
//
// Requirement: jwildfire/obot.roadmap#223. @jwildfire moves to a dedicated machine
// this week and the empty state is the first thing it will show him. Until now only
// one case had coverage, added by accident when CI — a runner with no
// `~/.claude/jobs` — caught the sessions brief losing its feed and its record link.
// The local suite had passed 271 times because it was resting on this workstation's
// actual job history: the surface was confirming itself with data no fresh machine
// will have.
//
// So this file owns none of the machine's own state. It boots the real server as a
// child process with `HOME` pointed at an empty directory and a workspace that holds
// nothing, and reads the routes over HTTP — the same bytes Chrome would get. Calling
// the render functions with empty arrays would test a different thing: absent and
// empty are different failures and both occur on a fresh machine.
//
// THE CONTRACT, applied to every route:
//   - it answers at all (a 500 or a hang is the loudest possible empty state)
//   - it never prints a figure it did not measure — no `0`, no `$0.00`
//   - it never passes a verdict an unread file cannot support
//   - it says what is absent AND what would populate it
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '..', 'ops-dashboard.mjs');

/**
 * A machine that has never run an agent.
 *
 * Nothing is created but the two empty directories: no `~/.claude/jobs`, no
 * `.claude/` in the workspace, no `obot.agent` clone and so no sweep script, and no
 * `obot.roadmap` clone and so no decision collector and no priced usage artifact.
 */
function freshMachine() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-machine-'));
  const home = path.join(root, 'home');
  const ws = path.join(root, 'workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(ws);
  return { root, home, ws };
}

/** The real server, on a port the OS picks, with a controlled environment. */
function boot({ home, ws }) {
  const child = spawn(process.execPath, [ENTRY, '--workspace', ws, '--hub', path.join(ws, 'obot.roadmap'), '--serve', '--port', '0'], {
    env: { ...process.env, HOME: home, PATH: process.env.PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { err += c; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out}${err}`)), 30000);
    const tick = setInterval(() => {
      const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(out);
      if (!m) return;
      clearInterval(tick); clearTimeout(timer);
      resolve({ child, base: `http://127.0.0.1:${m[1]}`, stderr: () => err });
    }, 50);
    child.on('exit', (code) => { clearInterval(tick); clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}${err}`)); });
  });
}

/** The page as a reader sees it: no style, no script, no markup. */
export function readable(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

// The claims a machine that has read nothing may not make. Each one was on a page
// on 2026-08-17, most of them beside a line admitting the file was never opened.
const FORBIDDEN = [
  [/\$0\.00/, 'a money total summed out of unread files'],
  [/Nothing is waiting on you/i, 'a verdict on a queue that could not be collected'],
  [/All answered/i, 'a verdict on decisions that could not be read'],
  [/Nothing needs your keyboard/i, 'a verdict on a config list that does not exist'],
  [/produced nothing/i, 'a verdict on agents with no delivery record to judge them by'],
  [/No agent has run/i, 'a claim about history made from an absent worker ledger'],
  [/every one delivered/i, 'a verdict with nothing to deliver against'],
  [/no sessions in scope/i, 'a conclusion printed under "could not read"'],
];

// What an honest empty state sounds like. Not a specific sentence — the surfaces
// each say it their own way, by design — but every one of them must say it.
const HONEST = /(not (yet )?(been )?(read|measured|swept|created|written|collected|priced|recorded|judged))|(nothing (has been )?recorded)|(no [a-z .’'-]+ (yet|on this machine))|(has not (been )?(run|written|produced))|(measurement begins here)|(cannot be (read|collected|listed))/i;

function assertHonest(route, body) {
  const text = readable(body);
  for (const [re, why] of FORBIDDEN) {
    assert.doesNotMatch(text, re, `${route} prints ${why}`);
  }
  assert.match(text, HONEST, `${route} does not say what is absent or what would populate it`);
}

let machine;
let server;
const routes = {};

before(async () => {
  machine = freshMachine();
  server = await boot(machine);
  for (const route of ['/', '/live.html', '/session', '/session/log', '/navigator', '/navigator/record', '/session/frame', '/queue.json', '/wire.html', '/config/c0002']) {
    const res = await fetch(`${server.base}${route}`);
    routes[route] = { status: res.status, body: await res.text() };
  }
});

after(() => {
  server?.child.kill('SIGTERM');
  try { fs.rmSync(machine.root, { recursive: true, force: true }); } catch { /* the OS will */ }
});

test('the server starts on a machine with nothing to read', () => {
  assert.equal(server.stderr(), '', 'the server logged to stderr while starting');
});

for (const route of ['/', '/live.html', '/session', '/session/log', '/navigator', '/navigator/record', '/wire.html']) {
  test(`${route} renders honestly with no history at all`, () => {
    const r = routes[route];
    assert.equal(r.status, 200, `${route} answered ${r.status}`);
    assertHonest(route, r.body);
  });
}

test('the queue counts read as unmeasured, not as zero', () => {
  const text = readable(routes['/'].body);
  // The three pills are the first thing on the page and were the three loudest
  // lies on it: three sources that could not be read, rendered as three zeros.
  assert.doesNotMatch(text, /\b0 release candidates\b/);
  assert.doesNotMatch(text, /\b0 decisions\b/);
  assert.doesNotMatch(text, /\b0 config\b/);
  assert.match(text, /— release candidates/);
  assert.match(text, /— decisions/);
  assert.match(text, /— config/);
});

test('the dashboard names each source it could not read, and how to fill it', () => {
  const text = readable(routes['/'].body);
  assert.match(text, /release candidates/i);
  assert.match(text, /obot\.roadmap/, 'the missing hub clone is named');
  assert.match(text, /blockers\.md/, 'the missing config list is named by path');
});

test('a sweep that cannot run does not render as one still running', () => {
  // "Sweeping GitHub…" persisted forever: `refreshing` was true whenever there was
  // no cache, the sweep died with `gh search failed — is gh authenticated?`, the
  // error was swallowed and no cache was ever written. An ellipsis that never
  // resolves is a progress bar for work nobody is doing.
  assert.doesNotMatch(readable(routes['/'].body), /Sweeping GitHub/);
});

test('the machine-readable queue carries the same absence the page shows', () => {
  const q = JSON.parse(routes['/queue.json'].body);
  assert.deepEqual(q.items, []);
  // `{"items": []}` was the whole answer, so any reader of this endpoint was told
  // the queue is empty when the truth is that nothing could be collected.
  assert.ok(q.sources, '/queue.json carries no source provenance');
  for (const key of ['rcs', 'decisions', 'config']) {
    assert.equal(q.sources[key].read, false, `${key} should report itself unread`);
    assert.ok(q.sources[key].why, `${key} should say why it could not be read`);
  }
});

test('the live session view says it has not been built rather than 404-ing blank', () => {
  const r = routes['/session/frame'];
  assert.equal(r.status, 404);
  assert.match(readable(r.body), /session-hub\.mjs --watch/, 'the 404 names the command that creates it');
});

test('the sessions brief keeps its feed and its record link with nothing to show', () => {
  // The one case that already had coverage — kept here because this file is the
  // contract for the whole surface and that regression is the reason it exists.
  //
  // The two halves now sit on two surfaces. #161 made /session (and its alias
  // /live.html) the agents table and moved the feed whole to /session/log, so the
  // feed is absent there for a full roster as much as an empty one — which is not
  // the regression this guards. The invariant is unchanged and still asserted:
  // with nothing to show, the table page keeps the way to the record, and the
  // record page keeps its feed.
  assert.ok(routes['/live.html'].body.includes('/session/log'), 'the record link is gone');
  assert.match(readable(routes['/session/log'].body), /What changed/);
});

test('one config item as a page says the list is absent, not that the item is not on it', () => {
  // `/wire.html` arrived after this file was written and was never in the sweep above;
  // it turned out honest and is asserted with the rest now. This route was not, and
  // answered "c0002 is not an open item on the config list" on a machine that has no
  // config list at all — absence rendered as emptiness, the same sentence shape #206
  // removed from the queue panel one level up (jwildfire/obot.roadmap#223).
  const r = routes['/config/c0002'];
  assert.equal(r.status, 404, 'there is still no such page to serve');
  const text = readable(r.body);
  assert.doesNotMatch(text, /is not an open item/, 'a verdict on a list this machine does not have');
  assert.match(text, /blockers\.md/, 'the missing list is named by path');
  assert.match(text, /blocker-log/, 'and so is what would create it');
});

// ---- day two, and day three ----------------------------------------------
//
// Partial absence is the state the machine is actually in for most of its first
// week, and it is where the same defect keeps reappearing: the file exists, so the
// "was it read" guard passes, and a total is summed over rows that carry no figure.

import { buildRoster, parseWorkers, usageIndex, collectRoster } from '../lib/roster.mjs';
import { rosterHtml } from '../lib/roster-view.mjs';
import { deliveryTablesHtml } from '../lib/log-view.mjs';

const DAY_TWO_NOW = new Date('2026-08-17T10:00:00Z');
const LEDGER = [
  { ts: '2026-08-16T07:00:00Z', op: 'seed', epoch: '2026-08-16T07:00:00Z' },
  { ts: '2026-08-17T08:00:00Z', op: 'claim', id: 'W0001', slug: 'first' },
].map((r) => JSON.stringify(r)).join('\n');
const JOB = {
  job: 'aaa11122', name: '👯🤖 W0001 first', state: 'working', detail: 'day two',
  startedAt: '2026-08-17T08:00:00Z', updatedAt: '2026-08-17T09:55:00Z', tokens: 1234,
  timeline: { last: 'working', closed: false, at: '2026-08-17T09:55:00Z', entries: 4 },
};

test('a usage artifact that holds no cell for any agent is not a spend of zero', () => {
  // The artifact exists — built yesterday, before any of today's agents — so the
  // "did the file open" guard passes and every row still reads "no usage recorded".
  const usage = usageIndex({ generatedAt: '2026-08-16T20:00:00Z', cells: [], totals: {} }, { now: DAY_TWO_NOW });
  const html = rosterHtml(buildRoster({
    workers: parseWorkers(LEDGER), jobs: [JOB], usage, delivery: [], now: DAY_TWO_NOW,
    sources: { usage: { present: true }, delivery: { present: true } },
  }));
  assert.doesNotMatch(html, /\$0\.00/);
  assert.match(html, /holds no figure for any of these agents yet/);
});

test('no agent credited with anything is not "every one delivered"', () => {
  const html = rosterHtml(buildRoster({
    workers: parseWorkers(LEDGER), jobs: [JOB], usage: usageIndex(null), delivery: [],
    now: DAY_TWO_NOW, sources: { delivery: { present: true } },
  }));
  // `delivered === 0` with `nothing === 0` used to fall through to the congratulation.
  assert.doesNotMatch(html, /every one delivered/);
  assert.match(html, /no agent has been credited with anything yet/);
});

test('no standing session is not a standing session that cost nothing', () => {
  const usage = usageIndex({ generatedAt: '2026-08-17T09:00:00Z', cells: [{ label: '👯🤖 W0001 first', cost: 2.5, tokens: 1234 }], totals: { cost: 2.5 } }, { now: DAY_TWO_NOW });
  const html = rosterHtml(buildRoster({
    workers: parseWorkers(LEDGER), jobs: [JOB], usage, delivery: [], now: DAY_TWO_NOW,
    sources: { usage: { present: true }, delivery: { present: true } },
  }));
  assert.match(html, /no standing session on this machine yet/);
});

test('the delivery record is two files, and either one is a reading', () => {
  // The roster reads delivery.md and /session/log renders delivery.journal. Keying
  // "was it read" on the markdown alone let the page say "no delivery record on this
  // machine" two screens above a table built from the journal.
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-partial-'));
  fs.mkdirSync(path.join(ws, '.claude', 'session-hub'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.claude', 'session-hub', 'delivery.journal'), '{"op":"verdict"}\n');
  const model = collectRoster({ workspace: ws, hub: path.join(ws, 'obot.roadmap'), jobsDir: path.join(ws, 'nojobs'), now: DAY_TWO_NOW });
  assert.equal(model.sources.delivery.present, true);
  assert.match(model.sources.delivery.note, /typed journal/);
});

test('one half of the delivery record present is a sentence, not an empty table body', () => {
  const html = deliveryTablesHtml({
    verdicts: [{ at: '2026-08-17T09:00:00Z', worker: 'W0001', produced: 'obot.agent#1 merged', requirement: 'hub#223', verdict: 'confirmed' }],
    calls: [],
  });
  assert.match(html, /No Navigator call recorded yet/);
  assert.doesNotMatch(html, /<tbody>\s*<\/tbody>/, 'a heading over an empty table body is the blank panel');
});

test('an absent visit record is about the machine, not about him', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-seen-'));
  const html = deliveryTablesHtml({ verdicts: [], calls: [] });
  assert.match(html, /the Navigator writes one the first time/);
  assert.ok(fs.existsSync(ws));
});

test('an empty state that names a path still fits the phone he reads it on', () => {
  // An honest notice names the file it could not read and the command that creates
  // it, and both are longer than 390px. Measured in Chrome at a real 390px viewport
  // on 2026-08-17: /navigator rendered 518px wide before this, pushing the sentence
  // off the right edge — which is a new way of not saying it. The classes that carry
  // a path or a command have to be able to break inside a word.
  const has = (css, selector) => new RegExp(`\\${selector}\\b[^{}]*\\{[^}]*overflow-wrap:\\s*anywhere`).test(css);
  assert.ok(has(routes['/navigator'].body, '.nav-empty'), '.nav-empty must wrap — it holds the sweep file path and the install command');
  assert.ok(has(routes['/'].body, '.q-empty'), '.q-empty must wrap — it holds the missing collector path');
  assert.ok(has(routes['/'].body, '.prov'), '.prov must wrap — it holds the hub clone path');
});
