// Loopback HTTP server for the live view.
//
// Why serve a file we already wrote to disk: terminals do not agree on what a
// `file://` hyperlink means — Ghostty hands it to Finder rather than the browser —
// so the status-line link (obot.agent/tools/statusline) needs an `http://` URL to
// land in Chrome. Everything else about the live view is unchanged; this only
// changes how it is reached.
//
// Deliberately loopback-only and read-only: the live view carries session names,
// agent intents, and scratchpad lines. It binds 127.0.0.1, answers GET/HEAD,
// serves nothing outside the session-hub directory, and lists no directories.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_PORT = 7325;
const HOST = '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** Map a request path to a file inside dir, or null if it escapes / is not a file. */
export function resolveRequest(dir, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname === '/' || pathname === '') pathname = '/live.html';
  const root = path.resolve(dir);
  const target = path.resolve(root, `.${path.posix.normalize(pathname)}`);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null;
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return null;
  }
  return stat.isFile() ? target : null;
}

export function createHubServer({ dir }) {
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end();
      return;
    }
    const file = resolveRequest(dir, req.url ?? '/');
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found\n');
      return;
    }
    const body = fs.readFileSync(file);
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': body.length,
      // The live view is regenerated on the watch interval — never cache it.
      'cache-control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}

/** Listen on the first free port at or after `port`, giving up after `tries`. */
export function listen({ dir, port = DEFAULT_PORT, tries = 10 }) {
  return new Promise((resolve, reject) => {
    const server = createHubServer({ dir });
    let attempt = 0;
    const tryPort = (p) => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && ++attempt < tries) tryPort(p + 1);
        else reject(err);
      });
      // Report the bound port, not the requested one — `port: 0` means "any free port".
      server.listen(p, HOST, () => {
        const bound = server.address().port;
        resolve({ server, port: bound, url: `http://${HOST}:${bound}/live.html` });
      });
    };
    tryPort(port);
  });
}

/**
 * Serve `dir` and advertise the endpoint in `serve.json` beside the live view, so
 * the status line (and anything else) can find the port without guessing. The file
 * is removed on exit; a reader should still check that `pid` is alive, since a
 * killed process leaves it behind.
 */
export async function serveHub({ dir, port = DEFAULT_PORT }) {
  const started = await listen({ dir, port });
  const marker = path.join(dir, 'serve.json');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(marker, `${JSON.stringify({
    port: started.port, pid: process.pid, url: started.url, startedAt: new Date().toISOString(),
  }, null, 2)}\n`);

  const cleanup = () => {
    try {
      const current = JSON.parse(fs.readFileSync(marker, 'utf8'));
      if (current.pid === process.pid) fs.unlinkSync(marker);
    } catch { /* already gone, or another server's marker — leave it */ }
  };
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { cleanup(); process.exit(0); });
  }
  return { ...started, marker, cleanup };
}
