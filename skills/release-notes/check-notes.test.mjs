// Tests of the release-notes checker beside this file. Run with:
//
//   node --test skills/release-notes/check-notes.test.mjs
//
// Each test names the fault it holds shut. The three under "found in use" were
// met on 2026-10-07 while the checker held three repositories' notes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, isEmpty, sectionOf, words } from './check-notes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const checker = join(here, 'check-notes.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'check-notes-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const DEMO = 'https://example.org/demo/';
const section = (heading, body) => `# ${heading}\n\n${body}\n`;
const GOOD = [
  `**See it move:** the [annotated demo](${DEMO}) has the detail.`,
  '',
  'A patch release. Nothing a user already has stops working.',
  '',
  "## What's new",
  '',
  '- **A reader can do one new thing.** It takes one step. [#1](https://example.org/1), PR [#2](https://example.org/2)',
  '',
  '## Tests and provenance',
  '',
  '10 tests pass.'
].join('\n');
const NOTHING = '_Nothing merged yet._';
const long = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

const write = (name, text) => {
  const file = join(scratch, name);
  writeFileSync(file, text);
  return file;
};
const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('a section in shape and within the limits passes, and says its count', () => {
  const file = write('good.md', section('pkg v1.0.0 (Upcoming)', GOOD));
  const result = run(checker, file);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /pkg v1\.0\.0 \(Upcoming\): \d+ words \(limit 600\)/);
  assert.match(result.stdout, /within every limit/);
});

test('a section over the limit fails with exit 1 and names what is over', () => {
  const body = GOOD.replace('It takes one step.', long(90));
  const file = write('long.md', section('pkg v1.0.0 (Upcoming)', body));
  const result = run(checker, file);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /words, limit 70, under "What's new"/);
});

test('found in use: run through a symbolic link, it still checks and still prints', () => {
  // Skills are linked into a session's skills directory, so the checker is
  // usually started by a path that is not its own. It printed nothing and
  // exited 0, which reads as a pass.
  const linked = join(scratch, 'linked-skill');
  symlinkSync(here, linked, 'dir');
  const good = run(join(linked, 'check-notes.mjs'), write('good-link.md', section('pkg v1.0.0', GOOD)));
  assert.equal(good.status, 0);
  assert.match(good.stdout, /within every limit/);
  const bad = run(
    join(linked, 'check-notes.mjs'),
    write('long-link.md', section('pkg v1.0.0', GOOD.replace('It takes one step.', long(90))))
  );
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /limit 70/);
});

test('found in use: a version names its own section, not one whose version starts with it', () => {
  const news = section('pkg v0.3.0.9000 (Upcoming)', NOTHING) + '\n' + section('pkg v0.3.0', GOOD);
  assert.equal(sectionOf(news, 'v0.3.0')[0], '# pkg v0.3.0');
  assert.equal(sectionOf(news, '0.3.0')[0], '# pkg v0.3.0');
  assert.equal(sectionOf(news, 'v0.3.0.9000')[0], '# pkg v0.3.0.9000 (Upcoming)');
});

test('a version that has no section is not found, with exit 2', () => {
  const news = section('pkg v0.3.0.9000 (Upcoming)', NOTHING) + '\n' + section('pkg v0.3.0', GOOD);
  assert.equal(sectionOf(news, 'v0.3'), null);
  assert.equal(sectionOf(news, 'v9.9.9'), null);
  const result = run(checker, write('two.md', news), 'v9.9.9');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no section for v9\.9\.9/);
});

test('found in use: an upcoming section with nothing merged yet has nothing to check, and passes', () => {
  // Every NEWS.md reads this way between a release and the first change after it.
  const SENTENCE = 'The next version of pkg. Its work lands on `dev` and is listed here as it does.';
  for (const body of [NOTHING, SENTENCE, '', '\n\n']) {
    const news = section('pkg v0.4.0 (Upcoming)', body) + '\n' + section('pkg v0.3.0', GOOD);
    assert.equal(isEmpty(sectionOf(news)), true);
    const result = run(checker, write('empty.md', news));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /pkg v0\.4\.0 \(Upcoming\): nothing merged yet/);
  }
});

test('a released section with nothing in it is not excused', () => {
  const lines = sectionOf(section('pkg v0.3.0', NOTHING));
  assert.equal(isEmpty(lines), false);
  assert.ok(check(lines).problems.length > 0);
  assert.equal(run(checker, write('released-empty.md', section('pkg v0.3.0', NOTHING))).status, 1);
});

test('an upcoming section with a bullet, a heading or a demo line in it is checked like any other', () => {
  for (const body of [
    '- **A change.** With no demo line or introduction.',
    "## What's new",
    `**See it move:** the [demo](${DEMO}).`
  ]) {
    const news = section('pkg v0.4.0 (Upcoming)', body);
    assert.equal(isEmpty(sectionOf(news)), false, body);
    assert.equal(run(checker, write('started.md', news)).status, 1, body);
  }
});

test('security review: a bullet that ends in many links and then a word is counted, not searched for ever', () => {
  // Thirty citations and one more word. On the version before this test the word
  // counter did not return: its pattern for the closing citations could be matched
  // in a number of ways that doubles with each link, and it tried them all.
  const links = Array.from({ length: 30 }, (_, i) => `[#${i}](https://example.org/${i})`).join(', ');
  const body = GOOD.replace('[#1](https://example.org/1), PR [#2](https://example.org/2)', `${links} end`);
  const file = write('many-links.md', section('pkg v1.0.0 (Upcoming)', body));
  const result = spawnSync(process.execPath, [checker, file], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.signal, null, 'the checker was still running after five seconds');
  assert.equal(result.status, 0);
});

test('the citations that close a line are not counted, however they are punctuated', () => {
  const cited = (tail) => words(`One two three.${tail}`);
  assert.equal(cited(''), 3);
  assert.equal(cited(' [#1](https://example.org/1)'), 3);
  assert.equal(cited(' [#1](https://example.org/1), PR [#2](https://example.org/2).'), 3);
  assert.equal(cited(' ([hub#3](https://example.org/3); [#4](https://example.org/4))'), 3);
  assert.equal(cited(' [#1](https://example.org/1) and more'), 6, 'a link mid-line counts as its text');
  assert.equal(cited(' [the guide](https://example.org/g)'), 5, 'a link that is not a citation is read');
});

test('found in use: a flat list with no headings is totalled bullet by bullet, not by its first', () => {
  // This repository's own upcoming section printed 46 words where its lines came to 246.
  const news = section('pkg v0.4.0 (Upcoming)', ['- **One.** ' + long(10), '- **Two.** ' + long(20), '- **Three.** ' + long(30)].join('\n'));
  assert.equal(check(sectionOf(news)).total, 11 + 21 + 31);
});

// --- found by the release review of v0.6.0-RC1 (2026-10-07) ---------------------
// A reviewer switched each limit off in a copy of the checker and every test still
// passed. Each test below fails when the rule it names is removed.
const bullet = (n, claim = 'A claim.') => `- **${claim}** ${long(n)}`;
const shaped = ({ intro = 'A patch release. Nothing a user already has stops working.', news = [bullet(10)], also = [], demo = true, headings } = {}) =>
  section(
    'pkg v1.0.0 (Upcoming)',
    [
      ...(demo ? [`**See it move:** the [annotated demo](${DEMO}) has the detail.`, ''] : []),
      intro,
      '',
      ...(headings || ["## What's new", '', ...news, '', ...(also.length ? ['## Also in this release', '', ...also, ''] : []), '## Tests and provenance', '', '10 tests pass.'])
    ].join('\n')
  );
const problemsOf = (news) => check(sectionOf(news)).problems.join('\n');

test('review: a section over 600 words fails, with every bullet inside its own limit', () => {
  const news = shaped({ news: Array.from({ length: 6 }, () => bullet(60)), also: Array.from({ length: 5 }, () => bullet(50)) });
  assert.match(problemsOf(news), /The section is \d+ words; the limit is 600/);
  assert.doesNotMatch(problemsOf(news), /words, limit \d+, under/);
});

test('review: an introduction over 80 words fails', () => {
  assert.match(problemsOf(shaped({ intro: long(90) })), /The introduction is 90 words; the limit is 80/);
});

test("review: a seventh What's new bullet fails", () => {
  assert.match(problemsOf(shaped({ news: Array.from({ length: 7 }, () => bullet(5)) })), /"What's new" has 7 bullets; the limit is 6/);
});

test('review: a bullet that does not open with its claim in bold fails', () => {
  assert.match(problemsOf(shaped({ news: ['- A claim with no bold. ' + long(5)] })), /does not open with its claim in bold/);
});

test('review: a heading out of order, and a heading that is not one of the five, each fail', () => {
  const out = shaped({ headings: ['## Also in this release', '', bullet(5), '', "## What's new", '', bullet(5), '', '## Tests and provenance', '', '10 tests pass.'] });
  assert.match(problemsOf(out), /"## What's new" is out of order/);
  const odd = shaped({ headings: ["## What's new", '', bullet(5), '', '## Internals', '', bullet(5)] });
  assert.match(problemsOf(odd), /"## Internals" is not one of the headings/);
});

test('review: a section with no demo line fails', () => {
  assert.match(problemsOf(shaped({ demo: false })), /does not open with a "\*\*See it move:\*\*" line/);
});

test('review: an upcoming section is empty only when it says next to nothing', () => {
  const upcoming = (body) => sectionOf(section('pkg v0.4.0 (Upcoming)', body));
  assert.equal(isEmpty(upcoming(NOTHING)), true);
  assert.equal(isEmpty(upcoming('* **A change.** Written with a star for its bullet.')), false, 'a star bullet is a bullet');
  assert.equal(isEmpty(upcoming(long(400))), false, 'four hundred words of prose is not nothing');
});

test('review: a star bullet is held to the limits a dash bullet is', () => {
  const news = shaped({ news: ['* **A claim.** ' + long(90)] });
  assert.match(problemsOf(news), /words, limit 70, under "What's new"/);
});

test('review: a bullet wrapped over several lines is counted as one bullet', () => {
  const wrapped = [bullet(55), '  ' + long(60), '  ' + long(60)].join('\n');
  assert.match(problemsOf(shaped({ news: [wrapped] })), /17\d words, limit 70, under "What's new"/);
});

test('review: a "# comment" inside a code fence does not end the section', () => {
  const news = shaped({ news: [bullet(30), '', '```bash', '# a comment in a shell example', 'echo hello', '```', '', bullet(30, 'A second claim.')] });
  const { total } = check(sectionOf(news));
  assert.ok(total > 70, `the second bullet was not counted: total ${total}`);
});

test('review: only an issue or pull-request reference is a citation', () => {
  assert.equal(words('One two [see v#12](https://example.org/u)'), 4);
  assert.equal(words('One two three. [the fix in #3](https://example.org/u)'), 7);
  assert.equal(words('One two three. [roadmap #3](https://example.org/u)'), 3, 'a repository name, a space, a number');
  assert.equal(words('One two three. [jwildfire/obot.agent#3](https://example.org/u)'), 3);
  assert.equal(words('One two three. [obot.roadmap#343](https://example.org/u), PR [#7](https://example.org/p)'), 3);
});

test('review: a very long line is counted in bounded time', () => {
  const started = Date.now();
  const count = words('x' + ' '.repeat(200000) + '[#1](https://example.org/u) end');
  for (const unit of ['![', '[a](', '<', '[#1](u) ', '<!--']) words(unit.repeat(50000));
  sectionOf('# pkg v1\n\n' + '<!--'.repeat(50000));
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
  assert.equal(count, 3, 'the link is not at the end of the line, so it is read as a word');
});

test('review: a Tests and provenance part over 100 words fails, as prose or as bullets', () => {
  const tests = (lines) => shaped({ headings: ["## What's new", '', bullet(5), '', '## Tests and provenance', '', ...lines] });
  assert.match(problemsOf(tests([long(120)])), /"Tests and provenance" is 120 words; the limit is 100/);
  assert.match(problemsOf(tests(['- ' + long(60), '- ' + long(60)])), /"Tests and provenance" is 120 words; the limit is 100/);
  assert.equal(problemsOf(tests([long(100)])), '');
});

