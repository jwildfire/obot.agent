// A session wearing a role's name from another workspace is not that role, and the
// pinned band must not say it is (obot.agent#188).
//
// THE ROW. Running `node --test scripts/test/obot-admiral.test.mjs` twice on the
// evening of 2026-08-17 left four genuine `claude --bg -n '⚓🤖 obot-admiral'`
// sessions in the machine's real job ledger, each running `/s-admiral` against a
// brief inside its own `mkdtemp` workspace. The Agents tab reads that ledger, the
// roster groups sessions by NAME, and the pinned band takes the first row a role
// produces — so one fixture claimed the admiral's slot and rendered RUNNING, with a
// task of "stuck on a startup dialog", on a quiet evening when no admiral existed.
//
// That band is the one surface that answers "what is each of my roles doing" without
// qualification, and @jwildfire reads it on a phone. A band that says a role is
// running when nothing is costs the band its credibility — the same class as a queue
// showing nine items when four are not real. It is not wrong loudly; it is wrong
// quietly, which is worse.
//
// WHAT IS HELD HERE. Not a name and not a temp-directory prefix — the next fixture
// will have different ones, and this population already had two of each. What is
// held is the structural fact: a session belongs to the workspace it RAN in, and a
// role's row belongs to sessions of that workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ADMIRAL_NAME } from '../../navigator/admiral.mjs';
import { buildRoster } from '../lib/roster.mjs';
import { kindOf, standingRoleOf } from '../lib/roster-view.mjs';
import { pinnedByDefault } from '../lib/pins.mjs';
import { agentsTableHtml, tableRows } from '../lib/roster-table.mjs';

const NOW = new Date('2026-08-18T01:30:00Z');
const WS = '/Users/jwildfire/Documents/obot2';
const TEMP = '/private/var/folders/_9/_l3b4x016gjbd376c37kpp580000gn/T/fleetws-skwFFQ';

const workers = { epoch: '2026-08-14T12:00:00Z', claims: [] };

const job = (o = {}) => ({
  job: 'j', name: ADMIRAL_NAME, state: 'working', detail: 'stuck on a startup dialog',
  needs: 'open this session to continue setup', tokens: 0,
  startedAt: '2026-08-18T01:26:31Z', updatedAt: '2026-08-18T01:27:16Z',
  model: 'opus', firstTerminalAt: null, timeline: null, cwd: WS, ...o,
});

const model = (jobs) => buildRoster({ workers, jobs, delivery: [], now: NOW, workspace: WS });
const rowFor = (m, pred) => m.rows.find(pred);

test('a fixture session never becomes the role, however it is named', () => {
  const m = model([job({ job: '1cc6cc32', cwd: TEMP })]);
  const r = rowFor(m, (x) => x.label === ADMIRAL_NAME);
  assert.ok(r, 'it is still on the page — a dropped row is a different lie');
  assert.equal(standingRoleOf(r), null, 'it is not the admiral');
  assert.equal(pinnedByDefault(r), false, 'so it cannot be pinned as one');
  assert.notEqual(kindOf(r), 'standing');
});

test('and the real one still is', () => {
  const m = model([job({ job: 'aaaa1111', cwd: WS })]);
  const r = rowFor(m, (x) => x.label === ADMIRAL_NAME);
  assert.equal(standingRoleOf(r)?.short, 'admiral');
  assert.equal(pinnedByDefault(r), true);
  assert.equal(kindOf(r), 'standing');
});

test('a session inside a repo inside the workspace is still the role', () => {
  // Roles are launched at the workspace root, but a worktree or a repo directory is
  // inside it and a rule that demanded an exact match would break the first time one
  // was launched from anywhere sensible.
  const m = model([job({ job: 'bbbb2222', cwd: `${WS}/obot.agent` })]);
  assert.equal(standingRoleOf(rowFor(m, (x) => x.label === ADMIRAL_NAME))?.short, 'admiral');
});

test('the real role and a fixture wearing its name are TWO rows, never one', () => {
  // The failure this actually caused. Rows are grouped by session name, so a fixture
  // and the real role collapsed into one row — and the row took its status from the
  // newest session, which is how a fixture's "working" became the admiral's status.
  const m = model([
    job({ job: 'aaaa1111', cwd: WS, state: 'done', startedAt: '2026-08-18T00:10:00Z', updatedAt: '2026-08-18T00:20:00Z', firstTerminalAt: '2026-08-18T00:20:00Z' }),
    job({ job: '1cc6cc32', cwd: TEMP }),
  ]);
  const rows = m.rows.filter((r) => r.label === ADMIRAL_NAME);
  assert.equal(rows.length, 2, 'one row for the role, one for whatever else wore its name');
  const role = rows.find((r) => standingRoleOf(r));
  const fixture = rows.find((r) => !standingRoleOf(r));
  assert.ok(role && fixture);
  assert.equal(role.sessions, 1, 'the role row counts only its own sessions');
  assert.equal(fixture.sessions, 1);
});

test('the pinned band shows the role, not the fixture', () => {
  // End to end, through the markup he actually reads. Scoped to the pinned tbody
  // itself rather than to everything before the rest of the table — the sidebar sits
  // above it and carries a filter option for every status the roster holds, so a
  // looser slice can match "not running" without a row saying it.
  const m = model([job({ job: '1cc6cc32', cwd: TEMP })]);
  const html = agentsTableHtml(m, { now: NOW });
  const band = html.split('data-sec="pinned"')[1].split('data-sec="rest"')[0];
  assert.doesNotMatch(band, /stuck on a startup dialog/,
    'the fixture\'s line must not appear in the band');
  // And the admiral still owes him a row. Removing the fixture from the band without
  // this leaves a GAP, which cannot say whether the role is resting or broken — the
  // failure `restingRow` exists to prevent, reintroduced by the fix for the row that
  // caused it. The fixture satisfied the "is this role present" check by name.
  assert.match(band, /not running/);
  assert.match(band, /it launches when a condition fires and exits/);
});

test('the fixture row says where it ran, so the demotion is not a silent one', () => {
  const m = model([job({ job: '1cc6cc32', cwd: TEMP })]);
  const html = agentsTableHtml(m, { now: NOW });
  assert.match(html, /fleetws-skwFFQ/, 'the page names the directory it ran in');
  assert.match(html, /outside this workspace/);
});

test('with no workspace given, nothing changes — this is a guard, not a filter', () => {
  // Every existing caller that does not name a workspace keeps the behaviour it had.
  // A guard that quietly changed those would be a second failure wearing the fix.
  const m = buildRoster({ workers, jobs: [job({ job: '1cc6cc32', cwd: TEMP })], delivery: [], now: NOW });
  const r = rowFor(m, (x) => x.label === ADMIRAL_NAME);
  assert.equal(standingRoleOf(r)?.short, 'admiral');
});

test('a job record with no cwd is trusted, because an absent role row reads as health', () => {
  const m = model([job({ job: 'cccc3333', cwd: null })]);
  assert.equal(standingRoleOf(rowFor(m, (x) => x.label === ADMIRAL_NAME))?.short, 'admiral');
});

test('the fixture is a row in the table, with its status told straight', () => {
  const m = model([job({ job: '1cc6cc32', cwd: TEMP })]);
  const { rows } = tableRows(m, { now: NOW });
  const r = rows.find((x) => x.row.label === ADMIRAL_NAME && !standingRoleOf(x.row));
  assert.ok(r, 'it is listed');
  assert.equal(r.row.status.status, 'running', 'it IS running — it is just not the admiral');
});
