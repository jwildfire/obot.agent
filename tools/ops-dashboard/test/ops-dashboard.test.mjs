// The Operations Dashboard's load-bearing parts: what the queue reads, what the
// store writes, and what the server refuses to serve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import {
  collectConfig, collectRCs, isReleaseCandidate, nextConfigId, parseRCBody, rcLabel,
  rcSub, upcomingVersion, RC_CACHE, RC_CACHE_V,
} from '../lib/collect.mjs';
import { ensureStore, readCache, writeCache, SENTINEL } from '../lib/store.mjs';
import {
  recordAnswer, readAnswers, currentAnswers, pendingAnswers, deliverAnswers,
  markApplied, resolveDecision, answersSection, OVERDUE_MIN,
} from '../lib/answers.mjs';
import { artifactPath, parseArgs, serve } from '../ops-dashboard.mjs';
import { render, sessionShell, sessionLogShell, navigatorShell, navigatorRecordShell, foldedLane, standardLane, TABS, esc } from '../lib/render.mjs';
import { parseNavigatorState } from '../lib/navigator.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opsdash-'));

// A hub clone with the two files the answer pipeline joins against: the id
// registry and an artifact page for the applied link.
function hubWith(artifacts) {
  const hub = tmp();
  const dir = path.join(hub, 'reports', 'decisions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ prefix: 'D', artifacts }));
  for (const a of artifacts) {
    fs.mkdirSync(path.join(dir, a.slug), { recursive: true });
    fs.writeFileSync(path.join(dir, a.slug, 'index.html'), `<title>${a.title ?? a.slug}</title>`);
  }
  return hub;
}

const D3 = {
  id: 'D0003',
  slug: '2026-08-14-demo-301-site-size',
  title: "demo-301's site branch — what the fork actually costs",
  questions: [
    { id: 'D0003.1', code: 'S1', question: 'Drop the duplicate root tree?' },
    { id: 'D0003.2', code: 'S2', question: 'Shrink the data extracts?' },
  ],
};

const emptyQueue = {
  rcs: { items: [], refreshing: false },
  config: { items: [] },
  decisions: { items: [] },
  items: [],
};

test('the ops store carries the local-only sentinel on everything it writes', () => {
  const ws = tmp();
  const { record } = recordAnswer(ws, { artifact: 'a-slug', verdict: 'adopt-all', words: 'go' });
  const onDisk = fs.readFileSync(path.join(ws, '.claude', 'ops', 'answers', `${record.id}.json`), 'utf8');
  assert.ok(onDisk.includes(SENTINEL), 'answer file must carry the sentinel the hub deploy greps for');
  assert.ok(fs.readFileSync(path.join(ws, '.claude', 'ops', 'README.md'), 'utf8').includes(SENTINEL));
});

test('a changed answer supersedes the earlier one and never deletes it', () => {
  const ws = tmp();
  const first = recordAnswer(ws, { artifact: 'a', verdict: 'defer', words: 'not yet' }).record;
  const second = recordAnswer(ws, { artifact: 'a', verdict: 'approve', words: 'now' }).record;

  // Both files survive — he decided the first one too, and a changed mind is a fact.
  const all = readAnswers(ws);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((a) => a.verdict).sort(), ['approve', 'defer']);

  // And which one is his *now* is in the data, not in the mtimes.
  const older = all.find((a) => a.id === first.id);
  assert.equal(older.status, 'superseded');
  assert.equal(older.supersededBy, second.id);
  assert.deepEqual(second.supersedes, [first.id]);
  assert.deepEqual(currentAnswers(ws).map((a) => a.id), [second.id]);
});

test('a fresh store has no answers and does not throw reading them', () => {
  assert.deepEqual(readAnswers(tmp()), []);
});

// The release-lane classifier, on the exact rows that were wrong on 2026-08-16: the
// dashboard showed three release candidates and the Navigator sweep showed two.
const RELEASES = new Map([
  ['jwildfire/gsm.safety', ['main']],
  ['jwildfire/open.gismo', ['main']],
  ['jwildfire/obot.agent', ['stable']],
  ['jwildfire/obot.roadmap', []],
]);
const row = (o) => ({ bucket: 'you', repo: 'jwildfire/gsm.safety', number: 1, base: 'main', draft: false, reviewRequests: [], reviewDecision: '', ...o });

test('the RC panel classifies by release lane, not by readiness', () => {
  // gsm.safety#52 and open.gismo#10 — both into a release-role branch.
  assert.equal(isReleaseCandidate(row({ number: 52, base: 'main' }), RELEASES), true);
  assert.equal(isReleaseCandidate(row({ number: 10, repo: 'jwildfire/open.gismo', base: 'main' }), RELEASES), true);
  // gsm.safety#51 — green, unblocked, and ordinary work into the integration branch.
  assert.equal(isReleaseCandidate(row({ number: 51, base: 'dev' }), RELEASES), false);
});

test('readiness still gates: an RC the agent owns is not in his queue', () => {
  assert.equal(isReleaseCandidate(row({ bucket: 'agent' }), RELEASES), false);
  assert.equal(isReleaseCandidate(row({ bucket: 'waiting' }), RELEASES), false);
});

test('a repo whose release branch is not main is judged on its own lane', () => {
  // obot.agent releases main -> stable, so a PR into main is integration work.
  assert.equal(isReleaseCandidate(row({ repo: 'jwildfire/obot.agent', base: 'main' }), RELEASES), false);
  assert.equal(isReleaseCandidate(row({ repo: 'jwildfire/obot.agent', base: 'stable' }), RELEASES), true);
  // obot.roadmap has no release branch at all; nothing there is an RC by lane.
  assert.equal(isReleaseCandidate(row({ repo: 'jwildfire/obot.roadmap', base: 'main' }), RELEASES), false);
});

test('he can still be pulled in by name, and a repo off the policy degrades to that', () => {
  assert.equal(isReleaseCandidate(row({ base: 'dev', reviewRequests: ['jwildfire'] }), RELEASES), true);
  assert.equal(isReleaseCandidate(row({ base: 'dev', reviewDecision: 'APPROVED' }), RELEASES), true);
  assert.equal(isReleaseCandidate(row({ repo: 'jwildfire/not-in-policy', base: 'main' }), RELEASES), false);
  assert.equal(isReleaseCandidate(row({ repo: 'jwildfire/not-in-policy', base: 'main', reviewRequests: ['jwildfire'] }), RELEASES), true);
});

test('what the queue drops is named, never silently removed', () => {
  // Both fixes leave something out of a panel. A queue that quietly loses a row and a
  // queue that is right look identical, so each removal says where the row went.
  const folded = foldedLane([{ id: 'D0015', into: 'D0017' }, { id: 'D0016', into: 'D0017' }]);
  assert.match(folded, /2 decisions were folded/);
  assert.match(folded, /D0015 &rarr; D0017/);
  assert.match(folded, /D0016 &rarr; D0017/);

  const std = standardLane([{ key: 'jwildfire/gsm.safety#51', base: 'dev', url: 'https://x/51' }]);
  assert.match(std, /One other open PR is on the standard lane/);
  assert.match(std, /gsm\.safety#51/);
  assert.match(std, /<code>dev<\/code>/);

  assert.equal(foldedLane([]), '');
  assert.equal(standardLane([]), '');
});

test('the lane cache is its own file, so a running older server cannot choke on it', () => {
  // Not hypothetical. Writing the new shape into `rcs.json` on 2026-08-16 reached
  // into the server already running on his machine and turned the live queue page
  // into a 500 in one request — from a change that had not been deployed yet.
  assert.notEqual(RC_CACHE, 'rcs');
  const ws = tmp();
  ensureStore(ws);
  writeCache(ws, 'rcs', [{ kind: 'rc', key: 'jwildfire/gsm.safety#51' }]);
  collectRCs(ws, {});
  assert.deepEqual(readCache(ws, 'rcs', 30).value, [{ kind: 'rc', key: 'jwildfire/gsm.safety#51' }],
    'the old file is left exactly as the old code wrote it');
});

test('a cache written before the classifier is treated as absent, not relabelled', () => {
  const ws = tmp();
  ensureStore(ws);
  // The old shape: a bare array, whose membership was decided by the bucket alone
  // and whose items carry no base branch — so it cannot be re-judged, only refetched.
  writeCache(ws, RC_CACHE, [{ kind: 'rc', key: 'jwildfire/gsm.safety#51', title: 'x' }]);
  const stale = collectRCs(ws, {});
  assert.deepEqual(stale.items, []);
  assert.equal(stale.refreshing, true);

  writeCache(ws, RC_CACHE, { v: RC_CACHE_V, items: [{ kind: 'rc', key: 'jwildfire/gsm.safety#52', repo: 'jwildfire/gsm.safety', title: 'gsm.safety v1.1.0-RC1' }], standard: [{ key: 'jwildfire/gsm.safety#51', base: 'dev' }] });
  const fresh = collectRCs(ws, {});
  assert.equal(fresh.refreshing, false);
  assert.deepEqual(fresh.items.map((i) => i.key), ['jwildfire/gsm.safety#52']);
  assert.deepEqual(fresh.standard.map((s) => s.key), ['jwildfire/gsm.safety#51']);
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

  const session = sessionShell({});
  assert.ok(session.includes('class="tabs"'), 'the same header carries across both tabs');
  assert.ok(/href="\/live\.html"[^>]*aria-current="page"/.test(session), 'the session tab is current on /live.html');
  // The old live view moved to the record page — the brief links it, one answer
  // per page (jwildfire/obot.roadmap#218).
  assert.ok(!session.includes('src="/session/frame"'), 'the brief carries no second dashboard');
  const log = sessionLogShell({ roster: null });
  assert.ok(log.includes('src="/session/frame"'), 'the session view renders unchanged inside the record shell');
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

test('a release candidate reads "{package} vX.Y.Z-RCn" and carries no summary', () => {
  // The rule (@jwildfire, 2026-08-15, superseding his own earlier same-day rule):
  // "New rule for release candidate names: {package} Vx.x.x-RCx. No other summary
  // allowed." The title now *is* the label, so the deriver's job shrank from
  // synthesising a description to stripping one off legacy titles.
  assert.equal(
    rcLabel({ repo: 'jwildfire/gsm.safety', title: 'gsm.safety v1.1.0-RC1' }),
    'gsm.safety v1.1.0-RC1',
  );
  // A legacy title carrying a summary loses it — no summary is allowed, and the
  // page must not keep showing one the rule has retired.
  assert.equal(
    rcLabel({ repo: 'jwildfire/gsm.safety', title: 'Release candidate: gsm.safety v1.1.0 — the participant-level metrics phase' }),
    'gsm.safety v1.1.0-RC1',
  );
  assert.equal(
    rcLabel({ repo: 'jwildfire/open.gismo', title: 'open.gismo v0.2.0 — local-first engine' }),
    'open.gismo v0.2.0-RC1',
  );
  // An -RCn already in the title is authoritative and is never renumbered.
  assert.equal(
    rcLabel({ repo: 'jwildfire/gsm.safety', title: 'gsm.safety v1.1.0-RC3 — leftover summary' }),
    'gsm.safety v1.1.0-RC3',
  );
  // Idempotent: relabelling a correct label returns it unchanged.
  assert.equal(
    rcLabel({ repo: 'jwildfire/gsm.safety', title: rcLabel({ repo: 'jwildfire/gsm.safety', title: 'gsm.safety v1.1.0-RC2' }) }),
    'gsm.safety v1.1.0-RC2',
  );
  // A version named in the title belongs to another package — the repo's own
  // version comes from the release it is heading for.
  assert.equal(
    rcLabel({ repo: 'jwildfire/gsm.safety', title: 'Adopt safety.viz v1.6.0: two new widgets', version: '1.1.0' }),
    'gsm.safety v1.1.0-RC1',
  );
  // No version anywhere: name the package, never invent a number — and with no
  // version there is no candidate to count either.
  assert.equal(
    rcLabel({ repo: 'jwildfire/obot.agent', title: 'The guardrail files stop being prose' }),
    'obot.agent',
  );
  assert.equal(rcLabel({ repo: '', title: 'bare' }), 'bare');
});

test('the RC row keeps a second line, because the title no longer explains itself', () => {
  // The cost of "no other summary allowed": `gsm.safety v1.1.0-RC1` in a queue of
  // five tells him nothing about which release it is. The description moves to a
  // second line taken from the PR body's one-sentence exec summary, which the RC
  // body contract (@jwildfire, 2026-08-15, item 2) guarantees is there and first.
  assert.equal(
    rcSub({ lead: 'Adds the participant-level metrics phase: six widgets and their workflows.' }),
    'Adds the participant-level metrics phase: six widgets and their workflows.',
  );
  // Markdown emphasis and links are stripped — this is one plain line on a phone.
  assert.equal(
    rcSub({ lead: '**Adds** the [metrics phase](https://example.com/x) end to end.' }),
    'Adds the metrics phase end to end.',
  );
  // reviews-queue's own miss marker is not a sentence; show nothing rather than it.
  assert.equal(rcSub({ lead: '(no summary in the body)' }), null);
  assert.equal(rcSub({}), null);
  // Long leads are cut at a word boundary — the row is one line, not a paragraph.
  const long = rcSub({ lead: 'w'.repeat(30) + ' ' + 'x'.repeat(30) + ' ' + 'y'.repeat(60) + ' tail' });
  assert.ok(long.length <= 121, `sub was ${long.length} chars`);
  assert.ok(long.endsWith('…'));
});

test('the RC second line renders under the title, and is escaped like everything else', () => {
  const html = render({
    queue: {
      ...emptyQueue,
      rcs: { items: [{ kind: 'rc', key: 'jwildfire/gsm.safety#52', title: 'gsm.safety v1.1.0-RC1', sub: 'Adds the participant-level metrics phase.', url: 'https://example.com/pr/52' }], refreshing: false },
    },
    staged: [],
  });
  assert.ok(html.includes('gsm.safety v1.1.0-RC1'));
  assert.ok(html.includes('<span class="q-sub">'));
  assert.ok(html.includes('Adds the participant-level metrics phase.'));
  // A row with no second line keeps exactly the markup it had before.
  const bare = render({
    queue: { ...emptyQueue, rcs: { items: [{ kind: 'rc', key: 'r#1', title: 'obot.agent v0.5.0-RC1' }], refreshing: false } },
    staged: [],
  });
  // Matched on the markup, not the stylesheet — the CSS always defines .q-sub.
  assert.ok(!bare.includes('<span class="q-sub">'));
  // The lead comes off a PR body, so it is no more trusted than any other title.
  const nasty = render({
    queue: { ...emptyQueue, rcs: { items: [{ kind: 'rc', key: 'r#1', title: 'x v1.0.0-RC1', sub: '<img src=x onerror=alert(1)>' }], refreshing: false } },
    staged: [],
  });
  assert.ok(!nasty.includes('<img src=x'));
  assert.ok(nasty.includes('&lt;img src=x'));
});

const RC_BODY = `## \u26d4 Release candidate — merges only on @jwildfire's approval, via the attested lane

Adds the participant-level metrics phase: six widgets and their workflows.

- **See it move:** [annotated demo](https://jwildfire.github.io/obot.roadmap/reports/gs-v1.1-demo/)
- **Release notes:** [NEWS.md](https://github.com/jwildfire/gsm.safety/blob/dev/NEWS.md) — the v1.1.0 (Upcoming) section
- [the widget parity matrix](https://jwildfire.github.io/obot.roadmap/reports/parity/)

### Requirements this release closes
- Closes #12 — the six safety.viz widgets, wrapped as R htmlwidgets
- Closes #14 — the qcthat qualification evidence bundle

**The ask:** approve and I tag v1.1.0.

### Technical briefing
Details nobody reads on a phone.
`;

test('the RC body parses into the panel the dashboard renders instead of an iframe', () => {
  // github.com sends `x-frame-options: deny`, so a PR cannot be framed at all
  // (verified 2026-08-15). The panel is therefore built from the body, which the RC
  // body contract (@jwildfire, 2026-08-15, item 2) gives a fixed shape.
  const rc = parseRCBody(RC_BODY);
  assert.equal(rc.summary, 'Adds the participant-level metrics phase: six widgets and their workflows.');
  assert.equal(rc.demo, 'https://jwildfire.github.io/obot.roadmap/reports/gs-v1.1-demo/');
  assert.equal(rc.news, 'https://github.com/jwildfire/gsm.safety/blob/dev/NEWS.md');
  assert.deepEqual(rc.requirements, [
    { ref: '#12', text: 'the six safety.viz widgets, wrapped as R htmlwidgets' },
    { ref: '#14', text: 'the qcthat qualification evidence bundle' },
  ]);
  // Every above-the-fold link is kept, in order, so the panel shows what he linked.
  assert.equal(rc.links.length, 3);
  assert.equal(rc.links[0].label, 'annotated demo');
  assert.equal(rc.ask, 'approve and I tag v1.1.0.');
});

test('a body that ignores the contract degrades instead of throwing', () => {
  // Legacy RCs predate the contract, and the panel must still open for them.
  const rc = parseRCBody('Some prose with no structure at all.');
  assert.equal(rc.summary, 'Some prose with no structure at all.');
  assert.equal(rc.demo, null);
  assert.equal(rc.news, null);
  assert.deepEqual(rc.requirements, []);
  assert.deepEqual(parseRCBody('').requirements, []);
  assert.equal(parseRCBody(null).summary, null);
});

test('only a Pages demo is framed — a demo link off Pages is a link, never an iframe', () => {
  // Anything that is not a jwildfire.github.io page either refuses to frame
  // (x-frame-options) or is not ours to embed. `frameable` is what the client keys on.
  assert.equal(parseRCBody(RC_BODY).frameable, true);
  const offsite = parseRCBody('x\n\n- **See it move:** [demo](https://example.com/demo/)\n');
  assert.equal(offsite.demo, 'https://example.com/demo/');
  assert.equal(offsite.frameable, false);
  // A GitHub PR link is never frameable, whatever it is labelled.
  const gh = parseRCBody('x\n\n- **See it move:** [demo](https://github.com/jwildfire/x/pull/1)\n');
  assert.equal(gh.frameable, false);
});

test('the RC panel ships its data to the client, and an RC no longer bounces to GitHub', () => {
  const html = render({
    queue: {
      ...emptyQueue,
      rcs: { items: [{
        kind: 'rc', key: 'jwildfire/gsm.safety#52', repo: 'jwildfire/gsm.safety',
        title: 'gsm.safety v1.1.0-RC1', sub: 'Adds the metrics phase.',
        url: 'https://github.com/jwildfire/gsm.safety/pull/52',
        checks: { state: 'green', passed: 4, failing: 0, pending: 0 },
        rc: parseRCBody(RC_BODY),
      }], refreshing: false },
    },
    staged: [],
  });
  // The panel renders client-side from an embedded blob, so it opens from the cache
  // with the network down.
  assert.ok(html.includes('id="rc-data"'));
  assert.ok(html.includes('gs-v1.1-demo'));
  assert.ok(html.includes('renderRC'));
  // The old behaviour was to bounce him to GitHub on click. It is gone.
  assert.ok(!html.includes("window.open(li.dataset.url"));
  // Approving still happens on GitHub — the RC gate stays deliberate.
  assert.ok(html.includes('Open on GitHub to approve'));
  // The embedded JSON must never be able to close its own script tag.
  const nasty = render({
    queue: { ...emptyQueue, rcs: { items: [{ kind: 'rc', key: 'r#1', title: 'x', rc: parseRCBody('</script><img src=x onerror=alert(1)>') }], refreshing: false } },
    staged: [],
  });
  assert.ok(!nasty.includes('</script><img'));
});

test('a real pre-contract RC body parses without picking up the wrong links', () => {
  // Shape taken from open.gismo#10 (2026-08-15), written before the body contract:
  // "See it move:" and "The ask:" are bold paragraphs rather than bullets, and later
  // bullets mention a demo and NEWS.md while linking somewhere else entirely. Naive
  // "first link on a line matching /demo/" picks the roadmap issue; naive "first prose
  // line" picks the See-it-move line as the summary. Both are wrong.
  const body = [
    "## \u26d4 Release candidate — merges only on @jwildfire's approval, via the attested lane",
    '',
    '**See it move:** the [annotated v0.2 demo](https://jwildfire.github.io/obot.roadmap/reports/og-v0.2-demo/) walks it live as the [study site](https://jwildfire.github.io/demo-301/).',
    '',
    '**The ask:** approve this RC (or request changes).',
    '',
    '## Summary',
    '',
    'Promotes dev to main for v0.2.0 — the first release cut on open.gismo.',
    '',
    '## Roadmap context',
    '',
    '- This is the app-goal arc under [obot.roadmap#134](https://github.com/jwildfire/obot.roadmap/issues/134) (DEMO-301 demo study).',
    '- Publishes the release with the NEWS.md section via [#8](https://github.com/jwildfire/open.gismo/pull/8).',
  ].join('\n');
  const rc = parseRCBody(body);
  // The demo comes off the See-it-move line, not off a later bullet mentioning "demo".
  assert.equal(rc.demo, 'https://jwildfire.github.io/obot.roadmap/reports/og-v0.2-demo/');
  assert.equal(rc.frameable, true);
  // A line that merely mentions NEWS.md while linking a PR is not a NEWS.md link.
  assert.equal(rc.news, null);
  // The summary is the prose, not the See-it-move line and not the ask.
  assert.equal(rc.summary, 'Promotes dev to main for v0.2.0 — the first release cut on open.gismo.');
  assert.equal(rc.ask, 'approve this RC (or request changes).');
});

test('the NEWS.md link is recognised by its target, not by a passing mention', () => {
  const rc = parseRCBody([
    'One sentence.',
    '- **Release notes:** [NEWS.md](https://github.com/jwildfire/gsm.safety/blob/dev/NEWS.md)',
  ].join('\n'));
  assert.equal(rc.news, 'https://github.com/jwildfire/gsm.safety/blob/dev/NEWS.md');
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
    assert.ok(session.body.includes('/session/log'), 'the brief links the full record');
    // The old live view lives on the record page now, not on the brief.
    const log = await get('/session/log');
    assert.equal(log.status, 200);
    assert.ok(log.body.includes('/session/frame'), 'the record page wraps the session-hub view');

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
    // The tab is metrics + what changed now; with no cache written it says so
    // rather than rendering zeros that read as a quiet year.
    assert.ok(swept.body.includes('No numbers yet'));
    // The full record keeps the queue rows, whole, one click behind.
    const record = await get('/navigator/record');
    assert.ok(record.body.includes('observer is dead'), 'the record view carries the same honesty banner');
    assert.ok(record.body.includes('repo#1'));

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

  // The IQ flags, not the retired `--fix` one-liner: since obot.agent#122 the
  // capture tool refuses an entry with no expected result and no proof.
  const iq = (n) => ['--do', `type ${n}`, '--expect', `${n} is there`,
    '--verify', `test -f /tmp/${n} -> the file exists`, '--source', 'a session'];
  file('first item', ...iq('one'));
  file('second item', ...iq('two'));
  const md = fs.readFileSync(path.join(ws, '.claude', 'blockers.md'), 'utf8');
  assert.match(md, /- \[ \] c0001 · filed \d{4}-\d{2}-\d{2}/);
  assert.match(md, /- \[ \] c0002 · filed \d{4}-\d{2}-\d{2}/);

  // Ids are the dashboard's row identity, so the two halves must agree.
  assert.deepEqual(collectConfig(ws).items.map((i) => i.id), ['c0001', 'c0002']);
  assert.equal(nextConfigId(md), 'c0003');

  // A retired item still owns its number: the next claim clears it.
  fs.appendFileSync(path.join(ws, '.claude', 'blockers.md'), '\n## Resolved\n\n- [x] c0009 — **retired** — done.\n');
  file('third item', ...iq('three'));
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
  // section the record view must render it without being touched. The seam lives on
  // /navigator/record now — the tab itself is metrics + what changed.
  const s = parseNavigatorState(`${NAV_STATE}\n## By agent\n\n- 22:10 👯🤖 opsdb2 — opened obot.agent#118 https://github.com/jwildfire/obot.agent/issues/118\n`, new Date('2026-08-15T22:33:00'));
  assert.deepEqual(s.sections.map((x) => x.title), ['RC queue', 'Recent events', 'By agent']);
  const html = navigatorRecordShell({ state: s });
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

// ---------------------------------------------------------------------------
// The decision lane: capture → deliver → apply (#120).
//
// The evening of 2026-08-15 is the spec. He answered one decision, three files
// appeared 19 seconds apart, every one of them carried `decisionId: null` and a
// status nothing was watching, and he asked twice whether it had landed.
// ---------------------------------------------------------------------------

test('three clicks on the same answer are one decision, not three', () => {
  const ws = tmp();
  const hub = hubWith([D3]);
  const words = 'I am good with the recommendations here.';
  const a = recordAnswer(ws, { artifact: D3.slug, verdict: 'adopt-all', words }, { hub });
  const b = recordAnswer(ws, { artifact: D3.slug, verdict: 'adopt-all', words }, { hub });
  const c = recordAnswer(ws, { artifact: D3.slug, verdict: 'adopt-all', words }, { hub });

  assert.equal(b.duplicate, true, 'an identical re-click is the same answer');
  assert.equal(c.record.id, a.record.id, 'and it does not write a second file');
  assert.equal(fs.readdirSync(path.join(ws, '.claude', 'ops', 'answers')).filter((n) => n.endsWith('.json')).length, 1);
  assert.equal(readAnswers(ws)[0].clicks, 3, 'the repeat clicks are counted, so the double-click is legible');
});

test('the decision id is joined from the hub registry when the answer is written', () => {
  const ws = tmp();
  const hub = hubWith([D3]);
  const { record } = recordAnswer(ws, { artifact: D3.slug, verdict: 'adopt-all', words: 'go' }, { hub });
  assert.equal(record.decisionId, 'D0003', 'the field that exists for this must not be null');
  assert.equal(record.decisionIdSource, 'registry');
  assert.equal(record.decisionIdError, null);
  assert.deepEqual(resolveDecision(hub, D3.slug).questions.map((q) => q.code), ['S1', 'S2']);
});

test('a slug the registry does not know records the failure instead of a silent null', () => {
  const ws = tmp();
  const { record } = recordAnswer(ws, { artifact: 'not-a-decision', verdict: 'approve', words: 'x' }, { hub: hubWith([D3]) });
  assert.equal(record.decisionId, null);
  assert.equal(record.decisionIdSource, 'none');
  assert.match(record.decisionIdError, /registry/i, 'the lookup failure is on the record, not lost');
});

test('per-question answers are keyed by sub-id and carry the code he reads', () => {
  const ws = tmp();
  const hub = hubWith([D3]);
  const { record } = recordAnswer(ws, {
    artifact: D3.slug,
    verdict: 'per-question',
    questions: { 'D0003.1': 'approve', 'D0003.2': 'defer' },
    words: 'S1 yes, S2 later',
  }, { hub });
  assert.deepEqual(record.questions['D0003.1'], { verdict: 'approve', code: 'S1' });
  assert.deepEqual(record.questions['D0003.2'], { verdict: 'defer', code: 'S2' });
  assert.deepEqual(record.unknownQuestions, []);
});

test('a per-question verdict holding no questions is refused at the door', () => {
  const ws = tmp();
  // The 22:21:57 record: a verdict naming per-question answers, with none in it.
  assert.throws(
    () => recordAnswer(ws, { artifact: D3.slug, verdict: 'per-question', questions: {}, words: 'prose' }),
    /per-question/i,
  );
  assert.throws(() => recordAnswer(ws, { artifact: D3.slug }), /empty/i);
});

test('a question id the decision does not have is flagged rather than swallowed', () => {
  const ws = tmp();
  const { record } = recordAnswer(ws, {
    artifact: D3.slug, verdict: 'per-question', questions: { 'D0003.9': 'approve' },
  }, { hub: hubWith([D3]) });
  assert.deepEqual(record.unknownQuestions, ['D0003.9']);
});

test('prose with no verdict records as what it is, not as "per-question"', () => {
  const ws = tmp();
  const { record } = recordAnswer(ws, { artifact: D3.slug, verdict: null, words: 'do the first two only' });
  assert.equal(record.verdict, 'words-only');
  assert.ok(record.words.includes('first two'));
});

test('captured, delivered, applied — "did it land" is answerable from the store alone', () => {
  const ws = tmp();
  const hub = hubWith([D3]);
  const { record } = recordAnswer(ws, { artifact: D3.slug, verdict: 'adopt-all', words: 'go' }, { hub });
  assert.equal(record.status, 'captured', 'nothing has seen it yet, and the status says so');
  assert.deepEqual(pendingAnswers(ws).map((a) => a.id), [record.id]);

  const delivered = deliverAnswers(ws).delivered;
  assert.deepEqual(delivered.map((a) => a.id), [record.id]);
  assert.equal(readAnswers(ws)[0].status, 'delivered');
  assert.equal(deliverAnswers(ws).delivered.length, 0, 'delivering twice is not two hand-offs');
  assert.equal(pendingAnswers(ws).length, 1, 'delivered is not done — it is still waiting on an agent');

  const applied = markApplied(ws, record.id, { by: 'a sibling', evidence: 'https://example.test/pr/1' });
  assert.equal(applied.status, 'applied');
  assert.equal(applied.evidence, 'https://example.test/pr/1');
  assert.deepEqual(pendingAnswers(ws), [], 'applied is the only state that clears the queue');
});

test('a status change never edits what he said', () => {
  const ws = tmp();
  const { record } = recordAnswer(ws, {
    artifact: D3.slug, verdict: 'per-question', questions: { 'D0003.1': 'approve' }, words: 'his words',
  }, { hub: hubWith([D3]) });
  deliverAnswers(ws);
  const after = markApplied(ws, record.id, { by: 'x', evidence: 'https://example.test/1' });
  assert.equal(after.words, 'his words');
  assert.equal(after.verdict, 'per-question');
  assert.deepEqual(after.questions, record.questions);
  assert.deepEqual(after.history.map((h) => h.status), ['captured', 'delivered', 'applied']);
});

test('changing his mind after an answer was applied does not rewrite the applied one', () => {
  const ws = tmp();
  const first = recordAnswer(ws, { artifact: 'a', verdict: 'approve', words: 'yes' }).record;
  deliverAnswers(ws);
  markApplied(ws, first.id, { by: 'x', evidence: 'https://example.test/1' });
  const second = recordAnswer(ws, { artifact: 'a', verdict: 'reject', words: 'actually no' }).record;

  assert.equal(readAnswers(ws).find((a) => a.id === first.id).status, 'applied', 'what landed stays landed');
  assert.equal(second.afterApplied, true, 'the new answer says it changes something already applied');
  assert.deepEqual(second.supersedes, [first.id]);
  assert.deepEqual(currentAnswers(ws).map((a) => a.id), [second.id]);
});

test('a legacy "staged" record reads as captured rather than as a state nobody watches', () => {
  const ws = tmp();
  ensureStore(ws);
  // The three records on disk the evening this was written.
  fs.writeFileSync(path.join(ws, '.claude', 'ops', 'answers', 'legacy.json'), JSON.stringify({
    _note: SENTINEL, id: 'legacy', at: '2026-08-15T20:22:13.836Z', status: 'staged',
    artifact: D3.slug, decisionId: null, verdict: 'adopt-all', questions: {}, words: 'go',
  }));
  const [a] = readAnswers(ws);
  assert.equal(a.status, 'captured');
  assert.deepEqual(pendingAnswers(ws).map((x) => x.id), ['legacy']);
});

test('the deliverer announces answers by name and marks the old ones overdue', () => {
  const ws = tmp();
  const hub = hubWith([D3]);
  recordAnswer(ws, { artifact: D3.slug, verdict: 'adopt-all', words: 'go' }, { hub });
  const { delivered, events } = deliverAnswers(ws);
  assert.equal(delivered.length, 1);
  assert.match(events[0].line, /D0003/, 'an event names the decision he can quote');
  assert.equal(events[0].type, 'answer-new');

  const section = answersSection(pendingAnswers(ws));
  assert.match(section, /Decision answers/i);
  assert.match(section, /D0003/);

  // Old and still unapplied: the section must escalate rather than list it quietly.
  const old = new Date(Date.now() - (OVERDUE_MIN + 5) * 60000).toISOString();
  assert.match(answersSection([{ ...pendingAnswers(ws)[0], at: old }]), /OVERDUE/);
});

test('the deliverer is honest about an empty queue instead of writing nothing', () => {
  assert.match(answersSection([]), /none/i);
});

const withAnswers = (answers, deliverer) => render({
  queue: fullQueue, answers, deliverer, workspace: '/w', hub: '/w/obot.roadmap',
});

test('the page says what happened to his click and what happens next', () => {
  const html = withAnswers([{
    id: 'a1', decisionId: 'D0003', artifact: D3.slug, verdict: 'adopt-all',
    status: 'captured', at: new Date().toISOString(), words: 'go',
  }], { alive: true, sweptAt: '2026-08-15 23:30', ageMin: 2 });
  assert.match(html, /D0003/);
  assert.match(html, /captured/i);
  // The sentence he gets after clicking — the pipeline in his words, on the page.
  assert.match(html, /five minutes/i, 'the page states when the hand-off happens');
  assert.ok(!/staged/i.test(html), 'the word for a state nobody watches is gone');
});

test('a decision he clicked three times shows one row, with the history behind it', () => {
  const ws = tmp();
  const hub = hubWith([D3]);
  recordAnswer(ws, { artifact: D3.slug, verdict: 'defer', words: 'later' }, { hub });
  recordAnswer(ws, { artifact: D3.slug, verdict: 'adopt-all', words: 'go' }, { hub });
  recordAnswer(ws, { artifact: D3.slug, verdict: 'adopt-all', words: 'go' }, { hub });
  const current = currentAnswers(ws);
  assert.equal(current.length, 1, 'one decision, one row');
  assert.equal(current[0].verdict, 'adopt-all');
  assert.equal(current[0].supersedes.length, 1);

  const html = withAnswers(current, { alive: true, sweptAt: 'x', ageMin: 1 });
  assert.equal((html.match(/class="ans"/g) || []).length, 1, 'the superseded answer is not a second row');
  assert.match(html, /replaced an earlier answer|superseded/i);
});

test('when nothing is listening the page says so instead of looking like success', () => {
  const dead = withAnswers([{
    id: 'a1', decisionId: 'D0003', artifact: D3.slug, verdict: 'adopt-all',
    status: 'captured', at: new Date(Date.now() - 90 * 60000).toISOString(), words: 'go',
  }], { alive: false, sweptAt: '2026-08-15 19:00', ageMin: 260 });
  assert.match(dead, /nothing is listening/i, 'the failure is named on the page');
  assert.match(dead, /launchctl kickstart/, 'and the page carries the restart command');

  // No answer waiting: a dead deliverer is not an ALARM about nothing.
  const quiet = withAnswers([], { alive: false, ageMin: 260 });
  assert.ok(!/class="alarm"/.test(quiet), 'an alarm about no stuck answer');
  assert.ok(!/going nowhere/i.test(quiet));
  // It is still worth saying before he clicks, in the form's own register: the
  // promise "handed to an agent by the Navigator within five minutes" was made
  // unconditionally, on a machine where the sweep has never been installed
  // (jwildfire/obot.roadmap#223).
  assert.match(quiet, /Nothing is listening yet/);
  assert.doesNotMatch(quiet, /handed to an agent by the Navigator within five minutes/);
  // And with the deliverer alive the promise is the one that holds.
  assert.match(withAnswers([], { alive: true }), /handed to an agent by the Navigator within five minutes/);
});

test('an applied answer links the artifact so he can confirm it himself', () => {
  const html = withAnswers([{
    id: 'a1', decisionId: 'D0003', artifact: D3.slug, verdict: 'adopt-all', status: 'applied',
    at: new Date().toISOString(), appliedAt: new Date().toISOString(),
    evidence: 'https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-14-demo-301-site-size/',
  }], { alive: true, ageMin: 1 });
  assert.match(html, /applied/i);
  assert.match(html, /href="https:\/\/jwildfire\.github\.io[^"]*demo-301-site-size/);
});

test('the answer POST refuses a verdict that would be a lie, and reports the id it joined', async () => {
  const ws = tmp();
  const hub = hubWith([D3]);
  const { server, url } = await serve({ workspace: ws, hub, port: 0 });
  const post = async (body) => {
    const r = await fetch(new URL('/answer', url), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: r.status, json: await r.json() };
  };
  try {
    const bad = await post({ artifact: D3.slug, verdict: 'per-question', questions: {}, words: 'prose' });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /per-question/i);

    const ok = await post({ artifact: D3.slug, verdict: 'adopt-all', words: 'go' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.decisionId, 'D0003', 'the answer comes back with the id he can quote');
    assert.equal(ok.json.status, 'captured');
    assert.match(ok.json.next, /five minutes/i, 'and with the sentence about what happens next');

    const again = await post({ artifact: D3.slug, verdict: 'adopt-all', words: 'go' });
    assert.equal(again.json.duplicate, true, 'a double-click is the same answer');
    assert.equal(again.json.id, ok.json.id);
  } finally {
    server.close();
  }
});

test('pending is one bounded read an agent can run without a session', () => {
  const ws = tmp();
  const hub = hubWith([D3]);
  recordAnswer(ws, { artifact: D3.slug, verdict: 'adopt-all', words: 'his verbatim words' }, { hub });
  const cli = new URL('../../ops-answers', import.meta.url).pathname;
  const run = (...a) => execFileSync(cli, a, { env: { ...process.env, OBOT_WORKSPACE: ws, OBOT_HUB: hub }, encoding: 'utf8' });

  const text = run('pending');
  assert.match(text, /D0003/);
  assert.match(text, /his verbatim words/, 'the answer itself is the payload an agent needs');

  const json = JSON.parse(run('pending', '--json'));
  assert.equal(json.pending.length, 1);
  assert.equal(json.pending[0].decisionId, 'D0003');
  assert.equal(json.pending[0].status, 'captured');

  run('deliver');
  assert.equal(JSON.parse(run('pending', '--json')).pending[0].status, 'delivered');
  run('apply', JSON.parse(run('pending', '--json')).pending[0].id, '--evidence', 'https://example.test/1', '--by', 'a sibling');
  assert.equal(JSON.parse(run('pending', '--json')).pending.length, 0);
  assert.match(run('pending'), /nothing/i);
});

test('an answer written before the join still gets its id from the registry', () => {
  const ws = tmp();
  const hub = hubWith([D3]);
  ensureStore(ws);
  fs.writeFileSync(path.join(ws, '.claude', 'ops', 'answers', 'legacy.json'), JSON.stringify({
    _note: SENTINEL, id: 'legacy', at: '2026-08-15T20:22:13.836Z', status: 'staged',
    artifact: D3.slug, decisionId: null, verdict: 'adopt-all', questions: {}, words: 'go',
  }));
  assert.equal(readAnswers(ws)[0].decisionId, null, 'the file itself is not rewritten by a read');
  const [joined] = readAnswers(ws, { hub });
  assert.equal(joined.decisionId, 'D0003', 'the slug is right there — the registry answers it');
  assert.match(joined.decisionIdSource, /backfill/i, 'and the record says where the id came from');
  assert.deepEqual(pendingAnswers(ws, { hub }).map((a) => a.decisionId), ['D0003']);

  // The deliverer writes anyway, so it is where the repair is persisted.
  deliverAnswers(ws, { hub });
  assert.equal(JSON.parse(fs.readFileSync(path.join(ws, '.claude', 'ops', 'answers', 'legacy.json'), 'utf8')).decisionId, 'D0003');
});

// ---------------------------------------------------------------------------
// The four dead alarm paths (jwildfire/obot.roadmap#218 recon; obot.agent#129
// inverted): the sweep writes ledger verdicts in the preamble and the discipline
// headline as a plain line, and the old parser could never render any of them.

const NAV_STATE_ALARMS = `# navigator-state — 🧭🤖 Navigator RC-review sweep

Sole writer: \`sweep.mjs\`. **Stale rule: 3× cadence.**

swept: 2026-08-15 22:30 · cadence 5m · ok — 7 repos, 2 RCs

config ledger: ledger clean - 11 id(s) allocated, 11 present
  note - blockers.md changed outside this tool since it was last written

**WORKER LEDGER FINDING** — 1 id(s) claimed but never launched: W0005

## Roadmap discipline

roadmap discipline: **94 findings** across the project repos, last 14 days
  nightly audit: last run 13h ago — anything filed since then is invisible to it
  bounded: 104 older than 14 days not shown

### Work that shipped with no requirement above it (59)

- safety.viz#120 closed with no requirement above it
`;

test('the preamble ledger verdicts parse as notes, alarms flagged, details attached', () => {
  const s = parseNavigatorState(NAV_STATE_ALARMS, new Date('2026-08-15T22:33:00'));
  assert.equal(s.notes.length, 2);
  assert.match(s.notes[0].text, /config ledger: ledger clean/);
  assert.equal(s.notes[0].alarm, false);
  assert.match(s.notes[0].details[0].text, /changed outside this tool/);
  assert.match(s.notes[1].text, /WORKER LEDGER FINDING/);
  assert.equal(s.notes[1].alarm, true);
})

test('a section keeps its verdict headline, its indented context, and its ### groups, in order', () => {
  const s = parseNavigatorState(NAV_STATE_ALARMS, new Date('2026-08-15T22:33:00'));
  const disc = s.sections.find((x) => x.title === 'Roadmap discipline');
  assert.equal(disc.items[0].note, true);
  assert.match(disc.items[0].text, /94 findings across the project repos/);
  // "94 findings" is a count, not an alarm — the alarm regex is case-sensitive.
  assert.equal(disc.items[0].alarm, false);
  assert.match(disc.items[0].details[0].text, /nightly audit/);
  assert.match(disc.items[0].details[1].text, /104 older than 14 days not shown/);
  assert.equal(disc.items[1].heading, true);
  assert.match(disc.items[1].text, /Work that shipped with no requirement/);
  assert.match(disc.items[2].text, /safety\.viz#120/);
})

test('an alarm reaches both Navigator views; a clean verdict is quiet small print', () => {
  const s = parseNavigatorState(NAV_STATE_ALARMS, new Date('2026-08-15T22:33:00'));
  for (const html of [navigatorShell({ state: s }), navigatorRecordShell({ state: s })]) {
    assert.match(html, /WORKER LEDGER FINDING/);
    assert.match(html, /config ledger: ledger clean/);
  }
  // The record carries the clean note's dating detail; the metrics view stays terse.
  assert.match(navigatorRecordShell({ state: s }), /changed outside this tool/);
  assert.doesNotMatch(navigatorShell({ state: s }), /changed outside this tool/);
  // And the discipline verdict now renders above its findings on the record.
  assert.match(navigatorRecordShell({ state: s }), /94 findings/);
})
