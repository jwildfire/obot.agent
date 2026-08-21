// The surfaces beside the dashboard's routes, on a machine with no history.
//
// Requirement: jwildfire/obot.roadmap#223, task jwildfire/obot.agent#306. Worker W0105.
//
// `fresh-machine.test.mjs` next to this one boots the server and reads the routes.
// These are the surfaces that read the same local state and never go through it: the
// command 🎩🤖 prime runs on every cold turn, and the one route the server has that
// the route sweep does not cover. Both were rehearsed on a scratch `HOME` with an
// empty workspace before being written down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.join(HERE, '..', '..');

const freshWs = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-cli-'));

function run(bin, args, ws) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-cli-home-'));
  const r = spawnSync(path.join(TOOLS, bin), args, {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, OBOT_WORKSPACE: ws, OBOT_HUB: path.join(ws, 'obot.roadmap') },
  });
  return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`, status: r.status };
}

// ------------------------------------------------- the answers prime reads each turn

test('an answer store that does not exist is not every answer applied', () => {
  // `.claude/ops/answers/` is local-only and no clone brings it. The sweep already
  // said the honest thing — "answers: no store on this machine yet" — because
  // `pendingAnswers` marks a storeless read and `answersSection` reads that mark. The
  // command 🎩🤖 prime shells on every cold turn ignored it and printed "nothing
  // pending — every answer he has recorded has been applied", which is a verdict on a
  // directory nobody opened, in the bundle that tells prime whether he is waiting on
  // anything (jwildfire/obot.roadmap#223).
  const { out } = run('ops-answers', ['pending'], freshWs());
  assert.doesNotMatch(out, /every answer he has recorded has been applied/);
  assert.match(out, /no answer store on this machine/i);
  assert.match(out, /dashboard/i, 'the notice has to say what would create it');
});

test('an answer store that exists and is empty still reads as measured', () => {
  const ws = freshWs();
  fs.mkdirSync(path.join(ws, '.claude', 'ops', 'answers'), { recursive: true });
  const { out } = run('ops-answers', ['pending'], ws);
  assert.match(out, /every answer he has recorded has been applied/);
});

test('the exit code does not turn an unread store into a clean one', () => {
  // `--exit-code` is what a script branches on, and 0 means "nothing is waiting".
  const { status } = run('ops-answers', ['pending', '--exit-code'], freshWs());
  assert.notEqual(status, 0, 'a storeless read must not exit as if the queue were clear');
});
