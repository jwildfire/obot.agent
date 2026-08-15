// What goes in the queue. Three sources, one list.
//
// The queue is @jwildfire's todo list, not a decisions viewer with a list bolted on
// (his framing, 2026-08-15: "I basically want it to be my todo list with blockers
// included"). So the three things that actually wait on him — release candidates,
// open decisions, and the config items only his hands can apply — are collected here
// as items of the same shape and sorted together.
//
// **Config** is his word for the third of those, fixed 2026-08-15 ("let's call 'your
// hands' -> 'config' and give them IDs"). The items are the workspace blockers list:
// settings lines, grants and device-side steps an agent cannot type for him. The
// source file keeps the name the approved blockers-list decision gave it — the
// vocabulary change is his, the filename was a decision he already signed — so this
// module is the single seam where `.claude/blockers.md` becomes `kind: 'config'`.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { readCache, writeCache } from './store.mjs';

/**
 * Open decisions, read from the hub clone's own collector.
 *
 * Deliberately the clone and not the deployed `decisions.json`: the generated feed
 * only exists after a deploy, so a decision recorded five minutes ago would be
 * invisible here. The clone has it the moment it is written, and the collector is
 * the same code the site runs, so the two cannot disagree about what "open" means.
 */
export async function collectDecisions(hub) {
  const mod = path.join(hub, 'scripts', 'lib', 'collect', 'decision-log.mjs');
  if (!fs.existsSync(mod)) return { items: [], error: `no decision collector at ${mod}` };
  try {
    const { collectDecisionLog } = await import(pathToFileURL(mod).href);
    const log = await collectDecisionLog();
    return {
      log,
      items: log.open.map((a) => ({
        kind: 'decision',
        id: a.id,
        key: a.slug,
        title: a.title,
        detail: a.statusPlain,
        date: a.date,
        artifact: a.slug,
        questions: a.questions ?? [],
        url: a.discussion?.url ?? null,
      })),
    };
  } catch (e) {
    return { items: [], error: String(e.message ?? e) };
  }
}

/** The config list's file. Local only — it never enters a repo or a published site. */
export const configFile = (workspace) => path.join(workspace, '.claude', 'blockers.md');

// A config id: `c` and four digits, the shape of the decision ids (D0001) so the two
// read as one scheme. Lower case is his (2026-08-15, "c0001, etc."); matching is
// case-insensitive so `C0002` in a hand-edited line still resolves.
export const CONFIG_ID_RE = /\bc(\d{4})\b/i;

/**
 * The next free config id, derived from the file and never from a stored counter —
 * the same rule the hub's decision registry follows (scripts/lib/decision-ids.mjs).
 *
 * Derived from **every** id in the file, not just the open ones: a retired item keeps
 * its number forever, because he may have approved `c0003` in chat months earlier and
 * a reused number would make that record ambiguous.
 */
export function nextConfigId(md = '') {
  let max = 0;
  for (const m of String(md).matchAll(/\bc(\d{4})\b/gi)) max = Math.max(max, Number(m[1]));
  return `c${String(max + 1).padStart(4, '0')}`;
}

/**
 * Config items, from the workspace-local file and nowhere else.
 *
 * The file is a flat markdown list under `## Open`; this reads the headline and the id
 * of each item and never the body, because the body is the part that describes exactly
 * which control stopped an agent. Even on a local page there is no reason to render
 * more than the line he needs to act on.
 */
export function collectConfig(workspace) {
  const file = configFile(workspace);
  let md;
  try { md = fs.readFileSync(file, 'utf8'); } catch { return { items: [], error: 'no config file' }; }

  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+.*\bopen\b/i.test(l));
  if (start === -1) return { items: [], error: 'config file has no "## Open" section' };

  // The list's own schema is `- [ ] filed DATE · verified DATE — **the headline** — …`,
  // and an entry wraps across several lines. So an item is gathered up to the next
  // bullet or heading, and the headline is the first bold run in it — reading only
  // the first line gives you the dates, which is not a thing anyone can act on.
  const items = [];
  let buf = null;
  const flush = () => {
    if (!buf) return;
    const done = /^-\s+\[[xX]\]/.test(buf);
    const headline = buf.match(/\*\*(.+?)\*\*/s)?.[1]
      ?? buf.replace(/^-\s+\[.\]\s*/, '').split(/\s+—\s+/)[1];
    if (!done && headline) {
      // The id is read from the entry, never assigned here: it is claimed once at
      // capture time (tools/blocker-log) and lives in the file so it survives the
      // item being reworded. A pre-id entry still renders — with a positional key,
      // so it stays selectable until it is backfilled.
      const id = buf.match(/^-\s+\[.\]\s*(c\d{4})\b/i)?.[1]?.toLowerCase() ?? null;
      items.push({
        kind: 'config',
        id,
        key: id ?? `config-${items.length + 1}`,
        title: headline.replace(/[*`]/g, '').replace(/\s+/g, ' ').trim(),
        detail: '',
        date: buf.match(/filed\s+(\d{4}-\d{2}-\d{2})/)?.[1] ?? null,
      });
    }
    buf = null;
  };

  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^##\s/.test(l)) break;
    if (/^-\s/.test(l) || /^###\s/.test(l)) { flush(); buf = l.replace(/^###\s+/, '- [ ] — '); }
    else if (buf !== null) buf += ` ${l.trim()}`;
  }
  flush();
  return { items };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The version a repo is currently heading for, from the `(Upcoming)` heading of the
 * local clone's NEWS.md — the program-wide convention (@jwildfire, 2026-08-15) that
 * every repo keeps unreleased work under `# <pkg> vX.Y.Z (Upcoming)`.
 *
 * The local clone rather than the API: this runs while he is looking at the page, and
 * the answer must not depend on the network being up or a token being alive.
 */
export function upcomingVersion(workspace, repo) {
  const pkg = String(repo || '').split('/').pop();
  if (!pkg) return null;
  try {
    const news = fs.readFileSync(path.join(workspace, pkg, 'NEWS.md'), 'utf8');
    return news.match(/^#\s+\S+\s+v?(\d+(?:\.\d+)*)\s*\(Upcoming\)/mi)?.[1] ?? null;
  } catch { return null; }
}

/**
 * A release candidate's label: `package version — what it is`.
 *
 * @jwildfire, 2026-08-15: "release candidate PRs should all start with a package name
 * and a version number." That is a naming rule for PRs written from here on (it is in
 * the RC framework), but the queue also carries PRs written before it — and a PR title
 * is not something this page can fix. So the label is derived: package from the repo,
 * version from the title when the title names *this* package's version, otherwise from
 * the release the repo is heading for.
 *
 * Idempotent by construction — a title that already reads correctly is stripped of its
 * lead and given the same one back, so nothing is ever doubled. And a version is never
 * invented: with no evidence of one, the label is the package alone.
 */
export function rcLabel({ repo, title, version = null } = {}) {
  const pkg = String(repo || '').split('/').pop() || '';
  let rest = String(title || '').trim();
  if (!pkg) return rest;

  rest = rest.replace(/^(release candidate|rc)\s*[:—–-]\s*/i, '');
  const lead = new RegExp(`^${escapeRe(pkg)}\\s+v?(\\d+(?:\\.\\d+)*)\\s*[:—–-]?\\s*`, 'i');
  const named = lead.exec(rest);
  if (named) rest = rest.slice(named[0].length);

  const v = named?.[1] ?? version ?? null;
  const head = v ? `${pkg} v${v}` : pkg;
  return rest ? `${head} — ${rest}` : head;
}

/**
 * Release candidates, from the sweep `reviews-queue` already does.
 *
 * Cached, and the cache is served immediately while a refresh runs behind it: the
 * sweep crosses the network over every repo he owns and takes seconds, and a queue
 * that makes him wait to see his own todo list has missed the point.
 */
export function collectRCs(workspace, { agent = null, maxAgeMin = 20 } = {}) {
  const cached = readCache(workspace, 'rcs', maxAgeMin);
  // Relabelled on the way out as well as on the way in, so a cache written before the
  // naming rule existed still reads right. `rcLabel` is idempotent, so this is free.
  const label = (items) => (items ?? []).map((it) => ({
    ...it,
    title: rcLabel({ repo: it.repo ?? String(it.key || '').split('#')[0], title: it.title, version: it.version }),
  }));
  if (cached && !cached.stale) return { items: label(cached.value), ageMin: cached.ageMin, refreshing: false };
  if (agent) refreshRCs(workspace, agent);
  return { items: label(cached?.value), ageMin: cached?.ageMin ?? null, refreshing: true };
}

let refreshing = false;
export function refreshRCs(workspace, script) {
  if (refreshing) return;
  refreshing = true;
  execFile(script, ['--json'], { timeout: 60000, maxBuffer: 4 << 20 }, (err, stdout) => {
    refreshing = false;
    if (err) return;
    const items = [];
    for (const line of String(stdout).split('\n')) {
      if (!line.trim()) continue;
      try {
        const pr = JSON.parse(line);
        // `you` is the bucket where nothing is blocking but him.
        if (pr.bucket && pr.bucket !== 'you') continue;
        const version = upcomingVersion(workspace, pr.repo);
        items.push({
          kind: 'rc',
          key: `${pr.repo}#${pr.number}`,
          repo: pr.repo,
          version,
          rawTitle: pr.title,
          title: rcLabel({ repo: pr.repo, title: pr.title, version }),
          // `why` is the field reviews-queue emits; the old `reason` never existed, so
          // every row read "ready for your call" whatever the sweep actually said.
          detail: `${pr.repo} — ${pr.why ?? 'ready for your call'}`,
          url: pr.url,
          date: (pr.updated ?? pr.updatedAt ?? '').slice(0, 10) || null,
        });
      } catch { /* a non-JSON line is the human table; skip it */ }
    }
    writeCache(workspace, 'rcs', items);
  });
}

/** The whole queue, in the order he should see it. */
export async function collectQueue(workspace, hub, opts = {}) {
  const decisions = await collectDecisions(hub);
  const config = collectConfig(workspace);
  const rcs = collectRCs(workspace, opts);
  return {
    decisions, config, rcs,
    // His order, 2026-08-15: "RCs first. then decisions, then config items." Release
    // candidates hold up a release someone is waiting on; a decision unblocks work
    // already queued behind it; a config item is his keyboard and can wait for it.
    items: [...rcs.items, ...decisions.items, ...config.items],
  };
}
