// The serve marker: one file that says "this is the machine's dashboard, here".
//
// `<workspace>/.claude/session-hub/serve.json` is what the status line, the skills
// and `prime-rehydrate` read to answer "is the dashboard up, and on what port". It
// is a claim on a role, not a record of a process — there is one dashboard, and at
// most one thing can be it.
//
// It kept being taken by servers that were not it. On 2026-08-16 five second
// instances — every one an agent doing the right thing, running a test server while
// changing the dashboard — overwrote the marker and then deleted it on the way out,
// leaving @jwildfire's status line pointing at a dead link for half an hour while a
// perfectly healthy dashboard kept serving (jwildfire/obot.agent#142).
//
// So the rules here are written from the second instance's side, and each one
// removes a way to lose rather than adding a way to detect:
//
//   1. A server told an explicit non-default `--port` is a test server, and declines
//      the marker outright. This is the one that ends the recurrence: it needs no
//      liveness check, no lock, and no correct behaviour from anyone else.
//   2. A server that did not get the port it asked for is not the dashboard either —
//      something else already owns that address.
//   3. A live marker held by another process is never overwritten. Only `none`,
//      `stale` (owner gone) and unreadable markers are claimable.
//   4. An instance removes only the marker it owns: recorded pid *and* recorded port.
//   5. A reader is told `stale` rather than handed a URL that no longer answers.
//
// This lives beside `last-seen.mjs` for the same reason that one does: both servers
// write it, so it belongs to neither, and the ops-dashboard folder is where the
// local-only records about him already live.

import fs from 'node:fs';
import path from 'node:path';

export const MARKER_DIR = ['.claude', 'session-hub'];
export const MARKER_FILE = 'serve.json';

/** Where the marker lives for a workspace root. */
export function markerPath(workspace) {
  return path.join(workspace, ...MARKER_DIR, MARKER_FILE);
}

/** Is that pid still running? `EPERM` counts: alive, just not ours to signal. */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/**
 * Read the marker as a state, never as a bare URL.
 *
 * `none` — nothing written. `unreadable` — there is a file but it is not a marker.
 * `stale` — the owning process is gone, so the contents describe a server that has
 * stopped; the fields are still returned, because "it was on 7399 until it wasn't"
 * is useful, but the state is what a caller must branch on. `live` — the owner is
 * running, and only then is the URL worth handing to anything.
 */
export function readMarker(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { state: 'none', file, reason: 'no marker — nothing is advertising a dashboard' };
  }
  let marker;
  try {
    marker = JSON.parse(raw);
  } catch {
    return { state: 'unreadable', file, reason: 'the marker is not valid JSON' };
  }
  if (!marker || typeof marker !== 'object' || !Number.isInteger(marker.pid)) {
    return { state: 'unreadable', file, reason: 'the marker records no pid' };
  }
  return pidAlive(marker.pid)
    ? { state: 'live', file, ...marker }
    : { state: 'stale', file, ...marker, reason: `pid ${marker.pid} is gone — this describes a server that stopped` };
}

/** A marker is only claimable when nobody living is behind it. */
export function claimable(file) {
  return readMarker(file).state !== 'live';
}

/**
 * Claim the marker for this process, or decline and say why.
 *
 * `claim: false` is the flag-level decision (an explicit non-default `--port`), kept
 * as an argument rather than re-derived here so the CLIs stay the place that decides
 * what their own flags mean. `requestedPort` is what the server asked for before any
 * roll-forward; pass `0` for "any free port", where whatever it bound is what it
 * wanted. Declining never touches the file — not to rewrite it, not to back it up.
 */
export function claimServeMarker(file, { port, url, site, requestedPort, claim = true } = {}) {
  const declined = (reason) => ({ claimed: false, reason, marker: null });

  if (!claim) {
    return declined(`an explicit --port (${port}) names a test server, not the machine dashboard`);
  }
  if (requestedPort !== undefined && requestedPort !== 0 && port !== requestedPort) {
    return declined(`bound ${port} after ${requestedPort} was taken — something else owns the dashboard port`);
  }
  const current = readMarker(file);
  if (current.state === 'live' && current.pid !== process.pid) {
    return declined(`pid ${current.pid} is still serving ${current.url ?? `port ${current.port}`}`);
  }

  const marker = {
    port, pid: process.pid, url, startedAt: new Date().toISOString(), ...(site ? { site } : {}),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(marker, null, 2)}\n`);
  return { claimed: true, reason: current.state === 'stale' ? `replaced a stale marker (pid ${current.pid})` : null, marker };
}

/**
 * Remove the marker only if this process is the one it describes — same pid and the
 * same port. The port half matters because pids are reused: an exit hook that checks
 * only the pid can delete a marker it has never written.
 */
export function releaseServeMarker(file, { port } = {}) {
  try {
    const marker = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (marker.pid === process.pid && marker.port === port) {
      fs.unlinkSync(file);
      return true;
    }
  } catch { /* already gone, or unreadable — either way not ours to delete */ }
  return false;
}

/**
 * Claim the marker and hold it for the life of this process, releasing it on the way
 * out. Returns the claim either way; `release()` is a no-op when the claim was
 * declined, so a second instance can never remove what it did not write.
 */
export function holdServeMarker(file, opts = {}) {
  const claim = claimServeMarker(file, opts);
  if (!claim.claimed) return { ...claim, file, release: () => false };

  const release = () => releaseServeMarker(file, { port: opts.port });
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { release(); process.exit(0); });
  }
  return { ...claim, file, release };
}
