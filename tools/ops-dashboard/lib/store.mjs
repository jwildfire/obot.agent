// The ops store — the dashboard's local-only folder.
//
// @jwildfire, 2026-08-15: "I feel like we want a new local only folder in the project
// to own the obs db." This is it: `<workspace>/.claude/ops/`.
//
// Two things live here and neither may ever leave the machine:
//   answers/   — decisions he has made in the sidebar but no agent has applied yet
//   cache/     — sweeps of GitHub, so opening the page is instant and offline-safe
//
// Why here rather than in a repo: the hub's deploy publishes `reports/` wholesale,
// so anything sitting in a tracked directory is one careless glob away from the
// public internet. The blockers list settled this on 2026-08-15 and this folder
// inherits its reasoning — the workspace's `.claude/` is not a git repository at
// all, so nothing has to be gitignored correctly for the containment to hold.
// Every file written here opens with the same sentinel the hub's deploy greps for,
// so if one of these ever *does* reach an assembled site, the build fails instead
// of publishing it.
import fs from 'node:fs';
import { readFailure } from './absent.mjs';
import path from 'node:path';

// Assembled from halves for the same reason the deploy guard is: a file that
// documents the sentinel must not itself trip the grep.
export const SENTINEL = `${'LOCAL-ONLY: never publish'}${', never commit'}`;

export const opsDir = (workspace) => path.join(workspace, '.claude', 'ops');

/** Create the folder, its subfolders, and the note explaining what it is. */
export function ensureStore(workspace) {
  const dir = opsDir(workspace);
  for (const sub of ['', 'answers', 'cache']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const readme = path.join(dir, 'README.md');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, `<!-- ${SENTINEL}. The Operations Dashboard's local store. -->

# ops — the Operations Dashboard's store

Local only. Nothing here is committed, published, or copied into a repo.

- \`answers/\` — decisions @jwildfire has made in the dashboard sidebar, waiting for an
  agent to apply them to the decision artifact, the log and the index.
- \`cache/\` — sweeps of GitHub so the page opens instantly and works offline.

Requirement: [obot.roadmap#180](https://github.com/jwildfire/obot.roadmap/issues/180).
`);
  }
  return dir;
}

const stamp = (o) => ({ _note: SENTINEL, ...o });

// Answers themselves live in `answers.mjs`: recording one is a pipeline (join the
// decision id, supersede what it replaces, hand it to a deliverer), not a write.

export function writeCache(workspace, name, value) {
  const dir = path.join(ensureStore(workspace), 'cache');
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(stamp({ at: new Date().toISOString(), value }), null, 2)}\n`);
}

/**
 * A cached sweep, or null when it is missing or older than `maxAgeMin`.
 *
 * `null` means "there is nothing here to use" and every caller may treat it that way.
 * What changed for jwildfire/obot.agent#215 is that it no longer means *why*: a cache
 * that was never written and one this process could not open both produced `null`, so
 * `collectRCs` could not tell "no sweep yet" from "the cache could not be read" and
 * sat promising a sweep forever. The reason rides on `readCacheFailure` instead of on
 * the return value, so no caller has to change to keep working.
 */
export function readCache(workspace, name, maxAgeMin = 30) {
  return readCacheResult(workspace, name, maxAgeMin).cache;
}

/**
 * The same read, with the reason kept. `{ cache, read, why }`:
 *
 *   cache  what `readCache` returns — the entry, or null
 *   read   false only when the source could not be opened or parsed; an absent cache
 *          is a legitimately empty answer and reads as `true`
 *   why    one sentence, empty when `read`
 */
export function readCacheResult(workspace, name, maxAgeMin = 30) {
  const file = path.join(opsDir(workspace), 'cache', `${name}.json`);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    const f = readFailure(e, file);
    return { cache: null, read: f.absent, why: f.absent ? '' : f.why };
  }
  try {
    const raw = JSON.parse(text);
    const ageMin = (Date.now() - Date.parse(raw.at)) / 60000;
    return { cache: { value: raw.value, ageMin, stale: ageMin > maxAgeMin }, read: true, why: '' };
  } catch {
    // Present, opened, and not usable. That is a damaged cache, not a missing one —
    // and it will stay damaged until something rewrites it, so saying so matters.
    return { cache: null, read: false, why: `${file} is not readable JSON` };
  }
}
