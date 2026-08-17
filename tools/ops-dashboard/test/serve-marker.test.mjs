// The serve marker is a claim on one thing: "this is the machine's dashboard".
// Five times on 2026-08-16 a second instance took that claim from a healthy
// server and then deleted it on the way out (jwildfire/obot.agent#142), so these
// tests are written from the second instance's side — what it must decline to do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import {
  markerPath, readMarker, claimServeMarker, releaseServeMarker, pidAlive,
} from '../lib/serve-marker.mjs';
import { parseArgs } from '../ops-dashboard.mjs';
import { parseArgs as parseHubArgs } from '../../session-hub/session-hub.mjs';

const CLI = new URL('../../serve-marker', import.meta.url).pathname;
const DASHBOARD = new URL('../ops-dashboard.mjs', import.meta.url).pathname;

function workspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-marker-'));
  fs.mkdirSync(path.join(ws, '.claude', 'session-hub'), { recursive: true });
  return ws;
}

/** A pid that is certainly gone: spawned, exited, and reaped before we ask. */
function deadPid() {
  return spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' }).pid;
}

/** A process that is certainly alive and certainly not this one. */
function liveProcess() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
}

const write = (file, marker) => fs.writeFileSync(file, `${JSON.stringify(marker, null, 2)}\n`);

test('a marker is none, stale or live — never silently current', () => {
  const ws = workspace();
  const file = markerPath(ws);

  assert.equal(readMarker(file).state, 'none', 'nothing written yet');

  fs.writeFileSync(file, 'not json\n');
  assert.equal(readMarker(file).state, 'unreadable');

  write(file, { port: 7399, pid: deadPid(), url: 'http://127.0.0.1:7399/live.html' });
  const stale = readMarker(file);
  assert.equal(stale.state, 'stale', 'the owning process is gone');
  assert.equal(stale.port, 7399, 'the contents are still reported, just not as current');

  const child = liveProcess();
  try {
    write(file, { port: 7326, pid: child.pid, url: 'http://127.0.0.1:7326/live.html' });
    const live = readMarker(file);
    assert.equal(live.state, 'live');
    assert.equal(live.pid, child.pid);
    assert.ok(pidAlive(child.pid));
  } finally {
    child.kill();
  }
});

test('an explicit non-default port declines the marker outright', () => {
  const ws = workspace();
  const file = markerPath(ws);

  const declined = claimServeMarker(file, {
    port: 7399, url: 'http://127.0.0.1:7399/live.html', claim: false,
  });
  assert.equal(declined.claimed, false);
  assert.match(declined.reason, /port/i, 'the reason names why, so the log is useful');
  assert.equal(fs.existsSync(file), false, 'declining writes nothing at all');

  // And the flag-level rule that produces `claim: false` in the first place.
  assert.equal(parseArgs([]).claimMarker, true, 'the machine dashboard claims');
  assert.equal(parseArgs(['--serve']).claimMarker, true);
  assert.equal(parseArgs(['--port', '7399']).claimMarker, false, 'a test server does not');
  assert.equal(parseArgs(['--port', '7326']).claimMarker, true, 'the default named out loud still claims');
  assert.equal(parseHubArgs([]).claimMarker, true);
  assert.equal(parseHubArgs(['--port', '7399']).claimMarker, false);
  assert.equal(parseHubArgs(['--port', '7325']).claimMarker, true);
});

test('a live marker owned by another process is left exactly as it was', () => {
  const ws = workspace();
  const file = markerPath(ws);
  const child = liveProcess();
  try {
    write(file, { port: 7326, pid: child.pid, url: 'http://127.0.0.1:7326/live.html', site: 'ops-dashboard' });
    const before = fs.readFileSync(file, 'utf8');

    const declined = claimServeMarker(file, { port: 7327, url: 'http://127.0.0.1:7327/live.html' });
    assert.equal(declined.claimed, false);
    assert.match(declined.reason, new RegExp(String(child.pid)), 'the reason names the holder');
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'byte-identical: nothing was rewritten');
  } finally {
    child.kill();
  }
});

test('a server that did not get the port it asked for is not the dashboard', () => {
  const ws = workspace();
  const file = markerPath(ws);

  // Rolled forward: 7326 was taken by something, so this process is the second one.
  const rolled = claimServeMarker(file, {
    port: 7327, requestedPort: 7326, url: 'http://127.0.0.1:7327/live.html',
  });
  assert.equal(rolled.claimed, false);
  assert.equal(fs.existsSync(file), false);

  // `--port 0` asks for any free port, so the bound port is the one it wanted.
  const any = claimServeMarker(file, {
    port: 51000, requestedPort: 0, url: 'http://127.0.0.1:51000/live.html',
  });
  assert.equal(any.claimed, true);
});

test('a stale marker is claimable, and claiming records this process', () => {
  const ws = workspace();
  const file = markerPath(ws);
  write(file, { port: 7399, pid: deadPid(), url: 'http://127.0.0.1:7399/live.html' });

  const claimed = claimServeMarker(file, {
    port: 7326, requestedPort: 7326, url: 'http://127.0.0.1:7326/live.html', site: 'ops-dashboard',
  });
  assert.equal(claimed.claimed, true);
  const marker = readMarker(file);
  assert.equal(marker.state, 'live');
  assert.equal(marker.pid, process.pid);
  assert.equal(marker.port, 7326);
  assert.equal(marker.site, 'ops-dashboard');
  assert.ok(Date.parse(marker.startedAt) > 0);

  // A corrupt marker is nobody's claim either.
  fs.writeFileSync(file, 'not json\n');
  assert.equal(claimServeMarker(file, { port: 7326, url: 'u' }).claimed, true);
});

test('an instance removes only a marker it owns — same pid and same port', () => {
  const ws = workspace();
  const file = markerPath(ws);

  write(file, { port: 7326, pid: process.pid, url: 'http://127.0.0.1:7326/live.html' });
  assert.equal(releaseServeMarker(file, { port: 7399 }), false, 'our pid, but not our port');
  assert.ok(fs.existsSync(file));

  write(file, { port: 7399, pid: deadPid(), url: 'http://127.0.0.1:7399/live.html' });
  assert.equal(releaseServeMarker(file, { port: 7399 }), false, 'our port, but not our pid');
  assert.ok(fs.existsSync(file));

  write(file, { port: 7399, pid: process.pid, url: 'http://127.0.0.1:7399/live.html' });
  assert.equal(releaseServeMarker(file, { port: 7399 }), true);
  assert.equal(fs.existsSync(file), false);
});

test('the reader tool reports state rather than handing back a dead URL', () => {
  const ws = workspace();
  const file = markerPath(ws);
  const run = (...a) => {
    const r = spawnSync(process.execPath, [CLI, ...a], { env: { ...process.env, OBOT_WORKSPACE: ws }, encoding: 'utf8' });
    return { out: r.stdout.trim(), err: r.stderr.trim(), code: r.status };
  };

  assert.match(run().out, /^state: none/m);
  assert.equal(run('--url').code, 1, 'no URL to hand back');
  assert.equal(run('--url').out, '');

  write(file, { port: 7399, pid: deadPid(), url: 'http://127.0.0.1:7399/live.html' });
  assert.match(run().out, /^state: stale/m);
  assert.equal(run('--url').code, 1, 'a stale marker is not a URL');
  assert.match(run('--json').out, /"state": "stale"/);

  const child = liveProcess();
  try {
    write(file, { port: 7326, pid: child.pid, url: 'http://127.0.0.1:7326/live.html' });
    assert.match(run().out, /^state: live/m);
    assert.equal(run('--url').code, 0);
    assert.equal(run('--url').out, 'http://127.0.0.1:7326/live.html');
  } finally {
    child.kill();
  }
});

// The issue's "done when", run rather than reasoned about: a real second server
// process, started and stopped, with a real first instance's marker in place.
test("a second dashboard process leaves the first instance's marker intact", async () => {
  const ws = workspace();
  const file = markerPath(ws);
  fs.writeFileSync(path.join(ws, '.claude', 'session-hub', 'live.html'), '<p>live</p>');

  const first = liveProcess(); // stands in for @jwildfire's dashboard: alive, holding the marker
  write(file, { port: 7326, pid: first.pid, url: 'http://127.0.0.1:7326/live.html', site: 'ops-dashboard' });
  const before = fs.readFileSync(file, 'utf8');

  const second = spawn(process.execPath, [DASHBOARD, '--serve', '--workspace', ws, '--port', '7399'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    // Wait for the second server to announce itself, so we test after it started.
    const started = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('second instance never started')), 30000);
      let seen = '';
      second.stdout.on('data', (d) => {
        seen += String(d);
        if (seen.includes('http://')) { clearTimeout(timer); resolve(seen); }
      });
    });
    assert.match(started, /7399/, 'the second instance really is serving');
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'its start left the marker alone');
    assert.match(started, /not claiming/i, 'and it said so rather than doing it silently');

    const exited = new Promise((resolve) => second.on('exit', resolve));
    second.kill('SIGTERM');
    await exited;
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'its exit left the marker alone');
  } finally {
    first.kill();
    second.kill();
  }
});
