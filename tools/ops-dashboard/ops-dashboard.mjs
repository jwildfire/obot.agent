#!/usr/bin/env node
// ops-dashboard — the Operations Dashboard.
//
// @jwildfire's local page: his todo list — release candidates, decisions, config —
// and the place he answers decision artifacts instead of reading them on the public
// site and typing the answer somewhere else. Requirement: jwildfire/obot.roadmap#180.
//
// It is also the site. Since 2026-08-15 ("I want the ops db and orginal ops hub to be
// merged. just make them 2 different tabs on the same (local) site for now. new ops db
// should be default view") this server carries both views: the dashboard at `/`, the
// session hub's live render at `/live.html` inside the same header. One port, and the
// serve marker the status line reads is written from here.
//
// Vocabulary, fixed by him on 2026-08-15: the **dashboard** is this local page; the
// **hub** is the public site with the roadmap, news and artifacts.
//
// Why it is local and not a button on the published page: a static site cannot
// write anywhere, and it is public — so any "approve" control there would have to
// prove the click came from him, which is an authentication product rather than a
// button, and it would put an approval-forgery surface on the internet. A click on
// a page served from 127.0.0.1 on his own machine is his by construction.
//
// The page holds no credential. An answer is written to the local ops store and an
// agent applies it to the artifact, the decision log and the index — anything able
// to write to the hub on his behalf holds real capability, and a browser page that
// also renders artifact content is the wrong place to keep it.
//
// Usage (from the workspace root):
//   node obot.agent/tools/ops-dashboard/ops-dashboard.mjs --serve --open
//
//   --workspace <dir>  workspace root (default: cwd)
//   --hub <dir>        obot.roadmap clone (default: <workspace>/obot.roadmap)
//   --port <n>         loopback port (default 7326; rolls forward if taken, and the
//                      bound port is what lands in the status line's serve marker)
//   --serve            run the server (without it, render once to stdout)
//   --open             print the URL when the server is up
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';

import { collectQueue, refreshRCs } from './lib/collect.mjs';
import { render, sessionShell, navigatorShell, NOT_LISTENING } from './lib/render.mjs';
import { parseNavigatorState } from './lib/navigator.mjs';
import { currentAnswers, recordAnswer } from './lib/answers.mjs';
import { ensureStore } from './lib/store.mjs';
import { runVerify, readChecks } from './lib/iq.mjs';
import { triage } from './lib/triage.mjs';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 7326;

// The session hub's live view, written by its own watch loop.
const SESSION_DIR = ['.claude', 'session-hub'];
const SESSION_LIVE = 'live.html';
const WATCH_CMD = 'node obot.agent/tools/session-hub/session-hub.mjs --watch';

export function parseArgs(argv) {
  const a = { port: DEFAULT_PORT, serve: false, open: false };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f === '--workspace') a.workspace = argv[++i];
    else if (f === '--hub') a.hub = argv[++i];
    else if (f === '--port') a.port = Number(argv[++i]) || DEFAULT_PORT;
    else if (f === '--serve') a.serve = true;
    else if (f === '--open') a.open = true;
    else if (f === '--help' || f === '-h') a.help = true;
    else { console.error(`unknown option: ${f}`); process.exit(2); }
  }
  a.workspace = path.resolve(a.workspace ?? process.cwd());
  a.hub = path.resolve(a.hub ?? path.join(a.workspace, 'obot.roadmap'));
  return a;
}

/**
 * Map `/artifact/<slug>/` to the artifact in the hub clone.
 *
 * The artifacts are self-contained single files by contract, so one file is the
 * whole page. The slug is checked against the decisions folder rather than joined
 * blindly: this server can reach the whole disk, and a request path is not a
 * filename until something says it is.
 */
export function artifactPath(hub, url) {
  const m = /^\/artifact\/([^/?#]+)\/?$/.exec(url.split('?')[0]);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]);
  if (!/^[A-Za-z0-9._-]+$/.test(slug) || slug.startsWith('.')) return null;
  const file = path.join(hub, 'reports', 'decisions', slug, 'index.html');
  return fs.existsSync(file) ? file : null;
}

/** The session hub's rendered live view, or null when no watch loop has run yet. */
export function sessionLivePath(workspace) {
  const file = path.join(workspace, ...SESSION_DIR, SESSION_LIVE);
  return fs.existsSync(file) ? file : null;
}

/**
 * Advertise this server in the session hub's `serve.json`, the marker the status line
 * reads for its link (tools/statusline). The two views are one site now, so the marker
 * points here and `/live.html` lands on the session tab — the link keeps resolving
 * without the status line knowing anything changed.
 *
 * Same contract as session-hub's own `serveHub`: `{port, pid, url, startedAt}`, and it
 * is removed on exit only when the pid still matches, so a server that outlives this
 * one keeps its own marker.
 */
export function writeServeMarker(workspace, { port, url }) {
  const dir = path.join(workspace, ...SESSION_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(dir, 'serve.json');
  fs.writeFileSync(marker, `${JSON.stringify({
    port, pid: process.pid, url, startedAt: new Date().toISOString(), site: 'ops-dashboard',
  }, null, 2)}\n`);
  const cleanup = () => {
    try {
      if (JSON.parse(fs.readFileSync(marker, 'utf8')).pid === process.pid) fs.unlinkSync(marker);
    } catch { /* already gone, or another server's marker — leave it */ }
  };
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(0); });
  return marker;
}

/**
 * Is anything listening for the answers he records?
 *
 * The deliverer is the 🧭🤖 Navigator sweep (launchd, every five minutes). Its
 * state file is the heartbeat, and the file's own rule — a `swept:` stamp older
 * than three cadences means the observer is dead — is the one this reuses. An
 * absent file is the same answer as a dead one: nothing is listening.
 *
 * This exists so the page can *say* that. An answer sitting in a queue nobody
 * reads must never look like an answer that landed.
 */
export function delivererState(workspace) {
  const file = path.join(workspace, ...SESSION_DIR, 'navigator-state.md');
  try {
    const s = parseNavigatorState(fs.readFileSync(file, 'utf8'));
    return { alive: !s.stale, sweptAt: s.sweptAt, ageMin: s.ageMin };
  } catch {
    return { alive: false, missing: true, sweptAt: null, ageMin: null };
  }
}

async function page(args) {
  const queue = await collectQueue(args.workspace, args.hub, {
    agent: path.join(args.workspace, 'obot.agent', 'scripts', 'reviews-queue'),
  });
  // The last recorded pass/fail per item, so an installation qualification opens
  // showing whether it has ever been proved rather than starting blank.
  const checks = readChecks(args.workspace);
  const withChecks = (g) => ({ ...g, items: (g.items ?? []).map((i) => (checks[i.id] ? { ...i, check: checks[i.id] } : i)) });
  return render({
    queue: {
      ...queue,
      config: withChecks(queue.config),
      critical: (queue.critical ?? []).map((i) => (checks[i.id] ? { ...i, check: checks[i.id] } : i)),
    },
    answers: currentAnswers(args.workspace, { hub: args.hub }),
    deliverer: delivererState(args.workspace),
    workspace: args.workspace,
    hub: args.hub,
  });
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export function serve(args) {
  ensureStore(args.workspace);
  const rq = path.join(args.workspace, 'obot.agent', 'scripts', 'reviews-queue');
  if (fs.existsSync(rq)) refreshRCs(args.workspace, rq);

  const server = http.createServer(async (req, res) => {
    const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    try {
      if (req.method === 'POST' && req.url.split('?')[0] === '/answer') {
        const answer = JSON.parse(await readBody(req));
        let result;
        try {
          result = recordAnswer(args.workspace, answer, { hub: args.hub });
        } catch (e) {
          // A refusal he can act on. The old handler took anything with a verdict
          // string, which is how a "per-question" answer holding no questions
          // reached disk on 2026-08-15.
          return send(400, 'application/json', JSON.stringify({ error: e.message }));
        }
        const { record, duplicate } = result;
        const listening = delivererState(args.workspace).alive;
        return send(200, 'application/json', JSON.stringify({
          ok: true,
          id: record.id,
          decisionId: record.decisionId,
          decisionIdError: record.decisionIdError,
          status: record.status,
          duplicate,
          supersedes: record.supersedes,
          // What happens next, in one sentence, because the page's job is to
          // answer "what did clicking that do?" before he has to ask.
          next: 'Recorded on this machine. The Navigator picks it up within five minutes, then an agent updates the artifact — nothing else for you to do.',
          warning: listening ? null : NOT_LISTENING,
        }));
      }

      // Delete and snooze, for anything in the list. The store is a ledger and
      // this route only appends to it — no source file is ever edited from a
      // click, so a dismissal stays recoverable and the config list keeps its
      // own retire-with-strikethrough convention.
      if (req.method === 'POST' && req.url.split('?')[0] === '/triage') {
        const body = JSON.parse(await readBody(req));
        try {
          const rec = triage(args.workspace, body);
          return send(200, 'application/json', JSON.stringify({ ok: true, at: rec.at }));
        } catch (e) {
          return send(400, 'application/json', JSON.stringify({ error: e.message }));
        }
      }

      // Run one installation qualification's proof and record the result. The
      // command is taken from the request, so it is re-checked against the
      // read-only allowlist here rather than trusted because the page sent it —
      // the page is the least trustworthy thing in this process.
      if (req.method === 'POST' && req.url.split('?')[0] === '/check') {
        const body = JSON.parse(await readBody(req));
        if (!body.command) return send(400, 'application/json', JSON.stringify({ error: 'no command' }));
        const rec = await runVerify(args.workspace, {
          id: body.id ?? body.key, command: body.command, expect: body.expect ?? null,
        });
        return send(200, 'application/json', JSON.stringify(rec));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain', 'method not allowed');

      const file = artifactPath(args.hub, req.url);
      if (file) return send(200, 'text/html; charset=utf-8', fs.readFileSync(file));

      const p = req.url.split('?')[0];
      if (p === '/' || p === '/index.html') return send(200, 'text/html; charset=utf-8', await page(args));

      // The second tab. `/live.html` is the address the status line already builds;
      // `/session` is the readable alias, and `/session/frame` is the session hub's
      // own render, served byte-for-byte inside the shell.
      if (p === '/live.html' || p === '/session' || p === '/session/') {
        return send(200, 'text/html; charset=utf-8', sessionShell({
          missing: sessionLivePath(args.workspace) ? null : WATCH_CMD,
        }));
      }
      if (p === '/session/frame') {
        const live = sessionLivePath(args.workspace);
        if (!live) return send(404, 'text/plain', `no session view yet — run: ${WATCH_CMD}`);
        return send(200, 'text/html; charset=utf-8', fs.readFileSync(live));
      }

      // The third tab: what the 🧭🤖 Navigator sweep has seen, read fresh on every
      // request — the file is rewritten every five minutes and a cached copy of an
      // observer's state is exactly the thing that must not go stale silently.
      if (p === '/navigator' || p === '/navigator/') {
        const file = path.join(args.workspace, ...SESSION_DIR, 'navigator-state.md');
        let md = null;
        try { md = fs.readFileSync(file, 'utf8'); } catch { /* no sweep yet */ }
        return send(200, 'text/html; charset=utf-8', navigatorShell(
          md ? { state: parseNavigatorState(md) } : { missing: file },
        ));
      }

      if (p === '/queue.json') {
        const q = await collectQueue(args.workspace, args.hub);
        return send(200, 'application/json', JSON.stringify({ items: q.items }, null, 2));
      }
      return send(404, 'text/plain', 'not found');
    } catch (e) {
      send(500, 'text/plain', `ops-dashboard: ${e.message}`);
    }
  });

  return new Promise((resolve) => {
    const listen = (port, left) => {
      server.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && left > 0) return listen(port + 1, left - 1);
        throw e;
      });
      // Report the bound port, not the requested one — `--port 0` means "any free
      // port", and the marker the status line reads has to name the real one.
      server.listen(port, HOST, () => {
        const bound = server.address().port;
        const url = `http://${HOST}:${bound}/`;
        writeServeMarker(args.workspace, { port: bound, url: `${url}live.html` });
        resolve({ server, url });
      });
    };
    listen(args.port, 20);
  });
}

const invoked = process.argv[1] && path.resolve(process.argv[1]).endsWith('ops-dashboard.mjs');
if (invoked) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('ops-dashboard — the Operations Dashboard (local only). See the header of this file.');
  } else if (args.serve) {
    const { url } = await serve(args);
    console.log(`ops-dashboard: ${url}`);
    if (args.open) console.log(url);
  } else {
    process.stdout.write(await page(args));
  }
}
