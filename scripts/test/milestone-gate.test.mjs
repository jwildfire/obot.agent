import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'obot-merge');

/**
 * obot-merge reaches GitHub through exactly two `gh` calls before it decides:
 * `gh pr view` for the PR, and `gh issue view` per closing reference. Stubbing
 * `gh` on PATH lets the milestone gate be exercised over crafted PR bodies
 * without a network, a token, or a real PR to spoil.
 */
function stubGh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obot-merge-gate-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, 'gh'),
    [
      '#!/usr/bin/env bash',
      'if [ "$1" = "pr" ] && [ "$2" = "view" ]; then printf \'%s\' "$FAKE_PR_JSON"; exit 0; fi',
      'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then',
      '  n="$3"',
      '  case ",$FAKE_MILESTONED," in *",$n,"*) echo "v1.6.0"; exit 0;; esac',
      '  case ",$FAKE_UNREADABLE," in *",$n,"*) exit 1;; esac',
      '  echo "NONE"; exit 0',
      'fi',
      'exit 1',
    ].join('\n'),
    { mode: 0o755 },
  );
  return bin;
}

const BIN = stubGh();

function pr({ base = 'dev', body = '', milestone = null } = {}) {
  return JSON.stringify({
    baseRefName: base,
    isDraft: false,
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    headRefOid: 'abc1234',
    url: 'https://example.invalid/pr/1',
    title: 'test PR',
    body,
    milestone,
  });
}

/** Always --check: the gate must be evaluated, nothing may ever be merged. */
function check({ prJson, milestoned = '', unreadable = '', args = [] }) {
  const r = spawnSync(SCRIPT, ['1', '-R', 'jwildfire/safety.viz', '--check', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${BIN}:${process.env.PATH}`,
      FAKE_PR_JSON: prJson,
      FAKE_MILESTONED: milestoned,
      FAKE_UNREADABLE: unreadable,
    },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('refuses a merge whose closing target carries no milestone', () => {
  const r = check({ prJson: pr({ body: 'Closes #999' }) });
  assert.equal(r.code, 2);
  assert.match(r.out, /REFUSED - no milestone on #999/);
});

test('allows it when the issue carries a milestone', () => {
  const r = check({ prJson: pr({ body: 'Closes #999' }), milestoned: '999' });
  assert.equal(r.code, 0);
  assert.match(r.out, /CHECK PASSED/);
});

test('--no-milestone overrides, and says so in the output', () => {
  const r = check({
    prJson: pr({ body: 'Closes #999' }),
    args: ['--no-milestone', 'orphan cleanup, belongs to no release'],
  });
  assert.equal(r.code, 0);
  assert.match(r.out, /OVERRIDDEN for #999 - orphan cleanup/);
});

test('refuses a release-role merge that names no issue (the sv#124 case)', () => {
  const r = check({ prJson: pr({ base: 'main', body: '## Summary\nRelease v1.6.0.' }) });
  assert.equal(r.code, 2);
  assert.match(r.out, /REFUSED - release merge into 'main' names no issue/);
});

test('--no-issues overrides the release-role refusal', () => {
  const r = check({
    prJson: pr({ base: 'main', body: '## Summary\nRelease v1.6.1.' }),
    args: ['--no-issues', 'docs-only patch release'],
  });
  assert.equal(r.code, 0);
  assert.match(r.out, /no-issues release accepted - docs-only patch release/);
});

test('an integration merge naming no issue is not the release rule and passes', () => {
  const r = check({ prJson: pr({ body: 'Part of #88; refs #12' }) });
  assert.equal(r.code, 0);
  assert.match(r.out, /closes: \(none\)/);
});

test('an unreadable issue and a cross-repo reference are reported, not enforced', () => {
  const r = check({
    prJson: pr({ body: 'Closes #777\nCloses jwildfire/obot.roadmap#88' }),
    unreadable: '777',
  });
  assert.equal(r.code, 0);
  assert.match(r.out, /cross-repo \(not enforced\): jwildfire\/obot\.roadmap#88/);
  assert.match(r.out, /could not read #777/);
});

test('reads every spelling of a closing reference, and no non-reference', () => {
  // One body carrying the forms that must match, the forms that must not, and
  // a same-repo URL that has to fold back into the enforced set.
  const body = [
    'Closes #1',
    'Closes: #2',
    'Fixes [#3](https://github.com/jwildfire/safety.viz/issues/3)',
    'Resolved https://github.com/jwildfire/safety.viz/issues/4',
    'Closes the four remaining items on the polish list',
    'Part of #900; refs #901',
    '> Closes #902',
    '```',
    'Closes #903',
    '```',
  ].join('\n');
  const r = check({ prJson: pr({ body }), milestoned: '1,2,3,4' });
  assert.equal(r.code, 0);
  assert.match(r.out, /closes: #1 #2 #3 #4/);
  assert.doesNotMatch(r.out, /#90[0-3]/);
});
