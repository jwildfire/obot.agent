// The ranked-head page, on a machine with no history.
//
// Requirement: jwildfire/obot.roadmap#223, task jwildfire/obot.agent#306. Worker W0105.
//
// Rehearsed with `gh` unauthenticated, the page was almost entirely honest: "state read
// not known", a hole saying GitHub was not read, and "not returned by GitHub this
// reading" on every card. One number was not. The bench is GitHub's `on-deck` label and
// nothing else, so with no reading it rendered "0 on the bench" — under a heading that
// says "and the eleven on the bench" — which is the page's only measured-looking claim
// about something nobody measured.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderPage } from '../render.mjs';

const model = () => ({
  tz: 'America/New_York',
  order: { touched: { iso: '2026-08-21T04:33:00Z' } },
  live: { read: false, why: 'gh auth login', at: null },
  label: 'top10', benchLabel: 'on-deck', boundary: '',
  head: { rows: [{ n: 1, ref: '#279', why: 'because', repo: 'jwildfire/obot.roadmap', number: 279 }] },
  bench: { rows: [] },
  history: { frames: [], span: { from: null, to: null } },
});

test('the bench is not zero when nothing read it', () => {
  const html = renderPage(model());
  assert.doesNotMatch(html, /<b>0<\/b> on the bench/,
    'the bench comes from a label on GitHub, and GitHub was not read');
  assert.match(html, /on the bench/, 'the fact is still named');
  assert.match(html, /GitHub was not read/, 'and the page still says why');
});

test('a bench that WAS read still prints its count, zero included', () => {
  const m = model();
  m.live = { read: true, why: '', at: '2026-08-21T04:33:00Z' };
  const html = renderPage(m);
  assert.match(html, /<b>0<\/b> on the bench/, 'a measured zero is still a zero');
});
