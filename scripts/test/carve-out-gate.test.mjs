import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pr, runMerge, POLICY, blobSha } from './gh-stub.mjs';

/**
 * The guardrail gate — @jwildfire, 2026-08-15: "always require the flag."
 *
 * Until this landed, obot-merge never looked at a PR's changed files, so a pull
 * request rewriting the policy file itself merged on the standard lane with no
 * resistance. It happened twice in sixteen days, both times in good faith. Each
 * case below is one of the ways that can go wrong, in the order the design
 * (hub#140 §7) listed them.
 */

const AGENT = 'jwildfire/obot.agent';
const VIZ = 'jwildfire/safety.viz';

test('a PR touching the policy file is refused without the sign-off flag', () => {
  const r = runMerge({
    repo: AGENT,
    prJson: pr({ base: 'main', body: 'Closes #999', changedFiles: 1 }),
    files: ['scripts/policy.json'],
    milestoned: '999',
    args: [],
  });
  assert.equal(r.code, 2);
  assert.match(r.out, /REFUSED - PR #1 touches a carve-out path/);
  assert.match(r.out, /scripts\/policy\.json/);
  assert.deepEqual(r.posted, [], 'nothing may be posted on a refusal');
  assert.deepEqual(r.merged, [], 'nothing may be merged on a refusal');
});

test('the verdict says the lane was forced, and by which path', () => {
  const r = runMerge({
    repo: AGENT,
    prJson: pr({ base: 'main', body: 'Closes #999' }),
    files: ['goals/registry.json'],
    milestoned: '999',
  });
  assert.equal(r.code, 0);
  assert.match(r.out, /carve-out path touched, attested lane forced \(goals\/registry\.json\)/);
  assert.match(r.out, /policy:\s+PASS - merging is permitted on the approval tier/);
});

test('the same PR merges with the flag, and the audit comment names the paths', () => {
  const r = runMerge({
    repo: AGENT,
    prJson: pr({ base: 'main', body: 'Closes #999', changedFiles: 2 }),
    files: ['scripts/policy.json', 'hooks/install.sh'],
    milestoned: '999',
    args: ['--jeremy-approved', 'chat, 2026-08-15'],
  });
  assert.equal(r.code, 0);
  assert.equal(r.posted.length, 1, 'the attested lane posts exactly one audit comment');
  assert.match(r.posted[0], /Carve-out paths touched/);
  assert.match(r.posted[0], /scripts\/policy\.json/);
  assert.match(r.posted[0], /hooks\/install\.sh/);
  assert.equal(r.merged.length, 1);
});

test('the same filename in another repo is an ordinary file', () => {
  // The carve-out governs the repo that owns the guardrail, not a filename
  // everywhere — a scripts/policy.json in a chart library is nothing special.
  const r = runMerge({
    repo: VIZ,
    prJson: pr({ base: 'dev', body: 'Closes #999' }),
    files: ['scripts/policy.json'],
    milestoned: '999',
  });
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /carve-out/);
  assert.match(r.out, /CHECK PASSED/);
});

test('a large PR is judged against the whole file list, not the first hundred', () => {
  // `gh pr view --json files` truncates at 100 with no error and no flag
  // (measured on a 318-file PR). A guardrail path at position 101 has to trip
  // the gate, so the fetch is paginated and the count is asserted.
  const files = [...Array(150).keys()].map((i) => `docs/note-${i}.md`);
  files.splice(120, 0, 'scripts/obot-merge');
  const r = runMerge({
    repo: AGENT,
    prJson: pr({ base: 'main', body: 'Closes #999', changedFiles: files.length }),
    files,
    milestoned: '999',
    args: [],
  });
  assert.equal(r.code, 2);
  assert.match(r.out, /REFUSED - PR #1 touches a carve-out path/);
  assert.match(r.out, /scripts\/obot-merge/);
});

test('a short file list is treated as truncation, not as a clean PR', () => {
  const r = runMerge({
    repo: AGENT,
    prJson: pr({ base: 'main', body: 'Closes #999', changedFiles: 318 }),
    files: ['docs/a.md', 'docs/b.md'],
    milestoned: '999',
  });
  assert.equal(r.code, 1);
  assert.match(r.out, /looks truncated \(2 of 318 changed files\)/);
});

test('an unreadable file list fails closed', () => {
  const r = runMerge({
    repo: AGENT,
    prJson: pr({ base: 'main', body: 'Closes #999' }),
    filesFail: true,
    milestoned: '999',
  });
  assert.equal(r.code, 1);
  assert.match(r.out, /could not read the changed files/);
  assert.deepEqual(r.merged, []);
});

test('a policy file that differs from the authority ref forces the flag', () => {
  // Gate B: obot-merge reads the policy sitting next to itself, so a session in
  // a worktree whose branch edits that file would otherwise resolve the lane
  // from the rules it is proposing to change.
  const r = runMerge({
    repo: VIZ,
    prJson: pr({ base: 'dev', body: 'Closes #999' }),
    authoritySha: '0'.repeat(40),
    milestoned: '999',
    args: [],
  });
  assert.equal(r.code, 2);
  assert.match(r.out, /differs from jwildfire\/obot\.agent@main/);
  assert.match(r.out, /attested lane forced/);
});

test('an unreachable authority forces the flag too', () => {
  const r = runMerge({
    repo: VIZ,
    prJson: pr({ base: 'dev', body: 'Closes #999' }),
    authoritySha: '',
    milestoned: '999',
  });
  assert.equal(r.code, 0);
  assert.match(r.out, /could not read the authority copy/);
  assert.match(r.out, /approval tier/);
});

test('a matching authority ref leaves the standard lane alone', () => {
  const r = runMerge({
    repo: VIZ,
    prJson: pr({ base: 'dev', body: 'Closes #999' }),
    authoritySha: blobSha(POLICY),
    milestoned: '999',
  });
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /attested lane forced/);
  assert.match(r.out, /policy:\s+PASS - policy and the milestone gate permit merging/);
});

test('--check reports policy and mergeability as two verdicts', () => {
  const r = runMerge({
    repo: VIZ,
    prJson: pr({ base: 'dev', body: 'Closes #999' }),
    mergeable: 'CONFLICTING',
    mergeStatus: 'DIRTY',
    milestoned: '999',
  });
  assert.equal(r.code, 0, 'policy passed, so the exit code stays 0');
  assert.match(r.out, /policy:\s+PASS/);
  assert.match(r.out, /mergeability: BLOCKED - conflicts with the base branch/);
  assert.match(r.out, /policy permits merging PR #1 in jwildfire\/safety\.viz; GitHub does not/);
  assert.doesNotMatch(r.out, /CHECK PASSED/);
});

test('--check polls through an UNKNOWN first answer', () => {
  // GitHub computes mergeability lazily: the first query is the one most likely
  // to be meaningless, which is why the value the header used to print was.
  const r = runMerge({
    repo: VIZ,
    prJson: pr({ base: 'dev', body: 'Closes #999' }),
    mergeable: 'CONFLICTING',
    mergeStatus: 'DIRTY',
    unknownUntil: 2,
    milestoned: '999',
  });
  assert.equal(r.code, 0);
  assert.match(r.out, /mergeability: BLOCKED - conflicts/);
});

test('a conflicting PR is refused before the audit comment is posted', () => {
  // The old order posted "explicitly approved by @jwildfire" and *then*
  // discovered the merge could not happen, leaving an approval record for a
  // merge that never occurred — on the one lane whose point is the audit trail.
  const r = runMerge({
    repo: AGENT,
    prJson: pr({ base: 'stable', body: 'Closes #999' }),
    files: ['NEWS.md'],
    mergeable: 'CONFLICTING',
    mergeStatus: 'DIRTY',
    milestoned: '999',
    args: ['--jeremy-approved', 'chat, 2026-08-15'],
  });
  assert.equal(r.code, 1);
  assert.match(r.out, /GitHub will not merge PR #1/);
  assert.deepEqual(r.posted, [], 'no audit comment for a merge that cannot happen');
  assert.deepEqual(r.merged, []);
});

test('a clean attested merge still posts its audit comment and merges', () => {
  const r = runMerge({
    repo: AGENT,
    prJson: pr({ base: 'stable', body: 'Closes #999' }),
    files: ['NEWS.md'],
    milestoned: '999',
    args: ['--jeremy-approved', 'chat, 2026-08-15'],
  });
  assert.equal(r.code, 0);
  assert.equal(r.posted.length, 1);
  assert.equal(r.merged.length, 1);
});
