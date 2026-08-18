// The hub cannot disarm the dashboard.
//
// Requirement: jwildfire/obot.agent#206. The regression this file exists for was not
// a wrong string or a missing null check — it was the hub's public-build guard
// (jwildfire/obot.roadmap#203) arriving down an import graph and replacing this
// process's `node:fs`, after which the page told him his ten open config items did
// not exist.
//
// So the test is the effect, not the wiring: a hub whose collector arms a guard on
// import must not be able to stop the config list being read one line later. The
// fixture hub below is a faithful miniature of the real one — a collector that pulls
// in a module that patches `fs.readFileSync` to refuse everything outside its own
// tree, exactly as the guard does, without needing obot.roadmap to be cloned.
//
// If someone reverts to importing the hub in-process, `collectQueue` here goes back
// to reporting an empty config list and this fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectConfig, collectDecisions, collectQueue } from '../lib/collect.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ops-iso-'));

/** A hub clone whose decision collector arms a local-only guard on import. */
function hubThatArmsAGuard({ open = [{ id: 'D0001', slug: 's', title: 'A decision', date: '2026-08-18' }] } = {}) {
  const hub = tmp();
  const lib = path.join(hub, 'scripts', 'lib', 'collect');
  fs.mkdirSync(lib, { recursive: true });

  // The guard, in miniature: patches the fs singleton on import, refuses reads
  // outside its own repo, leaves existsSync alone — all three the real one's
  // behaviour, and all three load-bearing for how the bug hid.
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
export const armed = true;
`);
  fs.writeFileSync(path.join(lib, 'decision-log.mjs'), `
import '../guard.mjs';
export async function collectDecisionLog() {
  return { open: ${JSON.stringify(open)}, folded: [] };
}
`);
  return hub;
}

/** A workspace with a config list on it. */
function workspaceWithConfig(n = 3) {
  const ws = tmp();
  fs.mkdirSync(path.join(ws, '.claude'), { recursive: true });
  const rows = Array.from({ length: n }, (_, i) =>
    `- [ ] c000${i + 1} filed 2026-08-18 — **Config item ${i + 1}** — do: something only his hands can do.`);
  fs.writeFileSync(path.join(ws, '.claude', 'blockers.md'), `## Open\n\n${rows.join('\n')}\n`);
  return ws;
}

test('the fixture hub really does arm a guard — the test is worth nothing otherwise', async () => {
  const hub = hubThatArmsAGuard();
  const ws = workspaceWithConfig();
  // Proving the fixture bites, in a throwaway process so this one stays clean.
  const { execFileSync } = await import('node:child_process');
  const probe = `
    import fs from 'node:fs';
    await import(${JSON.stringify('file://' + path.join(hub, 'scripts', 'lib', 'collect', 'decision-log.mjs'))});
    try { fs.readFileSync(${JSON.stringify(path.join(ws, '.claude', 'blockers.md'))}, 'utf8'); process.stdout.write('READ'); }
    catch (e) { process.stdout.write(String(e.code)); }
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' });
  assert.equal(out, 'ELOCALONLY', 'the fixture guard must actually refuse a workspace read');
});

test('collecting decisions leaves this process able to read the machine', async () => {
  const hub = hubThatArmsAGuard();
  const ws = workspaceWithConfig(3);

  const decisions = await collectDecisions(hub);
  assert.equal(decisions.error, undefined, 'the hub collector still runs — isolation is not avoidance');
  assert.equal(decisions.items.length, 1);

  const config = collectConfig(ws);
  assert.equal(config.error, undefined, `the config list must still be readable, got: ${config.error}`);
  assert.equal(config.items.length, 3);
});

test('the queue carries both buckets at once, in the order he set', async () => {
  const hub = hubThatArmsAGuard();
  const ws = workspaceWithConfig(10);

  const q = await collectQueue(ws, hub);
  assert.equal(q.decisions.items.length, 1);
  assert.equal(q.config.items.length, 10, 'ten on disk is ten on the page');
  assert.equal(q.config.error, undefined);
});

test('a hub collector that throws is reported as a failure, not as no decisions', async () => {
  const hub = tmp();
  const lib = path.join(hub, 'scripts', 'lib', 'collect');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'decision-log.mjs'),
    'export async function collectDecisionLog() { throw new Error("hub is mid-rebase"); }\n');

  const decisions = await collectDecisions(hub);
  assert.deepEqual(decisions.items, []);
  assert.match(decisions.error, /hub is mid-rebase/);
});

test('no module under this tool imports the hub — the wall is structural', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.mjs')) files.push(f);
    }
  };
  walk(root);

  // `hub-collect.mjs` is the one file allowed to name the hub's module path, and it
  // only ever hands it to a child process. Everything else that reaches for the hub
  // tree is the bug coming back.
  const offenders = files
    .filter((f) => path.basename(f) !== 'hub-collect.mjs' && !f.includes(`${path.sep}test${path.sep}`))
    .filter((f) => /import\s*\(/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map((f) => path.relative(root, f)), [],
    'a dynamic import in this tool is how the hub got in last time; run it in a child process instead');
});

// ---------------------------------------------------------------------------
// The second defence: what the page SAYS when a read fails anyway.
// ---------------------------------------------------------------------------
const { render, navigatorShell } = await import('../lib/render.mjs');

const withConfig = (config) => render({
  queue: { rcs: { items: [], refreshing: false }, decisions: { items: [] }, config, items: [] },
});

test('an unreadable config list is not offered to him as an empty one', () => {
  const html = withConfig({
    items: [], absent: false, code: 'ELOCALONLY',
    error: '/ws/.claude/blockers.md was refused by a local-only guard that has been installed on this process',
  });
  assert.match(html, /The config list could not be read/);
  assert.match(html, /not empty, it is unread/);
  assert.doesNotMatch(html, /No config list on this machine yet/);
  // Colour, not just a hover title: he reads this on a phone, where nothing hovers.
  assert.match(html, /class="q-unread"/);
  assert.doesNotMatch(html, /Nothing needs your keyboard/);
});

test('a genuinely absent config list keeps its first-morning sentence', () => {
  const html = withConfig({ items: [], absent: true, code: 'ENOENT', error: 'no config file' });
  assert.match(html, /No config list on this machine yet/);
  assert.match(html, /blocker-log/);
  assert.doesNotMatch(html, /could not be read/);
});

test('an empty config list that WAS read still says the reassuring thing', () => {
  const html = withConfig({ items: [] });
  assert.match(html, /Nothing needs your keyboard/);
  assert.match(html, /class="q-empty"/);
  assert.doesNotMatch(html, /class="q-unread"/);
});

test('an unreadable sweep file leads with a fault, not with "no sweep yet"', () => {
  const html = navigatorShell({
    unreadable: { absent: false, code: 'ELOCALONLY', why: '/ws/.claude/session-hub/navigator-state.md was refused by a local-only guard' },
  });
  assert.match(html, /The sweep file could not be read/);
  assert.match(html, /class="dead"/);
  assert.doesNotMatch(html, /No sweep file yet/);
});

test('a sweep that has genuinely never run still gets the install instructions', () => {
  const html = navigatorShell({ missing: '/ws/.claude/session-hub/navigator-state.md' });
  assert.match(html, /No sweep file yet/);
  assert.match(html, /install-launchd/);
});
