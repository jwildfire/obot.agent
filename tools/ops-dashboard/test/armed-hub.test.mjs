// The whole server, over HTTP, on a machine whose hub clone arms a guard.
//
// Requirement: jwildfire/obot.agent#215, after #206. `fresh-machine.test.mjs` boots
// the real server against a workspace with NO obot.roadmap clone — so `collectDecisions`
// returns on its missing-collector branch, the hub is never imported, and the guard
// never arms. The suite had been exercising the one configuration in which #206 cannot
// happen, which is why 271 green runs said nothing while the page told @jwildfire his
// ten config items did not exist.
//
// So this file supplies the missing half: a machine that HAS a hub clone, and whose
// collector arms a process-wide fs guard on import exactly as the real one does. The
// assertions are the effect over HTTP — the rows on the page — because that is the
// only check that could not have passed while the bug was live.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '..', 'ops-dashboard.mjs');

/** A machine with real state on it, and a hub whose collector arms a guard. */
function armedMachine() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armed-hub-'));
  const home = path.join(root, 'home');
  const ws = path.join(root, 'workspace');
  const hub = path.join(ws, 'obot.roadmap');
  fs.mkdirSync(path.join(home, '.claude', 'jobs'), { recursive: true });
  fs.mkdirSync(path.join(ws, '.claude', 'session-hub', 'cache'), { recursive: true });
  fs.mkdirSync(path.join(hub, 'scripts', 'lib', 'collect'), { recursive: true });

  // Three config items he can see, or cannot.
  fs.writeFileSync(path.join(ws, '.claude', 'blockers.md'), `## Open

- [ ] c0001 filed 2026-08-18 — **Turn the first thing on** — do: click it.
- [ ] c0002 filed 2026-08-18 — **Turn the second thing on** — do: click it too.
- [ ] c0003 filed 2026-08-18 — **Turn the third thing on** — do: and this one.
`);

  // A sweep that ran a minute ago.
  const swept = new Date(Date.now() - 60_000).toISOString().replace('T', ' ').slice(0, 16);
  fs.writeFileSync(path.join(ws, '.claude', 'session-hub', 'navigator-state.md'),
    `# Navigator state\n\nswept: ${swept}\ncadence: 5m\nsummary: ok — 1 repo, 0 RCs\n`);
  fs.writeFileSync(path.join(ws, '.claude', 'session-hub', 'live.html'), '<p>the live session view</p>');

  // The guard, in miniature: installed on import, refuses reads outside its own tree,
  // leaves existsSync and writes alone — the three behaviours that made #206 invisible.
  fs.writeFileSync(path.join(hub, 'scripts', 'lib', 'guard.mjs'), `
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const real = fs.readFileSync;
fs.readFileSync = (p, ...rest) => {
  const abs = typeof p === 'number' ? null : path.resolve(p);
  if (abs && abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
    const e = new Error('local-only guard: ' + abs + ' is outside ' + ROOT);
    e.code = 'ELOCALONLY';
    throw e;
  }
  return real(p, ...rest);
};
`);
  fs.writeFileSync(path.join(hub, 'scripts', 'lib', 'collect', 'decision-log.mjs'), `
import '../guard.mjs';
export async function collectDecisionLog() {
  return { open: [{ id: 'D0001', slug: '2026-08-18-a-decision', title: 'A decision he has not made', date: '2026-08-18' }], folded: [] };
}
`);
  return { root, home, ws, hub };
}

function boot({ home, ws, hub }) {
  const child = spawn(process.execPath, [ENTRY, '--workspace', ws, '--hub', hub, '--serve', '--port', '0'], {
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

let machine;
let server;
const routes = {};

before(async () => {
  machine = armedMachine();
  server = await boot(machine);
  // Twice: the first render is what imports the hub, so anything that only breaks
  // afterwards would pass on a single pass.
  for (const pass of [1, 2]) {
    for (const route of ['/', '/navigator', '/session/frame', '/healthz', '/queue.json']) {
      const res = await fetch(`${server.base}${route}`);
      routes[`${route}#${pass}`] = { status: res.status, body: await res.text() };
    }
  }
});

after(() => {
  server?.child.kill('SIGTERM');
  try { fs.rmSync(machine.root, { recursive: true, force: true }); } catch { /* the OS will */ }
});

test('the decision from the hub is on the page — isolation is not avoidance', () => {
  assert.match(routes['/#1'].body, /A decision he has not made/);
});

for (const pass of [1, 2]) {
  test(`the config list is on the page, render ${pass}`, () => {
    const body = routes[`/#${pass}`].body;
    assert.doesNotMatch(body, /no config file/, 'the file is right there');
    assert.match(body, /Turn the first thing on/);
    assert.match(body, /3 config/, 'three on disk is three in the pill');
  });

  test(`the sweep on disk is the sweep on the page, render ${pass}`, () => {
    const body = routes[`/navigator#${pass}`].body;
    assert.doesNotMatch(body, /No sweep file yet/);
    assert.doesNotMatch(body, /could not be read/);
  });

  test(`the live session view still serves, render ${pass}`, () => {
    assert.equal(routes[`/session/frame#${pass}`].status, 200, 'this answered 500 while #206 was live');
  });

  test(`the server reports its own readers intact, render ${pass}`, () => {
    assert.equal(JSON.parse(routes[`/healthz#${pass}`].body).fs, 'intact');
  });

  test(`the queue JSON carries the config items and says it read them, render ${pass}`, () => {
    const q = JSON.parse(routes[`/queue.json#${pass}`].body);
    assert.equal(q.items.filter((i) => i.kind === 'config').length, 3);
    assert.equal(q.sources.config.read, true);
    assert.equal(q.sources.config.why, null);
    assert.equal(q.sources.decisions.read, true, 'the hub collector ran, in its own process');
  });
}

test('nothing was logged to stderr — a disarmed process announces itself there', () => {
  assert.equal(server.stderr(), '');
});
