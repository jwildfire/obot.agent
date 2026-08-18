// The wall between this page and the hub's own code.
//
// Requirement: jwildfire/obot.agent#206. The dashboard deliberately runs the hub's
// decision collector rather than a copy of it, so the page and the published site
// cannot disagree about what "open" means. That is the right call and it stays. What
// changed is where the hub's code is allowed to run: in its own process, never in
// this one.
//
// ## What went wrong, so nobody reinstates the shortcut
//
// The hub is a public build. To satisfy jwildfire/obot.roadmap#203 — the config list
// must be structurally unable to reach a published surface — its generators import
// `scripts/lib/local-only-guard.mjs`, which on import replaces the content-reading
// surface of `node:fs`, `node:fs/promises` and `node:child_process` with wrappers
// that refuse any read outside the hub repo. That guard is correct and it works.
//
// It is also a monkey-patch on a module singleton, which means it has no idea who
// imported it. When this server did `await import(<hub>/scripts/lib/collect/…)`, the
// guard came along the import graph — via `repos.mjs`, which every hub generator
// pulls in for the portfolio list — and re-armed the process. From that moment the
// dashboard could no longer read the machine it exists to describe: ten open config
// items and a live Navigator sweep, both present on disk, both refused with
// `ELOCALONLY`, and both reported to him as ordinary emptiness because that is what
// each caller's `catch` had to work with.
//
// Two of the guard's deliberate choices are what made it invisible rather than loud:
// it does not intercept `existsSync`/`stat` (so every existence check still said
// yes), and it does not intercept writes (so the server kept writing its caches
// while unable to read its inputs — the asymmetry that made the bug look impossible).
//
// ## Why a child process and not something cleverer
//
// The alternatives were weighed:
//
//   restore fs afterwards   the host would have to know exactly which properties the
//                           guard patched, and re-learn it every time the guard
//                           changes in a repo this one does not own
//   a worker thread         real isolation and cheaper, but it buys ~20ms against a
//                           spawn that costs ~35ms in total, for a page rendered by
//                           one person on loopback
//   make the guard optional it is a different repo, and an opt-out is exactly the
//                           thing #203 bought the guard to prevent
//
// A separate process is the only one where the isolation is a property of the
// operating system rather than of anyone remembering. Whatever the hub's import
// graph does — today's guard, or the next control someone adds to it — it happens
// over there and exits.
//
// ## The rule this file exists to hold
//
// **No module under this tool may import anything from the hub.** The dashboard's
// own reads and the hub's code never share a process. `test/hub-isolation.test.mjs`
// asserts the effect directly: a hub whose collector arms a guard must not be able
// to stop the config list being read a line later.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The canary: is this process still using the readers it started with?
 *
 * The wall above stops the one import that is known to have armed a guard here. This
 * answers the question the wall cannot: has ANYTHING replaced the filesystem out from
 * under this server — a future hub module, a dependency, a well-meant patch nobody
 * remembers writing.
 *
 * It is deliberately not keyed on the guard's own sentinel (`globalThis.__obotLocalOnlyGuard`).
 * That name belongs to a control in another repo, it identifies exactly one culprit, and
 * a canary that only recognises the bird that already escaped is not a canary. The
 * question asked here is the general one: are these the same functions this module saw
 * at load, before any request had run.
 *
 * The references are captured at module load. Every module in this tool is loaded before
 * the server binds its port, and nothing can arm a patch before that without being a
 * static import of this tool — which is a different and much louder problem.
 */
const READERS = () => ({
  'fs.readFileSync': fs.readFileSync,
  'fs.readdirSync': fs.readdirSync,
  'fs.readFile': fs.readFile,
  'fs.createReadStream': fs.createReadStream,
  'fs/promises.readFile': fsp.readFile,
  'fs/promises.readdir': fsp.readdir,
});
const AT_LOAD = READERS();

/**
 * `{ intact, replaced }` — `replaced` names every reader that is no longer the function
 * this process started with. An empty list is the healthy answer, and it is the answer
 * a caller should insist on before believing any figure on the page: a disarmed reader
 * makes every count on this surface a guess, which is a page-level fact rather than a
 * panel-level one.
 */
export function fsIntegrity() {
  const now = READERS();
  const replaced = Object.keys(AT_LOAD).filter((k) => now[k] !== AT_LOAD[k]);
  return { intact: replaced.length === 0, replaced };
}

/** The hub module this runs, relative to a hub clone. */
export const COLLECTOR = ['scripts', 'lib', 'collect', 'decision-log.mjs'];

/** The path to the collector inside a given hub clone. */
export const collectorPath = (hub) => path.join(hub, ...COLLECTOR);

const SELF = fileURLToPath(import.meta.url);

// 176KB of decisions today. The cap is set where a runaway is still obviously a
// runaway rather than where today's payload happens to sit.
const MAX_OUTPUT = 64 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

/**
 * The hub's `collectDecisionLog()`, run out of process.
 *
 * Resolves to the collector's own return value. Rejects with a message that names
 * what failed — never with a value that could be mistaken for "the hub had nothing",
 * because the whole point of #206 is that those two must not look alike.
 */
export function collectDecisionLogIsolated(hub, { node = process.execPath, timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile(node, [SELF, hub], { maxBuffer: MAX_OUTPUT, timeout }, (err, stdout, stderr) => {
      if (err) {
        const why = String(stderr || '').trim().split('\n').slice(-4).join('; ');
        return reject(new Error(why || err.message));
      }
      try { resolve(JSON.parse(stdout)); } catch {
        reject(new Error(`the hub collector returned ${stdout.length} bytes that are not JSON`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Child entrypoint. Everything below this line runs in the process that is allowed
// to be re-armed by whatever the hub imports, and nothing it touches outlives it.
// ---------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const hub = process.argv[2];
  if (!hub) {
    process.stderr.write(`usage: ${path.basename(SELF)} <hub-clone-root>\n`);
    process.exit(2);
  }
  try {
    const { collectDecisionLog } = await import(pathToFileURL(collectorPath(hub)).href);
    process.stdout.write(JSON.stringify(await collectDecisionLog()));
  } catch (e) {
    process.stderr.write(String(e?.stack ?? e?.message ?? e) + '\n');
    process.exit(1);
  }
}
