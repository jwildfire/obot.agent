// An open decision artifact HAS an episode he can answer from a car — the standing
// property of jwildfire/obot.roadmap#280, and the ledger that lets something check it.
//
// @jwildfire, 2026-08-19: "Also add a requirement to create podcast episodes for all
// open decision artifacts."
//
// The requirement's own first paragraph is the reason this file exists rather than a
// checklist: "create episodes for all open ones" produced nothing on the day it was
// written and would produce nothing next week either, unless somebody remembered. So
// the shape here is a CONDITION the sweep can detect — an open decision with no current
// episode — in exactly the way a closed requirement with no closure summary already is
// (`tools/navigator/closures.mjs`). Nobody has to remember; the five-minute sweep asks.
//
// ## What "current" means, and why it is the words rather than the bytes
//
// An episode is derived from an artifact, and #280's fourth property is that it must not
// outlive the truth it was derived from: "If an artifact is corrected after its episode
// ships, the episode is now wrong in the one format where he cannot check."
//
// So every record carries a fingerprint of the artifact AS SPOKEN — the page with its
// markup taken off — and an episode is current only while that fingerprint still matches.
// Hashing the bytes would make every restyling a false alarm; hashing the spoken text
// fires on exactly the thing that matters, which is a sentence he would have heard
// differently. D0021's artifact was corrected the same day its episode was written, so
// this is not hypothetical.
//
// ## When it does go stale: superseded, and the correction is spoken
//
// The rule is not invented here. jwildfire/obot.roadmap#266, on the artifact side of the
// same defect, already decided it: "Correcting an expired framing is visible rather than
// a silent rewrite. A published artifact he may already have read gets a correction he
// can see, not a quiet replacement." `CORRECTION_POLICY` below is that sentence carried
// into audio, where "see" is "hear" — the shipped episode stays up because he may already
// have heard it, the decision goes back to owing one, and the fresh episode opens by
// saying what changed.
//
// ## Local only
//
// The ledger lives under `.claude/ops/voice/` with everything else this lane writes. It
// holds no words of his, but it does hold what he was told and when, and the ops store is
// the folder in this workspace that cannot reach a published site by accident.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { git } from '../../ops-dashboard/lib/provenance.mjs';
import { ensureStore, SENTINEL } from '../../ops-dashboard/lib/store.mjs';
import { artifactPath } from './artifact.mjs';
import { buildQueue, voiceDir } from './handles.mjs';

/** What happens when an artifact is corrected after its episode has shipped (#266). */
export const CORRECTION_POLICY = 'A corrected artifact supersedes its episode rather than replacing it: '
  + 'the shipped episode stays up, because he may already have heard it and nothing here removes what he has heard; '
  + 'the decision goes back to owing an episode, so this check reports it; '
  + 'and the fresh episode opens with a correction he can hear, naming what changed and that an earlier one may have '
  + 'been listened to. That is hub#266\'s rule for the page — a correction he can see, not a quiet replacement — '
  + 'said in the one format where he cannot look at the original.';

const episodesFile = (workspace) => path.join(voiceDir(workspace), 'episodes.json');

const sha16 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/**
 * The page as a listener would hear it: markup off, script and style contents gone,
 * whitespace collapsed. This is what gets fingerprinted, so a restyling is not a
 * correction and a reworded sentence is.
 */
export function spokenText(html) {
  return String(html ?? '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#8217;|&rsquo;|&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&mdash;|&ndash;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `{sha, read, why}` for one artifact's spoken text.
 *
 * A page the registry names but the clone does not have is a FAILED READ, not an
 * artifact with nothing in it — and `sha` stays null so an unread page can never
 * compare equal to a recorded fingerprint.
 */
export function artifactFingerprint(hub, slug) {
  const file = artifactPath(hub, slug);
  try {
    return { sha: sha16(spokenText(fs.readFileSync(file, 'utf8'))), read: true, why: '' };
  } catch (e) {
    return { sha: null, read: false, why: `${file} could not be read (${e.code ?? e.message})` };
  }
}

/**
 * Every episode ever recorded on this machine, oldest first. `{episodes, read, why}`.
 *
 * ENOENT is a real answer — no episode has been produced here yet — and it is the only
 * failure allowed to read as absence. A file that exists and will not parse is a failed
 * read, because reporting it as an empty ledger would report episodes that exist as
 * missing and send a worker to make them again.
 */
export function readEpisodes(workspace) {
  const file = episodesFile(workspace);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e?.code === 'ENOENT') return { episodes: [], read: true, why: '' };
    return { episodes: [], read: false, why: `${file} could not be read (${e.code ?? e.message})` };
  }
  try {
    const doc = JSON.parse(text);
    if (!Array.isArray(doc?.episodes)) return { episodes: [], read: false, why: `${file} has no episodes array` };
    return { episodes: doc.episodes, read: true, why: '' };
  } catch {
    return { episodes: [], read: false, why: `${file} is not readable JSON` };
  }
}

/**
 * Record an episode that has been published. Appends; never rewrites and never removes.
 *
 * The fingerprint is taken from the artifact at the moment of recording, so record the
 * episode from the same clone the script was written against. `supersedes` names the
 * previous record for the same decision, which is what makes a re-render legible as a
 * correction rather than as a second, competing episode.
 */
export function recordEpisode(workspace, {
  id, slug, handle = null, title = null, episodeUri = null, words = null, minutes = null,
  scriptPath = null, hub = null, by = null, correction = false, note = null, backfill = false,
  at = new Date().toISOString(),
} = {}) {
  if (!id || !slug) throw new Error('an episode record needs the decision id and its slug');
  const prior = readEpisodes(workspace);
  if (!prior.read) throw new Error(`refusing to append to a ledger that could not be read: ${prior.why}`);
  const print = hub ? artifactFingerprint(hub, slug) : { sha: null, read: false, why: 'no hub given' };
  const previous = [...prior.episodes].reverse().find((e) => e.id === id) ?? null;
  const rec = {
    recordId: sha16(`${id}|${at}|${episodeUri ?? ''}|${print.sha ?? ''}|${prior.episodes.length}`).slice(0, 12),
    id,
    slug,
    handle,
    title,
    episodeUri,
    words,
    minutes,
    scriptPath,
    // The truth this episode was derived from. Null when the page could not be read —
    // a record that cannot say what it was derived from must not look like one that can.
    artifactSha: print.sha,
    artifactRead: print.read,
    artifactWhy: print.why,
    hubCommit: hub ? (git(hub, ['rev-parse', 'HEAD']) ?? null) : null,
    hubDirty: hub ? Boolean(git(hub, ['status', '--porcelain', '--', 'reports/decisions'])) : null,
    correction: Boolean(correction),
    // A record written after the fact, from an episode that shipped before this ledger
    // existed. Its fingerprint is the page as it stands NOW, so it is only as good as the
    // page being unchanged since — which is a fact to state on the record, not to assume.
    backfill: Boolean(backfill),
    note,
    supersedes: previous?.recordId ?? null,
    by,
    at,
  };
  ensureStore(workspace);
  fs.mkdirSync(voiceDir(workspace), { recursive: true });
  fs.writeFileSync(
    episodesFile(workspace),
    `${JSON.stringify({ _note: SENTINEL, episodes: [...prior.episodes, rec] }, null, 2)}\n`,
  );
  return rec;
}

/** How far behind its remote the clone the open set was read from is, or null. */
export const hubBehind = (hub) => {
  const n = git(hub, ['rev-list', '--count', 'HEAD..@{upstream}']);
  return n === null ? null : Number(n);
};

/**
 * Which open decisions have a current episode, and which do not.
 *
 * `{read, why, rows, missing, stale, unreadable, current, behind, open}`. Each row is
 * `{id, slug, handle, questions, state, episode, why}` with `state` one of:
 *
 *   missing     — no episode has ever been recorded for it
 *   stale       — an episode shipped, and the artifact's words have changed since
 *   unreadable  — the registry names the artifact but its page could not be read
 *   current     — an episode shipped and still matches
 *
 * `read` is false when either the registry or the ledger could not be read, and NOTHING
 * is claimed from a failed read: a gap computed against an unreadable ledger would report
 * every existing episode as missing, which is the loudest possible wrong answer.
 */
export function episodeCoverage({ hub, workspace, now = new Date() } = {}) {
  const queue = buildQueue(hub, { now });
  const ledger = readEpisodes(workspace);
  const empty = {
    rows: [], missing: [], stale: [], unreadable: [], current: [],
    open: 0, behind: hubBehind(hub), hubCommit: hub ? git(hub, ['rev-parse', '--short', 'HEAD']) : null,
  };
  if (!queue.read) return { ...empty, read: false, why: queue.why };
  if (!ledger.read) return { ...empty, read: false, why: ledger.why };

  const newest = new Map();
  for (const e of ledger.episodes) newest.set(e.id, e);

  const rows = queue.decisions.map((d) => {
    const episode = newest.get(d.id) ?? null;
    const print = artifactFingerprint(hub, d.slug);
    let state;
    let why = '';
    if (!print.read) { state = 'unreadable'; why = print.why; } else if (!episode) {
      state = 'missing';
      why = 'no episode has been made for it';
    } else if (episode.artifactSha && episode.artifactSha === print.sha) {
      state = 'current';
    } else {
      state = 'stale';
      why = episode.artifactSha
        ? 'the page has been corrected since the episode shipped'
        : 'the episode was recorded without a fingerprint, so nothing can say whether it still matches';
    }
    return {
      id: d.id,
      slug: d.slug,
      handle: d.handle,
      questions: (d.questions ?? []).length,
      state,
      why,
      episode,
    };
  });

  const of = (s) => rows.filter((r) => r.state === s);
  return {
    read: true,
    why: '',
    rows,
    open: rows.length,
    missing: of('missing'),
    stale: of('stale'),
    unreadable: of('unreadable'),
    current: of('current'),
    behind: empty.behind,
    hubCommit: empty.hubCommit,
  };
}

/**
 * The Navigator's section for this property.
 *
 * THE VERDICT IS AN UNINDENTED LINE and its headline is spelled for the real `ALARM_RE`
 * — `parseNavigatorState` alarm-tests preamble notes and unindented plain lines and
 * nothing else, so a `- ` bullet can never go red however it is worded (hub#241). Note
 * also that `NO READING` does not match that regex and `READING BROKEN` does; a failed
 * read of this ledger is the case most worth shouting about, so it is spelled the second
 * way.
 *
 * The clean line is printed too. A section that speaks only when something is wrong is
 * indistinguishable from a section nothing is running.
 */
export function episodesSection(cov, { now = new Date() } = {}) {
  const lines = ['## Decision episodes — an open decision he can answer from the car', ''];

  if (!cov || cov.read === false) {
    lines.push('**DECISION EPISODE READING BROKEN** — whether every open decision has an episode could not be '
      + `established${cov?.why ? ` (${cov.why})` : ''}. Nothing here says one is owed, and nothing here says none is.`);
    return `${lines.join('\n')}\n`;
  }

  if (cov.behind) {
    // NOT "the sweep will fix it": the five-minute self-update fast-forwards the HARNESS
    // checkout and nothing else. Nothing on this machine pulls the hub clone, so a
    // decision published an hour ago can still be invisible here, and invisible reads as
    // "nothing is owed" unless this line exists.
    lines.push(`the hub clone this was read from is ${cov.behind} commit(s) behind its remote, so a decision `
      + 'published since the last fetch is invisible here rather than absent. Nothing pulls this clone '
      + 'automatically - `git -C obot.roadmap pull --ff-only` before trusting the open set.');
  }

  if (cov.unreadable.length) {
    lines.push(`**DECISION ARTIFACT READING BROKEN** — ${cov.unreadable.length} open artifact page(s) named by the `
      + `registry could not be read, so whether they are owed an episode is unknown: `
      + `${cov.unreadable.map((r) => r.handle).join(', ')}.`);
    for (const r of cov.unreadable) lines.push(`  ${r.handle} — ${r.why}`);
  }

  const owed = [...cov.missing, ...cov.stale];
  if (owed.length) {
    lines.push(`**DECISION EPISODE GAP** — ${owed.length} of ${cov.open} open decision(s) have no current episode `
      + `he could answer from a car: ${owed.map((r) => r.handle).join(', ')}.`
      + (cov.stale.length ? ` ${cov.stale.length} of those shipped an episode that no longer matches its page.` : ''));
    for (const r of owed) {
      lines.push(`- ${r.handle} — ${r.state === 'stale' ? 'STALE: ' : ''}${r.why}`
        + `${r.questions ? `, ${r.questions} question(s) waiting` : ''}.`);
    }
    if (cov.stale.length) lines.push(`  ${CORRECTION_POLICY}`);
  } else if (!cov.open) {
    lines.push('decision episodes: no open decisions — nothing is waiting on him, so nothing is owed an episode.');
  } else if (!cov.unreadable.length) {
    lines.push(`decision episodes: ${cov.open} open decision(s), all of them with a current episode.`);
    for (const r of cov.current) {
      lines.push(`- ${r.handle} — ${r.episode?.title ?? 'episode'} shipped ${String(r.episode?.at ?? '').slice(0, 10)}`
        + `${r.episode?.minutes ? `, ${r.episode.minutes} min` : ''}.`);
    }
  }

  return `${lines.join('\n')}\n`;
}
