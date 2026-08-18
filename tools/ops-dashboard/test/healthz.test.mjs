// What the server says when something outside asks whether it is safe to restart.
//
// Requirement jwildfire/obot.roadmap#243: the five-minute sweep fast-forwards the
// checkout and restarts this server when it moves, and it must not do that to a page
// somebody is reading. These two numbers are the whole of that judgement.
//
// The idle test is the one that matters. The probe arrives every five minutes, so a
// health check that counted itself as traffic would reset the idle clock on every
// poll, the server would read as permanently busy, and the restart would never happen
// — a requirement that reports success while doing nothing, which is the exact failure
// mode this whole capability exists to end.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '..', 'ops-dashboard.mjs');

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

function boot(ws, port = '0', extra = []) {
  const child = spawn(process.execPath, [ENTRY, '--workspace', ws, '--hub', path.join(ws, 'obot.roadmap'), '--serve', '--port', String(port), ...extra], {
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
      resolve({ child, port: Number(m[1]), base: `http://127.0.0.1:${m[1]}` });
    }, 50);
    child.on('exit', (code) => { clearInterval(tick); clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}${err}`)); });
  });
}

let ws;
let server;

before(async () => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'healthz-'));
  server = await boot(ws);
});

after(() => {
  server?.child.kill('SIGTERM');
  try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* the OS will */ }
});

const health = async () => (await fetch(`${server.base}/healthz`)).json();

test('the server names the commit it is running and how busy it is', async () => {
  const h = await health();
  assert.equal(h.ok, true);
  assert.equal(h.pid, server.child.pid);
  assert.equal(h.port, server.port);
  assert.equal(h.inflight, 0);
  assert.ok(Number.isFinite(h.idleMs), 'a restarter cannot defer to an idle time that is not a number');
  assert.ok(h.startedAt, 'when this process started is half of "how stale is it"');
});

test('the health probe is not traffic — polling it must not reset the idle clock', async () => {
  await fetch(`${server.base}/`);
  await wait(300);
  const first = await health();
  await wait(300);
  const second = await health();
  assert.ok(first.idleMs >= 250, `idle should have accumulated since the page load, got ${first.idleMs}`);
  assert.ok(second.idleMs > first.idleMs,
    `the idle clock must keep running across probes, got ${first.idleMs} then ${second.idleMs}`);
});

test('a real page load is traffic, and resets it', async () => {
  await wait(250);
  const before_ = await health();
  await fetch(`${server.base}/`);
  const after_ = await health();
  assert.ok(after_.idleMs < before_.idleMs, 'somebody opened the page — the restarter must see that');
});

test('--exclusive refuses a taken port instead of quietly landing on the next one', () => {
  const r = spawnSync(process.execPath, [ENTRY, '--workspace', ws, '--serve', '--exclusive', '--port', String(server.port)], {
    encoding: 'utf8', timeout: 20000,
  });
  assert.equal(r.status, 1, 'it must fail rather than roll forward');
  assert.match(r.stderr, /still held/);
  assert.doesNotMatch(String(r.stdout), new RegExp(`127\\.0\\.0\\.1:${server.port + 1}`),
    'a replacement that lands on the next port is a dashboard nobody can find');
});
