// The census's gate half: does anything run it when nobody types it?
//
// Task jwildfire/obot.agent#311, under requirement jwildfire/obot.roadmap#289, whose
// Done-when says: "A check fails if any surface reintroduces its own copy."
//
// The census was written (#295) and made honest about what it could not read (#309),
// and then it sat there. `grep` across .github/workflows/, tools/navigator/ and
// scripts/ named it nowhere outside its own tests and its own documentation, so the
// requirement read as delivered while the property it protects was unguarded. These
// tests are written against the caller rather than against the check, because the
// check was never the part that was missing.
//
// Two callers, two jobs, and this file is the gate one. CI checks out obot.agent
// alone, so it can only ever speak for this repository's surfaces — and it is the
// only place that can stop a pull request. The detector half, which is the only
// vantage point where all nine declared roots exist at once, is the Navigator sweep
// and lives in tools/navigator/test/style.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { REPO } from '../census.mjs';

const WORKFLOW = path.join(REPO, '.github/workflows/test.yml');
const yaml = () => fs.readFileSync(WORKFLOW, 'utf8');

/**
 * One step of the workflow, as its raw block of lines. Parsed by indentation rather
 * than with a YAML library because this repository has no dependencies and adding one
 * to read six lines would be the larger change.
 */
function step(name) {
  const lines = yaml().split('\n');
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  if (at < 0) return null;
  const indent = lines[at].indexOf('-');
  const out = [lines[at]];
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && l.search(/\S/) <= indent) break;
    out.push(l);
  }
  return out.join('\n');
}

test('CI runs the census, so a pull request that reintroduces a palette cannot merge', () => {
  const s = step('Style census');
  assert.ok(s, 'no workflow step runs the census — #289\'s "a check fails" is a description of one');
  assert.match(s, /tools\/style-census/, 'the step has to run the census itself, not a paraphrase of it');
});

test('the gate\'s exit code cannot be swallowed by the pipe that publishes it', () => {
  // The trap, and it is silent: GitHub's DEFAULT shell for `run:` is `bash -e {0}`
  // with no `pipefail`, so `census | tee` exits with tee's status and a red census
  // renders as a green tick. `shell: bash` is what asks for `-eo pipefail`. A gate
  // that cannot fail is the exact defect this task exists to remove, so if the step
  // pipes, it must say which shell it wants.
  const s = step('Style census');
  assert.ok(s, 'no step to judge — the gate is not wired at all');
  if (!s.includes('|')) return;
  assert.match(s, /shell:\s*bash/,
    'the step pipes the census into something, and without an explicit `shell: bash` the pipeline\'s exit code is the LAST command\'s — the census could exit 1 and CI would still be green');
});

test('what the run could NOT read is published where a person looks, not only in a log', () => {
  // `unknown` has to survive the last mile. A green tick whose meaning is "no drift
  // among the four roots I could not read" is the same defect one layer up, wearing a
  // check mark — so the verdict goes onto the run's summary page, which is rendered,
  // rather than into step output nobody opens.
  const s = step('Style census');
  assert.match(s, /GITHUB_STEP_SUMMARY/, 'the verdict has to reach the run page');
  assert.match(s, /--md/, 'and in the markdown form, which is what a summary page renders');
});

// ------------------------------------------------- the gate, run rather than read

/** The workflow's own command, executed — not a paraphrase of it. */
function runGate(dests, t) {
  const s = step('Style census');
  const cmd = /run:\s*(.+)/.exec(s)[1].trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'style-gate-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const summary = path.join(tmp, 'summary.md');
  const env = {
    ...process.env,
    GITHUB_STEP_SUMMARY: summary,
    OBOT_STYLE_DEST: Object.entries(dests).map(([r, d]) => `${r}:${d}`).join(','),
  };
  try {
    const out = execFileSync('bash', ['-eo', 'pipefail', '-c', cmd], { cwd: REPO, encoding: 'utf8', env });
    return { out, code: 0, summary: fs.readFileSync(summary, 'utf8') };
  } catch (err) {
    return { out: String(err.stdout ?? ''), code: err.status ?? 1, summary: fs.existsSync(summary) ? fs.readFileSync(summary, 'utf8') : '' };
  }
}

/** A machine with only this repository on it — the shape the runner is actually in. */
const bare = (t) => ({
  'obot.roadmap': path.join(REPO, 'tools/style/test/__absent/obot.roadmap'),
  'safety.viz': path.join(REPO, 'tools/style/test/__absent/safety.viz'),
  'open.gismo': path.join(REPO, 'tools/style/test/__absent/open.gismo'),
  'open.csr': path.join(REPO, 'tools/style/test/__absent/open.csr'),
});

test('on the runner the gate is green, and says out loud that green means "for what I could read"', (t) => {
  const { code, summary } = runGate(bare(t), t);
  assert.equal(code, 0, 'an absent clone is not a defect anybody on the runner can fix, and a check that is red for an unfixable reason gets switched off');
  assert.match(summary, /unknown, not clean/i, 'and the run page has to carry the qualification, or the tick reads as a clean bill of health');
  for (const repo of ['obot.roadmap', 'safety.viz', 'open.gismo', 'open.csr']) {
    assert.ok(summary.includes(`${repo} is not on this machine`), `${repo} went unexamined and the run page has to name it`);
  }
});

test('the gate goes red when a surface reintroduces its own palette, and green when it goes', (t) => {
  // The requirement's sentence, executed. A gate first watched succeeding proves
  // nothing: green because nothing was checked is indistinguishable from green
  // because nothing was wrong.
  const rel = 'tools/style/test/__gate-reintroduced.mjs';
  const file = path.join(REPO, rel);
  t.after(() => fs.rmSync(file, { force: true }));

  assert.equal(runGate(bare(t), t).code, 0, 'precondition: this repository is accounted for before the copy is reintroduced');

  fs.writeFileSync(file, [
    'export const CSS = `',
    '  :root { --paper:#F4F1EC; --card:#FDFCFA; --ink:#26211B; --accent:#B4470E; --rule:#E3DDD4; }',
    '`;',
  ].join('\n'));
  const red = runGate(bare(t), t);
  assert.equal(red.code, 1, 'a merge that reintroduces a palette has to be blocked');
  assert.match(red.summary, /STYLE CENSUS GAP/, 'and the run page has to name it as drift rather than as an absence');
  assert.ok(red.summary.includes(`obot.agent/${rel}`), 'naming the file, so the failure is actionable from the run page alone');

  fs.rmSync(file);
  assert.equal(runGate(bare(t), t).code, 0, 'and green again once the copy is gone');
});
