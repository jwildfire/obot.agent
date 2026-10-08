#!/usr/bin/env node
// Holds a release's section of NEWS.md to the shape and the length limits in
// SKILL.md beside this file. Usage:
//
//   node check-notes.mjs path/to/NEWS.md            # the first (newest) section
//   node check-notes.mjs path/to/NEWS.md v1.9.1     # the section for that version
//
// An "(Upcoming)" section with no change in it yet has nothing to check and
// passes: every NEWS.md reads that way just after a release.
//
// Words are counted as a reader meets them: a link counts as its text, not its
// address, and the issue and pull-request links that close a bullet are not
// counted at all. Exit code 1 when a limit is passed, 2 when the file or the
// section cannot be read.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LIMITS = {
  section: 600, // every counted word of the section
  intro: 80, // the paragraphs between "See it move" and the first heading
  whatsNewBullets: 6,
  whatsNewBullet: 70,
  noticeBullet: 100, // Deprecated, Removed: the reader has to act, so say how
  alsoBullet: 60, // Also in this release
  tests: 100 // the Tests and provenance paragraph
};

export const HEADINGS = ["What's new", 'Deprecated', 'Removed', 'Also in this release', 'Tests and provenance'];

// The citation that closes a bullet or a paragraph: links to issues and pull
// requests, with "PR" and punctuation between them. Only a link whose text is a
// reference is one: "#12", "repo#12", "owner/repo#12" or "roadmap #12". A link
// that merely ends in a number ("see v#12", "the fix in #3") is prose and is
// counted. One link at a time, from the end, and only in the last few hundred
// characters of the line: a single pattern for the whole run of links can be
// matched in a number of ways that doubles with each link, and a pattern free to
// start anywhere takes time that grows with the square of the line.
const LAST_CITATION = /[\s,;(]*(?:PR\s+)?\[(?:[\w.-]+(?:\/[\w.-]+)?\s?)?#\d+\]\([^)\s]*\)[\s,;).]*$/;
const TAIL = 400;

function withoutCitations(text) {
  let end = text.length;
  for (;;) {
    const tail = text.slice(Math.max(0, end - TAIL), end);
    const cut = tail.replace(LAST_CITATION, '');
    if (cut === tail) return text.slice(0, end);
    end -= tail.length - cut.length;
  }
}

// Each pattern stops at the character that would open the next match, so a line
// of nothing but openers is read once and not once for every opener in it.
export function words(text) {
  const read = withoutCitations(text)
    .replace(/!\[[^\][]*\]\([^)[]*\)/g, ' ')
    .replace(/\[([^\][]*)\]\([^)[]*\)/g, '$1')
    .replace(/<[^<>]+>/g, ' ')
    .replace(/[*_`]/g, '');
  return read.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

function withoutComments(text) {
  let out = '';
  let at = 0;
  for (;;) {
    const open = text.indexOf('<!--', at);
    const close = open < 0 ? -1 : text.indexOf('-->', open + 4);
    if (close < 0) return out + text.slice(at);
    out += text.slice(at, open);
    at = close + 3;
  }
}

const FENCE = /^\s*(```|~~~)/;
const BULLET = /^[-*+] /;

// The lines outside code fences: a "# comment" in a shell example is not a
// heading, and a "- flag" in one is not a bullet.
function outsideFences(lines) {
  let fenced = false;
  return lines.map((line) => {
    if (FENCE.test(line)) {
      fenced = !fenced;
      return false;
    }
    return !fenced;
  });
}

export function sectionOf(news, version) {
  const lines = withoutComments(news).split('\n');
  const open = outsideFences(lines);
  const starts = lines.map((line, i) => (open[i] && /^# \S/.test(line) ? i : -1)).filter((i) => i >= 0);
  // A version names the section whose heading carries exactly that version,
  // with or without its "v": "v0.3.0" is not the section "v0.3.0.9000".
  const bare = (word) => word.replace(/^v/, '');
  const at = version
    ? starts.find((i) => lines[i].split(/\s+/).some((word) => bare(word) === bare(version)))
    : starts[0];
  if (at === undefined) return null;
  const next = starts.find((i) => i > at);
  return lines.slice(at, next === undefined ? lines.length : next);
}

// A part of a section as a reader meets it: its bullets, each with the lines
// it was wrapped over joined back on, and its other lines. A bullet opens with
// "-", "*" or "+". A line straight under a bullet, or an indented one after a
// gap, belongs to that bullet. What is inside a code fence is counted as prose.
function itemsOf(lines) {
  const bullets = [];
  const prose = [];
  const open = outsideFences(lines);
  let inBullet = false;
  let gap = true;
  lines.forEach((line, i) => {
    if (FENCE.test(line)) return;
    if (line.trim() === '') {
      gap = true;
      return;
    }
    if (!open[i]) prose.push(line);
    else if (BULLET.test(line)) {
      bullets.push(`- ${line.slice(2)}`);
      inBullet = true;
    } else if (inBullet && (!gap || /^\s{2,}\S/.test(line))) {
      bullets[bullets.length - 1] += ` ${line.trim()}`;
    } else {
      prose.push(line);
      inBullet = false;
    }
    gap = false;
  });
  return { bullets, prose };
}

// Whether a section is one still collecting changes with none in it yet: an
// "(Upcoming)" heading with no bullet and no heading under it, only nothing or
// a sentence saying so. The first change to land brings a bullet, and from
// then on the section is checked. A section that says more than a sentence or
// two is not empty however it is written.
const NOTHING_YET = 40;

export function isEmpty(lines) {
  if (!/\(Upcoming\)\s*$/.test(lines[0])) return false;
  const body = lines.slice(1);
  if (body.some((line) => /^(## |\*\*See it move:\*\*)/.test(line))) return false;
  const { bullets, prose } = itemsOf(body);
  return bullets.length === 0 && prose.reduce((sum, line) => sum + words(line), 0) <= NOTHING_YET;
}

export function check(lines) {
  const problems = [];
  const fail = (text) => problems.push(text);
  const body = lines.slice(1);
  const firstText = body.find((line) => line.trim() !== '') || '';
  if (!/^\*\*See it move:\*\*.*\]\(https?:\/\//.test(firstText)) {
    fail('The section does not open with a "**See it move:**" line that links the demo page.');
  }

  // Split into the opening part and the parts under each "##" heading.
  const parts = [{ heading: null, lines: [] }];
  const open = outsideFences(body);
  body.forEach((line, i) => {
    const heading = open[i] && /^## (.+?)\s*$/.exec(line);
    if (heading) parts.push({ heading: heading[1], lines: [] });
    else parts[parts.length - 1].lines.push(line);
  });
  for (const part of parts) Object.assign(part, itemsOf(part.lines));

  let total = 0;
  const bulletsOf = (part) => part.bullets;
  const proseOf = (part) => part.prose;
  const count = (texts) => texts.reduce((sum, text) => sum + words(text), 0);

  const opening = parts[0];
  const introLines = proseOf(opening).filter((line) => line !== firstText);
  const intro = count(introLines);
  // Bullets before any heading are counted too. A section still being written is
  // often a flat list, and its total used to be its first bullet alone.
  total += count(proseOf(opening)) + count(bulletsOf(opening));
  if (intro > LIMITS.intro) fail(`The introduction is ${intro} words; the limit is ${LIMITS.intro}.`);
  if (introLines.length === 0) fail('The section has no introduction: say in two to four sentences what the release is.');
  if (bulletsOf(opening).length > 0 && parts.length > 1) fail('Bullets come under a heading, not before the first one.');

  const order = parts.slice(1).map((part) => HEADINGS.indexOf(part.heading));
  parts.slice(1).forEach((part, i) => {
    if (order[i] < 0) fail(`"## ${part.heading}" is not one of the headings: ${HEADINGS.join(', ')}.`);
    else if (i > 0 && order[i - 1] >= 0 && order[i] < order[i - 1]) fail(`"## ${part.heading}" is out of order.`);
    const bullets = bulletsOf(part);
    const limit =
      part.heading === "What's new"
        ? LIMITS.whatsNewBullet
        : part.heading === 'Deprecated' || part.heading === 'Removed'
          ? LIMITS.noticeBullet
          : LIMITS.alsoBullet;
    if (part.heading === "What's new" && bullets.length > LIMITS.whatsNewBullets) {
      fail(`"What's new" has ${bullets.length} bullets; the limit is ${LIMITS.whatsNewBullets}. Move the smaller ones to "Also in this release".`);
    }
    for (const bullet of bullets) {
      const count = words(bullet.replace(/^- /, ''));
      total += count;
      if (part.heading !== 'Tests and provenance' && count > limit) {
        fail(`${count} words, limit ${limit}, under "${part.heading}": ${bullet.slice(2, 62)}…`);
      }
      if (part.heading !== 'Tests and provenance' && !/^- \*\*[^*]+\*\*/.test(bullet)) {
        fail(`A bullet under "${part.heading}" does not open with its claim in bold: ${bullet.slice(2, 62)}…`);
      }
    }
    const prose = proseOf(part).reduce((sum, line) => sum + words(line), 0);
    total += prose;
    if (part.heading === 'Tests and provenance' && prose + bullets.reduce((s, b) => s + words(b), 0) > LIMITS.tests) {
      fail(`"Tests and provenance" is ${prose + bullets.reduce((s, b) => s + words(b), 0)} words; the limit is ${LIMITS.tests}.`);
    }
  });
  if (!parts.some((part) => part.heading === "What's new") && parts.length > 1) {
    fail('A section with headings has a "What\'s new" heading first.');
  }
  if (total > LIMITS.section) fail(`The section is ${total} words; the limit is ${LIMITS.section}. The detail goes on the demo page.`);
  return { total, problems };
}

// Started as a command, by this file's own path or by a link to it: a skill is
// linked into a session's skills directory, so the two usually differ.
function startedDirectly() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (startedDirectly()) {
  const [file, version] = process.argv.slice(2);
  if (!file) {
    console.error('usage: node check-notes.mjs path/to/NEWS.md [version]');
    process.exit(2);
  }
  let news;
  try {
    news = readFileSync(file, 'utf8');
  } catch (error) {
    console.error(`cannot read ${file}: ${error.message}`);
    process.exit(2);
  }
  const lines = sectionOf(news, version);
  if (!lines) {
    console.error(`no section${version ? ` for ${version}` : ''} in ${file}`);
    process.exit(2);
  }
  if (isEmpty(lines)) {
    console.log(`${lines[0].replace(/^# /, '')}: nothing merged yet, so there is nothing to check.`);
    process.exit(0);
  }
  const { total, problems } = check(lines);
  console.log(`${lines[0].replace(/^# /, '')}: ${total} words (limit ${LIMITS.section})`);
  for (const problem of problems) console.log(`- ${problem}`);
  if (problems.length === 0) console.log('The notes are within every limit.');
  process.exit(problems.length ? 1 : 0);
}
