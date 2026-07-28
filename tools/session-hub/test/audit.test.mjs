// Local audit lane tests (@jwildfire 2026-07-27: hosted audit page is
// read-only; deciding happens here — a loopback server that spawns a local
// Claude Code agent per decision). Pure parts are tested directly; the spawn is
// injectable, so no test starts a real agent.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateDecision, agentPrompt, spawnArgs, jobState, decisionsFor, MAX_FINDINGS,
} from '../session-audit.mjs';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'audit-lane-test-'));
}

// ------------------------------------------------------------- validation
test('validateDecision accepts a well-formed accept', () => {
  const v = validateDecision({ decision: 'accept', findings: ['ASSIGNEE-MISSING:jwildfire/obot.roadmap#9'], label: 'accept roadmap#9' });
  assert.equal(v.error, undefined);
  assert.equal(v.decision, 'accept');
  assert.deepEqual(v.findings, ['ASSIGNEE-MISSING:jwildfire/obot.roadmap#9']);
});

test('validateDecision refuses unknown decisions, empty and oversized batches, junk ids', () => {
  assert.match(validateDecision({ decision: 'apply', findings: ['A:b#1'] }).error, /decision/);
  assert.match(validateDecision({ decision: 'accept', findings: [] }).error, /finding/);
  assert.match(validateDecision({ decision: 'accept' }).error, /finding/);
  const over = Array.from({ length: MAX_FINDINGS + 1 }, (_, i) => `RULE:jwildfire/x#${i}`);
  assert.match(validateDecision({ decision: 'accept', findings: over }).error, /at most/);
  assert.match(validateDecision({ decision: 'accept', findings: ['no colon here'] }).error, /id/);
  assert.match(validateDecision({ decision: 'accept', findings: [42] }).error, /id/);
  // shell metacharacters must never reach a spawned command line
  assert.match(validateDecision({ decision: 'accept', findings: ['RULE:$(rm -rf /)#1'] }).error, /id/);
});

// ------------------------------------------------------------- the prompt
test('agentPrompt carries ids, decision, hub path and run token', () => {
  const p = agentPrompt({
    decision: 'accept',
    findings: ['CLOSED-NOT-RELEASED:jwildfire/safety.viz#45', 'ASSIGNEE-MISSING:jwildfire/obot.roadmap#9'],
    hub: '/ws/obot.roadmap',
    runToken: 'local-abc123',
    label: 'accept 2 findings',
  });
  assert.match(p, /--decision accept/);
  assert.match(p, /CLOSED-NOT-RELEASED:jwildfire\/safety\.viz#45,ASSIGNEE-MISSING:jwildfire\/obot\.roadmap#9/);
  assert.match(p, /--run-id local-abc123/);
  assert.match(p, /\/ws\/obot\.roadmap/);
  assert.match(p, /never delete/i);
});

test('the page-supplied label is stripped to inert text before it reaches the prompt', () => {
  const v = validateDecision({
    decision: 'reject',
    findings: ['RULE:jwildfire/x#1'],
    label: 'mute `rm -rf` "$(evil)" <b>now</b>',
  });
  assert.equal(v.error, undefined);
  assert.doesNotMatch(v.label, /[`$()<>"]/);
  const p = agentPrompt({ ...v, hub: '/ws/hub', runToken: 'local-t' });
  assert.doesNotMatch(p.split('\n')[0], /[`$()<>]/); // the line carrying the label
});

test('spawnArgs pins background, auto permission mode and the sibling identity', () => {
  const args = spawnArgs({ name: '👯🤖 2026-07-27 audit-apply', prompt: 'do the thing' });
  assert.equal(args[0], '--bg');
  assert.ok(args.includes('--permission-mode') && args[args.indexOf('--permission-mode') + 1] === 'auto');
  assert.equal(args[args.length - 1], 'do the thing');
  assert.ok(args.includes('-n'));
});

// ------------------------------------------------------------- job state
test('jobState reads state.json and reports terminal from firstTerminalAt', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'abc12345'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'abc12345', 'state.json'), JSON.stringify({
    state: 'working', detail: 'running the apply lane', firstTerminalAt: null,
  }));
  const live = jobState('abc12345', { jobsDir: dir });
  assert.equal(live.state, 'working');
  assert.equal(live.terminal, false);

  fs.writeFileSync(path.join(dir, 'abc12345', 'state.json'), JSON.stringify({
    state: 'idle', detail: 'done', firstTerminalAt: '2026-07-28T02:00:00Z',
  }));
  assert.equal(jobState('abc12345', { jobsDir: dir }).terminal, true);

  const missing = jobState('nope', { jobsDir: dir });
  assert.equal(missing.state, 'unknown');
  assert.equal(missing.terminal, false);
});

// ------------------------------------------------------------- the ledger
test('decisionsFor returns the latest entry per requested id, fresh from disk', () => {
  const hub = tmp();
  fs.mkdirSync(path.join(hub, 'site', 'audit'), { recursive: true });
  const write = (decisions) => fs.writeFileSync(
    path.join(hub, 'site', 'audit', 'decisions.json'),
    JSON.stringify({ version: 1, decisions }),
  );
  write([
    { id: 'R:a/b#1', outcome: 'stale', detail: 'old', at: '2026-07-25T00:00:00Z' },
    { id: 'R:a/b#1', outcome: 'applied', detail: 'new', at: '2026-07-28T00:00:00Z' },
    { id: 'R:a/b#2', outcome: 'rejected', detail: 'muted', at: '2026-07-28T00:00:00Z' },
    { id: 'R:a/b#3', outcome: 'applied', detail: 'not asked for', at: '2026-07-28T00:00:00Z' },
  ]);
  const got = decisionsFor(hub, ['R:a/b#1', 'R:a/b#2', 'R:a/b#9']);
  assert.equal(got.length, 2);
  const one = got.find((d) => d.id === 'R:a/b#1');
  assert.equal(one.outcome, 'applied'); // latest wins
  // a fresh read every call — the ledger the agent commits shows up unpolled
  write([{ id: 'R:a/b#9', outcome: 'applied', detail: '', at: '2026-07-28T01:00:00Z' }]);
  assert.equal(decisionsFor(hub, ['R:a/b#9']).length, 1);
  // no ledger yet is an empty list, not a throw
  assert.deepEqual(decisionsFor(tmp(), ['R:a/b#1']), []);
});
