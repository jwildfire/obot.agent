// The Operations Dashboard's load-bearing parts: what the queue reads, what the
// store writes, and what the server refuses to serve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { collectConfig, nextConfigId, rcLabel, upcomingVersion } from '../lib/collect.mjs';
import { ensureStore, writeAnswer, readAnswers, readCache, writeCache, SENTINEL } from '../lib/store.mjs';
import { artifactPath, parseArgs, serve } from '../ops-dashboard.mjs';
import { render, sessionShell, navigatorShell, TABS, esc } from '../lib/render.mjs';
import { parseNavigatorState } from '../lib/navigator.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opsdash-'));

const emptyQueue = {
  rcs: { items: [], refreshing: false },
  config: { items: [] },
  decisions: { items: [] },
  items: [],
};

test('the ops store carries the local-only sentinel on everything it writes', () => {
  const ws = tmp();
  const rec = writeAnswer(ws, { artifact: 'a-slug', verdict: 'adopt-all', words: 'go' });
  const onDisk = fs.readFileSync(path.join(ws, '.claude', 'ops', 'answers', `${rec.id}.json`), 'utf8');
  assert.ok(onDisk.includes(SENTINEL), 'answer file must carry the sentinel the hub deploy greps for');
  assert.ok(fs.readFileSync(path.join(ws, '.claude', 'ops', 'README.md'), 'utf8').includes(SENTINEL));
});

test('answers are append-only — a second answer never overwrites the first', () => {
  const ws = tmp();
  writeAnswer(ws, { artifact: 'a', verdict: 'defer', words: 'not yet' });
  writeAnswer(ws, { artifact: 'a', verdict: 'approve', words: 'now' });
  const all = readAnswers(ws);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((a) => a.verdict).sort(), ['approve', 'defer']);
  assert.equal(all.every((a) => a.status === 'staged'), true);
});

test('a fresh store has no answers and does not throw reading them', () => {
  assert.deepEqual(readAnswers(tmp()), []);
});

test('a cache entry goes stale on the age it was asked for', () => {
  const ws = tmp();
  ensureStore(ws);
  writeCache(ws, 'rcs', [{ key: 'r#1' }]);
  assert.equal(readCache(ws, 'rcs', 30).stale, false);
  assert.deepEqual(readCache(ws, 'rcs', 30).value, [{ key: 'r#1' }]);

  // An hour-old sweep, written by hand because writeCache always stamps "now".
  const old = { at: new Date(Date.now() - 60 * 60000).toISOString(), value: [] };
  fs.writeFileSync(path.join(ws, '.claude', 'ops', 'cache', 'rcs.json'), JSON.stringify(old));
  assert.equal(readCache(ws, 'rcs', 30).stale, true);

  assert.equal(readCache(ws, 'never-written'), null);
});

test('config items come off the local file, headlines and ids only', () => {
  const ws = tmp();
  fs.mkdirSync(path.join(ws, '.claude'), { recursive: true });
  // The list's real schema, wrapped lines and all — a headline is the bold run
  // after the dates, not the first line of the entry, and the id leads the entry
  // so it survives a reword.
  fs.writeFileSync(path.join(ws, '.claude', 'blockers.md'), `# Blockers

## Open

- [ ] c0002 \u00b7 filed 2026-08-15 \u00b7 verified 2026-08-15 \u2014 **workspace allowlist line for
  the thing** \u2014 fix: paste this. Provenance: a session hit it.

- [ ] c0004 \u00b7 filed 2026-08-15 \u00b7 UNVERIFIED tonight (device-side) \u2014 **an Apple Reminders list**
  \u2014 fix: make it.

- [x] c0003 \u00b7 filed 2026-08-01 \u2014 **already done** \u2014 should not appear.

## Resolved (kept as lifecycle evidence)

- [x] c0001 \u2014 **An old one** \u2014 done.
`);
  const { items } = collectConfig(ws);
  assert.deepEqual(items.map((i) => i.title), ['workspace allowlist line for the thing', 'an Apple Reminders list']);
  assert.deepEqual(items.map((i) => i.id), ['c0002', 'c0004']);
  // The id is the handle he quotes in chat, so it is also the row's identity.
  assert.deepEqual(items.map((i) => i.key), ['c0002', 'c0004']);
  assert.equal(items[0].date, '2026-08-15');
  // The body is the sensitive half; a queue row must not carry it.
  assert.equal(items.every((i) => !i.detail), true);
  assert.equal(items.every((i) => i.kind === 'config'), true);
});

test('a config id is never reused — the next one clears every id in the file', () => {
  // c0003 is checked off and c0001 is retired to Resolved: neither number comes back.
  const md = `## Open

- [ ] c0002 \u2014 **live** \u2014 fix: x.

## Resolved

- [x] c0001 \u2014 **retired** \u2014 done.
- [x] c0003 \u2014 **also retired** \u2014 done.
`;
  assert.equal(nextConfigId(md), 'c0004');
  assert.equal(nextConfigId('nothing here'), 'c0001');
  assert.equal(nextConfigId('- [ ] c0099 \u2014 **x**'), 'c0100');
});

test('an entry with no id still renders rather than disappearing', () => {
  const ws = tmp();
  fs.mkdirSync(path.join(ws, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.claude', 'blockers.md'),
    '## Open\n\n- [ ] filed 2026-08-15 \u2014 **not yet numbered** \u2014 fix: backfill it.\n');
  const { items } = collectConfig(ws);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, null);
  assert.ok(items[0].key, 'an unnumbered row still needs a key to be selectable');
});

test('a workspace with no config file degrades instead of throwing', () => {
  const { items, error } = collectConfig(tmp());
  assert.deepEqual(items, []);
  assert.ok(error);
});

test('the artifact route refuses anything that is not a decision folder', () => {
  const hub = tmp();
  const dir = path.join(hub, 'reports', 'decisions', '2026-08-15-real');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<p>hi</p>');

  assert.ok(artifactPath(hub, '/artifact/2026-08-15-real/'));
  assert.equal(artifactPath(hub, '/artifact/2026-08-15-real/'), path.join(dir, 'index.html'));
  // Traversal, absolute escapes, and dotfiles: the server can reach the whole disk,
  // so a request path is not a filename until this says it is.
  assert.equal(artifactPath(hub, '/artifact/..%2F..%2Fetc/'), null);
  assert.equal(artifactPath(hub, '/artifact/../../../../etc/passwd'), null);
  assert.equal(artifactPath(hub, '/artifact/.ssh/'), null);
  assert.equal(artifactPath(hub, '/artifact/does-not-exist/'), null);
  assert.equal(artifactPath(hub, '/'), null);
  assert.equal(artifactPath(hub, '/answer'), null);
});

test('args default the hub to the clone inside the workspace', () => {
  const a = parseArgs(['--workspace', '/w']);
  assert.equal(a.hub, path.resolve('/w/obot.roadmap'));
  assert.equal(a.port, 7326);
  assert.equal(parseArgs(['--port', '9000']).port, 9000);
});

const fullQueue = {
  rcs: { items: [{ kind: 'rc', key: 'jwildfire/gsm.safety#52', title: 'gsm.safety v1.1.0 — participant metrics', detail: 'jwildfire/gsm.safety' }], refreshing: false },
  config: { items: [{ kind: 'config', id: 'c0001', key: 'c0001', title: 'An allowlist line' }] },
  decisions: { items: [{ kind: 'decision', id: 'D0007', key: 's', title: 'A call', artifact: 's', detail: 'Awaiting' }] },
  items: [],
};

test('the page renders the three counts and the persistent header', () => {
  const html = render({ queue: fullQueue, staged: [] });
  assert.ok(html.includes('1 release candidate<'), 'singular, not "1 release candidates"');
  assert.ok(html.includes('1 config<'));
  assert.ok(html.includes('1 decision<'));
  assert.ok(html.includes('header class="top"'));
  assert.ok(html.includes('Adopt all recommendations'), '"adopt all" must be one action');
});

test('the vocabulary he reads is "config" — "your hands" appears nowhere', () => {
  const html = render({ queue: fullQueue, staged: [] });
  assert.ok(!/your hands/i.test(html), 'the label he renamed on 2026-08-15 must be gone from every surface');
  assert.ok(html.includes('c0001'), 'a config row is identified by its permanent id');
});

test('the rail runs release candidates, then decisions, then config', () => {
  const html = render({ queue: fullQueue, staged: [] });
  const start = html.indexOf('<nav class="rail"');
  const rail = html.slice(start, html.indexOf('</nav>', start));
  const rc = rail.indexOf('Release candidates');
  const dec = rail.indexOf('Decisions');
  const cfg = rail.indexOf('Config');
  assert.ok(rc > -1 && dec > -1 && cfg > -1, 'all three sections render');
  assert.ok(rc < dec && dec < cfg, `order he asked for on 2026-08-15: RCs -> decisions -> config (got ${rc}, ${dec}, ${cfg})`);
});

test('both views are tabs on one site and the dashboard is the default', () => {
  const ops = render({ queue: fullQueue, staged: [] });
  assert.ok(ops.includes('class="tabs"'), 'the tab strip lives in the persistent header');
  assert.ok(/href="\/"[^>]*aria-current="page"/.test(ops), 'the Operations tab is current on /');
  assert.ok(ops.includes('href="/live.html"'), 'the session hub is reachable as the second tab');

  const session = sessionShell({ frame: '/session/frame' });
  assert.ok(session.includes('class="tabs"'), 'the same header carries across both tabs');
  assert.ok(/href="\/live\.html"[^>]*aria-current="page"/.test(session), 'the session tab is current on /live.html');
  assert.ok(session.includes('src="/session/frame"'), 'the session view renders unchanged inside the shell');
});

test('an empty queue says so rather than rendering an empty frame', () => {
  const html = render({ queue: emptyQueue, staged: [] });
  assert.ok(html.includes('Nothing is waiting on you.'));
});

test('queue text is escaped — artifact titles are not trusted markup', () => {
  const html = render({
    queue: { ...emptyQueue, decisions: { items: [{ kind: 'decision', key: 'x', artifact: 'x', title: '<img src=x onerror=alert(1)>' }] } },
    staged: [],
  });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x'));
  assert.equal(esc('a&b<c>'), 'a&amp;b&lt;c&gt;');
});

test('a release candidate reads "package version — what it is"', () => {
  // The rule (@jwildfire, 2026-08-15): every RC starts with a package name and a
  // version number. The label is derived, so a PR titled any other way still reads
  // right on the page.
  assert.equal(
    rcLabel({ repo: 'jwildfire/gsm.safety', title: 'Release candidate: gsm.safety v1.1.0 — the participant-level metrics phase' }),
    'gsm.safety v1.1.0 — the participant-level metrics phase',
  );
  // Already correct: normalizing must not double the prefix.
  assert.equal(
    rcLabel({ repo: 'jwildfire/open.gismo', title: 'open.gismo v0.2.0 — local-first engine' }),
    'open.gismo v0.2.0 — local-first engine',
  );
  // A version named in the title belongs to another package — the repo's own
  // version comes from the release it is heading for.
  assert.equal(
    rcLabel({ repo: 'jwildfire/gsm.safety', title: 'Adopt safety.viz v1.6.0: two new widgets', version: '1.1.0' }),
    'gsm.safety v1.1.0 — Adopt safety.viz v1.6.0: two new widgets',
  );
  // No version anywhere: name the package, never invent a number.
  assert.equal(
    rcLabel({ repo: 'jwildfire/obot.agent', title: 'The guardrail files stop being prose' }),
    'obot.agent — The guardrail files stop being prose',
  );
  assert.equal(rcLabel({ repo: '', title: 'bare' }), 'bare');
});

test('the version comes off the NEWS (Upcoming) heading in the local clone', () => {
  const ws = tmp();
  fs.mkdirSync(path.join(ws, 'safety.viz'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'safety.viz', 'NEWS.md'), '<!-- header -->\n\n# safety.viz v1.7.0 (Upcoming)\n\n- a thing\n\n# safety.viz v1.6.0\n');
  assert.equal(upcomingVersion(ws, 'jwildfire/safety.viz'), '1.7.0');
  assert.equal(upcomingVersion(ws, 'jwildfire/not-cloned'), null);
});

test('one site, one port: the dashboard is / and the session hub is /live.html', async () => {
  const ws = tmp();
  fs.mkdirSync(path.join(ws, '.claude', 'session-hub'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.claude', 'session-hub', 'live.html'), '<!doctype html><title>Session hub</title><p>live</p>');
  const { server, url } = await serve({ workspace: ws, hub: path.join(ws, 'obot.roadmap'), port: 0 });
  const get = async (p) => { const r = await fetch(new URL(p, url)); return { status: r.status, body: await r.text() }; };
  try {
    const ops = await get('/');
    assert.equal(ops.status, 200);
    assert.ok(ops.body.includes('Operations Dashboard'), 'the default view is the dashboard');

    // The status line builds this exact path from the marker port — it must land
    // on the session tab, not a 404.
    const session = await get('/live.html');
    assert.equal(session.status, 200);
    assert.ok(session.body.includes('/session/frame'), 'the session tab wraps the session-hub view');

    const frame = await get('/session/frame');
    assert.ok(frame.body.includes('<p>live</p>'), 'the session-hub render is served unchanged');

    // The navigator tab reads the sweep file on every request; with none written it
    // says so rather than rendering an empty page.
    const nav = await get('/navigator');
    assert.equal(nav.status, 200);
    assert.ok(nav.body.includes('navigator-state.md'));
    fs.writeFileSync(path.join(ws, '.claude', 'session-hub', 'navigator-state.md'),
      'swept: 2020-01-01 00:00 · cadence 5m · ok\n\n## RC queue\n\n- **repo#1** something https://example.test/1 [verified gh 00:00]\n');
    const swept = await get('/navigator');
    assert.ok(swept.body.includes('observer is dead'), 'a 2020 sweep is not current data');
    assert.ok(swept.body.includes('repo#1'));

    // The marker is how the status line finds the merged site.
    const marker = JSON.parse(fs.readFileSync(path.join(ws, '.claude', 'session-hub', 'serve.json'), 'utf8'));
    assert.equal(marker.pid, process.pid);
    assert.equal(marker.port, server.address().port);
  } finally {
    server.close();
  }
});

test('the capture tool claims the next id, and never an id the file has seen', () => {
  const ws = tmp();
  const log = new URL('../../blocker-log', import.meta.url).pathname;
  const file = (...a) => execFileSync(log, a, { env: { ...process.env, OBOT_WORKSPACE: ws }, encoding: 'utf8' });

  file('first item', '--fix', 'type this', '--source', 'a session');
  file('second item', '--fix', 'type that', '--source', 'a session');
  const md = fs.readFileSync(path.join(ws, '.claude', 'blockers.md'), 'utf8');
  assert.match(md, /- \[ \] c0001 · filed \d{4}-\d{2}-\d{2}/);
  assert.match(md, /- \[ \] c0002 · filed \d{4}-\d{2}-\d{2}/);

  // Ids are the dashboard's row identity, so the two halves must agree.
  assert.deepEqual(collectConfig(ws).items.map((i) => i.id), ['c0001', 'c0002']);
  assert.equal(nextConfigId(md), 'c0003');

  // A retired item still owns its number: the next claim clears it.
  fs.appendFileSync(path.join(ws, '.claude', 'blockers.md'), '\n## Resolved\n\n- [x] c0009 — **retired** — done.\n');
  file('third item', '--fix', 'type the other', '--source', 'a session');
  assert.match(fs.readFileSync(path.join(ws, '.claude', 'blockers.md'), 'utf8'), /- \[ \] c0010 · filed/);
});

const NAV_STATE = `# navigator-state — 🧭🤖 Navigator RC-review sweep

Sole writer: \`sweep.mjs\`. **Stale rule: if \`swept:\` is older than 3× the cadence (15 min), the observer is dead.**

swept: 2026-08-15 22:30 · cadence 5m · ok — 7 repos, 2 RCs

## RC queue — open PRs awaiting or holding @jwildfire review

- **gsm.safety#52** "gsm.safety v1.1.0" → \`main\` · no review yet · https://github.com/jwildfire/gsm.safety/pull/52 [verified gh 22:30]

## Recent events (newest first, capped 15)

- 12:49 RC GONE safety.viz#135 — MERGED [verified gh 12:49]
`;

test('the navigator state parses into its swept stamp and its sections', () => {
  const s = parseNavigatorState(NAV_STATE, new Date('2026-08-15T22:33:00'));
  assert.equal(s.sweptAt, '2026-08-15 22:30');
  assert.equal(s.summary, 'cadence 5m · ok — 7 repos, 2 RCs');
  assert.equal(s.stale, false);
  assert.equal(s.ageMin, 3);
  assert.deepEqual(s.sections.map((x) => x.title), ['RC queue', 'Recent events']);
  assert.equal(s.sections[0].items[0].text.includes('gsm.safety#52'), true);
  assert.equal(s.sections[0].items[0].url, 'https://github.com/jwildfire/gsm.safety/pull/52');
});

test('a section the sweep has not invented yet still renders — the ledger seam', () => {
  // Per-agent attribution is a different sibling's problem; when its writer adds a
  // section this tab must render it without being touched.
  const s = parseNavigatorState(`${NAV_STATE}\n## By agent\n\n- 22:10 👯🤖 opsdb2 — opened obot.agent#118 https://github.com/jwildfire/obot.agent/issues/118\n`, new Date('2026-08-15T22:33:00'));
  assert.deepEqual(s.sections.map((x) => x.title), ['RC queue', 'Recent events', 'By agent']);
  const html = navigatorShell({ state: s });
  assert.ok(html.includes('By agent'), 'an unknown section renders as itself, no code change needed');
  assert.ok(html.includes('opsdb2'));
});

test('a dead observer says so instead of passing stale content off as current', () => {
  const fresh = parseNavigatorState(NAV_STATE, new Date('2026-08-15T22:35:00'));
  assert.equal(fresh.stale, false);
  assert.ok(!/observer/i.test(navigatorShell({ state: fresh })));

  // 3× the 5-minute cadence is the line the state file itself draws.
  const dead = parseNavigatorState(NAV_STATE, new Date('2026-08-15T22:52:00'));
  assert.equal(dead.stale, true);
  assert.equal(dead.ageMin, 22);
  const html = navigatorShell({ state: dead });
  assert.ok(/observer is dead|not current/i.test(html), 'the tab must not present a dead sweep as current');
  assert.ok(html.includes('launchctl kickstart'), 'and it must carry the restart command');
});

test('no state file at all is a sentence, not an empty tab', () => {
  const html = navigatorShell({ missing: '/w/.claude/session-hub/navigator-state.md' });
  assert.ok(html.includes('navigator-state.md'));
  assert.ok(html.includes('class="tabs"'));
});

test('the tab strip is data-driven — a fourth tab is one entry', () => {
  assert.deepEqual(TABS.map((t) => t.href), ['/', '/live.html', '/navigator']);
  const html = navigatorShell({ missing: 'x' });
  assert.ok(/href="\/navigator"[^>]*aria-current="page"/.test(html));
  assert.equal((html.match(/class="tabs"/g) || []).length, 1);
  assert.equal((render({ queue: fullQueue, staged: [] }).match(/<a href="\/(live\.html|navigator)?"/g) || []).length, 3);
});
