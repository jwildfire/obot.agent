#!/usr/bin/env node
// session-chat — the loopback server behind the session hub's chat panel
// (jwildfire/obot.roadmap#77; design requirements/design/77_design.html).
//
// It does three things and deliberately nothing else:
//   1. hosts the live dashboard (rendered on demand, short TTL) so the chat panel
//      is same-origin — no CORS, and no separate --watch process;
//   2. accepts a prompt and writes it into the target session's chat inbox;
//   3. streams the reply back over SSE by tailing that session's transcript.
//
// Zero dependencies (Node >= 18, stdlib only).
//
// SECURITY (design §7). This is a prompt-injection lane into a live agent
// session: anything that can POST here can make the orchestrator act. Therefore
// it binds 127.0.0.1 with no option to widen, requires a JSON content type and a
// loopback Origin on writes, holds no credentials, and is not a daemon — it runs
// while someone is looking at the dashboard and stops with them.
//
// Usage (from the workspace root):
//   node obot.agent/tools/session-hub/session-chat.mjs                 # port 4181
//   node obot.agent/tools/session-hub/session-chat.mjs --port 4200 --open
//
// Options:
//   --port <n>          listen port (default 4181), always on 127.0.0.1
//   --workspace <dir>   workspace root (default: cwd)
//   --hub <dir>         obot.roadmap clone (default: <workspace>/obot.roadmap)
//   --ttl <sec>         dashboard re-render TTL (default 20)
//   --open              print the URL after binding

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { generate } from './session-hub.mjs';
import {
  appendLog, claim, drainOutbox, ensureSessionDir, isChatCapable, pending,
  enqueue, readLog, sessionDir, tailTranscript, transcriptPath, fileSize,
} from './lib/chat.mjs';

const HOST = '127.0.0.1'; // not configurable, by design (§7)
const DEFAULT_PORT = 4181;

function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, ttl: 20, open: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') args.port = Number(argv[++i]) || DEFAULT_PORT;
    else if (a === '--workspace') args.workspace = argv[++i];
    else if (a === '--hub') args.hub = argv[++i];
    else if (a === '--ttl') args.ttl = Math.max(2, Number(argv[++i]) || 20);
    else if (a === '--open') args.open = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else { console.error(`unknown option: ${a}`); process.exit(2); }
  }
  return args;
}

/* --------------------------------------------------------------- targets */

// Chat targets come from the same ~/.claude/jobs/<id>/state.json the dashboard
// already reads. sessionId is the join key: it is what the hook payload carries
// and what names the transcript file.
export function readTargets({ jobsDir = path.join(os.homedir(), '.claude', 'jobs'), workspace } = {}) {
  let ids;
  try {
    ids = fs.readdirSync(jobsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const out = [];
  for (const id of ids) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(jobsDir, id, 'state.json'), 'utf8'));
    } catch {
      continue;
    }
    if (typeof raw.sessionId !== 'string') continue;
    if (workspace && typeof raw.cwd === 'string' && !raw.cwd.startsWith(workspace)) continue;
    out.push({
      job: id,
      sessionId: raw.sessionId,
      name: typeof raw.name === 'string' ? raw.name : `job ${id}`,
      color: typeof raw.color === 'string' ? raw.color : null,
      state: typeof raw.state === 'string' ? raw.state : 'unknown',
      detail: typeof raw.detail === 'string' ? raw.detail : '',
      cwd: typeof raw.cwd === 'string' ? raw.cwd : null,
      transcriptHint: typeof raw.linkScanPath === 'string' ? raw.linkScanPath : null,
      updatedAt: raw.updatedAt ?? null,
      lead: raw.color === 'orange',
      chatCapable: workspace ? isChatCapable(workspace, raw.sessionId) : false,
      queued: workspace ? pending(workspace, raw.sessionId).length : 0,
    });
  }
  // lead first, then most recently updated
  out.sort((a, b) => (b.lead - a.lead) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return out;
}

/* ------------------------------------------------------------- streaming */

// One watcher per session with listeners. It polls the chat directory (delivery)
// and the transcript (reply) at a fixed cadence and fans events out to every
// attached SSE client.
class Watcher {
  constructor({ workspace, target, intervalMs = 700 }) {
    this.workspace = workspace;
    this.target = target;
    this.intervalMs = intervalMs;
    this.clients = new Set();
    this.offset = null;
    this.timer = null;
    this.seenDelivered = new Set();
    this.lastQueued = null;
    // A send holds the watcher open even with no SSE client attached, so a reply
    // that lands while the browser is closed (or pointed at another session)
    // still reaches log.jsonl. Released at end_turn, capped by HOLD_MS.
    this.holdUntil = 0;
  }

  static HOLD_MS = 10 * 60 * 1000;

  ensureTimer() {
    if (!this.timer) this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stopTimerIfDone() {
    if (this.timer && !this.clients.size && Date.now() > this.holdUntil) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  transcript() {
    return transcriptPath({
      sessionId: this.target.sessionId,
      cwd: this.target.cwd,
      hint: this.target.transcriptHint,
    });
  }

  /** Called at send time: only stream what happens from here on, and start ticking. */
  markSendOffset() {
    const file = this.transcript();
    this.offset = file ? fileSize(file) : 0;
    this.holdUntil = Date.now() + Watcher.HOLD_MS;
    this.ensureTimer();
  }

  add(res) {
    this.clients.add(res);
    if (this.offset === null) this.markSendOffset();
    this.ensureTimer();
  }

  remove(res) {
    this.clients.delete(res);
    this.stopTimerIfDone();
  }

  emit(event) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this.clients) {
      try { res.write(payload); } catch { this.clients.delete(res); }
    }
  }

  tick() {
    const { workspace, target } = this;
    // 1. delivery: a file that appeared in delivered/ since we started
    try {
      const dir = path.join(sessionDir(workspace, target.sessionId), 'delivered');
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.json') || this.seenDelivered.has(name)) continue;
        this.seenDelivered.add(name);
        let msg = {};
        try { msg = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { /* ignore */ }
        if (msg.deliveredAt) {
          this.emit({ type: 'delivered', id: msg.id, lane: msg.lane ?? null, at: msg.deliveredAt });
        }
      }
    } catch { /* no chat dir yet */ }

    // 2. queue depth, so "not answered yet" is legible (design §4, D3)
    const queued = pending(workspace, target.sessionId).length;
    if (queued !== this.lastQueued) { this.lastQueued = queued; this.emit({ type: 'queued', queued }); }

    // 3. explicit outbox replies (D4's optional lane)
    for (const reply of drainOutbox(workspace, target.sessionId)) {
      if (typeof reply.text === 'string' && reply.text.trim()) {
        appendLog(workspace, target.sessionId, { role: 'agent', text: reply.text, source: 'outbox' });
        this.emit({ type: 'text', text: reply.text, source: 'outbox' });
      }
    }

    // 4. the reply: transcript tail
    const file = this.transcript();
    if (!file) {
      this.emit({ type: 'notice', text: 'transcript not found — reply not readable' });
      this.stopTimerIfDone();
      return;
    }
    const { events, offset } = tailTranscript(file, this.offset ?? fileSize(file));
    this.offset = offset;
    for (const ev of events) {
      if (ev.kind === 'text') {
        appendLog(workspace, target.sessionId, { role: 'agent', text: ev.text, source: 'transcript' });
        this.emit({ type: 'text', text: ev.text, at: ev.at });
      } else if (ev.kind === 'tool') {
        this.emit({ type: 'activity', name: ev.name, detail: ev.detail, at: ev.at });
      } else if (ev.kind === 'thinking') {
        this.emit({ type: 'thinking', at: ev.at });
      } else if (ev.kind === 'end_turn') {
        this.emit({ type: 'end_turn', at: ev.at });
        this.holdUntil = 0; // the reply landed; nothing left to hold for
      }
    }
    this.stopTimerIfDone();
  }
}

/* ---------------------------------------------------------------- server */

const json = (res, code, body) => {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
};

/**
 * Writes must come from the loopback page, not from any site the browser happens
 * to have open. An absent Origin (curl, a script) is allowed — the loopback bind
 * is what protects that case; a *foreign* Origin is refused.
 */
export function originAllowed(origin, port) {
  if (!origin || origin === 'null') return true;
  try {
    const u = new URL(origin);
    return (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && (!u.port || u.port === String(port));
  } catch {
    return false;
  }
}

export function createServer({ workspace, hub, ttl, port }) {
  const watchers = new Map();
  let cache = { html: null, at: 0 };

  const targetFor = (sessionId) => readTargets({ workspace }).find((t) => t.sessionId === sessionId);

  const watcherFor = (target) => {
    let w = watchers.get(target.sessionId);
    if (!w) { w = new Watcher({ workspace, target }); watchers.set(target.sessionId, w); }
    w.target = target; // refresh state/detail
    return w;
  };

  const dashboard = () => {
    const now = Date.now();
    if (cache.html && now - cache.at < ttl * 1000) return cache.html;
    try {
      const { html } = generate({ workspace, hub, mode: 'live', chat: { port } });
      cache = { html, at: now };
    } catch (err) {
      if (!cache.html) throw err;
      console.error(`[session-chat] render failed, serving cached page: ${err.message}`);
    }
    return cache.html;
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${HOST}:${port}`);
    const write = req.method === 'POST';
    if (write && !originAllowed(req.headers.origin, port)) {
      json(res, 403, { error: 'cross-origin write refused' });
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      let html;
      try { html = dashboard(); } catch (err) { json(res, 500, { error: `render failed: ${err.message}` }); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/targets') {
      json(res, 200, { targets: readTargets({ workspace }) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/log') {
      const sessionId = url.searchParams.get('session') ?? '';
      json(res, 200, {
        log: readLog(workspace, sessionId),
        queued: pending(workspace, sessionId).length,
        chatCapable: isChatCapable(workspace, sessionId),
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/send') {
      if (!String(req.headers['content-type'] ?? '').includes('application/json')) {
        json(res, 415, { error: 'application/json required' });
        return;
      }
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 64_000) { req.destroy(); }
      });
      req.on('end', () => {
        let payload;
        try { payload = JSON.parse(body); } catch { json(res, 400, { error: 'bad JSON' }); return; }
        const sessionId = String(payload.session ?? '');
        const target = targetFor(sessionId);
        if (!target) { json(res, 404, { error: 'unknown session' }); return; }
        let msg;
        try {
          msg = enqueue(workspace, sessionId, { text: payload.text, from: 'dashboard' });
        } catch (err) {
          json(res, 400, { error: err.message });
          return;
        }
        appendLog(workspace, sessionId, { role: 'user', text: msg.text, id: msg.id });
        // Only stream what happens after this point.
        watcherFor(target).markSendOffset();
        json(res, 200, { id: msg.id, queued: pending(workspace, sessionId).length });
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/arm') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let payload;
        try { payload = JSON.parse(body || '{}'); } catch { json(res, 400, { error: 'bad JSON' }); return; }
        const sessionId = String(payload.session ?? '');
        if (!targetFor(sessionId)) { json(res, 404, { error: 'unknown session' }); return; }
        ensureSessionDir(workspace, sessionId);
        json(res, 200, { armed: true, dir: sessionDir(workspace, sessionId) });
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      const sessionId = url.searchParams.get('session') ?? '';
      const target = targetFor(sessionId);
      if (!target) { json(res, 404, { error: 'unknown session' }); return; }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      const w = watcherFor(target);
      w.add(res);
      const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch { /* ignore */ } }, 25_000);
      req.on('close', () => { clearInterval(ka); w.remove(res); });
      return;
    }

    json(res, 404, { error: 'not found' });
  });

  return server;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 34).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  const workspace = path.resolve(args.workspace ?? process.cwd());
  const hub = path.resolve(args.hub ?? path.join(workspace, 'obot.roadmap'));
  const server = createServer({ workspace, hub, ttl: args.ttl, port: args.port });
  server.listen(args.port, HOST, () => {
    const url = `http://${HOST}:${args.port}/`;
    console.log(`[session-chat] listening on ${url} (loopback only) · workspace ${workspace}`);
    if (args.open) console.log(url);
  });
  server.on('error', (err) => {
    console.error(`[session-chat] ${err.code === 'EADDRINUSE' ? `port ${args.port} already in use` : err.message}`);
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
