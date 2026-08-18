import { test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * How an agent is taught to type an obot.agent tool — obot.agent#180.
 *
 * `ops-answers` is JavaScript with a `#!/usr/bin/env node` shebang and mode 755, so
 * `bash obot.agent/tools/ops-answers pending` cannot work at all. obot-prime ran it
 * that way on 2026-08-17 and reported the bounded read as broken. Nothing in the repo
 * had ever written that command with a `bash ` prefix; what the repo had written, in
 * every slash command and half the skills, was `bash obot.agent/tools/<something
 * else>` — because those others happen to be shell scripts. The prefix is not copied
 * from the tool's own documentation. It is generalised from the shape of every other
 * tool invocation an agent reads, which is why fixing one line would not have fixed
 * anything.
 *
 * This is the second tool that habit has cost. It broke `obot-merge` for two days
 * (obot.agent#162) by a different mechanism — there the prefix is legal and simply
 * defeats the permission allowlist, so the call falls through to a nondeterministic
 * classifier and two finished pull requests sat overnight. Two tools makes it a habit
 * rather than an incident.
 *
 * THE RULE, and it is a fact about the file rather than a convention:
 *
 *   An EXECUTABLE file (mode 755, carrying its own shebang) is run by its bare path.
 *   The shebang already names the interpreter, and prefixing a different one is at
 *   best redundant and at worst — as with `ops-answers` — simply wrong.
 *
 *   A NON-EXECUTABLE module is not a command. `tools/session-hub/session-hub.mjs` is
 *   mode 644 and genuinely needs `node` in front of it. Those are left exactly as
 *   they are; a blanket "never write an interpreter" rule would be false, and a false
 *   rule is one more thing agents learn to ignore.
 *
 * So the test asks the filesystem, not a list.
 */

const PREFIX = /^(?:bash|sh|zsh|node|python3?|ruby)\s+$/;

/** Every executable file the repo tracks, by its repo-relative path. */
function executables(dir = ROOT, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir), { withFileTypes: true })) {
    if (['.git', 'node_modules', '__pycache__', '.claude'].includes(entry.name)) continue;
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { out.push(...executables(path.join(dir, entry.name), r)); continue; }
    if (!entry.isFile()) continue;
    const mode = fs.statSync(path.join(dir, entry.name)).mode;
    if (mode & 0o111) out.push(r);
  }
  return out;
}

/**
 * Everything an agent reads before running something — documentation, skills, slash
 * commands, the tools' own printed messages, and the tools themselves.
 *
 * Three exclusions, each for a reason:
 *
 *   `drafts/` and `NEWS.md` are the RECORD. A draft says what was written at the
 *   time and a shipped release note is history; neither is where anyone looks up how
 *   to run something, and rewriting either would be editing the record.
 *
 *   `test/` directories have to be able to SPELL the wrong form. The whole point of
 *   merge-invocation.test.mjs is the strings that were refused, and this file quotes
 *   the command that could not work. A guard that forbade its own subject matter
 *   would be unwritable.
 */
function agentFacing(dir = ROOT, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '__pycache__', '.claude', 'drafts', 'test'].includes(entry.name)) continue;
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { out.push(...agentFacing(path.join(dir, entry.name), r)); continue; }
    if (r === 'NEWS.md') continue;
    // Extensions, plus the extension-less executables — a tool that prints an
    // invocation in its own help text teaches as loudly as a skill does.
    const exec = fs.statSync(path.join(dir, entry.name)).mode & 0o111;
    if (/\.(md|mjs|sh|py)$/.test(entry.name) || exec) out.push(r);
  }
  return out;
}

/**
 * Invocations of `tool` in `text` that put an interpreter or a `./` in front of it.
 *
 * Matched on the path as written, so `tools/ops-answers` and
 * `~/Documents/obot2/obot.agent/tools/ops-answers` are both found, and a bare mention
 * of the tool's name in prose is not.
 */
function prefixedUses(text, tool) {
  const base = tool.split('/').pop();
  const found = [];
  for (const raw of text.split('\n')) {
    // Every occurrence of a path ending in this tool, with whatever precedes it.
    const re = new RegExp(`([A-Za-z0-9~/_.-]*\\s+)?([A-Za-z0-9~/_.${'-'}]*/)?${base.replace(/[.]/g, '\\.')}\\b`, 'g');
    let m;
    while ((m = re.exec(raw)) !== null) {
      const dir = m[2] ?? '';
      // Only a real path to the tool counts — `ops-answers apply …` in prose does not.
      if (!dir.endsWith('tools/') && !dir.endsWith('scripts/') && !dir.endsWith('navigator/') &&
          !dir.endsWith('session-init/') && !dir.endsWith('statusline/')) continue;
      const before = raw.slice(0, m.index + (m[1] ?? '').length);
      // The interpreter can sit behind a quote, a backtick, a `$(` or a bare space —
      // `command: "bash obot.agent/tools/navigator/wake-listen"` is how one of these
      // reached a live Monitor, and a matcher that only looked after whitespace
      // missed it.
      const word = /(?:^|[\s`("'[{])([A-Za-z0-9]+)\s+$/.exec(before);
      if (word && PREFIX.test(`${word[1]} `)) found.push({ line: raw.trim(), how: word[1] });
      else if (/(^|[\s`("'])\.\/$/.test(before + dir.slice(-2))) found.push({ line: raw.trim(), how: './' });
    }
  }
  return found;
}

test('an executable obot.agent tool is documented as a bare path, never behind an interpreter', () => {
  const tools = executables().filter((f) => f.startsWith('tools/') || f.startsWith('scripts/'));
  assert.ok(tools.length > 10, 'the scan found the tools at all');

  const offenders = [];
  for (const doc of agentFacing()) {
    const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
    for (const tool of tools) {
      for (const { line, how } of prefixedUses(text, tool)) {
        offenders.push(`${doc}: \`${how}\` in front of ${tool.split('/').pop()} — ${line.slice(0, 110)}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these teach an interpreter in front of a tool that carries its own shebang:\n  ${offenders.join('\n  ')}`,
  );
});

test('the tools this rule is about really are executable and really do carry a shebang', () => {
  // The rule is a fact about the files. If one of them lost its exec bit the rule
  // would quietly become wrong, and every doc corrected under it would be broken.
  for (const rel of ['tools/ops-answers', 'tools/prime-rehydrate', 'tools/scratchpad-log',
                     'tools/blocker-log', 'tools/worker-id', 'tools/delivery-log',
                     'scripts/obot-merge', 'scripts/obot-admiral', 'tools/navigator/wake-listen']) {
    const file = path.join(ROOT, rel);
    assert.ok(fs.statSync(file).mode & 0o111, `${rel} must be executable for the bare path to work`);
    assert.match(fs.readFileSync(file, 'utf8').split('\n')[0], /^#!/, `${rel} must name its own interpreter`);
  }
});

test('a non-executable module keeps its interpreter, because it is not a command', () => {
  const rel = 'tools/session-hub/session-hub.mjs';
  const mode = fs.statSync(path.join(ROOT, rel)).mode;
  assert.equal(mode & 0o111, 0, 'if this ever becomes executable, its docs should drop the `node`');
  assert.match(
    fs.readFileSync(path.join(ROOT, 'tools/session-hub/README.md'), 'utf8'),
    /node obot\.agent\/tools\/session-hub\/session-hub\.mjs/,
    'and until then the documented form must keep it',
  );
});
