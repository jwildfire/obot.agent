// What goes in the queue. Three sources, one list.
//
// The queue is @jwildfire's todo list, not a decisions viewer with a list bolted on
// (his framing, 2026-08-15: "I basically want it to be my todo list with blockers
// included"). So the three things that actually wait on him — release candidates,
// open decisions, and the blockers only his hands can clear — are collected here as
// items of the same shape and sorted together.
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

/**
 * Blockers, from the workspace-local file and nowhere else.
 *
 * The file is a flat markdown list under `## Open`; this reads the headline of each
 * item and never the body, because the body is the part that describes exactly which
 * control stopped an agent. Even on a local page there is no reason to render more
 * than the line he needs to act on.
 */
export function collectBlockers(workspace) {
  const file = path.join(workspace, '.claude', 'blockers.md');
  let md;
  try { md = fs.readFileSync(file, 'utf8'); } catch { return { items: [], error: 'no blockers file' }; }

  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+.*\bopen\b/i.test(l));
  if (start === -1) return { items: [], error: 'blockers file has no "## Open" section' };

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
      items.push({
        kind: 'blocker',
        key: `blocker-${items.length + 1}`,
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

/**
 * Release candidates, from the sweep `reviews-queue` already does.
 *
 * Cached, and the cache is served immediately while a refresh runs behind it: the
 * sweep crosses the network over every repo he owns and takes seconds, and a queue
 * that makes him wait to see his own todo list has missed the point.
 */
export function collectRCs(workspace, { agent = null, maxAgeMin = 20 } = {}) {
  const cached = readCache(workspace, 'rcs', maxAgeMin);
  if (cached && !cached.stale) return { items: cached.value, ageMin: cached.ageMin, refreshing: false };
  if (agent) refreshRCs(workspace, agent);
  return { items: cached?.value ?? [], ageMin: cached?.ageMin ?? null, refreshing: true };
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
        items.push({
          kind: 'rc',
          key: `${pr.repo}#${pr.number}`,
          title: pr.title,
          detail: `${pr.repo} — ${pr.reason ?? 'ready for your call'}`,
          url: pr.url,
          date: (pr.updatedAt ?? '').slice(0, 10) || null,
        });
      } catch { /* a non-JSON line is the human table; skip it */ }
    }
    writeCache(workspace, 'rcs', items);
  });
}

/** The whole queue, in the order he should see it. */
export async function collectQueue(workspace, hub, opts = {}) {
  const decisions = await collectDecisions(hub);
  const blockers = collectBlockers(workspace);
  const rcs = collectRCs(workspace, opts);
  return {
    decisions, blockers, rcs,
    // Release candidates first (someone is waiting on them), then his own hands,
    // then the decisions he can answer right here.
    items: [...rcs.items, ...blockers.items, ...decisions.items],
  };
}
