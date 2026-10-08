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
  '- **A reader can do one new thing.** It takes one step. [#1](https://example.org/o/r/issues/1), PR [#2](https://example.org/o/r/pull/2)',
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
  const links = Array.from({ length: 30 }, (_, i) => `[#${i}](https://example.org/o/r/issues/${i})`).join(', ');
  const body = GOOD.replace('[#1](https://example.org/o/r/issues/1), PR [#2](https://example.org/o/r/pull/2)', `${links} end`);
  const file = write('many-links.md', section('pkg v1.0.0 (Upcoming)', body));
  const result = spawnSync(process.execPath, [checker, file], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.signal, null, 'the checker was still running after five seconds');
  assert.equal(result.status, 0);
});

test('the citations that close a line are not counted, however they are punctuated', () => {
  const cited = (tail) => words(`One two three.${tail}`);
  assert.equal(cited(''), 3);
  assert.equal(cited(' [#1](https://example.org/o/r/issues/1)'), 3);
  assert.equal(cited(' [#1](https://example.org/o/r/issues/1), PR [#2](https://example.org/o/r/pull/2).'), 3);
  assert.equal(cited(' ([hub#3](https://example.org/o/hub/issues/3); [#4](https://example.org/o/r/pull/4))'), 3);
  assert.equal(cited(' [#1](https://example.org/o/r/issues/1) and more'), 6, 'a link mid-line counts as its text');
  assert.equal(cited(' [the guide](https://example.org/g)'), 5, 'a link that is not a citation is read');
});

test('found in use: a flat list with no headings is totalled bullet by bullet, not by its first', () => {
  // This repository's own upcoming section printed 46 words where its lines came to 246.
  const news = section('pkg v0.4.0 (Upcoming)', ['- **One.** ' + long(10), '- **Two.** ' + long(20), '- **Three.** ' + long(30)].join('\n'));
  assert.equal(check(sectionOf(news)).total, 11 + 21 + 31);
});

// --- found by three reviews before v0.6.0 (2026-10-07) -------------------------
// The first switched each limit off in a copy of the checker and no test noticed.
// The second and third found that two attempts to read code fences had each left
// a way to lose words or switch a rule off. So the checker reports what it cannot
// read, and every limit below is tested at its edge: the last count that passes
// and the first that fails. A fourth compared it with the checker before any of
// this on a million generated sections; the four differences it found that were
// wrong are the cases marked "fourth review" below.
const REF = 'https://example.org/o/r/issues/';
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
const result = (news) => check(sectionOf(news));
const problemsOf = (news) => result(news).problems.join('\n');
const upcoming = (body) => sectionOf(section('pkg v0.4.0 (Upcoming)', body));
const OVER = /words, limit 70, under "What's new"/;

// ---- the limits

test('limits: the section, at 600 and at 601', () => {
  // demo line 9 words, introduction 10, "10 tests pass." 3, and bullets of 70 six times, 60 twice, and 38 or 39
  const at = (last) => shaped({ news: Array.from({ length: 6 }, () => bullet(68)), also: [bullet(58), bullet(58), bullet(last - 2)] });
  assert.equal(result(at(38)).total, 600);
  assert.deepEqual(result(at(38)).problems, []);
  assert.equal(result(at(39)).total, 601);
  assert.match(problemsOf(at(39)), /The section is 601 words; the limit is 600/);
});

test('limits: every kind of line is in the total', () => {
  const base = result(shaped()).total;
  assert.equal(base, 9 + 10 + 12 + 3, 'demo line, introduction, one bullet, the tests line');
  assert.equal(result(shaped({ news: [bullet(10), '', long(7)] })).total, base + 7, 'prose under a heading');
  assert.equal(result(shaped({ also: [bullet(5)] })).total, base + 7, 'a bullet under a second heading');
  assert.equal(result(shaped({ intro: long(20) })).total, base + 10, 'the introduction');
  assert.equal(result(shaped({ news: [bullet(10), '', '### A smaller heading'] })).total, base + 3);
});

test('limits: the introduction, at 80 and at 81', () => {
  assert.deepEqual(result(shaped({ intro: long(80) })).problems, []);
  assert.match(problemsOf(shaped({ intro: long(81) })), /The introduction is 81 words; the limit is 80/);
  assert.match(problemsOf(shaped({ intro: '' })), /has no introduction/);
});

test("limits: What's new takes six bullets, and only What's new is held to six", () => {
  const six = Array.from({ length: 6 }, () => bullet(5));
  assert.deepEqual(result(shaped({ news: six })).problems, []);
  assert.match(problemsOf(shaped({ news: [...six, bullet(5)] })), /"What's new" has 7 bullets; the limit is 6/);
  assert.deepEqual(result(shaped({ also: [...six, bullet(5)] })).problems, []);
});

test('limits: each kind of bullet has its own', () => {
  const under = (heading, n) => problemsOf(shaped({ headings: ["## What's new", '', bullet(5), '', `## ${heading}`, '', bullet(n - 2)] }));
  assert.equal(problemsOf(shaped({ news: [bullet(68)] })), '', "70 words pass under What's new");
  assert.match(problemsOf(shaped({ news: [bullet(69)] })), /71 words, limit 70, under "What's new"/);
  assert.equal(under('Also in this release', 60), '');
  assert.match(under('Also in this release', 61), /61 words, limit 60, under "Also in this release"/);
  for (const notice of ['Deprecated', 'Removed']) {
    assert.equal(under(notice, 100), '', `${notice}: 100 words pass`);
    assert.match(under(notice, 101), new RegExp(`101 words, limit 100, under "${notice}"`));
  }
});

test('limits: Tests and provenance is 100 words, as prose or as bullets, and its bullets need no bold', () => {
  const tests = (lines) => shaped({ headings: ["## What's new", '', bullet(5), '', '## Tests and provenance', '', ...lines] });
  assert.equal(problemsOf(tests([long(100)])), '');
  assert.match(problemsOf(tests([long(101)])), /"Tests and provenance" is 101 words; the limit is 100/);
  assert.equal(problemsOf(tests(['- ' + long(50), '- ' + long(50)])), '', 'two plain bullets of 50');
  assert.match(problemsOf(tests(['- ' + long(51), '- ' + long(50)])), /"Tests and provenance" is 101 words/);
  assert.equal(problemsOf(tests(['- ' + long(90)])), '', 'one plain bullet of 90: no bold rule, no 60-word rule');
  assert.match(problemsOf(tests([long(60), '', '- ' + long(41)])), /"Tests and provenance" is 101 words/, 'a paragraph and a bullet together');
});

// ---- the shape

test('shape: the demo line comes first and links the demo', () => {
  assert.match(problemsOf(shaped({ demo: false })), /does not open with a "\*\*See it move:\*\*" line/);
  const second = section('pkg v1.0.0 (Upcoming)', ['An introduction first.', '', GOOD].join('\n'));
  assert.match(problemsOf(second), /does not open with a "\*\*See it move:\*\*" line/, 'first, not merely present');
  const unlinked = section('pkg v1.0.0 (Upcoming)', GOOD.replace(`the [annotated demo](${DEMO})`, 'the annotated demo'));
  assert.match(problemsOf(unlinked), /does not open with a "\*\*See it move:\*\*" line that links the demo page/);
});

test('shape: a bullet opens with its claim in bold, closed', () => {
  assert.match(problemsOf(shaped({ news: ['- A claim with no bold. ' + long(5)] })), /does not open with its claim in bold/);
  assert.match(problemsOf(shaped({ news: ['- **A claim never closed. ' + long(5)] })), /does not open with its claim in bold/);
  assert.match(problemsOf(shaped({ news: ['- A plain opening, then **bold later**.'] })), /does not open with its claim in bold/);
  // fourth review's fuzzing: bold around nothing is not a claim
  for (const lines of [['- **', '**'], ['- ** **'], ['- ** A claim. **'], ['- ****']]) {
    assert.match(problemsOf(shaped({ news: lines })), /does not open with its claim in bold/, lines.join('|'));
  }
  assert.equal(problemsOf(shaped({ news: ['- **A** one-letter claim.'] })), '');
  assert.equal(problemsOf(shaped({ news: ['- **A claim wrapped', '  over two lines.** And more.'] })), '');
  assert.match(problemsOf(shaped({ also: ['- Plain. ' + long(5)] })), /under "Also in this release" does not open with its claim in bold/);
});

test('shape: headings are the five, in order, once each, with What\'s new among them', () => {
  const heads = (...names) => problemsOf(shaped({ headings: names.flatMap((name) => [`## ${name}`, '', bullet(5), '']) }));
  assert.equal(heads("What's new", 'Deprecated', 'Removed', 'Also in this release'), '');
  assert.equal(heads("What's new  ", ' Deprecated'.trim() + '\t'), '', 'space after a heading is not part of its name');
  assert.match(heads('Also in this release', "What's new"), /"## What's new" is repeated or out of order/);
  assert.match(heads("What's new", "What's new"), /"## What's new" is repeated or out of order/);
  assert.match(heads("What's new", 'Internals'), /"## Internals" is not one of the headings/);
  assert.doesNotMatch(heads("What's new", 'Internals', 'Deprecated'), /out of order/, 'an unknown heading is named once, not twice');
  assert.match(heads('Also in this release'), /has a "What's new" heading first/);
});

test('shape: bullets come under a heading', () => {
  assert.match(problemsOf(shaped({ headings: [bullet(5), '', "## What's new", '', bullet(5)] })), /Bullets come under a heading/);
  assert.match(problemsOf(shaped({ headings: [bullet(5), bullet(5, 'Another.')] })), /Bullets come under a heading/, 'a flat list is not in shape');
});

// ---- what is read as a bullet

test('bullets: a star and a plus are bullets too', () => {
  for (const mark of ['*', '+']) {
    assert.equal(problemsOf(shaped({ news: [`${mark} **A claim.** ` + long(10)] })), '', `${mark}: in bold, so nothing to report`);
    assert.match(problemsOf(shaped({ news: [`${mark} **A claim.** ` + long(90)] })), OVER, mark);
    assert.equal(isEmpty(upcoming(`${mark} **A change.** Written so.`)), false, mark);
  }
});

test('bullets: a line joins a bullet only when Markdown would put it there', () => {
  const under = (lines) => result(shaped({ news: lines }));
  // straight under the bullet, indented or not: part of it
  assert.match(under([bullet(40), long(40)]).problems.join('\n'), OVER);
  assert.match(under([bullet(40), '  ' + long(40)]).problems.join('\n'), OVER);
  assert.match(under([bullet(40), '\t' + long(40)]).problems.join('\n'), OVER);
  assert.match(under([bullet(55), '  ' + long(60), '  ' + long(60)]).problems.join('\n'), /177 words, limit 70/);
  // after a gap: part of it only when indented by two or more
  assert.match(under([bullet(40), '', '  ' + long(40)]).problems.join('\n'), OVER);
  assert.match(under([bullet(40), '', '\t' + long(40)]).problems.join('\n'), OVER, 'a tab is an indent');
  assert.deepEqual(under([bullet(40), '', ' ' + long(40)]).problems, [], 'one space is no indent');
  assert.deepEqual(under([bullet(40), '', long(40)]).problems, []);
  assert.deepEqual(under([bullet(40), '', long(20), long(40)]).problems, [], 'nor is the second line of the paragraph after it');
  // a nested bullet is part of its parent
  assert.match(under([bullet(40), '  - ' + long(40)]).problems.join('\n'), OVER);
  // a smaller heading or a rule across the page ends a bullet
  assert.deepEqual(under([bullet(40), '### A sub-heading', long(40)]).problems, []);
  assert.deepEqual(under([bullet(40), '***', long(40)]).problems, []);
  // and what follows it is not the bullet's even when indented
  assert.deepEqual(under([bullet(40), '### A sub-heading', '  ' + long(40)]).problems, []);
  assert.deepEqual(under([bullet(40), '***', '  ' + long(40)]).problems, []);
  // only "1." can break into a paragraph; another number straight under a line is that line going on
  assert.match(under([bullet(40), '10. ' + long(40)]).problems.join('\n'), OVER);
  // and none of it loses a word
  for (const lines of [[bullet(40), '', long(40)], [bullet(40), '### Sub', long(40)], [bullet(40), '  - ' + long(40)], [bullet(40), '***', long(40)]]) {
    assert.ok(under(lines).total >= 82 + 9 + 10 + 3, `total ${under(lines).total}`);
  }
});

test('bullets: a rule across the page is not a bullet', () => {
  for (const rule of ['* * *', '***', '- - -', '---', '___', '  ---  ', ' ___', '   * * *']) {
    assert.deepEqual(result(shaped({ news: [bullet(10), '', rule, '', bullet(10, 'A second claim.')] })).problems, [], rule);
    // straight under a bullet it ends the bullet: the paragraph after it is not the bullet going on
    assert.deepEqual(result(shaped({ news: [bullet(40), rule, long(40)] })).problems, [], rule);
  }
  // two marks are not a rule: the line is the bullet going on
  for (const not of ['--', '__', '* *']) {
    assert.match(problemsOf(shaped({ news: [bullet(40), not, long(40)] })), not === '* *' ? /./ : OVER, not);
  }
});

// ---- what it cannot read, it reports

test('unread: a code block is reported, counted, and never read as empty', () => {
  for (const mark of ['```', '~~~', '```bash', '  ```', '````', '``` ' + long(300)]) {
    const news = shaped({ news: [bullet(10), '', mark, 'npm test', mark.trim().slice(0, 3)] });
    assert.match(problemsOf(news), /opens with a code-block marker \(2 of them\)/, mark);
    assert.equal(isEmpty(upcoming([mark, 'x', '```'].join('\n'))), false, mark);
  }
  assert.ok(result(shaped({ intro: ['``` ' + long(300), '~~~ ' + long(300)].join('\n') })).total > 600, 'its words are counted');
  // the rules below a marker still apply, closed or not
  const open = problemsOf(shaped({ news: ['```bash', 'npm test', '', '- ' + long(150)] }));
  assert.match(open, OVER);
  assert.match(open, /does not open with its claim in bold/);
  // a "# comment" in one still ends the section, but the section has already failed
  const cut = shaped({ news: [bullet(10), '', '```bash', '# a comment', 'echo hello', '```'] });
  assert.match(problemsOf(cut), /opens with a code-block marker/);
});

test('unread: a list item or a heading off the margin is reported, and is not nothing', () => {
  const off = /look like a list item or a heading and are not at the margin/;
  for (const line of [' - ' + long(90), '-\tx', '-', '1. x', '1) x', '7. x', ' ## Also in this release', ' ### x']) {
    assert.match(problemsOf(shaped({ news: [bullet(5), '', line] })), off, JSON.stringify(line));
  }
  // with no bullet above to belong to, so is one indented further
  for (const line of ['   - x', '    - x', '   ## x']) {
    assert.match(problemsOf(shaped({ news: [long(5), '', line, '', bullet(5)] })), off, JSON.stringify(line));
  }
  for (const line of [' - **A change.** Indented.', '1. A change.', '-\tA change.', '-']) {
    assert.equal(isEmpty(upcoming(line)), false, JSON.stringify(line));
  }
  // its words are still counted
  assert.equal(result(shaped({ news: [bullet(5), '', ' - ' + long(20)] })).total, result(shaped()).total - 12 + 7 + 20);
  // in the part before the first heading too, a list item and a code block alike
  assert.match(problemsOf(shaped({ intro: 'An introduction.\n\n1. A step.' })), off);
  assert.match(problemsOf(shaped({ intro: 'An introduction.\n\n```\nnpm test\n```' })), /code-block marker/);
  // indented by a tab, or numbered in two digits, after a gap
  assert.match(problemsOf(shaped({ news: [long(5), '', '\t- x', '', bullet(5)] })), off);
  assert.match(problemsOf(shaped({ news: [bullet(5), '', '12. x'] })), off);
  // straight under a smaller heading or a rule, any number starts a list
  assert.match(problemsOf(shaped({ news: [bullet(5), '', '### Steps', '2. second'] })), off);
  assert.match(problemsOf(shaped({ news: [bullet(5), '', '---', '2. second'] })), off);
  // straight under a bullet, "1." starts a list and is reported
  assert.match(problemsOf(shaped({ news: [bullet(5), '1. x'] })), off);
  // prose that only looks a little like one is left alone
  for (const line of ['1.9.2 is a patch.', '*Emphasis* opens this line.', '-not a bullet', '2026 was the year.']) {
    assert.deepEqual(result(shaped({ news: [bullet(5), '', line] })).problems, [], line);
  }
});

// ---- what is a word

test('words: a link is its text; an image, a tag and a comment are nothing', () => {
  assert.equal(words('See [the guide](https://example.org/g) now'), 4);
  assert.equal(words('See [→](https://example.org/g) now'), 2, 'and not its address');
  assert.equal(words('![a chart of counts](https://example.org/c.png) word'), 1);
  assert.equal(words('<span class="a b c">word</span>'), 1);
  assert.equal(words('**Bold** and `code` and _emphasis_'), 5);
  // a block comment is not read, and a heading inside it is not a heading
  const news = shaped({ news: [bullet(10), '', `<!-- ${long(700)}`, '# not a heading', '-->'] }) + '\n' + section('pkg v0.9.0', long(900));
  assert.deepEqual(result(news).problems, []);
  assert.equal(result(news).total, result(shaped()).total);
  assert.equal(words('word </b> word'), 2, 'a closing tag too');
});

test('words: what only looks like markup is counted', () => {
  assert.equal(words('Values <5 are flagged and counts >10 are capped'), 9, 'a tag opens with a letter');
  assert.equal(words('[see](one two three four)'), 4, 'an address has no space in it, so this is four words and not one');
  assert.equal(words('Привет мир, 你好'), 3, 'a word is letters of any alphabet');
  assert.equal(words('a -- b ** c'), 3, 'marks on their own are not words');
});

test('words: a title after an address is not read, in a link or an image', () => {
  assert.equal(words('See [the guide](https://example.org/g "The guide to it") now'), 4);
  assert.equal(words("See [the guide](https://example.org/g 'The guide to it') now"), 4);
  assert.equal(words('![a chart](https://example.org/c.png "Counts by arm") word'), 1);
});

test('words: counted a line at a time, so nothing that spans lines takes words out', () => {
  // fourth review: "<LLN, … >ULN" over a wrapped bullet was read as one tag, 80 words as 15
  const wrapped = shaped({ news: ['- **Values are flagged.** Those <LLN, ' + long(75), '  and those >ULN.'] });
  assert.match(problemsOf(wrapped), /8\d words, limit 70/);
  const image = shaped({ news: ['- **A claim.** ![' + long(75), '  more](https://example.org/c.png)'] });
  assert.match(problemsOf(image), /words, limit 70/);
  // a wrapped bullet is the sum of its lines, with no word lost at a join
  const sum = result(shaped({ news: [bullet(20), long(20), '  ' + long(20)] })).total - result(shaped()).total;
  assert.equal(sum, 22 + 20 + 20 - 12);
});

test('comments: one on its own lines is not read; any other marker is reported', () => {
  const marker = /comment marker is not part of a comment on its own lines/;
  const base = result(shaped()).total;
  // on its own lines: gone, and what follows the close on its last line is kept
  const block = shaped({ news: [bullet(10), '', '<!-- ' + long(300), long(300), '--> kept words'] });
  assert.deepEqual(result(block).problems, []);
  assert.equal(result(block).total, base + 2);
  assert.deepEqual(result(shaped({ news: [bullet(10), '<!-- one line -->'] })).problems, []);
  // fourth review: an indented comment was read as text, and a "# " line in it ended the section
  const indented = shaped({ headings: [' <!--', '# to do before release', ' -->', "## What's new", '', '- ' + long(81)] });
  assert.match(problemsOf(indented), marker);
  assert.equal(isEmpty(upcoming([' <!--', '# to do', ' -->', '- ' + long(81)].join('\n'))), false);
  // fourth review: its words were read as the introduction
  assert.match(problemsOf(shaped({ intro: ' <!-- introduction to come -->' })), marker);
  // fourth review: the empty comment "<!-->" paired with a "-->" further down
  const empty = shaped({ news: [bullet(10) + ' <!-- old', '<!--> ', '- ' + long(80), '-->'] });
  assert.match(problemsOf(empty), marker);
  assert.match(problemsOf(empty), OVER);
  // in a sentence, never closed, or closed twice: reported, and the words around it counted
  for (const lines of [[bullet(10) + ' The `<!--` marker.'], [bullet(10), '', '<!-- never closed', bullet(10, 'Two.')], [bullet(10) + ' One <!-- two --> three.'], [bullet(10), '-->']]) {
    assert.match(problemsOf(shaped({ news: lines })), marker, lines.join('|'));
    assert.ok(result(shaped({ news: lines })).total >= base, lines.join('|'));
  }
  assert.equal(isEmpty(upcoming('Nothing yet. <!-- ' + long(5))), false);
});

test('words: a closing citation is left out only when it is a real reference', () => {
  const cited = (tail) => words(`One two. ${tail}`);
  assert.equal(cited(`[#7](${REF}7)`), 2);
  assert.equal(words(`One two [#7](${REF}7)`), 2, 'with no full stop before it, the word before it is still a word');
  assert.equal(cited(`[r#7](${REF}7), PR [o/r#8](https://example.org/o/r/pull/8).`), 2);
  assert.equal(cited('[roadmap #7](https://github.com/jwildfire/obot.roadmap/issues/7)'), 2, 'the part of the name after a dot');
  assert.equal(cited('[jwildfire/obot.agent#3](https://github.com/jwildfire/obot.agent/discussions/3#discussioncomment-1)'), 2);
  assert.equal(cited(`[#7](${REF}8)`), 3, 'the number has to be the one in the address');
  assert.equal(cited(`[word #7](${REF}7)`), 4, 'the name has to be the repository');
  assert.equal(cited('[map #7](https://github.com/jwildfire/obot.roadmap/issues/7)'), 4, 'or what follows a dot in it, whole');
  assert.equal(cited('[Obot.Roadmap#7](https://github.com/jwildfire/obot.roadmap/issues/7)'), 2, 'in any case');
  assert.equal(cited('[word #7](https://example.org/o/r/issues/7#word)'), 4, 'and not merely somewhere in the address');
  assert.equal(cited('[is #7](https://example.org/o/r/issues/7)'), 4, 'nor a piece of it');
  assert.equal(cited('[a b #7](https://example.org/o/a/issues/7)'), 5, 'one name, not several');
  assert.equal(cited('[#7](https://example.org/o/r/commit/7)'), 3, 'an issue, a pull request or a discussion');
  assert.equal(cited('[#7](https://example.org/o/r/pull/7/files)'), 3);
  assert.equal(cited('[see v#12](https://example.org/o/r/issues/12)'), 4);
  assert.equal(cited(`[#7](${REF}7) and more`), 5, 'only at the end of the line');
  // at most ten a line, so a line cannot be made of them
  const many = (n) => Array.from({ length: n }, (_, i) => `[r#${i}](${REF}${i})`).join(', ');
  assert.equal(cited(many(10)), 2);
  assert.equal(cited(many(12)), 4);
});

// ---- nothing merged yet

test('empty: only an upcoming section that says next to nothing', () => {
  assert.equal(isEmpty(upcoming(NOTHING)), true);
  assert.equal(isEmpty(upcoming(long(40))), true);
  assert.equal(isEmpty(upcoming(long(41))), false);
  assert.equal(isEmpty(upcoming('### Fixes\n\nOne sentence.')), false, 'a heading of any size is something');
  assert.equal(isEmpty(upcoming('#NoSpace is prose here.')), false, 'and anything that might be one');
  assert.equal(isEmpty(sectionOf(section('pkg v0.4.0', NOTHING))), false, 'a released section is never empty');
  assert.equal(isEmpty(sectionOf(section('pkg (Upcoming) v0.4.0', NOTHING))), false, 'the heading ends with it');
  assert.equal(isEmpty(sectionOf(section('pkg v0.4.0 (Upcoming)  ', NOTHING))), true);
});

// ---- the file

test('file: Windows line endings and a byte-order mark change nothing', () => {
  const news = shaped({ news: [bullet(10), '', '* * *', '', bullet(69, 'Too long.')] }) + '\n' + section('pkg v0.9.0', GOOD);
  const plain = result(news);
  assert.equal(plain.problems.length, 1);
  for (const [name, text] of [['CRLF', news.replace(/\n/g, '\r\n')], ['BOM', '\uFEFF' + news], ['CR', news.replace(/\n/g, '\r')]]) {
    assert.deepEqual(result(text), plain, name);
    assert.notEqual(sectionOf(text, 'v0.9.0'), null, name);
  }
});

test('file: the command says what it could not do, with exit 2', () => {
  assert.equal(run(checker).status, 2);
  assert.match(run(checker).stderr, /usage:/);
  const missing = run(checker, join(scratch, 'no-such-file.md'));
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /cannot read/);
  assert.equal(run(checker, write('no-heading.md', 'just text\n')).status, 2);
});

// ---- time

test('time: no line of a few hundred thousand characters takes a second', () => {
  const run200k = (unit) => unit.repeat(Math.ceil(200000 / unit.length));
  const started = Date.now();
  const units = ['![', '[a](', '<', '<a', `[r#1](${REF}1) `, '[w #1](u) ', '<!--', '-->', '```', '~~~x ', '* ', '- ', '# ', '## ', '1. ', ' ', '\t', '**'];
  for (const unit of units) {
    const line = run200k(unit);
    words(line);
    for (const text of [line, `- ${line} x`, `${line}\n`.repeat(3), `## What's new${line}x`, `\`\`\`${line}x y`, `- - -${line}x`, `1.${line}x`]) {
      const lines = sectionOf(shaped({ news: [bullet(5), '', text] }));
      check(lines);
      isEmpty(lines);
    }
    isEmpty(sectionOf(section(`pkg v0.4.0 (Upcoming)${line}x`, line)));
  }
  // very many short lines, each one something the checker looks for
  for (const short of ['```', '~~~~', '-', '1. x', '<!--', '## x', '***']) check(sectionOf(shaped({ news: [`${short}\n`.repeat(50000)] })));
  const took = Date.now() - started;
  assert.ok(took < 5000, `took ${took} ms for ${units.length * 8 + 7} inputs of 200,000 characters`);
});
