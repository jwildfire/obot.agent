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
import { parseIQ, iqComplete } from './iq.mjs';
import { fingerprint, applyTriage } from './triage.mjs';
import { rankQueue } from './rank.mjs';
import { classifyRC, readPolicy, releaseBranchesByRepo } from '../../navigator/classify.mjs';

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
      // Answered inside a successor rather than on their own page, so out of the
      // queue — and named under it, because a reader who remembers D0015 has to be
      // able to find out where it went. A silent drop and a fixed queue look the same.
      folded: (log.folded ?? []).map((a) => ({
        id: a.id, key: a.slug, title: a.title, into: a.foldedInto?.id ?? null,
      })),
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
        // What a snooze watches: a decision that gets reworded or restated comes
        // back rather than staying asleep under an answer he has not seen.
        fingerprint: fingerprint({ kind: 'decision', key: a.slug, title: a.title, body: a.statusPlain ?? '', date: a.date }),
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
 * The next free config id **as the file alone can tell it** — from the ids that open
 * entries, open or resolved. A retired item keeps its number forever, because he may
 * have approved `c0003` in chat months ago and a reused number makes that ambiguous.
 *
 * Anchored to entry headlines, and deliberately so (obot.agent#126). This used to
 * match every `cNNNN` anywhere in the text, which cannot tell an identifier from a
 * mention: on 2026-08-15 a forward cross-reference in an entry body — "See c0011 for
 * the same problem" — set the mark before c0011 had been claimed, and the two numbers
 * under it were burned with nothing left to show they ever meant anything.
 *
 * The authority is `tools/blocker-log`, which also consults the append-only journal
 * and so still refuses an id whose entry was later deleted by hand. This function
 * sees only the file, so it is the weaker of the two answers by construction — a
 * display, never a claim.
 */
export function nextConfigId(md = '') {
  let max = 0;
  for (const m of String(md).matchAll(/^-\s+\[[ xX]\]\s*c(\d{4})\b/gim)) max = Math.max(max, Number(m[1]));
  return `c${String(max + 1).padStart(4, '0')}`;
}

/**
 * Config items, from the workspace-local file and nowhere else.
 *
 * Since 2026-08-16 (obot.agent#122) this reads the **whole entry**, not just the
 * headline. The old version deliberately stopped at the first bold run and set
 * `detail: ''` — and that is the largest reason he called these items useless:
 * the entries already carried a paste-ready command, and the page threw it away,
 * leaving one line of prose and no way to reach the instruction underneath it.
 *
 * The body is still kept off the row itself. It goes on the item as a parsed
 * installation qualification (`iq`), which the page shows only when he opens
 * that item. The containment rule is unchanged and unaffected: this page is
 * served on loopback from his own machine, the store carries the sentinel the
 * hub deploy greps for, and nothing here is ever published or committed.
 */
export function collectConfig(workspace) {
  const file = configFile(workspace);
  let md;
  try { md = fs.readFileSync(file, 'utf8'); } catch { return { items: [], error: 'no config file' }; }

  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+.*\bopen\b/i.test(l));
  if (start === -1) return { items: [], error: 'config file has no "## Open" section' };

  // An entry runs from its bullet to the next bullet or heading, and its own
  // lines are load-bearing: an indented line inside a field is the literal thing
  // he pastes. So the raw text is handed to the IQ parser intact rather than
  // being flattened into one string, which is what the previous pass did.
  const items = [];
  let buf = null;
  const flush = () => {
    if (!buf) return;
    const entry = buf.join('\n');
    const iq = parseIQ(entry);
    if (!iq.done && iq.title) {
      // The id is read from the entry, never assigned here: it is claimed once at
      // capture time (tools/blocker-log) and lives in the file so it survives the
      // item being reworded. A pre-id entry still renders — with a positional key,
      // so it stays selectable until it is backfilled.
      const key = iq.id ?? `config-${items.length + 1}`;
      items.push({
        kind: 'config',
        id: iq.id,
        key,
        title: iq.title,
        detail: '',
        date: iq.filed,
        verified: iq.verified,
        iq,
        blocks: iq.blockRefs,
        complete: iqComplete(iq),
        fingerprint: fingerprint({ kind: 'config', key, title: iq.title, body: iq.body }),
      });
    }
    buf = null;
  };

  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^##\s/.test(l)) break;
    if (/^-\s/.test(l) || /^###\s/.test(l)) { flush(); buf = [l.replace(/^###\s+/, '- [ ] — ')]; }
    else if (buf !== null) buf.push(l);
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
 * A release candidate's label: `{package} vX.Y.Z-RCn`, and nothing else.
 *
 * @jwildfire, 2026-08-15: "New rule for release candidate names: {package} Vx.x.x-RCx.
 * No other summary allowed." This supersedes his own earlier rule the same day ("RC PRs
 * should all start with a package name and a version number"), under which this function
 * *synthesised* `package version — what it is` from a messy title. A correctly-titled RC
 * now already is its label, so the work here is only to normalise what the queue still
 * carries: PRs written before the rule, whose titles hold a summary the rule has retired.
 *
 * Stripping rather than keeping that summary is the point — a page that keeps rendering
 * descriptions makes a title that has one look correct.
 *
 * Idempotent by construction. A version is never invented: with no evidence of one the
 * label is the package alone, and with no version there is no candidate to number either.
 * An `-RCn` already in the title is authoritative — the counter is a review-round fact
 * this page cannot see, so it is read, never derived.
 */
export function rcLabel({ repo, title, version = null } = {}) {
  const pkg = String(repo || '').split('/').pop() || '';
  let rest = String(title || '').trim();
  if (!pkg) return rest;

  rest = rest.replace(/^(release candidate|rc)\s*[:—–-]\s*/i, '');
  const lead = new RegExp(`^${escapeRe(pkg)}\\s+v?(\\d+(?:\\.\\d+)*)(?:-RC(\\d+))?\\s*[:—–-]?\\s*`, 'i');
  const named = lead.exec(rest);

  const v = named?.[1] ?? version ?? null;
  if (!v) return pkg;
  return `${pkg} v${v}-RC${named?.[2] ?? 1}`;
}

// One plain line: markdown emphasis, inline links and trailing punctuation-noise off.
const SUB_MAX = 120;
const plain = (s) => String(s)
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[*_`]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * The RC row's second line — the cost of "no other summary allowed" paid back.
 *
 * A bare `gsm.safety v1.1.0-RC1` in a queue of five says nothing about which release it
 * is, and the queue is read on a phone. So the description moves off the title and onto
 * a second line taken from the PR body's one-sentence executive summary, which the RC
 * body contract (@jwildfire, 2026-08-15, item 2) requires and puts first. `reviews-queue`
 * already extracts it as `lead`, so this costs no extra network call.
 *
 * That is a better line than the old derived label: the old summary was whatever an
 * author typed into a title, while this sentence is contract-mandated and has to be
 * accurate, because it is also the first thing he reads when he opens the PR.
 */
export function rcSub({ lead } = {}) {
  const text = plain(lead ?? '');
  // reviews-queue's own miss marker is not a sentence — show nothing rather than it.
  if (!text || text === '(no summary in the body)') return null;
  if (text.length <= SUB_MAX) return text;
  const cut = text.slice(0, SUB_MAX);
  const space = cut.lastIndexOf(' ');
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

// Only our own Pages site is framed. github.com answers `x-frame-options: deny` on a
// PR (verified 2026-08-15), so the PR itself can never be embedded; anything else
// off-site is not ours to embed either. Everything unframeable is still a link.
const PAGES_HOST = 'jwildfire.github.io';
const isFrameable = (url) => {
  try { return new URL(url).hostname === PAGES_HOST; } catch { return false; }
};

const MD_LINK_G = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/**
 * The RC body, parsed into the panel the dashboard renders in the middle column.
 *
 * @jwildfire asked (2026-08-15) for a release candidate to open *in* the dashboard
 * rather than sending him to GitHub. A PR cannot be iframed — github.com sets
 * `x-frame-options: deny` — and proxying his authenticated GitHub session to get around
 * that would be a security hole, not a workaround. So the panel is built natively out of
 * the body, which is possible only because the RC body contract gives every RC the same
 * shape: one-sentence exec summary, a bulleted link list carrying the demo page and
 * NEWS.md, then the requirements closed. The contract makes the panel renderable; the
 * panel is why the contract is worth enforcing. (The demo page *is* framed — Pages sets
 * no frame headers.)
 *
 * Everything is optional. RCs written before the contract still have to open, so each
 * field degrades to null or an empty list rather than throwing.
 */
export function parseRCBody(body) {
  const out = { summary: null, links: [], demo: null, news: null, requirements: [], ask: null, frameable: false };
  const lines = String(body ?? '').split('\n');

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // `**See it move:**` and `**The ask:**` are their own thing wherever they appear.
    // The contract puts them in the bullet list, but bodies written before it use bold
    // paragraphs (open.gismo#10), and either way they are never the exec summary.
    const seeItMove = /^[-*]?\s*\*\*See it move:?\*\*/i.test(line);
    const ask = /^[-*]?\s*\*\*The ask:?\*\*\s*(.+)$/i.exec(line);
    if (ask) { if (!out.ask) out.ask = plain(ask[1]); continue; }

    const closes = /^[-*]\s*Closes\s+(#\d+)\s*[—–-]?\s*(.*)$/i.exec(line);
    if (closes) {
      out.requirements.push({ ref: closes[1], text: plain(closes[2]) });
      continue;
    }

    // Links are collected from anywhere, so the panel can show what he actually linked.
    // Demo and NEWS.md are identified by *target*, never by a passing mention: a bullet
    // reading "publishes the release with the NEWS.md section via #8" links a PR, and
    // matching on the words alone picks it up as the release notes.
    const all = [...line.matchAll(MD_LINK_G)].map((m) => ({ label: plain(m[1]), url: m[2] }));
    if (/^[-*]\s/.test(line) || seeItMove) out.links.push(...all);
    for (const { label, url } of all) {
      if (!out.news && /\/NEWS\.md(\?|#|$)/i.test(url)) out.news = url;
      if (!out.demo && (seeItMove || /^demo$|demo page|annotated demo/i.test(label))) out.demo = url;
    }
    if (seeItMove) continue;

    // The exec summary: the first line that is prose — not a heading, not a bullet, not
    // the ⛔ banner, not the attribution footer.
    if (!out.summary && !/^[#>|*-]/.test(line) && !/^This PR was drafted/.test(line)
        && !line.startsWith('Closes #') && !line.startsWith('⛔')) {
      out.summary = plain(line);
    }
  }

  out.frameable = out.demo ? isFrameable(out.demo) : false;
  return out;
}

/**
 * Where the swept release candidates are cached, and the shape version inside it.
 *
 * A new file rather than a new shape in the old one, and that is not tidiness. The
 * cache is shared with whatever ops-dashboard process is already running, and this one
 * is long-lived — nothing restarts it on a merge. Writing a new shape into `rcs.json`
 * therefore reaches into a *running older server* and hands it something it cannot
 * parse: doing exactly that on 2026-08-16 turned his live queue page into a 500 in one
 * request, from a change that had not been deployed yet. The file name is the schema.
 *
 * The version field stays as the second guard. A cache written before the release-lane
 * classifier holds whatever the bucket-only test admitted and its items carry no base
 * branch, so it cannot be re-judged on the way out — the only honest move is to treat
 * it as absent and sweep again. Relabelling can be retrofitted; a wrong membership list
 * cannot.
 */
export const RC_CACHE = 'rcs-lane';
export const RC_CACHE_V = 2;

/**
 * Release candidates, from the sweep `reviews-queue` already does.
 *
 * Cached, and the cache is served immediately while a refresh runs behind it: the
 * sweep crosses the network over every repo he owns and takes seconds, and a queue
 * that makes him wait to see his own todo list has missed the point.
 *
 * `standard` rides alongside: the green, unblocked pull requests that are *not* his to
 * review because they are on the standard lane. They are not shown as RCs and never
 * counted as ones — the page names them in a single line so the difference between
 * "nothing there" and "there, and not yours" stays visible.
 */
export function collectRCs(workspace, { agent = null, maxAgeMin = 20 } = {}) {
  const raw = readCache(workspace, RC_CACHE, maxAgeMin);
  // A pre-v2 cache is an array of items; a current one is `{v, items, standard}`.
  const shaped = raw && !Array.isArray(raw.value) && raw.value?.v === RC_CACHE_V ? raw : null;
  const cached = shaped ?? (raw ? { ...raw, stale: true } : null);
  // Relabelled on the way out as well as on the way in, so a cache written before the
  // naming rule existed still reads right. `rcLabel` is idempotent, so this is free.
  // `sub` is rebuilt the same way: a cache predating the second line has a `lead` but
  // no `sub`, and this fills it in without a refresh.
  const label = (items) => (items ?? []).map((it) => ({
    ...it,
    title: rcLabel({ repo: it.repo ?? String(it.key || '').split('#')[0], title: it.title, version: it.version }),
    sub: it.sub ?? rcSub({ lead: it.lead }),
  }));
  const items = label(shaped?.value?.items);
  const standard = shaped?.value?.standard ?? [];
  if (shaped && !shaped.stale) return { items, standard, ageMin: shaped.ageMin, refreshing: false };
  if (agent) refreshRCs(workspace, agent);
  return { items, standard, ageMin: cached?.ageMin ?? null, refreshing: true };
}

/**
 * Is this row from `reviews-queue` a release candidate?
 *
 * Delegated to the Navigator sweep's classifier, which is now the program's only
 * answer to that question (`tools/navigator/classify.mjs`). Until 2026-08-16 this
 * module had no classifier at all: it took `bucket === 'you'` — mergeable, checks
 * green, nothing sent back — and called that a release candidate. Those are different
 * claims, and the difference was visible on the page: the sweep listed two RCs and the
 * dashboard listed three, the third being `gsm.safety#51`, ordinary work into `dev`.
 *
 * `bucket` is still required and still means what it meant. An RC with a failing check
 * or unaddressed review comments is the agent's to fix before it is his to read, so the
 * two tests compose: the lane says whether it is his at all, the bucket says whether it
 * is his *yet*.
 *
 * The shapes differ by one field — `reviews-queue` flattens `reviewRequests` to logins
 * — so it is adapted here rather than in the classifier, which keeps gh's own shape.
 */
export function isReleaseCandidate(pr, releases) {
  if (pr.bucket && pr.bucket !== 'you') return false;
  return classifyRC({
    isDraft: pr.draft ?? pr.isDraft ?? false,
    baseRefName: pr.base ?? pr.baseRefName,
    reviewRequests: (pr.reviewRequests ?? []).map((r) => (typeof r === 'string' ? { login: r } : r)),
    reviewDecision: pr.reviewDecision || null,
  }, releases.get(pr.repo) ?? []);
}

let refreshing = false;
export function refreshRCs(workspace, script) {
  if (refreshing) return;
  refreshing = true;
  // Read once per sweep, not once per PR. A policy file that cannot be read is not a
  // reason to show him a wrong queue, so the whole refresh is abandoned rather than
  // falling back to the bucket-only test this change exists to retire.
  let releases;
  try { releases = releaseBranchesByRepo(readPolicy()); } catch { refreshing = false; return; }
  execFile(script, ['--json'], { timeout: 60000, maxBuffer: 4 << 20 }, (err, stdout) => {
    refreshing = false;
    if (err) return;
    const items = [];
    const standard = [];
    for (const line of String(stdout).split('\n')) {
      if (!line.trim()) continue;
      try {
        const pr = JSON.parse(line);
        if (!isReleaseCandidate(pr, releases)) {
          // Not dropped in silence. A PR that is green and unblocked but on the
          // standard lane is somebody's work in flight, and a reader who saw it here
          // yesterday should be able to find out where it went rather than wonder
          // whether the queue lost it — the same rule the folded decisions get.
          if ((!pr.bucket || pr.bucket === 'you') && !pr.draft) {
            standard.push({ key: `${pr.repo}#${pr.number}`, base: pr.base, url: pr.url });
          }
          continue;
        }
        const version = upcomingVersion(workspace, pr.repo);
        items.push({
          kind: 'rc',
          key: `${pr.repo}#${pr.number}`,
          repo: pr.repo,
          version,
          rawTitle: pr.title,
          title: rcLabel({ repo: pr.repo, title: pr.title, version }),
          // Kept on the item so a relabel on the way out of the cache can rebuild the
          // second line without going back to the network.
          lead: pr.lead ?? null,
          sub: rcSub({ lead: pr.lead }),
          // Parsed once here, not in the browser: the panel then renders from the
          // cache, so it opens instantly and still opens with the network down.
          rc: parseRCBody(pr.body),
          checks: pr.checks ?? null,
          size: pr.size ?? null,
          // `why` is the field reviews-queue emits; the old `reason` never existed, so
          // every row read "ready for your call" whatever the sweep actually said.
          detail: `${pr.repo} — ${pr.why ?? 'ready for your call'}`,
          url: pr.url,
          date: (pr.updated ?? pr.updatedAt ?? '').slice(0, 10) || null,
          // A push to a snoozed pull request wakes it: the updated date is what
          // changes when there is something new to look at.
          fingerprint: fingerprint({ kind: 'rc', key: `${pr.repo}#${pr.number}`, title: pr.title, date: pr.updated ?? pr.updatedAt ?? '' }),
        });
      } catch { /* a non-JSON line is the human table; skip it */ }
    }
    writeCache(workspace, RC_CACHE, { v: RC_CACHE_V, items, standard });
  });
}

/**
 * The whole queue, in the order he should see it.
 *
 * Three passes, each owned by one module: collect (here), triage (what he has
 * snoozed or cleared), rank (what is critical and what comes first). Keeping
 * them separate is what lets the ordering rules change without the collectors
 * learning anything about importance.
 */
export async function collectQueue(workspace, hub, opts = {}) {
  const decisions = await collectDecisions(hub);
  const config = collectConfig(workspace);
  const rcs = collectRCs(workspace, opts);

  // His triage first: a dismissed row should not be ranked, counted, or pinned.
  const t = applyTriage(workspace, [...rcs.items, ...decisions.items, ...config.items]);
  const live = new Set(t.items.map((i) => i.key));
  const only = (g) => ({ ...g, items: (g.items ?? []).filter((i) => live.has(i.key)) });

  // His order, 2026-08-15: "RCs first. then decisions, then config items."
  // Release candidates hold up a release someone is waiting on; a decision
  // unblocks work already queued behind it; a config item is his keyboard and
  // can wait for it. Above all three sits the critical pin — see rank.mjs for
  // why that is cross-section and what it costs.
  const ranked = rankQueue({ decisions: only(decisions), config: only(config), rcs: only(rcs) });
  return { ...ranked, snoozed: t.snoozed, cleared: t.cleared };
}
