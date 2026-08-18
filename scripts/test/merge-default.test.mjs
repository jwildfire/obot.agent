import { test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const POLICY = JSON.parse(read('scripts/policy.json'));
const AGENTS = read('AGENTS.md');

/**
 * The merge DEFAULT, guarded — obot.agent#236.
 *
 * scripts/policy.json is the authority on which merges need @jwildfire and which do
 * not. Everything else that describes merging to an agent is a copy of it, and on
 * 2026-08-18 the copies had drifted the dangerous way: AGENTS.md framed the merge
 * command with "Once a merge is approved" and never stated the default, so two
 * workers held finished, policy-passing pull requests on repos where the standard
 * lane had already been granted. One would have left a published page wrong for a
 * day and a half.
 *
 * These tests derive their expectations from policy.json rather than restating it,
 * so promoting a repo, adding a branch role, or extending the carve-out fails here
 * until the prose catches up. They assert on load-bearing tokens — branch names,
 * paths, a refusal — never on the sentences around them, and they report the token
 * that failed rather than dumping the file.
 */

/** Files an agent reads before deciding whether a merge needs him. */
const AGENT_FACING = [
  'AGENTS.md',
  'templates/sibling-briefing.md',
  'docs/rc-framework.md',
  'skills/session-spawn/SKILL.md',
  'skills/session-reviews/SKILL.md',
  'skills/session-wrapup/SKILL.md',
];

/** Match across a line wrap: these files are hard-wrapped at ~90 columns. */
const wrapped = (phrase) => new RegExp(phrase.replace(/ /g, '\\s+'), 'i');

/**
 * A phrase quoted as retired is the file explaining its own history, not an
 * instruction. `*"…"*` is the house form for quoting words being corrected, so
 * those spans come out before the scan.
 */
const withoutQuotations = (text) => text.replace(/\*"[^"]*"\*/gs, '');

/**
 * Phrasings that make approval sound like the precondition for a merge rather than
 * the exception. Both were live in the tree on 2026-08-18 and both were read as
 * "hold it and ask".
 */
const RETIRED = [
  {
    phrase: 'once a merge is approved',
    why: 'frames the merge command as a post-approval mechanic; the standard lane needs no approval',
  },
  {
    phrase: "never merge without Jeremy's explicit approval",
    why: "states the opposite of policy.json, where every listed repo's integration branch is standard-lane",
  },
];

for (const file of AGENT_FACING) {
  const live = withoutQuotations(read(file));
  for (const { phrase, why } of RETIRED) {
    test(`${file} does not reintroduce: "${phrase}"`, () => {
      assert.ok(
        !wrapped(phrase).test(live),
        `${file} states "${phrase}" as a live rule — ${why}. Say what scripts/policy.json ` +
          `says: the standard lane is the default, and approval attaches to release-role ` +
          `branches, carve-out paths, and repos absent from the file.`,
      );
    });
  }
}

test('AGENTS.md states the standard lane as the default, not as an escalation', () => {
  for (const phrase of [
    'Merge your own passing work',
    'profile: auto',
    'obot-policy explain',
    'standard lane',
  ]) {
    assert.ok(
      wrapped(phrase).test(AGENTS),
      `AGENTS.md no longer carries "${phrase}". It is the always-loaded file and the only ` +
        `place a worker is told what the default is; without it the reader supplies one.`,
    );
  }
});

test('the AGENTS.md lane table names every repo in policy.json with its real branches', () => {
  const section = AGENTS.slice(AGENTS.indexOf('## Merging'));
  const rows = section
    .split('\n')
    .filter((l) => l.startsWith('|') && !/^\|\s*-|repo \|/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
  assert.ok(rows.length > 0, 'no lane table found under the AGENTS.md merging section');

  const ticked = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const documented = new Map();
  for (const [repoCell, standardCell, attestedCell] of rows) {
    for (const repo of ticked(repoCell)) {
      documented.set(repo, { standard: ticked(standardCell), attested: ticked(attestedCell) });
    }
  }

  for (const [full, entry] of Object.entries(POLICY.repos)) {
    const short = full.split('/')[1];
    const row = documented.get(short);
    assert.ok(
      row,
      `policy.json lists ${full} but the AGENTS.md lane table does not mention it — a ` +
        `repo missing from the table is one a worker will not know it may merge.`,
    );
    if (POLICY.profiles[entry.profile].merge.integration === 'standard') {
      assert.deepEqual(
        row.standard,
        [entry.branches.integration],
        `${short}: policy.json puts '${entry.branches.integration}' on the standard lane`,
      );
    }
    assert.deepEqual(
      row.attested,
      entry.branches.release ?? [],
      `${short}: policy.json gives it release branches ${JSON.stringify(entry.branches.release)}`,
    );
  }
});

test('AGENTS.md names every carve-out path, since those merge on the attested lane', () => {
  for (const p of POLICY.carveOut.repos['jwildfire/obot.agent']) {
    assert.ok(
      AGENTS.includes('`' + p + '`'),
      `AGENTS.md does not name the carve-out path '${p}'. A path listed in policy.json and ` +
        `absent from the prose is one an agent merges without the sign-off it needs.`,
    );
  }
});

test('AGENTS.md says a repo class does not move a merge onto the attested lane', () => {
  assert.ok(
    wrapped('does not enter into it').test(AGENTS),
    "AGENTS.md no longer quotes obot-merge's own statement that a repo's class does not " +
      'decide the lane. Class was read as an approval gate on 2026-08-18; it is not one — ' +
      'it only decides which attestation form an already-attested merge may carry.',
  );
});

test('every repo listed in policy.json is still profile: auto, as AGENTS.md says', () => {
  // Not a rule about the future. If @jwildfire demotes a repo to 'protected', this fails
  // and the prose gets revisited, rather than quietly continuing to promise a lane the
  // policy no longer grants.
  assert.deepEqual(
    [...new Set(Object.values(POLICY.repos).map((r) => r.profile))],
    ['auto'],
    'a repo in policy.json is no longer profile: auto — AGENTS.md says every listed repo ' +
      'is, and that sentence now needs rewriting rather than leaving a worker to merge on ' +
      'a lane the file no longer grants.',
  );
});
