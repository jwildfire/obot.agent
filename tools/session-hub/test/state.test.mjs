import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionState } from '../session-hub.mjs';

// The publishable projection behind the roadmap page's session indicator
// (obot.roadmap#57 D5). It goes to a public page, so the tests pin both the
// state machine and the promise that no agent-authored free text rides along.
const model = ({ total = 0, working = 0, alerts = 0 } = {}) => ({
  slug: '2026-07-24-3',
  generatedAtIso: '2026-07-24T13:40:18.926Z',
  alerts: Array.from({ length: alerts }, (_, i) => ({ short: `a${i}`, detail: 'secret plan' })),
  tiles: { agents: { total, byState: { working } } },
});

test('sessionState: working when agents are working and nothing is blocked', () => {
  const s = sessionState(model({ total: 5, working: 2 }));
  assert.equal(s.state, 'working');
  assert.equal(s.detail, '5 agents · 2 working');
  assert.deepEqual(s.agents, { total: 5, working: 2, needsInput: 0 });
  assert.equal(s.slug, '2026-07-24-3');
  assert.equal(s.updatedAt, '2026-07-24T13:40:18.926Z');
});

test('sessionState: needs-input outranks working', () => {
  const s = sessionState(model({ total: 3, working: 1, alerts: 2 }));
  assert.equal(s.state, 'needs-input');
  assert.equal(s.detail, '3 agents · 1 working · 2 needs input');
});

test('sessionState: idle when nothing is running', () => {
  const s = sessionState(model());
  assert.equal(s.state, 'idle');
  assert.equal(s.detail, '0 agents');
});

test('sessionState: singular agent reads naturally', () => {
  assert.equal(sessionState(model({ total: 1, working: 1 })).detail, '1 agent · 1 working');
});

test('sessionState: publishes no agent-authored free text', () => {
  const s = sessionState(model({ total: 2, working: 1, alerts: 1 }));
  assert.ok(!JSON.stringify(s).includes('secret plan'));
});

test('sessionState: tolerates a model with no byState counts', () => {
  const m = model({ total: 2 });
  m.tiles.agents.byState = undefined;
  const s = sessionState(m);
  assert.equal(s.state, 'idle');
  assert.equal(s.agents.working, 0);
});
