// The ranked head, as his page shows it (jwildfire/obot.roadmap#278).
//
// TWO HALVES WITH TWO CLOCKS, and keeping them apart is the whole design.
//
//   the declaration   `obot.agent/rank/top10.json` — an order and a one-line reason.
//                     Local, tiny, and readable whether or not anything else works.
//   the derivation    what GitHub says about each of those issues right now: title,
//                     state, milestone, blocked-ness, sub-issue progress.
//
// They are read separately and aged separately. The declaration is read INLINE on
// every render — it costs a `readFileSync` — so the order and his reasons survive an
// unauthenticated `gh`, a dead network and a machine that has never swept. The
// derivation is cached and refreshed behind the page, exactly like the release-candidate
// sweep, because it crosses the network and a queue that makes him wait to see his own
// list has missed the point.
//
// Collapsing the two clocks into one "updated" line is the failure this requirement was
// filed against: a fresh derivation would make a fortnight-old rank look current, which
// is precisely how two of this program's state files came to be stale right now with
// neither admitting it. So the panel says both, always, and says "not known" rather
// than a zero when it cannot say one.
//
// ONE READER OF GITHUB, NOT TWO. The refresh spawns `tools/navigator/rankhead.mjs`
// rather than repeating its two `gh` calls here. The sweep's section and this panel
// therefore cannot disagree about what the ten are — the same reasoning that has
// `collect.mjs` import the sweep's `classify.mjs` instead of restating what an RC is.
// Out of process for the second reason too: those calls are synchronous and a render
// must not block on the network.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { joinRank, readRank, rankTouched, RANK_PATH, RANK_REL } from '../../navigator/rank.mjs';
import { readCache, readCacheResult, writeCache } from './store.mjs';

/** The cache's name IS its schema — a new shape gets a new file, so a long-lived
 *  older server is never handed something it cannot parse (the 2026-08-16 500). */
export const RANK_CACHE = 'rank-head';
export const RANK_CACHE_V = 1;

/** Where a failed refresh leaves its reason. Separate from the cache on purpose: a
 *  failed refresh must not erase the last reading that worked, and a six-hour-old
 *  reading is still worth showing as long as the page says how old it is. */
export const RANK_FAIL = 'rank-head-failed';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The one reader of GitHub for this surface. */
export const READER = path.join(HERE, '..', '..', 'navigator', 'rankhead.mjs');

/**
 * The obot.agent checkout the declaration is read from, or null.
 *
 * The workspace's clone rather than this module's own tree: the sweep fast-forwards
 * that checkout every five minutes, so the store the page reads is the store that was
 * last merged — and on a machine that has no clone, the honest answer is that the
 * order is not here at all rather than a silently empty list.
 */
export const rankRoot = (workspace) => {
  const p = path.join(workspace, 'obot.agent');
  return fs.existsSync(p) ? p : null;
};

const NO_BENCH = { read: false, open: null, why: '' };

/**
 * Everything the panel renders, from a workspace.
 *
 * `read` is about the DERIVED half only. `declaredRead` is about the order. They fail
 * independently and the page says so independently — an unread GitHub still shows ten
 * ranked requirements and their reasons, with every derived field withheld.
 */
export function rankPanel(workspace, { refresh = true, maxAgeMin = 20, now = new Date(),
  node = process.execPath, reader = READER } = {}) {
  const root = rankRoot(workspace);
  const store = root ? readRank(root) : {
    read: false,
    absent: true,
    why: `there is no obot.agent checkout beside this workspace, so ${RANK_REL} is not on this machine`,
    declared: { repo: null, label: null, bench: null, boundary: null, rank: [] },
  };
  const touched = root ? rankTouched(root, { now }) : {
    read: false, why: 'there is no checkout to ask when the order last changed', iso: null, ageMin: null, dirty: null,
  };
  const base = {
    declaredRead: store.read,
    declaredAbsent: store.absent,
    declaredWhy: store.why,
    touched,
    repo: store.declared.repo,
    label: store.declared.label,
    bench: NO_BENCH,
    boundary: store.declared.boundary,
    items: [], findings: [], read: false, error: null, refreshing: false, ageMin: null,
  };
  if (!store.read) return base;

  const res = readCacheResult(workspace, RANK_CACHE, maxAgeMin);
  // A failure record outlives the cache window: the question it answers is "has a
  // reading ever worked here", and that does not go stale after twenty minutes.
  const failed = readCache(workspace, RANK_FAIL, Infinity)?.value ?? null;
  const shaped = res.cache && res.cache.value?.v === RANK_CACHE_V ? res.cache : null;

  const live = shaped?.value?.live ?? null;
  const { items, findings } = joinRank(store.declared, live);

  const started = (!shaped || shaped.stale) && refresh && !!root;
  if (started) refreshRankHead(workspace, root, { node, reader });

  // A stale cache still counts as read — its rows are real, just old — and when the
  // refresh behind it has failed, BOTH facts are carried: what is on screen, and how
  // old it is. Presenting either one alone is how stale becomes current.
  const error = !shaped
    ? (res.why || failed?.reason || null)
    : (shaped.stale && failed ? failed.reason : null);

  return {
    ...base,
    items,
    findings,
    bench: shaped?.value?.bench ?? NO_BENCH,
    read: !!shaped,
    ageMin: shaped?.ageMin ?? null,
    refreshing: started && !error,
    error,
  };
}

let refreshing = false;

/**
 * Re-read GitHub, out of process, and leave either a cache or a reason.
 *
 * Fire-and-forget behind a module mutex, like `refreshRCs`. Never both: a run that
 * could not read GitHub clears nothing, so the last good reading stays on the page
 * with its age beside it.
 */
export function refreshRankHead(workspace, root, { node = process.execPath, reader = READER } = {}) {
  if (refreshing) return false;
  refreshing = true;
  execFile(node, [reader, root], { timeout: 90000, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
    refreshing = false;
    if (err) {
      const said = String(stderr || err.message || '').split('\n').map((l) => l.trim()).filter(Boolean).at(-1);
      writeCache(workspace, RANK_FAIL, { reason: said || 'the ranked-head reader exited without saying why' });
      return;
    }
    let got;
    try { got = JSON.parse(stdout); } catch {
      writeCache(workspace, RANK_FAIL, { reason: `the ranked-head reader returned ${stdout.length} bytes that are not JSON` });
      return;
    }
    if (!got?.read) {
      writeCache(workspace, RANK_FAIL, { reason: got?.why || 'GitHub could not be read and the reader did not say why' });
      return;
    }
    writeCache(workspace, RANK_CACHE, { v: RANK_CACHE_V, live: got.live, bench: got.bench ?? NO_BENCH });
    writeCache(workspace, RANK_FAIL, null);
  });
  return true;
}

export { RANK_PATH, RANK_REL };
