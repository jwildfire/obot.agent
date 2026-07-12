import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, inline } from '../lib/render.mjs';
import { buildModel } from '../lib/model.mjs';

const WS = '/ws/obot2';

function liveModel(overrides = {}) {
  const collected = {
    jobs: {
      data: [{
        id: 'sib5678', name: '😺🤖 07-11 devops-dash', color: 'green', state: 'working',
        detail: 'building <b>things</b>', cwd: WS, createdAt: '2026-07-12T02:16:00.000Z',
        updatedAt: '2026-07-12T03:00:00.000Z', tokens: 123456,
        children: [{ id: '21', href: 'https://github.com/jwildfire/obot.agent/pull/21', kind: 'pr' }],
        result: null, model: 'fable-5',
      }],
    },
    agentsCli: { data: [] },
    scratchpad: {
      data: {
        marker: { sessionNumber: 2, jobId: 'sib5678' },
        overview: { groups: [{ group: 'Agent-actionable', items: [{ checked: false, text: 'ship `session-hub` — see [#24](https://github.com/jwildfire/obot.roadmap/issues/24)' }] }] },
        todo: null,
        notes: { groups: [{ group: null, items: [{ checked: null, time: '19:05', text: 'a note' }] }] },
        scaffold: null,
      },
    },
    nextSession: { data: { memory: 'wrap **v1.0**', diary: null } },
    ghSweep: { data: { fetchedAt: 1783822591705, sinceIso: 'x', items: [{ updatedAt: '2026-07-12T02:30:00.000Z', repo: 'obot.roadmap', number: 24, title: 'session hub', event: 'updated', url: 'https://github.com/jwildfire/obot.roadmap/issues/24', isPullRequest: false }] } },
    ...overrides,
  };
  return buildModel({ collected, workspace: WS, date: '2026-07-11', mode: overrides.mode ?? 'live', generatedAtIso: '2026-07-12T03:05:00.000Z', tzOffsetMinutes: 240 });
}

test('live render: panels, sources, agent card, refresh meta', () => {
  const html = render(liveModel());
  for (const s of ['Priorities', 'Roadmap activity', 'Agents', 'Notes', 'Scaffold improvements', 'Next session']) {
    assert.ok(html.includes(`<h2>${s}`), `panel ${s}`);
  }
  assert.ok(html.includes('http-equiv="refresh"'), 'live mode auto-refreshes');
  assert.ok(html.includes('😺🤖 07-11 devops-dash'));
  assert.ok(html.includes('123.5k tok'));
  assert.ok(html.includes('obot.agent#21'), 'children chip short label');
  assert.ok(html.includes('Session 2026-07-11-2'), 'slug in masthead');
});

test('render escapes untrusted text', () => {
  const html = render(liveModel());
  assert.ok(!html.includes('<b>things</b>'), 'detail HTML must be escaped');
  assert.ok(html.includes('&lt;b&gt;things&lt;/b&gt;'));
});

test('degradation notices render instead of crashing', () => {
  const m = liveModel({
    jobs: { notice: 'jobs directory unreadable (EACCES)' },
    agentsCli: { notice: 'claude agents unavailable (ENOENT)' },
    scratchpad: { notice: 'no scratchpad at .claude/session-notes/2026-07-11.md' },
    nextSession: { notice: 'none found' },
    ghSweep: { notice: 'gh sweep failed (ENOENT)' },
  });
  const html = render(m);
  assert.ok(html.includes('jobs directory unreadable'));
  assert.ok(html.includes('gh sweep failed'));
  assert.ok(html.includes('no sessions in scope'));
});

test('report mode: pill flips, no refresh, outcome banner, duration', () => {
  const html = render(liveModel({ mode: 'report' }));
  assert.ok(!html.includes('http-equiv="refresh"'), 'report is frozen');
  assert.ok(html.includes('Session report — frozen at wrapup'));
  assert.ok(html.match(/<span class="on">Report<\/span>/));
  assert.ok(html.includes('pairs with diary/2026-07-11-2.md'));
});

test('inline: markdown links, code, bold, bare urls — after escaping', () => {
  const s = inline('see [#24](https://github.com/jwildfire/obot.roadmap/issues/24) & `code` **hot** https://github.com/jwildfire/safety.viz/pull/28');
  assert.ok(s.includes('<a href="https://github.com/jwildfire/obot.roadmap/issues/24">#24</a>'));
  assert.ok(s.includes('&amp;'));
  assert.ok(s.includes('<code>code</code>'));
  assert.ok(s.includes('<strong>hot</strong>'));
  assert.ok(s.includes('>safety.viz#28</a>'), 'bare URL shortened to repo#N');
});
