// The live session view, rendered on a machine with no history.
//
// Requirement: jwildfire/obot.roadmap#223. The watch loop reads `~/.claude/jobs`,
// today's scratchpad, the hub clone's diary and a gh sweep. On a new machine all
// four are absent, and the page used to answer with four measured-looking zeros:
// "Priorities 0 open · 0 done", "Agents 0", "Tokens 0 across 0 reporting sessions"
// and "0 events" — with `⚠ jobs directory unreadable (ENOENT)` in a panel below
// saying the number could not have been counted.
//
// This runs the real `generate()` with HOME pointed at an empty directory and an
// empty workspace, so nothing here rests on this workstation's job history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { generate, sessionState } from '../session-hub.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** Run one render as if on a machine that has never run an agent. */
function onFreshMachine(fn) {
  const home = tmp('fresh-hub-home-');
  const ws = tmp('fresh-hub-ws-');
  const realHome = process.env.HOME;
  // `collectJobs` defaults to `os.homedir()/.claude/jobs`, which reads $HOME on
  // POSIX — the only way to exercise the default rather than an injected path, and
  // the default is what runs on his machine.
  process.env.HOME = home;
  try {
    return fn({ home, ws });
  } finally {
    process.env.HOME = realHome;
  }
}

const text = (html) => String(html)
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim();

test('the live view renders with no jobs, no scratchpad and no hub clone', () => {
  const { html } = onFreshMachine(({ ws }) => generate({
    workspace: ws, hub: path.join(ws, 'obot.roadmap'), mode: 'live',
  }));
  assert.match(html, /<!DOCTYPE html>/i);
  const t = text(html);
  // No tile may report a count over a source that was never opened.
  assert.doesNotMatch(html, /<span class="value">0<\/span>/, 'a tile reported zero from an unread source');
  assert.doesNotMatch(t, /0 open · 0 done/, 'the priorities tile counted an absent scratchpad');
  assert.doesNotMatch(t, /across 0 reporting sessions/, 'the tokens tile counted absent job records');
  assert.doesNotMatch(t, /\b0 events\b/, 'the activity header counted an unread sweep');
  assert.doesNotMatch(t, /no sessions in scope/, 'a verdict under "could not read"');
  // And it says what is absent.
  assert.match(t, /no job records yet/);
  assert.match(t, /not swept/);
});

test('every scratchpad panel stays on the page and none pretends the file exists', () => {
  const { html } = onFreshMachine(({ ws }) => generate({
    workspace: ws, hub: path.join(ws, 'obot.roadmap'), mode: 'live',
  }));
  const t = text(html);
  for (const panel of ['Todo', 'Notes', 'Scaffold']) {
    assert.match(t, new RegExp(`\\b${panel}\\b`), `the ${panel} panel vanished rather than saying it is empty`);
  }
  // "no ## Notes section in today's scratchpad" presupposes a scratchpad.
  assert.doesNotMatch(t, /section in today’s scratchpad/);
  assert.match(t, /no scratchpad for \d{4}-\d{2}-\d{2} yet/);
});

test('an empty jobs directory and an absent one are different pages', () => {
  const absent = onFreshMachine(({ ws }) => generate({ workspace: ws, hub: path.join(ws, 'obot.roadmap'), mode: 'live' }));
  const present = onFreshMachine(({ home, ws }) => {
    fs.mkdirSync(path.join(home, '.claude', 'jobs'), { recursive: true });
    return generate({ workspace: ws, hub: path.join(ws, 'obot.roadmap'), mode: 'live' });
  });
  // Read-and-empty is a measurement and may say zero; absent may not.
  assert.match(text(present.html), /\b0\b/);
  assert.notEqual(text(absent.html).replace(/generated \d\d:\d\d/, ''), text(present.html).replace(/generated \d\d:\d\d/, ''));
  assert.equal(absent.model.tiles.agents.read, false);
  assert.equal(present.model.tiles.agents.read, true);
  assert.equal(present.model.tiles.agents.total, 0);
});

test('the frozen report does not publish a green banner over three unread files', () => {
  const { html } = onFreshMachine(({ ws }) => generate({
    workspace: ws, hub: path.join(ws, 'obot.roadmap'), mode: 'report',
  }));
  const t = text(html);
  // This one is written to the hub and published, so it outlives the run.
  assert.doesNotMatch(t, /0 agents, .* 0 closures\/releases/);
  assert.match(t, /could not be measured for this session/);
  assert.doesNotMatch(html, /class="banner ok"/, 'an unmeasured session was reported as a clean one');
});

test('the published session indicator says unmeasured rather than idle', () => {
  const { model } = onFreshMachine(({ ws }) => generate({
    workspace: ws, hub: path.join(ws, 'obot.roadmap'), mode: 'live',
  }));
  const s = sessionState(model);
  // `idle · 0 agents` was byte-identical to a machine that was genuinely quiet,
  // and this projection is the one thing on the surface that gets published.
  assert.equal(s.state, 'unmeasured');
  assert.equal(s.agents.total, null);
  assert.match(s.detail, /no job records/);
});
