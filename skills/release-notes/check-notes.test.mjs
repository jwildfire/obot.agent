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
  '- **A reader can do one new thing.** It takes one step. [#1](https://example.org/r/issues/1), PR [#2](https://example.org/r/pull/2)',
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
  const body = GOOD.replace('[#1](https://example.org/r/issues/1), PR [#2](https://example.org/r/pull/2)', `${links} end`);
  const file = write('many-links.md', section('pkg v1.0.0 (Upcoming)', body));
  const result = spawnSync(process.execPath, [checker, file], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.signal, null, 'the checker was still running after five seconds');
  assert.equal(result.status, 0);
});

test('the citations that close a line are not counted, however they are punctuated', () => {
  const cited = (tail) => words(`One two three.${tail}`);
  assert.equal(cited(''), 3);
  assert.equal(cited(' [#1](https://example.org/r/issues/1)'), 3);
  assert.equal(cited(' [#1](https://example.org/r/issues/1), PR [#2](https://example.org/r/pull/2).'), 3);
  assert.equal(cited(' ([hub#3](https://example.org/hub/issues/3); [#4](https://example.org/r/pull/4))'), 3);
  assert.equal(cited(' [#1](https://example.org/r/issues/1) and more'), 6, 'a link mid-line counts as its text');
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
  assert.equal(words('One two three. [roadmap #3](https://example.org/o/obot.roadmap/issues/3)'), 3, 'a repository name, a space, a number');
  assert.equal(words('One two three. [jwildfire/obot.agent#3](https://github.com/jwildfire/obot.agent/pull/3)'), 3);
  assert.equal(words('One two three. [obot.roadmap#343](https://example.org/o/obot.roadmap/issues/343), PR [#7](https://example.org/r/pull/7#issuecomment-1)'), 3);
});

test('review: a very long line is counted in bounded time', () => {
  const started = Date.now();
  const count = words('x' + ' '.repeat(200000) + '[#1](https://example.org/r/issues/1) end');
  for (const unit of ['![', '[a](', '<', '[#1](https://example.org/r/issues/1) ', '[w #1](u) ', '<!--', '```', '~~~x ', '* ']) words(unit.repeat(50000));
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

// --- found by the second review, of the fixes above (2026-10-07) ----------------
// The first fix for code fences skipped any line that began with a fence marker and
// flipped "inside a fence" on each one. Words went missing and one stray marker
// switched off every rule after it.
const REF = 'https://example.org/r/issues/';

test('second review: a line that merely begins with a fence marker is counted', () => {
  const news = shaped({ intro: ['``` ' + long(300), '~~~ ' + long(300)].join('\n') });
  assert.ok(check(sectionOf(news)).total > 600, `total ${check(sectionOf(news)).total}`);
  const upcoming = section('pkg v0.4.0 (Upcoming)', ['``` ' + long(300), '~~~ ' + long(300)].join('\n'));
  assert.equal(isEmpty(sectionOf(upcoming)), false);
});

test('second review: a fence that never closes is reported, and the rules after it still apply', () => {
  const news = shaped({ news: ['```bash', 'npm test', '', '- ' + long(150)] });
  const problems = problemsOf(news);
  assert.match(problems, /code fence .* never closed/);
  assert.match(problems, /words, limit 70, under "What's new"/);
  assert.match(problems, /does not open with its claim in bold/);
});

test('second review: inline code at the start of a line opens no fence', () => {
  const news =
    shaped({ news: ['```npm test``` now runs every suite.', '', '- ' + long(150)] }) + '\n' + section('pkg v0.9.0', GOOD);
  assert.match(problemsOf(news), /words, limit 70, under "What's new"/);
  assert.doesNotMatch(problemsOf(news), /never closed/, 'it is a line of prose, not a fence left open');
  assert.notEqual(sectionOf(news, 'v0.9.0'), null, 'the next section is still found');
  // two such lines do not make a fence between them
  const pair = shaped({ news: [bullet(5), '', '```npm test``` runs.', '', '- ' + long(150), '', '```npm run build``` builds.'] });
  assert.match(problemsOf(pair), /words, limit 70, under "What's new"/);
});

test('second review: a fence closes only on a marker of its own kind and length', () => {
  const fenced = ['````markdown', '```', '# not a heading', '```', '````'];
  const news = shaped({ news: [bullet(10), '', ...fenced] }) + '\n' + section('pkg v0.9.0', long(900));
  const { total, problems } = check(sectionOf(news));
  assert.ok(total < 100, `the next section leaked in: total ${total}`);
  assert.deepEqual(problems, []);
  assert.ok(sectionOf(news).includes('10 tests pass.'), 'the section runs past the fence to its own end');
  const tilde = shaped({ news: [bullet(10), '', '~~~', '# a comment', '```', '~~~', '', bullet(10, 'A second claim.')] });
  assert.deepEqual(check(sectionOf(tilde)).problems, []);
  assert.ok(check(sectionOf(tilde)).total > 40);
});

test('second review: a heading line of spaces is read in bounded time', () => {
  const started = Date.now();
  check(sectionOf(shaped({ headings: ["## What's new" + ' '.repeat(200000) + 'x', '', bullet(5)] })));
  isEmpty(sectionOf(section('pkg v0.4.0 (Upcoming)' + ' '.repeat(200000) + 'x', NOTHING)));
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
});

test('second review: inside a fence a "## " line is no heading and a "- " line is no bullet', () => {
  const fenced = ['```markdown', '## Internals', ...Array.from({ length: 8 }, (_, i) => `- item ${i}`), '```'];
  const { total, problems } = check(sectionOf(shaped({ news: [bullet(10), '', ...fenced] })));
  assert.deepEqual(problems, []);
  assert.ok(total >= 12 + 17 + 16, `the fenced words are still counted: total ${total}`);
});

test('second review: an upcoming section with a code block in it is not empty', () => {
  const news = section('pkg v0.4.0 (Upcoming)', ['```', '- **A change.** Written inside a fence.', '```'].join('\n'));
  assert.equal(isEmpty(sectionOf(news)), false);
});

test('second review: a line joins a bullet only when Markdown would put it there', () => {
  const under = (lines) => check(sectionOf(shaped({ news: lines })));
  const over = /words, limit 70, under "What's new"/;
  // straight under the bullet, indented or not: part of it
  assert.match(under([bullet(40), long(40)]).problems.join('\n'), over);
  assert.match(under([bullet(40), '  ' + long(40)]).problems.join('\n'), over);
  // after a gap: part of it only when indented
  assert.match(under([bullet(40), '', '  ' + long(40)]).problems.join('\n'), over);
  assert.deepEqual(under([bullet(40), '', long(40)]).problems, []);
  // a code block at the margin ends the bullet, and so does the paragraph after it
  assert.deepEqual(under([bullet(40), '', '```', 'npm test', '```', long(40)]).problems, []);
  // an indented code block is part of the bullet
  assert.match(under([bullet(40), '', '  ```', '  ' + long(40), '  ```']).problems.join('\n'), over);
  // a smaller heading straight under a bullet ends it
  assert.deepEqual(under([bullet(40), '### A sub-heading', long(40)]).problems, []);
  // every one of those keeps its words in the total
  for (const lines of [[bullet(40), '', long(40)], [bullet(40), '', '```', long(40), '```'], [bullet(40), '### Sub', long(40)]]) {
    assert.ok(under(lines).total >= 82 + 9 + 11, `total ${under(lines).total}`);
  }
});

test('second review: a rule across the page is not a bullet', () => {
  for (const rule of ['* * *', '***', '- - -', '---', '___']) {
    assert.deepEqual(check(sectionOf(shaped({ news: [bullet(10), '', rule, '', bullet(10, 'A second claim.')] }))).problems, [], rule);
  }
});

test('second review: a plus is a bullet too', () => {
  assert.match(problemsOf(shaped({ news: ['+ **A claim.** ' + long(90)] })), /words, limit 70, under "What's new"/);
  assert.equal(isEmpty(sectionOf(section('pkg v0.4.0 (Upcoming)', '+ **A change.** With a plus.'))), false);
});

test('second review: a citation is a link whose number is the one in its address', () => {
  assert.equal(words(`One two. [word7 #7](https://example.org/u)`), 4, 'any word and a number is not a reference');
  assert.equal(words(`One two. [#7](${REF}8)`), 3, 'the number has to match');
  assert.equal(words(`One two. [roadmap #7](${REF}7)`), 4, 'the name has to be in the address');
  assert.equal(words(`One two. [#7](${REF}7)`), 2);
  const hidden = Array.from({ length: 300 }, (_, i) => `[word${i} #${i}](u)`).join(', ');
  assert.match(problemsOf(shaped({ news: ['- **A claim.** ' + hidden] })), /words, limit 70/);
  assert.equal(isEmpty(sectionOf(section('pkg v0.4.0 (Upcoming)', hidden))), false);
});

test('second review: bullets come under a heading once there is one', () => {
  const news = shaped({ headings: [bullet(5), '', "## What's new", '', bullet(5)] });
  assert.match(problemsOf(news), /Bullets come under a heading, not before the first one/);
});

test('second review: a section with headings has What\'s new', () => {
  const news = shaped({ headings: ['## Also in this release', '', bullet(5), '', '## Tests and provenance', '', '10 tests pass.'] });
  assert.match(problemsOf(news), /has a "What's new" heading first/);
});

test('second review: each kind of bullet has its own limit', () => {
  const under = (heading, n) => problemsOf(shaped({ headings: ["## What's new", '', bullet(5), '', `## ${heading}`, '', bullet(n - 2)] }));
  assert.equal(problemsOf(shaped({ news: [bullet(68)] })), '', "70 words pass under What's new");
  assert.equal(under('Also in this release', 60), '');
  assert.match(under('Also in this release', 61), /61 words, limit 60, under "Also in this release"/);
  for (const notice of ['Deprecated', 'Removed']) {
    assert.equal(under(notice, 100), '', `${notice}: 100 words pass`);
    assert.match(under(notice, 101), new RegExp(`101 words, limit 100, under "${notice}"`));
  }
});

test('second review: the demo line has to link the demo', () => {
  const news = section('pkg v1.0.0 (Upcoming)', GOOD.replace(`the [annotated demo](${DEMO})`, 'the annotated demo'));
  assert.match(problemsOf(news), /does not open with a "\*\*See it move:\*\*" line that links the demo page/);
});

test('second review: prose under a heading counts toward the section', () => {
  const news = shaped({ news: [bullet(5), '', long(650)] });
  assert.match(problemsOf(news), /The section is \d+ words; the limit is 600/);
});

test('second review: comments, images and tags are not words', () => {
  assert.equal(words('![a chart of counts](https://example.org/c.png) <b>bold</b> word'), 2);
  assert.equal(words('<span class="a b c">word</span>'), 1, 'a tag and its attributes are not words');
  assert.equal(words('[one](https://example.org/a "the title of it") two'), 2, 'a link counts as its text');
  const news = shaped({ news: [bullet(10), '', `<!-- ${long(700)}`, '# not a heading', '-->'] }) + '\n' + section('pkg v0.9.0', long(900));
  const { total, problems } = check(sectionOf(news));
  assert.deepEqual(problems, []);
  assert.ok(total < 100, `total ${total}`);
});

