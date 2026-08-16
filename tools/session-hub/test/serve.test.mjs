import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { resolveRequest, listen, serveHub, workspaceFor } from '../lib/serve.mjs';
import { lastSeen } from '../../ops-dashboard/lib/last-seen.mjs';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hub-serve-'));
  fs.writeFileSync(path.join(dir, 'live.html'), '<html>live</html>');
  fs.writeFileSync(path.join(dir, 'watch.log'), 'noise');
  return dir;
}

/** A fixture laid out as a workspace, so the serve seam knows where to record. */
function workspaceFixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hub-ws-'));
  const dir = path.join(workspace, '.claude', 'session-hub');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'live.html'), '<html>live</html>');
  return { workspace, dir };
}

// What Chrome sends when he opens the page, measured against a real browser.
const NAVIGATION = { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' };

// Raw, because `fetch` rewrites `Sec-Fetch-Mode` to `cors` — a test that used it
// would be asking the server a question no browser asks.
const request = (port, pathname, { headers = {}, method = 'GET' } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  });
  req.on('error', reject);
  req.end();
});

test('resolveRequest serves the live view at the root', () => {
  const dir = fixture();
  assert.equal(resolveRequest(dir, '/'), path.join(dir, 'live.html'));
  assert.equal(resolveRequest(dir, '/live.html'), path.join(dir, 'live.html'));
});

test('resolveRequest refuses to escape the directory', () => {
  const dir = fixture();
  for (const url of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/./../../.zshrc']) {
    assert.equal(resolveRequest(dir, url), null, url);
  }
});

test('resolveRequest returns null for missing files and directories', () => {
  const dir = fixture();
  fs.mkdirSync(path.join(dir, 'cache'));
  assert.equal(resolveRequest(dir, '/nope.html'), null);
  assert.equal(resolveRequest(dir, '/cache'), null);
});

test('the server serves the live view over loopback and 404s the rest', async () => {
  const dir = fixture();
  const { server, port, url } = await listen({ dir, port: 0 });
  try {
    assert.equal(server.address().address, '127.0.0.1', 'binds loopback only');
    assert.equal(url, `http://127.0.0.1:${port}/live.html`);

    const ok = await fetch(url);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    assert.equal(await ok.text(), '<html>live</html>');

    const root = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(await root.text(), '<html>live</html>');

    assert.equal((await fetch(`http://127.0.0.1:${port}/nope`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/../../.zshrc`)).status, 404);
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  } finally {
    server.close();
  }
});

test('a taken port rolls forward to the next free one', async () => {
  const dir = fixture();
  const first = await listen({ dir, port: 0 });
  const second = await listen({ dir, port: first.port });
  try {
    assert.equal(second.port, first.port + 1);
  } finally {
    first.server.close();
    second.server.close();
  }
});

test('serveHub advertises the endpoint in serve.json and cleans it up', async () => {
  const dir = fixture();
  const { server, port, cleanup } = await serveHub({ dir, port: 0 });
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(dir, 'serve.json'), 'utf8'));
    assert.equal(marker.port, port);
    assert.equal(marker.pid, process.pid);
    assert.equal(marker.url, `http://127.0.0.1:${port}/live.html`);
    assert.ok(Date.parse(marker.startedAt) > 0);
  } finally {
    server.close();
  }
  cleanup();
  assert.equal(fs.existsSync(path.join(dir, 'serve.json')), false);
});

test('the workspace is derived from the layout, and never invented', () => {
  assert.equal(workspaceFor('/tmp/ws/.claude/session-hub'), '/tmp/ws');
  assert.equal(workspaceFor('/tmp/somewhere-else'), null, 'a scratch dir records nowhere');
});

test('serving a page over the socket records the look, and a poll does not', async () => {
  const { workspace, dir } = workspaceFixture();
  const { server, port } = await listen({ dir, port: 0 });
  const at = (s) => lastSeen(workspace, s);
  try {
    assert.equal(at('/live.html').state, 'first', 'nothing looked at yet');

    // He opens the page. This is the whole feature.
    await request(port, '/live.html', { headers: NAVIGATION });
    const first = at('/live.html');
    assert.equal(first.state, 'seen');
    assert.ok(Date.parse(first.at) > 0);

    // Everything a machine does to the same page, none of which is a look.
    await request(port, '/live.html', { method: 'HEAD', headers: NAVIGATION });
    await request(port, '/live.html');                                   // curl-shaped
    await request(port, '/live.html', { headers: { 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors' } });
    await request(port, '/live.html', { headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate' } });
    await request(port, '/live.html', { headers: { ...NAVIGATION, 'cache-control': 'max-age=0' } });
    assert.equal(at('/live.html').at, first.at, 'no poll moved the timestamp');

    // A 404 is not a surface.
    await request(port, '/nope.html', { headers: NAVIGATION });
    assert.equal(at('/nope.html').state, 'first');

    // `/` and `/live.html` are one page, and a query does not make a second one.
    await new Promise((r) => { setTimeout(r, 5); });
    await request(port, '/?tab=sessions', { headers: NAVIGATION });
    const second = at('/live.html');
    assert.equal(second.state, 'seen');
    assert.ok(Date.parse(second.at) > Date.parse(first.at), 'the second look moved it forward');
    assert.equal(at('/').state, 'first', 'the root is filed as the page it serves');
  } finally {
    server.close();
  }
});

test('a server outside a workspace serves normally and records nothing', async () => {
  const dir = fixture(); // a bare temp dir, not `<ws>/.claude/session-hub`
  const { server, port } = await listen({ dir, port: 0 });
  try {
    assert.equal(await request(port, '/live.html', { headers: NAVIGATION }), 200);
    assert.equal(fs.existsSync(path.join(path.dirname(dir), '.claude')), false);
  } finally {
    server.close();
  }
});
