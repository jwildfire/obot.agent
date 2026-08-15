// A config item as an installation qualification.
//
// @jwildfire, 2026-08-15: "the config items are pretty useless. They need to
// actually tell me what i need to do in exact detail. they need to be an
// installation qualification."
//
// That is his term and it is precise. An IQ is a protocol, not a note: the exact
// action, the result expected of it, a check that proves it, and a recorded
// pass/fail. So an entry on the config list carries five fields —
//
//   Do        the exact command, or the exact click-path when there is no command
//   Expect    what he should see when it worked
//   Verify    a command that proves it, and what its output should say
//   Unblocks  what it buys, in his terms
//   Source    where the item came from
//
// — and two optional ones: `Blocks` (filed work stuck behind it, which is the only
// way an item earns the critical tag — see rank.mjs) and `Why` (the mechanism,
// last and optional, because an item that opens with the mechanism is written
// agent-to-agent and he triages by skimming).
//
// The contract that makes the check meaningful: **a verify command must exit 0
// exactly when the item is done.** `grep -c`, `test -f` and a `gh api` read all do
// this naturally. Pass/fail is the exit code; the `→` half is what he reads.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { opsDir, ensureStore, SENTINEL } from './store.mjs';

// The field names, in the order they render. `Fix` is the pre-2026-08-16 name for
// `Do` and is still read, so an entry written before this pass renders rather
// than disappearing — but `iqComplete` still reports it as incomplete, which is
// the point: the old shape was missing the half that mattered.
const FIELDS = ['do', 'expect', 'verify', 'unblocks', 'source', 'blocks', 'why'];
const ALIAS = { fix: 'do' };
const FIELD_RE = new RegExp(`^\\s*(${[...FIELDS, ...Object.keys(ALIAS)].join('|')})\\s*:\\s*(.*)$`, 'i');

/** Required before an entry counts as an installation qualification. */
export const REQUIRED = ['do', 'expect', 'verify'];

/**
 * The commands the dashboard will run for him, unattended, on a click.
 *
 * Read-only by construction, and deliberately short. A verify command comes out
 * of a file agents write, and a click-to-run button on agent-written content is
 * the wrong primitive to give a wide allowlist. Anything outside this list is not
 * refused as an item — it renders as copy-and-run with a manual pass/fail, which
 * is exactly right for the web-UI-only and device-side steps that cannot be
 * scripted at all.
 */
export const AUTO_VERIFY_HEADS = ['grep', 'rg', 'test', 'ls', 'stat', 'wc', 'jq', 'cat', 'file', 'gh', 'git'];

// Subcommands that read. `gh api` is here because most of the list's proofs are
// GitHub reads; the method guard below is what keeps it a read.
const READ_SUB = {
  gh: ['api', 'issue', 'pr', 'repo', 'release', 'auth'],
  git: ['status', 'log', 'show', 'diff', 'ls-files', 'rev-parse', 'config', 'branch', 'remote'],
};
// A write dressed as a read: `gh api -X DELETE`, `gh issue close`, `git config --global x y`.
const WRITE_FLAG = /(^|\s)(-X|--method)(\s|=)\s*(?!GET\b)/i;
const WRITE_SUB = /\b(create|close|delete|edit|merge|comment|ready|reopen|transfer|upload)\b/i;
// Shell that turns one command into several, or into a file write.
const SHELL_META = /[;&|><`$]|\(\)|\$\(/;

const line = (s) => String(s ?? '').trim();

/**
 * Parse one entry off the config list into its IQ.
 *
 * The entry is markdown a human also reads, so the parser is forgiving about
 * everything except the field names: a value runs until the next `Field:` line,
 * and a more-indented line inside a value is kept verbatim as **code** — that is
 * the thing he pastes, and reflowing it into prose would break it.
 */
export function parseIQ(entry = '') {
  const lines = String(entry).replace(/\r/g, '').split('\n');
  const head = lines[0] ?? '';
  // The headline runs from the bullet to the first field label, because a bold
  // run in a hand-wrapped entry crosses lines — reading only the first line
  // truncates the title mid-sentence.
  let headEnd = lines.findIndex((l, i) => i > 0 && FIELD_RE.test(l));
  if (headEnd === -1) headEnd = lines.length;
  const headBlock = lines.slice(0, headEnd).join(' ');
  const iq = {
    id: head.match(/^-\s+\[.\]\s*(c\d{4})\b/i)?.[1]?.toLowerCase() ?? null,
    title: (headBlock.match(/\*\*([\s\S]+?)\*\*/)?.[1]
      ?? headBlock.replace(/^-\s+\[.\]\s*/, '').split(/\s+—\s+/).slice(1).join(' — '))
      .replace(/[*`]/g, '').replace(/\s+/g, ' ').trim(),
    filed: head.match(/filed\s+(\d{4}-\d{2}-\d{2})/)?.[1] ?? null,
    verified: head.match(/verified\s+(\d{4}-\d{2}-\d{2})/)?.[1] ?? null,
    done: /^-\s+\[[xX]\]/.test(head),
    body: lines.slice(1).join('\n'),
  };
  for (const f of FIELDS) iq[f] = null;

  let field = null;
  for (const raw of lines.slice(1)) {
    const m = FIELD_RE.exec(raw);
    if (m) {
      const name = ALIAS[m[1].toLowerCase()] ?? m[1].toLowerCase();
      field = iq[name] ?? (iq[name] = { text: '', code: [] });
      if (line(m[2])) field.text = line(m[2]);
      continue;
    }
    if (!field || !raw.trim()) continue;
    // Four or more spaces is a code line: the literal thing to paste, kept
    // verbatim rather than reflowed into the prose.
    if (/^\s{4,}\S/.test(raw)) field.code.push(raw.trimEnd());
    else field.text = field.text ? `${field.text} ${line(raw)}` : line(raw);
  }

  // Dedent each field's code by its own shallowest line, so the entry's own
  // indentation in the markdown never reaches the clipboard.
  for (const f of FIELDS) {
    const code = iq[f]?.code;
    if (!code?.length) continue;
    const pad = Math.min(...code.map((c) => c.match(/^ */)[0].length));
    iq[f].code = code.map((c) => c.slice(pad));
  }

  if (iq.verify) Object.assign(iq.verify, splitVerify(iq.verify.text));
  iq.blocks = parseBlocks(iq.blocks);
  return iq;
}

/**
 * `Verify: <command> → <what its output should say>`, or `Verify: manual — …`.
 *
 * The arrow is the seam between the thing a machine runs and the thing he reads.
 */
export function splitVerify(text = '') {
  const t = line(text);
  if (/^manual\b/i.test(t)) return { manual: true, command: null, expect: t.replace(/^manual\s*[—:-]?\s*/i, '') };
  const [cmd, ...rest] = t.split('→');
  return { manual: false, command: line(cmd).replace(/^`|`$/g, '') || null, expect: line(rest.join('→')) };
}

/**
 * `Blocks: owner/repo#12 (verified open 2026-08-16), #34`
 *
 * A reference only counts once something resolved it — see `blocker-log`, which
 * asks GitHub at capture time and writes the `(verified open …)` stamp only when
 * the answer comes back open. Without that stamp the reference is a claim, and a
 * claim earns nothing (rank.mjs).
 */
export function parseBlocks(field) {
  if (!field) return [];
  const out = [];
  for (const m of String(field.text).matchAll(/([A-Za-z0-9._/-]*#\d+)\s*(\(([^)]*)\))?/g)) {
    const note = m[3] ?? '';
    out.push({
      ref: m[1],
      verified: /verified\s+open/i.test(note),
      state: /verified\s+(\w+)/i.exec(note)?.[1]?.toLowerCase() ?? null,
      note: note || null,
    });
  }
  return out;
}

/** Whether an entry is an installation qualification, and what it is missing. */
export function iqComplete(iq) {
  const missing = REQUIRED.filter((f) => !iq?.[f] || (!iq[f].text && !iq[f].code?.length));
  return { ok: missing.length === 0, missing };
}

/**
 * Can the dashboard run this proof for him, or does he run it himself?
 *
 * Fail-closed: anything not positively recognised as a single read-only command
 * degrades to copy-and-run. The `why` is shown on the button so a "run it
 * yourself" never looks like a broken feature.
 */
export function verifyPlan(iq) {
  const cmd = iq?.verify?.command;
  if (iq?.verify?.manual || !cmd) return { auto: false, why: 'manual check — nothing to run' };
  if (SHELL_META.test(cmd)) return { auto: false, why: 'shell redirection or chaining — run it yourself' };
  const argv = tokenize(cmd);
  if (!argv.length) return { auto: false, why: 'not a command' };
  const [head, ...rest] = argv;
  const bin = head.split('/').pop();
  if (!AUTO_VERIFY_HEADS.includes(bin)) return { auto: false, why: `${bin} is not on the read-only allowlist — run it yourself` };
  if (WRITE_FLAG.test(cmd)) return { auto: false, why: 'names a write method — run it yourself' };
  const subs = READ_SUB[bin];
  if (subs) {
    const sub = rest.find((a) => !a.startsWith('-'));
    if (!sub || !subs.includes(sub)) return { auto: false, why: `${bin} ${sub ?? ''} is not a read — run it yourself` };
    if (rest.slice(rest.indexOf(sub) + 1).some((a) => !a.startsWith('-') && WRITE_SUB.test(a))) {
      return { auto: false, why: `${bin} ${sub} names a write — run it yourself` };
    }
  }
  return { auto: true, argv, why: null };
}

/** Split a command into argv, honouring quotes. No shell is ever involved. */
export function tokenize(cmd) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (let m; (m = re.exec(cmd));) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/**
 * Judge one proof's output against what the entry said it should say.
 *
 * The exit code carries the verdict by default - that is the contract every
 * verify command is written to (`grep -c`, `test -f`, a `gh api` read). Two
 * phrasings tighten it, because "exit 0" is not always the whole question:
 *
 *   `-> prints 2`        the output is exactly `2`, whatever the exit code
 *   `-> not u/3680095`   exit 0 and the output does not contain that
 *
 * `prints` deliberately **outranks the exit code**: the entry has stated exactly
 * what done looks like, and several perfectly good proofs answer correctly while
 * exiting non-zero — `grep -c x file` prints `0` and exits 1 when the answer is
 * "none, which is what we wanted". Trusting the exit code there would call a
 * correct answer a failure. (Found the hard way: `grep -L` reports differently
 * under `execFile` than in a shell, so no verify command should lean on an exit
 * code that subtle.)
 *
 * Deliberately two rules and not a language: an expectation he cannot read at a
 * glance is not an expectation.
 */
export function judge(exitCode, stdout, expect) {
  const e = String(expect ?? '').trim();
  const out = String(stdout ?? '').trim();
  const eq = /^prints\s+(\S+)$/i.exec(e);
  if (eq) return out === eq[1] ? 'pass' : 'fail';
  if (exitCode !== 0) return 'fail';
  const not = /^not\s+(\S+)/i.exec(e);
  if (not) return out.includes(not[1]) ? 'fail' : 'pass';
  return 'pass';
}

/**
 * Run a proof and record the result — the pass/fail an IQ is supposed to leave
 * behind, and the reason checking a box was never enough.
 *
 * Appended to `.claude/ops/checks.jsonl`, never overwritten: "it passed on the
 * 16th and fails now" is exactly the history worth keeping, and the store is
 * local-only and sentinel-stamped like everything else in that folder.
 */
export function runVerify(workspace, { id, command, expect = null, by = 'jwildfire' }) {
  const plan = verifyPlan({ verify: { command, manual: false } });
  if (!plan.auto) return Promise.resolve({ id, result: 'refused', why: plan.why, command });

  return new Promise((resolve) => {
    const [bin, ...argv] = plan.argv;
    execFile(bin, argv, { timeout: 15000, maxBuffer: 1 << 20, cwd: workspace }, (err, stdout, stderr) => {
      const exitCode = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      const rec = {
        _note: SENTINEL,
        at: new Date().toISOString(),
        id, by, command, expect,
        exitCode,
        result: judge(exitCode, stdout, expect),
        stdout: String(stdout ?? '').slice(0, 2000).trim(),
        stderr: String(stderr ?? '').slice(0, 500).trim(),
      };
      ensureStore(workspace);
      fs.appendFileSync(path.join(opsDir(workspace), 'checks.jsonl'), `${JSON.stringify(rec)}\n`);
      resolve(rec);
    });
  });
}

/** The most recent check per item, for the row and the panel. */
export function readChecks(workspace) {
  let raw = '';
  try { raw = fs.readFileSync(path.join(opsDir(workspace), 'checks.jsonl'), 'utf8'); } catch { return {}; }
  const byId = {};
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue;
    try { const r = JSON.parse(l); if (r.id) byId[r.id] = r; } catch { /* a truncated write; skip */ }
  }
  return byId;
}
