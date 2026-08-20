// The car door: the Apple Reminders list Siri writes to, and the receipt he gets back.
//
// jwildfire/obot.roadmap#265 names this channel because it is the one Siri reaches
// hands-free from CarPlay. Everything here is about two things being true at once:
//
//   an answer of his must never be posted to the PUBLIC ideas board by the lane that
//   files everything else in this list — his verbatim decision answers are local-only;
//
//   and he must be able to tell, without a screen, whether what he said landed. The
//   receipt is the item itself: a routed sentence is stamped and completed, so the
//   list empties; an unrouted one is stamped and LEFT, so it is still there when he
//   asks Siri what is on the list.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { pendingAnswers } from '../../ops-dashboard/lib/answers.mjs';
import { readUnrouted } from '../lib/route.mjs';
import {
  RECEIPT_DONE, RECEIPT_HELD, asQuote, listPending, osascriptRunner, parseRecords, pollReminders,
} from '../lib/reminders.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const NOW = new Date('2026-08-20T14:00:00Z');
const FS = String.fromCharCode(31);
const RS = String.fromCharCode(30);

const REG = [
  {
    id: 'D0022', slug: '2026-08-20-branch-protections', date: '2026-08-20', state: 'open',
    title: 'Branch protections', questions: [{ id: 'D0022.1', code: 'P1', question: 'Which set?' }],
  },
];
function hub(artifacts = REG) {
  const dir = tmp('rem-hub-');
  fs.mkdirSync(path.join(dir, 'reports', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'reports', 'decisions', 'registry.json'), JSON.stringify({ prefix: 'D', artifacts }));
  return dir;
}

/** A fake Reminders app: one canned list, and a log of every script it was sent. */
function fake(items) {
  const sent = [];
  let payload = items.map((i) => [i.id, i.name, i.body ?? ''].join(FS)).join(RS);
  return {
    sent,
    run(script) {
      sent.push(script);
      if (/repeat with r in/.test(script)) return { ok: true, out: payload };
      if (/set name of/.test(script)) {
        const id = /whose id is "([^"]+)"/.exec(script)?.[1];
        const name = /to "([\s\S]*)"\s*$/.exec(script)?.[1];
        payload = payload.split(RS).filter(Boolean)
          .map((rec) => {
            const f = rec.split(FS);
            return f[0] === id ? [f[0], name, f[2] ?? ''].join(FS) : rec;
          }).join(RS);
        return { ok: true, out: '' };
      }
      if (/set completed of/.test(script)) {
        const id = /whose id is "([^"]+)"/.exec(script)?.[1];
        payload = payload.split(RS).filter(Boolean).filter((rec) => rec.split(FS)[0] !== id).join(RS);
        return { ok: true, out: '' };
      }
      return { ok: true, out: '' };
    },
  };
}

test('the record format the list comes back in is parsed, body and all', () => {
  const raw = ['a1', 'branch protections, option A', ''].join(FS) + RS
    + ['a2', 'a goals page', 'more detail'].join(FS) + RS;
  const items = parseRecords(raw);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'a1');
  assert.equal(items[0].text, 'branch protections, option A');
  assert.equal(items[1].text, 'a goals page\n\nmore detail');
});

test('an item already wearing a receipt is never read back in — the lane cannot eat its own stamp', () => {
  const f = fake([
    { id: 'a1', name: `${RECEIPT_HELD} could not route: something` },
    { id: 'a2', name: `${RECEIPT_DONE} branch protections - recorded` },
    { id: 'a3', name: 'branch protections, option A' },
  ]);
  const r = listPending({ run: f.run });
  assert.equal(r.read, true);
  assert.deepEqual(r.items.map((i) => i.id), ['a3']);
});

test('a missing list is said out loud, never treated as an empty one', () => {
  const r = listPending({ run: () => ({ ok: true, out: '__ERROR_NO_LIST__' }) });
  assert.equal(r.read, false);
  assert.match(r.why, /no Reminders list/i);
  assert.equal(r.items.length, 0);
});

test('an osascript that fails is a failed read, not an empty inbox', () => {
  const r = listPending({ run: () => ({ ok: false, why: 'osascript: not permitted' }) });
  assert.equal(r.read, false);
  assert.match(r.why, /not permitted/);
});

test('a routed sentence is stamped and completed, so the list empties and he can hear that', () => {
  const b = { ws: tmp('rem-ws-'), hub: hub() };
  const f = fake([{ id: 'a1', name: 'branch protections, option A' }]);
  const out = pollReminders({ workspace: b.ws, hub: b.hub, run: f.run, now: NOW });

  assert.equal(out.routed.length, 1);
  assert.equal(out.routed[0].kind, 'answer');
  assert.equal(pendingAnswers(b.ws, { hub: b.hub }).length, 1);

  const rename = f.sent.find((s) => /set name of/.test(s));
  assert.ok(rename, 'the item he dictated is stamped with what happened to it');
  assert.match(rename, /branch protections/);
  assert.match(rename, new RegExp(RECEIPT_DONE));
  assert.ok(f.sent.some((s) => /set completed of/.test(s)), 'and completed, so it leaves the list');
});

test('an UNROUTED sentence is stamped and LEFT on the list — the absence of a receipt is the receipt', () => {
  const b = { ws: tmp('rem-ws-'), hub: hub() };
  const f = fake([{ id: 'a1', name: 'answer: the thing about the branches' }]);
  const out = pollReminders({ workspace: b.ws, hub: b.hub, run: f.run, now: NOW });

  assert.equal(out.unrouted.length, 1);
  assert.equal(readUnrouted(b.ws).items.length, 1);
  assert.equal(pendingAnswers(b.ws, { hub: b.hub }).length, 0);

  const rename = f.sent.find((s) => /set name of/.test(s));
  assert.match(rename, new RegExp(RECEIPT_HELD));
  assert.match(rename, /the thing about the branches/, 'his sentence stays on the item, whole');
  assert.equal(f.sent.some((s) => /set completed of/.test(s)), false,
    'completing it would take the only evidence he has that it failed');
});

test('an idea is left completely alone for the lane that has always handled it', () => {
  const b = { ws: tmp('rem-ws-'), hub: hub() };
  const f = fake([{ id: 'a1', name: 'a goals page in the hub would be good' }]);
  const out = pollReminders({ workspace: b.ws, hub: b.hub, run: f.run, now: NOW });
  assert.equal(out.ideas.length, 1);
  assert.equal(f.sent.filter((s) => /set name of|set completed of/.test(s)).length, 0);
});

test('private: is left alone too — it is not this lane\'s to touch', () => {
  const b = { ws: tmp('rem-ws-'), hub: hub() };
  const f = fake([{ id: 'a1', name: 'private: something' }]);
  const out = pollReminders({ workspace: b.ws, hub: b.hub, run: f.run, now: NOW });
  assert.equal(out.privates.length, 1);
  assert.equal(f.sent.filter((s) => /set name of|set completed of/.test(s)).length, 0);
});

test('polling twice does not answer twice — the stamp is what makes it safe to run on a clock', () => {
  const b = { ws: tmp('rem-ws-'), hub: hub() };
  const f = fake([{ id: 'a1', name: 'branch protections, option A' }]);
  pollReminders({ workspace: b.ws, hub: b.hub, run: f.run, now: NOW });
  const second = pollReminders({ workspace: b.ws, hub: b.hub, run: f.run, now: NOW });
  assert.equal(second.routed.length, 0);
  assert.equal(pendingAnswers(b.ws, { hub: b.hub })[0].clicks, 1);
});

test('an unrouted item stamped once is not re-stamped into a nest of prefixes', () => {
  const b = { ws: tmp('rem-ws-'), hub: hub() };
  const f = fake([{ id: 'a1', name: 'answer: fits nothing at all' }]);
  pollReminders({ workspace: b.ws, hub: b.hub, run: f.run, now: NOW });
  const second = pollReminders({ workspace: b.ws, hub: b.hub, run: f.run, now: NOW });
  assert.equal(second.unrouted.length, 0, 'it is already wearing its stamp, so it is not read again');
  assert.equal(readUnrouted(b.ws).items.length, 1);
});

test('a failed read polls nothing and says why, rather than reporting a quiet lane', () => {
  const b = { ws: tmp('rem-ws-'), hub: hub() };
  const out = pollReminders({ workspace: b.ws, hub: b.hub, run: () => ({ ok: false, why: 'osascript refused' }), now: NOW });
  assert.equal(out.read, false);
  assert.match(out.why, /refused/);
  assert.equal(out.routed.length, 0);
});

test('quoting cannot be escaped out of by anything he says', () => {
  // What he dictates is interpolated into an AppleScript string literal. A quote in
  // his sentence that closed that literal would leave the rest of it as code.
  assert.equal(asQuote('say "yes"'), 'say \\"yes\\"');
  assert.equal(asQuote('back\\slash'), 'back\\\\slash');
  const nasty = asQuote('a" & do shell script "rm -rf /');
  assert.ok(!/[^\\]"/.test(nasty), 'no unescaped quote survives, so nothing can close the literal');
});

test('THE DEFAULT RUNNER IS REAL: it is exercised, not only overridden in tests', () => {
  // A default parameter every test replaces is covered by none of them (obot.agent#229).
  const r = osascriptRunner('return "obot-voice-ok"');
  if (process.platform === 'darwin') {
    assert.equal(r.ok, true, r.why);
    assert.equal(r.out, 'obot-voice-ok');
  } else {
    assert.equal(r.ok, false, 'off macOS it must report a failure, never a silent empty read');
    assert.ok(r.why);
  }
});
