import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSections, findSection, parseItems, findSessionMarker } from '../lib/scratchpad.mjs';

const FIXTURE = `# Session notes — 2026-07-11

## Overview
<!-- session-init 2026-07-11 session #2 (bg job ce8f336e) -->

### Agent-actionable
- [x] 1. safety.viz v1.0 wrap — DONE except tag: see [PR #23](https://github.com/jwildfire/safety.viz/pull/23)
- [ ] 4. Riding along — triage hub #24
  continuation line folds in

### Waiting on @jwildfire
- [ ] 6. Review + approve the obot.agent stack

## Notes
- 19:05 — Jeremy wants to migrate demo data
- plain untimed note

## Session log — something else
- not a tracked section
`;

test('splitSections finds title and headings', () => {
  const p = splitSections(FIXTURE);
  assert.equal(p.title, 'Session notes — 2026-07-11');
  assert.deepEqual(p.sections.map((s) => s.heading), [
    'Overview', 'Notes', 'Session log — something else',
  ]);
});

test('findSection matches by prefix, case-insensitive', () => {
  const p = splitSections(FIXTURE);
  assert.ok(findSection(p, 'overview'));
  assert.ok(findSection(p, 'Session log'));
  assert.equal(findSection(p, 'Scaffold'), null);
});

test('parseItems: groups, checkboxes, continuation, prose passthrough', () => {
  const p = splitSections(FIXTURE);
  const groups = parseItems(findSection(p, 'Overview'));
  const named = groups.filter((g) => g.group);
  assert.deepEqual(named.map((g) => g.group), ['Agent-actionable', 'Waiting on @jwildfire']);
  const [aa] = named;
  assert.equal(aa.items[0].checked, true);
  assert.equal(aa.items[1].checked, false);
  assert.match(aa.items[1].text, /continuation line folds in$/);
});

test('parseItems: leading "N." moves into item.num', () => {
  const p = splitSections(FIXTURE);
  const named = parseItems(findSection(p, 'Overview')).filter((g) => g.group);
  assert.equal(named[0].items[0].num, 1);
  assert.match(named[0].items[0].text, /^safety\.viz v1\.0 wrap/);
  assert.equal(named[0].items[1].num, 4);
  assert.equal(named[1].items[0].num, 6);
});

test('parseItems: timestamped and plain notes', () => {
  const p = splitSections(FIXTURE);
  const [g] = parseItems(findSection(p, 'Notes'));
  assert.equal(g.items[0].time, '19:05');
  assert.match(g.items[0].text, /^Jeremy wants/);
  assert.equal(g.items[1].time, null);
  assert.equal(g.items[1].checked, null);
});

test('parseItems never throws on junk and drops nothing', () => {
  const junk = { heading: 'X', lines: ['\t', '::weird::', '   indented orphan', '- [q] bad box'] };
  const [g] = parseItems(junk);
  const texts = g.items.map((i) => i.text).join('|');
  assert.match(texts, /::weird::/);
  assert.match(texts, /\[q\] bad box/);
});

test('findSessionMarker: newest marker wins, extracts number + job', () => {
  const md = `<!-- session-init 2026-07-11 (bg job 08c20082) -->\n${FIXTURE}`;
  const m = findSessionMarker(md);
  assert.equal(m.sessionNumber, 2);
  assert.equal(m.jobId, 'ce8f336e');
});

test('findSessionMarker: absent → null; no job → jobId null', () => {
  assert.equal(findSessionMarker('# nothing'), null);
  const m = findSessionMarker('<!-- session-init 2026-07-11 session #3 -->');
  assert.equal(m.sessionNumber, 3);
  assert.equal(m.jobId, null);
});

test('findSessionMarker: canonical shape extracts date, time, number, job', () => {
  const m = findSessionMarker('<!-- session-init 2026-07-11 21:34 session #2 (job ce8f336e) -->');
  assert.equal(m.date, '2026-07-11');
  assert.equal(m.time, '21:34');
  assert.equal(m.sessionNumber, 2);
  assert.equal(m.jobId, 'ce8f336e');
});
