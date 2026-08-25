#!/usr/bin/env node
// Render the spoken standup from what the machine already knows.
//
// The composing rules and the public rule live in `lib/standup.mjs`; this is the
// collector — the part that reads the sweep file, the hub clone, the episode ledger
// and the job records, and asks GitHub the two questions the sweep does not already
// answer: what a release candidate DOES, and whether its repository is public.
//
//   node tools/voice/standup.mjs                 # print it
//   node tools/voice/standup.mjs --out FILE      # write it, print nothing
//
// Nothing here publishes. `scripts/obot-standup` does that, because publishing needs
// the app token and the unchanged-means-no-commit rule, and both already have a
// working home in `scripts/obot-session-state`.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { artifactFingerprint, hubBehind, readEpisodes } from './lib/episodes.mjs';
import { awaitingDecisions, composeStandup, fleetCounts, leakScan, rankRows, rcRows, withEpisodes } from './lib/standup.mjs';

const WS = process.env.OBOT_WORKSPACE || path.join(os.homedir(), 'Documents', 'obot2');
const HUB = process.env.OBOT_HUB || path.join(WS, 'obot.roadmap');
const STATE_MD = path.join(WS, '.claude', 'session-hub', 'navigator-state.md');
const JOBS_DIR = process.env.OBOT_JOBS_DIR || path.join(os.homedir(), '.claude', 'jobs');
const CACHE = path.join(WS, '.claude', 'session-hub', 'cache', 'standup-rc.json');

/** How long a repository's visibility is trusted before it is asked again. */
const VISIBILITY_HOURS = 24;

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 20000 });

// Bump when anything that SHAPES a cached string changes — the summariser, the
// clipper, the title cleanup. A cache keyed only on the source text keeps serving
// sentences cut by the previous rules, which is how a fix ships and does not appear.
const CACHE_VERSION = 1;

const readCache = () => {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    return c && c._v === CACHE_VERSION ? c : { _v: CACHE_VERSION };
  } catch { return { _v: CACHE_VERSION }; }
};
const writeCache = (c) => {
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, `${JSON.stringify(c, null, 2)}\n`);
  } catch { /* the cache is an optimisation; losing it costs two API calls */ }
};

/**
 * What a pull request DOES, in one sentence, from its own body.
 *
 * "gsm.safety v1.2.0-RC1" is a filename read out loud. The obot PR template opens with
 * an executive summary, so the first real sentence of the body is the name he would
 * recognise. Headings, attribution, closing keywords and template scaffolding are
 * dropped; what survives is clipped to one sentence, because this is heard rather than
 * skimmed.
 */
export function summarise(body = '') {
  const lines = String(body).split(/\r?\n/);
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (/^[#>|\-*=]/.test(l)) continue;                       // headings, quotes, tables, bullets
    if (/^(closes|fixes|resolves)\b/i.test(l)) continue;        // the issue link
    if (/^this (pr|comment|issue) was drafted/i.test(l)) continue;
    if (/^<!--/.test(l) || /^!\[/.test(l)) continue;            // comments and images
    if (/^\**(worker|requirement|milestone)\b/i.test(l)) continue;
    const plain = l.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')     // links to their text
      .replace(/[`*_]/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (plain.length < 20) continue;
    return clipSpoken(/^(.*?[.!?])(\s|$)/.exec(plain)?.[1] ?? plain);
  }
  return null;
}

/**
 * A sentence that is too long to hear, cut where it stops being one.
 *
 * Cutting at the character limit ends mid-word ("the KDIGO nephrotoxici…"), which is
 * worse read aloud than said than written — there is no eye to skip back. So the cut
 * lands on the last clause boundary before the limit and the sentence ends there.
 */
export function clipSpoken(text = '', limit = 180) {
  const s = String(text).trim();
  if (s.length <= limit) return s;
  const head = s.slice(0, limit);
  const clause = Math.max(head.lastIndexOf('; '), head.lastIndexOf(' — '), head.lastIndexOf(', '));
  const cut = clause > limit * 0.4 ? head.slice(0, clause) : head.slice(0, head.lastIndexOf(' '));
  return `${cut.replace(/[\s,;:—–-]+$/, '')}.`;
}

/**
 * The full title of a roadmap issue the sweep could only show clipped.
 *
 * Only asked for the handful of items GitHub labels blocked, and cached against the
 * clipped title so it is asked once rather than every five minutes.
 */
function blockedTitles(md, repo = 'jwildfire/obot.roadmap') {
  const rows = rankRows(md).filter((r) => r.blocked);
  if (!rows.length) return {};
  const cache = readCache();
  const out = {};
  for (const r of rows) {
    const key = `${repo}#${r.issue}`;
    const hit = cache[key];
    if (hit && hit.clipped === r.title) { out[r.issue] = hit.title; continue; }
    try {
      const title = gh(['api', `repos/${repo}/issues/${r.issue}`, '--jq', '.title']).trim()
        .replace(/^Requirement:\s*/, '');
      cache[key] = { clipped: r.title, title };
      out[r.issue] = title;
    } catch { /* the clipped title still reaches him; it is shorter, not wrong */ }
  }
  writeCache(cache);
  return out;
}

/**
 * The release candidates, named by what they do and marked with whether their
 * repository is public.
 *
 * The visibility question is asked of GitHub rather than assumed, and a repository
 * that cannot be confirmed public is treated as private. That is the structural half
 * of the public rule on this section: a title from a private repository has never been
 * public, and this file is.
 */
function releaseCandidates(md) {
  const rows = rcRows(md);
  if (!rows.length) return { read: true, why: '', rows: [] };
  const cache = readCache();
  const now = Date.now();
  const out = [];
  let failures = 0;
  for (const r of rows) {
    const key = `${r.repo}#${r.number}`;
    const hit = cache[key];
    let summary = (hit && hit.title === r.title) ? hit.summary : undefined;
    let isPublic = (cache[r.repo] && (now - Date.parse(cache[r.repo].at || 0)) < VISIBILITY_HOURS * 3600000)
      ? cache[r.repo].isPublic
      : undefined;
    try {
      if (isPublic === undefined) {
        isPublic = gh(['api', `repos/${r.repo}`, '--jq', '.private']).trim() === 'false';
        cache[r.repo] = { isPublic, at: new Date(now).toISOString() };
      }
      if (summary === undefined) {
        summary = isPublic ? summarise(gh(['pr', 'view', String(r.number), '-R', r.repo, '--json', 'body', '--jq', '.body'])) : null;
        cache[key] = { title: r.title, summary };
      }
    } catch {
      // A failed lookup is not a private repository and not an empty summary: it is one
      // row this pass could not enrich, and the row still has to reach him.
      failures += 1;
      if (isPublic === undefined) isPublic = null;
      if (summary === undefined) summary = null;
    }
    out.push({ ...r, summary, isPublic: isPublic === null ? false : isPublic });
  }
  writeCache(cache);
  return { read: true, why: failures ? `${failures} of ${rows.length} could not be looked up` : '', rows: out };
}

/**
 * Whether each awaiting decision has an episode, and whether it still matches its page.
 *
 * `episodeCoverage` in `lib/episodes.mjs` answers this for OPEN decisions only, because
 * that is the property the Navigator polices — every open decision owes an episode. A
 * standup asks a wider question: a partly-decided artifact is still waiting on him, and
 * D0019 has an episode. Running coverage would have reported it as having none, which
 * is the same shape of wrong the partial state exists to prevent.
 *
 * Shaped like a coverage reading so `withEpisodes` has one input, not two.
 */
function episodeState(rows) {
  const ledger = readEpisodes(WS);
  if (!ledger.read) return { read: false, why: ledger.why, rows: [] };
  const newest = new Map();
  for (const e of ledger.episodes) newest.set(e.id, e);
  return {
    read: true,
    why: '',
    rows: rows.map((r) => {
      const episode = newest.get(r.id) ?? null;
      const print = artifactFingerprint(HUB, r.slug);
      let state = 'missing';
      if (!print.read) state = 'unreadable';
      else if (episode && episode.artifactSha && episode.artifactSha === print.sha) state = 'current';
      else if (episode) state = 'stale';
      return { id: r.id, state, episode };
    }),
  };
}

function main() {
  const argv = process.argv.slice(2);
  const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;
  const now = new Date();

  let md = '';
  try { md = fs.readFileSync(STATE_MD, 'utf8'); } catch { md = ''; }

  const decisions = awaitingDecisions(HUB);
  let rows = decisions.rows;
  if (decisions.read) {
    try { rows = withEpisodes(rows, episodeState(rows)); } catch { /* the ledger is optional; the decision still gets read out */ }
  }

  const text = composeStandup({
    now,
    md,
    fleet: fleetCounts(JOBS_DIR, { now }),
    rcs: releaseCandidates(md),
    titles: blockedTitles(md),
    decisions: { ...decisions, rows, behind: (() => { try { return hubBehind(HUB); } catch { return null; } })() },
  });

  // The gate. A composed file that carries anything local is not published, not
  // trimmed — a formatter that quietly removed a config id would make the next leak
  // invisible instead of loud.
  const leaks = leakScan(text);
  if (leaks.length) {
    process.stderr.write(`[standup] REFUSED — the composed file carries ${leaks.join(', ')}\n`);
    process.exitCode = 2;
    return;
  }

  if (out) fs.writeFileSync(out, text);
  else process.stdout.write(text);
}

// Guarded, because the tests import `summarise` and `clipSpoken` from here. An
// unguarded `main()` would run the whole collector — including its GitHub calls — on
// every test run, which is how a test suite acquires a network dependency nobody
// declared.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
