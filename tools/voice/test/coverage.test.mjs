// The assertions a review found missing — each one closing a gap where the behaviour
// could have been deleted outright and the suite would have stayed green.
//
// The review of jwildfire/obot.agent#279 checked this the honest way: it removed the
// body of a function and re-ran. `verdictFrom` could be emptied and 64 tests passed.
// That is the seam problem of obot.agent#229 in a different shape — a thing every test
// routes around is covered by none of them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { recordAnswer } from '../../ops-dashboard/lib/answers.mjs';
import { parseNavigatorState } from '../../ops-dashboard/lib/navigator.mjs';
import { readArtifact, verdictFrom } from '../lib/artifact.mjs';
import { buildQueue } from '../lib/handles.mjs';
import { LIST, RECEIPT_DONE, RECEIPT_HELD, isReceipt } from '../lib/reminders.mjs';
import { matchSpoken } from '../lib/match.mjs';
import { unroutedSection } from '../lib/route.mjs';
import { queueScript } from '../lib/speech.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const NOW = new Date('2026-08-20T14:00:00Z');

const OPTIONS = [
  { label: 'Option A — recommended', letter: 'A', qualifier: 'recommended', headline: 'Lock what can be locked' },
  { label: 'Option B — stricter', letter: 'B', qualifier: 'stricter', headline: 'And the demo site too' },
  { label: 'Option C — minimal', letter: 'C', qualifier: 'minimal', headline: 'Refuse force-pushes only' },
];

test('verdictFrom names the option he said, by letter and by the word the episode used', () => {
  assert.equal(verdictFrom('option A', OPTIONS), 'Option A');
  assert.equal(verdictFrom('option b please', OPTIONS), 'Option B');
  assert.equal(verdictFrom('the minimal one', OPTIONS), 'Option C');
  assert.equal(verdictFrom('go with the recommended one', OPTIONS), 'Option A');
});

test('verdictFrom invents nothing — no options, no letter, or two at once is null', () => {
  assert.equal(verdictFrom('option A', []), null, 'a page with no options cannot have an Option A');
  assert.equal(verdictFrom('do whatever you think', OPTIONS), null);
  assert.equal(verdictFrom('option D', OPTIONS), null, 'a letter the page does not have is not a verdict');
  assert.equal(verdictFrom('the minimal one, or maybe the stricter one', OPTIONS), null,
    'two options named is his prose, not a decision to record');
  assert.equal(verdictFrom('', OPTIONS), null);
});

test('an artifact with no options section yields none, and says it could be read', () => {
  const dir = tmp('cov-hub-');
  fs.mkdirSync(path.join(dir, 'reports', 'decisions', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'reports', 'decisions', 'x', 'index.html'),
    '<html><body><div class="q"><div class="qid">H1</div><h3>Q?</h3><div class="rec"><b>Recommended:</b> wait.</div></div></body></html>');
  const a = readArtifact(dir, 'x');
  assert.equal(a.read, true);
  assert.equal(a.options.length, 0);
  assert.equal(a.recommendations.length, 1);
  assert.equal(a.recommendations[0].code, 'H1');
});

test('the channel default is dashboard, and it is asserted rather than assumed', () => {
  // Every record written before the field existed came from the page; the default is
  // the true answer for all of them, and nothing tested that it was the default.
  const ws = tmp('cov-ws-');
  const { record } = recordAnswer(ws, { artifact: 'a-slug', words: 'some words' }, { hub: null, now: NOW });
  assert.equal(record.channel, 'dashboard');
});

test('and a channel given is the channel kept, without changing what makes an answer the same answer', () => {
  const ws = tmp('cov-ws-');
  const a = recordAnswer(ws, { artifact: 'a-slug', words: 'w', channel: 'voice (dictated)' }, { hub: null, now: NOW });
  assert.equal(a.record.channel, 'voice (dictated)');
  // Same words through the other door is the same answer, clicked twice — the channel
  // is deliberately not part of the fingerprint.
  const b = recordAnswer(ws, { artifact: 'a-slug', words: 'w', channel: 'dashboard' }, { hub: null, now: NOW });
  assert.equal(b.duplicate, true);
  assert.equal(b.record.id, a.record.id);
});

test('the list Siri writes to is named in exactly one place, and it is that name', () => {
  assert.equal(LIST, 'obot');
});

test('a receipt is recognised by the marks this lane actually writes', () => {
  assert.equal(isReceipt(`${RECEIPT_DONE} branch protections - recorded`), true);
  assert.equal(isReceipt(`${RECEIPT_HELD} could not route: something`), true);
  assert.equal(isReceipt('branch protections, option A'), false);
});

test("the alarm reaches the page: parseNavigatorState marks the voice verdict, not just ALARM_RE", () => {
  // Matching the regex is not enough — the parser alarm-tests preamble notes and
  // unindented plain lines and nothing else, so a row that matched could still render
  // grey (obot.agent#223, hub#241).
  const md = `# navigator-state\n\n${unroutedSection([], { now: NOW, lane: { armed: true, read: false, why: 'osascript refused' } })}`;
  const parsed = parseNavigatorState(md);
  const section = parsed.sections.find((s) => /Voice answers/.test(s.title));
  assert.ok(section, 'the section is found by its heading');
  assert.ok(section.items.some((i) => i.alarm), 'and at least one line in it is an alarm the page will paint');
});

test('a clean voice section carries no alarm through the parser either', () => {
  const md = `# navigator-state\n\n${unroutedSection([], { now: NOW, lane: { armed: true, read: true, routed: 0 } })}`;
  const section = parseNavigatorState(md).sections.find((s) => /Voice answers/.test(s.title));
  assert.equal(section.items.some((i) => i.alarm), false);
});

test('the 72-hour bar on an ordinal is real: a queue older than it stops resolving positions', () => {
  const stale = {
    at: '2026-08-15T12:00:00.000Z',
    fingerprint: 'fp',
    decisions: [{ id: 'D1', slug: 's', handle: 'one thing', words: ['one', 'thing'], ordinal: 1, collidesWith: [] }],
  };
  const r = matchSpoken('number one, yes', stale, { currentFingerprint: 'fp', now: NOW });
  assert.equal(r.kind, 'ambiguous');
  assert.match(r.reason, /hours old|bar/i);
});

test('the homophone warning is conditional — it does not fire on a queue that has none', () => {
  const dir = tmp('cov-hub2-');
  fs.mkdirSync(path.join(dir, 'reports', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'reports', 'decisions', 'registry.json'), JSON.stringify({
    artifacts: [
      { id: 'D1', slug: '2026-08-01-branch-protections', state: 'open', title: 'a', questions: [] },
      { id: 'D2', slug: '2026-08-02-census-metric', state: 'open', title: 'b', questions: [] },
    ],
  }));
  const s = queueScript(buildQueue(dir, { now: NOW }), { hub: dir });
  assert.doesNotMatch(s.text, /sound alike/i);
});

test('the choice the episode offers is a choice that decision actually has', () => {
  const dir = tmp('cov-hub3-');
  const slug = '2026-08-01-with-options';
  fs.mkdirSync(path.join(dir, 'reports', 'decisions', slug), { recursive: true });
  fs.writeFileSync(path.join(dir, 'reports', 'decisions', slug, 'index.html'),
    `<html><body><section id="options">
     <div class="card done"><div class="tag">Option A — recommended</div><h3>Do the thing</h3></div>
     <div class="card"><div class="tag">Option B — minimal</div><h3>Do less</h3></div>
     </section></body></html>`);
  fs.writeFileSync(path.join(dir, 'reports', 'decisions', 'registry.json'), JSON.stringify({
    artifacts: [{ id: 'D1', slug, state: 'open', title: 'With options', questions: [] }],
  }));
  const s = queueScript(buildQueue(dir, { now: NOW }), { hub: dir });
  const art = readArtifact(dir, slug);
  const verdict = verdictFrom(s.items[0].exampleChoice, art.options);
  assert.ok(verdict, 'the example he is told to say must resolve to a real option');
  assert.equal(verdict, 'Option A', 'and to the recommended one');
});

test('THE DEFAULT IS THE WIRING, not just the function: listPending reaches osascript unless told otherwise', async () => {
  // The existing test proves `osascriptRunner` works. It does not prove anything USES
  // it — every other test passes its own `run`, so the default parameter is a seam
  // every test routes around (obot.agent#229). This calls listPending with no runner at
  // all and requires it to have actually tried, by pointing it at a list that cannot
  // exist and demanding the real refusal.
  const { listPending } = await import('../lib/reminders.mjs');
  const r = listPending({ list: 'obot-no-such-list-3f9a2c' });
  assert.equal(r.read, false, 'a list that does not exist is a failed read, whatever the platform');
  if (process.platform === 'darwin') {
    assert.match(r.why, /no Reminders list/i, 'on macOS it reached Reminders and Reminders said no');
  } else {
    assert.ok(r.why, 'off macOS it reports why it could not even try');
  }
  assert.equal(r.items.length, 0);
});
