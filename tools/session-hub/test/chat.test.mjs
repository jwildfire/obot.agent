// Chat protocol tests (design #77 §4–§5). Everything here runs against a real
// temp directory: the protocol IS the filesystem, so mocking it would test
// nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  appendLog, claim, drainOutbox, ensureSessionDir, frameMessage, isChatCapable,
  enqueue, parseTranscriptChunk, pending, projectSlug, readLog, sessionDir,
  tailTranscript, transcriptPath,
} from '../lib/chat.mjs';
import { originAllowed, readTargets } from '../session-chat.mjs';

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'hooks', 'chat-inbox-deliver.sh');

const SID = '11111111-2222-3333-4444-555555555555';

function ws() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chat-test-'));
}

/* ------------------------------------------------------------------ inbox */

test('enqueue writes a pending message; pending reads it back oldest-first', () => {
  const w = ws();
  enqueue(w, SID, { text: 'first', now: 1000 });
  enqueue(w, SID, { text: 'second', now: 2000 });
  const q = pending(w, SID);
  assert.deepEqual(q.map((m) => m.text), ['first', 'second']);
  assert.equal(q[0].from, 'dashboard');
  assert.match(q[0].createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('enqueue refuses an empty message', () => {
  const w = ws();
  assert.throws(() => enqueue(w, SID, { text: '   ' }), /empty message/);
});

test('claim moves the oldest message to delivered/ and annotates it', () => {
  const w = ws();
  enqueue(w, SID, { text: 'older', now: 1000 });
  enqueue(w, SID, { text: 'newer', now: 2000 });
  const got = claim(w, SID, { lane: 'hook', now: 5000 });
  assert.equal(got.text, 'older');
  assert.equal(got.lane, 'hook');
  assert.equal(got.deliveredAt, new Date(5000).toISOString());
  assert.deepEqual(pending(w, SID).map((m) => m.text), ['newer']);
  const onDisk = JSON.parse(fs.readFileSync(path.join(sessionDir(w, SID), 'delivered', `${got.id}.json`), 'utf8'));
  assert.equal(onDisk.text, 'older');
  assert.equal(onDisk.lane, 'hook');
});

test('claim on an empty or absent inbox returns null rather than throwing', () => {
  const w = ws();
  assert.equal(claim(w, SID), null);
  ensureSessionDir(w, SID);
  assert.equal(claim(w, SID), null);
});

test('a message is delivered exactly once even when both lanes claim it', () => {
  const w = ws();
  enqueue(w, SID, { text: 'only once', now: 1000 });
  const a = claim(w, SID, { lane: 'hook' });
  const b = claim(w, SID, { lane: 'monitor' });
  assert.equal(a.text, 'only once');
  assert.equal(b, null);
  assert.equal(pending(w, SID).length, 0);
});

test('pending skips a corrupt file instead of failing the queue', () => {
  const w = ws();
  ensureSessionDir(w, SID);
  fs.writeFileSync(path.join(sessionDir(w, SID), 'inbox', '1-bad.json'), '{ not json');
  enqueue(w, SID, { text: 'good', now: 2000 });
  assert.deepEqual(pending(w, SID).map((m) => m.text), ['good']);
});

test('isChatCapable is false until a session is armed', () => {
  const w = ws();
  assert.equal(isChatCapable(w, SID), false);
  ensureSessionDir(w, SID);
  assert.equal(isChatCapable(w, SID), true);
});

test('frameMessage marks the turn as chat, not a work order, and names the id', () => {
  const framed = frameMessage({ id: 'abc123', text: 'how is it going?', createdAt: '2026-07-25T04:05:00.000Z' }, { sessionId: SID });
  assert.match(framed, /\[dashboard chat\] @jwildfire/);
  assert.match(framed, /at 04:05 UTC/);
  assert.match(framed, /how is it going\?/);
  assert.match(framed, /not a new work order/);
  assert.match(framed, /do not treat it as approval/);
  assert.match(framed, /abc123/);
});

/* --------------------------------------------------------- outbox and log */

test('drainOutbox returns and removes explicit replies', () => {
  const w = ws();
  ensureSessionDir(w, SID);
  fs.writeFileSync(path.join(sessionDir(w, SID), 'outbox', 'a.json'), JSON.stringify({ id: 'a', text: 'reply' }));
  assert.deepEqual(drainOutbox(w, SID).map((r) => r.text), ['reply']);
  assert.deepEqual(drainOutbox(w, SID), []);
});

test('drainOutbox discards an unparseable reply without throwing', () => {
  const w = ws();
  ensureSessionDir(w, SID);
  fs.writeFileSync(path.join(sessionDir(w, SID), 'outbox', 'a.json'), 'nope');
  assert.deepEqual(drainOutbox(w, SID), []);
  assert.deepEqual(fs.readdirSync(path.join(sessionDir(w, SID), 'outbox')), []);
});

test('the chat log round-trips and tolerates a junk line', () => {
  const w = ws();
  appendLog(w, SID, { role: 'user', text: 'hi' });
  fs.appendFileSync(path.join(sessionDir(w, SID), 'log.jsonl'), 'garbage\n');
  appendLog(w, SID, { role: 'agent', text: 'hello' });
  assert.deepEqual(readLog(w, SID).map((e) => [e.role, e.text]), [['user', 'hi'], ['agent', 'hello']]);
});

test('readLog on a session with no log is empty, not an error', () => {
  assert.deepEqual(readLog(ws(), SID), []);
});

/* ------------------------------------------------------------ transcript */

const row = (o) => `${JSON.stringify(o)}\n`;
const assistant = (content, extra = {}) => row({
  type: 'assistant', timestamp: '2026-07-25T04:00:00.000Z',
  message: { role: 'assistant', content, stop_reason: 'tool_use' }, ...extra,
});

test('parseTranscriptChunk maps the pinned block kinds to events', () => {
  const chunk = [
    assistant([{ type: 'thinking', thinking: 'hmm' }]),
    assistant([{ type: 'tool_use', name: 'Bash', input: { command: 'ls', description: 'List files' } }]),
    row({
      type: 'assistant', timestamp: '2026-07-25T04:00:02.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'All good.' }], stop_reason: 'end_turn' },
    }),
  ].join('');
  const { events } = parseTranscriptChunk(chunk);
  assert.deepEqual(events.map((e) => e.kind), ['thinking', 'tool', 'text', 'end_turn']);
  assert.equal(events[1].name, 'Bash');
  assert.equal(events[1].detail, 'List files'); // description wins over command
  assert.equal(events[2].text, 'All good.');
});

test('parseTranscriptChunk ignores sidechains, other types, and unknown blocks', () => {
  const chunk = [
    assistant([{ type: 'text', text: 'subagent noise' }], { isSidechain: true }),
    row({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } }),
    row({ type: 'last-prompt' }),
    assistant([{ type: 'redacted_thinking', data: '…' }]),
    assistant([{ type: 'text', text: 'real reply' }]),
  ].join('');
  const { events } = parseTranscriptChunk(chunk);
  assert.deepEqual(events.map((e) => e.kind), ['text']);
  assert.equal(events[0].text, 'real reply');
});

test('parseTranscriptChunk survives a malformed line and blank lines', () => {
  const chunk = `not json\n\n${assistant([{ type: 'text', text: 'ok' }])}`;
  const { events } = parseTranscriptChunk(chunk);
  assert.deepEqual(events.map((e) => e.text), ['ok']);
});

test('parseTranscriptChunk consumes only complete lines', () => {
  const complete = assistant([{ type: 'text', text: 'done' }]);
  const { events, consumed } = parseTranscriptChunk(`${complete}{"type":"assist`);
  assert.equal(events.length, 1);
  assert.equal(consumed, Buffer.byteLength(complete, 'utf8'));
});

test('parseTranscriptChunk consumes nothing when no line has landed yet', () => {
  const { events, consumed } = parseTranscriptChunk('{"type":"assistant"');
  assert.deepEqual(events, []);
  assert.equal(consumed, 0);
});

test('tailTranscript streams only what appears after the offset', () => {
  const dir = ws();
  const file = path.join(dir, 'x.jsonl');
  fs.writeFileSync(file, assistant([{ type: 'text', text: 'before send' }]));
  const start = fs.statSync(file).size;
  fs.appendFileSync(file, assistant([{ type: 'text', text: 'after send' }]));
  const { events, offset } = tailTranscript(file, start);
  assert.deepEqual(events.map((e) => e.text), ['after send']);
  assert.equal(offset, fs.statSync(file).size);
  assert.deepEqual(tailTranscript(file, offset).events, []); // idempotent at EOF
});

test('tailTranscript re-reads a partial line on the next poll', () => {
  const dir = ws();
  const file = path.join(dir, 'x.jsonl');
  const line = assistant([{ type: 'text', text: 'split' }]);
  const half = line.slice(0, 20);
  fs.writeFileSync(file, half);
  const first = tailTranscript(file, 0);
  assert.deepEqual(first.events, []);
  assert.equal(first.offset, 0);
  fs.appendFileSync(file, line.slice(20));
  assert.deepEqual(tailTranscript(file, first.offset).events.map((e) => e.text), ['split']);
});

test('tailTranscript on a missing file degrades to no events', () => {
  const { events, offset } = tailTranscript(path.join(ws(), 'nope.jsonl'), 0);
  assert.deepEqual(events, []);
  assert.equal(offset, 0);
});

test('projectSlug matches the harness convention', () => {
  assert.equal(projectSlug('/Users/j/Documents/obot2'), '-Users-j-Documents-obot2');
  assert.equal(projectSlug('/Users/j/Documents/obot2/obot.agent'), '-Users-j-Documents-obot2-obot-agent');
});

test('transcriptPath prefers the hint, then the cwd slug, then a scan', () => {
  const root = ws();
  const projectsDir = path.join(root, 'projects');
  const cwd = '/Users/j/ws';
  const slugDir = path.join(projectsDir, projectSlug(cwd));
  fs.mkdirSync(slugDir, { recursive: true });
  const bySlug = path.join(slugDir, `${SID}.jsonl`);
  fs.writeFileSync(bySlug, '');
  assert.equal(transcriptPath({ sessionId: SID, cwd, projectsDir }), bySlug);

  const hint = path.join(root, `${SID}.jsonl`);
  fs.writeFileSync(hint, '');
  assert.equal(transcriptPath({ sessionId: SID, cwd, hint, projectsDir }), hint);
  // a hint for a different session is ignored
  assert.equal(
    transcriptPath({ sessionId: SID, cwd, hint: path.join(root, 'other.jsonl'), projectsDir }),
    bySlug,
  );
  // no cwd → fall back to scanning every project directory
  assert.equal(transcriptPath({ sessionId: SID, projectsDir }), bySlug);
  assert.equal(transcriptPath({ sessionId: 'missing', projectsDir }), null);
});

/* ---------------------------------------------------------------- server */

test('originAllowed passes loopback and no-Origin, refuses everything else', () => {
  assert.equal(originAllowed(undefined, 4181), true);      // curl / scripts
  assert.equal(originAllowed('null', 4181), true);         // file:// page
  assert.equal(originAllowed('http://127.0.0.1:4181', 4181), true);
  assert.equal(originAllowed('http://localhost:4181', 4181), true);
  assert.equal(originAllowed('http://127.0.0.1:9999', 4181), false);
  assert.equal(originAllowed('https://evil.example', 4181), false);
  assert.equal(originAllowed('not a url', 4181), false);
});

test('readTargets pins the join key, scopes to the workspace, and flags the lead', () => {
  const root = ws();
  const jobsDir = path.join(root, 'jobs');
  const workspace = path.join(root, 'ws');
  const write = (id, state) => {
    fs.mkdirSync(path.join(jobsDir, id), { recursive: true });
    fs.writeFileSync(path.join(jobsDir, id, 'state.json'), JSON.stringify(state));
  };
  write('lead', { sessionId: 'sid-lead', name: '😺🤖 lead', color: 'orange', state: 'working', cwd: workspace, updatedAt: '2026-07-25T01:00:00Z' });
  write('sib', { sessionId: 'sid-sib', name: '👯🤖 sibling', color: 'green', state: 'working', cwd: workspace, updatedAt: '2026-07-25T02:00:00Z' });
  write('elsewhere', { sessionId: 'sid-other', name: 'other workspace', cwd: '/somewhere/else' });
  write('nosession', { name: 'no sessionId' });
  write('junk', {});
  fs.writeFileSync(path.join(jobsDir, 'loose'), 'not a directory');

  const targets = readTargets({ jobsDir, workspace });
  assert.deepEqual(targets.map((t) => t.sessionId), ['sid-lead', 'sid-sib']);
  assert.equal(targets[0].lead, true);
  assert.equal(targets[1].lead, false);
  assert.equal(targets[0].chatCapable, false);
  ensureSessionDir(workspace, 'sid-lead');
  assert.equal(readTargets({ jobsDir, workspace })[0].chatCapable, true);
});

/* ------------------------------------------------- the hook lane, for real */

// The Stop hook re-implements frameMessage in Python (it must run without Node's
// module graph). This test is the guard against the two drifting apart, and it
// exercises the real claim path end to end.
test('the Stop hook claims a message and frames it exactly like frameMessage', () => {
  const w = ws();
  const hook = HOOK;
  const msg = enqueue(w, SID, { text: 'does the hook work?', now: 1700000000000 });

  const out = execFileSync(hook, ['--workspace', w], {
    input: JSON.stringify({ session_id: SID, stop_hook_active: false, transcript_path: '/dev/null' }),
    encoding: 'utf8',
  });
  const decision = JSON.parse(out);
  assert.equal(decision.decision, 'block');
  assert.equal(decision.reason, frameMessage(msg, { sessionId: SID }));

  // claimed, exactly once, annotated with the hook lane
  assert.equal(pending(w, SID).length, 0);
  const claimed = JSON.parse(fs.readFileSync(path.join(sessionDir(w, SID), 'delivered', `${msg.id}.json`), 'utf8'));
  assert.equal(claimed.lane, 'hook');
  assert.match(claimed.deliveredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

  // and a second stop with an empty inbox says nothing at all
  assert.equal(execFileSync(hook, ['--workspace', w], {
    input: JSON.stringify({ session_id: SID, stop_hook_active: false }), encoding: 'utf8',
  }), '');
});

test('the Stop hook stays silent for an unarmed session, a re-entrant stop, and junk input', () => {
  const w = ws();
  const hook = HOOK;
  const run = (input) => execFileSync(hook, ['--workspace', w], { input, encoding: 'utf8' });

  assert.equal(run(JSON.stringify({ session_id: 'never-armed' })), '', 'no chat dir → silent');
  enqueue(w, SID, { text: 'queued', now: 1000 });
  assert.equal(run(JSON.stringify({ session_id: SID, stop_hook_active: true })), '', 'never blocks twice in a row');
  assert.equal(pending(w, SID).length, 1, 'and does not consume the message either');
  assert.equal(run('not json at all'), '', 'junk payload → silent');
  assert.equal(run(''), '', 'empty payload → silent');
});
