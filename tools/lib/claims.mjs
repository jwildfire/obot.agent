// The currency of a claim — one mechanism, two artifact classes.
//
// jwildfire/obot.roadmap#264 and #266 are the same defect one artifact class apart:
// something states a claim on the day it is written and nothing ever checks it again.
//
//   #264  three of the last six config items left the list for being stale or
//         mis-specified rather than for being done. Every one of them carried a
//         verify command the whole time; nothing ran them.
//   #266  a decision artifact said a release was held pending the decision. The
//         release had published sixteen minutes before the page was written. Not
//         the artifact, not the discussion, not the config list and not the delivery
//         record noticed.
//
// #266 asks for them to be solved as one problem "or they will be solved twice and
// differently". This is the one problem.
//
// ## What a claim is
//
// A sentence and a proof:
//
//     <what is claimed> | <read-only command> → <what its output should say>
//
// The right-hand half is not new — it is the config list's `Verify:` grammar, which
// the installation-qualification pass already established and which every open item
// already carries. A decision premise reuses it verbatim, so there is one parser, one
// allowlist, one runner, one judge and one ledger rather than two of each.
//
// ## Three states, and why the third is the whole point
//
//   holds     it was measured, and the claim is true
//   fails     it was measured, and the claim is not true
//   unknown   nothing was measured
//
// The classes read those words differently — a config item that `holds` is done and a
// premise that `holds` still frames its question correctly — but the measurement is
// the same measurement, and `unknown` means the same thing in both: nobody knows.
//
// Collapsing `unknown` into `fails` is the defect this program has fixed in six
// separate files this week, and it was live in this exact code path until now:
// `runVerify` turned a command that never started — a missing binary, a timeout —
// into `exitCode: 1` and recorded `fail`. A config item nothing could check therefore
// read as an item still waiting on him, and a premise nothing could check would have
// read as a premise that still holds. Both are a made-up measurement.
//
// ## Read-only by construction
//
// A verify command comes out of a file agents write, and this runs it unattended on a
// cadence rather than on his click. So the allowlist is the same fail-closed one the
// click-to-run button already used, and anything it does not positively recognise is
// `unknown` with a reason — never a fail, and never run anyway.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { opsDir, ensureStore, SENTINEL } from '../ops-dashboard/lib/store.mjs';

/**
 * The commands this will run unattended.
 *
 * Deliberately short and read-only. Anything outside it is not refused as a claim —
 * it becomes an unknown that says why, which is exactly right for the web-UI-only and
 * device-side steps that cannot be scripted at all.
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
//
// The reason this matters is not injection — nothing here ever reaches a shell, since
// `execFile` takes argv — it is silent wrongness. `grep -q x file > /dev/null` run
// without a shell passes `>` and `/dev/null` to grep as arguments and answers a
// different question, quietly. A metacharacter means the author was writing for a
// shell, and this refuses rather than reinterpreting.
//
// OUTSIDE QUOTES ONLY. A pipe inside a quoted argument is not shell syntax, it is a
// character in a string, and `execFile` reproduces it exactly — which is what lets a
// proof do its own work internally: `gh api … --jq '.content | @base64d | test("x")'`
// is one command with three jq pipes and no shell at all. Testing the raw string
// refused it (👯🤖 W0071, 2026-08-18), and refusing a correct read-only proof pushes
// its author back to a form this cannot run.
const SHELL_META_CHARS = new Set([';', '&', '|', '>', '<', '`', '$']);

/** The first shell metacharacter outside quotes, or null. */
export function shellMeta(cmd = '') {
  let quote = null;
  const s = String(cmd);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      // Backslash escapes only inside double quotes, as a shell would read it.
      if (quote === '"' && c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (SHELL_META_CHARS.has(c)) return c;
  }
  return null;
}

const line = (s) => String(s ?? '').trim();

/** The three states, and the only place their spellings live. */
export const HOLDS = 'holds';
export const FAILS = 'fails';
export const UNKNOWN = 'unknown';

/**
 * The state a recorded result carries.
 *
 * `refused` (not auto-runnable) and `unknown` (auto-runnable and did not run) are two
 * reasons for the same state and are kept apart in the record, because "he has to run
 * this himself" and "this should have run and did not" are different work. Neither is
 * ever a fail.
 */
export function claimState(result) {
  if (result === 'pass') return HOLDS;
  if (result === 'fail') return FAILS;
  return UNKNOWN;
}

/**
 * `<claimed sentence> | <command> → <what its output should say>`
 *
 * The sentence is optional: a config item's `Verify:` line has never carried one,
 * because the item's headline already says what is claimed. A premise carries one,
 * because the page's prose is where the claim actually lives and the check has to be
 * able to quote it.
 */
export function parseClaim(text = '') {
  const raw = line(text);
  const bar = raw.indexOf('|');
  const sentence = bar === -1 ? null : line(raw.slice(0, bar)) || null;
  return { sentence, ...splitVerify(bar === -1 ? raw : raw.slice(bar + 1)) };
}

/**
 * `<command> → <what its output should say>`, or `manual — …`.
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
 * Can this be run unattended, or is it his to run?
 *
 * Fail-closed: anything not positively recognised as a single read-only command
 * degrades to copy-and-run. The `why` is carried through to every surface so a "run it
 * yourself" never looks like a broken feature.
 */
export function verifyPlan(iq) {
  const cmd = iq?.verify?.command;
  if (iq?.verify?.manual || !cmd) return { auto: false, why: 'manual check — nothing to run' };
  if (shellMeta(cmd)) return { auto: false, why: 'shell redirection or chaining — run it yourself' };
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
 * Judge one proof's output against what the claim said it should say.
 *
 * The exit code carries the verdict by default — that is the contract every verify
 * command is written to (`grep -c`, `test -f`, a `gh api` read). Two phrasings tighten
 * it, because "exit 0" is not always the whole question:
 *
 *   `-> prints 2`        the output is exactly `2`, whatever the exit code
 *   `-> not u/3680095`   exit 0 and the output does not contain that
 *
 * `prints` deliberately outranks the exit code: the claim has stated exactly what true
 * looks like, and several perfectly good proofs answer correctly while exiting
 * non-zero — `grep -c x file` prints `0` and exits 1 when the answer is "none, which is
 * what we wanted". Trusting the exit code there would call a correct answer a failure.
 *
 * Deliberately two rules and not a language: an expectation he cannot read at a glance
 * is not an expectation.
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
 * Was the question answered, even though the command ran?
 *
 * `prints X` is an assertion ABOUT OUTPUT. Two ways a command can exit non-zero
 * without having answered such a question:
 *
 *   it printed nothing        there is no output to compare, so "it did not print X"
 *                             is a statement nobody measured
 *   it reported an error      whatever reached stdout is the failure, not the answer
 *
 * 👯🤖 W0071 found this with a control the design deserved and did not have: point a
 * proof at a file that does not exist. Their reading was that such a run prints nothing
 * to stdout; measured here with `--jq` attached it prints the API's own error object
 * to stdout and exits 1, so an emptiness test alone would have missed exactly the case
 * the control was built to catch. Both halves are needed, and the second is the one
 * that matters.
 *
 * Deliberately narrow, and it is worth saying what it must NOT catch. `grep -c x file`
 * exits 1 and prints `0` when the answer is "none, which is what we wanted", writing
 * nothing to stderr — two live config items depend on that reading as a pass, and it
 * still does. A prose expectation (`→ the file exists`) is judged on the exit code
 * alone and is untouched by any of this.
 */
export function noAnswer(exitCode, stdout, expect, stderr = '') {
  if (exitCode === 0) return null;
  if (!/^prints\s+\S+$/i.test(String(expect ?? '').trim())) return null;
  if (!String(stdout ?? '').trim()) return 'exited non-zero and printed nothing, so there was no output to compare with what the claim expects';
  if (String(stderr ?? '').trim()) return 'exited non-zero and reported an error, so what it printed is the failure rather than the answer';
  return null;
}

/**
 * Did this command produce an exit status at all?
 *
 * `execFile` reports two completely different things through one `err`. A process that
 * ran and exited non-zero carries a numeric `code`. A process that never started
 * (`ENOENT`, `EACCES`), was killed by the timeout, or overran `maxBuffer` carries a
 * string code or none at all — and there is no exit status to judge. The old reader
 * coerced the second case to `1` and judged it, which manufactured a measurement
 * nobody took.
 */
export function runFailure(err) {
  if (!err) return null;
  if (typeof err.code === 'number') return null;
  if (err.killed || err.signal) return `did not finish — killed after the timeout (${err.signal || 'timeout'})`;
  if (err.code === 'ENOENT') return 'did not run — the command is not installed on this machine';
  if (err.code) return `did not run — ${err.code}`;
  return `did not run — ${String(err.message ?? 'no exit status').slice(0, 120)}`;
}

/**
 * Run one claim's proof and record the result.
 *
 * Appended to `.claude/ops/checks.jsonl`, never overwritten: "it held on the 16th and
 * does not now" is exactly the history worth keeping, and the store is local-only and
 * sentinel-stamped like everything else in that folder.
 *
 * `record: false` runs without writing, which is what a rehearsal wants.
 */
export function runClaim(workspace, { id, command, expect = null, by = 'jwildfire', sentence = null, cwd = null, timeoutMs = 15000, record = true, manual = false }) {
  const plan = verifyPlan({ verify: { command, manual } });
  // A refusal is never written to the ledger. It is a property of the command, which
  // `verifyPlan` re-derives for free at any moment, so a record of it carries nothing a
  // reader could not compute — and on a five-minute cadence it would append the same
  // line 288 times a day per manual item and bury the readings that are measurements.
  // An `unknown` from a command that tried and failed IS written, because "it stopped
  // being runnable at 03:00" is a fact about the world and nothing else records it.
  if (!plan.auto) {
    return Promise.resolve(stamp({ id, by, command, expect, sentence, exitCode: null, result: 'refused', why: plan.why, stdout: '', stderr: '' }));
  }

  return new Promise((resolve) => {
    const [bin, ...argv] = plan.argv;
    execFile(bin, argv, { timeout: timeoutMs, maxBuffer: 1 << 20, cwd: cwd ?? workspace }, (err, stdout, stderr) => {
      const failure = runFailure(err);
      const exitCode = failure ? null : (err ? err.code : 0);
      const err2 = String(stderr ?? '').trim().split('\n')[0].slice(0, 160);
      const unanswered = failure ? null : noAnswer(exitCode, stdout, expect, stderr);
      const rec = stamp({
        id, by, command, expect, sentence, exitCode,
        result: failure || unanswered ? 'unknown' : judge(exitCode, stdout, expect),
        why: failure ?? (unanswered ? `${unanswered}${err2 ? ` (${err2})` : ''}` : null),
        stdout: String(stdout ?? '').slice(0, 2000).trim(),
        stderr: String(stderr ?? '').slice(0, 500).trim(),
      });
      if (record) append(workspace, rec);
      resolve(rec);
    });
  });
}

const stamp = (o) => ({ _note: SENTINEL, at: new Date().toISOString(), why: null, ...o, state: claimState(o.result) });

function append(workspace, rec) {
  ensureStore(workspace);
  fs.appendFileSync(path.join(opsDir(workspace), 'checks.jsonl'), `${JSON.stringify(rec)}\n`);
}

/** The most recent check per id, for a row, a card and the sweep. */
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

/** How long ago, in prose. A card is read on a phone; `4m ago` is a dashboard voice. */
export function agoPhrase(min) {
  if (min === null || min === undefined || !Number.isFinite(min)) return null;
  if (min < 1) return 'just now';
  const r = Math.round(min);
  if (r < 60) return `${r} minute${r === 1 ? '' : 's'} ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/**
 * What one recorded check means for one claim, right now.
 *
 * `stale` is the reading not applying to the claim in front of us: either nothing has
 * ever been recorded, or what was recorded proved a different command. A reworded
 * verify is a different proof, and carrying its predecessor's verdict forward would be
 * the same manufactured measurement in a slower form.
 */
export function currency(rec, { command = null, now = new Date() } = {}) {
  if (!rec) return { state: UNKNOWN, ageMin: null, ago: null, at: null, why: 'never checked', stale: true };
  if (command && rec.command && rec.command !== command) {
    return { state: UNKNOWN, ageMin: null, ago: null, at: rec.at ?? null, why: 'the check has been rewritten since it was last run', stale: true };
  }
  const t = Date.parse(rec.at ?? '');
  const ageMin = Number.isNaN(t) ? null : Math.max(0, (now.getTime() - t) / 60000);
  return {
    state: claimState(rec.result),
    ageMin, ago: agoPhrase(ageMin), at: rec.at ?? null,
    why: rec.why ?? null,
    stale: false,
  };
}

/** The config list's words for the three states. A config claim is "this is done". */
export const CONFIG_WORDS = { [HOLDS]: 'done', [FAILS]: 'still outstanding', [UNKNOWN]: 'could not be checked' };

/** A decision artifact's words. A premise claim is "the page still frames this right". */
export const PREMISE_WORDS = { [HOLDS]: 'still holds', [FAILS]: 'no longer holds', [UNKNOWN]: 'could not be checked' };

/**
 * The sentence a card, a row or a section prints about its own currency.
 *
 * One function so the three surfaces cannot describe the same reading differently, and
 * so "never checked" can never be phrased as a verdict.
 */
export function currencyPhrase(cur, words = CONFIG_WORDS) {
  if (!cur || cur.stale) return `Not checked yet${cur?.why ? ` — ${cur.why}` : ''}.`;
  const when = cur.ago ? `Checked ${cur.ago}` : 'Checked';
  return `${when}: ${words[cur.state]}${cur.state === UNKNOWN && cur.why ? ` — ${cur.why}` : ''}.`;
}
