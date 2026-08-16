// last-seen — when @jwildfire last actually looked at each local surface.
//
// Every surface built for his absence wants to answer "what changed since I last
// looked", and until now nothing recorded when he last looked. The tempting fix is
// to substitute something that correlates — the last deploy, the newest changelog
// entry, a fixed 24 hours relabelled — and that is worse than no signal, because a
// confidently wrong window actively tells him not to look. Requirement:
// jwildfire/obot.roadmap#205, task jwildfire/obot.agent#143.
//
// So this records one thing, at the seam where a page is actually handed to a
// browser: the last time each surface was opened. No user agent, no referrer, no
// history — the narrowest record that answers the question is the whole design.
//
// Local only, like everything in `.claude/ops/`: this is behavioural data about him
// and sits under the same rule as the config list. Never committed, never published,
// never read by any generator that writes to the hub. The file carries the store's
// sentinel so the deploy fails rather than publishing it, should it ever get out.
//
// ## What counts as a look
//
// The hard part is not writing the timestamp, it is refusing to write it. A watcher,
// a health check, or a page refreshing itself would keep marking the page as seen and
// silently destroy the signal for the one reader it exists for. So the rule was
// measured against a real Chrome on 127.0.0.1 (2026-08-16) rather than assumed:
//
//   what happened            method  Sec-Fetch-Dest  -Mode      -User  Cache-Control
//   opened the page          GET     document        navigate   —      —
//   clicked a link/tab       GET     document        navigate   ?1     —
//   the page's meta refresh  GET     document        navigate   —      max-age=0
//   an iframe loaded         GET     iframe          navigate   —      (max-age=0)
//   a fetch() poll           GET     empty           cors       —      —
//   the favicon              GET     image           no-cors    —      —
//   curl / a script          GET     (none sent)     (none)     —      —
//
// Two readings of that table matter. First, a non-browser client sends no
// `Sec-Fetch-*` headers at all, so requiring them excludes every poll, health check
// and watcher by construction rather than by heuristic. Second, a page refreshing
// itself is header-identical to a person opening it except for `max-age=0` — which a
// manual reload also sends. Both are therefore excluded, which means a reload does
// not count as a fresh look. That is deliberate: the error is one-directional. An
// undercounted look shows him a longer window and tells him to look again; an
// overcounted one tells him not to bother. Only the second kind can hide something.
//
// `_r=auto` on the query is the deterministic escape hatch for any page we control
// that reloads itself: a marked reload never counts, whatever the browser sends.
import fs from 'node:fs';
import path from 'node:path';

import { SENTINEL, opsDir, ensureStore } from './store.mjs';

/** Bounded by construction: artifact routes are per-decision, so keys must not pile up. */
export const MAX_SURFACES = 64;

/** A path longer than this is not one of our pages. */
const MAX_KEY = 200;

/** A stamp this far ahead of now is clock jitter, not a broken clock. */
const SKEW_MS = 5000;

export const lastSeenFile = (workspace) => path.join(opsDir(workspace), 'last-seen.json');

/**
 * The page a request is for: query and fragment dropped, `/session/` and `/session`
 * one surface, and the routes that serve the same page collapsed through `aliases`.
 * Returns null when the request is not for a page of ours at all.
 */
export function surfaceKey(url, { aliases = {} } = {}) {
  // `GET //live.html` arrives as the literal request target `//live.html`, which URL
  // parsing reads as a host — the page would be filed under `/`, a surface he never
  // opened. Collapse the leading slashes before anything else sees them.
  const target = String(url ?? '/').replace(/^\/{2,}/, '/');
  let p;
  try {
    p = decodeURIComponent(new URL(target, 'http://127.0.0.1').pathname);
  } catch {
    return null; // an undecodable path names no page
  }
  if (p.length > MAX_KEY) return null;
  p = path.posix.normalize(p || '/');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return aliases[p] ?? p;
}

const no = (why) => ({ look: false, why });

/**
 * Did a person just open this page? See the table in the header — every branch here
 * is a row of it, and the default is no.
 */
export function isLook(req) {
  const method = (req?.method ?? 'GET').toUpperCase();
  if (method !== 'GET') return no(`${method} is not a look`);

  const h = req?.headers ?? {};
  const dest = h['sec-fetch-dest'];
  const mode = h['sec-fetch-mode'];
  // No Sec-Fetch-* at all: curl, a watcher, a health check, anything scripted.
  if (!dest) return no('no Sec-Fetch-Dest — not a browser navigation');
  if (dest !== 'document') return no(`Sec-Fetch-Dest: ${dest}`);
  if (mode && mode !== 'navigate') return no(`Sec-Fetch-Mode: ${mode}`);

  const cc = String(h['cache-control'] ?? '').toLowerCase();
  if (cc.includes('max-age=0') || cc.includes('no-cache')) return no('a reload, not a fresh open');

  try {
    if (new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('_r') === 'auto') {
      return no('a page-marked automatic reload');
    }
  } catch { /* an unparseable URL is handled by surfaceKey */ }

  return { look: true };
}

/**
 * The store as it is on disk.
 *
 * Three outcomes, kept apart because they render differently: readable, absent
 * (nothing has been looked at yet), and damaged (we must say so rather than guess).
 * An IO failure that is not "missing" is never treated as damaged — a permissions
 * error must not license overwriting a good record.
 */
export function readLastSeen(workspace) {
  let raw;
  try {
    raw = fs.readFileSync(lastSeenFile(workspace), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true, missing: true, surfaces: {} };
    return { ok: false, why: `the record could not be read (${err.code ?? 'io error'})`, surfaces: {} };
  }
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data.surfaces !== 'object' || data.surfaces === null) throw new Error('shape');
    return { ok: true, surfaces: data.surfaces };
  } catch {
    return { ok: false, damaged: true, why: 'the record could not be parsed', surfaces: {} };
  }
}

/**
 * Record that `surface` was opened. Returns the stamp written, or null when nothing
 * was written — including every failure, because a serve seam must not be able to
 * fail a page load over bookkeeping.
 *
 * Written whole through a rename so a reader never catches a half-written file: the
 * "damaged" branch has to stay rare and real, or it becomes noise.
 */
export function noteLook(workspace, surface, now = new Date()) {
  if (!surface || typeof surface !== 'string') return null;
  try {
    const current = readLastSeen(workspace);
    // Damaged is recoverable — we know this look happened, so start the record over
    // rather than leaving it unreadable forever. An IO error is not: leave it alone.
    if (!current.ok && !current.damaged) return null;

    const surfaces = { ...current.surfaces, [surface]: now.toISOString() };
    const kept = Object.entries(surfaces)
      .sort((a, b) => (Date.parse(b[1]) || 0) - (Date.parse(a[1]) || 0))
      .slice(0, MAX_SURFACES);

    const dir = ensureStore(workspace);
    const file = lastSeenFile(workspace);
    const tmp = path.join(dir, `.last-seen.${process.pid}.tmp`);
    fs.writeFileSync(tmp, `${JSON.stringify({ _note: SENTINEL, surfaces: Object.fromEntries(kept) }, null, 2)}\n`);
    fs.renameSync(tmp, file);
    return now.toISOString();
  } catch {
    return null;
  }
}

/**
 * When `surface` was last opened, and how sure we are.
 *
 *   first    — nothing has been recorded for it. Never render this as "nothing changed".
 *   seen     — a real prior timestamp, with the age to go with it.
 *   unknown  — the record is damaged, the stamp is not a time, or the clock moved
 *              backwards. Say nothing rather than something plausible.
 */
export function lastSeen(workspace, surface, now = new Date()) {
  const store = readLastSeen(workspace);
  if (!store.ok) return { state: 'unknown', at: null, ageMs: null, why: store.why };

  const at = store.surfaces[surface];
  if (at === undefined) return { state: 'first', at: null, ageMs: null };

  const t = typeof at === 'string' ? Date.parse(at) : NaN;
  if (Number.isNaN(t)) return { state: 'unknown', at: null, ageMs: null, why: 'the stamp is not a time' };

  const ageMs = now.getTime() - t;
  if (ageMs < -SKEW_MS) {
    return { state: 'unknown', at, ageMs: null, why: 'the stamp is in the future — the clock moved backwards' };
  }
  return { state: 'seen', at, ageMs: Math.max(0, ageMs) };
}

const ago = (ms) => {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

/** The verdict in the words a page should use. Short, because the header is one row. */
export function phrase(v) {
  if (!v || v.state === 'unknown') return 'last opened: unknown';
  if (v.state === 'first') return 'first look';
  return `last opened ${ago(v.ageMs)}`;
}

/**
 * The whole seam in one call: read the prior look, then record this one.
 *
 * The order is the point — a page consuming this must show what it said *before*
 * this request, or every visit reads "just now" and the signal says nothing.
 */
export function seenAndNote(workspace, req, { aliases = {}, now = new Date() } = {}) {
  const surface = surfaceKey(req?.url, { aliases });
  const before = surface ? lastSeen(workspace, surface, now) : { state: 'unknown', why: 'no surface' };
  const verdict = isLook(req);
  if (surface && verdict.look) noteLook(workspace, surface, now);
  return { surface, before, recorded: Boolean(surface && verdict.look), why: verdict.why ?? null };
}
