// The check the requirement is actually about.
//
// jwildfire/obot.roadmap#289: "A check fails if any surface reintroduces its own copy."
// Task jwildfire/obot.agent#295.
//
// The stylesheet was the easy half. This is the half that is still true in a fortnight,
// so these tests are written against the failure rather than against the success: most
// of them reintroduce a palette and assert the census goes red. A check only proves
// something if you have watched it fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import os from 'node:os';

import { census, findings, palettes, consumesShared, isCssSelector, themeFaults, vendorDrift, vendorReach, unmeasured, verdict, resolve, workspaceRoot, PALETTE_MIN, REPO } from '../census.mjs';
import { ALLOWED, ARCHIVES, ROOTS, SHARED_SHEETS, VENDORED } from '../surfaces.mjs';
import { ALARM_RE } from '../../ops-dashboard/lib/navigator.mjs';

// ---------------------------------------------------------------- the detector

test('a palette is found wherever it hides, including inside a generator', () => {
  const css = ':root { --a:#111; --b:#222; --c:#333; --d:#444; }';
  assert.equal(palettes(css).length, 1, 'a plain sheet');

  // The shape that matters: CSS in a template literal inside a function. An early
  // version of this scanner read the function brace as a rule, swallowed everything
  // inside it, and would have missed a second palette in the same file.
  const gen = `export function render(x) {\n  const CSS = \`\n  :root { --a:#111; --b:#222; --c:#333; --d:#444; }\n  @media (prefers-color-scheme: dark) { :root { --a:#eee; --b:#ddd; --c:#ccc; --d:#bbb; } }\n  \`;\n  return CSS;\n}`;
  const found = palettes(gen);
  assert.equal(found.length, 2, 'both the light palette and the dark override are found inside the function');
  assert.equal(found[0].selector, ':root');
  assert.match(found[1].media, /prefers-color-scheme/, 'the dark one is reported with its media context');
});

test('a component naming one or two colours is not a palette', () => {
  const few = '.chip { --chip-bg:#eee; --chip-ink:#111; }';
  assert.deepEqual(palettes(few), [], `fewer than ${PALETTE_MIN} colour tokens is a component, not a palette`);
});

test('a palette quoted in a comment is not a palette', () => {
  const commented = '/* :root { --a:#111; --b:#222; --c:#333; --d:#444; } */\n.x { color:red; }';
  assert.deepEqual(palettes(commented), [], 'documentation about a palette must not read as one');
});

test('non-colour custom properties do not make a palette', () => {
  const sizes = ':root { --gap:4px; --wrap:960px; --measure:72ch; --radius:6px; --z:10; }';
  assert.deepEqual(palettes(sizes), [], 'layout tokens are not a visual language');
});

test('a JavaScript line is never mistaken for a selector', () => {
  assert.ok(isCssSelector(':root'));
  assert.ok(isCssSelector(':root:not([data-theme="light"])'));
  assert.ok(isCssSelector('.card h3, .q .rec'));
  assert.ok(!isCssSelector('const landing = (log) =>'));
  assert.ok(!isCssSelector('export function render(data)'));
  assert.ok(!isCssSelector('if (x)'));
});

test('the three consumer shapes all count as consuming', () => {
  assert.ok(consumesShared("import { OBOT_CSS } from '../../../assets/obot-css.mjs';").length, 'a generator that imports');
  assert.ok(consumesShared('<link rel="stylesheet" href="../assets/obot.css">').length, 'a page that links');
  assert.ok(consumesShared('/* obot shared stylesheet */').length, 'a page carrying the inlined sheet');
  assert.ok(consumesShared('@import url("obot-keynote.css");').length, 'a sheet that imports the shared one');
  assert.deepEqual(consumesShared('body { color:red; }'), [], 'and something that does none of those does not');
});

// ---------------------------------------------------------------- the census

test('the census reaches every declared root, or says which it could not', () => {
  const r = census();
  // An absent clone is reported, never counted as clean. ENOENT is the only thing
  // allowed to read as absence in this program (obot.agent#215), and a root that is
  // simply not on the machine is exactly that — but it must still be visible.
  for (const missing of r.missingRoots) {
    assert.ok(ROOTS.some((x) => x.dir === missing), 'a missing root is one that was declared');
  }
  assert.ok(r.surfaces.length > 0, 'the census found no surfaces at all, which means it is not looking');
  assert.deepEqual(r.unreadable, [], 'a root that exists but cannot be read is a finding, not a shrug');
});

test('this repo is measured where this file lives, not in a sibling clone', () => {
  // The census runs from a linked worktree while work is in flight. Resolving
  // obot.agent through the workspace root would measure main and report a clean sheet
  // for changes sitting unread three directories away.
  const here = resolve(workspaceRoot(), 'obot.agent/assets/obot.css');
  assert.equal(here, path.join(REPO, 'assets', 'obot.css'));
  assert.ok(fs.existsSync(here), 'and that path is real');
});

test('every shared sheet exists and identifies itself', () => {
  for (const rel of SHARED_SHEETS) {
    const file = resolve(workspaceRoot(), rel);
    assert.ok(fs.existsSync(file), `${rel} must exist — it is the thing everything else points at`);
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /obot shared (keynote )?stylesheet/, `${rel} names itself, so a consumer carrying a copy is greppable`);
  }
});

test('the workspace is clean: no surface carries an unregistered palette', () => {
  const problems = findings();
  assert.deepEqual(problems.map((p) => `${p.kind}: ${p.file}`), [],
    'each line above is a surface whose colours come from itself — adopt a shared sheet, or register it in tools/style/surfaces.mjs with a date and the issue that removes it');
});

// -------------------------------------------------- the check, watched failing

/** The census as it would read with one file's content replaced. */
function withFile(rel, content, fn) {
  const file = resolve(workspaceRoot(), rel);
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return fn();
  } finally {
    if (before === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, before);
  }
}

// Asserted as a DELTA rather than against a clean workspace (obot.agent#311). This is
// the test that proves the check can fail, and it used to require `findings()` to be
// empty first — so a real finding anywhere in the workspace disabled the proof, at
// exactly the moment somebody would want to trust it. One arrived on 2026-08-21 in
// obot.roadmap and took this test out with it. What the test is actually about is
// whether reintroducing a copy is DETECTED and whether removing it clears; ambient
// drift elsewhere is the subject of the test above, which is still absolute and is
// still red about it.
test('reintroducing a palette into an adopted surface turns the census red', () => {
  const rel = 'obot.agent/tools/style/test/__reintroduced.mjs';
  assert.deepEqual(findings().filter((p) => p.file === rel), [],
    'precondition: this surface is not already a finding before the copy is reintroduced');

  const problems = withFile(rel, [
    'export const CSS = `',
    '  :root { --paper:#F4F1EC; --card:#FDFCFA; --ink:#26211B; --accent:#B4470E;',
    '          --line:#E2DACC; --good:#2F6B4F; --warn:#8A5A00; }',
    '`;',
  ].join('\n'), () => findings());

  const hit = problems.find((p) => p.file === rel);
  assert.ok(hit, 'a new surface declaring its own palette must be found');
  assert.equal(hit.kind, 'unregistered palette');
  assert.match(hit.detail, /surfaces\.mjs/, 'and the finding must say what to do about it');

  assert.deepEqual(findings().filter((p) => p.file === rel), [],
    'and the census is green about it again once the copy is gone');
});

test('a surface that adopts the shared sheet instead does not trip it', () => {
  const rel = 'obot.agent/tools/style/test/__adopted.mjs';
  const problems = withFile(rel,
    "import { OBOT_CSS } from '../../../assets/obot-css.mjs';\nexport const page = () => `<style>${OBOT_CSS}</style>`;\n",
    () => findings());
  assert.deepEqual(problems.filter((p) => p.file === rel), [],
    'consuming the shared sheet is the whole point and must be silent');
});

test('adding a page to a frozen archive turns the census red', (t) => {
  const arc = ARCHIVES[0];
  // Every archive lives in obot.roadmap, which CI does not check out. Skipped with a
  // reason rather than passed: a green tick on a check that examined nothing is the
  // failure this program calls silent success, and a skip is visible in the output.
  if (census().missingRoots.some((dir) => arc.dir.startsWith(dir))) {
    return t.skip(`${arc.dir.split('/')[0]} is not on this machine — the archive ratchet was not exercised`);
  }
  const rel = path.join(arc.dir, '__new-report', 'index.html');
  const problems = withFile(rel,
    '<style>:root { --paper:#fff; --ink:#111; --rule:#eee; --blue:#07f; --go:#0a0; }</style>',
    () => findings());
  const hit = problems.find((p) => p.file === arc.dir && p.kind === 'archive grew');
  assert.ok(hit, 'a dated archive is frozen, not exempt: you cannot fix the past, and you may not add to it');
  assert.match(hit.detail, new RegExp(`frozen at ${arc.frozen}`));
  fs.rmSync(path.dirname(resolve(workspaceRoot(), rel)), { recursive: true, force: true });
});

test('a vendored sheet that drifts from its canonical bytes turns the census red', () => {
  const v = VENDORED[0];
  const dst = resolve(workspaceRoot(), v.to);
  if (!dst || !fs.existsSync(dst)) return; // the destination clone is not on this machine; reported as a missing root
  const problems = withFile(v.to, '/* hand-edited */\nbody { background:hotpink; }\n', () => vendorDrift());
  assert.ok(problems.some((p) => p.file === v.to), 'a vendored copy is only honest with this check behind it');
});

test('an exemption that is no longer needed is reported, so the register cannot rot', () => {
  // A stale entry is the quiet failure of a register: it reads as "still owed" long
  // after the work is done, and the next reader trusts it.
  const r = census();
  for (const a of ALLOWED) {
    const found = r.surfaces.find((s) => s.file === a.file);
    if (!found) continue; // repo not on this machine — reported as a missing root
    assert.equal(found.verdict, 'own', `${a.file} is registered as carrying its own palette but no longer does — remove the entry`);
  }
});

// ---------------------------------------------------------------- the contract

test('every exemption carries a date, a reason, and the issue that removes it', () => {
  for (const a of ALLOWED) {
    assert.match(a.since, /^\d{4}-\d{2}-\d{2}$/, `${a.file}: an exemption needs the date it was accepted`);
    assert.match(a.issue, /^[\w.-]+\/[\w.-]+#\d+$/, `${a.file}: an exemption without a way out is a decision to keep the copy forever`);
    assert.ok(a.why && a.why.length > 40, `${a.file}: the reason has to be a reason`);
  }
});

test('a sheet with a dark theme states it three times; one that declines states none', () => {
  // The contract that has bitten pages here before. A colour defined only inside a
  // media or [data-theme] block renders one theme's text on the other theme's ground.
  for (const rel of SHARED_SHEETS) {
    const src = fs.readFileSync(resolve(workspaceRoot(), rel), 'utf8');
    const found = palettes(src);
    const dark = found.filter((p) => /prefers-color-scheme/.test(p.media) || /\[data-theme="dark"\]/.test(p.selector));
    if (!dark.length) {
      // A deliberate single-look sheet is allowed, but it must still paint the ground.
      assert.match(src, /body\s*\{[^}]*background:/, `${rel} has no dark theme, so it must paint its own background explicitly`);
      continue;
    }
    assert.ok(found.some((p) => p.selector === ':root' && !p.media), `${rel}: the full light palette lives on bare :root`);
    assert.ok(dark.some((p) => /prefers-color-scheme/.test(p.media) && /:root:not\(\[data-theme="light"\]\)/.test(p.selector)),
      `${rel}: the system-dark block is guarded so an explicit light choice still wins`);
    assert.ok(dark.some((p) => !p.media && /:root\[data-theme="dark"\]/.test(p.selector)),
      `${rel}: an explicit toggle must win in both directions`);
  }
});

test('the census speaks the alarm vocabulary the Navigator actually reads', () => {
  // Imported from navigator.mjs rather than copied. A copy is a second source of truth
  // that drifts silently, and what it costs is a finding nobody sees (obot.agent#223).
  assert.ok(ALARM_RE.test('**STYLE CENSUS GAP** — 5 surfaces not accounted for'),
    'the headline the CLI writes must match the regex that colours it red');
});

// ------------------------------------------------- the three-state theme contract

/** A surface shape, as the census would report it, for the contract tests. */
const surfaceOf = (css) => ({ file: '(fixture)', palettes: palettes(css) });

test('an unguarded system-dark block is a finding', () => {
  const css = ':root { --a:#111; --b:#222; --c:#333; --d:#444; }\n'
    + '@media (prefers-color-scheme: dark) { :root { --a:#eee; --b:#ddd; --c:#ccc; --d:#bbb; } }\n'
    + ':root[data-theme="dark"] { --a:#eee; --b:#ddd; --c:#ccc; --d:#bbb; }';
  const faults = themeFaults(surfaceOf(css));
  assert.equal(faults.length, 1, 'an explicit light choice must not lose to the system');
  assert.match(faults[0].detail, /unguarded/);
});

test('the :not() guard satisfies the contract', () => {
  const css = ':root { --a:#111; --b:#222; --c:#333; --d:#444; }\n'
    + '@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --a:#eee; --b:#ddd; --c:#ccc; --d:#bbb; } }\n'
    + ':root[data-theme="dark"] { --a:#eee; --b:#ddd; --c:#ccc; --d:#bbb; }';
  assert.deepEqual(themeFaults(surfaceOf(css)), []);
});

test('a later explicit light block satisfies it too', () => {
  // open.csr spells it this way and is right to: the two selectors have equal
  // specificity, so the later one wins. An earlier version of the check called this a
  // defect, which would have been the check crying wolf at correct code — and a check
  // that cries wolf gets switched off.
  const css = ':root { --a:#111; --b:#222; --c:#333; --d:#444; }\n'
    + "@media (prefers-color-scheme: dark) { :root { --a:#eee; --b:#ddd; --c:#ccc; --d:#bbb; } }\n"
    + ":root[data-theme='light'] { --a:#111; --b:#222; --c:#333; --d:#444; }\n"
    + ":root[data-theme='dark'] { --a:#eee; --b:#ddd; --c:#ccc; --d:#bbb; }";
  assert.deepEqual(themeFaults(surfaceOf(css)), []);
});

test('a light block ABOVE the media block does not save it', () => {
  const css = ':root { --a:#111; --b:#222; --c:#333; --d:#444; }\n'
    + ':root[data-theme="light"] { --a:#111; --b:#222; --c:#333; --d:#444; }\n'
    + '@media (prefers-color-scheme: dark) { :root { --a:#eee; --b:#ddd; --c:#ccc; --d:#bbb; } }\n'
    + ':root[data-theme="dark"] { --a:#eee; --b:#ddd; --c:#ccc; --d:#bbb; }';
  assert.equal(themeFaults(surfaceOf(css)).length, 1, 'equal specificity means source order decides, and this order loses');
});

test('answering the system but not the toggle is a finding', () => {
  const css = ':root { --a:#111; --b:#222; --c:#333; --d:#444; }\n'
    + '@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --a:#eee; --b:#ddd; --c:#ccc; --d:#bbb; } }';
  const faults = themeFaults(surfaceOf(css));
  assert.equal(faults.length, 1);
  assert.match(faults[0].detail, /toggle/);
});

test('a surface with no dark theme at all is not in breach', () => {
  // Committing to one look is a decision, and the keynote sheet makes it deliberately.
  // The contract binds whoever opts into a dark theme.
  const css = ':root { --a:#111; --b:#222; --c:#333; --d:#444; }';
  assert.deepEqual(themeFaults(surfaceOf(css)), []);
});

test('every real surface in the workspace honours the contract', () => {
  const r = census();
  const faults = r.surfaces.flatMap((s) => themeFaults(s));
  assert.deepEqual(faults.map((f) => `${f.file}: ${f.detail}`), [],
    'a colour defined only for one theme state renders one theme\'s text on the other theme\'s ground');
});

test('a root that is not on this machine is reported, not counted clean', (t) => {
  const r = census();
  if (r.missingRoots.length) {
    // Visible in the run output rather than silent. CI has only obot.agent, so this is
    // the normal case there — and a check that quietly checks nothing is the failure
    // this program calls silent success.
    t.diagnostic(`not on this machine, so not measured: ${r.missingRoots.join(', ')}`);
  }
  assert.ok(r.surfaces.some((s) => s.file.startsWith('obot.agent/')), 'this repo is always measurable');
});

// ------------------------------------------- the third state: what it did NOT read
//
// jwildfire/obot.agent#309. Every test below is written against the run rather than
// against a surface, because that is where the hole was: each skip for an absent clone
// was deliberate and right, and each one was silent, so `--findings` and `--md` printed
// byte-identical output with safety.viz, open.gismo and open.csr cloned and without
// them. A check that says the same thing about eight surfaces and about five is not
// measuring the three.

/** A constructed machine: every repo but this one pointed somewhere we built. */
function onMachine(dests, argv = ['--findings']) {
  const env = { ...process.env, OBOT_STYLE_DEST: Object.entries(dests).map(([r, d]) => `${r}:${d}`).join(',') };
  const args = [path.join(REPO, 'tools', 'style-census'), ...argv];
  try {
    return { out: execFileSync(process.execPath, args, { encoding: 'utf8', env }), code: 0 };
  } catch (err) {
    return { out: String(err.stdout ?? ''), code: err.status ?? 1 };
  }
}

const PALETTE = ':root { --paper:#F4F1EC; --card:#FDFCFA; --ink:#26211B; --accent:#B4470E; --rule:#E3DDD4; }\n';

/**
 * A machine with safety.viz on it, and the same machine without it — differing in
 * nothing else. Every other repo is pinned at an absent path in both, so the run is
 * identical on the CI runner and on his laptop and any difference is attributable.
 */
function twoMachines(t, { drifted = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'style-census-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const gone = (repo) => path.join(tmp, 'nothing-here', repo);
  const sv = path.join(tmp, 'safety.viz');
  fs.mkdirSync(path.join(sv, 'site'), { recursive: true });
  // The registered path has to exist and carry a palette, or the run is measuring a
  // stale exemption rather than a present-and-clean clone.
  fs.writeFileSync(path.join(sv, 'site', 'site.css'), PALETTE);
  if (drifted) fs.writeFileSync(path.join(sv, 'site', 'newpage.css'), PALETTE);
  const others = { 'obot.roadmap': gone('obot.roadmap'), 'open.gismo': gone('open.gismo'), 'open.csr': gone('open.csr') };
  return {
    present: (argv) => onMachine({ ...others, 'safety.viz': sv }, argv),
    absent: (argv) => onMachine({ ...others, 'safety.viz': gone('safety.viz') }, argv),
  };
}

test('the verdict forms tell a clone that is absent from one that is present and clean', (t) => {
  // The defect, watched. Before #309 both of these printed the same bytes, so nothing
  // a reader could see distinguished "safety.viz is clean" from "safety.viz was never
  // opened". The default register form always differed; the two that carry a verdict
  // did not, and those are the ones the gate and the Navigator read.
  const m = twoMachines(t);
  for (const argv of [['--findings'], ['--md']]) {
    const present = m.present(argv);
    const absent = m.absent(argv);
    assert.notEqual(present.out, absent.out, `${argv[0]} says the same thing whether or not safety.viz is on the machine`);
    assert.match(absent.out, /safety\.viz\/site/, `${argv[0]} must name what it could not reach`);
    assert.match(absent.out, /[Uu]nknown, not clean|UNKNOWN/, `${argv[0]} must say unknown rather than leave it out`);
  }
});

test('a public site that drifts turns the census red, and goes unknown when its clone is absent', (t) => {
  // The same drift on disk, twice: reachable, and not. One is a finding; the other is
  // an explicit statement that nothing there was looked at. What it must never be is
  // the word `clean`.
  const m = twoMachines(t, { drifted: true });

  const present = m.present();
  assert.equal(present.code, 1, present.out);
  assert.match(present.out, /FINDING {2}safety\.viz\/site\/newpage\.css/, present.out);

  const absent = m.absent();
  assert.equal(absent.code, 0, 'an absent clone is not a defect anybody on this machine can fix');
  assert.doesNotMatch(absent.out, /newpage/, 'it cannot report a file it never opened');
  assert.match(absent.out, /UNKNOWN {2}safety\.viz\/site\n {9}root:/, absent.out);
  assert.doesNotMatch(absent.out, /census: clean —/, 'clean is a claim about surfaces that were read');
});

test('a registered exemption is not restated as current by a run that never opened it', (t) => {
  const m = twoMachines(t);
  const absent = m.absent(['--md']);
  assert.match(absent.out, /safety\.viz\/site\/site\.css — NOT EXAMINED/, absent.out);
  assert.doesNotMatch(absent.out, /registered exemptions outstanding/, 'the register count is a claim too');
  const present = m.present(['--md']);
  assert.match(present.out, /safety\.viz\/site\/site\.css — registered \d{4}-\d{2}-\d{2}/, present.out);
});

test('a workspace with only this repo in it is unknown, not clean, and still not red', () => {
  // The shape CI actually runs in: obot.agent checked out alone. It must not be red —
  // a check that fails for a clone the runner was never going to have is a check
  // somebody deletes — and it must not say `clean` either, which is what it used to
  // say about fifteen things it had not looked at. This test asserted that sentence
  // until #309; the defect was written down here as the expected behaviour.
  const gone = path.join(REPO, 'tools', 'style', 'test', '__absent');
  const { out, code } = onMachine(Object.fromEntries(
    ['obot.roadmap', 'safety.viz', 'open.gismo', 'open.csr'].map((r) => [r, path.join(gone, r)])));
  assert.equal(code, 0, out);
  assert.match(out, /census: clean for what could be read — \d+ things above went unexamined\. Unknown, not clean\./, out);
  assert.doesNotMatch(out, /census: clean —/, out);
  for (const repo of ['obot.roadmap', 'safety.viz', 'open.gismo', 'open.csr']) {
    assert.ok(out.includes(`${repo} is not on this machine`), `${repo} went unmeasured and the run has to say so`);
  }
});

test('a declared root gone from a clone that IS present is a finding, not an absence', (t) => {
  // The distinction vendorDrift() already draws one level down. A surface that moved
  // and took its palette out of the census\'s sight reads exactly like a laptop that
  // never had the clone, unless somebody checks the clone directory first.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'style-census-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const sv = path.join(tmp, 'safety.viz');
  fs.mkdirSync(path.join(sv, 'docs'), { recursive: true }); // the clone is here; site/ is not
  const { out, code } = onMachine({ 'safety.viz': sv });
  assert.equal(code, 1, out);
  assert.match(out, /FINDING {2}safety\.viz\/site\n {9}root missing:/, out);
  assert.doesNotMatch(out, /UNKNOWN {2}safety\.viz\/site\n/, 'a clone that is here has not gone missing');
  assert.doesNotMatch(out, /stale exemption: .*\n/, 'the vanished root is the cause; "remove the entry" is the wrong advice for it');
});

test('the skips nobody could see are each named', () => {
  // Three silent skips beyond the three public sites, all live at once on the runner:
  // an exemption not re-checked, an archive ratchet not counted, and a vendored copy
  // never compared to its canonical bytes.
  const gone = path.join(REPO, 'tools', 'style', 'test', '__absent');
  const r = census({ root: gone });
  const kinds = new Set(unmeasured(r).map((u) => u.kind));
  for (const kind of ['root', 'registered exemption', 'archive ratchet', 'vendored copy']) {
    assert.ok(kinds.has(kind), `${kind} is skipped when its clone is absent, and the skip has to be visible`);
  }
  assert.equal(vendorReach({ root: gone }).checked.length, 0, 'nothing was compared');
  assert.equal(vendorReach({ root: gone }).unchecked.length, VENDORED.length, 'and every pair says so');
});

test('unknown, clean and drifted are three states, and only one of them exits 1', () => {
  assert.equal(verdict([], []).state, 'clean');
  assert.equal(verdict([], [{ kind: 'root' }]).state, 'unknown');
  assert.equal(verdict([{ file: 'x' }], []).state, 'drifted');
  assert.match(verdict([], [{ kind: 'root' }]).line, /unknown, not clean/);
  assert.doesNotMatch(verdict([], [{ kind: 'root' }]).line, /^Every declared surface/);
  // The alarm vocabulary is for drift. An absent clone is a fact about the machine,
  // not something wrong with the work, and every other honest-absence line this
  // program prints stays out of ALARM_RE for the same reason.
  assert.ok(!ALARM_RE.test(verdict([], [{ kind: 'root' }]).line));
});

test('every surface this repo generates actually parses', async () => {
  // Twice tonight a comment written INSIDE a CSS template literal used backticks to
  // quote a CSS property, ended the literal mid-file, and produced a syntax error. The
  // first was caught by loading the module by hand; the second reached a pushed commit
  // and only surfaced because an unrelated test spawns the dashboard as a child process
  // and reported "server exited 1".
  //
  // Importing every generator is the cheap, direct check that nothing here is broken in
  // a way no test happens to spawn.
  const r = census();
  const generators = r.surfaces
    .filter((s) => s.file.startsWith('obot.agent/') && s.file.endsWith('.mjs'))
    .map((s) => resolve(workspaceRoot(), s.file));
  assert.ok(generators.length, 'the census found no generators in this repo, which means it is not looking');
  for (const file of generators) {
    await assert.doesNotReject(() => import(pathToFileURL(file).href), `${path.relative(REPO, file)} does not parse`);
  }
});
