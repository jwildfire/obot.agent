import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBoundary, scopeAgents, buildModel, extractRefs, shortName, buildAccomplishments } from '../lib/model.mjs';

const WS = '/ws/obot2';
const jobsData = [
  { id: 'lead1234', name: 'lead', state: 'done', cwd: WS, createdAt: '2026-07-11T22:17:00.000Z', updatedAt: '2026-07-12T01:00:00.000Z', tokens: 100000, children: [], detail: '', result: null, model: null },
  { id: 'sib5678', name: 'sib', state: 'working', cwd: WS + '/repo', createdAt: '2026-07-11T22:40:00.000Z', updatedAt: '2026-07-12T02:00:00.000Z', tokens: 50000, children: [], detail: 'busy', result: null, model: 'sonnet' },
  { id: 'old90ab', name: 'yesterday', state: 'done', cwd: WS, createdAt: '2026-07-10T10:00:00.000Z', updatedAt: '2026-07-10T12:00:00.000Z', tokens: 7, children: [], detail: '', result: null, model: null },
  { id: 'other11', name: 'elsewhere', state: 'working', cwd: '/somewhere/else', createdAt: '2026-07-11T22:00:00.000Z', updatedAt: '2026-07-12T02:00:00.000Z', tokens: 9, children: [], detail: '', result: null, model: null },
];

const scratchpadWithMarker = {
  data: {
    marker: { sessionNumber: 2, jobId: 'lead1234', raw: '' },
    overview: { groups: [{ group: 'A', items: [{ checked: false, text: 'x' }, { checked: true, text: 'y' }] }] },
    todo: null, notes: null, scaffold: null,
  },
};

test('resolveBoundary: marker job anchors the start', () => {
  const b = resolveBoundary({ scratchpad: scratchpadWithMarker, jobs: { data: jobsData }, date: '2026-07-11', tzOffsetMinutes: 240 });
  assert.equal(b.startIso, '2026-07-11T22:17:00.000Z');
  assert.equal(b.sessionNumber, 2);
});

test('resolveBoundary: no marker → local midnight fallback (EDT = UTC-4)', () => {
  const b = resolveBoundary({ scratchpad: { notice: 'x' }, jobs: { data: [] }, date: '2026-07-11', tzOffsetMinutes: 240 });
  assert.equal(b.startIso, '2026-07-11T04:00:00.000Z');
  assert.match(b.anchor, /no marker/);
});

test('resolveBoundary: marker time beats job createdAt (canonical shape)', () => {
  const sp = { data: { marker: { sessionNumber: 2, jobId: 'lead1234', date: '2026-07-11', time: '21:34' } } };
  const b = resolveBoundary({ scratchpad: sp, jobs: { data: jobsData }, date: '2026-07-11', tzOffsetMinutes: 240 });
  assert.equal(b.startIso, '2026-07-12T01:34:00.000Z'); // 21:34 EDT = 01:34Z
  assert.match(b.anchor, /@ 21:34/);
});

test('resolveBoundary: marker names an unknown job → fallback, number kept', () => {
  const sp = { data: { marker: { sessionNumber: 3, jobId: 'gone0000' } } };
  const b = resolveBoundary({ scratchpad: sp, jobs: { data: jobsData }, date: '2026-07-11', tzOffsetMinutes: 240 });
  assert.equal(b.startIso, '2026-07-11T04:00:00.000Z');
  assert.equal(b.sessionNumber, 3);
});

test('scopeAgents: cwd + boundary window; workspace prefix includes nested repos', () => {
  const boundary = { startIso: '2026-07-11T22:17:00.000Z' };
  const scoped = scopeAgents({ jobs: { data: jobsData }, agentsCli: { data: [] }, boundary, workspace: WS });
  assert.deepEqual(scoped.map((j) => j.id).sort(), ['lead1234', 'sib5678']);
});

test('scopeAgents: interactive sessions merge in; live-set marks stale workers', () => {
  const boundary = { startIso: '2026-07-11T22:17:00.000Z' };
  const cli = {
    data: [
      { kind: 'interactive', name: 'console', status: 'busy', cwd: WS, startedAt: 1783808227623, sessionId: 'ffff0000-x' },
      // note: sib5678 absent from the live list → its 'working' is stale
      { kind: 'background', id: 'lead1234', cwd: WS },
    ],
  };
  const scoped = scopeAgents({ jobs: { data: jobsData }, agentsCli: cli, boundary, workspace: WS });
  const inter = scoped.find((a) => a.kind === 'interactive');
  assert.equal(inter.state, 'working');
  const sib = scoped.find((a) => a.id === 'sib5678');
  assert.equal(sib.stale, true);
});

test('scopeAgents: idle interactive sessions from before the boundary are excluded', () => {
  const boundary = { startIso: '2026-07-11T22:17:00.000Z' };
  const cli = {
    data: [
      // started 2026-07-09, idle → out of scope
      { kind: 'interactive', name: 'old console', status: 'idle', cwd: WS, startedAt: 1783570961394, sessionId: 'aaaa0000-x' },
      // started after boundary, idle → in scope
      { kind: 'interactive', name: 'new console', status: 'idle', cwd: WS, startedAt: 1783822591705, sessionId: 'bbbb0000-x' },
    ],
  };
  const scoped = scopeAgents({ jobs: { data: [] }, agentsCli: cli, boundary, workspace: WS });
  assert.deepEqual(scoped.map((a) => a.name), ['new console']);
});

test('buildModel: tiles, alerts, slug, notices', () => {
  const collected = {
    jobs: { data: [...jobsData, { id: 'blocked1', name: 'stuck', state: 'needs-input', detail: 'D5?', cwd: WS, createdAt: '2026-07-11T23:00:00.000Z', updatedAt: '2026-07-12T02:10:00.000Z', tokens: 1000, children: [], result: null, model: null }] },
    agentsCli: { notice: 'claude agents unavailable (ENOENT)' },
    scratchpad: scratchpadWithMarker,
    nextSession: { notice: 'none' },
    ghSweep: { data: { fetchedAt: 1, sinceIso: 'x', items: [{ updatedAt: '2026-07-12T00:00:00Z', repo: 'hub', number: 1, title: 't', event: 'opened', url: 'u', isPullRequest: false }] } },
  };
  const m = buildModel({ collected, workspace: WS, date: '2026-07-11', mode: 'live', generatedAtIso: '2026-07-12T03:00:00.000Z', tzOffsetMinutes: 240 });
  assert.equal(m.slug, '2026-07-11-2');
  assert.equal(m.tiles.priorities.open, 1);
  assert.equal(m.tiles.priorities.done, 1);
  assert.equal(m.tiles.agents.total, 3);
  assert.equal(m.tiles.tokens.total, 151000);
  assert.equal(m.alerts.length, 1);
  assert.equal(m.tiles.activity, 1);
  assert.match(m.notices.agentsCli, /unavailable/);
  assert.equal(m.notices.jobs, null);
});

test('extractRefs: URLs, shorthand, aliases, stopwords', () => {
  const refs = extractRefs('merge [PR #23](https://github.com/jwildfire/safety.viz/pull/23), triage hub #24, gsm.safety#30, PR #99 alone, step #4');
  assert.ok(refs.has('safety.viz#23'), 'URL ref');
  assert.ok(refs.has('obot.roadmap#24'), 'hub alias');
  assert.ok(refs.has('gsm.safety#30'), 'shorthand');
  assert.ok(!refs.has('pr#99'), 'PR stopword');
  assert.ok(!refs.has('step#4'), 'step stopword');
});

test('shortName strips emoji + dates; numeric residue falls back by color', () => {
  assert.equal(shortName({ name: '😺🤖 07-11 devops-dash' }), 'devops-dash');
  assert.equal(shortName({ name: '👯🤖 07-11 sv-v1.1' }), 'sv-v1.1');
  assert.equal(shortName({ name: '😺🤖 07-11 2', color: 'orange', id: 'ce8f336e' }), 'lead');
  assert.equal(shortName({ name: '👯🤖 07-11 3', color: 'green', id: 'ab12cd34' }), 'ab12cd');
});

test('agents link to priorities via shared refs (children URL ↔ item text)', () => {
  const jobs = {
    data: [{
      id: 'sib5678', name: '👯🤖 07-11 sv-v1', color: 'green', state: 'working', detail: '',
      cwd: WS, createdAt: '2026-07-11T22:40:00.000Z', updatedAt: '2026-07-12T02:00:00.000Z', tokens: 1,
      children: [{ id: '23', href: 'https://github.com/jwildfire/safety.viz/pull/23', kind: 'pr' }],
      result: null, model: null, intent: 'wrap the safety.viz release',
    }],
  };
  const scratchpad = {
    data: {
      marker: { sessionNumber: 2, jobId: 'sib5678' },
      overview: { groups: [{ group: 'A', items: [
        { checked: false, num: 1, text: 'safety.viz v1.0 wrap — merge [PR #23](https://github.com/jwildfire/safety.viz/pull/23)' },
        { checked: false, num: 2, text: 'unrelated item about blog posts' },
      ] }] },
      todo: null, notes: null, scaffold: null,
    },
  };
  const m = buildModel({
    collected: { jobs, agentsCli: { data: [] }, scratchpad, nextSession: { notice: 'x' }, ghSweep: { notice: 'x' } },
    workspace: WS, date: '2026-07-11', mode: 'live', generatedAtIso: 'x', tzOffsetMinutes: 240,
  });
  const items = m.panels.overview.groups[0].items;
  assert.deepEqual(items[0].agents.map((a) => a.short), ['sv-v1']);
  assert.deepEqual(items[1].agents, []);
  assert.deepEqual(m.agents[0].priorities, [1]);
});

test('buildAccomplishments: closure + requirements + releases filtering', () => {
  const boundary = { startIso: '2026-07-11T22:00:00Z' };
  const ghSweep = { data: {
    items: [
      { repo: 'obot.roadmap', number: 26, title: 'reports home', event: 'closed', isPullRequest: false, labels: ['infrastructure'], updatedAt: '2026-07-12T03:00:00Z', url: 'u1' },
      { repo: 'obot.roadmap', number: 24, title: 'session hub', event: 'updated', isPullRequest: false, labels: ['requirement', 'ai'], updatedAt: '2026-07-12T02:00:00Z', url: 'u2' },
      { repo: 'safety.viz', number: 28, title: 'rc', event: 'merged', isPullRequest: true, labels: [], updatedAt: '2026-07-12T01:00:00Z', url: 'u3' },
      { repo: 'safety.viz', number: 30, title: 'old', event: 'updated', isPullRequest: true, labels: [], updatedAt: '2026-07-11T01:00:00Z', url: 'u4' },
    ],
    releases: [
      { repo: 'obot.agent', tag: 'v0.1.0', name: 'v0.1.0', url: 'r1', publishedAt: '2026-07-12T02:10:00Z' },
      { repo: 'safety.viz', tag: 'v0.1.0', name: 'old release', url: 'r2', publishedAt: '2026-07-10T00:00:00Z' },
    ],
  } };
  const acc = buildAccomplishments(ghSweep, boundary);
  assert.equal(acc.closedIssues.length, 1);
  assert.equal(acc.mergedPrs.length, 1);
  assert.deepEqual(acc.requirements.map((r) => r.number), [24]);
  assert.deepEqual(acc.releases.map((r) => r.tag + '@' + r.repo), ['v0.1.0@obot.agent']);
  assert.equal(buildAccomplishments({ notice: 'x' }, boundary), null);
});

test('buildModel: fully degraded inputs still produce a model', () => {
  const collected = {
    jobs: { notice: 'nope' }, agentsCli: { notice: 'nope' }, scratchpad: { notice: 'nope' },
    nextSession: { notice: 'nope' }, ghSweep: { notice: 'nope' },
  };
  const m = buildModel({ collected, workspace: WS, date: '2026-07-11', mode: 'live', generatedAtIso: '2026-07-12T03:00:00.000Z', tzOffsetMinutes: 240 });
  assert.equal(m.agents.length, 0);
  assert.equal(m.slug, '2026-07-11');
  assert.equal(m.tiles.activity, null);
  assert.ok(Object.values(m.notices).every((n) => n));
});
