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

/** A cached sweep, or null when it is missing or older than `maxAgeMin`. */
export function readCache(workspace, name, maxAgeMin = 30) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(opsDir(workspace), 'cache', `${name}.json`), 'utf8'));
    const ageMin = (Date.now() - Date.parse(raw.at)) / 60000;
    return { value: raw.value, ageMin, stale: ageMin > maxAgeMin };
  } catch {
    return null;
  }
}
