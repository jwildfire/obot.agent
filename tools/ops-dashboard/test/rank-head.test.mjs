// The ranked head on his page: below the three buckets, read-only, and honest about
// how old both halves of it are (jwildfire/obot.roadmap#278).
//
// TWO CLOCKS, NOT ONE. The panel carries a declaration and a derivation and they age
// separately: the rank was last touched when somebody committed `rank/top10.json`,
// and the state beside it was last refreshed when `gh` last answered. Collapsing them
// into one "updated" line is how a fresh derivation makes a fortnight-old rank look
// current — which is the exact failure this requirement was filed about, since two of
// this program's state files are stale right now and neither admits it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { render } from '../lib/render.mjs';
import { rankPanel, RANK_CACHE, RANK_CACHE_V, RANK_FAIL, rankRoot } from '../lib/rankhead.mjs';
import { writeCache } from '../lib/store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '..', 'ops-dashboard.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rank-panel-'));

const EMPTY_QUEUE = { rcs: { items: [], refreshing: false }, decisions: { items: [] }, config: { items: [] }, items: [] };
const item = (rank, issue, over = {}) => ({
  rank, issue, why: `reason ${rank}`, review: null, present: true,
  title: `Requirement: thing ${issue}`, url: `https://github.com/jwildfire/obot.roadmap/issues/${issue}`,
  state: 'open', milestone: '2026q3', labels: ['requirement', 'top10'], blocked: false,
  sub: null, member: true, closedAt: null, ...over,
});
const model = (over = {}) => ({
  read: true, error: null, refreshing: false, ageMin: 4,
  touched: { read: true, iso: '2026-08-19T01:00:00Z', ageMin: 60, dirty: false },
  declaredRead: true, declaredAbsent: false, declaredWhy: '',
  repo: 'jwildfire/obot.roadmap', label: 'top10',
  boundary: 'The ten carrying `top10` are ranked; the bench carrying `on-deck` is what a slot is filled from.',
  bench: { read: true, open: 10, why: '' },
  items: [item(1, 278), item(2, 275, { review: 'smaller than this rank assumed' }), item(3, 272)],
  findings: [],
  ...over,
});
const page = (rankHead, queue = EMPTY_QUEUE) => render({ queue, rankHead });

// --- where it sits, and what it is not -------------------------------------

test('the panel renders below all three buckets, at the bottom of the queue', () => {
  const html = page(model());
  const rail = html.match(/<nav class="rail"[\s\S]*?<\/nav>/)[0];
  const at = (re) => rail.search(re);
  const panel = at(/<section class="rank"/);
  assert.ok(panel > 0, 'the panel is not inside his queue rail');
  for (const bucket of [/Release candidates/, /Decisions <span/, /Config <span/]) {
    assert.ok(at(bucket) >= 0 && at(bucket) < panel, `the ranked head rendered above ${bucket}`);
  }
});

test('it is read-only: no control, nothing to click, nothing to submit', () => {
  const panel = page(model()).match(/<section class="rank"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(panel, /<button|<input|<textarea|<form|onclick=/);
  // Every link leaves for GitHub. Nothing addresses this server, so nothing here can
  // change any state on this machine.
  for (const href of panel.match(/href="[^"]*"/g) ?? []) {
    assert.match(href, /^href="https:\/\/github\.com\//, `${href} points back at the dashboard`);
  }
});

test('its rows are not queue rows — the page\'s click handler must not bind them', () => {
  const panel = page(model()).match(/<section class="rank"[\s\S]*?<\/section>/)[0];
  // `.q:not(.q-off)` gets a click listener that reads `.q-title` and throws without
  // one. A read-only panel that reused `.q` would break the whole rail.
  assert.doesNotMatch(panel, /class="q[ "]/);
});

test('it asks him for nothing — the three-bucket rule dies the moment it does', () => {
  const panel = page(model({
    findings: [{ kind: 'slot-open', issue: 278, rank: 1, title: 'x', closedAt: '2026-08-19T00:00:00Z' }],
  })).match(/<section class="rank"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(panel, /@jwildfire/);
  assert.doesNotMatch(panel, /\b(please|you should|approve|answer|decide|needs you|your call)\b/i);
});

// --- what a row shows ------------------------------------------------------

test('a row carries rank, title, the one-line why, derived state and a link', () => {
  const html = page(model({ items: [item(1, 278, { sub: { completed: 1, total: 3 } })] }));
  assert.match(html, /<span class="rank-n">1<\/span>/);
  assert.match(html, /thing 278/);
  assert.match(html, /reason 1/);
  assert.match(html, /1\/3 sub-issues/);
  assert.match(html, /2026q3/);
  assert.match(html, /href="https:\/\/github\.com\/jwildfire\/obot\.roadmap\/issues\/278"/);
});

test('blocked and closed are derived states the row shows, never the store\'s claim', () => {
  const html = page(model({
    items: [item(1, 278, { blocked: true }), item(2, 275, { state: 'closed' })],
  }));
  assert.match(html, /blocked/);
  assert.match(html, /closed/);
});

test('a rank flagged for re-rank says so, so steering it is one edit away', () => {
  assert.match(page(model()), /smaller than this rank assumed/);
});

test('a row GitHub did not return keeps its rank and says its state is unknown', () => {
  const html = page(model({ items: [item(1, 278, { present: false, title: null, state: null, milestone: null })] }));
  assert.match(html, /<span class="rank-n">1<\/span>/);
  assert.match(html, /#278/);
  assert.doesNotMatch(html, /rank-state">open/);
});

// --- the two clocks --------------------------------------------------------

test('it states when the rank was touched and when the state was refreshed, separately', () => {
  const html = page(model());
  assert.match(html, /[Rr]anked 2026-08-19/);
  assert.match(html, /1h old/);
  assert.match(html, /refreshed/i);
  assert.match(html, /4m/);
});

test('a rank untouched for three days says three days', () => {
  const html = page(model({ touched: { read: true, iso: '2026-08-16T09:00:00Z', ageMin: 3 * 24 * 60, dirty: false } }));
  assert.match(html, /3d old/);
});

test('a rank edited but not committed says so rather than dating it wrong', () => {
  assert.match(page(model({ touched: { read: true, iso: '2026-08-19T01:00:00Z', ageMin: 60, dirty: true } })),
    /not committed|uncommitted/i);
});

test('an unknown rank age is unknown — never a zero and never "just now"', () => {
  const panel = page(model({ touched: { read: false, why: 'no commit in this checkout has touched rank/top10.json', iso: null, ageMin: null, dirty: null } }))
    .match(/<section class="rank"[\s\S]*?<\/section>/)[0];
  assert.match(panel, /no commit in this checkout has touched/);
  assert.doesNotMatch(panel, /0m old|just now/);
});

// --- never stale-as-current ------------------------------------------------

test('a refresh that failed is said in its own sentence, and the age of what is shown is kept', () => {
  const html = page(model({ error: 'gh is not authenticated', ageMin: 380, refreshing: false }));
  const panel = html.match(/<section class="rank"[\s\S]*?<\/section>/)[0];
  assert.match(panel, /gh is not authenticated/);
  assert.match(panel, /6h old/, 'the age of the state on screen is the point of saying the refresh failed');
  assert.match(panel, /class="rank-stale"/);
});

test('a state that was never read shows the declared order and refuses to describe it', () => {
  const html = page(model({
    read: false, ageMin: null, error: 'no GitHub reading has succeeded on this machine yet',
    items: [item(1, 278, { present: false, title: null, state: null, milestone: null })],
    findings: [],
  }));
  assert.match(html, /reason 1/, 'the declaration is local and always readable — it must survive GitHub being down');
  assert.match(html, /no GitHub reading has succeeded on this machine yet/);
  assert.doesNotMatch(html, /rank-state">open/);
});

test('an absent store says the store is absent, and never that the head is empty', () => {
  const html = page(model({
    declaredRead: false, declaredAbsent: true,
    declaredWhy: 'rank/top10.json is not on this machine',
    items: [], findings: [], read: false, error: null, boundary: null,
  }));
  assert.match(html, /rank\/top10\.json is not on this machine/);
  assert.doesNotMatch(html, /Next ten <span class="q-n">0/);
});

test('a page with no ranked head at all renders without one, and does not invent one', () => {
  const html = render({ queue: EMPTY_QUEUE });
  assert.doesNotMatch(html, /<section class="rank"/);
});

// --- a slot open is stated, and no successor is named ----------------------

test('a slot open is reported on the page and no replacement is suggested', () => {
  const html = page(model({
    items: [item(1, 278, { state: 'closed', closedAt: '2026-08-19T00:00:00Z' }), item(2, 275)],
    findings: [{ kind: 'slot-open', issue: 278, rank: 1, title: 'thing 278', closedAt: '2026-08-19T00:00:00Z' }],
    bench: { read: true, open: 10, why: '' },
  }));
  assert.match(html, /slot/i);
  assert.match(html, /10 open/);
  assert.match(html, /prime/i);
});

test('a membership disagreement is visible rather than silently resolved', () => {
  const html = page(model({
    findings: [
      { kind: 'unlabelled-rank', issue: 275, rank: 2 },
      { kind: 'unranked-member', issue: 999, title: 'thing 999' },
    ],
  }));
  assert.match(html, /#275/);
  assert.match(html, /#999/);
});

// --- 390px ------------------------------------------------------------------

test('nothing in the panel can widen the rail on a 390px phone', () => {
  const css = render({ queue: EMPTY_QUEUE, rankHead: model() }).match(/<style>[\s\S]*?<\/style>/)[0];
  const rules = css.split('\n').filter((l) => /^\s*\.rank/.test(l)).join('\n');
  assert.ok(rules.length > 0, 'the panel has no styles of its own');
  assert.doesNotMatch(rules, /\bwidth:\s*\d{3,}px/, 'a fixed pixel width cannot fit a 390px rail');
  assert.doesNotMatch(rules, /white-space:\s*nowrap/, 'a title or reason that refuses to wrap widens the grid track');
  // Every class that can carry a long title, a reason or a URL has to be able to
  // break inside a word: the rail sets no min-width:0, so one unbreakable token
  // widens the whole column.
  for (const cls of ['.rank-title', '.rank-why', '.rank-note']) {
    assert.match(rules, new RegExp(`\\${cls}[^\\n]*overflow-wrap:\\s*anywhere`), `${cls} can overflow the rail`);
  }
});

// --- the collector, against the real store --------------------------------

test('the collector reads the declaration inline and the derived state from cache', () => {
  const ws = tmp();
  const repo = path.join(ws, 'obot.agent');
  fs.mkdirSync(path.join(repo, 'rank'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'rank', 'top10.json'), JSON.stringify({
    repo: 'jwildfire/obot.roadmap', label: 'top10', bench: 'on-deck', boundary: 'b',
    rank: [{ issue: 278, why: 'first' }],
  }));
  writeCache(ws, RANK_CACHE, {
    v: RANK_CACHE_V,
    live: [{ number: 278, state: 'open', title: 'T', url: 'u', labels: ['top10'], milestone: 'm', sub: null, closedAt: null }],
    bench: { read: true, open: 4, why: '' },
  });
  const got = rankPanel(ws, { refresh: false });
  assert.equal(got.declaredRead, true);
  assert.equal(got.read, true, got.error);
  assert.equal(got.items[0].rank, 1);
  assert.equal(got.items[0].why, 'first');
  assert.equal(got.items[0].title, 'T');
  assert.equal(got.bench.open, 4);
  assert.ok(got.ageMin >= 0 && got.ageMin < 1);
});

test('the declaration still renders when no GitHub reading has ever happened', () => {
  const ws = tmp();
  const repo = path.join(ws, 'obot.agent');
  fs.mkdirSync(path.join(repo, 'rank'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'rank', 'top10.json'), JSON.stringify({
    repo: 'jwildfire/obot.roadmap', label: 'top10', bench: 'on-deck', boundary: 'b',
    rank: [{ issue: 278, why: 'first' }],
  }));
  const got = rankPanel(ws, { refresh: false });
  assert.equal(got.declaredRead, true);
  assert.equal(got.read, false);
  assert.equal(got.items.length, 1);
  assert.equal(got.items[0].present, false);
  assert.deepEqual(got.findings, [], 'an unread GitHub cannot produce a finding about GitHub');
});

test('a recorded refresh failure is carried to the page rather than thrown away', () => {
  const ws = tmp();
  const repo = path.join(ws, 'obot.agent');
  fs.mkdirSync(path.join(repo, 'rank'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'rank', 'top10.json'), JSON.stringify({
    repo: 'jwildfire/obot.roadmap', label: 'top10', bench: 'on-deck', rank: [{ issue: 278, why: 'first' }],
  }));
  writeCache(ws, RANK_FAIL, { reason: 'gh: not authenticated' });
  const got = rankPanel(ws, { refresh: false });
  assert.equal(got.read, false);
  assert.match(got.error, /not authenticated/);
});

test('no obot.agent checkout beside the workspace is absence, not a crash', () => {
  const ws = tmp();
  assert.equal(rankRoot(ws), null);
  const got = rankPanel(ws, { refresh: false });
  assert.equal(got.declaredRead, false);
  assert.equal(got.declaredAbsent, true);
  assert.equal(got.items.length, 0);
});

// --- on a machine with no history, over HTTP -------------------------------

let server;
before(async () => {
  const root = tmp();
  const home = path.join(root, 'home');
  const ws = path.join(root, 'workspace');
  fs.mkdirSync(home); fs.mkdirSync(ws);
  const child = spawn(process.execPath, [ENTRY, '--workspace', ws, '--hub', path.join(ws, 'obot.roadmap'), '--serve', '--port', '0'], {
    env: { ...process.env, HOME: home, PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = ''; let err = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { err += c; });
  server = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out}${err}`)), 30000);
    const tick = setInterval(() => {
      const m = out.match(/https?:\/\/127\.0\.0\.1:(\d+)/);
      if (m) { clearInterval(tick); clearTimeout(timer); resolve({ child, url: m[0] }); }
    }, 100);
  });
});
after(() => server?.child.kill());

test('a machine with no obot.agent checkout says the ranked head is not here, and prints no count', async () => {
  const html = await (await fetch(server.url)).text();
  assert.match(html, /<section class="rank"/, 'the panel must appear even with nothing to show — a section that vanishes reads as nothing to report');
  const panel = html.match(/<section class="rank"[\s\S]*?<\/section>/)[0];
  assert.match(panel, /rank\/top10\.json/);
  assert.doesNotMatch(panel, /<span class="q-n">0<\/span>/, 'zero is a measurement and none was made');
});
