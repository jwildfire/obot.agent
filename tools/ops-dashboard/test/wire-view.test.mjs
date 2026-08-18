// The Wire tab, and the half of the shared spine this repository owns.
//
// Requirement: jwildfire/obot.roadmap#203.
import test from 'node:test';
import assert from 'node:assert/strict';

import { splitFeed, wireHtml, breakNote } from '../lib/wire-view.mjs';
import { TABS, SPINE, tabs } from '../lib/render.mjs';

const at = (iso) => Date.parse(iso);
const feed = () => [
  { day: 'today', items: [
    { badge: 'MERGED', tone: 'b-ok', time: '21:28', text: 'newest', tsMs: at('2026-08-17T21:28:00Z') },
    { badge: 'CLAIM', tone: 'b-quiet', time: '20:00', text: 'older', tsMs: at('2026-08-17T20:00:00Z') },
  ] },
  { day: 'earlier', items: [
    { badge: 'DELIVERED', tone: 'b-ok', time: '', text: 'no stamp', tsMs: null },
  ] },
];

test('the split puts only genuinely newer events on the fresh side', () => {
  const { fresh, older, count } = splitFeed(feed(), at('2026-08-17T21:00:00Z'));
  assert.equal(count, 1);
  assert.deepEqual(fresh.map((g) => g.day), ['today']);
  assert.deepEqual(fresh[0].items.map((i) => i.text), ['newest']);
  // Both remaining events are older, and the day grouping survives the split.
  assert.deepEqual(older.map((g) => g.day), ['today', 'earlier']);
});

test('an event that cannot prove it is new is treated as old', () => {
  // The error direction matters: undercounting tells him to look, overcounting
  // tells him not to, and only the second can hide something.
  const { fresh, count } = splitFeed(feed(), at('2020-01-01T00:00:00Z'));
  assert.equal(count, 2, 'the two stamped events are new; the unstamped one is not');
  assert.equal(fresh.flatMap((g) => g.items).some((i) => i.text === 'no stamp'), false);
});

test('with no boundary the whole feed is fresh and the count is null, never zero', () => {
  const { fresh, older, count } = splitFeed(feed(), NaN);
  assert.equal(count, null, 'null is "not measured"; 0 would be a measurement');
  assert.equal(older.length, 0);
  assert.deepEqual(fresh, feed());
});

test('a first look says so instead of computing a window', () => {
  const html = wireHtml(feed(), { state: 'first', at: null, ageMs: null });
  assert.match(html, /first time this page has recorded you opening it/);
  assert.doesNotMatch(html, /changed since you last opened/);
  assert.match(html, /wire-absent/, 'and it is not styled as a measurement');
});

test('an unreadable record says so instead of claiming nothing changed', () => {
  const html = wireHtml(feed(), { state: 'unknown', why: 'the stamp is not a time' });
  assert.match(html, /No visit record could be read/);
  assert.doesNotMatch(html, /Nothing has changed/);
});

test('a real prior visit produces a counted, dated answer', () => {
  const html = wireHtml(feed(), { state: 'seen', at: '2026-08-17T21:00:00Z', ageMs: 3 * 3600000 });
  assert.match(html, /<b>1<\/b> thing changed since you last opened this page \(3h ago\)/);
});

test('nothing new is stated as such, with the record still reachable', () => {
  const html = wireHtml(feed(), { state: 'seen', at: '2026-08-18T00:00:00Z', ageMs: 60000 });
  assert.match(html, /Nothing has changed since you last opened this page/);
  assert.match(html, /<details class="wire-older" open>/, 'the record is open, because it is all there is to read');
});

test('an empty feed does not claim nothing happened', () => {
  const html = wireHtml([], { state: 'seen', at: '2026-08-17T21:00:00Z', ageMs: 1000 });
  assert.match(html, /is this page saying it cannot see/);
});

test('the page states the break with the public wire, and links it', () => {
  const note = breakNote();
  assert.match(note, /since you last looked/);
  assert.match(note, /what changed recently/);
  assert.match(note, /fixed 7-day window/);
  assert.match(note, /obot\.roadmap\/wire\.html/, 'and names where the other answer lives');
  assert.match(note, /issues\/203/);
  // Every rendering of the wire carries it — a break stated only in a design
  // document is a break nobody reading the surface ever learns about.
  for (const look of [{ state: 'first' }, { state: 'unknown' }, { state: 'seen', at: '2026-08-17T21:00:00Z', ageMs: 10 }]) {
    assert.match(wireHtml(feed(), look), /two honest answers at different depths/);
  }
  assert.match(wireHtml([], { state: 'first' }), /two honest answers at different depths/);
});

test('the shared spine is four entities in one order', () => {
  // The hub asserts the identical list against its own nav (scripts/lib/nav.mjs
  // exports SPINE, and its test checks the same four names). Two repositories
  // cannot share a test, so they share a constant and each asserts it.
  assert.deepEqual(SPINE, ['Queue', 'Wire', 'Agents', 'Catalog']);
});

test('no local-only tab comes between two spine entries', () => {
  const spineIdx = TABS.map((t, i) => (t.spine ? i : -1)).filter((i) => i !== -1);
  assert.deepEqual(spineIdx, [0, 1, 2, 3], 'the spine is contiguous and leads');
  assert.equal(TABS.find((t) => !t.spine).label, 'Navigator', 'and this surface\'s own tab follows it');
});

test('the tab strip marks where the spine ends', () => {
  const html = tabs('ops');
  assert.match(html, /class="tab-div"/);
  assert.ok(html.indexOf('Catalog') < html.indexOf('tab-div'), 'the divider follows the last spine tab');
  assert.ok(html.indexOf('tab-div') < html.indexOf('Navigator'), 'and precedes the surface-specific one');
});

test('the Catalog tab points at the hub rather than duplicating the record', () => {
  const catalog = TABS.find((t) => t.label === 'Catalog');
  assert.match(catalog.href, /^https:\/\/jwildfire\.github\.io\/obot\.roadmap\/catalog\.html$/);
  assert.equal(catalog.away, true);
  // An off-site tab that looked like the others would be a small lie about where
  // he is about to end up.
  assert.match(tabs('ops'), /Catalog<span class="away-mark"/);
  assert.match(tabs('ops'), /target="_blank"/);
});
