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
// requests, with "PR" and punctuation between them.
const CITATION = /(?:[\s,;(]*(?:PR\s+)?\[[^\]]*#\d+\]\([^)]*\)[\s,;).]*)+$/;

export function words(text) {
  const read = text
    .replace(CITATION, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`]/g, '');
  return read.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

export function sectionOf(news, version) {
  const lines = news.replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const starts = lines.map((line, i) => (/^# \S/.test(line) ? i : -1)).filter((i) => i >= 0);
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

// Whether a section is one still collecting changes with none in it yet: an
// "(Upcoming)" heading with no bullet and no heading under it, only nothing or
// a sentence saying so. The first change to land brings a bullet, and from
// then on the section is checked.
export function isEmpty(lines) {
  if (!/\(Upcoming\)\s*$/.test(lines[0])) return false;
  return !lines.slice(1).some((line) => /^(- |## |\*\*See it move:\*\*)/.test(line));
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
  for (const line of body) {
    const heading = /^## (.+?)\s*$/.exec(line);
    if (heading) parts.push({ heading: heading[1], lines: [] });
    else parts[parts.length - 1].lines.push(line);
  }

  let total = 0;
  const bulletsOf = (part) => part.lines.filter((line) => /^- /.test(line));
  const proseOf = (part) => part.lines.filter((line) => line.trim() !== '' && !/^- /.test(line));

  const opening = parts[0];
  const introLines = proseOf(opening).filter((line) => line !== firstText);
  const intro = introLines.reduce((sum, line) => sum + words(line), 0);
  total += words(firstText) + intro;
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
