// The hand-off, on a machine with no history.
//
// Requirement: jwildfire/obot.roadmap#223, task jwildfire/obot.agent#306. Worker W0105.
//
// This is the first paint of every session — `session-init` renders it before anything
// else runs — so on the new laptop it is the first thing the programme says for itself.
// Rehearsed against a scratch `HOME` and a workspace holding nothing but fresh clones,
// it printed:
//
//   === SCRATCHPAD ===
//   === DIARY ===
//   file: …/obot.roadmap/diary/2026-08-18.md (age: 10m)
//   … 12 config items are open on the local list …
//   === MEMORY ===
//   === SWEEP CACHE ===
//   cache age: cold
//
// Three separate readings of the same defect. Two headings with nothing under them and
// no sentence, which reads as "there was nothing worth noting" rather than "this
// machine has no record". And a three-day-old diary entry stamped ten minutes old,
// because the age comes from the file's mtime and on a fresh clone every file's mtime
// is the moment it was cloned — so the staleness guard is blind on exactly the machine
// where everything is stale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HANDOFF = path.join(HERE, '..', 'handoff.sh');

function run(ws) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-home-'));
  const r = spawnSync('bash', [HANDOFF], {
    encoding: 'utf8', env: { ...process.env, HOME: home, OBOT_WORKSPACE: ws },
  });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

/** A section's body: everything between its heading and the next one. */
function body(out, heading) {
  const lines = out.split('\n');
  const i = lines.indexOf(`=== ${heading} ===`);
  assert.notEqual(i, -1, `the ${heading} heading is gone`);
  const rest = lines.slice(i + 1);
  const end = rest.findIndex((l) => /^=== .* ===$/.test(l));
  return rest.slice(0, end === -1 ? rest.length : end).join('\n').trim();
}

test('no section is silently empty on a machine with no record', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-ws-'));
  const out = run(ws);
  for (const heading of ['SCRATCHPAD', 'DIARY', 'MEMORY']) {
    const text = body(out, heading);
    assert.notEqual(text, '', `${heading} renders as a heading with nothing under it`);
    assert.match(text, /no .*(on this machine|yet)/i,
      `${heading} does not say that this machine has no record rather than that there was nothing to say`);
  }
});

test('a diary entry is dated by the day it is for, not by when it was cloned', () => {
  // Every file in a fresh clone has today's mtime, so a hand-off reading age off the
  // filesystem tells a session on a new machine that a three-day-old entry is minutes
  // old — and the whole point of printing the age is to say when not to trust it.
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-ws-'));
  const diary = path.join(ws, 'obot.roadmap', 'diary');
  fs.mkdirSync(diary, { recursive: true });
  const day = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10);
  fs.writeFileSync(path.join(diary, `${day}.md`), '## 🙋 ToDo\n\n- something\n');  // mtime: now
  const text = body(run(ws), 'DIARY');
  assert.doesNotMatch(text, /age: [0-9]m\b/, 'a file written three days ago, stamped minutes old');
  assert.match(text, /age: 3d|age: 4[0-9]{3}m/, 'the age has to come from the day the entry is for');
});
