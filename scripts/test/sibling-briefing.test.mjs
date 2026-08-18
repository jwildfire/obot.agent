import { test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BRIEF = fs.readFileSync(path.join(ROOT, 'templates/sibling-briefing.md'), 'utf8');

/**
 * What the briefing must carry — obot.agent#166, widened 2026-08-18.
 *
 * Every rule below cost a measured incident, and every one of them was hand-typed
 * into six worker briefs in a single night before it was written down here. A rule
 * a dispatcher still has to type is a rule the template does not carry, so these
 * tests are the standing check on "did the template take".
 *
 * They assert on the load-bearing token of each rule — a command spelling, an issue
 * number, a refusal — never on the prose around it, so the file can be rewritten
 * freely and only a deletion fails.
 */

const RULES = [
  {
    what: 'never call EnterWorktree — the workspace root is not a repo, so it prompts and then fails',
    needs: [/EnterWorktree/, /git worktree add \.claude\/worktrees\//],
  },
  {
    what: 'one simple command per Bash call, and what splitting costs the match',
    needs: [/single command/i, /\|\s*tail|pipe/i, /sub-command/i],
  },
  {
    what: "CI's own test invocation matches no rule, so a worker copying it is rolling dice",
    needs: [/node --test/, /workflows\/test\.yml/],
  },
  {
    what: 'blocked is a report, not a wait, and never handed to another session',
    needs: [/[Bb]locked is a report/, /[Nn]ever ask another session/],
  },
  {
    what: 'the attributed-write spelling: absolute mint, non-empty check, own prefix per segment',
    needs: [
      /\/Users\/jwildfire\/Documents\/obot2\/obot\.agent\/scripts\/obot-app-token/,
      /test -n/,
      /GH_TOKEN=\$T gh /,
    ],
  },
  {
    what: 'which repos are profile: auto, and that merging your own passing work is the default',
    needs: [/profile: auto|`profile: auto`/, /obot-policy explain/, /carve-out/],
  },
  {
    what: 'board writes fail for everyone, so the omission is recorded rather than silent',
    needs: [/obot\.roadmap#252/],
  },
  {
    what: 'the two spellings that read as a broken tool rather than as a shape you chose',
    needs: [/no such file or directory/, /obot\.agent#234/],
  },
];

for (const { what, needs } of RULES) {
  test(`the briefing carries: ${what}`, () => {
    for (const re of needs) {
      assert.match(
        BRIEF,
        re,
        `templates/sibling-briefing.md no longer carries ${re} — every worker reads this file ` +
          `and nothing else states this rule to them, so removing it means a dispatcher types ` +
          `it into each brief by hand again (obot.agent#166)`,
      );
    }
  });
}

/**
 * The whole file becomes a prompt, and the harness samples its first text into the
 * job's `intent` and timeline `detail` (obot.agent#177). tool-invocation.test.mjs
 * already forbids HTML comments; this keeps the first line a heading, which is the
 * position that actually gets sampled.
 */
test('the briefing opens on a heading, so nothing else lands in the job detail', () => {
  assert.match(BRIEF.split('\n')[0], /^## /);
});

/**
 * The claim the briefing makes about CI has to stay true of CI. If the workflow's
 * test command ever becomes something a permission rule matches, the warning in the
 * briefing is telling workers to expect a coin flip that no longer exists.
 */
test("the repository's own test command really does match no permission rule", () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/test.yml'), 'utf8');
  const line = wf.split('\n').find((l) => l.includes('node --test'));
  assert.ok(line, 'the workflow still runs node --test');

  const ALLOWED = ['scripts/obot-merge ', 'obot.agent/scripts/obot-merge ', 'git worktree ',
    'scripts/obot-gh ', 'obot.agent/scripts/obot-gh ', 'gh run list '];
  const cmd = line.slice(line.indexOf('node --test')).trim();
  assert.ok(
    !ALLOWED.some((p) => cmd.startsWith(p)),
    'CI\'s test command now matches an allowlist prefix — the briefing\'s warning is stale',
  );
});
