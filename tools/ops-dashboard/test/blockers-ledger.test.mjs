// The config list's ledger: how an id is claimed, and how the list proves it did
// not quietly lose one.
//
// The incident this suite exists for (obot.agent#126). On 2026-08-15 an agent
// rewrote `.claude/blockers.md` and put a FORWARD cross-reference in an entry
// body - "See c0011 for the same problem in obot.agent" - naming an id it had
// predicted but not yet claimed. The allocator matched every `cNNNN` in the whole
// file text and could not tell an identifier from a mention, so the next two real
// items were filed as c0012/c0013 and the numbers under them were burned. A minute
// later the cross-reference was corrected to c0013 and the only trace of c0011
// disappeared with it.
//
// For a day that read as two entries lost from a list that has no history, no
// backup and no integrity check - the ledger of everything only @jwildfire's hands
// can do. Nothing had been lost. But nothing would have told us if it had, and
// that is the actual defect these tests pin down.

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFile } from 'node:child_process';

const LOG = new URL('../../blocker-log', import.meta.url).pathname;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'blkint-'));
const mdFile = (ws) => path.join(ws, '.claude', 'blockers.md');
const jrnl = (ws) => path.join(ws, '.claude', 'blockers.journal');
const read = (f) => fs.readFileSync(f, 'utf8');

// The IQ flags every entry needs since obot.agent#122; the point of these tests is
// the id and the ledger, so the protocol itself is boilerplate here.
const iq = (n) => ['--do', `type ${n}`, '--expect', `${n} is there`,
  '--verify', `test -f /tmp/${n} -> the file exists`, '--source', 'a session'];

const run = (ws, args, env = {}) => {
  const r = spawnSync(LOG, args, {
    env: { ...process.env, OBOT_WORKSPACE: ws, ...env }, encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};
const file = (ws, what, env) => run(ws, [what, ...iq(what.replace(/\W/g, ''))], env);
const openIds = (ws) => [...read(mdFile(ws)).matchAll(/^-\s+\[[ x]\]\s*(c\d{4})\b/gim)].map((m) => m[1]);

test('a cNNNN written in prose does not burn an id', () => {
  const ws = tmp();
  file(ws, 'first item');
  file(ws, 'second item');
  // The exact shape of the incident: a forward cross-reference to an id nobody
  // has claimed, written into an entry body.
  fs.appendFileSync(mdFile(ws), '\n      Why: same shape as c0099, in another repo.\n');
  assert.match(file(ws, 'third item').stdout, /filed c0003 /);
});

test('a retired entry keeps its number', () => {
  const ws = tmp();
  file(ws, 'first item');
  file(ws, 'second item');
  run(ws, ['--retire', 'c0002', '--reason', 'folded into c0001']);
  assert.match(file(ws, 'third item').stdout, /filed c0003 /);
  const md = read(mdFile(ws));
  assert.match(md.slice(md.indexOf('## Resolved')), /c0002/);
});

test('an entry deleted by hand does not free its id, and the gap is named out loud', () => {
  const ws = tmp();
  file(ws, 'first item');
  file(ws, 'second item');
  // Ordinary file tools bypass the capture tool entirely - this is the failure the
  // list has no defence against, so the least it can do is notice.
  const lines = read(mdFile(ws)).split('\n');
  const start = lines.findIndex((l) => /^-\s+\[ \]\s*c0002\b/.test(l));
  let end = start + 1;
  while (end < lines.length && !/^(- |## )/.test(lines[end])) end++;
  lines.splice(start, end - start);
  fs.writeFileSync(mdFile(ws), lines.join('\n'));

  const out = file(ws, 'third item');
  assert.match(out.stdout, /filed c0003 /, 'a deleted entry must not free its number');
  assert.match(out.stderr, /c0002/, 'the missing id must be named');
  assert.match(out.stderr, /GAP/i, 'and named as a gap, not buried in prose');
});

test('--audit is read-only, and its exit code is the verdict', () => {
  const ws = tmp();
  file(ws, 'first item');
  const clean = run(ws, ['--audit']);
  assert.equal(clean.status, 0);
  const before = read(mdFile(ws));

  const lines = read(mdFile(ws)).split('\n').filter((l) => !/^-\s+\[ \]\s*c0001\b/.test(l));
  fs.writeFileSync(mdFile(ws), lines.join('\n'));
  const dirty = run(ws, ['--audit']);
  assert.equal(dirty.status, 1, 'a gap must fail the check, so a caller can act on it');
  assert.match(dirty.stdout + dirty.stderr, /c0001/);
  // Read-only: the dashboard runs this on a click and it must not write.
  fs.writeFileSync(mdFile(ws), before);
  const j = read(jrnl(ws));
  run(ws, ['--audit']);
  assert.equal(read(jrnl(ws)), j, '--audit must not append to the journal');
});

test('an edit made outside the tool is recorded, but is not itself an alarm', () => {
  const ws = tmp();
  file(ws, 'first item');
  fs.appendFileSync(mdFile(ws), '\na line typed by hand\n');
  const a = run(ws, ['--audit']);
  assert.equal(a.status, 0, 'hand-editing the list is allowed - he ticks things off');
  assert.match(a.stdout + a.stderr, /outside/i, 'but it is dated, so a gap can be placed');
});

test('concurrent captures all survive, each with its own id', async () => {
  const ws = tmp();
  file(ws, 'seed item');
  // Measured against the unlocked tool on 2026-08-16, three runs of this size:
  // 20, 5 and 22 of the 24 entries survived, with a duplicated id in the first.
  // The clobber is neither theoretical nor rare - it is what a busy night does.
  const N = 24;
  // Zero-padded: dedup matches on the headline as a substring, so a bare
  // "item 2" would be correctly refused as a re-file of "item 20".
  await Promise.all(Array.from({ length: N }, (_, i) => new Promise((res, rej) => {
    const n = String(i).padStart(2, '0');
    execFile(LOG, [`parallel item ${n}`, ...iq(`p${n}`)],
      { env: { ...process.env, OBOT_WORKSPACE: ws } }, (e) => (e ? rej(e) : res()));
  })));
  const ids = openIds(ws);
  // Several sessions write this file on a normal night. Read-modify-write with no
  // lock loses entries; that is the race that has been open all along.
  assert.equal(ids.length, N + 1, 'every concurrent capture must be in the file');
  assert.equal(new Set(ids).size, N + 1, 'and no id may be handed out twice');
});

test('a list that predates the journal is adopted conservatively, once', () => {
  const ws = tmp();
  fs.mkdirSync(path.join(ws, '.claude'), { recursive: true });
  fs.writeFileSync(mdFile(ws), [
    '# Blockers', '', '## Open', '',
    '- [ ] c0002 · filed 2026-08-15 — **an old item**',
    '      Why: see c0099 for the same thing.', '', '## Resolved', '',
  ].join('\n'));
  // With no history behind us the old whole-text rule is kept for exactly one
  // reading: a burned id costs nothing, and a REUSED id corrupts a record he may
  // have approved in chat months ago.
  assert.match(file(ws, 'first new item').stdout, /filed c0100 /);
  // From the next claim on, the journal is the authority and prose is inert.
  fs.appendFileSync(mdFile(ws), '\n      Why: and see c0200 as well.\n');
  assert.match(file(ws, 'second new item').stdout, /filed c0101 /);
});

test('the journal only ever grows, and records who wrote each line', () => {
  const ws = tmp();
  file(ws, 'first item', { OBOT_ACTOR: 'the-first-agent' });
  const first = read(jrnl(ws));
  file(ws, 'second item', { OBOT_ACTOR: 'the-second-agent' });
  run(ws, ['--retire', 'c0001', '--reason', 'done'], { OBOT_ACTOR: 'the-third-agent' });
  const later = read(jrnl(ws));
  assert.ok(later.startsWith(first), 'earlier journal lines must stay byte-identical');
  // Naming the actor is what turns "two ids vanished" into "this session did it".
  for (const a of ['the-first-agent', 'the-second-agent', 'the-third-agent']) {
    assert.match(later, new RegExp(a));
  }
  assert.match(later, /"op": ?"retire"/);
});

test('adoption records the holes the sequence already had, without calling them a loss', () => {
  const ws = tmp();
  fs.mkdirSync(path.join(ws, '.claude'), { recursive: true });
  // The real shape on 2026-08-16: ids run to c0013, but c0010 and c0011 name nothing.
  fs.writeFileSync(mdFile(ws), [
    '# Blockers', '', '## Open', '',
    '- [ ] c0009 · filed 2026-08-15 — **an item**',
    '- [ ] c0012 · filed 2026-08-16 — **another item**',
    '- [ ] c0013 · filed 2026-08-16 — **a third item**', '', '## Resolved', '',
  ].join('\n'));
  const out = file(ws, 'the first tracked item');
  assert.match(out.stderr, /unaccounted/i);
  assert.match(out.stderr, /c0010, c0011/);
  const seed = JSON.parse(read(jrnl(ws)).split('\n')[0]);
  assert.deepEqual(seed.unaccounted.slice(-2), ['c0010', 'c0011']);
  // Recorded, not alarmed on: a hole nobody can explain must not make every future
  // run cry wolf, or the one that matters gets ignored.
  assert.equal(run(ws, ['--audit']).status, 0);
  assert.doesNotMatch(run(ws, ['--audit']).stdout, /GAP/);
});

test('the verdict is the first line, even when there is a note to make', () => {
  const ws = tmp();
  file(ws, 'first item');
  // Hand-editing the list is normal — he ticks things off — so this is the common
  // case, not the exception. Callers summarise by first line; if the note led, the
  // verdict would be displaced on almost every reading.
  fs.appendFileSync(mdFile(ws), '\na line typed by hand\n');
  const out = run(ws, ['--audit']).stdout.trim().split('\n');
  assert.match(out[0], /ledger clean/);
  assert.match(out.slice(1).join('\n'), /changed outside/);
});

test('a gap still leads, because it outranks any note', () => {
  const ws = tmp();
  file(ws, 'first item');
  file(ws, 'second item');
  const kept = read(mdFile(ws)).split('\n').filter((l) => !/^-\s+\[ \]\s*c0002\b/.test(l));
  fs.writeFileSync(mdFile(ws), kept.join('\n') + '\na line typed by hand\n');
  const r = run(ws, ['--audit']);
  assert.equal(r.status, 1);
  assert.match(r.stdout.trim().split('\n')[0], /LEDGER GAP/);
});
