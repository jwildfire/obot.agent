import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pr, runMerge } from './gh-stub.mjs';

/**
 * The milestone gate — @jwildfire, 2026-08-14, after a release shipped grouping
 * nothing: "there should be a rule that no work is done on an issue until a
 * milestone is assigned." These cases run the real obot-merge over crafted PR
 * bodies against a stubbed `gh` (see gh-stub.mjs), always with --check, so the
 * gate is exercised and nothing can be merged.
 */

/** Always --check, and always with a file list, so only the milestone gate can refuse. */
function check({ prJson, milestoned = '', unreadable = '', args = [] }) {
  return runMerge({
    repo: 'jwildfire/safety.viz',
    prJson,
    files: ['R/chart.R'],
    milestoned,
    unreadable,
    args: ['--check', ...args],
  });
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
