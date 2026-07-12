import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeJobState, collectJobs, collectAgentsCli, collectScratchpad,
  collectGhSweep, deriveEvent,
} from '../lib/collect.mjs';

const FULL_STATE = {
  name: '😺🤖 07-11 devops-dash', color: 'green', state: 'working', detail: 'building',
  tempo: 'active', tokens: 12345, children: [{ id: '21', href: 'https://github.com/x/y/pull/21', kind: 'pr' }],
  output: { result: 'done thing' }, createdAt: '2026-07-12T02:16:31.000Z',
  updatedAt: '2026-07-12T03:00:00.000Z', cwd: '/ws', intent: 'briefing…',
  respawnFlags: ['--permission-mode', 'auto', '--model', 'claude-fable-5'],
  linkScanOffset: 99, providerEnv: { SECRET: 'x' }, // unpinned → dropped
};

test('normalizeJobState pins the contract fields and drops the rest', () => {
  const j = normalizeJobState('8e2c143a', FULL_STATE);
  assert.equal(j.name, '😺🤖 07-11 devops-dash');
  assert.equal(j.model, 'fable-5');
  assert.equal(j.result, 'done thing');
  assert.equal(j.children.length, 1);
  assert.equal(j.linkScanOffset, undefined);
  assert.equal(j.providerEnv, undefined);
  assert.equal(j.respawnFlags, undefined);
});

test('normalizeJobState degrades on missing/renamed fields, never throws', () => {
  const j = normalizeJobState('abc', { statev2: 'working', tokens: 'lots' });
  assert.equal(j.state, 'unknown');
  assert.equal(j.tokens, null);
  assert.equal(j.name, 'job abc');
  assert.deepEqual(j.children, []);
  assert.equal(normalizeJobState('x', null).degraded, 'unreadable state.json');
  assert.equal(normalizeJobState('x', 'string').degraded, 'unreadable state.json');
});

test('collectJobs: unreadable dir → notice, not throw', () => {
  const r = collectJobs({ jobsDir: '/nonexistent/nowhere' });
  assert.match(r.notice, /jobs directory unreadable/);
});

test('collectJobs reads real-shaped state.json files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubjobs-'));
  fs.mkdirSync(path.join(dir, 'aa11bb22'));
  fs.writeFileSync(path.join(dir, 'aa11bb22', 'state.json'), JSON.stringify(FULL_STATE));
  fs.mkdirSync(path.join(dir, 'broken'));
  fs.writeFileSync(path.join(dir, 'broken', 'state.json'), '{not json');
  const r = collectJobs({ jobsDir: dir });
  assert.equal(r.data.length, 2);
  const ok = r.data.find((j) => j.id === 'aa11bb22');
  assert.equal(ok.tokens, 12345);
  const broken = r.data.find((j) => j.id === 'broken');
  assert.equal(broken.degraded, 'unparseable state.json');
});

test('collectAgentsCli: exec failure → notice', () => {
  const r = collectAgentsCli({ workspace: '/ws', exec: () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }); } });
  assert.match(r.notice, /claude agents unavailable/);
});

test('collectAgentsCli: parses injected JSON', () => {
  const list = [{ kind: 'interactive', name: 'x', status: 'idle', cwd: '/ws' }];
  const r = collectAgentsCli({ workspace: '/ws', exec: () => JSON.stringify(list) });
  assert.deepEqual(r.data, list);
});

test('collectScratchpad: missing file → notice; present file → parsed sections', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hubws-'));
  assert.match(collectScratchpad({ workspace: ws, date: '2026-07-11' }).notice, /no scratchpad/);
  const dir = path.join(ws, '.claude', 'session-notes');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-07-11.md'),
    '# T\n\n## Overview\n<!-- session-init 2026-07-11 session #2 (bg job ab12cd34) -->\n- [ ] one\n\n## Scaffold\n- idea\n');
  const r = collectScratchpad({ workspace: ws, date: '2026-07-11' });
  assert.equal(r.data.marker.jobId, 'ab12cd34');
  assert.ok(r.data.overview);
  assert.ok(r.data.scaffold);
  assert.equal(r.data.todo, null);
});

test('collectGhSweep: failure with no cache → notice; success writes cache; TTL hit skips exec', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hubgh-'));
  const boom = () => { throw new Error('offline'); };
  assert.match(collectGhSweep({ workspace: ws, sinceIso: '2026-07-11T00:00:00Z', exec: boom }).notice, /gh sweep failed/);

  let calls = 0;
  const fake = (cmd, args) => {
    calls++;
    if (args.includes('--merged')) return JSON.stringify([{ url: 'https://github.com/j/r/pull/9' }]);
    if (args.includes('issues')) return JSON.stringify([
      { repository: { nameWithOwner: 'jwildfire/hub' }, number: 1, title: 'iss', state: 'open',
        url: 'https://github.com/j/r/issues/1', updatedAt: '2026-07-11T02:00:00Z', createdAt: '2026-07-11T01:00:00Z', closedAt: null },
    ]);
    return JSON.stringify([
      { repository: { nameWithOwner: 'jwildfire/hub' }, number: 9, title: 'pr', state: 'closed',
        url: 'https://github.com/j/r/pull/9', updatedAt: '2026-07-11T03:00:00Z', createdAt: '2026-07-10T00:00:00Z', closedAt: '2026-07-11T03:00:00Z' },
    ]);
  };
  const t0 = 1_000_000;
  const r1 = collectGhSweep({ workspace: ws, sinceIso: '2026-07-11T00:00:00Z', exec: fake, now: () => t0 });
  assert.equal(r1.data.items.length, 2);
  const pr = r1.data.items.find((i) => i.isPullRequest);
  assert.equal(pr.state, 'merged');
  assert.equal(pr.event, 'merged');
  const callsAfterFirst = calls;
  const r2 = collectGhSweep({ workspace: ws, sinceIso: '2026-07-11T00:00:00Z', exec: fake, now: () => t0 + 1000 });
  assert.equal(calls, callsAfterFirst, 'TTL hit must not re-exec');
  assert.equal(r2.data.items.length, 2);
});

test('collectGhSweep: failure after a cache exists → stale cache served', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hubgh2-'));
  const fake = (cmd, args) => JSON.stringify(args.includes('--merged') ? [] : []);
  const t0 = 1_000_000;
  collectGhSweep({ workspace: ws, sinceIso: '2026-07-11T00:00:00Z', exec: fake, now: () => t0 });
  const r = collectGhSweep({
    workspace: ws, sinceIso: '2026-07-11T00:00:00Z',
    exec: () => { throw new Error('offline'); }, now: () => t0 + 10 * 60 * 1000,
  });
  assert.equal(r.data.stale, true);
});

test('deriveEvent covers opened/closed/merged/updated', () => {
  const since = '2026-07-11T00:00:00Z';
  assert.equal(deriveEvent({ createdAt: '2026-07-11T01:00:00Z' }, since), 'opened');
  assert.equal(deriveEvent({ createdAt: '2026-07-01T00:00:00Z', closedAt: '2026-07-11T02:00:00Z' }, since), 'closed');
  assert.equal(deriveEvent({ createdAt: '2026-07-01T00:00:00Z', closedAt: '2026-07-11T02:00:00Z', isPullRequest: true, state: 'merged' }, since), 'merged');
  assert.equal(deriveEvent({ createdAt: '2026-07-01T00:00:00Z' }, since), 'updated');
});
