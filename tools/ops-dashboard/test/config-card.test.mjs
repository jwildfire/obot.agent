// A config item's card, and the four refusals that keep it off a public surface.
//
// Requirement: jwildfire/obot.roadmap#263. The rule it inherits is older than the
// format: config item text has never reached a published page, which is why the
// list lives outside git in the first place. The requirement's own words are that
// it must not depend on anyone remembering — "a generator that cannot write to a
// published path cannot leak" — so the containment here is four refusals with a
// test each, rather than a convention with a comment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  assertLocalOnly, buildCard, cardPath, cardsDir, parseCardSource, readCardSource,
  renderCard, summaryText, writeCard, blocks, inline,
} from '../lib/config-card.mjs';
import { SENTINEL } from '../lib/store.mjs';
import { configCardId } from '../ops-dashboard.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'config-card-'));
const html = (over = {}) => renderCard(buildCard(item(over), source(over), { generatedAt: new Date('2026-08-18T10:00:00Z') }));

const item = (over = {}) => ({
  kind: 'config', id: 'c0016', key: 'c0016', title: 'Merge the thing', date: '2026-08-18',
  verified: '2026-08-18', criticalClaim: 'blocks jwildfire/obot.agent#197',
  blocks: [{ ref: 'jwildfire/obot.agent#197', verified: true }],
  iq: {
    do: { text: 'run it', code: [] },
    verify: { text: 'gh pr view 198 --json state', command: 'gh pr view 198 --json state', expect: 'prints MERGED', manual: false },
    source: { text: 'https://github.com/jwildfire/obot.agent/pull/198', code: [] },
  },
  ...over.item,
});

const source = (over = {}) => ({
  missing: false, why: null, unknown: [],
  front: { time: 'about 2 minutes', now: 'Yes', unblocks: 'the fix ships', skip: 'nothing breaks' },
  summary: 'One paragraph he can decide from.',
  background: 'Why it exists.',
  steps: [{ title: 'Do the thing', body: 'Run this.\n\n    echo hello\n\nSee: it prints hello.' }],
  check: '',
  ...over.source,
});

// --- refusal 1: outside the store -------------------------------------------

test('a destination outside the card store is refused', () => {
  const ws = tmp();
  assert.throws(
    () => assertLocalOnly(ws, path.join(ws, 'obot.roadmap', 'reports', 'c0016.html')),
    /refusing to write outside the local card store/,
  );
});

test('the store is the only place cardPath can land, whatever the id looks like', () => {
  const ws = tmp();
  const dir = path.resolve(cardsDir(ws));
  // Every one of these is a path, and none of them is an id.
  for (const bad of ['../../escape', 'c0016/../../x', '/etc/passwd', 'c0016.html', '.c0016', 'C001', '', null]) {
    assert.throws(() => cardPath(ws, bad), /not a config id/, `${JSON.stringify(bad)} was accepted`);
  }
  assert.equal(cardPath(ws, 'c0016'), path.join(dir, 'c0016.html'));
  assert.equal(cardPath(ws, 'C0016'), path.join(dir, 'c0016.html'), 'the id is case-insensitive, the filename is not');
});

// --- refusal 2: anywhere a repository could pick it up -----------------------

test('a store inside a git repository is refused, however it got there', () => {
  const ws = tmp();
  // The store's own workspace turned into a checkout — a move, a symlink, or someone
  // running the generator from inside a repo. Nothing else in this program would
  // notice, and one `git add` later the text is public.
  fs.mkdirSync(path.join(ws, '.git'), { recursive: true });
  assert.throws(
    () => writeCard(ws, 'c0016', `<!-- ${SENTINEL} -->`),
    /is inside a git repository/,
  );
  assert.equal(fs.existsSync(cardsDir(ws)), false, 'a refused write left a directory behind');
});

test('a .git further up the tree is caught too, not just the immediate parent', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.git'));
  const ws = path.join(root, 'nested', 'deep', 'workspace');
  fs.mkdirSync(ws, { recursive: true });
  assert.throws(() => writeCard(ws, 'c0016', `<!-- ${SENTINEL} -->`), /is inside a git repository/);
});

test('a workspace with no repository above it writes, and lands in the store', () => {
  const ws = tmp();
  const file = writeCard(ws, 'c0016', `<!-- ${SENTINEL} -->\n<p>hello</p>`);
  assert.equal(file, path.join(path.resolve(cardsDir(ws)), 'c0016.html'));
  assert.match(fs.readFileSync(file, 'utf8'), /hello/);
});

// --- refusal 3: content that is not stamped ----------------------------------

test('a card without the local-only sentinel is refused', () => {
  const ws = tmp();
  assert.throws(() => writeCard(ws, 'c0016', '<p>no stamp</p>'), /without the local-only sentinel/);
  assert.equal(fs.existsSync(cardPath(ws, 'c0016')), false);
});

test('every rendered card carries the sentinel the hub deploy fails on', () => {
  // The hub's deploy greps the assembled site for this exact string. A card that
  // reached a published tree therefore takes the build down instead of going out,
  // and that guarantee is only worth anything if it is true of every card.
  assert.ok(html().includes(SENTINEL));
  assert.ok(html({ source: { missing: true } }).includes(SENTINEL), 'an unwritten item still stamps its page');
});

// --- refusal 4: the server has no writer -------------------------------------

test('the dashboard route resolves ids and nothing else', () => {
  assert.equal(configCardId('/config/c0016'), 'c0016');
  assert.equal(configCardId('/config/C0016/'), 'c0016');
  assert.equal(configCardId('/config/c0016?x=1'), 'c0016');
  for (const bad of ['/config/', '/config/../../etc/passwd', '/config/c0016/../c0017', '/config/index.html', '/configs/c0016']) {
    assert.equal(configCardId(bad), null, `${bad} resolved`);
  }
});

test('the server module never writes a card', () => {
  // Structural, not stylistic: the only writer in the program is `writeCard`, and
  // the request handler must not acquire a second one by someone reaching for
  // `writeFileSync` while adding a route.
  const src = fs.readFileSync(new URL('../ops-dashboard.mjs', import.meta.url), 'utf8');
  assert.equal(/writeCard|config-cards/.test(src), false, 'the server has grown a card writer');
});

// --- what must survive the format change -------------------------------------

test('every step carries what he should see', () => {
  const page = html();
  assert.match(page, /You should see/);
  assert.match(page, /it prints hello/);
});

test('the page ends with a check that answers pass or fail', () => {
  const page = html();
  assert.match(page, /Did it take\?/);
  assert.match(page, /gh pr view 198 --json state/);
  assert.match(page, /prints MERGED/);
});

test('a manual check says so rather than pretending to be scriptable', () => {
  const page = html({ item: { iq: { verify: { manual: true, command: null, expect: 'you say whether the phone buzzed' } } } });
  assert.match(page, /Manual/);
  assert.match(page, /you say whether the phone buzzed/);
});

test('an entry with no verify says the gap out loud', () => {
  const page = html({ item: { iq: {} } });
  assert.match(page, /carries no check/);
});

// --- the summary is the phone document ---------------------------------------

test('the summary stands alone: it renders before any step and needs none of them', () => {
  const page = html();
  const sum = page.indexOf('The short version');
  const steps = page.indexOf('Step by step');
  assert.ok(sum > 0 && steps > sum, 'the summary must come first');
  const summarySection = page.slice(sum, steps);
  for (const fact of ['Takes', 'Do it now?', 'Buys you', 'If you skip it']) {
    assert.ok(summarySection.includes(fact), `the decision strip is missing ${fact}`);
  }
  assert.ok(summarySection.includes('One paragraph he can decide from'));
});

test('the summary travels as plain text, because loopback does not reach a phone', () => {
  const text = summaryText(buildCard(item(), source()));
  assert.match(text, /^c0016 — Merge the thing/);
  assert.match(text, /Takes: about 2 minutes/);
  assert.match(text, /One paragraph he can decide from/);
  assert.equal(/[<>]/.test(text), false, 'plain text carries no markup');
});

// --- the list stays the record -----------------------------------------------

test('the measurable half comes from the list, never from the prose', () => {
  // A card may not carry its own copy of a date, a blocking reference or a proof:
  // two records that can disagree is the thing this format must not introduce.
  const card = buildCard(item(), source({ front: { time: 'a moment' } }));
  assert.equal(card.filed, '2026-08-18');
  assert.deepEqual(card.blocks, ['jwildfire/obot.agent#197']);
  assert.equal(card.verify.command, 'gh pr view 198 --json state');
  assert.equal(card.claim, 'blocks jwildfire/obot.agent#197');
});

test('an item nobody has written a card for still renders, and says so', () => {
  const page = html({ source: { missing: true, front: {}, summary: '', background: '', steps: [], check: '' } });
  assert.match(page, /No card has been written for c0016 yet/);
  assert.match(page, /run it/, 'the raw entry is shown so the item is still actionable');
});

test('a prose file that could not be read is a fault, not an unwritten card', () => {
  const ws = tmp();
  fs.mkdirSync(cardsDir(ws), { recursive: true });
  // A directory where the file should be: present, unopenable, and not ENOENT.
  fs.mkdirSync(path.join(cardsDir(ws), 'c0016.md'));
  const src = readCardSource(ws, 'c0016');
  assert.equal(src.missing, true);
  assert.match(src.why ?? '', /EISDIR/);
  assert.match(renderCard(buildCard(item(), src)), /could not be read/);
});

test('a missing prose file is absence, and carries no reason', () => {
  const src = readCardSource(tmp(), 'c0016');
  assert.equal(src.missing, true);
  assert.equal(src.why, null);
});

// --- the source format --------------------------------------------------------

test('front matter, sections and steps parse out of one small file', () => {
  const parsed = parseCardSource([
    'time: 2 minutes',
    'now: Yes',
    'colour: purple',
    '',
    '## Summary',
    'Short.',
    '',
    '## Background',
    'Because.',
    '',
    '## Steps',
    '',
    '### First',
    'Run it.',
    '    echo one',
    'See: one.',
    '',
    '### Second',
    'Then this.',
  ].join('\n'));
  assert.deepEqual(parsed.front, { time: '2 minutes', now: 'Yes' });
  assert.deepEqual(parsed.unknown, ['colour'], 'an unrendered key is reported, never silently dropped');
  assert.equal(parsed.summary, 'Short.');
  assert.equal(parsed.background, 'Because.');
  assert.equal(parsed.steps.length, 2);
  assert.equal(parsed.steps[0].title, 'First');
  assert.match(parsed.steps[0].body, /echo one/);
});

test('an indented line is a command he pastes, kept verbatim and dedented', () => {
  const out = blocks('Run this.\n\n        gh pr view 198 -R jwildfire/obot.agent\n');
  assert.match(out, /<pre>gh pr view 198 -R jwildfire\/obot\.agent<\/pre>/);
  assert.match(out, /data-copy="gh pr view 198/);
});

test('inline markup is links and code, and there is no way to bold a clause', () => {
  assert.equal(inline('a `cmd` and [a link](https://example.com)'),
    'a <code>cmd</code> and <a href="https://example.com">a link</a>');
  assert.match(inline('**shouty**'), /\*\*shouty\*\*/);
});

test('item text is escaped, so a title with markup cannot become markup', () => {
  const page = html({ item: { title: '<script>alert(1)</script>' } });
  assert.equal(page.includes('<script>alert(1)</script>'), false);
  assert.match(page, /&lt;script&gt;/);
});

// --- the deadline is computed where it is read --------------------------------

test('a deadline renders as a live element, not as a baked-in countdown', () => {
  const page = html({ source: { front: { time: '2 minutes', deadline: '07:00' } } });
  assert.match(page, /data-deadline="07:00"/);
  assert.equal(/in \d+ min/.test(page), false, 'a rendered-in countdown is stale by lunchtime');
});

test('a relative link keeps its label and loses its path in the plain-text lane', () => {
  // The text goes where the loopback dashboard cannot: a path is dead weight there,
  // and the handle is the whole of what a reader needs.
  const text = summaryText(buildCard(item(), source({ source: { summary: 'Then [c0018](/config/c0018), then [the PR](https://example.com/1).' } })));
  assert.match(text, /Then c0018, then the PR \(https:\/\/example\.com\/1\)\./);
});

test('a section heading nobody renders is reported, never silently dropped', () => {
  // How the first card written for this format lost its whole background: the source
  // said "## Why this exists", the parser wanted "## Background", and the page came
  // out shorter with nothing anywhere saying why.
  const named = parseCardSource('## Why this exists\nBecause.\n');
  assert.equal(named.background, 'Because.', 'the heading a writer would actually type must work');
  assert.deepEqual(named.unknownSections, []);

  const lost = parseCardSource('## Notes to self\nSomething.\n');
  assert.deepEqual(lost.unknownSections, ['Notes to self']);
});

test('a fenced block is a transcript and carries no copy button', () => {
  const out = blocks('It said:\n\n```\npolicy: PASS\n```\n');
  assert.match(out, /<pre class="out">policy: PASS<\/pre>/);
  assert.equal(/data-copy/.test(out), false, 'output is not a thing to paste back in');
});

test('one card can point at another, and nothing else becomes an href', () => {
  assert.equal(inline('then [c0018](/config/c0018)'), 'then <a href="/config/c0018">c0018</a>');
  // The allowlist is two shapes. A scheme that is not http(s) never reaches an href.
  assert.equal(inline('[click](javascript:alert(1))'), '[click](javascript:alert(1))');
  assert.equal(inline('[x](data:text/html,hi)'), '[x](data:text/html,hi)');
});

test('a step that opens with a command keeps it a command', () => {
  // Trimming the body would eat the four spaces that make the first line code, and
  // the one thing he is meant to paste would render as a sentence.
  const parsed = parseCardSource('## Steps\n\n### Install it\n\n    tools/fold/install-launchd\n\nSee: it says installed.\n');
  assert.match(parsed.steps[0].body, /^ {4}tools\/fold\/install-launchd/);
  assert.match(blocks(parsed.steps[0].body), /data-copy="tools\/fold\/install-launchd"/);
});
