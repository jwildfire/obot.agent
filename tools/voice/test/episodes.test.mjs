// The property jwildfire/obot.roadmap#280 asks for, stated as tests: an OPEN decision
// artifact HAS an episode, and no episode outlives the words it was derived from.
//
// Every test here is named after the failure it forbids, because each one is a way the
// lane can look healthy while being wrong — which is this program's house defect.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ALARM_RE } from '../../ops-dashboard/lib/navigator.mjs';
import {
  CORRECTION_POLICY,
  artifactFingerprint,
  episodeCoverage,
  episodesSection,
  readEpisodes,
  recordEpisode,
  spokenText,
} from '../lib/episodes.mjs';
import { SPOKEN_WPM, TARGET_MINUTES, minutesFor, wordsForTarget } from '../lib/speech.mjs';

const NOW = new Date('2026-08-20T22:00:00Z');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

const REG = [
  { id: 'D0022', slug: '2026-08-20-branch-protections', date: '2026-08-20', state: 'open', title: 'Branch protections' },
  { id: 'D0023', slug: '2026-08-20-safety-census-rebuild', date: '2026-08-20', state: 'open', title: 'Rebuilding the safety census' },
  { id: 'D0021', slug: '2026-08-17-safetycensus-stay-or-go', date: '2026-08-17', state: 'decided', decidedOn: '2026-08-18', title: 'SafetyCensus stays or goes' },
];

const page = (body) => `<!doctype html><html><head><title>Decision</title>`
  + `<style>.q{color:red}</style></head><body>${body}</body></html>`;

/** A hub clone with a registry and a page per artifact. */
function hub(artifacts = REG, pages = null) {
  const dir = tmp('ep-hub-');
  const decisions = path.join(dir, 'reports', 'decisions');
  fs.mkdirSync(decisions, { recursive: true });
  fs.writeFileSync(path.join(decisions, 'registry.json'), JSON.stringify({ prefix: 'D', artifacts }, null, 2));
  for (const a of artifacts) {
    const html = pages && Object.hasOwn(pages, a.slug) ? pages[a.slug] : page(`<h1>${a.title}</h1><p>The recommendation is option A.</p>`);
    if (html === null) continue; // deliberately absent: the clone is missing a page the registry names
    fs.mkdirSync(path.join(decisions, a.slug), { recursive: true });
    fs.writeFileSync(path.join(decisions, a.slug, 'index.html'), html);
  }
  return dir;
}

const bed = (artifacts, pages) => ({ ws: tmp('ep-ws-'), hub: hub(artifacts, pages) });
const cover = (b) => episodeCoverage({ hub: b.hub, workspace: b.ws, now: NOW });
const rowFor = (cov, id) => cov.rows.find((r) => r.id === id);

/** Record an episode for a decision from the artifact as it stands right now. */
const shipped = (b, id, extra = {}) => {
  const slug = REG.find((a) => a.id === id).slug;
  return recordEpisode(b.ws, {
    id,
    slug,
    handle: id === 'D0022' ? 'branch protections' : 'safety census',
    title: `Decision: ${id === 'D0022' ? 'branch protections' : 'safety census'}`,
    episodeUri: `spotify:episode:fake${id}`,
    words: 700,
    hub: b.hub,
    by: 'W0087',
    at: NOW.toISOString(),
    ...extra,
  });
};

test('MISSING: an open decision with no episode is a gap, and the verdict can actually go red', () => {
  const b = bed();
  const cov = cover(b);
  assert.equal(cov.read, true);
  assert.equal(cov.missing.length, 2, 'both open decisions are owed an episode');
  assert.equal(rowFor(cov, 'D0022').state, 'missing');
  const md = episodesSection(cov, { now: NOW });
  const verdict = md.split('\n').find((l) => ALARM_RE.test(l));
  assert.ok(verdict, 'the section raises an alarm the parser will see');
  assert.match(verdict, /^\S/, 'UNINDENTED — an indented line or a "- " bullet can never render red (hub#241)');
  assert.doesNotMatch(verdict, /^- /, 'not a bullet, for the same reason');
});

test('the gap names decisions by the words he can say, never by an identifier he would have to remember', () => {
  const b = bed();
  const md = episodesSection(cover(b), { now: NOW });
  const verdict = md.split('\n').find((l) => ALARM_RE.test(l));
  assert.match(verdict, /branch protections/, 'the handle is how he would name it out loud');
  assert.doesNotMatch(verdict, /D00\d\d/, 'no decision id in the line that says what is owed');
});

test('CURRENT: a decision whose episode matches the artifact is not a gap', () => {
  const b = bed();
  shipped(b, 'D0022');
  shipped(b, 'D0023');
  const cov = cover(b);
  assert.equal(cov.missing.length, 0);
  assert.equal(cov.stale.length, 0);
  assert.equal(rowFor(cov, 'D0022').state, 'current');
});

test('THE CLEAN LINE IS STILL PRINTED — a section that speaks only on failure is indistinguishable from a dead one', () => {
  const b = bed();
  shipped(b, 'D0022');
  shipped(b, 'D0023');
  const md = episodesSection(cover(b), { now: NOW });
  assert.doesNotMatch(md, ALARM_RE, 'nothing is owed, so nothing is red');
  assert.match(md, /2 open decision\(s\), all of them with a current episode/);
});

test('STALE: an artifact corrected after its episode shipped leaves a stale episode, not a current one', () => {
  const b = bed();
  shipped(b, 'D0022');
  // The correction #266 is about: the framing changes, the evidence does not.
  fs.writeFileSync(
    path.join(b.hub, 'reports', 'decisions', '2026-08-20-branch-protections', 'index.html'),
    page('<h1>Branch protections</h1><p>The recommendation is option B.</p>'),
  );
  const cov = cover(b);
  assert.equal(rowFor(cov, 'D0022').state, 'stale');
  assert.equal(cov.stale.length, 1);
  const md = episodesSection(cov, { now: NOW });
  assert.ok(md.split('\n').some((l) => /^\S/.test(l) && ALARM_RE.test(l)), 'a stale episode is a gap, loudly');
});

test('COSMETIC: an edit that changes no spoken word leaves the episode current — the fingerprint is the words, not the bytes', () => {
  const b = bed();
  shipped(b, 'D0022');
  const file = path.join(b.hub, 'reports', 'decisions', '2026-08-20-branch-protections', 'index.html');
  fs.writeFileSync(file, `<!doctype html><html><head><title>Decision</title><style>.q{color:blue}</style>`
    + `</head><body>\n  <h1>Branch  protections</h1>\n  <p>The recommendation is option A.</p>\n</body></html>`);
  assert.equal(rowFor(cover(b), 'D0022').state, 'current', 'restyling a page does not invalidate what was said out loud');
});

test('NOTHING IS DELETED: a re-render supersedes the episode it replaces and both survive', () => {
  const b = bed();
  const first = shipped(b, 'D0022');
  const second = shipped(b, 'D0022', { episodeUri: 'spotify:episode:fresh', correction: true });
  const store = readEpisodes(b.ws);
  assert.equal(store.episodes.length, 2, 'the shipped episode stays — he may already have heard it');
  assert.equal(second.supersedes, first.recordId, 'the fresh one names what it replaces');
  assert.equal(rowFor(cover(b), 'D0022').episode.episodeUri, 'spotify:episode:fresh', 'the newest record is the current one');
});

test('A CORRECTION IS SPOKEN, NOT SILENT — the policy says so in one place, and it is the policy the section quotes', () => {
  assert.match(CORRECTION_POLICY, /correction he can hear/i);
  assert.match(CORRECTION_POLICY, /supersede/i);
  assert.doesNotMatch(CORRECTION_POLICY, /delete/i, 'nothing published is removed; he may already have heard it');
  const b = bed();
  shipped(b, 'D0022');
  fs.writeFileSync(path.join(b.hub, 'reports', 'decisions', '2026-08-20-branch-protections', 'index.html'),
    page('<h1>Branch protections</h1><p>The recommendation is option B.</p>'));
  assert.match(episodesSection(cover(b), { now: NOW }), /correction/i, 'the stale row says what happens next');
});

test('A DECIDED decision is owed nothing — the property is about OPEN artifacts', () => {
  const b = bed();
  const cov = cover(b);
  assert.equal(cov.rows.some((r) => r.id === 'D0021'), false, 'answered, so it has stopped mattering');
});

test('A FAILED REGISTRY READ is reported as a failed read, never as "every decision has an episode"', () => {
  const b = { ws: tmp('ep-ws-'), hub: tmp('ep-nohub-') };
  const cov = cover(b);
  assert.equal(cov.read, false);
  assert.equal(cov.rows.length, 0);
  const md = episodesSection(cov, { now: NOW });
  assert.match(md, /READING BROKEN/, 'spelled so ALARM_RE matches — "NO READING" does not (hub#241)');
  assert.match(md.split('\n').find((l) => ALARM_RE.test(l)) ?? '', /^\S/);
});

test('AN ARTIFACT THE REGISTRY NAMES BUT THE CLONE LACKS is unreadable, not "no episode needed"', () => {
  const b = bed(REG, { '2026-08-20-safety-census-rebuild': null });
  const cov = cover(b);
  assert.equal(rowFor(cov, 'D0023').state, 'unreadable');
  assert.equal(cov.missing.some((r) => r.id === 'D0023'), false, 'an unreadable page is a different fault from a missing episode');
  assert.match(episodesSection(cov, { now: NOW }), /could not be read/i);
});

test('ENOENT on the ledger is an empty ledger — the real answer before the first episode was ever made', () => {
  const ws = tmp('ep-ws-');
  const store = readEpisodes(ws);
  assert.equal(store.read, true, 'absent is a real answer here, and the ONLY failure allowed to read as absence');
  assert.deepEqual(store.episodes, []);
});

test('A LEDGER THAT EXISTS AND WILL NOT PARSE is a failed read, and coverage refuses to claim anything from it', () => {
  const b = bed();
  const dir = path.join(b.ws, '.claude', 'ops', 'voice');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'episodes.json'), '{ this is not json');
  assert.equal(readEpisodes(b.ws).read, false);
  const cov = cover(b);
  assert.equal(cov.read, false, 'a gap computed against an unreadable ledger would report episodes that exist as missing');
  assert.match(episodesSection(cov, { now: NOW }), /READING BROKEN/);
});

test('the ledger is local-only and stamped as such, like everything else under .claude/ops', () => {
  const b = bed();
  shipped(b, 'D0022');
  const raw = fs.readFileSync(path.join(b.ws, '.claude', 'ops', 'voice', 'episodes.json'), 'utf8');
  assert.match(raw, /LOCAL-ONLY/, 'the sentinel the hub deploy greps for');
});

test('spokenText is what a listener hears — no tags, no styles, no collapsed-away words', () => {
  const t = spokenText(page('<h1>Branch protections</h1><script>var x=1</script><p>Option&nbsp;A &mdash; recommended.</p>'));
  assert.doesNotMatch(t, /</);
  assert.doesNotMatch(t, /var x/, 'script contents are not words anybody hears');
  assert.match(t, /Branch protections/);
  assert.match(t, /Option A/);
});

test('artifactFingerprint reports a failed read as a failed read and returns no hash to compare against', () => {
  const b = bed();
  const bad = artifactFingerprint(b.hub, 'no-such-decision');
  assert.equal(bad.read, false);
  assert.equal(bad.sha, null, 'a null hash can never accidentally equal a recorded one');
  const good = artifactFingerprint(b.hub, '2026-08-20-branch-protections');
  assert.equal(good.read, true);
  assert.match(good.sha, /^[0-9a-f]{16}$/);
});

test('A HUB CLONE BEHIND ITS REMOTE is reported, because an artifact it has not fetched yet is invisible rather than absent', () => {
  const cov = { read: true, why: '', rows: [], missing: [], stale: [], unreadable: [], current: [], behind: 3, hubCommit: null };
  const md = episodesSection(cov, { now: NOW });
  assert.match(md, /3 commit\(s\) behind/, 'the open set was read from a clone that is not current');
});

test('the words-per-minute constant is the rate the published episodes actually ran at', () => {
  // Measured, not assumed: 1043w/351.7s, 759w/246.5s, 1018w/351.9s from the three
  // decision episodes published 2026-08-18 (178, 185, 174 wpm).
  assert.ok(SPOKEN_WPM >= 170 && SPOKEN_WPM <= 185, `${SPOKEN_WPM} is outside every measured episode`);
  const fiveMinutes = wordsForTarget(TARGET_MINUTES);
  assert.ok(fiveMinutes > 850 && fiveMinutes < 950, `five minutes is ~880 words, not ${fiveMinutes}`);
  assert.equal(minutesFor(1043) > 5.5 && minutesFor(1043) < 6.2, true, 'the longest published episode was 5:52');
});
