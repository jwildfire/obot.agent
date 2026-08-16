import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  surfaceKey, isLook, noteLook, lastSeen, phrase, lastSeenFile, MAX_SURFACES,
} from '../lib/last-seen.mjs';
import { render } from '../lib/render.mjs';

const ws = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ops-last-seen-'));

// Put something at the record's path by hand — a damaged file, or the wrong kind of
// thing entirely — without going through the writer that would have created it.
const seed = (dir, write) => {
  fs.mkdirSync(path.dirname(lastSeenFile(dir)), { recursive: true });
  write(lastSeenFile(dir));
};

// A request as node hands it to a handler: lowercased header names.
const req = (headers = {}, { method = 'GET', url = '/' } = {}) => ({ method, url, headers });

// The header sets below are transcribed from a real Chrome against a local server
// (2026-08-16), not invented — see the module header.
const NAVIGATION = { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site' };
const LINK_CLICK = { ...NAVIGATION, 'sec-fetch-site': 'same-origin', 'sec-fetch-user': '?1' };
const META_REFRESH = { ...NAVIGATION, 'sec-fetch-site': 'same-origin', 'cache-control': 'max-age=0' };
const IFRAME = { 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-origin' };
const XHR_POLL = { 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin' };
const FAVICON = { 'sec-fetch-dest': 'image', 'sec-fetch-mode': 'no-cors', 'sec-fetch-site': 'same-origin' };
const CURL = { accept: '*/*', 'user-agent': 'curl/8.7.1' };
const CURL_HTML = { accept: 'text/html', 'user-agent': 'curl/8.7.1' };

test('a query string or an anchor collapses to the page', () => {
  assert.equal(surfaceKey('/live.html?tab=sessions'), '/live.html');
  assert.equal(surfaceKey('/live.html?a=1&b=2'), '/live.html');
  // A fragment never reaches the server, but a client that sends one anyway
  // must not mint a second surface for the same page.
  assert.equal(surfaceKey('/live.html#queue'), '/live.html');
  assert.equal(surfaceKey('/live.html'), '/live.html');
});

test('a trailing slash, a doubled slash and a dot segment are the same surface', () => {
  assert.equal(surfaceKey('/session/'), '/session');
  assert.equal(surfaceKey('//session'), '/session');
  assert.equal(surfaceKey('/./session'), '/session');
  assert.equal(surfaceKey('/'), '/');
});

test('aliases collapse the routes that serve one page', () => {
  const aliases = { '/index.html': '/', '/session': '/live.html' };
  assert.equal(surfaceKey('/index.html', { aliases }), '/');
  assert.equal(surfaceKey('/session/', { aliases }), '/live.html');
  assert.equal(surfaceKey('/live.html', { aliases }), '/live.html');
});

test('a key can never escape into a path of its own', () => {
  assert.equal(surfaceKey('/../../etc/passwd'), '/etc/passwd');
  assert.equal(surfaceKey('%2e%2e/%2e%2e/etc/passwd'), '/etc/passwd');
  assert.equal(surfaceKey('/%ZZ'), null, 'an undecodable path is no surface at all');
  assert.equal(surfaceKey(`/${'x'.repeat(500)}`), null, 'an absurd path is no surface at all');
});

test('a look is a top-level browser navigation, and nothing else is', () => {
  assert.equal(isLook(req(NAVIGATION)).look, true, 'opening the page');
  assert.equal(isLook(req(LINK_CLICK)).look, true, 'clicking through the tab strip');
});

test('an automated poll never counts as a look', () => {
  // Every one of these would move the timestamp under a naive rule, and each
  // would silently destroy the signal for the one reader it exists for.
  for (const [what, r] of [
    ['HEAD', req(NAVIGATION, { method: 'HEAD' })],
    ['POST', req(NAVIGATION, { method: 'POST' })],
    ['curl', req(CURL)],
    ['curl claiming to want html', req(CURL_HTML)],
    ['a fetch() poll', req(XHR_POLL)],
    ['the favicon', req(FAVICON)],
    ['an iframe', req(IFRAME)],
    ['a meta refresh', req(META_REFRESH)],
    ['a page-marked reload', req(NAVIGATION, { url: '/live.html?_r=auto' })],
  ]) {
    const v = isLook(r);
    assert.equal(v.look, false, `${what} must not count as a look`);
    assert.ok(v.why, `${what} must say why it did not count`);
  }
});

test('no record renders first look — never nothing changed', () => {
  const dir = ws();
  const v = lastSeen(dir, '/');
  assert.equal(v.state, 'first');
  assert.equal(phrase(v), 'first look');
  assert.equal(fs.existsSync(lastSeenFile(dir)), false, 'reading records nothing');
});

test('a second load reports a real prior timestamp', () => {
  const dir = ws();
  const first = new Date('2026-08-16T08:00:00.000Z');
  assert.equal(lastSeen(dir, '/', first).state, 'first');
  noteLook(dir, '/', first);

  const later = new Date('2026-08-16T11:00:00.000Z');
  const v = lastSeen(dir, '/', later);
  assert.equal(v.state, 'seen');
  assert.equal(v.at, first.toISOString());
  assert.equal(v.ageMs, 3 * 3600 * 1000);
  assert.equal(phrase(v), 'last opened 3h ago');

  // Surfaces are independent: looking at one says nothing about another.
  assert.equal(lastSeen(dir, '/navigator', later).state, 'first');
});

test('the record holds the last timestamp per surface and nothing else', () => {
  const dir = ws();
  noteLook(dir, '/', new Date('2026-08-16T08:00:00.000Z'));
  noteLook(dir, '/', new Date('2026-08-16T09:00:00.000Z'));
  noteLook(dir, '/navigator', new Date('2026-08-16T09:30:00.000Z'));

  const raw = JSON.parse(fs.readFileSync(lastSeenFile(dir), 'utf8'));
  assert.deepEqual(Object.keys(raw).sort(), ['_note', 'surfaces'], 'no other field is kept');
  assert.match(raw._note, /never publish/, 'the local-only sentinel is on the file');
  assert.deepEqual(raw.surfaces, {
    '/': '2026-08-16T09:00:00.000Z',
    '/navigator': '2026-08-16T09:30:00.000Z',
  }, 'one timestamp per surface — no history, no agent, no referrer');
});

test('an unreadable record renders unknown, never a guess', () => {
  const dir = ws();
  noteLook(dir, '/', new Date('2026-08-16T08:00:00.000Z'));
  seed(dir, (f) => fs.writeFileSync(f, '{"surfaces": {"/": "2026-'));

  const v = lastSeen(dir, '/');
  assert.equal(v.state, 'unknown');
  assert.ok(v.why);
  assert.equal(phrase(v), 'last opened: unknown');
});

test('a stamp that is not a time renders unknown', () => {
  const dir = ws();
  seed(dir, (f) => fs.writeFileSync(f, JSON.stringify({ surfaces: { '/': 'yesterday' } })));
  assert.equal(lastSeen(dir, '/').state, 'unknown');
});

test('a clock that moved backwards renders unknown, not a negative age', () => {
  const dir = ws();
  noteLook(dir, '/', new Date('2026-08-16T12:00:00.000Z'));
  // The machine's clock is now behind the stamp: the window cannot be computed.
  const v = lastSeen(dir, '/', new Date('2026-08-16T09:00:00.000Z'));
  assert.equal(v.state, 'unknown');
  assert.match(v.why, /clock/i);
});

test('a stamp a moment ahead is tolerated rather than called unknown', () => {
  const dir = ws();
  const now = new Date('2026-08-16T12:00:00.000Z');
  noteLook(dir, '/', new Date(now.getTime() + 1500));
  assert.equal(lastSeen(dir, '/', now).state, 'seen', 'sub-second skew is not a broken clock');
});

test('a damaged record heals on the next look instead of staying unknown forever', () => {
  const dir = ws();
  seed(dir, (f) => fs.writeFileSync(f, 'not json at all'));
  const at = new Date('2026-08-16T09:00:00.000Z');
  noteLook(dir, '/', at);
  const v = lastSeen(dir, '/', new Date('2026-08-16T09:30:00.000Z'));
  assert.equal(v.state, 'seen');
  assert.equal(v.at, at.toISOString());
});

test('the record cannot grow without bound', () => {
  const dir = ws();
  const base = Date.parse('2026-08-16T00:00:00.000Z');
  for (let i = 0; i < MAX_SURFACES + 20; i++) noteLook(dir, `/artifact/d${i}`, new Date(base + i * 60000));
  const raw = JSON.parse(fs.readFileSync(lastSeenFile(dir), 'utf8'));
  assert.equal(Object.keys(raw.surfaces).length, MAX_SURFACES);
  assert.ok(raw.surfaces[`/artifact/d${MAX_SURFACES + 19}`], 'the newest surface is kept');
  assert.equal(raw.surfaces['/artifact/d0'], undefined, 'the oldest is evicted');
});

test('phrase says how long ago in words a person uses', () => {
  const at = Date.parse('2026-08-16T12:00:00.000Z');
  const say = (ms) => phrase({ state: 'seen', at: new Date(at).toISOString(), ageMs: ms });
  assert.equal(say(20 * 1000), 'last opened just now');
  assert.equal(say(90 * 1000), 'last opened 1m ago');
  assert.equal(say(3 * 3600 * 1000), 'last opened 3h ago');
  assert.equal(say(50 * 3600 * 1000), 'last opened 2d ago');
});

test('recording never throws, whatever the disk does', () => {
  // A serve seam must not be able to 500 because a bookkeeping file misbehaved.
  const dir = ws();
  seed(dir, (f) => fs.mkdirSync(f)); // a directory where the file should be
  assert.doesNotThrow(() => noteLook(dir, '/'));
  assert.equal(lastSeen(dir, '/').state, 'unknown');
});

test('a surface that was never resolved is never recorded', () => {
  const dir = ws();
  assert.equal(noteLook(dir, null), null);
  assert.equal(fs.existsSync(lastSeenFile(dir)), false);
});

// The consumer: the dashboard header says when he last opened the page, and says
// the honest thing in each degraded state rather than a plausible-looking window.
const HEADER_QUEUE = { rcs: { items: [], refreshing: false }, config: { items: [] }, decisions: { items: [] }, items: [] };
const header = (lastLook) => render({ queue: HEADER_QUEUE, lastLook }).match(/<header class="top">[\s\S]*?<\/header>/)[0];

test('the dashboard header renders the prior look', () => {
  const html = header({ state: 'seen', at: '2026-08-16T08:00:00.000Z', ageMs: 3 * 3600 * 1000 });
  assert.match(html, /last opened 3h ago/);
});

test('the dashboard header says first look, never nothing changed', () => {
  const html = header({ state: 'first', at: null, ageMs: null });
  assert.match(html, /first look/);
  assert.doesNotMatch(html, /nothing changed/i);
});

test('the dashboard header says unknown, and why, when it cannot know', () => {
  for (const v of [null, { state: 'unknown', why: 'the record could not be parsed' }]) {
    const html = header(v);
    assert.match(html, /last opened: unknown/);
    assert.doesNotMatch(html, /ago/, 'no window is invented for an unknown record');
  }
  assert.match(header({ state: 'unknown', why: 'the record could not be parsed' }), /could not be parsed/);
});
