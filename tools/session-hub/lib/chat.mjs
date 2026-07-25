// Chat protocol for the session hub (design #77).
//
// Two halves, both file-based and both usable without the server:
//
//   1. The INBOX — how a prompt reaches a running session. A producer writes a
//      JSON file into <workspace>/.claude/session-chat/<sessionId>/inbox/; a
//      consumer (the Stop hook, or the obot-chat-wait monitor lane) CLAIMS it
//      with an atomic rename into delivered/ and hands the framed text to the
//      agent. Atomicity is the whole concurrency story: two claimers cannot
//      deliver the same message twice.
//
//   2. The REPLY — how the answer comes back. The session's transcript JSONL is
//      tailed from a byte offset recorded at send time; assistant content blocks
//      become activity/text events and `stop_reason: "end_turn"` ends the turn.
//      No cooperation from the session is required for this half at all.
//
// The transcript shape is harness-internal (same caveat #24 carries for
// state.json): the block kinds below are pinned, everything else is ignored
// rather than fatal, so a format change degrades the panel instead of crashing
// the server.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const CHAT_DIRNAME = 'session-chat';

export function chatRoot(workspace) {
  return path.join(workspace, '.claude', CHAT_DIRNAME);
}

export function sessionDir(workspace, sessionId) {
  return path.join(chatRoot(workspace), sessionId);
}

const sub = (workspace, sessionId, name) => path.join(sessionDir(workspace, sessionId), name);

/** Create the directory skeleton for one session. Idempotent. */
export function ensureSessionDir(workspace, sessionId) {
  const dir = sessionDir(workspace, sessionId);
  for (const d of ['inbox', 'delivered', 'outbox']) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
  }
  return dir;
}

/** True when this session has a chat directory — i.e. someone opted it in. */
export function isChatCapable(workspace, sessionId) {
  try {
    return fs.statSync(sub(workspace, sessionId, 'inbox')).isDirectory();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ inbox */

/**
 * Write a message into a session's inbox. Returns the stored message.
 * `now` is injectable so tests are deterministic.
 */
export function enqueue(workspace, sessionId, { text, from = 'dashboard', now = Date.now() } = {}) {
  const body = String(text ?? '').trim();
  if (!body) throw new Error('empty message');
  ensureSessionDir(workspace, sessionId);
  const id = crypto.randomUUID().slice(0, 8);
  const msg = { id, from, text: body, createdAt: new Date(now).toISOString() };
  const file = path.join(sub(workspace, sessionId, 'inbox'), `${now}-${id}.json`);
  // Write-then-rename so a claimer never sees a half-written message.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(msg, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return { ...msg, file };
}

/** Pending messages, oldest first. Never throws. */
export function pending(workspace, sessionId) {
  let names;
  try {
    names = fs.readdirSync(sub(workspace, sessionId, 'inbox'));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    const file = path.join(sub(workspace, sessionId, 'inbox'), name);
    try {
      out.push({ ...JSON.parse(fs.readFileSync(file, 'utf8')), file });
    } catch {
      // unreadable or mid-write: skip, it will be picked up next poll
    }
  }
  return out;
}

/**
 * Claim the oldest pending message: atomically move it to delivered/ and return
 * it. Returns null when the inbox is empty. Safe to call concurrently — the
 * rename is the lock, so a loser sees ENOENT and moves on to the next file.
 */
export function claim(workspace, sessionId, { lane = 'hook', now = Date.now() } = {}) {
  for (const msg of pending(workspace, sessionId)) {
    const dest = path.join(sub(workspace, sessionId, 'delivered'), `${msg.id}.json`);
    try {
      fs.renameSync(msg.file, dest);
    } catch {
      continue; // someone else claimed it
    }
    const claimed = { ...msg, deliveredAt: new Date(now).toISOString(), lane };
    delete claimed.file;
    try {
      fs.writeFileSync(dest, `${JSON.stringify(claimed, null, 2)}\n`);
    } catch {
      // the rename already happened, which is what "delivered" means; losing the
      // annotation is cosmetic
    }
    return { ...claimed, file: dest };
  }
  return null;
}

/**
 * The text actually handed to the agent. This is the only place chat behaviour
 * is taught, so it says what kind of turn this is and what to do with it.
 */
export function frameMessage(msg, { sessionId } = {}) {
  const when = (msg.createdAt ?? '').slice(11, 16);
  return [
    `[dashboard chat] @jwildfire sent this from the live session dashboard${when ? ` at ${when} UTC` : ''}:`,
    '',
    msg.text,
    '',
    'Answer it now, in your normal response text — that text streams straight back to the',
    'dashboard, so keep it conversational and short unless he asked for depth. This is a chat',
    'turn, not a new work order: do not kick off a large task off the back of it unless he',
    'clearly asked for one, and do not treat it as approval for anything gated. When you have',
    'answered, carry on with what you were doing (or finish, if you were finishing).',
    sessionId
      ? `Message ${msg.id} is already claimed — nothing to clean up. If you want to mark a canonical reply, write .claude/${CHAT_DIRNAME}/${sessionId}/outbox/${msg.id}.json as {"id":"${msg.id}","text":"…"}; otherwise your response text is the reply.`
      : `Message ${msg.id} is already claimed — nothing to clean up.`,
  ].join('\n');
}

/* ----------------------------------------------------------------- outbox */

/** Explicit replies the agent wrote (D4's optional lane). Oldest first. */
export function drainOutbox(workspace, sessionId) {
  const dir = sub(workspace, sessionId, 'outbox');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    const file = path.join(dir, name);
    try {
      const msg = JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.unlinkSync(file);
      out.push(msg);
    } catch {
      try { fs.unlinkSync(file); } catch { /* leave it */ }
    }
  }
  return out;
}

/* -------------------------------------------------------------- chat log */

/**
 * Append one turn to the derived chat log. The transcript is the source of
 * truth; this file exists so a browser reload can rebuild the panel, and it can
 * be deleted at any time without losing anything.
 */
export function appendLog(workspace, sessionId, entry) {
  ensureSessionDir(workspace, sessionId);
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`;
  try {
    fs.appendFileSync(path.join(sessionDir(workspace, sessionId), 'log.jsonl'), line);
  } catch {
    // a missing log is cosmetic
  }
}

export function readLog(workspace, sessionId, { limit = 200 } = {}) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(sessionDir(workspace, sessionId), 'log.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out.slice(-limit);
}

/* ------------------------------------------------------------ transcript */

/** ~/.claude/projects/<slug>/ — the slug is the cwd with non-alphanumerics as '-'. */
export function projectSlug(cwd) {
  return String(cwd ?? '').replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Resolve a session's transcript file. Prefers the path the harness already
 * recorded (state.json.linkScanPath), then the slug derived from the session's
 * cwd, then a scan of every project directory. Returns null when nothing matches.
 */
export function transcriptPath({
  sessionId,
  cwd,
  hint,
  projectsDir = path.join(os.homedir(), '.claude', 'projects'),
} = {}) {
  const ok = (p) => {
    try { return p && fs.statSync(p).isFile() ? p : null; } catch { return null; }
  };
  if (hint && path.basename(hint) === `${sessionId}.jsonl`) {
    const found = ok(hint);
    if (found) return found;
  }
  if (cwd) {
    const found = ok(path.join(projectsDir, projectSlug(cwd), `${sessionId}.jsonl`));
    if (found) return found;
  }
  let dirs;
  try {
    dirs = fs.readdirSync(projectsDir);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const found = ok(path.join(projectsDir, d, `${sessionId}.jsonl`));
    if (found) return found;
  }
  return null;
}

export function fileSize(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}

const toolDetail = (input) => {
  if (!input || typeof input !== 'object') return '';
  for (const k of ['description', 'file_path', 'pattern', 'command', 'query', 'url', 'prompt']) {
    if (typeof input[k] === 'string' && input[k].trim()) {
      const one = input[k].trim().split('\n')[0];
      return one.length > 120 ? `${one.slice(0, 117)}…` : one;
    }
  }
  return '';
};

/**
 * Turn a slab of transcript JSONL into stream events.
 *
 * Pinned shape (design #77 §5): `assistant` entries whose message.content holds
 * `thinking` / `tool_use` / `text` blocks, `message.stop_reason === "end_turn"`
 * for turn completion, and `isSidechain: true` for subagent noise (skipped).
 * Unknown types and unknown block kinds are ignored, never fatal.
 *
 * Returns { events, consumed } where `consumed` is the number of bytes of
 * COMPLETE lines — the caller advances its offset by that so a half-written
 * final line is re-read next poll.
 */
export function parseTranscriptChunk(chunk) {
  const events = [];
  const lastNewline = chunk.lastIndexOf('\n');
  const consumed = lastNewline === -1 ? 0 : Buffer.byteLength(chunk.slice(0, lastNewline + 1), 'utf8');
  const lines = lastNewline === -1 ? [] : chunk.slice(0, lastNewline).split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row?.type !== 'assistant' || row.isSidechain === true) continue;
    const msg = row.message;
    const at = typeof row.timestamp === 'string' ? row.timestamp : new Date().toISOString();
    const content = Array.isArray(msg?.content) ? msg.content : [];
    for (const block of content) {
      switch (block?.type) {
        case 'thinking':
          events.push({ kind: 'thinking', at });
          break;
        case 'tool_use':
          events.push({ kind: 'tool', at, name: String(block.name ?? 'tool'), detail: toolDetail(block.input) });
          break;
        case 'text':
          if (typeof block.text === 'string' && block.text.trim()) {
            events.push({ kind: 'text', at, text: block.text });
          }
          break;
        default:
          break; // unknown block kinds are not errors
      }
    }
    if (msg?.stop_reason === 'end_turn') events.push({ kind: 'end_turn', at });
  }
  return { events, consumed };
}

/** Read from `offset` to EOF and parse. Returns { events, offset } (the new offset). */
export function tailTranscript(file, offset) {
  let size;
  try { size = fs.statSync(file).size; } catch { return { events: [], offset }; }
  if (size <= offset) return { events: [], offset: Math.min(offset, size) };
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return { events: [], offset }; }
  try {
    const len = size - offset;
    const buf = Buffer.allocUnsafe(len);
    fs.readSync(fd, buf, 0, len, offset);
    const { events, consumed } = parseTranscriptChunk(buf.toString('utf8'));
    return { events, offset: offset + consumed };
  } catch {
    return { events: [], offset };
  } finally {
    try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}
