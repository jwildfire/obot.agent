// The sweep's sections, and the briefing, on a machine with no history.
//
// Requirement: jwildfire/obot.roadmap#223, task jwildfire/obot.agent#306. Worker W0105.
//
// #159 covered the dashboard routes and the session hub. What it did not reach is
// everything that WRITES what those routes render, and everything an agent reads
// before a page is involved at all — which on the first morning of the new machine is
// most of what gets read. Each case below was rehearsed rather than reasoned about:
// a scratch `HOME`, an empty workspace, fresh clones with no fetched remotes, `gh`
// unauthenticated. Reading the code to decide what it would do is exactly how the
// original defect survived hundreds of passing local runs.
//
// THE BAR, the same one the requirement sets: a surface saying "no readings yet" is
// correct. A plausible zero, an empty list that reads as a clean result, or a verdict
// over a source nobody opened is the defect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ALARM_RE } from '../../ops-dashboard/lib/navigator.mjs';
import { carveoutSection } from '../carveout.mjs';
import { admiralSection } from '../admiral.mjs';
import { localSection } from '../localwatch.mjs';
import { unroutedSection } from '../../voice/lib/route.mjs';
import { adjacentWorkers } from '../../lib/dispatch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.join(HERE, '..', '..');

/** A workspace nobody has worked in: no `.claude/` at all. */
const freshWs = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-sweep-'));

/** A CLI run with `HOME` and the workspace both pointed at nothing. */
function run(bin, args, ws) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-home-'));
  const r = spawnSync(path.join(TOOLS, bin), args, {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, OBOT_WORKSPACE: ws, OBOT_JOBS_DIR: path.join(home, '.claude', 'jobs') },
  });
  return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`, status: r.status };
}

// ------------------------------------------------- the briefing every worker opens

test('the sibling briefing does not report an empty fleet from a ledger it never opened', () => {
  // `.claude/workers.journal` is local-only and no clone brings it, so this is the
  // state on the new laptop. "Nobody else is in flight right now" is the sentence a
  // worker uses to decide whether to check for overlap before building something
  // twice — and it was being printed off an absent file.
  const { out } = run('constraint-log', ['brief', '--worker', 'W0001', '--scope', 'hub#223'], freshWs());
  assert.doesNotMatch(out, /Nobody else is in flight/,
    'a verdict on who else is working, from a file that is not on this machine');
  assert.match(out, /no worker ledger on this machine/i);
  assert.match(out, /worker-id init/, 'the notice has to say what would fill it');
  // The constraints half was already honest and must stay that way.
  assert.match(out, /No constraint has been recorded on this machine yet/);
});

// --------------------------------------------------------- the sweep's own sections

test('an absent worker ledger reaches the dispatch reading as absence, not as zero', () => {
  const a = adjacentWorkers({ ws: freshWs(), jobs: path.join(freshWs(), 'nojobs'), now: new Date() });
  assert.equal(a.read, true, 'ENOENT is a successful reading of "not there"');
  assert.equal(a.absent, true);
  assert.deepEqual(a.workers, []);
});

test('carve-out routing does not clear a lane it could not list', () => {
  // On a machine where `gh` is not yet authenticated every lane fails, and the section
  // headlined "nothing to route — 0 lane(s) checked, none forced the attested lane on
  // a carve-out path". The `unread:` lines were underneath, which is where a
  // summariser stops reading.
  const md = carveoutSection({ checked: 0, errors: ['jwildfire/obot.agent: gh auth login', 'jwildfire/obot.roadmap: gh auth login'] });
  assert.doesNotMatch(md, /nothing to route/,
    'a clean verdict over two lanes nobody could open');
  assert.match(md, /no lane could be listed/i);
  assert.match(md, /unknown, not/i);
});

test('carve-out routing still says nothing to route when the lanes WERE read', () => {
  const md = carveoutSection({ checked: 4 });
  assert.match(md, /nothing to route — 4 lane\(s\) checked/);
  assert.doesNotMatch(md, ALARM_RE, 'a clean lane check is a reading, not a finding');
});

// --------------------------------------------------------------------- the admiral

test('the admiral does not clear a pull-request lane it could not list', () => {
  // On the new machine `gh` is not authenticated on the first morning, every lane
  // fails, and this section headlined "nothing to act on — no session past the bar, no
  // idle operational PR, no unrecorded closeout" with the `unread:` reasons below it.
  // Two of those three clauses are about things nobody looked at.
  const md = admiralSection({
    trigger: { fired: false, conditions: [], sessions: [], pulls: [], gaps: [], routed: [],
               unread: ['jwildfire/obot.agent: gh auth login', 'jwildfire/obot.roadmap: gh auth login'] },
  });
  assert.doesNotMatch(md, /no idle operational PR/, 'a verdict on lanes nobody could list');
  assert.match(md, /could not be listed/i);
  assert.match(md, /unknown, not/i);
});

test('the admiral still reports a genuinely quiet fleet as quiet', () => {
  const md = admiralSection({ trigger: { fired: false, conditions: [], sessions: [], pulls: [], gaps: [], routed: [], unread: [] } });
  assert.match(md, /nothing to act on — no session past the bar, no idle operational PR, no unrecorded closeout/);
  assert.doesNotMatch(md, ALARM_RE, 'a quiet fleet is a reading, not a finding');
});

// ------------------------------------------------------------- the local-only work

test('a partial reading of the local work is not a clean one', () => {
  // Both lines were on the page at once on the empty machine: the alarm saying
  // "Nothing below is a clean bill of health", and directly under it "local-only work:
  // clean — nothing stranded". That is the dashboard's old "All answered" beside
  // "Decisions unavailable", one section down.
  const md = localSection({ worktrees: [], clones: [], fetchedAt: null, fetchFailed: [], claimants: null }, Date.now());
  const alarm = md.split('\n').find((l) => ALARM_RE.test(l));
  assert.ok(alarm, 'the partial reading has to be an alarm at all');
  assert.doesNotMatch(md, /local-only work: clean/,
    'a clean verdict directly under its own "nothing below is a clean bill of health"');
});

// ---------------------------------------------------------------------- the voice

test('a voice store that was never written is not a lane where every sentence landed', () => {
  // Both lines were on the empty machine at once: "the car lane is NOT ARMED on this
  // machine" and, directly under it, "none unrouted — every sentence dictated into the
  // lane reached a decision or was an idea". Nothing has ever been dictated here.
  const md = unroutedSection([], { now: new Date(), read: true, absent: true, lane: { armed: false } });
  assert.doesNotMatch(md, /every sentence dictated into the lane reached a decision/,
    'a positive claim about sentences nobody has said on this machine');
  assert.match(md, /nothing has been dictated into this lane on this machine/i);
  assert.doesNotMatch(md, ALARM_RE, 'a lane nobody has used yet is not a fault');
});

test('an armed lane with a store that was read still reports none unrouted', () => {
  const md = unroutedSection([], { now: new Date(), read: true, absent: false, lane: { armed: true, read: true, routed: 0 } });
  assert.match(md, /none unrouted/);
});
