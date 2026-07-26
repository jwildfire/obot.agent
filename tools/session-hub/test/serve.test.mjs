import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveRequest, listen, serveHub } from '../lib/serve.mjs';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hub-serve-'));
  fs.writeFileSync(path.join(dir, 'live.html'), '<html>live</html>');
  fs.writeFileSync(path.join(dir, 'watch.log'), 'noise');
  return dir;
}

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
