// The style census: every surface @jwildfire reads, and which visual language it carries.
//
// Task jwildfire/obot.agent#295, under requirement jwildfire/obot.roadmap#289. His
// words, 2026-08-20: "Prioritize creating a shared style sheet for the project."
//
// ## Why a census rather than a rollout
//
// The stylesheet was the easy half and it landed on 2026-08-20. The half that is still
// true in a fortnight is this file. Every duplicated store this program has built has
// drifted — the decision log against its registry, a rank living in a chat message, a
// config count read from two places — and each one drifted because the copy was correct
// on the day it was made and nothing looked again. A rollout with no census is that
// shape exactly.
//
// So this does not ask "did we roll it out". It asks, of every surface, "where do your
// colours come from", and it refuses an answer that is "from me".
//
// ## What a palette is, measured rather than asserted
//
// A palette is a single CSS rule declaring PALETTE_MIN or more custom properties whose
// values are colours. That threshold is not a taste call: a component legitimately
// names one or two local colours, and every actual palette in this workspace when the
// census was written declared eleven or more. Nothing sits between 3 and 11, so the
// line is drawn in empty space and does not have to be re-argued.
//
// Scanning is textual on purpose. A generator holds its CSS in a template literal, and
// CSS in a template literal still looks like CSS. Parsing the JS would find the same
// bytes with more ways to be wrong, and it would not read a plain .css file at all.
//
// ## Three verdicts, and only one of them is silent
//
//   canonical  a shared sheet. It is supposed to declare a palette; that is its job.
//   consumer   takes its colours from a shared sheet and declares none of its own.
//   own        declares a palette and is not a shared sheet. Every one of these must
//              be a dated, reasoned entry in surfaces.mjs, or the census is red.
//
// The archive is handled by ratchet rather than by exemption: a dated report is a
// record of what was said on a day, and repainting it would be rewriting it. So the
// count is frozen at what it was, and the census goes red if it GROWS. You cannot fix
// the past, and you are not allowed to add to it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOTS, ALLOWED, ARCHIVES, VENDORED, SHARED_SHEETS } from './surfaces.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.join(HERE, '..', '..');

/** A rule declaring this many colour-valued custom properties is a palette. See the header. */
export const PALETTE_MIN = 4;

const SCAN_EXT = new Set(['.css', '.html', '.mjs', '.js']);
const SKIP_DIR = new Set(['node_modules', '.git', 'worktrees', '_build', 'dist', 'coverage']);
// A test is not a surface: it renders nothing anybody reads, and the fixtures in
// tools/style/test/census.test.mjs are palettes deliberately. Narrow on purpose —
// skipping whole `test/` directories would give a real surface somewhere to hide.
const isTest = (file) => /\.test\.mjs$/.test(file);

/** CSS or JS with comments stripped, so a palette quoted in a comment is not a palette. */
const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

const isColour = (v) => /#[0-9a-fA-F]{3,8}\b/.test(v) || /\b(?:rgba?|hsla?|color-mix|oklch)\s*\(/.test(v);

/**
 * Whether the text before a `{` is a CSS selector or a line of JavaScript.
 *
 * This matters more than it looks. A generator holds its CSS inside a template
 * literal inside a function, so the brace scan meets JS braces first. An early
 * version of this file treated `const landing = (log) => {` as a rule, measured its
 * whole body as one palette, and then skipped past everything inside it — which
 * would have hidden a second palette in the same file behind the first. Rules are
 * measured and skipped; anything else is pushed as plain nesting and scanned into.
 */
const CSS_SEL = /^[-\w.#:*[\]()"'=~^$|>+, ]+$/;
const JS_ISH = /=>|\b(?:function|const|let|var|return|if|for|while|try|catch|else|await|new)\b/;
export const isCssSelector = (s) => s.length > 0 && s.length < 200 && CSS_SEL.test(s) && !JS_ISH.test(s);

/**
 * Every rule declaring PALETTE_MIN or more colour custom properties, with the media
 * context it sits in. Brace-matched rather than regex'd: a rule inside `@media` nests,
 * and a scan that cannot see nesting cannot tell a palette from a dark-mode override.
 */
export function palettes(src) {
  const text = bare(src);
  const found = [];
  const stack = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      let sel = buf.trim().split('\n').pop().trim();
      // `<style>:root {` on one line is a selector wearing its tag. Strip markup only
      // when there is markup — a child combinator (`.a > .b`) has no `<` and must
      // survive untouched.
      if (sel.includes('<')) sel = sel.slice(sel.lastIndexOf('>') + 1).trim();
      buf = '';
      if (sel.startsWith('@')) { stack.push(sel); continue; }
      if (!isCssSelector(sel)) { stack.push(null); continue; }
      let depth = 1;
      let j = i + 1;
      for (; j < text.length && depth > 0; j++) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
      }
      const body = text.slice(i + 1, j - 1);
      const colours = [...body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;}]+)[;}]?/g)]
        .filter(([, , v]) => isColour(v))
        .map(([, k]) => k);
      if (colours.length >= PALETTE_MIN) {
        found.push({
          selector: sel,
          media: stack.filter(Boolean).join(' '),
          tokens: colours,
          line: text.slice(0, i).split('\n').length,
        });
      }
      i = j - 1;
    } else if (c === '}') { stack.pop(); buf = ''; }
    else buf += c;
  }
  return found;
}

/**
 * Whether a file takes its colours from a shared sheet. Three shapes count, because
 * the three consumer kinds in this workspace genuinely differ: a Node generator
 * imports and inlines, a self-contained page carries the sheet's own header line, and
 * a multi-page site links the vendored file.
 */
export function consumesShared(src) {
  const hits = [];
  if (/from\s+['"][^'"]*obot-css\.mjs['"]/.test(src) || /\bOBOT_CSS\b/.test(src)) hits.push('imports OBOT_CSS');
  if (/from\s+['"][^'"]*obot-keynote-css\.mjs['"]/.test(src) || /\bOBOT_KEYNOTE_CSS\b/.test(src)) hits.push('imports OBOT_KEYNOTE_CSS');
  if (/obot shared stylesheet/.test(src)) hits.push('carries the shared sheet');
  if (/obot shared keynote stylesheet/.test(src)) hits.push('carries the shared keynote sheet');
  for (const [, href] of src.matchAll(/<link[^>]+href="([^"]*obot(?:-keynote)?\.css)"/g)) hits.push(`links ${path.basename(href)}`);
  if (/@import\s+url\(['"]?[^'")]*obot(?:-keynote)?\.css/.test(src)) hits.push('@imports a shared sheet');
  return hits;
}

/** The workspace root, found by walking up — this repo is checked out as a clone AND as a worktree three levels down. */
export function workspaceRoot(from = REPO) {
  let at = path.resolve(from);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(at, 'obot.agent')) && fs.existsSync(path.join(at, 'obot.roadmap'))) return at;
    const up = path.dirname(at);
    if (up === at) break;
    at = up;
  }
  return null;
}

/**
 * Where a workspace-relative path actually is on this machine.
 *
 * `obot.agent/...` resolves against the checkout this file is in, never against the
 * sibling clone. That is not a detail: this census runs from a linked worktree while
 * the work is in flight, and resolving through the workspace root would have measured
 * `main` and reported a clean sheet for changes sitting unread three directories away.
 * It also lets the census run in CI, where obot.agent is the only repo on the runner.
 *
 * Every other repo resolves under the workspace root, and is absent rather than clean
 * when the clone is not here.
 */
export function resolve(root, rel) {
  const [repo, ...rest] = rel.split('/');
  const override = DEST.get(repo);
  if (override) return path.join(override, ...rest);
  if (repo === 'obot.agent') return path.join(REPO, ...rest);
  return root ? path.join(root, rel) : null;
}

/**
 * Point a repository at a checkout other than the sibling clone, as
 * `OBOT_STYLE_DEST=obot.roadmap:/path/to/worktree` (comma-separated for several).
 *
 * This exists because the change that made the census green spanned two repositories
 * and neither pull request had merged yet. Both halves lived in linked worktrees, and
 * without an override the census reads the clones sitting on main and reports the work
 * as undone — which is indistinguishable from the work actually being undone. Verifying
 * a cross-repo change before either half lands is the normal case here, not an edge.
 */
const DEST = new Map(
  String(process.env.OBOT_STYLE_DEST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const i = entry.indexOf(':');
      if (i < 1) throw new Error(`OBOT_STYLE_DEST wants <repo>:<path>, got ${JSON.stringify(entry)}`);
      return [entry.slice(0, i), path.resolve(entry.slice(i + 1))];
    }),
);

function* walk(dir, depth = 0) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIR.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 6) yield* walk(full, depth + 1); continue; }
    if (!e.isFile()) continue;
    if (SCAN_EXT.has(path.extname(e.name))) yield full;
    else if (!path.extname(e.name) && depth === 0) yield full; // extensionless CLIs live at a root's top level
  }
}

/**
 * The census. Returns every surface carrying or consuming a palette, each classified,
 * plus the roots that were not on this machine — an absent clone is reported, never
 * silently counted as clean. ENOENT is the only thing allowed to read as absence
 * (obot.agent#215); anything else about a root we could not read is a finding.
 */
export function census({ root = workspaceRoot() } = {}) {
  const surfaces = [];
  const archives = [];
  const missingRoots = [];
  const unreadable = [];

  const sharedAbs = new Set(SHARED_SHEETS.map((p) => resolve(root, p)).filter(Boolean));
  // A vendored sheet declares a palette because it IS the palette — it is the canonical
  // bytes, copied. Its honesty is checked by vendorDrift() comparing it to the source,
  // not by the register, so it must not read as an unregistered copy.
  const vendoredAbs = new Set(VENDORED.map((v) => resolve(root, v.to)).filter(Boolean));

  for (const rootSpec of ROOTS) {
    const abs = resolve(root, rootSpec.dir);
    if (!abs || !fs.existsSync(abs)) { missingRoots.push(rootSpec.dir); continue; }
    for (const file of walk(abs)) {
      if (isTest(file)) continue;
      const rel = path.join(rootSpec.dir, path.relative(abs, file));
      let src;
      try { src = fs.readFileSync(file, 'utf8'); }
      catch (err) { unreadable.push(`${rel}: ${err.code ?? err.message}`); continue; }

      const archive = ARCHIVES.find((a) => rel.startsWith(a.dir));
      const found = palettes(src);
      const consumes = consumesShared(src);
      if (!found.length && !consumes.length) continue;

      if (archive && found.length) { archives.push({ file: rel, archive: archive.dir, tokens: found[0].tokens.length }); continue; }

      let verdict;
      if (sharedAbs.has(file)) verdict = 'canonical';
      else if (vendoredAbs.has(file)) verdict = 'vendored';
      else if (found.length) verdict = 'own';
      else verdict = 'consumer';

      surfaces.push({
        file: rel,
        verdict,
        consumes,
        palettes: found.map((p) => ({ selector: p.selector, media: p.media, count: p.tokens.length, line: p.line })),
        allowed: ALLOWED.find((a) => a.file === rel) ?? null,
      });
    }
  }

  surfaces.sort((a, b) => a.file.localeCompare(b.file));
  archives.sort((a, b) => a.file.localeCompare(b.file));
  return { root, surfaces, archives, missingRoots, unreadable };
}

/**
 * A vendored sheet must be the canonical bytes. This is what makes a copy that cannot
 * drift a different thing from a copy nobody is looking at — the hub's deploy checks
 * out only itself, so a cross-repo import is impossible and vendoring is the only
 * mechanism left. It is only honest with this check behind it.
 */
export function vendorDrift({ root = workspaceRoot() } = {}) {
  const out = [];
  for (const v of VENDORED) {
    const src = resolve(root, v.from);
    const dst = resolve(root, v.to);
    // A destination repo that is not on this machine is absent, not drifted. The
    // caller reports it as a missing root; inventing a finding here would make CI red
    // for a clone it was never going to have. Checking the repo directory rather than
    // the file is the point: a missing FILE inside a present clone is real drift, and
    // must still be caught.
    if (!dst) continue;
    const repoDir = resolve(root, v.to.split('/')[0]);
    if (!repoDir || !fs.existsSync(repoDir)) continue;
    if (!fs.existsSync(src)) { out.push({ file: v.from, why: 'canonical sheet missing' }); continue; }
    if (!fs.existsSync(dst)) { out.push({ file: v.to, why: 'vendored copy missing' }); continue; }
    const a = fs.readFileSync(src, 'utf8');
    const b = fs.readFileSync(dst, 'utf8');
    // The vendored file is the canonical bytes plus a provenance header the vendor
    // script writes. Compare what follows that header, so stamping is not drift.
    const stripped = b.replace(/^\/\* VENDORED[\s\S]*?\*\/\n/, '');
    if (stripped !== a) out.push({ file: v.to, why: `differs from ${v.from}` });
  }
  return out;
}

/**
 * The three-state theme contract, checked on every surface rather than only on the
 * shared sheets.
 *
 * This is the defect that keeps recurring here, and it recurs because it is invisible:
 * a page with an unguarded `prefers-color-scheme` block looks perfect until somebody
 * sets a theme explicitly, and then renders one theme's text on the other theme's
 * ground. Three surfaces had it on 2026-08-21 — the config cards, the session hub, and
 * the hub's decisions landing — and all three had been reviewed by somebody.
 *
 * A surface with no dark block at all is not in breach. Committing to one look is a
 * legitimate decision, and the keynote sheet makes it deliberately. The contract binds
 * whoever opts into a dark theme.
 */
export function themeFaults(surface) {
  const dark = surface.palettes.filter((p) => /prefers-color-scheme/.test(p.media) || /\[data-theme=.dark.\]/.test(p.selector));
  if (!dark.length) return [];
  const out = [];
  const media = dark.filter((p) => /prefers-color-scheme/.test(p.media));
  const toggled = dark.filter((p) => !p.media && /\[data-theme=.dark.\]/.test(p.selector));
  // Two spellings satisfy "an explicit light choice still wins", and refusing the
  // second would be a check crying wolf at correct code — which is how a check gets
  // switched off. Either guard the media block as :root:not([data-theme="light"]), or
  // restate the light palette in a later :root[data-theme="light"] block: the two
  // selectors have equal specificity, so the later one wins. open.csr uses the second
  // and is right to; an earlier version of this function called it a defect.
  const lightOverrides = surface.palettes.filter((p) => !p.media && /\[data-theme=.light.\]/.test(p.selector));
  for (const p of media) {
    if (/:root:not\(\[data-theme=.light.\]\)/.test(p.selector)) continue;
    if (lightOverrides.some((l) => l.line > p.line)) continue;
    out.push({
      file: surface.file,
      kind: 'theme contract',
      detail: `the system-dark block at ${p.selector || '(rule)'} (line ~${p.line}) is unguarded and nothing later restates the light palette — write :root:not([data-theme="light"]), or add a :root[data-theme="light"] block below it, so an explicit light choice still wins`,
    });
  }
  if (media.length && !toggled.length) {
    out.push({
      file: surface.file,
      kind: 'theme contract',
      detail: 'answers prefers-color-scheme but never :root[data-theme="dark"], so an explicit toggle to dark in a light system does nothing',
    });
  }
  return out;
}

/** Every problem the census found, as one list. Empty means the roll-out is still whole. */
export function findings(result = census()) {
  const out = [];
  for (const s of result.surfaces) {
    if (s.verdict !== 'own') continue;
    if (s.allowed) continue;
    out.push({
      file: s.file,
      kind: 'unregistered palette',
      detail: `declares ${s.palettes[0].count} colour tokens at ${s.palettes[0].selector || '(rule)'} (line ~${s.palettes[0].line}) and is not in tools/style/surfaces.mjs`,
    });
  }
  for (const a of ALLOWED) {
    // A repository that is not on this machine cannot make an exemption stale. CI has
    // only obot.agent, so without this every entry for another repo would read as
    // "no longer needed" and turn the run red for a clone it was never going to have.
    if (result.missingRoots.some((dir) => a.file.startsWith(dir))) continue;
    if (!result.surfaces.some((s) => s.file === a.file)) {
      out.push({ file: a.file, kind: 'stale exemption', detail: 'registered as carrying its own palette, but the census no longer finds one — remove the entry' });
    }
  }
  for (const arc of ARCHIVES) {
    // Same reasoning: an archive in a clone that is absent has not shrunk to zero.
    if (result.missingRoots.some((dir) => arc.dir.startsWith(dir))) continue;
    const n = result.archives.filter((x) => x.archive === arc.dir).length;
    if (n > arc.frozen) {
      out.push({ file: arc.dir, kind: 'archive grew', detail: `${n} pages carry their own palette, frozen at ${arc.frozen} on ${arc.since} — a new page must consume a shared sheet` });
    }
  }
  for (const d of vendorDrift({ root: result.root })) {
    out.push({ file: d.file, kind: 'vendor drift', detail: d.why });
  }
  for (const s of result.surfaces) out.push(...themeFaults(s));
  for (const u of result.unreadable) out.push({ file: u.split(':')[0], kind: 'unreadable', detail: u });
  return out;
}
