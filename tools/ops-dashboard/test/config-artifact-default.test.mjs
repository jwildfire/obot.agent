// A config item opens as the page it already is.
//
// @jwildfire, 2026-08-20: "Update http://127.0.0.1:7326/ to show the html artifacts
// by default - just like the decisions."
//
// The card renderer already answers /config/<id> with a whole page, and until now the
// dashboard rebuilt the same item as a form in the main area and offered the page as
// a link into a new tab. lib/config-card.mjs left that open deliberately — "it opens
// beside this panel rather than replacing it ... until he has read one of these and
// said which he wants". He has now said. These tests hold the answer in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { render } from '../lib/render.mjs';

const queue = {
  rcs: { items: [{ kind: 'rc', key: 'jwildfire/gsm.safety#52', title: 'gsm.safety v1.1.0', detail: 'jwildfire/gsm.safety' }], refreshing: false },
  config: { items: [{ kind: 'config', id: 'c0001', key: 'c0001', title: 'An allowlist line' }] },
  decisions: { items: [{ kind: 'decision', id: 'D0007', key: 's', title: 'A call', artifact: 's', detail: 'Awaiting' }] },
  items: [],
};

const page = () => render({ queue, staged: [] });

test('a config item opens its own HTML artifact, the way a decision does', () => {
  const html = page();
  assert.match(html, /f\.src = '\/config\/'/,
    'selecting a config row must point the main frame at /config/<id> — the artifact, not a rebuild of it');
  assert.ok(!/Read this as a page/.test(html),
    'the link into a new tab was the click he asked to remove; the page is the default now');
});

test('the proof he can run survives the change, in the sidebar', () => {
  const html = page();
  assert.ok(html.includes("id=\"config-check\""), 'the check has a home in the sidebar');
  assert.match(html, /fetch\('\/check'/, 'the run-the-check button still posts to /check');
  assert.match(html, /renderCheck\(/, 'and it is wired to the config branch of select()');
});

test('nothing is one click in: the page opens the top of the list on load', () => {
  const html = page();
  assert.match(html, /selectFirst\(\)/, 'the boot script selects the first row so the landing view already shows an artifact');
});

test('the placeholder no longer promises a form', () => {
  const html = page();
  assert.ok(!/opens as an installation qualification/.test(html),
    'the copy describing the config item as a form must follow the form out');
});
