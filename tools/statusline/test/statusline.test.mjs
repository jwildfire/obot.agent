import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'statusline.sh');
const HUB_URL = 'https://jwildfire.github.io/obot.roadmap/';
const OSC8 = ']8;;';

/** A workspace whose live view has (or has not) been rendered yet. */
function fakeWorkspace({ live = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obot-statusline-'));
  if (live) {
    fs.mkdirSync(path.join(dir, '.claude', 'session-hub'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'session-hub', 'live.html'), '<html></html>');
  }
  return dir;
}

function payload({ dir, model = 'Opus 5', remaining = 72, sid = 'a1554f0d-1111', cost = 0.42 }) {
  return JSON.stringify({
    model: { display_name: model },
    workspace: { current_dir: dir },
    context_window: { remaining_percentage: remaining },
    session_id: sid,
    cost: { total_cost_usd: cost },
  });
}

function run(input, env = {}) {
  return execFileSync('bash', [SCRIPT], {
    input,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('inside the workspace it links the live session ops hub', () => {
  const ws = fakeWorkspace();
  const out = run(payload({ dir: path.join(ws, 'obot.agent') }), { OBOT_WORKSPACE: ws });
  assert.match(out, /file:\/\/.*\.claude\/session-hub\/live\.html/);
  assert.match(out, /↗ ops hub/);
  assert.ok(out.includes(OSC8), 'emits an OSC 8 hyperlink');
});

test('the workspace root itself counts as inside', () => {
  const ws = fakeWorkspace();
  const out = run(payload({ dir: ws }), { OBOT_WORKSPACE: ws });
  assert.match(out, /↗ ops hub/);
});

test('case differences in the workspace path still match (case-insensitive fs)', () => {
  const ws = fakeWorkspace();
  const out = run(payload({ dir: path.join(ws, 'Documents') }), { OBOT_WORKSPACE: ws.toUpperCase() });
  assert.match(out, /↗ ops hub/);
});

test('outside the workspace it links the deployed obot hub', () => {
  const ws = fakeWorkspace();
  const out = run(payload({ dir: os.homedir() }), { OBOT_WORKSPACE: ws });
  assert.ok(out.includes(HUB_URL), 'links the hub');
  assert.match(out, /↗ obot hub/);
  assert.doesNotMatch(out, /live\.html/);
});

test('a sibling directory that only shares a prefix is outside', () => {
  const ws = fakeWorkspace();
  const out = run(payload({ dir: `${ws}-worktrees/branch` }), { OBOT_WORKSPACE: ws });
  assert.match(out, /↗ obot hub/);
});

test('inside the workspace but with no live view yet falls back to the hub', () => {
  const ws = fakeWorkspace({ live: false });
  const out = run(payload({ dir: ws }), { OBOT_WORKSPACE: ws });
  assert.match(out, /↗ obot hub/);
});

test('text mode prints the bare URL and no escape', () => {
  const ws = fakeWorkspace();
  const out = run(payload({ dir: ws }), { OBOT_WORKSPACE: ws, OBOT_STATUSLINE_LINK: 'text' });
  assert.match(out, /file:\/\/.*live\.html/);
  assert.ok(!out.includes(OSC8), 'no hyperlink escape in text mode');
});

test('off mode drops the segment entirely', () => {
  const ws = fakeWorkspace();
  const out = run(payload({ dir: ws }), { OBOT_WORKSPACE: ws, OBOT_STATUSLINE_LINK: 'off' });
  assert.doesNotMatch(out, /hub/);
  assert.ok(!out.includes(OSC8));
});

test('the link is appended, not substituted for the existing segments', () => {
  const ws = fakeWorkspace();
  const out = run(payload({ dir: ws, model: 'Opus 5', remaining: 72, cost: 0.42 }), { OBOT_WORKSPACE: ws });
  assert.match(out, /\[a1554f0d]/);
  assert.match(out, /Opus 5/);
  assert.match(out, /72% left/);
  assert.match(out, /\$0\.42/);
  assert.equal(out.trimEnd().split('\n').length, 1, 'still a single status line');
});

test('the git branch renders for a repo under $HOME (the ~ display path is not passed to git)', () => {
  const ws = fakeWorkspace();
  execFileSync('git', ['init', '--quiet', '--initial-branch=trunk', ws]);
  const out = run(payload({ dir: ws }), { OBOT_WORKSPACE: ws, HOME: path.dirname(ws) });
  assert.match(out, /\(trunk\)/);
});

test('a malformed payload still renders a line rather than failing', () => {
  const ws = fakeWorkspace();
  const out = run('not json', { OBOT_WORKSPACE: ws });
  assert.ok(out.trim().length > 0);
  assert.match(out, /hub/);
});
