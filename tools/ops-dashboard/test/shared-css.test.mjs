// The shared stylesheet: one copy of the decision artifacts' visual language.
//
// Requirement jwildfire/obot.agent#15, and @jwildfire on 2026-08-20: "match the css
// of the decision docs. Prioritize creating a shared style sheet for the project."
//
// The reason a test file exists rather than a convention: seventeen decision
// artifacts already carry byte-identical palettes in seventeen separate <style>
// blocks. Nothing noticed, because nothing was looking. These tests are the thing
// that looks — the palette assertions below are read from the artifacts themselves,
// so the sheet cannot drift from the pages it was extracted from without a red test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OBOT_CSS, SHARED_CSS_PATH } from '../../../assets/obot-css.mjs';
import { render } from '../lib/render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');

/** CSS without comments — every scan below works on this. */
const bare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every rule in the sheet as {selector, body, media}, by brace-matching rather than
 * by regex: a `@media` wrapper nests, and a scan that cannot see nesting cannot tell
 * a palette defined for everyone from one defined only in the dark.
 */
function rules(css) {
  const src = bare(css);
  const out = [];
  const stack = [];
  let buf = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '{') {
      const sel = buf.trim();
      buf = '';
      if (sel.startsWith('@')) { stack.push({ at: sel, start: i + 1 }); continue; }
      let depth = 1;
      let j = i + 1;
      for (; j < src.length && depth > 0; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
      }
      out.push({ selector: sel, body: src.slice(i + 1, j - 1), media: stack.map((s) => s.at).join(' ') });
      i = j - 1;
    } else if (c === '}') {
      stack.pop();
      buf = '';
    } else buf += c;
  }
  return out;
}

/** The custom properties a rule declares, as a Map of name -> value. */
function props(body) {
  const m = new Map();
  for (const [, k, v] of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) m.set(k, v.trim());
  return m;
}

const RULES = rules(OBOT_CSS);
const light = RULES.filter((r) => r.selector === ':root' && !r.media);
const systemDark = RULES.filter((r) => /prefers-color-scheme:\s*dark/.test(r.media));
const explicitDark = RULES.filter((r) => !r.media && /\[data-theme="dark"\]/.test(r.selector));

/**
 * The hub clone, found by walking up rather than by assuming a sibling: this repo is
 * checked out both as `obot2/obot.agent` and as a linked worktree three levels below
 * it, and a fixed `../obot.roadmap` is right in exactly one of those.
 */
function decisionsDir() {
  let at = REPO;
  for (let i = 0; i < 6; i++) {
    const dir = path.join(at, '..', 'obot.roadmap', 'reports', 'decisions');
    if (fs.existsSync(dir)) return dir;
    const up = path.dirname(at);
    if (up === at) break;
    at = up;
  }
  return null;
}

/**
 * The eleven colours and three families every canonical decision artifact carries,
 * read off the artifacts rather than typed here from memory. If the hub clone is not
 * beside this repo the test says so instead of passing on an empty set — a palette
 * check that silently checks nothing is the failure mode the whole program calls
 * "silent success".
 */
function artifactPalette() {
  const dir = decisionsDir();
  if (!dir) return null;
  const seen = new Map();
  let pages = 0;
  for (const slug of fs.readdirSync(dir)) {
    const file = path.join(dir, slug, 'index.html');
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    // The canonical family is the one that names its hairline --rule2. The five
    // --pg-* pages and the two --bg pages are a different template and are not
    // what "match the css of the decision docs" points at.
    if (!html.includes('--rule2:#c8bfa9')) continue;
    pages++;
    const block = /:root\s*\{([\s\S]*?)\}/.exec(html);
    if (!block) continue;
    for (const [k, v] of props(`${block[1]};`)) {
      if (!seen.has(k)) seen.set(k, new Set());
      seen.get(k).add(v.replace(/\s+/g, ' '));
    }
  }
  return { pages, seen };
}

test('the sheet exists on disk and is loaded from that one file', () => {
  assert.ok(fs.existsSync(SHARED_CSS_PATH), `the shared stylesheet must exist at ${SHARED_CSS_PATH}`);
  assert.equal(OBOT_CSS, fs.readFileSync(SHARED_CSS_PATH, 'utf8'), 'the module must serve the file, not a copy of it');
  assert.ok(OBOT_CSS.includes('obot shared stylesheet'), 'the sheet identifies itself, so a consumer carrying a copy is greppable');
});

// The palette by name, which holds anywhere — including CI, where no hub is cloned.
const CANONICAL = ['--paper', '--panel', '--ink', '--ink2', '--mute', '--rule', '--rule2',
  '--blue', '--bronze', '--flag', '--go', '--display', '--body', '--mono'];

test('the sheet declares the whole canonical vocabulary on bare :root', () => {
  assert.equal(light.length, 1, 'exactly one bare :root block defines the light palette');
  const sheet = props(light[0].body);
  const missing = CANONICAL.filter((n) => !sheet.has(n));
  assert.deepEqual(missing, [], 'every token the decision artifacts name must exist here');
});

test('the light palette is the decision artifacts\' palette, value for value', (t) => {
  const found = artifactPalette();
  // Skipped rather than passed when the hub is not on this machine — CI has no clone,
  // and a check that quietly checks nothing is the failure mode this program calls
  // silent success. A skip is visible in the run output; a green tick is not.
  if (!found) return t.skip('no obot.roadmap clone beside this repo — the palette was not compared to the artifacts');
  assert.ok(found.pages >= 10, `expected the canonical decision family to be well populated, found ${found.pages} pages`);
  assert.equal(light.length, 1, 'exactly one bare :root block defines the light palette');
  const sheet = props(light[0].body);
  for (const [name, values] of found.seen) {
    if (values.size !== 1) continue; // the pages disagree; the sheet is free to pick
    const [only] = values;
    assert.equal(sheet.get(name), only,
      `${name} is ${only} on all ${found.pages} decision artifacts — the shared sheet must not invent a different one`);
  }
});

test('three states, and no colour that exists in only one of them', () => {
  assert.ok(systemDark.length, 'the sheet must answer prefers-color-scheme: dark');
  assert.ok(systemDark.every((r) => /:root:not\(\[data-theme="light"\]\)/.test(r.selector)),
    'the system-dark block is guarded as :root:not([data-theme="light"]) so an explicit light choice wins');
  assert.ok(explicitDark.length, 'the sheet must answer :root[data-theme="dark"] so an explicit toggle wins in both directions');

  const lightProps = props(light[0].body);
  for (const r of [...systemDark, ...explicitDark]) {
    for (const name of props(r.body).keys()) {
      assert.ok(lightProps.has(name),
        `${name} is defined only inside "${r.media || r.selector}" — every colour gets its full definition on bare :root first`);
    }
  }
});

test('the two dark blocks say the same thing', () => {
  const a = new Map([...systemDark.flatMap((r) => [...props(r.body)])]);
  const b = new Map([...explicitDark.flatMap((r) => [...props(r.body)])]);
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(),
    'system dark and toggled dark must set the same properties, or the toggle renders a third theme nobody designed');
  for (const [k, v] of a) assert.equal(b.get(k), v, `${k} differs between system dark and toggled dark`);
});

test('colour lives in tokens: the components below the palette name no raw hex', () => {
  const themed = new Set([...light, ...systemDark, ...explicitDark]);
  const stray = [];
  for (const r of RULES) {
    if (themed.has(r)) continue;
    for (const [, hex] of r.body.matchAll(/(#[0-9a-fA-F]{3,8})\b/g)) stray.push(`${r.selector} { ${hex} }`);
  }
  assert.deepEqual(stray, [], 'a hard-coded colour in a component rule is a colour the dark palette cannot reach');
});

test('the dashboard serves the shared sheet itself, not a second copy of it', () => {
  const queue = {
    rcs: { items: [], refreshing: false },
    config: { items: [{ kind: 'config', id: 'c0001', key: 'c0001', title: 'An allowlist line' }] },
    decisions: { items: [] },
    items: [],
  };
  const html = render({ queue, staged: [] });
  assert.ok(html.includes(OBOT_CSS), 'the page inlines the shared sheet verbatim — the artifacts are self-contained by contract');
  // Everything the page says that the sheet did not say. A palette defined out here
  // is the second copy this whole exercise exists to prevent.
  const rest = html.split(OBOT_CSS).join('');
  const dupes = [...rest.matchAll(/(--(?:paper|panel|ink|ink2|mute|rule|rule2|blue|bronze|flag|go))\s*:\s*#/g)].map((m) => m[1]);
  assert.deepEqual(dupes, [], 'the dashboard must take the palette from the shared sheet rather than restating it');
});
