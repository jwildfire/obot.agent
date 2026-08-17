import { test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * How an agent must type the merge command — c0014, diagnosed 2026-08-17.
 *
 * The workspace allowlist in obot2/.claude/settings.json permits three spellings
 * of the merge wrapper. A Bash(prefix *) rule matches a command only when every
 * sub-command matches, where sub-commands are split on | && || and ;. So
 * `bash scripts/obot-merge 158 -R jwildfire/obot.agent 2>&1 | tail -20` matches
 * nothing: `bash ` in front defeats all three path rules, and `tail -20` is a
 * second sub-command no rule covers. Unmatched commands fall through to the
 * auto-mode classifier, which is nondeterministic.
 *
 * Measured across all 497 obot-merge invocations in the session transcripts:
 * the 7 written in a matching form were allowed 7 of 7; every one of the 17
 * denials in the corpus sits in the 490 that matched nothing. Two finished pull
 * requests (obot.agent#150, #158) sat blocked overnight on that ~3.5% coin flip,
 * and obot.roadmap#217 was denied and then allowed on the byte-identical string
 * three minutes later.
 *
 * Nothing denies the merge lane. The decorations agents add out of habit —
 * a `bash` prefix, `| tail -20`, `cd … &&`, a trailing `; echo "exit=$?"` — are
 * what cost them the rule match. These tests keep the documented form in the
 * shape the allowlist can actually match, so the docs cannot drift back.
 */

// Files an agent reads before running a merge. If one of these shows a decorated
// invocation, agents copy it.
const AGENT_FACING = [
  'AGENTS.md',
  'templates/sibling-briefing.md',
  'docs/rc-framework.md',
  'skills/session-spawn/SKILL.md',
  'skills/session-reviews/SKILL.md',
  'skills/session-init/SKILL.md',
  'skills/navigator/SKILL.md',
  'skills/rc-release-notes/SKILL.md',
];

const ALLOWLIST_PREFIXES = [
  'scripts/obot-merge ',
  'obot.agent/scripts/obot-merge ',
  '/Users/jwildfire/Documents/obot2/obot.agent/scripts/obot-merge ',
];

/** Split a command the way the permission layer does before prefix-matching. */
function subCommands(cmd) {
  return cmd
    .split(/\|\||&&|\||;/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when every sub-command starts with an allowlisted prefix. */
export function matchesAllowlist(cmd) {
  const subs = subCommands(cmd);
  if (subs.length === 0) return false;
  return subs.every((s) => ALLOWLIST_PREFIXES.some((p) => s.startsWith(p)));
}

/**
 * Pull invocation examples out of a doc: lines where obot-merge is being RUN
 * (a path form followed by arguments), not merely named in prose. Prose refers
 * to it as `obot-merge` or `scripts/obot-merge` with no arguments after it.
 */
function invocationsIn(text) {
  const found = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^[-*]\s+/, '');
    // A runnable example: an optional `bash `/`./` lead-in, a path ending in
    // obot-merge, then at least one argument.
    const m = line.match(/(?:^|`|\s)((?:bash\s+)?(?:\.\/)?[\w./-]*obot-merge\s+[^`\n]*)/);
    if (!m) continue;
    let cmd = m[1].trim().replace(/`+$/, '').trim();
    // Drop trailing prose/comments that are not part of the command.
    cmd = cmd.replace(/\s+#.*$/, '').trim();
    // Arguments must look like a real invocation, not a sentence.
    if (!/(^|\s)(-R|--\w|<pr#?>|<repo>|\d+)(\s|$)/.test(cmd)) continue;
    // Prose that happens to contain the word after it, e.g. "obot-merge refuses".
    if (/obot-merge\s+(refuses|warns|itself|only|call|and|is|does|reads|never|under)\b/.test(cmd)) continue;
    found.push({ line: raw.trim(), cmd });
  }
  return found;
}

test('every documented obot-merge example is in a form the allowlist matches', () => {
  const offenders = [];
  for (const rel of AGENT_FACING) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    for (const { line, cmd } of invocationsIn(fs.readFileSync(file, 'utf8'))) {
      // Placeholder examples use <pr#>/<repo>; normalise so the prefix check is
      // about the shape of the command, not about the sample values.
      const normalised = cmd.replace(/<pr#?>/g, '1').replace(/<[\w/ ]+>/g, 'x');
      if (!matchesAllowlist(normalised)) offenders.push(`${rel}: ${line}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these documented examples match no permission rule and would fall through to the classifier:\n  ${offenders.join('\n  ')}`,
  );
});

test('the sibling briefing tells a worker to run the command undecorated', () => {
  const brief = fs.readFileSync(path.join(ROOT, 'templates/sibling-briefing.md'), 'utf8');
  assert.match(
    brief,
    /single command/i,
    'the briefing every sibling receives must say the merge command is run as a single command',
  );
  assert.match(
    brief,
    /\|\s*tail|pipe/i,
    'it must name the pipe specifically — that is the decoration workers actually add',
  );
});

test('the matcher agrees with what the transcripts recorded', () => {
  // The three strings that were denied, verbatim from the transcripts.
  assert.equal(
    matchesAllowlist('bash scripts/obot-merge 150 -R jwildfire/obot.agent --squash --delete-branch 2>&1 | tail -15'),
    false,
  );
  assert.equal(matchesAllowlist('bash scripts/obot-merge 158 -R jwildfire/obot.agent 2>&1 | tail -20'), false);
  assert.equal(
    matchesAllowlist(
      'bash /Users/jwildfire/Documents/obot2/obot.agent/scripts/obot-merge 217 -R jwildfire/obot.roadmap --merge 2>&1 | tail -8',
    ),
    false,
  );

  // Each decoration on its own is enough to lose the match.
  assert.equal(matchesAllowlist('scripts/obot-merge 158 -R jwildfire/obot.agent | tail -5'), false, 'a pipe');
  assert.equal(matchesAllowlist('bash scripts/obot-merge 158 -R jwildfire/obot.agent'), false, 'a bash prefix');
  assert.equal(matchesAllowlist('./scripts/obot-merge 158 -R jwildfire/obot.agent'), false, 'a ./ prefix');
  assert.equal(
    matchesAllowlist('cd obot.agent && scripts/obot-merge 158 -R jwildfire/obot.agent'),
    false,
    'a cd compound',
  );
  assert.equal(
    matchesAllowlist('scripts/obot-merge 158 -R jwildfire/obot.agent; echo "exit=$?"'),
    false,
    'a trailing echo',
  );

  // The forms that do match, one per allowlist rule.
  assert.equal(matchesAllowlist('scripts/obot-merge 158 -R jwildfire/obot.agent --squash'), true);
  assert.equal(matchesAllowlist('obot.agent/scripts/obot-merge 158 -R jwildfire/obot.agent --check'), true);
  assert.equal(
    matchesAllowlist('/Users/jwildfire/Documents/obot2/obot.agent/scripts/obot-merge 158 -R jwildfire/obot.agent'),
    true,
  );

  // Redirection is not a sub-command separator, so it keeps the match.
  assert.equal(matchesAllowlist('obot.agent/scripts/obot-merge 158 -R jwildfire/obot.agent 2>&1'), true);
});
