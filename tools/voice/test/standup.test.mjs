// The spoken standup — the outbound half of the voice lane, and the ways it could
// quietly lie to him.
//
// The inbound half already exists (`scripts/ideas-file`, `reminders-to-ideas`, the
// `session-inbox` skill). This is the other direction: one plain-text file a voice
// session reads aloud, derived from the Navigator sweep rather than hand-written.
//
// Every test here is a way the file could be WRONG while looking right, because that
// is the only failure that matters for something read out loud — he cannot see the
// page, so a confident sentence about a stale queue is indistinguishable from a
// confident sentence about a live one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  awaitingDecisions,
  composeStandup,
  fleetCounts,
  leakScan,
  rankRows,
  rcRows,
  said,
  spokenRelease,
  stallVerdict,
  standupSection,
  unclip,
} from '../lib/standup.mjs';
import { clipSpoken, summarise } from '../standup.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const NOW = new Date('2026-08-24T20:50:00');

/** A navigator-state file with the sections this reads, plus the ones it must ignore. */
function stateMd({ swept = '2026-08-24 20:44' } = {}) {
  return `# navigator-state — 🧭🤖 Navigator RC-review sweep

Sole writer: \`obot.agent tools/navigator/sweep.mjs\`. **Stale rule: 3× the cadence.**

swept: ${swept} · cadence 5m · ok — 7 repos, 4 RCs

config ledger: ledger clean - 23 id(s) allocated, 23 present in /Users/someone/Documents/obot2/.claude/blockers.md

## Stalled at a prompt — sessions nobody can reach

stalls: clear — no background session in this workspace is parked on a permission prompt (2 watched)

## Carve-out routing — a PR only he can merge, in the bucket for it

already routed: 2 pull request(s) covered by an open config item — obot.agent#198 · c0016 · obot.agent#273 · c0023

## Claim currency — what has been re-checked, and when

config: 9 open · 0 done · 4 still outstanding · 5 unchecked · newest reading just now
  still outstanding, measured: c0002, c0003, c0013, c0024

## Ranked head — the next ten, in order (rank declared, everything else derived)

10 ranked · rank last touched 2026-08-21 (3d old) · membership from \`top10\`

  1. #164 open · 2026q3 · blocked · 1/1 sub-issues · "gsm.safety v1.2.0 — safety.viz v1.6.0 widget parity + parity guard" — the R package still wraps the library from three releases ago
  2. #274 open · 2026q3 · 5/8 sub-issues · "SafetyCensus stays and is rebuilt on metrics and reports" — he answered all six questions
  4. #153 open · 2026q3 · blocked · 1/1 sub-issues · "demo-301's scheduled pipeline has failed silently since 2026-08-03" — three consecutive weekly runs have failed

## RC queue — open PRs awaiting or holding @jwildfire review

- **gsm.safety#68** "gsm.safety v1.2.0-RC1" → \`main\` · no review yet · 2 comments · https://github.com/jwildfire/gsm.safety/pull/68 [verified gh 20:44]
- **obot.agent#273** "Register the spend-cap hook — the last lane the nightly cap does not cover" → \`main\` · no review yet · 0 comments · https://github.com/jwildfire/obot.agent/pull/273 [verified gh 20:44]
`;
}

const parsed = (opts) => stateMd(opts);

const RC_ROWS = [
  { repo: 'jwildfire/gsm.safety', number: 68, title: 'gsm.safety v1.2.0-RC1', summary: 'Carries the July chart library into the R package.', isPublic: true },
  { repo: 'jwildfire/obot.agent', number: 273, title: 'Register the spend-cap hook — the last lane the nightly cap does not cover', summary: null, isPublic: true },
];

const DECISION_ROWS = [
  { id: 'D0025', title: 'Putting safetyCharts and safetyGraphics back on CRAN', state: 'open', questions: 3, discussion: 301, episode: { exists: true, current: true, minutes: 5.9 } },
  { id: 'D0028', title: 'The widget that has to carry two tables', state: 'open', questions: 4, discussion: null, episode: { exists: false, current: false, minutes: null } },
  { id: 'D0019', title: 'Scheduled sessions: what is ready, what is not', state: 'partially decided', questions: 5, discussion: 289, episode: { exists: true, current: false, minutes: 5.9 } },
];

/** Everything green, so a test can change one thing and see only that thing move. */
function input(over = {}) {
  const md = over.md ?? parsed();
  return {
    now: NOW,
    md,
    fleet: { read: true, working: 2, total: 7, needsInput: 0, why: '' },
    rcs: { read: true, why: '', rows: RC_ROWS },
    decisions: { read: true, why: '', behind: 0, rows: DECISION_ROWS },
    ...over,
  };
}

// ---------------------------------------------------------------- age and cadence

test('THE FILE STATES ITS OWN AGE AND THE LOOP CADENCE — the pathway is poll-based and he cannot see the clock', () => {
  const out = composeStandup(input());
  assert.match(out, /every five minutes/i, 'the cadence has to be in the words, not implied by a timestamp');
  assert.match(out, /20:44|8:44/, 'the reading it was derived from has to be datable');
  assert.match(out, /round trip|comes back|next pass/i, 'poll-based means an answer is not instant, and he needs that said');
});

test('A DEAD SWEEP DOES NOT READ AS TODAY — three cadences old and the file refuses to present the queue as current', () => {
  const out = composeStandup(input({ md: stateMd({ swept: '2026-08-24 18:00' }) }));
  assert.match(out, /out of date|not current|stopped/i, 'a stale reading must say so in the first thing he hears');
  assert.doesNotMatch(out.split(/^## /m)[0], /^Two agent sessions are working/m);
  // And the alarm is at the top, not buried under four sections of yesterday.
  const firstSection = out.indexOf('## ');
  assert.ok(/out of date|not current|stopped/i.test(out.slice(0, firstSection)), 'the warning is above the content it invalidates');
});

test('A SWEEP THAT NEVER RAN IS NOT A QUIET NIGHT', () => {
  const out = composeStandup(input({ md: '# navigator-state\n\nnothing here\n' }));
  assert.match(out, /has not run|could not|no reading/i);
});

// ------------------------------------------------------------------- the public rule

test('NO CONFIG ITEM TEXT AND NO CONFIG COUNT — the hub is public and a count identifies an item when there are few', () => {
  const out = composeStandup(input());
  assert.doesNotMatch(out, /\bc\d{4}\b/, 'a config id must never cross');
  assert.doesNotMatch(out, /blockers\.md/);
  assert.doesNotMatch(out, /9 open|still outstanding/);
  assert.doesNotMatch(out, /\/Users\//, 'a local path names his machine');
  assert.equal(leakScan(out).length, 0);
});

test('THE GAP IS STATED, NOT LEFT AS AN ABSENCE — a silent omission reads as a complete picture', () => {
  const out = composeStandup(input());
  assert.match(out, /## What this standup does not cover/);
  assert.match(out, /config/i, 'the bucket that is missing has to be named as missing');
  assert.match(out, /public/i, 'and why it is missing, so it does not read as an oversight');
});

test('THE GAP SENTENCE IS UNCONDITIONAL — a clean night is exactly when a missing bucket goes unnoticed', () => {
  const quiet = composeStandup(input({
    rcs: { read: true, why: '', rows: [] },
    decisions: { read: true, why: '', behind: 0, rows: [] },
  }));
  assert.match(quiet, /## What this standup does not cover/);
  assert.match(quiet, /config/i);
});

test('leakScan REFUSES a composed file that carries anything local', () => {
  assert.ok(leakScan('nothing here').length === 0);
  assert.ok(leakScan('item c0016 is yours').length > 0, 'a config id');
  assert.ok(leakScan('listen at spotify:episode:6qNG2vErd1JLxkOLtc3Nub').length > 0, 'a private-library uri');
  assert.ok(leakScan('see /Users/jwildfire/Documents/obot2/.claude/blockers.md').length > 0, 'a local path');
  assert.ok(leakScan('private: do not tell anyone').length > 0, 'the marker that means keep this off the hub');
});

// ------------------------------------------------------------------------ decisions

test('PARTIALLY DECIDED IS NEITHER OPEN NOR DECIDED — reporting it as either is wrong in both directions', () => {
  const out = composeStandup(input());
  assert.match(out, /partly decided|partially decided/i);
  const line = out.split('\n').find((l) => /Scheduled sessions/.test(l));
  assert.ok(line, 'the partial decision is listed at all');
  assert.match(line, /part/i, 'and its line says which of the three states it is in');
});

test('EVERY AWAITING DECISION IS LISTED — he asked for this part to be exhaustive, not illustrative', () => {
  const out = composeStandup(input());
  for (const d of DECISION_ROWS) assert.ok(out.includes(d.title), `${d.id} is missing from the standup`);
  assert.match(out, /three|3/, 'and the count is said, so a truncation is audible');
});

test('WHERE TO ANSWER IT — a decision with a thread names it, and one without says so rather than inventing one', () => {
  const out = composeStandup(input());
  assert.match(out, /discussion 301/i);
  const widget = out.split('\n').find((l) => /widget that has to carry two tables/.test(l));
  assert.match(widget, /no thread|on the page|not been opened/i);
});

test('AN EPISODE HE COULD LISTEN TO IS OFFERED, AND ITS ABSENCE IS SAID PLAINLY', () => {
  const out = composeStandup(input());
  assert.match(out, /6 minute|six minute/i, 'the length is what decides whether he presses play');
  const widget = out.split('\n').find((l) => /widget that has to carry two tables/.test(l));
  assert.match(widget, /no episode/i, 'the gap is real and he should hear it here, not discover it in the car');
});

test('A STALE EPISODE IS NOT OFFERED AS CURRENT — the page changed after it shipped', () => {
  const out = composeStandup(input());
  const line = out.split('\n').find((l) => /Scheduled sessions/.test(l));
  assert.doesNotMatch(line, /listen/i);
  assert.match(line, /out of date|no longer matches|older than/i);
});

test('NO SPOTIFY URI EVER CROSSES — the show is private to his account and the hub is public', () => {
  const out = composeStandup(input({
    decisions: {
      read: true, why: '', behind: 0,
      rows: [{ id: 'D0025', title: 'CRAN', state: 'open', questions: 3, discussion: 301, episode: { exists: true, current: true, minutes: 5.9, uri: 'spotify:episode:6qNG2vErd1JLxkOLtc3Nub' } }],
    },
  }));
  assert.doesNotMatch(out, /spotify/i);
  assert.equal(leakScan(out).length, 0);
});

test('A REGISTRY THAT COULD NOT BE READ IS NOT AN EMPTY QUEUE', () => {
  const out = composeStandup(input({ decisions: { read: false, why: 'the registry could not be read', behind: null, rows: [] } }));
  assert.match(out, /could not|cannot say/i);
  assert.doesNotMatch(out, /nothing is waiting on you/i);
});

test('A HUB CLONE BEHIND ITS REMOTE SAYS SO — a decision published since the last fetch is invisible, not absent', () => {
  const out = composeStandup(input({ decisions: { read: true, why: '', behind: 4, rows: DECISION_ROWS } }));
  assert.match(out, /behind/i);
});

// ------------------------------------------------------------- release candidates

test('A RELEASE CANDIDATE IS NAMED BY WHAT IT DOES, NOT BY ITS VERSION NUMBER', () => {
  const out = composeStandup(input());
  assert.match(out, /Carries the July chart library into the R package/);
  assert.doesNotMatch(out, /gsm\.safety#68/, 'a bare identifier is not a name he can hear');
});

test('spokenRelease turns a version string into something a person would say', () => {
  assert.equal(spokenRelease('gsm.safety v1.2.0-RC1'), 'gsm.safety, version 1.2.0, release candidate 1');
  assert.equal(spokenRelease('Register the spend-cap hook'), 'Register the spend-cap hook');
});

test('A PRIVATE REPOSITORY IS COUNTED BUT NOT QUOTED — its title has never been public', () => {
  const out = composeStandup(input({
    rcs: { read: true, why: '', rows: [{ repo: 'jwildfire/chart-foundry-builder', number: 3, title: 'secret thing', summary: 'a secret summary', isPublic: false }] },
  }));
  assert.doesNotMatch(out, /secret/);
  assert.match(out, /private repository/i);
});

test('NO URLS ANYWHERE — a URL read out loud is noise, and every address here has a name instead', () => {
  const out = composeStandup(input());
  assert.doesNotMatch(out, /https?:\/\//);
});

// ------------------------------------------------------------------------- running

test('AN UNREADABLE FLEET IS NOT AN IDLE ONE', () => {
  const out = composeStandup(input({ fleet: { read: false, why: 'no job records on this machine', working: null, total: null, needsInput: null } }));
  assert.match(out, /cannot see|could not/i);
  assert.doesNotMatch(out, /nothing is running/i);
});

test('WHAT IS RUNNING AND WHAT IS STUCK ARE DIFFERENT QUESTIONS, AND BOTH ARE ANSWERED', () => {
  const out = composeStandup(input());
  assert.match(out, /two (agent )?sessions/i);
  assert.match(out, /prompt/i, 'a session parked on a permission prompt is the one nobody can reach');
});

test('BLOCKED WORK IS NAMED — and it is the ranked items GitHub itself labels blocked', () => {
  const out = composeStandup(input());
  assert.match(out, /## What is blocked/);
  assert.match(out, /widget parity/i);
  assert.match(out, /scheduled pipeline/i);
});

// ----------------------------------------------------------------- inbound lane

test('THE INBOUND LANE IS DOCUMENTED HERE, AND ITS PUBLICNESS IS NOT SOFT-PEDALLED', () => {
  const out = composeStandup(input());
  assert.match(out, /Ideas/);
  assert.match(out, /public/i, 'anything dictated into that board is public the moment it posts');
});

// ------------------------------------------------------------------- the parsers

test('rcRows reads the RC queue the sweep already verified against GitHub', () => {
  const rows = rcRows(parsed());
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { repo: 'jwildfire/gsm.safety', number: 68, title: 'gsm.safety v1.2.0-RC1' });
});

test('rankRows keeps the rank, the issue and whether GitHub labels it blocked', () => {
  const rows = rankRows(parsed());
  assert.equal(rows.length, 3);
  assert.equal(rows[0].issue, 164);
  assert.equal(rows[0].blocked, true);
  assert.equal(rows[1].blocked, false);
  assert.match(rows[0].title, /widget parity/);
});

test('stallVerdict is clear or it is not, and an unreadable section is neither', () => {
  assert.equal(stallVerdict(parsed()).clear, true);
  assert.equal(stallVerdict('# x\n').read, false);
});

test('said turns a small count into a word, because a standup is heard', () => {
  assert.equal(said(0), 'no');
  assert.equal(said(1), 'one');
  assert.equal(said(7), 'seven');
  assert.equal(said(23), '23');
});

// -------------------------------------------------------------------- collectors

test('fleetCounts reads the job records and reports an unreadable directory as unreadable', () => {
  const dir = tmp('standup-jobs-');
  const job = (id, state, at) => {
    fs.mkdirSync(path.join(dir, id), { recursive: true });
    fs.writeFileSync(path.join(dir, id, 'state.json'), JSON.stringify({ state, updatedAt: at }));
  };
  job('a', 'working', '2026-08-24T20:40:00Z');
  job('b', 'done', '2026-08-24T20:40:00Z');
  job('c', 'working', '2026-08-01T10:00:00Z'); // long dead, must not be counted as live
  const r = fleetCounts(dir, { now: new Date('2026-08-24T20:50:00Z') });
  assert.equal(r.read, true);
  assert.equal(r.working, 1);
  assert.equal(fleetCounts(path.join(dir, 'nope'), { now: NOW }).read, false);
});

test('awaitingDecisions takes open AND partially decided, and drops the ones he has settled', () => {
  const hub = tmp('standup-hub-');
  fs.mkdirSync(path.join(hub, 'reports', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(hub, 'reports', 'decisions', 'registry.json'), JSON.stringify({
    prefix: 'D',
    artifacts: [
      { id: 'D0025', slug: '2026-08-20-cran-resubmission', title: 'CRAN', state: 'open', questions: [{}, {}, {}] },
      { id: 'D0019', slug: '2026-08-16-scheduled-sessions-assessment', title: 'Scheduled sessions', state: 'partially decided', questions: [{}] },
      { id: 'D0021', slug: '2026-08-17-safetycensus-stay-or-go', title: 'Census', state: 'decided', questions: [{}] },
      { id: 'D0002', slug: '2026-08-14-app-plan-rewrite', title: 'App plan', state: 'closed', questions: [{}] },
    ],
  }));
  fs.writeFileSync(path.join(hub, 'reports', 'decisions', 'README.md'), [
    '## Index', '',
    '| Decision | Date | Goal | Discussion | Status |',
    '|---|---|---|---|---|',
    '| [CRAN](2026-08-20-cran-resubmission/) | 2026-08-20 | [#73](https://github.com/x/y/issues/73) | [#301](https://github.com/jwildfire/obot.roadmap/discussions/301) | **Awaiting** |',
    '| [Scheduled sessions](2026-08-16-scheduled-sessions-assessment/) | 2026-08-16 | [#73](https://github.com/x/y/issues/73) | DISCUSSION_PLACEHOLDER | **Partially decided** |',
    '',
  ].join('\n'));

  const r = awaitingDecisions(hub);
  assert.equal(r.read, true);
  assert.deepEqual(r.rows.map((x) => x.id), ['D0025', 'D0019']);
  assert.equal(r.rows[0].discussion, 301);
  assert.equal(r.rows[1].discussion, null, 'a placeholder is not a thread number');
  assert.equal(r.rows[0].questions, 3);
});

test('awaitingDecisions reports an unreadable registry as unread rather than as everything decided', () => {
  const r = awaitingDecisions(tmp('standup-nohub-'));
  assert.equal(r.read, false);
  assert.equal(r.rows.length, 0);
});

// ------------------------------------------- read aloud, where the bugs actually were

test('A CLIPPED TITLE IS REPAIRED, NOT READ OUT MID-WORD', () => {
  // What navigator-state.md really carries: seventy characters and an ellipsis.
  assert.equal(unclip("demo-301's scheduled pipeline has failed silently since 2026-08-03 — a…"),
    "demo-301's scheduled pipeline has failed silently since 2026-08-03");
  assert.equal(unclip('a whole title'), 'a whole title', 'an unclipped title is left exactly alone');
});

test('THE ARTICLE AGREES WITH THE WORD HE HEARS — "a eight minute episode" is the sound of a template', () => {
  const one = (minutes) => composeStandup(input({
    decisions: { read: true, why: '', behind: 0, rows: [{ id: 'D0025', title: 'CRAN', state: 'open', questions: 1, discussion: 301, episode: { exists: true, current: true, minutes } }] },
  }));
  assert.match(one(8), /an eight minute episode/);
  assert.match(one(6), /a six minute episode/);
  assert.doesNotMatch(one(8), /a an|a a /);
});

test('A FULL TITLE FROM GITHUB WINS OVER THE ONE THE SWEEP CLIPPED', () => {
  const out = composeStandup(input({ titles: { 153: 'demo-301 pipeline has failed silently for three weeks' } }));
  assert.match(out, /failed silently for three weeks/);
});

test('clipSpoken cuts at a clause, never mid-word', () => {
  const long = 'gsm.safety corrects a baseline it was counting as a peak; it also adds the hepatic waterfall and the KDIGO nephrotoxicity view, which are the two charts the review board asked for last quarter.';
  const cut = clipSpoken(long, 120);
  assert.ok(cut.length <= 121, cut);
  assert.doesNotMatch(cut, /…/);
  assert.ok(cut.endsWith('.'));
  assert.doesNotMatch(cut, /nephrotoxici\./, 'a word must not be cut in half');
  assert.equal(clipSpoken('short enough', 120), 'short enough');
});

test('summarise takes the sentence that says what the release does, not the scaffolding', () => {
  const body = [
    '## Executive summary', '',
    'This PR was drafted by Claude Code using Opus 5', '',
    'Closes #164', '',
    'The safety overview death count was wrong, and this release replaces it. More detail follows.', '',
  ].join('\n');
  assert.equal(summarise(body), 'The safety overview death count was wrong, and this release replaces it.');
  assert.equal(summarise('## only a heading'), null);
});

// ----------------------------------------------- the lane reporting on its own health

test('A PUBLISHER THAT STOPPED IS AN ALARM, NOT A SILENCE — a stale standup reads as fluently as a live one', async () => {
  const { ALARM_RE } = await import('../../ops-dashboard/lib/navigator.mjs');
  const now = new Date('2026-08-24T21:00:00Z');
  const fresh = standupSection({ outcome: 'published', at: '2026-08-24T20:58:00Z' }, { now });
  assert.doesNotMatch(fresh, ALARM_RE);
  assert.match(fresh, /published 2 minute/);

  const stopped = standupSection({ outcome: 'published', at: '2026-08-24T19:00:00Z' }, { now });
  assert.match(stopped, ALARM_RE, 'the headline must match the regex the renderer really uses');
  assert.match(stopped, /stopped/);

  const failed = standupSection({ outcome: 'failed', at: '2026-08-24T20:58:00Z', detail: 'no app token' }, { now });
  assert.match(failed, ALARM_RE);
  assert.match(failed, /no app token/);

  const unread = standupSection({ read: false, why: 'not json' }, { now });
  assert.match(unread, ALARM_RE);
});

test('A LANE THAT HAS NEVER RUN IS NOT A BROKEN ONE', async () => {
  const { ALARM_RE } = await import('../../ops-dashboard/lib/navigator.mjs');
  const s = standupSection(null, { now: new Date() });
  assert.doesNotMatch(s, ALARM_RE);
  assert.match(s, /nothing has been published/);
});

test('the verdict is an unindented plain line, which is the only thing the page renders red', () => {
  const line = standupSection({ outcome: 'failed', at: new Date().toISOString() }, {})
    .split('\n').find((l) => /BROKEN/.test(l));
  assert.ok(line && !/^[\s-]/.test(line), 'an indented or bulleted verdict can never go red');
});

test('BOTH sweep call sites pass the standup section, and the publisher runs AFTER the file it reads', async () => {
  const src = await fs.promises.readFile(new URL('../../navigator/sweep.mjs', import.meta.url), 'utf8');
  const calls = src.split('renderState({').slice(2);
  assert.equal(calls.length, 2, 'if a third call site appears, it needs the section too');
  for (const [i, call] of calls.entries()) {
    assert.match(call.split('\n')[0], /standup:\s*standupSection\(readStandupStatus\(\)/,
      `call site ${i + 1} must pass the standup section`);
  }
  // Order is the honesty property: the standup is derived from the state file, so
  // publishing before it is written publishes the PREVIOUS pass's reading under this
  // pass's timestamp.
  const write = src.lastIndexOf('writeFileSync(STATE_MD');
  const publish = src.indexOf('runStandup()', write);
  assert.ok(publish > write, 'the publisher must run after the state file is written');
});
