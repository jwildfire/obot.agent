// Pinning on the Agents tab (jwildfire/obot.agent#169, requirement
// jwildfire/obot.roadmap#227).
//
// Three failures these tests exist to hold shut, all of them named in the issue:
//
//   1. The default set is hardcoded to three names, so a fourth standing role
//      appears unpinned until someone remembers — and a long-lived worker drifts
//      into the pinned set because it looks important.
//   2. Unpinning a default does not stick: the next render puts it back, and the
//      only thing the click achieved was to teach him the control is decorative.
//   3. A pinned role that DIED stops being shown. That is the worst of the three,
//      because the absence reads as health — the page looks the same whether the
//      concierge is answering or has been dead for six hours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { STANDING_ROLES, kindOf } from '../lib/roster-view.mjs';
import {
  emptyPins, isPinned, labelIsPinned, pinKey, pinState, pinnedByDefault, readPins, writePin,
} from '../lib/pins.mjs';
import { buildRoster } from '../lib/roster.mjs';
import { agentsTableHtml, restingRows, tableRows } from '../lib/roster-table.mjs';

const NOW = new Date('2026-08-17T10:00:00Z');

const impact = (o = {}) => ({
  moved: [], closed: [], mentioned: [], verdicts: [], empty: true, summary: 'none', ...o,
});

const row = (o = {}) => ({
  id: null, idText: 'no worker id', label: 'agent', slug: '', task: '',
  claimedAt: null, startedAt: null, lastAt: null, days: [], sessions: 1, tokens: 0,
  status: { status: 'finished', note: 'closed out' },
  cost: { value: 1, code: 'priced', short: '$1.00', text: '$1.00', calls: 1, sub: null, span: null, days: [] },
  impact: impact(), subs: [], ...o,
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pins-'));

// ---- the principle, not the three names -----------------------------------

test('every standing role in the registry is pinned by default', () => {
  // The test is written over the REGISTRY rather than over prime, nav and the
  // admiral by name: a fourth standing role added to the registry has to arrive
  // pinned without anyone editing this file or the pin code.
  assert.ok(STANDING_ROLES.length >= 3, 'the registry should hold the standing roles');
  for (const r of STANDING_ROLES) {
    const agent = row({ label: `${r.tag} obot-${r.short}` });
    assert.equal(kindOf(agent), 'standing', `${r.short} should classify as a standing role`);
    assert.equal(pinnedByDefault(agent), true, `${r.short} should be pinned by default`);
  }
});

test('the pin code names no role: the default follows what an agent IS', () => {
  // The guard against the fix that works today and rots tomorrow. If a tag or a
  // session name is ever written into pins.mjs, the default set stops being derived
  // and starts being a list — which is the thing the issue asked not to build.
  const src = fs.readFileSync(new URL('../lib/pins.mjs', import.meta.url), 'utf8');
  for (const r of STANDING_ROLES) {
    assert.ok(!src.includes(r.tag), `pins.mjs must not name ${r.short}'s tag`);
    assert.ok(!src.includes(r.name), `pins.mjs must not name ${r.short}'s session`);
  }
});

test('the admiral role stays in step with the launcher that spawns it', async () => {
  // The registry declares the admiral's tag; `tools/navigator/admiral.mjs` declares
  // the same tag for the session it launches (obot.agent#167). Two declarations of
  // one fact can half-land — a rename in one place and not the other makes the
  // admiral render as a probe and quietly stop being pinned, which is a silent no-op
  // rather than a failure.
  //
  // HARDENED IN THE RENAME (obot.agent#182), because the rename is the exact event
  // this guard exists to catch and the guard would have slept through it. It used to
  // swallow an import failure with `catch { return }` and compare each field only
  // `if` the export was truthy — so renaming ADMIRAL_TAG away, or breaking the
  // module outright, produced a passing test and an unpinned admiral. A guard that
  // cannot fail is not a guard. The module is not optional any more: if it will not
  // import, that is the finding.
  const admiral = await import('../../navigator/admiral.mjs');
  const role = STANDING_ROLES.find((r) => r.short === 'admiral');
  assert.ok(role, 'the registry should carry the admiral');
  assert.ok(admiral.ADMIRAL_TAG, 'admiral.mjs should export ADMIRAL_TAG');
  assert.ok(admiral.ADMIRAL_NAME, 'admiral.mjs should export ADMIRAL_NAME');
  assert.equal(role.tag, admiral.ADMIRAL_TAG);
  assert.equal(role.name, admiral.ADMIRAL_NAME);
});

test('the three standing roles are the ones he named: prime, admiral and nav', () => {
  // @jwildfire, 2026-08-17: "I think we should call the fleet manager the admiral.
  // prime, admiral and nav." The short forms are what he says out loud and what the
  // dashboard prints, so they are asserted rather than left to drift back into
  // "the Navigator" and "the fleet manager" the next time someone edits the registry.
  assert.deepEqual(STANDING_ROLES.map((r) => r.short).sort(), ['admiral', 'nav', 'prime']);
});

test('a resting line fits the Task cell that renders it', () => {
  // `resting` is rendered as the Task cell for a pinned role with no session, so a
  // long one is clipped with an ellipsis on the Agents tab rather than wrapping.
  // The admiral's line was 101 characters when it was written for the fleet manager
  // and would have shipped clipped the day that column landed; it is 88 now. This
  // holds the next one under the limit without anyone having to know the limit.
  for (const r of STANDING_ROLES) {
    assert.ok(r.resting.length < 100, `${r.short}'s resting line is ${r.resting.length} chars, over the 100 the Task cell fits`);
  }
});

test('a long-lived worker never drifts into the pinned set', () => {
  // Age and cost are not roles. A worker that has run for a month, spent the most
  // money and moved four requirements is still judged on what it delivered, and it
  // is still not a standing role.
  const veteran = row({
    id: 'W0001', label: '👯🤖 W0001 2026-07-18 longhaul', days: ['2026-07-18', '2026-08-17'],
    cost: { value: 400, code: 'priced', short: '$400.00', text: '$400.00', calls: 9, sub: null, span: null, days: [] },
    impact: impact({ moved: [{ ref: 'hub#227', verb: 'moved', url: null }], empty: false }),
  });
  assert.equal(kindOf(veteran), 'worker');
  assert.equal(pinnedByDefault(veteran), false);
  assert.equal(isPinned(veteran, emptyPins()), false);
});

test('a pin is recorded against the ROLE, so it survives a session being renamed', () => {
  const [role] = STANDING_ROLES;
  const first = row({ label: `${role.tag} obot-${role.short}` });
  const renamed = row({ label: `${role.tag} obot-${role.short} 2` });
  assert.equal(pinKey(first), pinKey(renamed));
  // A worker is pinned by its id, which is the identity that never gets reused.
  assert.equal(pinKey(row({ id: 'W0042', label: '👯🤖 W0042 2026-08-17 slug' })), 'W0042');
});

// ---- his preference state -------------------------------------------------

test('unpinning a default sticks, and pinning a worker sticks', () => {
  const ws = tmp();
  const [role] = STANDING_ROLES;
  const standing = row({ label: `${role.tag} obot-${role.short}` });
  const worker = row({ id: 'W0042', label: '👯🤖 W0042 2026-08-17 slug' });

  assert.equal(isPinned(standing, readPins(ws)), true, 'default before he touches anything');

  writePin(ws, { key: pinKey(standing), pinned: false });
  writePin(ws, { key: pinKey(worker), pinned: true });

  // Re-read from disk, which is what the next render does.
  const pins = readPins(ws);
  assert.equal(isPinned(standing, pins), false, 'an unpinned default must not revert');
  assert.equal(isPinned(worker, pins), true);
  assert.equal(pinState(standing, pins).byDefault, true, 'still a default — he has overridden it, not changed what it is');
  assert.equal(pinState(standing, pins).explicit, true);

  // And it goes back to following the default when he clears the override.
  writePin(ws, { key: pinKey(standing), pinned: null });
  assert.equal(isPinned(standing, readPins(ws)), true);
});

test('pins never publish: the file is in the local ops store and carries the sentinel', () => {
  const ws = tmp();
  writePin(ws, { key: 'W0042', pinned: true });
  const file = path.join(ws, '.claude', 'ops', 'pins.json');
  assert.ok(fs.existsSync(file), 'pins live under .claude/ops, beside the answers and the cache');
  assert.match(fs.readFileSync(file, 'utf8'), /never publish/);
});

test('an unreadable or absent pins file is no pins, never a crash', () => {
  const ws = tmp();
  assert.deepEqual(readPins(ws).overrides, {});
  fs.mkdirSync(path.join(ws, '.claude', 'ops'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.claude', 'ops', 'pins.json'), '{ not json');
  assert.deepEqual(readPins(ws).overrides, {});
});

// ---- the case that will be got wrong --------------------------------------

const job = (o = {}) => ({
  job: 'j', name: '👯🤖 W0001 2026-08-17 slug', state: 'done',
  startedAt: '2026-08-17T08:00:00Z', updatedAt: '2026-08-17T09:00:00Z',
  timeline: { last: 'done', closed: true, at: '2026-08-17T09:00:00Z' }, ...o,
});

// Ended before it closed out — a death, and a death never ages out of the roster.
const deadJob = (name, day) => job({
  name, state: 'stopped', startedAt: `${day}T02:00:00Z`, updatedAt: `${day}T02:10:00Z`,
  timeline: { last: 'stopped', closed: false, at: `${day}T02:10:00Z` },
});

test('a pinned standing role that died is still in the roster when the death cap has filled', () => {
  // The cap on deaths is right — an unbounded list of every corpse pushes today off
  // the top of a phone screen — but it must never eat a pinned row. A pin that drops
  // its subject on death is worse than no pin: the absence reads as health.
  const [role] = STANDING_ROLES;
  const deadRole = `${role.tag} obot-${role.short}`;
  // Ten corpses with no worker id, which is the population the death cap bounds,
  // and the pinned role's own corpse arriving after all of them — so it lands in the
  // tail the cap throws away unless the pin protects it.
  const jobs = [
    ...Array.from({ length: 10 }, (_, i) => deadJob(`😺🤖 2026-08-14 dead${i}`, '2026-08-14')),
    deadJob(deadRole, '2026-08-14'),
  ];
  const workers = { epoch: '2026-08-16T00:00:00Z', claims: [] };

  const without = buildRoster({ workers, jobs, now: NOW });
  const kept = (m) => m.rows.some((r) => r.label === deadRole);
  // Whatever the unpinned model does with it, the pinned model keeps it. (The cap
  // takes the tail, so the assertion below is the one that matters either way.)
  const pins = { overrides: {} };
  const with_ = buildRoster({
    workers, jobs, now: NOW, pinned: (name) => labelIsPinned(name, pins),
  });
  assert.equal(kept(with_), true, 'the dead standing role must survive the cap');
  assert.equal(with_.rows.find((r) => r.label === deadRole).status.status, 'died',
    'and it must show that it died, not merely appear');
  // Sanity: the fixture really does overflow the cap, so the test is measuring
  // something. `without` is only read to prove the pressure exists.
  assert.ok(without.droppedDeaths > 0, 'the fixture should overflow the death cap');
});

test('a pinned role whose session ended cleanly before the ledger epoch still gets a row', () => {
  const [role] = STANDING_ROLES;
  const name = `${role.tag} obot-${role.short}`;
  const jobs = [job({
    name, startedAt: '2026-08-10T08:00:00Z', updatedAt: '2026-08-10T09:00:00Z',
    timeline: { last: 'done', closed: true, at: '2026-08-10T09:00:00Z' },
  })];
  const workers = { epoch: '2026-08-16T00:00:00Z', claims: [] };
  const pins = { overrides: {} };

  assert.equal(buildRoster({ workers, jobs, now: NOW }).rows.some((r) => r.label === name), false,
    'unpinned, an old finished session is out of scope — that is the existing rule');
  assert.equal(
    buildRoster({ workers, jobs, now: NOW, pinned: (n) => labelIsPinned(n, pins) }).rows.some((r) => r.label === name),
    true, 'pinned, it is in scope: "always tell me about this one" includes when it stopped',
  );
});

test('a pinned role that has never run at all renders a resting row rather than nothing', () => {
  // The fleet manager is short-lived by design (obot.agent#167): it launches when a
  // condition fires and exits. So its usual state is absent, and an absent pinned
  // role must say "not running" rather than leave a gap — a quiet system must not
  // look like a broken one, and an empty slot cannot say which it is.
  const rows = restingRows([], emptyPins());
  assert.equal(rows.length, STANDING_ROLES.length);
  for (const r of rows) {
    assert.equal(r.resting, true);
    assert.equal(r.cost.value, null, 'a role that never ran has no cost — and it is not $0.00');
    assert.ok(r.status.note, 'it says why it is not there');
  }
  // A role that HAS a row is not doubled by a resting one.
  const [role] = STANDING_ROLES;
  const live = row({ label: `${role.tag} obot-${role.short}`, status: { status: 'running', note: 'answering' } });
  const some = restingRows([live], emptyPins());
  assert.equal(some.length, STANDING_ROLES.length - 1);
  // And an explicitly unpinned role gets no resting row: the unpin has to mean it.
  const unpinned = { overrides: { [pinKey(row({ label: `${role.tag} x` }))]: false } };
  assert.equal(restingRows([], unpinned).length, STANDING_ROLES.length - 1);
});

// ---- the table ------------------------------------------------------------

const model = (rows, o = {}) => ({
  rows, sources: null, droppedDeaths: 0, unattributed: null,
  usage: { missing: false, stale: false, note: '' }, epochDay: '2026-08-16', ...o,
});

test('pinned rows are painted first, whatever they cost', () => {
  const [role] = STANDING_ROLES;
  const cheap = row({ label: `${role.tag} obot-${role.short}`, status: { status: 'running', note: 'answering' },
    cost: { value: 2, code: 'priced', short: '$2.00', text: '$2.00', calls: 1, sub: null, span: null, days: [] } });
  const dear = row({ id: 'W0009', label: '👯🤖 W0009 2026-08-17 spendy',
    cost: { value: 90, code: 'priced', short: '$90.00', text: '$90.00', calls: 1, sub: null, span: null, days: [] } });
  const html = agentsTableHtml(model([dear, cheap]), { now: NOW, pins: emptyPins() });

  const pinnedAt = html.indexOf('data-pinned="yes"');
  const spendyAt = html.indexOf('W0009');
  assert.ok(pinnedAt !== -1, 'a pinned row is marked');
  assert.ok(pinnedAt < spendyAt, 'the pinned block comes before the most expensive agent');
  assert.match(html, /class="at-sec"/, 'and it is a section, not just a reordering');
  assert.match(html, /class="at-pin"/, 'every row carries the control');
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /aria-pressed="false"/, 'the unpinned rows offer the same control');
});

test('the pin control does not open the evidence row', () => {
  // The row is a button that toggles its evidence, and its handler early-returned
  // only on a link. A pin click that also expands the row is a control that appears
  // to do two things at once.
  const html = agentsTableHtml(model([row({ id: 'W0009', label: '👯🤖 W0009 2026-08-17 s' })]), { now: NOW, pins: emptyPins() });
  assert.match(html, /closest\('a, button'\)/, 'the row handler must ignore clicks on a control');
  assert.match(html, /\/pin/, 'and the click has somewhere to persist to');
});

test('a dead pinned role is in the pinned section, showing that it died', () => {
  const [role] = STANDING_ROLES;
  const dead = row({
    label: `${role.tag} obot-${role.short}`,
    status: { status: 'died', note: 'the session ended without a closeout' },
  });
  const html = agentsTableHtml(model([dead]), { now: NOW, pins: emptyPins() });
  const from = html.indexOf('data-sec="pinned"');
  const to = html.indexOf('data-sec="rest"');
  const sec = html.slice(from, to === -1 ? undefined : to);
  assert.match(sec, /died/, 'the pinned section shows the status, not a tidy placeholder');
  assert.match(html, /data-tone="bad"/);
});

test('tableRows leaves the model rows alone — the partition is the table\'s job', () => {
  // The seam agreed with the created-column work: the comparator in tableRows stays
  // one function, and pinning partitions what it returns.
  const [role] = STANDING_ROLES;
  const { rows } = tableRows(model([row({ label: `${role.tag} obot-${role.short}` }), row({ id: 'W0009', label: 'x' })]), { now: NOW });
  assert.equal(rows.length, 2);
});
