import { test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * No copy-pasteable command in this repo tells an agent to write to GitHub on the
 * ambient token — obot.agent#197.
 *
 * The wrapper and the PreToolUse guard remove the class at the moment a write runs.
 * This test removes it one step earlier, where the habit is actually formed. Agents
 * do not invent `gh issue edit --add-label`; they copy it out of a skill, a doc, or
 * a briefing template. That is precisely how the `bash ` prefix spread to every tool
 * invocation in the repo (#180) — generalised from the shape of what was written
 * down, not from any one instruction. Fixing the running command without fixing what
 * is written down leaves the source of the habit intact.
 *
 * SCOPE: fenced code blocks only. Those are the copy-paste surface — what an agent
 * lifts and runs. Inline-code prose is discussion, and it has to stay free: the
 * paragraphs explaining this very bug cannot be written at all if the sentence "the
 * app token was passed to `gh issue create`" is itself a violation.
 */

const DOC_DIRS = ['skills', 'docs', 'templates', 'commands', 'goals'];
const DOC_FILES = ['AGENTS.md', 'README.md', 'agent.md'];

/** A gh invocation that writes. Reads (view, list, search, item-list) are absent by
 *  construction — only the writing verbs are named. */
const GH_WRITE = new RegExp(
  String.raw`\bgh\s+(?:` +
  String.raw`(?:issue|pr)\s+(?:edit|create|comment|close|reopen|lock|unlock|pin|unpin|transfer|delete|develop|ready)` +
  String.raw`|label\s+(?:create|edit|delete|clone)` +
  String.raw`|project\s+(?:item-add|item-edit|item-delete|item-archive|create|edit|delete|copy|link|unlink|field-create|field-delete|mark-template)` +
  String.raw`|release\s+(?:create|edit|delete|upload|delete-asset)` +
  String.raw`|api\b[^\n]*(?:-X|--method)\s+(?:POST|PATCH|PUT|DELETE)` +
  String.raw`)`,
);

/** Already attributed: routed through a wrapper, or carrying a token that is not
 *  empty. `GH_TOKEN=` with nothing after it used to pass this check on the strength
 *  of the letters — the same mistake the guard itself made, and the one that put a
 *  write in @jwildfire's history (#207): `gh` reads an empty token as no token and
 *  falls back to his credential, so a fenced line spelling it teaches exactly the
 *  write this file exists to keep out of the documentation. */
const ATTRIBUTED = /obot-(?:gh|merge)\b|(?:GH_TOKEN|GITHUB_TOKEN)=(?!\s|$|""|'')\S/;

function docs(dir, rel = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.claude'].includes(entry.name)) continue;
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...docs(full, r));
    else if (entry.isFile() && /\.md$/.test(entry.name)) out.push([r, full]);
  }
  return out;
}

/** Every line inside a ``` fence, with its 1-based line number. */
function fencedLines(text) {
  const out = [];
  let inFence = false;
  text.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return; }
    if (inFence) out.push([i + 1, line]);
  });
  return out;
}

test('no fenced command writes to GitHub on the ambient token', () => {
  const targets = [
    ...DOC_DIRS.flatMap((d) => docs(path.join(ROOT, d), d)),
    ...DOC_FILES.filter((f) => fs.existsSync(path.join(ROOT, f))).map((f) => [f, path.join(ROOT, f)]),
  ];
  assert.ok(targets.length > 10, 'expected to find the repo documentation');

  const offenders = [];
  for (const [rel, full] of targets) {
    for (const [n, line] of fencedLines(fs.readFileSync(full, 'utf8'))) {
      if (GH_WRITE.test(line) && !ATTRIBUTED.test(line)) offenders.push(`${rel}:${n}  ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [],
    'these fenced commands write to GitHub as @jwildfire — route them through ' +
    'obot.agent/scripts/obot-gh (obot.agent#197):\n' + offenders.join('\n'));
});

test('an empty token does not count as attribution in the documentation either', () => {
  // The doc check and the guard have to agree about what a credential is, or the
  // repo can document a command the guard refuses - or worse, one it admits and
  // should not. These are the strings, run against the same rules the sweep uses.
  const flagged = (line) => GH_WRITE.test(line) && !ATTRIBUTED.test(line);
  assert.equal(flagged('GH_TOKEN= gh issue edit 1 --add-label bug'), true);
  assert.equal(flagged('GH_TOKEN="" gh issue edit 1 --add-label bug'), true);
  assert.equal(flagged("GITHUB_TOKEN='' gh label create x"), true);
  assert.equal(flagged('gh issue edit 1 --add-label bug'), true);
  // ...and the forms the briefing actually teaches stay clean.
  assert.equal(flagged('GH_TOKEN=$T gh issue comment 1 --body-file /tmp/b.md'), false);
  assert.equal(flagged('obot.agent/scripts/obot-gh issue edit 1 --add-label bug'), false);
  assert.equal(flagged('gh issue view 1 --json title'), false);
});

test('a failed mint stops the write instead of emptying the token (#207)', () => {
  // The defect the wrapper itself shipped with, and the sharpest instance of the
  // house failure mode: it printed "token mint failed", then ran the write anyway
  // and exited 0. `env GH_TOKEN="$(mint)" gh "$@"` discards the substitution's exit
  // status — `fail`'s `exit 1` inside `$( )` only leaves the subshell — so GH_TOKEN
  // became the empty string, `gh` read empty as unset, and the write went out on the
  // ambient credential: as @jwildfire, from the wrapper built to prevent exactly that.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obot-gh-mint-'));
  try {
    const failingMint = path.join(dir, 'failmint');
    fs.writeFileSync(failingMint, '#!/bin/bash\necho "mint failed: simulated" >&2\nexit 1\n');
    fs.chmodSync(failingMint, 0o755);

    // A stand-in `gh` that records the fact it ran at all. If the wrapper reaches it,
    // a real write would have reached GitHub.
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    const ranMarker = path.join(dir, 'gh-ran');
    fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/bash\ntouch ${ranMarker}\n`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);

    const res = spawnSync(path.join(ROOT, 'scripts/obot-gh'),
      ['issue', 'edit', '1', '-R', 'jwildfire/obot.agent', '--add-label', 'bug'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
               OBOT_APP_TOKEN_CMD: failingMint, OBOT_GH_TOKEN: '' },
      });

    assert.equal(fs.existsSync(ranMarker), false,
      'obot-gh ran gh after the mint failed — the write would have gone out as @jwildfire');
    assert.notEqual(res.status, 0, 'obot-gh must exit non-zero when the mint fails');
    assert.match(res.stderr, /mint failed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the wrapper is executable and refuses to become a merge lane', () => {
  const wrapper = path.join(ROOT, 'scripts/obot-gh');
  assert.ok(fs.existsSync(wrapper), 'scripts/obot-gh must exist — the guard names it');
  assert.ok(fs.statSync(wrapper).mode & 0o111, 'scripts/obot-gh must be executable');
  const src = fs.readFileSync(wrapper, 'utf8');
  // Without this, `obot-gh pr merge` is a hole in merge-gate-guard: that hook matches
  // a bare `gh pr merge`, and the wrapped spelling does not look like one to it.
  assert.match(src, /"\$\{1:-\}" = "pr" \]\] ?&& \[ "\$\{2:-\}" = "merge"|= "pr" \] && \[ "\$\{2:-\}" = "merge"/,
    'obot-gh must refuse `pr merge` and send it to obot-merge');
});
