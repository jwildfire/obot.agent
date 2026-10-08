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
// counted at all.
//
// This reads the shape SKILL.md describes and no other. It is not a Markdown
// parser, and two attempts to make it read code fences each left a way to lose
// words or switch a rule off. So what it cannot read it reports: a fenced code
// block, a list item that is not "- " at the margin, a heading that is not at
// the margin, a comment marker that is not a comment on its own lines. Words are
// counted a line at a time, so nothing that spans lines can take words out, and
// every line that is not blank or a "## " heading is counted. What it still
// reads differently from a reader is listed in obot.agent#354.
//
// Exit code 1 when a limit is passed, 2 when the file or the section cannot be
// read.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LIMITS = {
  section: 600, // every counted word of the section
  intro: 80, // the paragraphs between "See it move" and the first heading
  whatsNewBullets: 6,
  whatsNewBullet: 70,
  noticeBullet: 100, // Deprecated, Removed: the reader has to act, so say how
  alsoBullet: 60, // Also in this release
  tests: 100, // the Tests and provenance paragraph
  citations: 10 // closing references left out of one line's count
};

export const HEADINGS = ["What's new", 'Deprecated', 'Removed', 'Also in this release', 'Tests and provenance'];

// The citation that closes a bullet or a paragraph: links to issues and pull
// requests, with "PR" and punctuation between them. A link is a citation only
// when it is a reference and nothing else: its text is "#12", "repo#12",
// "owner/repo#12" or "roadmap #12", its address is that issue, pull request or
// discussion, and any name in the text is the repository in the address (or the
// part of its name after a dot: "roadmap" for obot.roadmap). At most ten a line
// are left out. One link at a time, from the end, and only in the last few
// hundred characters of the line: a single pattern for the whole run of links
// can be matched in a number of ways that doubles with each link, and a pattern
// free to start anywhere takes time that grows with the square of the line.
const LAST_CITATION = /[\s,;(]*(?:PR\s+)?\[((?:[\w.-]+(?:\/[\w.-]+)?\s?)?)#(\d+)\]\(([^)\s]*)\)[\s,;).]*$/;
const REFERENCE = /^https?:\/\/[^/\s]+\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull|discussions)\/(\d+)(?:[#?]\S*)?$/;
const TAIL = 400;

function isReference(text, number, address) {
  const at = REFERENCE.exec(address);
  if (!at || at[3] !== number) return false;
  const [name, owner, repo] = [text.trim(), at[1], at[2]].map((part) => part.toLowerCase());
  return name === '' || name === repo || name === `${owner}/${repo}` || repo.endsWith(`.${name}`);
}

function withoutCitations(text) {
  let end = text.length;
  for (let left = LIMITS.citations; left > 0; left--) {
    const tail = text.slice(Math.max(0, end - TAIL), end);
    const found = LAST_CITATION.exec(tail);
    if (!found || !isReference(found[1], found[2], found[3])) break;
    end -= found[0].length;
  }
  return text.slice(0, end);
}

// The words of one line. Each pattern stops at the character that would open
// the next match, so a line of nothing but openers is read once and not once
// for every opener in it. A link's address has no space in it, though a title
// in quotes may follow it, so "[see](a sentence)" is counted as it is read. A
// tag opens with a letter, so "<5 and >10" loses nothing.
const ADDRESS = String.raw`\([^)[\s]*(?:\s+(?:"[^"()]*"|'[^'()]*'))?\)`;
const IMAGE = new RegExp(String.raw`!\[[^\][]*\]${ADDRESS}`, 'g');
const LINK = new RegExp(String.raw`\[([^\][]*)\]${ADDRESS}`, 'g');

export function words(text) {
  const read = withoutCitations(text)
    .replace(IMAGE, ' ')
    .replace(LINK, '$1')
    .replace(/<\/?[a-zA-Z][^<>]*>/g, ' ');
  // A word is anything with a letter or a digit in it, so emphasis marks and
  // stray punctuation need no removing: on their own they are not words.
  return read.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

// A comment is taken out only when it opens at the start of a line and closes.
// Any marker left after that (one inside a sentence, one indented, one never
// closed, the empty "<!-->") is reported by check: taken for a comment, a marker
// in a sentence paired with the next "-->" anywhere below and everything between
// went uncounted; left as text, an indented comment's words were read as notes.
function withoutComments(text) {
  const from = `\n${text}`;
  let out = '';
  let at = 0;
  for (;;) {
    let open = from.indexOf('\n<!--', at);
    while (open >= 0 && from[open + 5] === '>') open = from.indexOf('\n<!--', open + 5);
    const close = open < 0 ? -1 : from.indexOf('-->', open + 5);
    if (close < 0) return (out + from.slice(at)).slice(1);
    out += from.slice(at, open + 1);
    at = close + 3;
  }
}
const COMMENT_MARK = /<!--|-->/;

const BULLET = /^[-*+] /;
// A bullet's opening claim: bold that starts and ends on a character, not a space.
const BOLD_CLAIM = /^- \*\*(?:[^\s*]|[^\s*][^*]*[^\s*])\*\*/;
// A rule across the page: "---", "* * *", "___". Not a bullet, and no words.
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
// What Markdown may read as a list item or a heading and this does not: a
// marker that is indented, followed by a tab or by nothing, or a number.
const LIST_MARK = /^\s*(?:[-*+](?:\s|$)|(\d{1,9})[.)](?:\s|$))/;
const OFF_MARGIN_HEADING = /^ {1,3}#{1,6}(?:\s|$)/;
// The line that opens or closes a code block.
const FENCE = /^\s*(?:```|~~~)/;

export function sectionOf(news, version) {
  const lines = withoutComments(news.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')).split('\n');
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

// A part of a section as a reader meets it: its bullets, each with the lines
// that belong to it, and its other lines. Every line that is not blank lands in
// one or the other with its own word count, so no word goes uncounted and
// nothing that spans two lines can hide one. A bullet opens with "-", "*" or "+"
// at the margin. A line straight under a bullet belongs to it, and so does an
// indented line after a gap. A smaller heading ends a bullet, and so do a rule
// across the page and a list item at the margin that is not a bullet; those
// last, and any off the margin outside a bullet, are returned as unread.
function itemsOf(lines) {
  const bullets = [];
  const prose = [];
  const unread = [];
  let inBullet = false;
  let gap = true; // nothing above that this line could be going on from
  const joins = (line) => {
    const bullet = bullets[bullets.length - 1];
    bullet.text += ` ${line.trim()}`;
    bullet.size += words(line);
  };
  for (const line of lines) {
    if (line.trim() === '') {
      gap = true;
      continue;
    }
    const indented = /^(?:\t| {2,})\S/.test(line);
    const mark = LIST_MARK.exec(line);
    // Only "1." can break into a paragraph; any other number straight under a
    // line of text is that line going on.
    const listLike = mark && (mark[1] === undefined || gap || mark[1] === '1');
    const afterGap = gap;
    gap = false;
    if (RULE.test(line)) {
      inBullet = false;
      gap = true;
    } else if (BULLET.test(line)) {
      bullets.push({ text: `- ${line.slice(2)}`, size: words(line.slice(2)) });
      inBullet = true;
    } else if (inBullet && indented) {
      joins(line);
    } else if (/^#{1,6} /.test(line)) {
      prose.push({ line, size: words(line) });
      inBullet = false;
      gap = true;
    } else if (listLike || OFF_MARGIN_HEADING.test(line)) {
      prose.push({ line, size: words(line) });
      unread.push(line);
      inBullet = false;
    } else if (inBullet && !afterGap) {
      joins(line);
    } else {
      prose.push({ line, size: words(line) });
      inBullet = false;
    }
  }
  return { bullets, prose, unread };
}

// Whether a section is one still collecting changes with none in it yet: an
// "(Upcoming)" heading with nothing under it but a sentence or two of plain
// prose saying so. A bullet, a heading of any size, a demo line, a code block,
// a comment marker or a list item it cannot read each mean there is something
// to check. The first change to land brings a bullet, and from then on the
// section is checked.
const NOTHING_YET = 40;

export function isEmpty(lines) {
  if (!lines[0].trimEnd().endsWith('(Upcoming)')) return false;
  const body = lines.slice(1);
  if (body.some((line) => /^ {0,3}#/.test(line) || line.startsWith('**See it move:**') || FENCE.test(line) || COMMENT_MARK.test(line))) return false;
  const { bullets, prose, unread } = itemsOf(body);
  if (bullets.length > 0 || unread.length > 0) return false;
  return prose.reduce((sum, item) => sum + item.size, 0) <= NOTHING_YET;
}

export function check(lines) {
  const problems = [];
  const fail = (text) => problems.push(text);
  const body = lines.slice(1);
  const firstText = body.find((line) => line.trim() !== '') || '';
  if (!/^\*\*See it move:\*\*.*\]\(https?:\/\//.test(firstText)) {
    fail('The section does not open with a "**See it move:**" line that links the demo page.');
  }
  const fences = body.filter((line) => FENCE.test(line));
  if (fences.length > 0) {
    fail(`A line opens with a code-block marker (${fences.length} of them): a command or a snippet goes on the demo page, and inline code is fine.`);
  }
  const marks = body.filter((line) => COMMENT_MARK.test(line));
  if (marks.length > 0) {
    fail(`A comment marker is not part of a comment on its own lines (${marks.length} of them): open "<!--" at the start of a line and close it, or take it out: ${marks[0].trim().slice(0, 50)}…`);
  }

  // Split into the opening part and the parts under each "##" heading. Not by
  // a pattern ending in "\s*$": on a heading followed by a long run of spaces
  // that took time growing with the square of the run.
  const parts = [{ heading: null, lines: [] }];
  for (const line of body) {
    if (line.startsWith('## ')) parts.push({ heading: line.slice(3).trim(), lines: [] });
    else parts[parts.length - 1].lines.push(line);
  }
  for (const part of parts) Object.assign(part, itemsOf(part.lines));
  const unread = parts.flatMap((part) => part.unread);
  if (unread.length > 0) {
    fail(`${unread.length} line(s) look like a list item or a heading and are not at the margin as "- " or "## ": ${unread[0].trim().slice(0, 50)}…`);
  }

  let total = 0;
  const count = (items) => items.reduce((sum, item) => sum + item.size, 0);

  const opening = parts[0];
  const introLines = opening.prose.filter((item) => item.line !== firstText);
  const intro = count(introLines);
  // Bullets before any heading are counted too. A section still being written is
  // often a flat list, and its total used to be its first bullet alone.
  total += count(opening.prose) + count(opening.bullets);
  if (intro > LIMITS.intro) fail(`The introduction is ${intro} words; the limit is ${LIMITS.intro}.`);
  if (introLines.length === 0) fail('The section has no introduction: say in two to four sentences what the release is.');
  if (opening.bullets.length > 0) fail('Bullets come under a heading, not before the first one.');

  const order = parts.slice(1).map((part) => HEADINGS.indexOf(part.heading));
  parts.slice(1).forEach((part, i) => {
    if (order[i] < 0) fail(`"## ${part.heading}" is not one of the headings: ${HEADINGS.join(', ')}.`);
    else if (i > 0 && order[i] <= order[i - 1]) fail(`"## ${part.heading}" is repeated or out of order.`);
    const { bullets } = part;
    const limit =
      part.heading === "What's new"
        ? LIMITS.whatsNewBullet
        : part.heading === 'Deprecated' || part.heading === 'Removed'
          ? LIMITS.noticeBullet
          : LIMITS.alsoBullet;
    if (part.heading === "What's new" && bullets.length > LIMITS.whatsNewBullets) {
      fail(`"What's new" has ${bullets.length} bullets; the limit is ${LIMITS.whatsNewBullets}. Move the smaller ones to "Also in this release".`);
    }
    for (const { text, size } of bullets) {
      total += size;
      if (part.heading !== 'Tests and provenance' && size > limit) {
        fail(`${size} words, limit ${limit}, under "${part.heading}": ${text.slice(2, 62)}…`);
      }
      if (part.heading !== 'Tests and provenance' && !BOLD_CLAIM.test(text)) {
        fail(`A bullet under "${part.heading}" does not open with its claim in bold: ${text.slice(2, 62)}…`);
      }
    }
    const prose = count(part.prose);
    total += prose;
    if (part.heading === 'Tests and provenance' && prose + count(bullets) > LIMITS.tests) {
      fail(`"Tests and provenance" is ${prose + count(bullets)} words; the limit is ${LIMITS.tests}.`);
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
