// The third pass on the Operations Dashboard: config items as installation
// qualifications, triage on anything in the list, and a critical tag that has to
// be earned. @jwildfire, 2026-08-15 — obot.agent#122.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { parseIQ, iqComplete, verifyPlan, AUTO_VERIFY_HEADS, runVerify } from '../lib/iq.mjs';
import { triage, readTriage, triageState, applyTriage, fingerprint, wakeText } from '../lib/triage.mjs';
import { rankQueue, CRITICAL_BUDGET, criticalClaim } from '../lib/rank.mjs';
import { collectConfig } from '../lib/collect.mjs';
import { render } from '../lib/render.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opsiq-'));

// A real entry in the shape this pass introduces: five required fields, an exact
// action, what he should see, and a command that proves it.
const IQ_ENTRY = `- [ ] c0001 · filed 2026-08-15 · verified 2026-08-16 — **Let agents log without a permission prompt**
  Do: open \`/w/.claude/settings.json\` and add these lines inside \`permissions\` → \`allow\`:
      "Bash(bash /w/obot.agent/tools/scratchpad-log *)",
      "Bash(bash /w/obot.agent/tools/blocker-log *)"
  Expect: the allow array carries both lines and the file still parses as JSON.
  Verify: grep -c "tools/scratchpad-log" /w/.claude/settings.json → prints 1 or more
  Unblocks: every session logs its heartbeat with one cheap command.
  Source: obot.agent#91
`;

test('an IQ entry parses into the steps, the expected result, and the proof', () => {
  const iq = parseIQ(IQ_ENTRY);
  assert.equal(iq.title, 'Let agents log without a permission prompt');
  assert.equal(iq.id, 'c0001');
  assert.ok(iq.do.text.startsWith('open `/w/.claude/settings.json`'));
  // The indented lines are the thing he pastes — they survive as code, not prose.
  assert.deepEqual(iq.do.code, [
    '"Bash(bash /w/obot.agent/tools/scratchpad-log *)",',
    '"Bash(bash /w/obot.agent/tools/blocker-log *)"',
  ]);
  assert.match(iq.expect.text, /parses as JSON/);
  assert.equal(iq.verify.command, 'grep -c "tools/scratchpad-log" /w/.claude/settings.json');
  assert.equal(iq.verify.expect, 'prints 1 or more');
  assert.match(iq.unblocks.text, /heartbeat/);
  assert.equal(iq.source.text, 'obot.agent#91');
  // A field the entry does not have must stay absent, or the panel renders an
  // empty labelled block for it.
  assert.equal(iq.blocks, null);
  assert.deepEqual(iq.blockRefs, []);
  assert.equal(iq.why, null);
});

test('a Blocks field stays readable text as well as machine-readable refs', () => {
  const iq = parseIQ(`- [ ] c0001 — **x**
  Do: a
  Expect: b
  Verify: test -f /tmp/x → it exists
  Source: s
  Blocks: jwildfire/obot.roadmap#182 (verified open 2026-08-16), hub#9 (unverified)
`);
  assert.match(iq.blocks.text, /obot\.roadmap#182/, 'he reads the field');
  assert.equal(iq.blockRefs.length, 2);
  assert.equal(iq.blockRefs[0].verified, true);
  assert.equal(iq.blockRefs[1].verified, false);
});

test('an IQ is complete only with an action, an expected result and a proof', () => {
  assert.equal(iqComplete(parseIQ(IQ_ENTRY)).ok, true);

  // The old shape — a fix and a source, nothing to check afterwards.
  const old = parseIQ(`- [ ] c0002 · filed 2026-08-15 — **an old one**.
  Fix: add the line.
  Source: a session.
`);
  const v = iqComplete(old);
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing.sort(), ['expect', 'verify']);
});

test('a web-only step says so instead of pretending to be a command', () => {
  const iq = parseIQ(`- [ ] c0008 · filed 2026-08-15 — **Give the bot its own avatar**
  Do: open https://github.com/settings/apps/obotclaw > Display information > drag the file in.
  Expect: the avatar preview shows the cat, not the panda.
  Verify: manual — reload the page; the Display information block shows the new image.
  Unblocks: the bot stops wearing your profile picture.
  Source: chat 2026-08-15
`);
  assert.equal(iq.verify.manual, true);
  assert.equal(iq.verify.command, null);
  assert.equal(verifyPlan(iq).auto, false);
  assert.match(verifyPlan(iq).why, /manual/i);
});

test('only read-only commands are ever run for him — everything else is copy-and-run', () => {
  const plan = (c) => verifyPlan({ verify: { command: c, manual: false } });
  assert.equal(plan('grep -c foo /tmp/x').auto, true);
  assert.equal(plan('test -f /tmp/x').auto, true);
  assert.equal(plan('gh api /user --jq .login').auto, true);

  // A write through the same allowlisted binary is not a verification.
  assert.equal(plan('gh api -X DELETE /repos/a/b').auto, false);
  assert.equal(plan('gh api --method PATCH /repos/a/b/issues/1').auto, false);
  // Anything that can run arbitrary code, redirect, or chain.
  assert.equal(plan('node -e "process.exit(0)"').auto, false);
  assert.equal(plan('rm -rf /tmp/x').auto, false);
  assert.equal(plan('grep x /tmp/a && rm /tmp/b').auto, false);
  assert.equal(plan('grep x /tmp/a > /tmp/b').auto, false);
  assert.equal(plan('grep x $(cat /tmp/p)').auto, false);
  assert.equal(plan('osascript -e "tell app"').auto, false);
  assert.ok(AUTO_VERIFY_HEADS.includes('grep'));
  assert.ok(!AUTO_VERIFY_HEADS.includes('node'));
});

test('a check records a real pass or fail, not a self-attestation', async () => {
  const ws = tmp();
  fs.writeFileSync(path.join(ws, 'present.txt'), 'the line is here\n');

  const pass = await runVerify(ws, { id: 'c0001', command: `grep -c "the line" ${path.join(ws, 'present.txt')}` });
  assert.equal(pass.result, 'pass');
  assert.equal(pass.exitCode, 0);
  assert.match(pass.stdout, /1/);

  const fail = await runVerify(ws, { id: 'c0002', command: `grep -c "missing" ${path.join(ws, 'present.txt')}` });
  assert.equal(fail.result, 'fail');
  assert.notEqual(fail.exitCode, 0);

  // Both land in the append-only store with the command that produced them.
  const log = fs.readFileSync(path.join(ws, '.claude', 'ops', 'checks.jsonl'), 'utf8').trim().split('\n');
  assert.equal(log.length, 2);
  assert.equal(JSON.parse(log[0]).id, 'c0001');
  assert.ok(JSON.parse(log[1]).command.includes('grep'));
});

test('a command outside the allowlist is refused rather than run', async () => {
  const ws = tmp();
  const r = await runVerify(ws, { id: 'c0003', command: 'node -e "1"' });
  assert.equal(r.result, 'refused');
  assert.match(r.why, /allowlist|read-only/i);
  assert.equal(fs.existsSync(path.join(ws, '.claude', 'ops', 'checks.jsonl')), false);
});

// ---------------------------------------------------------------- triage

test('a snooze must carry a wake — one with no way back is a silent delete', () => {
  const ws = tmp();
  assert.throws(() => triage(ws, { key: 'c0001', kind: 'config', action: 'snooze' }), /wake/i);
  const ok = triage(ws, { key: 'c0001', kind: 'config', action: 'snooze', until: '2026-08-23T00:00:00.000Z' });
  assert.equal(ok.action, 'snooze');
  assert.equal(ok.until, '2026-08-23T00:00:00.000Z');
});

test('triage is an append-only ledger — every action keeps who, when and what', () => {
  const ws = tmp();
  triage(ws, { key: 'c0001', kind: 'config', action: 'snooze', wakeOnChange: true, fingerprint: 'abc' });
  triage(ws, { key: 'c0001', kind: 'config', action: 'restore' });
  const log = readTriage(ws);
  assert.equal(log.length, 2);
  assert.deepEqual(log.map((r) => r.action), ['snooze', 'restore']);
  assert.equal(log.every((r) => r.by === 'jwildfire' && r.at), true);
  // Nothing is ever deleted, so a dismissal is recoverable by construction.
  assert.equal(triageState(ws)['c0001'], undefined);
});

test('a dismissed item is hidden from the queue, never removed from its source', () => {
  const ws = tmp();
  fs.mkdirSync(path.join(ws, '.claude'), { recursive: true });
  const file = path.join(ws, '.claude', 'blockers.md');
  fs.writeFileSync(file, `## Open\n\n${IQ_ENTRY}`);
  const before = fs.readFileSync(file, 'utf8');

  triage(ws, { key: 'c0001', kind: 'config', action: 'dismiss' });
  const items = [{ kind: 'config', key: 'c0001', title: 'x', fingerprint: 'abc' }];
  const out = applyTriage(ws, items);
  assert.deepEqual(out.items, []);
  assert.equal(out.cleared.length, 1);
  assert.equal(out.cleared[0].triage.action, 'dismiss');
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the config list is never edited by a dashboard click');
});

test('a snooze wakes on its date, and sooner if the item itself changes', () => {
  const ws = tmp();
  const past = new Date(Date.now() - 86400000).toISOString();
  const future = new Date(Date.now() + 86400000).toISOString();

  triage(ws, { key: 'a', kind: 'rc', action: 'snooze', until: future, wakeOnChange: true, fingerprint: 'v1' });
  triage(ws, { key: 'b', kind: 'rc', action: 'snooze', until: past, wakeOnChange: false, fingerprint: 'v1' });
  triage(ws, { key: 'c', kind: 'rc', action: 'snooze', until: future, wakeOnChange: true, fingerprint: 'v1' });

  const out = applyTriage(ws, [
    { kind: 'rc', key: 'a', title: 'still asleep', fingerprint: 'v1' },
    { kind: 'rc', key: 'b', title: 'its date passed', fingerprint: 'v1' },
    { kind: 'rc', key: 'c', title: 'it changed under the snooze', fingerprint: 'v2' },
  ]);
  assert.deepEqual(out.items.map((i) => i.key).sort(), ['b', 'c']);
  assert.deepEqual(out.snoozed.map((i) => i.key), ['a']);
  // Nothing vanishes: the snoozed one still renders, with the reason it will come back.
  assert.match(wakeText(out.snoozed[0].triage), /wakes/i);
});

test('a fingerprint changes when the item does, and not when it is merely re-read', () => {
  const a = fingerprint({ kind: 'config', key: 'c0001', title: 'x', body: 'Do: this' });
  assert.equal(fingerprint({ kind: 'config', key: 'c0001', title: 'x', body: 'Do: this' }), a);
  assert.notEqual(fingerprint({ kind: 'config', key: 'c0001', title: 'x', body: 'Do: that' }), a);
});

// ---------------------------------------------------------------- critical

test('critical is earned from a reference that resolved, never from a free-text flag', () => {
  const claimed = { kind: 'config', key: 'c1', title: 'x', blocks: [{ ref: 'obot.roadmap#182', verified: true, state: 'open' }] };
  const asserted = { kind: 'config', key: 'c2', title: 'y', critical: true };
  const unresolved = { kind: 'config', key: 'c3', title: 'z', blocks: [{ ref: 'obot.roadmap#999', verified: false }] };

  assert.ok(criticalClaim(claimed));
  assert.equal(criticalClaim(asserted), null, 'a bare boolean earns nothing');
  assert.equal(criticalClaim(unresolved), null, 'an unresolvable reference earns nothing');
  // The claim is displayed, so a weak one is visible at a glance.
  assert.match(criticalClaim(claimed), /obot\.roadmap#182/);
});

test('critical pins across sections, above everything, and is capped', () => {
  const cfg = (n, blocks) => ({
    kind: 'config', key: `c${n}`, id: `c000${n}`, title: `config ${n}`, date: '2026-08-01',
    blocks: blocks ? [{ ref: `hub#${n}`, verified: true, state: 'open' }] : [],
  });
  const q = {
    rcs: { items: [{ kind: 'rc', key: 'r#1', title: 'a routine RC', date: '2026-08-10' }] },
    decisions: { items: [{ kind: 'decision', key: 'd', id: 'D0007', title: 'a call', date: '2026-08-12' }] },
    config: { items: [cfg(1, true), cfg(2, true), cfg(3, true), cfg(4, true), cfg(5, false)] },
  };
  const r = rankQueue(q);
  assert.equal(CRITICAL_BUDGET, 3);
  assert.equal(r.critical.length, 3, 'the budget is the whole point of "sparingly"');
  assert.equal(r.overBudget, 1, 'a fourth claim is reported, not silently shown or silently dropped');

  // Pinned above the sections, and removed from their home section rather than
  // rendered twice — a duplicated row in a phone list is a bug.
  const keys = r.critical.map((i) => i.key);
  assert.equal(r.config.items.some((i) => keys.includes(i.key)), false);
  assert.equal(r.config.moved, 3);
  // Nothing else is promoted: a routine RC stays a routine RC.
  assert.equal(r.critical.every((i) => i.kind === 'config'), true);
  assert.equal(r.rcs.items.length, 1);
});

test('with nothing earned, nothing is marked — the default is unmarked', () => {
  const r = rankQueue({
    rcs: { items: [{ kind: 'rc', key: 'r#1', title: 'an RC', date: '2026-08-10' }] },
    decisions: { items: [] },
    config: { items: [{ kind: 'config', key: 'c1', title: 'a config item', date: '2026-08-01', blocks: [] }] },
  });
  assert.deepEqual(r.critical, []);
  assert.equal(r.overBudget, 0);
});

test('inside a section the oldest thing waiting comes first', () => {
  const r = rankQueue({
    rcs: { items: [
      { kind: 'rc', key: 'new', title: 'filed yesterday', date: '2026-08-14' },
      { kind: 'rc', key: 'old', title: 'waiting since the 1st', date: '2026-08-01' },
    ] },
    decisions: { items: [] },
    config: { items: [] },
  });
  assert.deepEqual(r.rcs.items.map((i) => i.key), ['old', 'new']);
});

// ---------------------------------------------------------------- the page

const ranked = (over = {}) => rankQueue({
  rcs: { items: [{ kind: 'rc', key: 'jwildfire/gsm.safety#52', title: 'gsm.safety v1.1.0 — metrics', url: 'https://x.test/52', date: '2026-08-10' }], refreshing: false },
  decisions: { items: [{ kind: 'decision', key: 's', id: 'D0007', artifact: 's', title: 'A call', date: '2026-08-12' }] },
  config: { items: [{
    kind: 'config', key: 'c0001', id: 'c0001', title: 'Let agents log without a prompt', date: '2026-08-15',
    blocks: [{ ref: 'obot.roadmap#182', verified: true, state: 'open' }],
    iq: parseIQ(IQ_ENTRY),
  }] },
  ...over,
});

test('the page carries the whole instruction, not just the headline', () => {
  const html = render({ queue: { ...ranked(), items: [] }, staged: [] });
  // The old page threw the fix away; this one ships it to the browser so a click
  // can show the exact command.
  assert.ok(html.includes('iq-data'), 'the IQ travels with the page');
  assert.ok(html.includes('grep -c'), 'the verification command reaches the browser');
  assert.ok(html.includes('Do'), 'and its steps are labelled');
});

test('a critical row shows what it claims to block, right next to the tag', () => {
  const html = render({ queue: { ...ranked(), items: [] }, staged: [] });
  assert.ok(/critical/i.test(html));
  assert.ok(html.includes('obot.roadmap#182'), 'the claim is visible, so a weak one is obvious');
});

test('every row can be triaged, whatever kind it is', () => {
  const html = render({ queue: { ...ranked(), items: [] }, staged: [] });
  for (const action of ['Snooze', 'Dismiss']) {
    assert.ok(html.includes(action), `${action} must be reachable`);
  }
  assert.ok(html.includes('/triage'), 'the page posts triage back to the local server');
});

test('snoozed and cleared items stay on the page, collapsed', () => {
  const q = ranked();
  const html = render({
    queue: { ...q, items: [], snoozed: [{ kind: 'rc', key: 'r#9', title: 'later', triage: { action: 'snooze', until: '2026-08-23T00:00:00.000Z' } }], cleared: [{ kind: 'config', key: 'c0009', title: 'gone', triage: { action: 'dismiss' } }] },
    staged: [],
  });
  assert.ok(html.includes('Snoozed'));
  assert.ok(html.includes('Cleared'));
  assert.ok(html.includes('<details'), 'collapsed, so a long list costs no vertical space on a phone');
  assert.ok(/wakes/i.test(html), 'a snooze shows how it comes back');
});

// ------------------------------------------------------- capture enforcement

const logTool = new URL('../../blocker-log', import.meta.url).pathname;
const capture = (ws, args) => execFileSync(logTool, args, { env: { ...process.env, OBOT_WORKSPACE: ws }, encoding: 'utf8' });
const captureFails = (ws, args) => {
  try { capture(ws, args); return null; } catch (e) { return String(e.stderr || e.stdout || e.message); }
};

test('capture refuses an entry that is not an installation qualification', () => {
  const ws = tmp();
  // The old call shape: a fix and a source, no expected result and no proof.
  const err = captureFails(ws, ['a thing', '--fix', 'type this', '--source', 'a session']);
  assert.ok(err, 'the old free-text shape must not silently produce a useless entry');
  assert.match(err, /--expect|--verify/);
  assert.equal(fs.existsSync(path.join(ws, '.claude', 'blockers.md')), false);
});

test('capture writes the IQ shape the dashboard reads back', () => {
  const ws = tmp();
  capture(ws, [
    'Let agents log without a prompt',
    '--do', 'add the line to /w/.claude/settings.json',
    '--expect', 'the allow array carries it',
    '--verify', 'grep -c scratchpad-log /w/.claude/settings.json → prints 1 or more',
    '--unblocks', 'cheap heartbeats',
    '--source', 'obot.agent#91',
  ]);
  const { items } = collectConfig(ws);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'c0001');
  assert.equal(items[0].iq.verify.command, 'grep -c scratchpad-log /w/.claude/settings.json');
  assert.equal(iqComplete(items[0].iq).ok, true);
});

test('a critical claim at capture needs a reference that resolves, or it is not critical', () => {
  const ws = tmp();
  capture(ws, [
    'Something urgent',
    '--do', 'do it', '--expect', 'it is done',
    '--verify', 'test -f /tmp/nope → the file exists',
    '--source', 'a session',
    '--blocks', 'jwildfire/obot.roadmap#999999',
  ]);
  const [item] = collectConfig(ws).items;
  // The reference was recorded, but nothing resolved it, so nothing is claimed.
  assert.equal(item.blocks.length, 1);
  assert.equal(item.blocks[0].verified, false);
  assert.equal(criticalClaim(item), null);
});

// ---------------------------------------------------------------- the server

test('the local server records triage and runs a proof, and refuses the rest', async () => {
  const { serve } = await import('../ops-dashboard.mjs');
  const ws = tmp();
  fs.writeFileSync(path.join(ws, 'present.txt'), 'here\n');
  const { server, url } = await serve({ workspace: ws, hub: path.join(ws, 'hub'), port: 0 });
  const post = async (p, body) => {
    const r = await fetch(new URL(p, url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  try {
    const dismissed = await post('/triage', { key: 'c0001', kind: 'config', action: 'dismiss' });
    assert.equal(dismissed.status, 200);
    assert.equal(triageState(ws)['c0001'].action, 'dismiss');

    // A snooze with no wake is refused by the server too, not only the module.
    const bad = await post('/triage', { key: 'c0002', kind: 'config', action: 'snooze' });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /wake/i);

    const pass = await post('/check', { key: 'c0003', id: 'c0003', command: `grep -c here ${path.join(ws, 'present.txt')}` });
    assert.equal(pass.json.result, 'pass');

    // The command arrives from a browser page, so the allowlist is re-applied
    // here rather than trusted because the page sent it.
    const refused = await post('/check', { key: 'c0004', id: 'c0004', command: 'rm -rf /tmp/anything' });
    assert.equal(refused.json.result, 'refused');
  } finally {
    server.close();
  }
});

test('an expected output is checked when the entry states one', async () => {
  const { judge } = await import('../lib/iq.mjs');
  // The default: the command's own exit code is the verdict.
  assert.equal(judge(0, 'anything', 'the file exists'), 'pass');
  assert.equal(judge(1, '', 'the file exists'), 'fail');
  // `prints N` is checked, so "exit 0 with the wrong count" is not a pass.
  assert.equal(judge(0, '2\n', 'prints 2'), 'pass');
  assert.equal(judge(0, '1\n', 'prints 2'), 'fail');
  // ...and it outranks the exit code, because `grep -c x file` answers "0"
  // correctly while exiting 1. Calling that a failure would be wrong.
  assert.equal(judge(1, '0\n', 'prints 0'), 'pass');
  // `not X` is how "it is no longer the old value" is stated.
  assert.equal(judge(0, 'https://a/u/3680095?v=4', 'not u/3680095'), 'fail');
  assert.equal(judge(0, 'https://a/u/999?v=4', 'not u/3680095'), 'pass');
});

test('a measured condition earns the tag too, and outranks a blocks claim', () => {
  // OVERDUE (obot.agent#123) is decided by a clock, not by the thing asking for
  // attention — which is exactly the property the bar is testing for.
  const overdue = { kind: 'decision', key: 'd1', title: 'an answer nothing picked up', date: '2026-08-16', computed: { label: 'overdue', detail: 'captured 3h ago, nothing applied it' } };
  const blocks = { kind: 'config', key: 'c1', title: 'x', date: '2026-08-01', blocks: [{ ref: 'hub#1', verified: true }] };
  assert.match(criticalClaim(overdue), /overdue/);
  assert.match(criticalClaim(overdue), /3h ago/, 'the measurement is shown, not just the word');

  const r = rankQueue({ rcs: { items: [] }, decisions: { items: [overdue] }, config: { items: [blocks] } });
  assert.deepEqual(r.critical.map((i) => i.key), ['d1', 'c1']);

  // And still nothing an agent can simply declare about its own work.
  assert.equal(criticalClaim({ kind: 'rc', key: 'r', title: 'y', computed: {} }), null);
  assert.equal(criticalClaim({ kind: 'rc', key: 'r', title: 'y', urgent: true }), null);
});

test('the page script actually parses — a template-literal escape is not a typo you see', () => {
  // Found the hard way: `\n` inside the page's own template literal became a real
  // newline in the emitted script, so the whole inline script failed to parse and
  // every control on the page went dead — silently, with no console error and a
  // page that still looked right. Nothing was checking that the script the
  // browser receives is valid JavaScript. Now something is.
  const html = render({ queue: { ...ranked(), items: [] } });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length, 'the page carries an inline script');
  for (const s of scripts) {
    assert.doesNotThrow(() => new Function(s), 'the emitted page script must parse');
  }
});

test('retiring an entry moves it out of Open with its id and body intact', () => {
  const ws = tmp();
  capture(ws, ['first', '--do', 'a', '--expect', 'b', '--verify', 'test -f /tmp/a -> it exists', '--source', 's']);
  capture(ws, ['second', '--do', 'c', '--expect', 'd', '--verify', 'test -f /tmp/b -> it exists', '--source', 's']);
  capture(ws, ['third', '--do', 'e', '--expect', 'f', '--verify', 'test -f /tmp/c -> it exists', '--source', 's']);

  // A retirement needs a reason: one without is a deletion with better manners.
  assert.ok(captureFails(ws, ['--retire', 'c0002']), 'no reason, no retirement');
  capture(ws, ['--retire', 'c0002', '--reason', 'folded into c0001']);

  const md = fs.readFileSync(path.join(ws, '.claude', 'blockers.md'), 'utf8');
  assert.deepEqual(collectConfig(ws).items.map((i) => i.id), ['c0001', 'c0003']);
  assert.match(md, /## Resolved[\s\S]*c0002[\s\S]*folded into c0001/, 'it moves, it does not vanish');
  assert.match(md, /- \[x\] c0002/, 'and it closes rather than being cut');
  assert.match(md.slice(md.indexOf('c0002')), /Do: c/, 'the whole entry travels, not just the headline');

  // The number is spent forever, even though the item is no longer open.
  capture(ws, ['fourth', '--do', 'g', '--expect', 'h', '--verify', 'test -f /tmp/d -> it exists', '--source', 's']);
  assert.deepEqual(collectConfig(ws).items.map((i) => i.id), ['c0001', 'c0003', 'c0004']);
  assert.ok(captureFails(ws, ['--retire', 'c0002', '--reason', 'again']), 'a retired id is not open twice');
});
