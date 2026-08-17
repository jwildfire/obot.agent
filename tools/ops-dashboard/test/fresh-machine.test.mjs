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
  for (const route of ['/', '/live.html', '/session', '/session/log', '/navigator', '/navigator/record', '/session/frame', '/queue.json']) {
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

for (const route of ['/', '/live.html', '/session', '/session/log', '/navigator', '/navigator/record']) {
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
  const text = readable(routes['/live.html'].body);
  assert.match(text, /What changed/);
  assert.ok(routes['/live.html'].body.includes('/session/log'), 'the record link is gone');
});
