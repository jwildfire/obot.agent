/**
 * scripts/obot-test — the single call site for running what CI runs.
 *
 * Three workers stalled on the repository's own test command in the week of
 * 2026-08-18 (eighteen minutes, nineteen minutes, fifty-nine minutes). All three
 * carried a briefing that told them the command matched no permission rule. The
 * instruction was read and not acted on, so the remedy here is a call site rather
 * than a fourth paragraph (obot.agent#315).
 *
 * These tests assert the properties that make it a remedy rather than a fourth
 * shape: it runs EVERY tracked test file (not a hand-maintained glob list that a
 * new directory can fall out of), CI invokes it, its invocation is a single
 * undecorated command, and it goes red when the suite is red. A wrapper first
 * watched succeeding proves nothing - green because nothing ran is
 * indistinguishable from green because nothing was wrong.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOOL = path.join(REPO, 'scripts/obot-test');
const WORKFLOW = path.join(REPO, '.github/workflows/test.yml');

/**
 * Run the wrapper from a directory that is not the repository, which is the case it has
 * to survive. `NODE_TEST_CONTEXT` is stripped deliberately: node sets it in every test
 * worker, and a `node --test` that inherits it reports into the OUTER run instead of
 * exiting on its own result — a nested red suite comes back as exit 0. That would make
 * this file's red/green check pass while proving nothing, which is the exact failure
 * mode it exists to rule out.
 */
function run(args, opts = {}) {
  const env = { ...process.env, ...(opts.env ?? {}) };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  try {
    const out = execFileSync(TOOL, args, {
      cwd: opts.cwd ?? os.tmpdir(),
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { out, code: 0 };
  } catch (err) {
    return { out: String(err.stdout ?? '') + String(err.stderr ?? ''), code: err.status ?? 1 };
  }
}

const listed = (args = ['--list']) =>
  run(args).out.split('\n').map((l) => l.trim()).filter(Boolean).sort();

/** One step of the workflow, as its raw block of lines (same shape as tools/style/test/gate.test.mjs). */
function step(name) {
  const lines = fs.readFileSync(WORKFLOW, 'utf8').split('\n');
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  if (at < 0) return null;
  const indent = lines[at].indexOf('-');
  const out = [lines[at]];
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i].trim() && lines[i].search(/\S/) <= indent) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

// ------------------------------------------------------------------ it exists

test('the wrapper exists and is executable, because a call site nobody can call is a paragraph', () => {
  assert.ok(fs.existsSync(TOOL), 'scripts/obot-test is missing');
  assert.doesNotThrow(() => fs.accessSync(TOOL, fs.constants.X_OK), 'scripts/obot-test is not executable');
});

// --------------------------------------------------- it runs every test there is

test('every tracked test file is run - the list is computed, never hand-maintained', () => {
  const tracked = execFileSync('git', ['ls-files', '*.test.mjs'], { cwd: REPO, encoding: 'utf8' })
    .split('\n').map((l) => l.trim()).filter(Boolean).sort();

  assert.ok(tracked.length > 0, 'no tracked test files at all - the check would pass vacuously');

  // A superset, deliberately: discovery also picks up UNTRACKED test files, because a
  // worker writing a test before its implementation has one and a runner that could not
  // see it would defeat writing it first. What must never happen is the other direction -
  // a tracked test file the runner does not run.
  const runs = new Set(listed());
  const missed = tracked.filter((f) => !runs.has(f));
  assert.deepEqual(
    missed,
    [],
    'obot-test does not run every tracked test file. The CI line it replaces was ten ' +
      'hand-written globs with nothing keeping them in step with tools/, so a new ' +
      'tools/<x>/test directory was silently untested until someone remembered to add an ' +
      'eleventh - that is the drift this list exists to remove.',
  );
});

test('the paths it prints are real, so a typo cannot read as an empty suite', () => {
  for (const rel of listed()) {
    assert.ok(fs.existsSync(path.join(REPO, rel)), `${rel} is listed but does not exist`);
  }
});

test('a filter narrows the run, so a worker can iterate on one file without inventing a command', () => {
  const all = listed();
  const one = listed(['suite', 'navigator', '--list']);
  assert.ok(one.length > 0, 'filtering by "navigator" matched nothing');
  assert.ok(one.length < all.length, 'the filter did not narrow anything');
  assert.ok(one.every((p) => p.includes('navigator')), `filter leaked non-matching files: ${one.join(', ')}`);
});

// ------------------------------------------------------------ CI points at it

test('CI runs the wrapper, so the most-copied line in the repository IS the allowed shape', () => {
  const s = step('Test suite');
  assert.ok(s, 'the workflow has no "Test suite" step');
  assert.match(
    s,
    /scripts\/obot-test/,
    'CI still runs its own spelling of the test command. The point of the wrapper is that a ' +
      'worker copying CI copies the allowed form - if CI keeps a second spelling, the wrapper ' +
      'is a fourth shape rather than the one shape (obot.agent#315).',
  );
});

test("CI's test command is a single undecorated command, which is what a prefix rule can match", () => {
  const cmd = /run:\s*(.+)/.exec(step('Test suite'))[1].trim();
  for (const bad of ['|', '&&', '||', ';', '*']) {
    assert.ok(
      !cmd.includes(bad),
      `CI's test command contains ${bad} - a permission rule is a prefix match that holds only ` +
        `when every sub-command matches, so this drops the call to the auto-mode classifier ` +
        `(obot.agent#162). Command was: ${cmd}`,
    );
  }
  assert.ok(!/^(bash|sh|cd|\.\/)/.test(cmd), `CI's test command leads with a decoration: ${cmd}`);
});

// --------------------------------------------------------- it goes red when red

test('the wrapper fails when the suite fails, and passes when it does not', (t) => {
  const rel = 'tools/style/test/__obot-test-red.test.mjs';
  const file = path.join(REPO, rel);
  t.after(() => fs.rmSync(file, { force: true }));

  fs.writeFileSync(file, [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('deliberately red, written by scripts/test/obot-test.test.mjs', () => assert.equal(1, 2));",
    '',
  ].join('\n'));

  const red = run(['suite', '__obot-test-red']);
  assert.equal(red.code, 1, 'a failing suite has to fail the wrapper, or the gate cannot gate');
  assert.match(red.out, /FAIL/, 'and the verdict has to be legible in the output, not only in $?');

  fs.rmSync(file);
  const green = run(['suite', 'statusline']);
  assert.equal(green.code, 0, `a passing suite has to pass the wrapper:\n${green.out}`);
  assert.match(green.out, /PASS/, 'the passing verdict has to be stated too');
});

test('an unknown stage is refused rather than silently doing nothing', () => {
  const r = run(['definitely-not-a-stage']);
  assert.notEqual(r.code, 0, "an unknown stage exited 0 - silent success is this house's recurring defect");
  assert.match(r.out, /unknown/i, 'and it has to say what it did not understand');
});

// --------------------------------------------------- the briefing points at it

test('the briefing sends workers to the wrapper rather than to a rule they must remember', () => {
  const brief = fs.readFileSync(path.join(REPO, 'templates/sibling-briefing.md'), 'utf8');
  assert.match(
    brief,
    /obot\.agent\/scripts\/obot-test/,
    'templates/sibling-briefing.md no longer names the wrapper. Three workers stalled while ' +
      'holding a briefing that described the permission-rule shape instead of naming a command ' +
      'to run (obot.agent#315); the name of the command is the part that has to survive.',
  );
});
