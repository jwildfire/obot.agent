#!/usr/bin/env node
// ops-dashboard — the Operations Dashboard.
//
// @jwildfire's local page: his todo list with blockers included, and the place he
// answers decision artifacts instead of reading them on the public site and typing
// the answer somewhere else. Requirement: jwildfire/obot.roadmap#180.
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
//   --port <n>         loopback port (default 7326; rolls forward if taken)
//   --serve            run the server (without it, render once to stdout)
//   --open             print the URL when the server is up
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';

import { collectQueue, refreshRCs } from './lib/collect.mjs';
import { render } from './lib/render.mjs';
import { ensureStore, readAnswers, writeAnswer } from './lib/store.mjs';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 7326;

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

async function page(args) {
  const queue = await collectQueue(args.workspace, args.hub, {
    agent: path.join(args.workspace, 'obot.agent', 'scripts', 'reviews-queue'),
  });
  return render({ queue, staged: readAnswers(args.workspace), workspace: args.workspace, hub: args.hub });
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
        if (!answer.verdict) return send(400, 'application/json', JSON.stringify({ error: 'no verdict' }));
        const rec = writeAnswer(args.workspace, answer);
        return send(200, 'application/json', JSON.stringify({ ok: true, id: rec.id }));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain', 'method not allowed');

      const file = artifactPath(args.hub, req.url);
      if (file) return send(200, 'text/html; charset=utf-8', fs.readFileSync(file));

      const p = req.url.split('?')[0];
      if (p === '/' || p === '/index.html') return send(200, 'text/html; charset=utf-8', await page(args));
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
      server.listen(port, HOST, () => resolve({ server, url: `http://${HOST}:${port}/` }));
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
