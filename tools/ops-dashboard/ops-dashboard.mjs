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
//   --port <n>         loopback port (default 7326; rolls forward if taken). Naming a
//                      port other than the default marks this as a test server: it
//                      serves normally but never claims the serve marker, so it cannot
//                      take the status line away from the real dashboard (#142)
//   --exclusive        bind the requested port or exit 1, instead of rolling forward.
//                      What an automatic restart uses: a replacement that silently
//                      lands on the next port is worse than one that failed
//   --serve            run the server (without it, render once to stdout)
//   --open             print the URL when the server is up
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';

import { collectQueue, refreshRCs } from './lib/collect.mjs';
import { render, sessionShell, sessionLogShell, navigatorShell, navigatorRecordShell, NOT_LISTENING, wirePage,
} from './lib/render.mjs';
import { parseNavigatorState } from './lib/navigator.mjs';
import { buildMetricsModel, buildFeedModel, parseFilters } from './lib/metrics-view.mjs';
import { buildSessionFeed } from './lib/feed.mjs';
import { parseDeliveryJournal } from './lib/log-view.mjs';
import { currentAnswers, recordAnswer } from './lib/answers.mjs';
import { ensureStore, opsDir } from './lib/store.mjs';
import { seenAndNote, lastSeen } from './lib/last-seen.mjs';
import { runVerify, readChecks } from './lib/iq.mjs';
import { triage } from './lib/triage.mjs';
import { collectRoster } from './lib/roster.mjs';
import { labelIsPinned, readPins, writePin } from './lib/pins.mjs';
import { autoUpdate, captureCode, codeState, fetchHub, resolveHub } from './lib/provenance.mjs';
import { markerPath, holdServeMarker } from './lib/serve-marker.mjs';

const HOST = '127.0.0.1';
// One value for "the port this machine's dashboard lives on", because two things now
// depend on agreeing about it: this server, which claims the serve marker only on the
// default port, and the sweep's restarter, which will only ever restart the process
// holding that marker (tools/navigator/selfupdate.mjs). The override exists so a
// scratch machine can move both together and rehearse the restart without going
// anywhere near his — same reason `OBOT_WORKSPACE` exists.
const DEFAULT_PORT = Number(process.env.OBOT_DASHBOARD_PORT) || 7326;

// The commit this process is running, taken at load rather than at render time — a
// long-running server's checkout moves on beneath it, so reading HEAD during a request
// describes the code that is precisely *not* being served. See lib/provenance.mjs.
const CODE = captureCode(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..'));

// How often the hub clone's remote-tracking refs are refreshed, so "what has he
// decided" is never answered out of a clone that stopped looking when the server
// started. Read-only: no branch and no working tree is touched.
const HUB_FETCH_MIN = 5;

// The session hub's live view, written by its own watch loop.
const SESSION_DIR = ['.claude', 'session-hub'];
const SESSION_LIVE = 'live.html';
const WATCH_CMD = 'node obot.agent/tools/session-hub/session-hub.mjs --watch';

// The routes that serve one page are one surface: `/index.html` is the dashboard,
// and `/session` is the address the tab strip uses for the live view the status
// line calls `/live.html`. Recording them apart would split one look into three.
const SURFACE_ALIASES = { '/index.html': '/', '/session': '/live.html', '/wire': '/wire.html' };

export function parseArgs(argv) {
  // `claimMarker` is the whole of the primary fix for #142: a server told an
  // explicit non-default port is a test server, and a test server is never the
  // machine's dashboard, so it declines the marker instead of taking it.
  const a = { port: DEFAULT_PORT, serve: false, open: false, claimMarker: true, exclusive: false };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f === '--workspace') a.workspace = argv[++i];
    else if (f === '--hub') a.hub = argv[++i];
    else if (f === '--port') { a.port = Number(argv[++i]) || DEFAULT_PORT; a.claimMarker = a.port === DEFAULT_PORT; }
    // Bind the port asked for or fail loudly. The roll-forward is right for a person
    // starting a second copy by hand and wrong for an automatic restart: a replacement
    // that quietly lands on 7327 is a dashboard nobody can find and a serve marker
    // nobody holds — obot.agent#142 arrived at by a different road.
    else if (f === '--exclusive') a.exclusive = true;
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
 * Claiming it is conditional, and declining is the normal outcome for a second
 * instance: the rules and the reasons live in `lib/serve-marker.mjs` (#142). The
 * return value says which happened, so the caller can print it rather than leaving
 * a silent no-op.
 */
export function writeServeMarker(workspace, { port, url, requestedPort, claim = true }) {
  return holdServeMarker(markerPath(workspace), {
    port, url, site: 'ops-dashboard', requestedPort, claim,
  });
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

/**
 * Where this render's decisions come from — his clone, or the freshest committed state
 * of it. Resolved once per request, so the queue, the answers panel and the artifact
 * routes all read the same tree and cannot disagree about what he has decided.
 */
export function hubSource(args) {
  try { return resolveHub(args.hub, path.join(opsDir(args.workspace), 'cache')); } catch {
    return { root: args.hub, source: 'clone', warn: 'hub provenance unavailable — reading the clone as-is' };
  }
}

/** The sweep script, when this machine has one. Null is a state, not a path. */
export function sweepScript(workspace) {
  const rq = path.join(workspace, 'obot.agent', 'scripts', 'reviews-queue');
  return fs.existsSync(rq) ? rq : null;
}

async function page(args, lastLook = null) {
  const hub = hubSource(args);
  // A path that does not exist is not a collector. Handing one to the sweep meant
  // every render fired a spawn that failed with ENOENT and left the page promising
  // a sweep that could not start (jwildfire/obot.roadmap#223).
  const queue = await collectQueue(args.workspace, hub.root, { agent: sweepScript(args.workspace) });
  // The last recorded pass/fail per item, so an installation qualification opens
  // showing whether it has ever been proved rather than starting blank.
  const checks = readChecks(args.workspace);
  const check = (i) => checks[i.id ?? i.key];
  const withChecks = (g) => ({ ...g, items: (g.items ?? []).map((i) => (check(i) ? { ...i, check: check(i) } : i)) });
  return render({
    queue: {
      ...queue,
      config: withChecks(queue.config),
      critical: (queue.critical ?? []).map((i) => (check(i) ? { ...i, check: check(i) } : i)),
    },
    answers: currentAnswers(args.workspace, { hub: hub.root }),
    deliverer: delivererState(args.workspace),
    // Read live, unlike the code stamp: the question is whether the updater ran
    // recently, and a value captured at load could only ever answer it for the moment
    // this process started.
    provenance: { code: codeState(CODE), hub, update: autoUpdate(args.workspace) },
    lastLook,
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

  // Keep the hub clone's remote-tracking refs current for as long as this server runs.
  // Only in `--serve`: a one-shot render must not reach the network, and the fetch
  // never blocks a request — a slow or offline remote costs freshness, not the page.
  const pull = () => { try { fetchHub(args.hub); } catch { /* offline is a state, not a fault */ } };
  pull();
  const ticker = setInterval(pull, HUB_FETCH_MIN * 60000);
  ticker.unref?.();

  // What this server says about itself when something outside asks whether it is safe
  // to restart. Two numbers and nothing else: how many requests are in flight, and how
  // long since the last one finished. The restarter in tools/navigator/selfupdate.mjs
  // will not touch a server that is serving anybody — restarting one mid-request is
  // worse than serving stale for five more minutes, and that is a judgement it can
  // only make if this process is willing to say.
  //
  // `/healthz` is excluded from its own accounting, and that exclusion is the whole
  // mechanism rather than a nicety: the probe arrives every five minutes, so a health
  // check that counted itself as traffic would reset the idle clock on every poll and
  // the page would be "busy" forever, which is a restart that never happens and a
  // requirement that silently does nothing.
  const traffic = { inflight: 0, lastAt: Date.now() };

  const server = http.createServer(async (req, res) => {
    const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    const isHealth = req.url.split('?')[0] === '/healthz';
    if (!isHealth) {
      traffic.inflight += 1;
      res.on('close', () => { traffic.inflight = Math.max(0, traffic.inflight - 1); traffic.lastAt = Date.now(); });
    }
    try {
      // Answered before anything else and without reading a file: whatever is wrong
      // with this server's data, the question "are you busy" must still get an answer,
      // or the restarter falls back to guessing.
      if (isHealth) {
        return send(200, 'application/json', JSON.stringify({
          ok: true,
          pid: process.pid,
          port: server.address()?.port ?? null,
          startedAt: CODE.startedAt,
          code: CODE.started ? { sha: CODE.started.sha, short: CODE.started.short, at: CODE.started.at } : null,
          inflight: traffic.inflight,
          idleMs: Date.now() - traffic.lastAt,
        }));
      }
      if (req.method === 'POST' && req.url.split('?')[0] === '/answer') {
        const answer = JSON.parse(await readBody(req));
        let result;
        try {
          // The same tree the queue was rendered from: an answer's decision id is
          // resolved out of the hub registry, and resolving it against a staler copy
          // than the row he clicked is how an answer lands on the wrong id.
          result = recordAnswer(args.workspace, answer, { hub: hubSource(args).root });
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

      // Which agents he wants at the top of the Agents tab (obot.agent#169). His
      // preference state, so it lands in the local ops store and never publishes —
      // the same rule as the config list. `pinned: null` clears the override rather
      // than recording a "no", so a standing role can go back to following its role.
      if (req.method === 'POST' && req.url.split('?')[0] === '/pin') {
        const body = JSON.parse(await readBody(req));
        try {
          const pins = writePin(args.workspace, { key: body.key, pinned: body.pinned });
          return send(200, 'application/json', JSON.stringify({ ok: true, at: pins.at }));
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

      // When he last opened each page, recorded where the page is actually handed
      // over — a 404 is not a surface, a poll is not a look, and the read has to
      // happen before the write or the page would only ever say "just now" (oa#143).
      const look = () => seenAndNote(args.workspace, req, { aliases: SURFACE_ALIASES });

      // Artifacts are served from the tree the queue was built from, so the page he
      // opens is the page the row promised — never a staler copy of it.
      const file = artifactPath(hubSource(args).root, req.url);
      if (file) {
        look();
        return send(200, 'text/html; charset=utf-8', fs.readFileSync(file));
      }

      const p = req.url.split('?')[0];
      if (p === '/' || p === '/index.html') return send(200, 'text/html; charset=utf-8', await page(args, look().before));

      // The second tab. `/live.html` is the address the status line already builds;
      // `/session` is the readable alias, `/session/log` is the full record, and
      // `/session/frame` is the session hub's own render, served byte-for-byte
      // inside the log's shell.
      //
      // The roster is assembled per request from the four files it joins, never
      // cached: the whole column set is about what is happening now, and a roster
      // showing a finished agent as running is worse than no roster. If assembling
      // it throws, the tab still serves the feed — neither the roster nor the feed
      // may take the other down.
      // The Wire — what changed, and how much of it since he last looked (#203).
      // Second of the four spine tabs, and the one surface that can answer the
      // "since you last looked" half at all: this server sees the request, and a
      // static public page never can. `look()` is read before the visit is
      // recorded, which is the mechanism rather than an ordering detail.
      if (p === '/wire.html' || p === '/wire') {
        const before = look().before;
        // A feed that cannot assemble costs the feed, never the page — the same
        // rule the Agents tab applies to the same builder.
        let feed = [];
        try {
          feed = buildFeedModel(buildSessionFeed({ workspace: args.workspace }));
        } catch { /* no feed — the page renders its own honest empty state */ }
        return send(200, 'text/html; charset=utf-8', wirePage(feed, before, before));
      }

      if (p === '/live.html' || p === '/session' || p === '/session/' || p === '/session/log') {
        const before = look().before;
        // Read before the roster is assembled, because the pins decide scope: a
        // pinned agent is never dropped for being out of the window or one corpse
        // too many, and that judgement happens inside the join.
        const pins = readPins(args.workspace);
        let roster = null;
        try {
          roster = collectRoster({
            workspace: args.workspace, hub: args.hub, pinned: (name) => labelIsPinned(name, pins),
          });
        } catch (e) {
          roster = `The roster could not be assembled: ${e.message}`;
        }
        if (p === '/session/log') {
          let delivery = { verdicts: [], calls: [] };
          try {
            delivery = parseDeliveryJournal(fs.readFileSync(path.join(args.workspace, ...SESSION_DIR, 'delivery.journal'), 'utf8'));
          } catch { /* no journal yet — the tables say so */ }
          // The what-changed feed moved here with the outcome groups when the tab
          // became a table (jwildfire/obot.agent#154). A feed that cannot assemble
          // costs the feed, never the page.
          let feed = [];
          try {
            feed = buildFeedModel(buildSessionFeed({ workspace: args.workspace }));
          } catch { /* no feed — the record renders without it */ }
          return send(200, 'text/html; charset=utf-8', sessionLogShell({
            roster, delivery, feed, lastLook: before,
            missing: sessionLivePath(args.workspace) ? null : WATCH_CMD,
          }));
        }
        return send(200, 'text/html; charset=utf-8', sessionShell({ roster, lastLook: before, pins }));
      }
      if (p === '/session/frame') {
        const live = sessionLivePath(args.workspace);
        if (!live) return send(404, 'text/plain', `no session view yet — run: ${WATCH_CMD}`);
        return send(200, 'text/html; charset=utf-8', fs.readFileSync(live));
      }

      // The third tab: release metrics and what changed, for a reader who was not
      // present (jwildfire/obot.roadmap#218) — with the sweep's full record kept
      // whole at /navigator/record for its dense readers. All of it read fresh on
      // every request: the state file is rewritten every five minutes and a cached
      // copy of an observer's state is exactly the thing that must not go stale
      // silently. The metrics and event caches are the sweep's own files; reading
      // them here is the no-network-at-render rule, not a freshness compromise —
      // each carries its age and the page shows it.
      if (p === '/navigator' || p === '/navigator/' || p === '/navigator/record') {
        look();
        const file = path.join(args.workspace, ...SESSION_DIR, 'navigator-state.md');
        let md = null;
        try { md = fs.readFileSync(file, 'utf8'); } catch { /* no sweep yet */ }
        const stateArg = md ? { state: parseNavigatorState(md) } : { missing: file };
        if (p === '/navigator/record') {
          return send(200, 'text/html; charset=utf-8', navigatorRecordShell(stateArg));
        }
        const readCache = (name) => {
          try { return JSON.parse(fs.readFileSync(path.join(args.workspace, ...SESSION_DIR, 'cache', name), 'utf8')); } catch { return null; }
        };
        // The period and the two filters ride in the query string, so a filtered view
        // is a URL — one he can keep, send to an agent, or open on a phone. They are
        // resolved against the cache rather than trusted (jwildfire/obot.agent#155):
        // a repo or goal that is not on record is reported and ignored, never allowed
        // to silently filter every number to zero.
        const metricsCache = readCache('metrics.json');
        return send(200, 'text/html; charset=utf-8', navigatorShell({
          ...stateArg,
          metrics: buildMetricsModel(metricsCache, new Date(), parseFilters(req.url.split('?')[1] ?? '', metricsCache)),
          feed: buildFeedModel(readCache('navigator-rc.json')?.events ?? []),
        }));
      }

      if (p === '/queue.json') {
        const q = await collectQueue(args.workspace, hubSource(args).root, { agent: sweepScript(args.workspace) });
        // The provenance travels with the data. `{"items": []}` was the whole
        // answer, so a machine reader was told the queue is empty when the truth
        // was that none of its three sources could be opened.
        return send(200, 'application/json', JSON.stringify({
          items: q.items,
          sources: {
            rcs: { read: !q.rcs?.error, why: q.rcs?.error ?? null },
            decisions: { read: !q.decisions?.error, why: q.decisions?.error ?? null },
            config: { read: !q.config?.error, why: q.config?.error ?? null },
          },
        }, null, 2));
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
        if (e.code === 'EADDRINUSE' && args.exclusive) {
          console.error(`ops-dashboard: port ${port} is still held — not starting. Nothing was moved; whatever holds it is still serving.`);
          process.exit(1);
        }
        throw e;
      });
      // Report the bound port, not the requested one — `--port 0` means "any free
      // port", and the marker the status line reads has to name the real one.
      server.listen(port, HOST, () => {
        const bound = server.address().port;
        const url = `http://${HOST}:${bound}/`;
        // `requestedPort` is what we asked for: binding something else means the port
        // this machine's dashboard lives on was already taken, so this is not it.
        const marker = writeServeMarker(args.workspace, {
          port: bound, url: `${url}live.html`, requestedPort: args.port, claim: args.claimMarker !== false,
        });
        resolve({ server, url, marker });
      });
    };
    listen(args.port, args.exclusive ? 0 : 20);
  });
}

const invoked = process.argv[1] && path.resolve(process.argv[1]).endsWith('ops-dashboard.mjs');
if (invoked) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('ops-dashboard — the Operations Dashboard (local only). See the header of this file.');
  } else if (args.serve) {
    const { url, marker } = await serve(args);
    // Before the URL, so a reader who sees one line sees the important one: this
    // server is not what the status line points at.
    if (!marker.claimed) console.log(`ops-dashboard: not claiming the serve marker — ${marker.reason}`);
    console.log(`ops-dashboard: ${url}`);
    if (args.open) console.log(url);
  } else {
    // Rendering to stdout is not a look, so it reads the record without touching it.
    process.stdout.write(await page(args, lastSeen(args.workspace, '/')));
  }
}
