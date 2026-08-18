// Claim currency, both halves, on the five-minute ride.
//
// jwildfire/obot.agent#262, under jwildfire/obot.roadmap#264 and #266.
//
// Two artifact classes state claims and neither re-checks them:
//
//   config items      `.claude/blockers.md`. Every open entry carries a verify
//                     command; the Operations Dashboard runs one on a click and
//                     nothing runs them on their own. Three of the last six items
//                     left the list for being stale or mis-specified rather than
//                     for being done.
//   decision premises the published artifacts. D0021's page says a release is held
//                     pending the decision; the release published sixteen minutes
//                     before the page was written and no surface noticed.
//
// The measurement is identical — `tools/lib/claims.mjs` — and only the reading and
// the vocabulary differ. That is the whole design: one allowlist, one runner, one
// judge, one ledger, two readers.
//
// ## What this never does
//
// - It never writes to the config list. The list keeps the record; the queue is a
//   view over it, so an item that its own check proves done leaves his queue without
//   anything editing the file underneath him.
// - It never closes anything on GitHub. An item leaving a local queue and an issue
//   being closed because a check passed are different acts, and only the first is in
//   scope.
// - It never prints config item text. Ids and counts, here and everywhere else; the
//   list is local-only and this file is read by agents. Premise sentences ARE printed,
//   because they are already published on the artifact's own public page.
//
// ## Headlines
//
// Spelled for `ALARM_RE` in tools/ops-dashboard/lib/navigator.mjs, which admits only
// uppercase headlines carrying GAP / FINDING / BREACHED / FAILED / DOWN / BROKEN. A
// headline that does not match renders as ordinary grey text, and what that costs is a
// finding nobody sees. The constants are exported so the test asserts them against the
// real regular expression rather than against a copy of it.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { readFailure } from '../ops-dashboard/lib/absent.mjs';
import { collectConfig } from '../ops-dashboard/lib/collect.mjs';
import {
  CONFIG_WORDS, FAILS, HOLDS, PREMISE_WORDS, UNKNOWN,
  agoPhrase, currency, currencyPhrase, parseClaim, readChecks, runClaim, verifyPlan,
} from '../lib/claims.mjs';

/** A premise that was measured and does not hold. The page is framing an expired question. */
export const ALARM_PREMISE = '**PREMISE BROKEN**';
/** The reading itself did not happen. Not a clean bill of health, and it must not read as one. */
export const ALARM_READING = '**CLAIM CHECK BROKEN**';

/** How long the whole pass may take before it stops starting new commands. */
export const BUDGET_MS = 90000;

// ------------------------------------------------------------------ the readers

/**
 * The open config items, as claims.
 *
 * A config item's claim is "this is done" — that is the contract every verify command
 * on the list is written to, and it is why a pass takes the item out of his queue.
 */
export function configClaims(workspace) {
  const list = collectConfig(workspace);
  if (list.error) return { claims: [], read: false, absent: Boolean(list.absent), why: list.error };
  return {
    read: true,
    absent: false,
    why: null,
    claims: list.items.map((it) => claimOf({
      id: it.id ?? it.key,
      kind: 'config',
      command: it.iq?.verify?.command ?? null,
      expect: it.iq?.verify?.expect ?? null,
      manual: Boolean(it.iq?.verify?.manual),
      sentence: null,
    })),
  };
}

/**
 * `<meta name="premise" content="<what the page assumes> | <command> → <expect>">`
 *
 * One line, in the head, beside the `<meta name="description">` the artifact contract
 * already requires. The form was chosen for the reason #266 gives: "design that so an
 * artifact author can state one without ceremony, or the field will not get filled in".
 * A premise that costs a section, a schema or a build step does not get written.
 *
 * The right-hand half is the config list's own `Verify:` grammar, unchanged, so an
 * author who has written one has written the other.
 */
// Quote-aware on both halves, and it has to be. A proof may legitimately contain a
// quote of the other kind and a `>` inside one — `--jq '.a | test("x")'` does both —
// and a tag matcher that stops at the first `>` or a value matcher that stops at the
// first quote of either kind truncates the command silently and then judges the
// fragment. Measured on the real page: the extractor cut `gh api … --jq '…'` down to
// `gh api … --jq` and reported the premise as broken, which is a verdict on a command
// nobody wrote.
export const PREMISE_META = /<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const IS_PREMISE = /\bname=(["'])premise\1/i;
const CONTENT = /\bcontent=(["'])([\s\S]*?)\1/i;
// A loose scan, used only to count what the strict one could not read. A declaration
// that vanishes because its quoting is broken is worse than one that fails: nothing
// says it was ever there.
const PREMISE_LOOSE = /\bname=["']premise["']/gi;

// The arrow is written literally — an author should not have to know an entity to
// state a premise — but a page that has been through an escaper somewhere still parses.
const unescape = (s) => String(s)
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&rarr;/g, '\u2192').replace(/&#8594;/g, '\u2192').replace(/&#x2192;/gi, '\u2192')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Every premise one artifact page declares, in the order it declares them. */
export function parsePremises(html = '') {
  const out = [];
  for (const tag of String(html).match(PREMISE_META) ?? []) {
    if (!IS_PREMISE.test(tag)) continue;
    const content = CONTENT.exec(tag)?.[2];
    if (!content) continue;
    out.push(parseClaim(unescape(content)));
  }
  return out;
}

/**
 * How many premise declarations this page makes that could not be read at all.
 *
 * A malformed declaration — an unbalanced quote, a missing `content` — matches nothing
 * strict and therefore disappears. Silently, which is the shape that kills a capability
 * like this: the page looks like it declares a premise, the sweep reports nothing wrong,
 * and nobody can tell the difference between "checked and fine" and "never read".
 */
export function malformedPremises(html = '') {
  const declared = (String(html).match(PREMISE_LOOSE) ?? []).length;
  return Math.max(0, declared - parsePremises(html).length);
}

/**
 * The premises declared by the artifacts still awaiting him.
 *
 * Only those, deliberately: a premise matters because it frames a question he has not
 * answered yet, and re-checking the framing of a page he already ruled on would put
 * settled work back in front of him. How many artifacts were skipped for that reason is
 * printed, because a bound nobody can see reads as full coverage.
 *
 * The hub clone is read as files and never as code. Importing anything from that repo
 * arms a local-only guard that replaces `node:fs` for this whole process, and every
 * reading in this sweep would then report present files as absent (obot.agent#206).
 */
export function premiseClaims(hubRoot) {
  const dir = path.join(hubRoot, 'reports', 'decisions');
  const regFile = path.join(dir, 'registry.json');
  let registry;
  try { registry = JSON.parse(fs.readFileSync(regFile, 'utf8')); } catch (e) {
    const f = readFailure(e, regFile);
    return { claims: [], read: false, absent: f.absent, why: f.why, artifacts: 0, skipped: 0, unreadable: [] };
  }

  const claims = [];
  const unreadable = [];
  let artifacts = 0;
  let skipped = 0;
  for (const a of registry.artifacts ?? []) {
    // `state` is generated from the page itself by the hub's own stamper, so this is
    // the page's declaration rather than a second opinion about it.
    if (a.state !== 'open' && a.state !== 'partially decided') { skipped += 1; continue; }
    artifacts += 1;
    const file = path.join(dir, a.slug, 'index.html');
    let html;
    try { html = fs.readFileSync(file, 'utf8'); } catch (e) {
      const f = readFailure(e, file);
      unreadable.push(`${a.id}: ${f.why}`);
      continue;
    }
    const bad = malformedPremises(html);
    if (bad) unreadable.push(`${a.id}: ${bad} premise declaration${bad === 1 ? '' : 's'} on reports/decisions/${a.slug}/index.html could not be read — check the quoting; a declaration that does not parse is never checked and says nothing`);
    parsePremises(html).forEach((p, i) => claims.push(claimOf({
      id: `${a.id}.p${i + 1}`,
      kind: 'premise',
      artifact: a.id,
      slug: a.slug,
      title: a.title ?? null,
      command: p.command,
      expect: p.expect,
      manual: p.manual,
      sentence: p.sentence,
    })));
  }
  return { claims, read: true, absent: false, why: null, artifacts, skipped, unreadable };
}

/**
 * Where else a premise is asserted, in prose, for one artifact.
 *
 * 👯🤖 W0071 measured this while correcting D0021: the expired premise was stated in
 * FIVE places and true in none of them — the page, the artifact's README, the row in
 * the published index, `registry.json`, and the discussion title. Four of them reach
 * him through a different door than the page does, so a mechanism that checks the page
 * and then reports the artifact as current has left four surfaces saying the opposite.
 *
 * This does not parse those restatements and will not claim to. What it does is name
 * them, and — for the three that are files in the clone — read when each was last
 * modified, so a restatement older than the moment the premise broke is visible as
 * something still to bring along. The discussion title is on GitHub and is named
 * without a reading, which is the honest half: refusing to claim a check nobody ran is
 * what makes the other three believable.
 */
export function companionSurfaces(hubRoot, slug, { since = null, git = gitModified } = {}) {
  const files = [
    { name: 'the artifact README', rel: path.join('reports', 'decisions', slug, 'README.md') },
    { name: 'the published index row', rel: path.join('reports', 'decisions', 'README.md') },
    { name: 'the decision registry', rel: path.join('reports', 'decisions', 'registry.json') },
  ];
  const out = files.map((f) => {
    const at = git(hubRoot, f.rel);
    return {
      ...f,
      at,
      // Unknown when the modification time could not be read — never "stale", which
      // would send him to edit a file that may be perfectly current.
      stale: at && since ? Date.parse(at) < Date.parse(since) : null,
    };
  });
  out.push({ name: 'the Q&A discussion title', rel: null, at: null, stale: null, unchecked: 'on GitHub, not in the clone — nothing here has read it' });
  return out;
}

/** When git last committed a path. Read-only, and null when it cannot be answered. */
function gitModified(root, rel) {
  const r = spawnSync('git', ['-C', root, 'log', '-1', '--format=%cI', '--', rel], { encoding: 'utf8', timeout: 10000 });
  const out = String(r.stdout ?? '').trim();
  return r.status === 0 && out ? out : null;
}

/** One claim, with its plan settled once so no surface has to re-derive it. */
function claimOf(c) {
  return { ...c, plan: verifyPlan({ verify: { command: c.command, manual: c.manual } }) };
}

/**
 * One config item's currency, in the words a surface should use.
 *
 * The plan is consulted before the ledger, and the order matters. A manual item has not
 * "never been checked" — it is not checkable, and those two read completely differently
 * to somebody deciding whether to walk to a keyboard. Collapsing them would put the
 * defect back one layer up from where it was fixed.
 */
export function configCurrency(item, checks = {}, now = new Date()) {
  const command = item?.iq?.verify?.command ?? null;
  const manual = Boolean(item?.iq?.verify?.manual);
  const plan = verifyPlan({ verify: { command, manual } });
  const cur = currency(checks[item?.id ?? item?.key], { command, now });
  if (!plan.auto) {
    return { state: UNKNOWN, auto: false, done: false, ago: cur.ago, why: plan.why, phrase: `Nothing here can check this for you — ${plan.why}.` };
  }
  return { state: cur.state, auto: true, done: cur.state === HOLDS, ago: cur.ago, why: cur.why, phrase: currencyPhrase(cur, CONFIG_WORDS) };
}

// ------------------------------------------------------------------ the running

/**
 * Run every auto-runnable claim, and read the rest off the ledger.
 *
 * Bounded in wall time. What the budget stops is reported rather than dropped: a claim
 * not reached this pass keeps its previous reading and its previous age, which is the
 * honest answer — the age says how stale it is and nothing pretends it was measured.
 */
export async function runClaims(workspace, claims, { now = new Date(), budgetMs = BUDGET_MS, run = runClaim, clock = () => Date.now() } = {}) {
  const previous = readChecks(workspace);
  const started = clock();
  const out = [];
  let notReached = 0;
  for (const c of claims) {
    if (!c.plan.auto) {
      out.push({ ...c, state: UNKNOWN, ran: false, why: c.plan.why, cur: currency(previous[c.id], { command: c.command, now }) });
      continue;
    }
    if (clock() - started > budgetMs) {
      notReached += 1;
      const cur = currency(previous[c.id], { command: c.command, now });
      out.push({ ...c, state: cur.state, ran: false, why: 'not reached in this pass — the reading below is the previous one', cur });
      continue;
    }
    const rec = await run(workspace, { id: c.id, command: c.command, expect: c.expect, sentence: c.sentence, by: 'navigator-sweep' });
    out.push({ ...c, state: rec.state, ran: true, why: rec.why, rec, cur: currency(rec, { command: c.command, now }) });
  }
  return { results: out, notReached };
}

// ------------------------------------------------------------------ the section

const by = (results, state) => results.filter((r) => r.state === state);
const ids = (results) => results.map((r) => r.id).join(', ');

/**
 * The freshest reading in a set, in words. The section leads with this because the
 * whole point of the capability is that a claim carries a time and not a filing date.
 */
function freshest(results) {
  const ages = results.map((r) => r.cur?.ageMin).filter((a) => a !== null && a !== undefined);
  return ages.length ? agoPhrase(Math.min(...ages)) : null;
}

/**
 * One section covering both halves.
 *
 * Rendered even when everything is current, for the reason every other detector here
 * is: a check that only ever speaks up on failure is indistinguishable from a dead one.
 */
export function currencySection({ config, premises, now = new Date() } = {}) {
  const lines = ['## Claim currency — what has been re-checked, and when', ''];

  if (!config || !config.read) {
    lines.push(`${ALARM_READING} — the config list could not be read this pass${config?.why ? `: ${config.why}` : ''}. No item's claim was checked, which is not the same as no item needing him.`);
  } else {
    const r = config.results;
    const done = by(r, HOLDS);
    const outstanding = by(r, FAILS);
    const unknown = by(r, UNKNOWN);
    const fresh = freshest(r);
    lines.push(`config: ${r.length} open · ${done.length} done · ${outstanding.length} still outstanding · ${unknown.length} unchecked${fresh ? ` · newest reading ${fresh}` : ''}`);
    // Ids and counts. The list is local-only and this file is read by agents and by
    // 🎩🤖 prime; item text has never reached a surface and does not start here.
    if (done.length) lines.push(`  done — their own check now passes, so they are out of his queue: ${ids(done)}`);
    if (outstanding.length) lines.push(`  still outstanding, measured: ${ids(outstanding)}`);
    for (const u of unknown) lines.push(`  ${u.id} unchecked — ${u.why ?? 'no reading'}. Unknown, not outstanding and not done.`);
  }
  lines.push('');

  if (!premises || !premises.read) {
    lines.push(`${ALARM_READING} — the decision artifacts could not be read this pass${premises?.why ? `: ${premises.why}` : ''}. No premise was checked; nothing here says a page is framing a live question.`);
    return `${lines.join('\n')}\n`;
  }

  const r = premises.results;
  const broken = by(r, FAILS);
  const holds = by(r, HOLDS);
  const unknown = by(r, UNKNOWN);
  const fresh = freshest(r);
  // The alarm first, above the summary it belongs to: a verdict under its own
  // statistics is a verdict that gets skimmed past.
  for (const b of broken) {
    lines.push(`${ALARM_PREMISE} — ${b.artifact} states a premise that no longer holds${b.cur?.ago ? ` (checked ${b.cur.ago})` : ''}: "${b.sentence ?? b.command}". The evidence on that page may be sound and its framing is not.`);
    lines.push(`  ${b.slug ? `reports/decisions/${b.slug}/` : b.artifact} · proof: \`${b.command}\` → ${b.expect || 'exit 0'}`);
    // The page is one of five places the premise is asserted, so correcting the page
    // is one fifth of the correction. Naming them is the difference between a finding
    // he can finish and one that leaves four surfaces still saying the old thing.
    for (const sfc of b.surfaces ?? []) {
      lines.push(`  also stated on ${sfc.name}${sfc.rel ? ` (${sfc.rel})` : ''} — ${
        sfc.unchecked ? sfc.unchecked
          : sfc.at === null ? 'when it last changed could not be read, so whether it has been brought along is unknown'
            : sfc.stale ? `last changed ${sfc.at.slice(0, 16).replace('T', ' ')}, before the premise broke — still to bring along`
              : `last changed ${sfc.at.slice(0, 16).replace('T', ' ')}, after the premise broke`}`);
    }
  }
  lines.push(`premises: ${r.length} declared across ${premises.artifacts} artifact${premises.artifacts === 1 ? '' : 's'} still awaiting him · ${holds.length} hold · ${broken.length} expired · ${unknown.length} unchecked${fresh ? ` · newest reading ${fresh}` : ''}${premises.skipped ? ` · ${premises.skipped} decided or closed artifact${premises.skipped === 1 ? '' : 's'} not re-checked` : ''}`);
  if (holds.length) lines.push(`  holding: ${ids(holds)}`);
  for (const u of unknown) lines.push(`  ${u.id} unchecked — ${u.why ?? 'no reading'}. Unknown, not expired.`);
  for (const u of premises.unreadable ?? []) lines.push(`  ${ALARM_READING} — ${u}`);
  if (!r.length) lines.push('  No artifact declares a premise yet. That is a gap in the artifacts, not a clean result: nothing here has checked anything.');

  return `${lines.join('\n')}\n`;
}

/** The whole pass, for the sweep. Every failure is contained: this is an extra pair of eyes. */
export async function readCurrency(workspace, hubRoot, opts = {}) {
  const cfg = configClaims(workspace);
  const prem = premiseClaims(hubRoot);
  const config = cfg.read ? { ...cfg, ...(await runClaims(workspace, cfg.claims, opts)) } : cfg;
  const premises = prem.read ? { ...prem, ...(await runClaims(workspace, prem.claims, opts)) } : prem;
  // Only the broken ones pay for the surface reading: three `git log` calls apiece,
  // on a five-minute cadence, for artifacts where something is already wrong.
  if (premises.read) {
    premises.results = premises.results.map((r) => (r.state === FAILS
      ? { ...r, surfaces: companionSurfaces(hubRoot, r.slug, { since: r.cur?.at ?? null }) }
      : r));
  }
  return { config, premises, section: currencySection({ config, premises, now: opts.now }) };
}

/**
 * One artifact's premises, evaluated now — the publish-time half.
 *
 * 🧭🤖 the Navigator and I arrived at the same place from opposite ends: cadence and
 * publish-time are not redundant, they fail differently. Cadence catches the world
 * moving under a page that was right when written. This catches a page born wrong,
 * which cadence can only report forever without a path to green — D0021's first draft
 * of a premise was the corrected-away claim, and a five-minute check on it would have
 * been a permanent alarm rather than a finding.
 *
 * One clarification worth keeping, because it changes what this is for. It is not the
 * evaluation that closes the window — the premise that expired was never in a field to
 * evaluate. It is that DECLARING a premise forces the author to state it as a command,
 * so "the release is held" stops being a belief and becomes a measurement at the moment
 * of writing. The gate is worth having; the declaration is the part doing the work.
 *
 * Exits non-zero when a premise does not hold, so it can gate an authoring session.
 */
export async function checkArtifact(workspace, hubRoot, slug, opts = {}) {
  const all = premiseClaims(hubRoot);
  if (!all.read) return { ok: false, read: false, why: all.why, results: [] };
  const mine = all.claims.filter((c) => c.slug === slug);
  if (!mine.length) return { ok: true, read: true, why: `no artifact at reports/decisions/${slug}/ declares a premise`, results: [] };
  const { results } = await runClaims(workspace, mine, opts);
  return { ok: results.every((r) => r.state === HOLDS), read: true, why: null, results };
}

export { CONFIG_WORDS, PREMISE_WORDS };

// Runnable on its own, so the pass can be rehearsed without waiting five minutes for
// the sweep and without the sweep's other side effects — it fast-forwards the checkout
// and restarts the dashboard, neither of which belongs in "show me what the claims say".
//
//   node tools/navigator/currency.mjs
//
// Read-only apart from the append to the local checks ledger, which is the point of it.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const ws = process.env.OBOT_WORKSPACE || `${process.env.HOME}/Documents/obot2`;
  const hubRoot = process.env.OBOT_HUB || path.join(ws, 'obot.roadmap');
  const i = process.argv.indexOf('--artifact');
  const slug = i === -1 ? null : process.argv[i + 1];
  const run = slug
    ? checkArtifact(ws, hubRoot, slug).then((r) => {
      if (!r.read) { process.stderr.write(`premises unread: ${r.why}\n`); process.exitCode = 2; return; }
      if (r.why) { process.stdout.write(`${r.why}\n`); return; }
      for (const p of r.results) {
        process.stdout.write(`${p.state === HOLDS ? 'holds ' : p.state === FAILS ? 'BROKEN' : 'UNKNWN'}  ${p.id}  ${p.sentence ?? p.command}\n`);
        if (p.state !== HOLDS) process.stdout.write(`        ${p.command} → ${p.expect || 'exit 0'}${p.why ? ` · ${p.why}` : ''}\n`);
      }
      // Non-zero on a premise that does not hold, so an authoring session cannot
      // publish a page that is already wrong without being told.
      if (!r.ok) process.exitCode = 1;
    })
    : readCurrency(ws, hubRoot).then((r) => process.stdout.write(r.section));
  run.catch((e) => { process.stderr.write(`claim currency FAILED: ${e.stack ?? e}\n`); process.exitCode = 1; });
}
