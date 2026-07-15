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
        intent: 'drive hub requirement obot.roadmap#24 through design',
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
  for (const s of ['Priorities', 'Roadmap activity', 'Agents', 'Notes', 'Scaffold', 'Next session', 'Accomplishments']) {
    assert.ok(html.includes(`${s}</h2>`), `panel ${s}`);
  }
  assert.ok(html.includes('http-equiv="refresh"'), 'live mode auto-refreshes');
  assert.ok(html.includes('123.5k tok'));
  assert.ok(html.includes('obot.agent#21'), 'children chip short label');
  assert.ok(html.includes('Session 2026-07-11-2'), 'slug in masthead');
});

test('priorities are one-line drill-downs: plain-text summary, full detail in body', () => {
  const html = render(liveModel());
  assert.ok(html.includes('<details class="pri" id="p1">'));
  const summary = html.match(/<details class="pri" id="p1">\s*<summary>([\s\S]*?)<\/summary>/)[1];
  assert.ok(summary.includes('ship session-hub — see #24'), 'summary is markdown-stripped plain text');
  assert.ok(!summary.includes('href="https://github.com/jwildfire/obot.roadmap/issues/24"'), 'links live in the drill-down, not the summary');
  assert.ok(html.includes('<code>session-hub</code>'), 'drill-down keeps inline markdown');
});

test('agent↔priority cross-links: agchip on the priority, pchip on the agent', () => {
  const html = render(liveModel());
  assert.ok(html.includes('href="#agent-sib5678"'), 'priority row links to the agent');
  assert.ok(html.match(/class="agchip"[^>]*>devops-dash</), 'agent chip shows the short name');
  assert.ok(html.includes('id="agent-sib5678"'));
  assert.ok(html.match(/<a class="pchip" href="#p1">P1<\/a>/), 'agent card links back to the priority');
});

test('secondary panels are collapsed by default; agent name uses short form', () => {
  const html = render(liveModel());
  const folds = html.match(/<details class="panel fold">/g) ?? [];
  assert.ok(folds.length >= 3, 'Roadmap activity, Notes, Scaffold, Next session fold');
  assert.ok(!html.includes('<details class="panel fold" open'), 'folds start closed');
  assert.ok(html.match(/<span class="agent-name">devops-dash<\/span>/), 'summary shows short name');
  assert.ok(html.includes('😺🤖 07-11 devops-dash'), 'full name preserved in the drill-down');
});

test('accomplishments: release row, requirement closure badge, closure counts', () => {
  const html = render(liveModel({
    ghSweep: { data: { fetchedAt: 1, sinceIso: 'x', items: [
      { repo: 'obot.roadmap', number: 26, title: 'reports home', event: 'closed', isPullRequest: false, labels: ['requirement'], updatedAt: '2026-07-12T03:00:00.000Z', url: 'https://github.com/jwildfire/obot.roadmap/issues/26' },
      { repo: 'safety.viz', number: 28, title: 'rc', event: 'merged', isPullRequest: true, labels: [], updatedAt: '2026-07-12T02:40:00.000Z', url: 'https://github.com/jwildfire/safety.viz/pull/28' },
    ], releases: [{ repo: 'obot.agent', tag: 'v0.1.0', name: 'v0.1.0', url: 'https://github.com/jwildfire/obot.agent/releases/tag/v0.1.0', publishedAt: '2026-07-12T02:30:00.000Z' }] } },
  }));
  assert.ok(html.includes('obot.agent v0.1.0</strong></a> released'), 'release row');
  assert.ok(html.includes('✓ closed'), 'requirement closure badge');
  assert.ok(html.includes('1 PRs merged · 1 issues closed'), 'closure drill-down summary');
  assert.ok(html.match(/Closure<\/span><span class="value">3/), 'closure tile counts merged+closed+released');
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
