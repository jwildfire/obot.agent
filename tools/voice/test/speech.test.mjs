// The episode's closing instructions, and the one property that makes the whole lane
// work: the words it tells him to say are the words the router recognises.
//
// jwildfire/obot.roadmap#265: "The subject words come from the episodes themselves.
// Whatever the scripts tell him to say IS the vocabulary — inventing a parallel list
// is the two-sources-of-truth defect that cost ten decisions their state this week."
//
// The round-trip test below is that sentence as an assertion: take the example the
// script reads out, hand it to the router unchanged, and require it to land on the
// decision the script was talking about.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildQueue } from '../lib/handles.mjs';
import { routeSpoken } from '../lib/route.mjs';
import { WORDS_PER_MINUTE, decisionScript, queueScript } from '../lib/speech.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const NOW = new Date('2026-08-20T14:00:00Z');

const OPTIONS_HTML = `<!doctype html><html><head><meta name="decision-id" content="D0022"></head><body>
<section id="options">
<div class="card done"><div class="tag">Option A — recommended</div>
<h3>Lock what can be locked for free, guard the rest</h3><p>Ten branches get the rule.</p></div>
<div class="card"><div class="tag">Option B — stricter</div>
<h3>Option A, and the demo site publishes through a pull request too</h3><p>More.</p></div>
<div class="card"><div class="tag">Option C — minimal</div>
<h3>Only refuse force-pushes and deletions, everywhere</h3><p>Less.</p></div>
</section>
<section id="questions"><div class="q" id="P1"><div class="qid">P1</div>
<h3>Which set of protections gets applied?</h3>
<div class="rec"><b>Recommendation: Option A.</b> It closes the hole.</div></div></section>
</body></html>`;

const NO_OPTIONS_HTML = `<!doctype html><html><body><section id="questions">
<div class="q"><div class="qid">H1</div><h3>Does the lane wait for a machine that does not sleep?</h3>
<div class="rec"><b>Recommended:</b> wait for the machine.</div></div>
<div class="q"><div class="qid">H2</div><h3>Where does the overnight detection live?</h3>
<div class="rec"><b>Recommended:</b> off the machine.</div></div>
</section></body></html>`;

function hub({ options = true, second = true } = {}) {
  const dir = tmp('speech-hub-');
  const artifacts = [
    {
      id: 'D0022', slug: '2026-08-20-branch-protections', date: '2026-08-20', state: 'open',
      title: 'Branch protections: what gets locked down before the clock starts',
      questions: [{ id: 'D0022.1', code: 'P1', question: 'Which set of branch protections is applied?' }],
    },
  ];
  if (second) {
    artifacts.push({
      id: 'D0019', slug: '2026-08-16-scheduled-sessions-assessment', date: '2026-08-16', state: 'open',
      title: 'Scheduled sessions: what is ready and what is not',
      questions: [{ id: 'D0019.1', code: 'H1', question: 'Does the lane wait for a machine that does not sleep?' }],
    });
  }
  fs.mkdirSync(path.join(dir, 'reports', 'decisions', '2026-08-20-branch-protections'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'reports', 'decisions', '2026-08-20-branch-protections', 'index.html'),
    options ? OPTIONS_HTML : NO_OPTIONS_HTML);
  if (second) {
    fs.mkdirSync(path.join(dir, 'reports', 'decisions', '2026-08-16-scheduled-sessions-assessment'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'reports', 'decisions', '2026-08-16-scheduled-sessions-assessment', 'index.html'),
      NO_OPTIONS_HTML);
  }
  fs.writeFileSync(path.join(dir, 'reports', 'decisions', 'registry.json'), JSON.stringify({ prefix: 'D', artifacts }));
  return dir;
}

test('NO IDENTIFIERS: nothing he would have to remember reaches the script', () => {
  const h = hub();
  const s = queueScript(buildQueue(h, { now: NOW }), { hub: h });
  assert.doesNotMatch(s.text, /D00\d\d/, 'no decision ids');
  assert.doesNotMatch(s.text, /#\d+/, 'no issue numbers');
  assert.doesNotMatch(s.text, /https?:\/\//, 'no URLs — there is no screen');
  assert.doesNotMatch(s.text, /\b20\d\d-\d\d-\d\d\b/, 'no slugs or ISO dates');
  assert.doesNotMatch(s.text, /[*_#`]/, 'no markdown — this goes to a speech synthesiser');
});

test('ROUND TRIP: the sentence the script tells him to say routes to that decision', () => {
  const h = hub();
  const q = buildQueue(h, { now: NOW });
  const s = queueScript(q, { hub: h });
  const ws = tmp('speech-ws-');
  for (const item of s.items) {
    const r = routeSpoken(item.example, { workspace: ws, hub: h, queue: q, now: NOW });
    assert.equal(r.kind, 'answer', `the example for "${item.handle}" must route: ${item.example}`);
    assert.equal(r.decision.id, item.id, `and it must route to the decision it was read out for`);
  }
});

test('ROUND TRIP: the ordinal it offers resolves to the same decision as the handle', () => {
  const h = hub();
  const q = buildQueue(h, { now: NOW });
  const s = queueScript(q, { hub: h });
  const ws = tmp('speech-ws-');
  const first = s.items[0];
  const r = routeSpoken(`number ${first.ordinal}, ${first.exampleChoice}`, { workspace: ws, hub: h, queue: q, now: NOW });
  assert.equal(r.kind, 'answer');
  assert.equal(r.decision.id, first.id);
});

test('the close tells him exactly what to say, in the shape he asked for', () => {
  const h = hub();
  const s = queueScript(buildQueue(h, { now: NOW }), { hub: h });
  assert.match(s.close, /say/i);
  assert.match(s.close, /branch protections/);
  assert.ok(s.text.trimEnd().endsWith(s.close.trimEnd()), 'and it is the last thing he hears');
});

test('option cards are read out as choices he can say back', () => {
  const h = hub();
  const d = buildQueue(h, { now: NOW }).decisions.find((x) => x.id === 'D0022');
  const s = decisionScript(d, { hub: h });
  assert.match(s.text, /option A/i);
  assert.match(s.text, /recommended/i);
  assert.equal(s.optionsRead, 3);
});

test('a decision with no option cards degrades to its recommendations, and says which it did', () => {
  const h = hub({ options: false });
  const d = buildQueue(h, { now: NOW }).decisions.find((x) => x.id === 'D0022');
  const s = decisionScript(d, { hub: h });
  assert.equal(s.optionsRead, 0);
  assert.equal(s.shape, 'recommendations', 'twenty-one of twenty-two pages have no option cards');
  assert.match(s.text, /wait for the machine|recommend/i);
  assert.match(s.exampleChoice, /yes|no|recommend/i, 'and the example is answerable without options');
});

test('an artifact that cannot be read says so instead of reading out an empty decision', () => {
  const h = hub();
  const d = { id: 'D0099', slug: '2026-08-20-not-here', handle: 'not here', words: ['not', 'here'], ordinal: 1, questions: [], collidesWith: [] };
  const s = decisionScript(d, { hub: h });
  assert.equal(s.read, false);
  assert.match(s.text, /could not be read/i);
});

test('a queue with nothing in it is a script that says so, not an empty file', () => {
  const h = tmp('speech-empty-');
  fs.mkdirSync(path.join(h, 'reports', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(h, 'reports', 'decisions', 'registry.json'), JSON.stringify({ artifacts: [] }));
  const s = queueScript(buildQueue(h, { now: NOW }), { hub: h });
  assert.equal(s.items.length, 0);
  assert.match(s.text, /nothing|no open/i);
});

test('two handles that sound alike are said to be alike, out loud', () => {
  const h = tmp('speech-collide-');
  fs.mkdirSync(path.join(h, 'reports', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(h, 'reports', 'decisions', 'registry.json'), JSON.stringify({
    artifacts: [
      { id: 'D0022', slug: '2026-08-20-branch-protections', state: 'open', title: 'a', questions: [] },
      { id: 'D0024', slug: '2026-08-21-branch-protection', state: 'open', title: 'b', questions: [] },
    ],
  }));
  const s = queueScript(buildQueue(h, { now: NOW }), { hub: h });
  assert.match(s.text, /sound alike|sounds the same|say the number/i);
});

test('the script reports its own length against the five minutes he asked for', () => {
  const h = hub();
  const s = queueScript(buildQueue(h, { now: NOW }), { hub: h });
  assert.equal(typeof s.words, 'number');
  assert.ok(s.words > 20);
  assert.equal(s.minutes, Math.round((s.words / WORDS_PER_MINUTE) * 10) / 10);
  assert.equal(typeof s.overRuns, 'boolean');
});
