import { test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expectedFor, normalizeObserved, diff, payloadFor } from '../lib/protections.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, '..');
const PROTECT = path.join(SCRIPTS, 'obot-protect');
const SPEC = JSON.parse(fs.readFileSync(path.join(SCRIPTS, 'protections.json'), 'utf8'));
const POLICY = JSON.parse(fs.readFileSync(path.join(SCRIPTS, 'policy.json'), 'utf8'));

const entry = (repo, branch) =>
  SPEC.branches.find((e) => e.repo === repo && e.branch === branch);

/**
 * The live response GitHub gave for safety.viz/main on 2026-08-20 — a branch that
 * has been carrying obotclaw[bot] release merges since July. It is the fixture the
 * whole spec is calibrated against: if the recommended shape did not reproduce a
 * rule already proven against the bot, the recommendation would be a guess.
 */
const SAFETY_VIZ_MAIN = {
  required_status_checks: { strict: false, contexts: ['Build, format, and test'], checks: [{ context: 'Build, format, and test', app_id: 15368 }] },
  required_pull_request_reviews: { dismiss_stale_reviews: false, require_code_owner_reviews: false, require_last_push_approval: false, required_approving_review_count: 0 },
  required_signatures: { enabled: false },
  enforce_admins: { enabled: false },
  required_linear_history: { enabled: false },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
  block_creations: { enabled: false },
  required_conversation_resolution: { enabled: false },
  lock_branch: { enabled: false },
};

test('the spec reproduces a rule already proven against obotclaw[bot]', () => {
  const e = entry('jwildfire/safety.viz', 'main');
  assert.ok(e, 'safety.viz/main must be in the spec');
  assert.deepEqual(diff(expectedFor(SPEC, e), normalizeObserved(SAFETY_VIZ_MAIN)), [],
    'the recommended shape for safety.viz/main must equal what GitHub already enforces there');
});

test('an unprotected branch disagrees on exactly the guards it is missing', () => {
  const e = entry('jwildfire/obot.agent', 'main');
  const fields = diff(expectedFor(SPEC, e), normalizeObserved(null)).map((d) => d.field);
  assert.deepEqual(fields.sort(), ['allowDeletions', 'allowForcePushes', 'requirePullRequest', 'requiredChecks'].sort());
});

test('a history-guard branch is satisfied by the two bans alone', () => {
  const e = entry('jwildfire/obot.roadmap', 'main');
  assert.equal(e.tier, 'history-guard', 'the hub keeps its direct-commit grant');
  const observed = normalizeObserved({
    required_status_checks: null, required_pull_request_reviews: null,
    required_signatures: { enabled: false }, enforce_admins: { enabled: false },
    required_linear_history: { enabled: false }, allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false }, block_creations: { enabled: false },
    required_conversation_resolution: { enabled: false }, lock_branch: { enabled: false },
  });
  assert.deepEqual(diff(expectedFor(SPEC, e), observed), []);
});

test('MORE protection than the spec asks for is a disagreement, not a bonus', () => {
  // The failure this guards against is a well-meant tightening in the GitHub UI:
  // one approving review, or linear history, and every standard-lane merge needs
  // @jwildfire. A verifier that only checked the guards were ON would call that
  // state healthy.
  const e = entry('jwildfire/obot.agent', 'main');
  const tightened = normalizeObserved({
    ...SAFETY_VIZ_MAIN,
    required_status_checks: { strict: true, contexts: ['test'] },
    required_pull_request_reviews: { required_approving_review_count: 1 },
    required_linear_history: { enabled: true },
  });
  const fields = diff(expectedFor(SPEC, e), tightened).map((d) => d.field).sort();
  assert.deepEqual(fields, ['requireLinearHistory', 'requiredApprovals', 'strictChecks']);
});

test('every switch that would break the standard lane is off in every tier', () => {
  for (const [name, tier] of Object.entries(SPEC.tiers)) {
    if (name === 'review-gate') continue; // documented as not-recommended, and used by no entry
    assert.equal(tier.requiredApprovals, 0, `${name}: an approval requirement blocks the bot`);
    assert.equal(tier.requireLinearHistory, false, `${name}: obot-merge's default strategy is a merge commit`);
    assert.equal(tier.strictChecks, false, `${name}: up-to-date-before-merge stalls unattended runs`);
    assert.equal(tier.requireConversationResolution, false, `${name}: nobody is awake to resolve a thread`);
    assert.equal(tier.requireSignatures, false, `${name}: agent pushes are not signed`);
    assert.equal(tier.lockBranch, false, `${name}: a locked branch takes no merges at all`);
  }
  assert.ok(!SPEC.branches.some((e) => e.tier === 'review-gate'),
    'no branch may use review-gate without a recorded decision - it converts every merge into a manual one');
});

test('every roled branch in policy.json has exactly one entry in the spec', () => {
  const roled = [];
  for (const [repo, cfg] of Object.entries(POLICY.repos)) {
    if (cfg.branches?.integration) roled.push(`${repo}/${cfg.branches.integration}`);
    for (const b of cfg.branches?.release ?? []) roled.push(`${repo}/${b}`);
  }
  const covered = SPEC.branches.map((e) => `${e.repo}/${e.branch}`);
  assert.deepEqual(roled.filter((b) => !covered.includes(b)), [],
    'a branch the merge policy governs but no protection rule covers');
  assert.deepEqual(covered.filter((b) => !roled.includes(b)), [],
    'a protection rule for a branch the merge policy does not govern');
  assert.equal(new Set(covered).size, covered.length, 'duplicate entry in the spec');
});

test('the roles in the spec agree with the roles in the merge policy', () => {
  for (const e of SPEC.branches) {
    const cfg = POLICY.repos[e.repo];
    const role = cfg.branches.integration === e.branch ? 'integration' : 'release';
    assert.equal(e.role, role, `${e.repo}/${e.branch}: role disagrees with policy.json`);
  }
});

test('the payload never restricts who may merge', () => {
  const p = payloadFor(expectedFor(SPEC, entry('jwildfire/obot.agent', 'main')));
  assert.equal(p.restrictions, null, 'a push restriction is what would lock the bot out');
  assert.equal(p.required_pull_request_reviews.required_approving_review_count, 0);
  assert.deepEqual(p.required_status_checks, { strict: false, contexts: ['test'] });
  const guard = payloadFor(expectedFor(SPEC, entry('jwildfire/obot.roadmap', 'main')));
  assert.equal(guard.required_pull_request_reviews, null, 'the hub must keep taking direct commits');
  assert.equal(guard.required_status_checks, null);
  assert.equal(guard.allow_force_pushes, false);
  assert.equal(guard.allow_deletions, false);
});

test('an unknown tier throws instead of quietly protecting nothing', () => {
  assert.throws(() => expectedFor(SPEC, { repo: 'x/y', branch: 'z', tier: 'typo' }), /unknown tier/);
});

// ---- the CLI, over a fake gh ------------------------------------------------

/** A `gh` on PATH that answers the protection endpoint from a fixture and logs writes. */
function stubGh({ protection, unreadable }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obot-protect-'));
  const log = path.join(dir, 'calls.log');
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash
{ printf '%s' "$*"; printf '\\n'; } >> "${log}"
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo "jwildfire"; exit 0; fi
case "$*" in
  *--method*PUT*) exit 0 ;;
esac
${unreadable ? `echo '{"message":"Resource not accessible by integration","status":"403"}'; exit 1` : ''}
${protection ? `cat <<'JSONEOF'\n${JSON.stringify(protection)}\nJSONEOF\nexit 0` : `echo '{"message":"Branch not protected","status":"404"}'; exit 1`}
`);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  return { dir, log };
}

const runCli = (args, stub) => {
  const r = spawnSync(PROTECT, args, {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stub.dir}:${process.env.PATH}` },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, calls: fs.existsSync(stub.log) ? fs.readFileSync(stub.log, 'utf8') : '' };
};

test('verify fails on an unprotected branch, and says which guards are missing', () => {
  const stub = stubGh({ protection: null });
  const r = runCli(['verify', '--only', 'jwildfire/obot.agent/main'], stub);
  assert.equal(r.code, 1, 'an unprotected guardrail branch must not pass');
  assert.match(r.out, /VERIFY FAILED/);
  assert.match(r.out, /allowForcePushes: spec false \/ live true/);
});

test('verify passes when the branch carries exactly the spec', () => {
  const stub = stubGh({ protection: { ...SAFETY_VIZ_MAIN } });
  const r = runCli(['verify', '--only', 'jwildfire/safety.viz/main'], stub);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /VERIFY PASSED/);
});

test('an unreadable branch is reported unreadable, never as unprotected', () => {
  // ENOENT is the only failure allowed to read as absence. A 403 from the wrong
  // credential must never render as "NOTHING - unprotected", which is what a clean
  // report about a branch nobody looked at would say.
  const stub = stubGh({ unreadable: true });
  const r = runCli(['verify', '--only', 'jwildfire/obot.agent/main'], stub);
  assert.equal(r.code, 1);
  assert.match(r.out, /UNREADABLE/);
  assert.doesNotMatch(r.out, /NOTHING - unprotected/);
});

test('apply refuses without the approval it has to cite, and writes nothing', () => {
  const stub = stubGh({ protection: null });
  const r = runCli(['apply', '--only', 'jwildfire/obot.agent/main'], stub);
  assert.equal(r.code, 2);
  assert.match(r.out, /REFUSED/);
  assert.doesNotMatch(r.calls, /--method PUT/, 'a refusal must reach no write');
});

test('apply refuses outright when any branch could not be read', () => {
  const stub = stubGh({ unreadable: true });
  const r = runCli(['apply', '--approved', 'test', '--only', 'jwildfire/obot.agent/main'], stub);
  assert.equal(r.code, 2);
  assert.match(r.out, /could not be read/);
  assert.doesNotMatch(r.calls, /--method PUT/);
});
