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
//   Why it matters  what problem it fixes, what stays broken if he never does it
//   Do              the exact command, or the exact click-path when there is no command
//   Expect          what he should see when it worked
//   Verify          a command that proves it, and what its output should say
//   Source          where the item came from
//
// — and two optional ones: `Blocks` (filed work stuck behind it, which is the only
// way an item earns the critical tag — see rank.mjs) and `Why` (the mechanism,
// last and optional, because an item that opens with the mechanism is written
// agent-to-agent and he triages by skimming).
//
// `Why it matters` leads (@jwildfire, 2026-08-20: "I need the config summarys to
// start with the 'why'. Why is this important? What problem does it fix?"). Note
// what it is NOT: it is not `Why`, and moving the mechanism to the top would satisfy
// the letter of that sentence while producing exactly the agent-to-agent opening the
// field order exists to prevent. It is the STAKES — which is what `Unblocks` already
// held ("what it buys, in his terms"), so this is that field renamed and promoted
// rather than a second one beside it. Two fields both meaning "why" drift apart;
// `Unblocks:` is still read as an alias so no existing entry stops parsing.
//
// The contract that makes the check meaningful: **a verify command must exit 0
// exactly when the item is done.** `grep -c`, `test -f` and a `gh api` read all do
// this naturally. Pass/fail is the exit code; the `→` half is what he reads.
// The mechanics — the read-only allowlist, the runner, the judge and the ledger — are
// not here any more. They are shared with decision-artifact premises in
// `tools/lib/claims.mjs`, because a config item's claim and a decision's premise are
// the same problem one artifact class apart (jwildfire/obot.roadmap#264 and #266, and
// #266 asks for one mechanism by name). What stays here is the config list's own
// grammar: how an entry is parsed into its five fields.
//
// Re-exported rather than moved out of reach, so every existing importer of this
// module keeps working and there is still exactly one implementation.
import {
  AUTO_VERIFY_HEADS, judge, readChecks, runClaim, splitVerify, tokenize, verifyPlan,
} from '../../lib/claims.mjs';

export { AUTO_VERIFY_HEADS, judge, readChecks, splitVerify, tokenize, verifyPlan };

// The field names, in the order they render. `Fix` is the pre-2026-08-16 name for
// `Do` and is still read, so an entry written before this pass renders rather
// than disappearing — but `iqComplete` still reports it as incomplete, which is
// the point: the old shape was missing the half that mattered.
const FIELDS = ['matters', 'do', 'expect', 'verify', 'source', 'blocks', 'why'];

/** What each field is called on disk and on the page. */
export const LABEL = {
  matters: 'Why it matters', do: 'Do', expect: 'Expect', verify: 'Verify',
  source: 'Source', blocks: 'Blocks', why: 'Why',
};

// Older spellings, still read so an entry written before a rename keeps parsing.
// `fix` is the pre-2026-08-16 name for `do`; `unblocks` is the pre-2026-08-20 name
// for `matters`, and promoting it in place is what makes the backfill mostly free —
// an entry whose `Unblocks:` already said what it buys is already a why.
const ALIAS = { fix: 'do', unblocks: 'matters' };

// Longest label first. `Why it matters` and `Why` are different fields and the
// shorter name is a prefix of the longer one, so an unordered alternation would let
// `Why` shadow it — silently filing the stakes as the mechanism, which is the exact
// confusion this rename exists to end.
const RECOGNISED = [...FIELDS.map((f) => LABEL[f]), ...Object.keys(ALIAS)]
  .sort((a, b) => b.length - a.length);
const KEY = new Map([
  ...FIELDS.map((f) => [LABEL[f].toLowerCase(), f]),
  ...Object.entries(ALIAS),
]);
const escapeLabel = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FIELD_RE = new RegExp(`^\\s*(${RECOGNISED.map(escapeLabel).join('|')})\\s*:\\s*(.*)$`, 'i');

/**
 * Required before an entry counts as an installation qualification.
 *
 * `matters` joined this list on 2026-08-20. An item that cannot say why it matters is
 * a strong candidate for not being needed at all, so the requirement is doing audit
 * work as well as editorial work.
 */
export const REQUIRED = ['matters', 'do', 'expect', 'verify'];

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
      const name = KEY.get(m[1].toLowerCase()) ?? m[1].toLowerCase();
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
  // The refs go alongside the field, never over it: `blocks` stays a field like
  // every other one so it still renders as text he can read, and `blockRefs` is
  // the machine-readable half the critical tag is derived from.
  iq.blockRefs = parseBlocks(iq.blocks);
  return iq;
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
 * Run a proof and record the result — the pass/fail an installation qualification is
 * supposed to leave behind, and the reason checking a box was never enough.
 *
 * A thin call into the shared runner, kept at this name because the dashboard's
 * click-to-check endpoint and its tests are written against it.
 */
export function runVerify(workspace, { id, command, expect = null, by = 'jwildfire' }) {
  return runClaim(workspace, { id, command, expect, by });
}
