// Worker identity: how a W-id is claimed, and how the ledger proves the
// convention is actually being used rather than merely installed.
//
// The ask (@jwildfire, 2026-08-16): "I also want each worker to get a unique ID
// moving forward W000x". He asked because every agent write is authored by the
// same GitHub identity - `obotclaw[bot]` - so nothing can say which of the 33
// workers that ran in a night created which issue, and a worker's only handle
// today is a slug typed freehand at spawn and recorded nowhere.
//
// Two failures this suite exists to prevent, both already paid for once:
//
//   AN ID HANDED OUT TWICE. The config list's unlocked allocator lost writes
//   whenever two agents ran at once - 24 concurrent captures left 20, then 5,
//   then 22 entries across three measured runs, one with a duplicate id
//   (obot.agent#126). Workers spawn tighter than that: the closest two on this
//   machine were 2.4 seconds apart.
//
//   A CONVENTION THAT SHIPS AND IS NEVER USED. This is the one that would be
//   invisible. The tool lands, the skill is updated, every run reports success,
//   and no worker ever actually gets an id. Only a check against the harness's
//   own job records - reality, not self-report - can tell adoption from the
//   appearance of it, so that check is here and it is a hard failure.

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFile } from 'node:child_process';

const BIN = new URL('../../worker-id', import.meta.url).pathname;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wid-'));
const jrnl = (ws) => path.join(ws, '.claude', 'workers.journal');
const read = (f) => fs.readFileSync(f, 'utf8');

// A stand-in for ~/.claude/jobs — the harness's own record of what ran, which is
// the independent reality the audit checks the journal against.
const jobsDir = (ws) => path.join(ws, 'jobs');
const job = (ws, id, { name, state = 'done', startedAt, firstTerminalAt = null }) => {
  const d = path.join(jobsDir(ws), id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'state.json'),
    JSON.stringify({ name, state, startedAt, firstTerminalAt }));
};

const run = (ws, args, env = {}) => {
  const r = spawnSync(BIN, args, {
    env: { ...process.env, OBOT_WORKSPACE: ws, OBOT_JOBS_DIR: jobsDir(ws), ...env },
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};
const claim = (ws, slug, extra = [], env) => run(ws, ['claim', '--slug', slug, ...extra], env);
const id = (r) => r.stdout.trim();

const iso = (msFromNow = 0) => new Date(Date.now() + msFromNow).toISOString();

test('a claim prints the bare id, so a spawn command can capture it', () => {
  const ws = tmp();
  const first = claim(ws, 'alpha');
  assert.equal(first.status, 0);
  // Exactly the id and nothing else: this is consumed as WID=$(worker-id claim …),
  // so a stray word of commentary on stdout would end up inside a session name.
  assert.equal(id(first), 'W0001');
  assert.equal(id(claim(ws, 'beta')), 'W0002');
});

test('the name shape is mechanical, so the convention cannot drift from the doc', () => {
  const ws = tmp();
  const w = id(claim(ws, 'workerids'));
  const name = run(ws, ['name', w, 'workerids']).stdout.trim();
  // Id first: it is the field that must survive truncation in a narrow
  // `claude agents` row, and because the counter is monotonic, sorting by id
  // sorts chronologically anyway.
  assert.match(name, /^👯🤖 W0001 \d{4}-\d{2}-\d{2} workerids$/);
});

test('concurrent claims all survive, each with its own id', async () => {
  const ws = tmp();
  // The closest two real sibling spawns on this machine were 2.4 seconds apart,
  // and six ran at once at the peak. An unlocked read-modify-write loses claims
  // at exactly this; that race is what the shared ledger's flock closes.
  const N = 24;
  const ids = await Promise.all(Array.from({ length: N }, (_, i) => new Promise((res, rej) => {
    execFile(BIN, ['claim', '--slug', `p${String(i).padStart(2, '0')}`],
      { env: { ...process.env, OBOT_WORKSPACE: ws, OBOT_JOBS_DIR: jobsDir(ws) } },
      (e, out) => (e ? rej(e) : res(out.trim())));
  })));
  assert.equal(ids.length, N);
  assert.equal(new Set(ids).size, N, 'no id may be handed out twice');
  assert.equal(new Set(ids).size, new Set(ids).size, 'and none may be lost');
  assert.equal(read(jrnl(ws)).trim().split('\n').filter(Boolean).length, N + 1,
    'every claim must be in the journal (plus the seed)');
});

test('an id written in prose does not burn a number', () => {
  const ws = tmp();
  claim(ws, 'alpha');
  // The c0010/c0011 phantom, in the W scheme: an agent naming an id it predicted
  // but had not claimed. The allocator reads the journal, so text has no vote.
  claim(ws, 'beta', ['--task', 'follow-up to W9999, which does not exist yet']);
  assert.equal(id(claim(ws, 'gamma')), 'W0003');
});

test('a dead worker keeps its number', () => {
  const ws = tmp();
  const dead = id(claim(ws, 'stalled'));
  job(ws, 'j1', { name: `👯🤖 ${dead} 2026-08-16 stalled`, state: 'stopped', startedAt: iso(), firstTerminalAt: iso() });
  // Two workers died on 2026-08-15 - one blocked, one stopped after stalling for
  // three hours. The whole point is being able to ask what each worker did,
  // INCLUDING the ones that did nothing, so an id freed by death would be an id
  // that lies about history.
  assert.equal(id(claim(ws, 'next')), 'W0002');
  assert.match(run(ws, ['list']).stdout, /W0001/, 'a dead worker stays on the roster');
  assert.equal(run(ws, ['--audit']).status, 0, 'and dying is not a finding');
});

test('a sub-id belongs to its parent and does not advance the counter', () => {
  const ws = tmp();
  const parent = id(claim(ws, 'lead'));
  assert.equal(parent, 'W0001');
  // Subagents have no session row of their own, so they take the parent's id with
  // a `.n` suffix - the hub's D0001.n convention, for the same reason: the parent
  // is what is accountable and what gets checked.
  assert.equal(id(run(ws, ['claim', '--sub', parent, '--slug', 'research'])), 'W0001.1');
  assert.equal(id(run(ws, ['claim', '--sub', parent, '--slug', 'more'])), 'W0001.2');
  assert.equal(id(claim(ws, 'second-worker')), 'W0002', 'a sub-id is not a second worker');
});

test('--audit is read-only, and its exit code is the verdict', () => {
  const ws = tmp();
  const w = id(claim(ws, 'alpha'));
  job(ws, 'j1', { name: `👯🤖 ${w} 2026-08-16 alpha`, startedAt: iso(), firstTerminalAt: iso() });
  const before = read(jrnl(ws));
  const clean = run(ws, ['--audit']);
  assert.equal(clean.status, 0);
  assert.equal(read(jrnl(ws)), before, '--audit must not write');
});

test('a worker that spawned with no id is a finding', () => {
  const ws = tmp();
  claim(ws, 'alpha');
  // THE check. Without it this whole capability can ship, report success on every
  // run, and never actually be used - which is indistinguishable from working.
  job(ws, 'j2', { name: '👯🤖 2026-08-16 unstamped', state: 'done', startedAt: iso(), firstTerminalAt: iso() });
  const r = run(ws, ['--audit']);
  assert.equal(r.status, 1, 'an unstamped worker must fail the check');
  assert.match(r.stdout + r.stderr, /unstamped/, 'and the worker must be named');
});

test('a worker from before the convention is not a finding', () => {
  const ws = tmp();
  claim(ws, 'alpha');
  // Forward-only was his word ("moving forward") and is also the only honest
  // option: three of the workers that ran the night before left no recoverable
  // trace at all, so a backfill could never be complete. The epoch is RECORDED in
  // the seed record rather than assumed, so what is out of scope is out of scope
  // by record instead of by silence.
  job(ws, 'j0', { name: '👯🤖 2026-08-14 ancient', state: 'done', startedAt: iso(-86400000), firstTerminalAt: iso(-86000000) });
  assert.equal(run(ws, ['--audit']).status, 0);
});

test('sessions that are not workers are left alone', () => {
  const ws = tmp();
  claim(ws, 'alpha');
  // Prime is the Q&A front door and carries no deliverable; ultracode jobs are
  // tracked separately; a lead session is not a worker. Alarming on these would
  // make the check cry wolf on every sweep, and a detector nobody trusts is worse
  // than none.
  job(ws, 'p', { name: '🎩🤖 obot-prime', state: 'working', startedAt: iso() });
  job(ws, 'u', { name: '⚡️🤖 overnight audit', state: 'done', startedAt: iso(), firstTerminalAt: iso() });
  job(ws, 'l', { name: '😺🤖 2026-08-16', state: 'working', startedAt: iso() });
  assert.equal(run(ws, ['--audit']).status, 0);
});

test('the same id on two live workers is a finding', () => {
  const ws = tmp();
  const w = id(claim(ws, 'alpha'));
  job(ws, 'j1', { name: `👯🤖 ${w} 2026-08-16 alpha`, state: 'working', startedAt: iso() });
  job(ws, 'j2', { name: `👯🤖 ${w} 2026-08-16 copy`, state: 'working', startedAt: iso() });
  const r = run(ws, ['--audit']);
  assert.equal(r.status, 1, 'a reused id means the journal and reality disagree');
  assert.match(r.stdout + r.stderr, /W0001/);
});

test('the verdict is the first line, even when there is a note', () => {
  const ws = tmp();
  claim(ws, 'never-launched');
  // A claim whose spawn failed is a NOTE, not a finding - the id is burned, and
  // burned ids are correct. But the Navigator summarises this output by its first
  // line, and when the config ledger printed its note first the verdict vanished
  // from nearly every sweep while looking healthy (obot.agent#129).
  const r = run(ws, ['--audit']);
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split('\n');
  assert.match(lines[0], /ledger clean/);
  assert.match(lines.slice(1).join('\n'), /never launched|unlaunched/i);
});

test('a finding still leads, because it outranks any note', () => {
  const ws = tmp();
  claim(ws, 'never-launched');
  job(ws, 'j2', { name: '👯🤖 2026-08-16 unstamped', state: 'done', startedAt: iso(), firstTerminalAt: iso() });
  const r = run(ws, ['--audit']);
  assert.equal(r.status, 1);
  assert.match(r.stdout.trim().split('\n')[0], /WORKER LEDGER/);
});

test('the journal only ever grows, and records who claimed each id', () => {
  const ws = tmp();
  claim(ws, 'alpha', [], { OBOT_ACTOR: 'the-first-lead' });
  const first = read(jrnl(ws));
  claim(ws, 'beta', [], { OBOT_ACTOR: 'the-second-lead' });
  const later = read(jrnl(ws));
  assert.ok(later.startsWith(first), 'earlier journal lines must stay byte-identical');
  for (const a of ['the-first-lead', 'the-second-lead']) assert.match(later, new RegExp(a));
});

test('the roster is rendered from the journal, never stored', () => {
  const ws = tmp();
  const w = id(claim(ws, 'alpha', ['--task', 'build the thing']));
  job(ws, 'j1', { name: `👯🤖 ${w} 2026-08-16 alpha`, state: 'working', startedAt: iso() });
  const out = run(ws, ['list']).stdout;
  assert.match(out, /W0001/);
  assert.match(out, /alpha/);
  assert.match(out, /build the thing/);
  assert.match(out, /working/, 'liveness is joined from the job records, not self-reported');
  // A stored roster would be a second copy that can drift from the journal - the
  // shape of the hub decision registry's write-only `status` field, where the
  // Index row is the real authority and the field silently disagrees with it.
  const stored = fs.readdirSync(path.join(ws, '.claude'));
  assert.deepEqual(stored.filter((f) => /workers\.(md|json)$/.test(f)), []);
});

test('a ledger that was never armed is not reported as clean', () => {
  const ws = tmp();
  // The trap this closes. Wire a tool into a five-minute sweep, never call it, and
  // "nothing to check" reads exactly like "everything is fine" — forever. If
  // workers are running while no ledger exists, not one of them can ever be
  // attributed to what it wrote, and every agent write carries the same bot
  // identity, so there is no second chance to recover it later.
  job(ws, 'j1', { name: '👯🤖 2026-08-16 someslug', state: 'working', startedAt: iso() });
  const r = run(ws, ['--audit']);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /NOT ARMED/);
  assert.doesNotMatch(r.stdout + r.stderr, /clean/);
});

test('no ledger and no workers is simply not armed yet, not a failure', () => {
  const ws = tmp();
  const r = run(ws, ['--audit']);
  assert.equal(r.status, 0, 'a fresh clone must not fail the sweep');
  assert.match(r.stdout + r.stderr, /NOT ARMED/, 'but it must still say so plainly');
});

test('init arms the ledger and is idempotent', () => {
  const ws = tmp();
  assert.equal(run(ws, ['init']).status, 0);
  const first = read(jrnl(ws));
  const again = run(ws, ['init']);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /already armed/);
  assert.equal(read(jrnl(ws)), first, 'arming twice must not stamp a second epoch');
  // Armed and unused is clean: the epoch means nothing before it is judged.
  assert.equal(run(ws, ['--audit']).status, 0);
});
