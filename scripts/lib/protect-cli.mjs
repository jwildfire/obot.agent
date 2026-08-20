// (invoked by scripts/obot-protect)
// obot-protect - read, plan, apply and verify branch protection for every roled
// branch in scripts/policy.json, against the spec in scripts/protections.json.
//
// Why this exists (obot.roadmap#272, @jwildfire 2026-08-18: "I definitely want you
// to do branch protections in GitHub. That is critical."): everything agentic in
// this workspace currently rests on agents choosing to call obot-merge and
// obot-merge choosing to enforce the policy. That has held while somebody was
// awake. A scheduled session runs when nobody is, so the guardrail belongs under
// the machinery rather than inside it.
//
//   obot-protect read                  what GitHub has right now, one row a branch
//   obot-protect plan                  spec vs live: every branch that would change
//   obot-protect verify                same comparison, exit 1 on any disagreement
//   obot-protect apply --approved '<where/when he chose>'
//                                      write the spec, then read every branch back
//
// Flags: --only <repo>/<branch> (repeatable), --json (read/plan/verify), --spec <path>.
//
// CREDENTIAL. Reading or writing branch protection needs repository admin, and the
// obotclaw App has neither - `gh api .../protection` as the App returns 403
// "Resource not accessible by integration". That is deliberate and should stay
// that way: an agent that can remove its own guardrail does not have one. So this
// tool runs on @jwildfire's own gh auth, and it refuses to guess: an unreadable
// branch is reported unreadable and never as unprotected.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expectedFor, normalizeObserved, diff, payloadFor, label, FIELDS } from './protections.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SPEC = path.join(HERE, '..', 'protections.json');

const die = (msg) => { process.stderr.write(`obot-protect: ${msg}\n`); process.exit(1); };

// ---- arguments -------------------------------------------------------------

const argv = process.argv.slice(2);
const mode = argv.shift() ?? 'plan';
if (!['read', 'plan', 'verify', 'apply'].includes(mode)) die(`unknown mode '${mode}' (read|plan|verify|apply)`);

let specPath = DEFAULT_SPEC;
let approval = '';
let asJson = false;
const only = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--spec') specPath = argv[++i] ?? die('--spec needs a path');
  else if (a === '--approved') approval = argv[++i] ?? die('--approved needs the citation it carries');
  else if (a === '--only') only.push(argv[++i] ?? die('--only needs <repo>/<branch>'));
  else if (a === '--json') asJson = true;
  else die(`unknown flag '${a}'`);
}

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const entries = spec.branches.filter((e) => !only.length || only.includes(label(e)));
if (!entries.length) die(`--only matched no branch in the spec`);

// ---- GitHub ----------------------------------------------------------------

function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  if (r.error) die(`could not run gh: ${r.error.message}`);
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/**
 * The live protection for one branch, or null when the branch genuinely carries
 * none. Every other failure throws: "Branch not protected" is the ONLY response
 * allowed to read as absence. A 403 (wrong credential) or a "Not Found" (repo or
 * branch gone) reported as "unprotected" would hand back a clean-looking report
 * about a branch nobody actually looked at.
 */
function readProtection(entry) {
  const [owner, repo] = entry.repo.split('/');
  const r = gh(['api', `repos/${owner}/${repo}/branches/${entry.branch}/protection`]);
  if (r.code === 0) return JSON.parse(r.out);
  let body = {};
  try { body = JSON.parse(r.out || '{}'); } catch { /* not JSON - fall through to the throw */ }
  if (body.message === 'Branch not protected') return null;
  const detail = body.message ? `${body.status ?? '?'} ${body.message}` : (r.err.trim() || r.out.trim() || 'no output');
  throw new Error(`${label(entry)}: could not read protection - ${detail}`);
}

function writeProtection(entry, payload) {
  const [owner, repo] = entry.repo.split('/');
  const r = spawnSync('gh', [
    'api', '--method', 'PUT', `repos/${owner}/${repo}/branches/${entry.branch}/protection`,
    '--input', '-',
  ], { encoding: 'utf8', input: JSON.stringify(payload) });
  if (r.error) die(`could not run gh: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${label(entry)}: PUT failed - ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
}

/** One row per branch: the spec, the live state, and where they disagree. */
function survey() {
  const rows = [];
  for (const entry of entries) {
    const expected = expectedFor(spec, entry);
    let observed = null;
    let unreadable = '';
    try { observed = normalizeObserved(readProtection(entry)); }
    catch (e) { unreadable = e.message; }
    rows.push({ entry, expected, observed, unreadable, differences: unreadable ? [] : diff(expected, observed) });
  }
  return rows;
}

// ---- rendering -------------------------------------------------------------

const say = (s = '') => process.stdout.write(`${s}\n`);

/** What a branch carries today, in words rather than in twelve booleans. */
function describe(o) {
  if (!o) return 'UNREADABLE';
  const on = [];
  if (!o.allowForcePushes) on.push('no force-push');
  if (!o.allowDeletions) on.push('no deletion');
  if (o.requirePullRequest) on.push(o.requiredApprovals ? `PR + ${o.requiredApprovals} approval(s)` : 'PR required');
  if (o.requiredChecks.length) on.push(`checks: ${o.requiredChecks.join(' + ')}`);
  if (o.strictChecks) on.push('strict (up-to-date)');
  if (o.requireLinearHistory) on.push('linear history');
  if (o.requireConversationResolution) on.push('conversations resolved');
  if (o.requireSignatures) on.push('signed commits');
  if (o.lockBranch) on.push('locked');
  if (o.enforceAdmins) on.push('admins included');
  return on.length ? on.join('; ') : 'NOTHING - unprotected';
}

function renderSurvey(rows, { showDiff }) {
  for (const { entry, observed, unreadable, differences } of rows) {
    const head = `${label(entry)}  [${entry.role}${showDiff ? ` -> ${entry.tier}` : ''}]`;
    say(head);
    say(`  now:  ${unreadable ? `UNREADABLE - ${unreadable}` : describe(observed)}`);
    if (!showDiff) continue;
    if (unreadable) { say('  spec: not compared - the live state could not be read'); continue; }
    if (!differences.length) { say('  spec: MATCHES'); continue; }
    for (const d of differences) say(`  DIFF  ${d.field}: spec ${d.expected} / live ${d.actual}`);
  }
}

// ---- modes -----------------------------------------------------------------

const rows = survey();
const unreadable = rows.filter((r) => r.unreadable);
const changed = rows.filter((r) => !r.unreadable && r.differences.length);

if (asJson) {
  say(JSON.stringify({ mode, status: spec.status, rows: rows.map((r) => ({
    repo: r.entry.repo, branch: r.entry.branch, role: r.entry.role, tier: r.entry.tier,
    unreadable: r.unreadable || null, observed: r.observed, expected: r.expected, differences: r.differences,
  })) }, null, 2));
  if (mode === 'verify' && (changed.length || unreadable.length)) process.exit(1);
  process.exit(0);
}

say(`obot-protect ${mode} - spec ${path.relative(process.cwd(), specPath)} (${spec.status})`);
say('');

if (mode === 'read') {
  renderSurvey(rows, { showDiff: false });
  say('');
  say(`${rows.length} roled branch(es) read${unreadable.length ? `; ${unreadable.length} UNREADABLE` : ''}.`);
  process.exit(unreadable.length ? 1 : 0);
}

if (mode === 'plan' || mode === 'verify') {
  renderSurvey(rows, { showDiff: true });
  say('');
  if (unreadable.length) say(`${unreadable.length} branch(es) UNREADABLE - not compared, and not assumed clean.`);
  if (mode === 'plan') {
    say(changed.length
      ? `${changed.length} of ${rows.length} branch(es) would change. Nothing was applied.`
      : `All ${rows.length} branch(es) already match the spec. Nothing to apply.`);
    process.exit(0);
  }
  if (changed.length || unreadable.length) {
    say(`VERIFY FAILED - ${changed.length} branch(es) disagree with the spec, ${unreadable.length} unreadable.`);
    process.exit(1);
  }
  say(`VERIFY PASSED - all ${rows.length} branch(es) match the spec.`);
  process.exit(0);
}

// apply
if (!approval) {
  process.stderr.write(
    'obot-protect: REFUSED - apply changes what GitHub enforces on every roled branch, and that is @jwildfire\'s\n' +
    "  choice, not a script's. Re-run with --approved '<where and when he chose it>' once he has answered the\n" +
    '  decision artifact. Use `plan` to see what would change; it writes nothing.\n');
  process.exit(2);
}
if (unreadable.length) {
  process.stderr.write(`obot-protect: REFUSED - ${unreadable.length} branch(es) could not be read, so this run cannot know what it is changing:\n`);
  for (const r of unreadable) process.stderr.write(`  ${r.unreadable}\n`);
  process.exit(2);
}

say(`Applying as: ${(gh(['api', 'user', '--jq', '.login']).out || 'unknown').trim()}`);
say(`Approval:    ${approval}`);
say('');

let failed = 0;
for (const { entry, expected, differences } of rows) {
  if (!differences.length) { say(`${label(entry)}: already matches - untouched`); continue; }
  try {
    writeProtection(entry, payloadFor(expected));
    say(`${label(entry)}: applied (${differences.map((d) => d.field).join(', ')})`);
  } catch (e) {
    failed++;
    say(`${label(entry)}: FAILED - ${e.message}`);
  }
}

// Read every branch back. An apply that reports success without re-reading is the
// house failure mode: the exit code of a PUT is not evidence of the state after it.
say('');
say('Reading back:');
const after = survey();
const stillWrong = after.filter((r) => r.unreadable || r.differences.length);
renderSurvey(after, { showDiff: true });
say('');
if (stillWrong.length || failed) {
  say(`APPLY INCOMPLETE - ${stillWrong.length} branch(es) still disagree with the spec after the write.`);
  process.exit(1);
}
say(`APPLY VERIFIED - all ${after.length} branch(es) now match the spec.`);
