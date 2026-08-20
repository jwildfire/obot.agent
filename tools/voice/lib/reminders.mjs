// The car door — the Apple Reminders list Siri writes to, and the receipt he gets back.
//
// jwildfire/obot.roadmap#265 picked this channel and it is already half-built:
// `scripts/reminders-to-ideas` has read the list named `obot` since July, honours a
// `private:` prefix, and marks an item complete only after it has been handled. What
// did not exist is a branch for an ANSWER, and that gap is not neutral — without it,
// a sentence in which he decides something is posted to a PUBLIC discussion board.
//
// ## The receipt is the item, not a new one
//
// He asked for a way to answer without a screen; a confirmation he has to open
// something to read is not one. So the reminder he dictated becomes its own receipt:
//
//   routed    stamped with the decision it reached, then completed — the list empties,
//             and "what's on my obot list" answering nothing IS the confirmation.
//   UNROUTED  stamped with what went wrong and LEFT on the list. Completing it would
//             remove the only evidence he has that it failed, and he cannot be asked
//             to repeat a sentence he does not know went missing.
//   idea      untouched, for the lane that has always handled it.
//   private   untouched, same reason.
//
// Nothing new is ever added to his list here. That list is his voice-note inbox and
// he has a standing rule against agents putting things in it; stamping an item he
// created is a mark on his own note, which is a different thing from filing into his
// inbox. The one place a new item WOULD be justified — telling him a car answer has
// been applied — is `applied-receipts` in the CLI and is off unless asked for.
//
// ## Everything shells osascript, and it is bounded
//
// The idea fold deliberately never runs this ingest because "it can stall on a
// permission prompt". That objection is answered here rather than argued with: every
// call goes through one runner with a hard timeout, a failure is reported as a failed
// read, and a failed read is never rendered as an empty inbox.
import { spawnSync } from 'node:child_process';

import { buildQueue } from './handles.mjs';
import { routeSpoken } from './route.mjs';

export const LIST = 'obot';
/** Stamped onto a reminder that reached a decision. Also what stops it being re-read. */
export const RECEIPT_DONE = '✅';
/** Stamped onto one that did not, and left on the list wearing it. */
export const RECEIPT_HELD = '⚠️';
const MARKERS = [RECEIPT_DONE, RECEIPT_HELD];
export const TIMEOUT_MS = 15000;

const FS = String.fromCharCode(31);
const RS = String.fromCharCode(30);

/** Escape for the inside of an AppleScript string literal. Backslash first, always. */
export const asQuote = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/**
 * The one place this program shells osascript.
 *
 * Bounded by `TIMEOUT_MS`, and every failure — missing binary, denied automation,
 * timeout — comes back as `{ok: false, why}` rather than as an exception or an empty
 * string, because an empty string is indistinguishable from an empty list.
 */
export function osascriptRunner(script, { timeoutMs = TIMEOUT_MS } = {}) {
  const r = spawnSync('osascript', ['-'], { input: script, encoding: 'utf8', timeout: timeoutMs });
  if (r.error) {
    const why = r.error.code === 'ETIMEDOUT'
      ? `osascript did not answer within ${timeoutMs}ms — Reminders may be waiting on a permission prompt`
      : `osascript could not be run (${r.error.code ?? r.error.message})`;
    return { ok: false, why, out: '' };
  }
  if (r.status !== 0) return { ok: false, why: `osascript failed: ${(r.stderr || '').trim().slice(0, 200)}`, out: '' };
  return { ok: true, why: '', out: (r.stdout ?? '').replace(/\n$/, '') };
}

const READ_SCRIPT = (list) => `set fieldSep to (ASCII character 31)
set recSep to (ASCII character 30)
tell application "Reminders"
  if not (exists list "${asQuote(list)}") then return "__ERROR_NO_LIST__"
  set out to ""
  repeat with r in (reminders in list "${asQuote(list)}" whose completed is false)
    set rBody to ""
    try
      if body of r is not missing value then set rBody to body of r
    end try
    set rMade to ""
    try
      if creation date of r is not missing value then set rMade to (creation date of r) as string
    end try
    set out to out & (id of r) & fieldSep & (name of r) & fieldSep & rBody & fieldSep & rMade & recSep
  end repeat
  return out
end tell`;

/** The wire format `reminders-to-ideas` has always used, parsed once, here. */
export function parseRecords(raw) {
  return String(raw ?? '').split(RS)
    .map((rec) => rec.split(FS))
    .filter((f) => f[0] && f[0].trim())
    .map(([id, name = '', body = '', made = '']) => ({
      id,
      name,
      body,
      text: body ? `${name}\n\n${body}` : name,
      // AppleScript hands back a locale string ("Thursday, August 20, 2026 at 2:30:00 PM").
      // An unparseable or absent one is left null and read as "unknown", which the poll
      // treats as stale rather than guessing.
      created: made && Number.isFinite(Date.parse(made)) ? new Date(made).toISOString() : (made || null),
    }));
}

/** Anything this lane wrote. Reading one back in would double-handle it forever. */
export const isReceipt = (name) => MARKERS.some((m) => String(name ?? '').trimStart().startsWith(m));

/**
 * What is pending on the list. `{items, read, why}`.
 *
 * A list that does not exist and a list that could not be read are both `read: false`
 * with a reason, and neither is an empty inbox — the failure mode this whole program
 * is named after is an operation reporting success while doing nothing.
 */
export function listPending({ list = LIST, run = osascriptRunner, timeoutMs = TIMEOUT_MS } = {}) {
  const r = run(READ_SCRIPT(list), { timeoutMs });
  if (!r.ok) return { items: [], read: false, why: r.why || 'the Reminders list could not be read' };
  if (r.out.trim() === '__ERROR_NO_LIST__') {
    return { items: [], read: false, why: `no Reminders list named "${list}" — create it once and Siri can target it` };
  }
  return { items: parseRecords(r.out).filter((i) => !isReceipt(i.name)), read: true, why: '' };
}

const setName = (id, name) => `tell application "Reminders" to set name of (first reminder whose id is "${asQuote(id)}") to "${asQuote(name)}"`;
const setDone = (id) => `tell application "Reminders" to set completed of (first reminder whose id is "${asQuote(id)}") to true`;

const oneLine = (s, n = 140) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * Read the list, route every sentence on it, and stamp what this lane owns.
 *
 * Returns `{routed, unrouted, ideas, privates, read, why}`. Ideas and private items
 * come back named but untouched: `reminders-to-ideas` files those, and it consults
 * this router first so that an answer of his can never be posted publicly.
 */
export function pollReminders({
  workspace, hub, queue, list = LIST, run = osascriptRunner, now = new Date(), stamp = true,
} = {}) {
  const empty = { routed: [], unrouted: [], ideas: [], privates: [], stale: [], unstamped: [], blocked: [] };
  const pending = listPending({ list, run });
  if (!pending.read) return { ...empty, read: false, why: pending.why };

  // AN ANSWER HAS TO POST-DATE THE LIST IT ANSWERS. This poll re-reads every
  // uncompleted item every five minutes and deliberately leaves ideas alone, and
  // nothing on this machine drains them — so an idea sits there indefinitely while the
  // open decisions change underneath it. Reproduced: an idea about the car-voice lane
  // sat for two days, a decision named "car voice" was then published, and the next
  // sweep recorded his QUESTION as his ANSWER to it, stamped it and completed it. Every
  // other guard in the matcher reasons about one sentence against one queue at one
  // instant; nothing bounded how old the sentence was, and the sweep supplied unlimited
  // retries. This is that bound.
  // Checked BEFORE anything is routed. When this machine cannot read the open
  // decisions, nothing can be said about any item on the list — and routing them one by
  // one branded every ordinary idea "⚠️ could not route" and recorded it, writing a
  // fault of the machine onto his notes and stranding them there permanently.
  const live = buildQueue(hub, { now });
  if (!live.read) {
    return {
      ...empty,
      read: true,
      why: `the open decision list could not be read, so nothing on the list was routed — ${live.why}`,
      blocked: pending.items.map((i) => ({ reminderId: i.id, heard: i.text, reason: live.why })),
    };
  }

  const readAt = queue?.at ? Date.parse(queue.at) : null;
  const out = {
    ...empty,
    read: true,
    why: readAt ? '' : 'no decision queue has ever been read to him on this machine, so nothing on the list can be an answer to one',
  };

  for (const item of pending.items) {
    const made = item.created ? Date.parse(item.created) : NaN;
    const fresh = Boolean(readAt) && Number.isFinite(made) && made >= readAt;
    const r = routeSpoken(item.text, { workspace, hub, queue, now, dryRun: !fresh });
    const row = { ...r, reminderId: item.id, heard: item.text, created: item.created ?? null };

    // Older than the list, or of unknown age: left exactly as it is. Not routed, not
    // stamped, not counted as anything but what it is.
    if (!fresh && (r.kind === 'answer' || r.kind === 'unrouted')) { out.stale.push(row); continue; }
    if (r.kind === 'private') { out.privates.push(row); continue; }
    if (r.kind === 'idea') { out.ideas.push(row); continue; }

    // The rename and the completion ARE the mechanism that stops an item being read
    // again, so a write that fails while the read succeeds puts the same sentence back
    // in front of the router on every sweep after this one. The result is checked and
    // reported rather than discarded.
    const writes = [];
    if (r.kind === 'answer') {
      if (stamp) {
        writes.push(run(setName(item.id, `${RECEIPT_DONE} ${r.decision.handle} - recorded: ${oneLine(item.text)}`)));
        writes.push(run(setDone(item.id)));
      }
      out.routed.push(row);
    } else {
      if (stamp) writes.push(run(setName(item.id, `${RECEIPT_HELD} could not route: ${oneLine(item.text)}`)));
      out.unrouted.push(row);
    }
    const failed = writes.find((w) => w && w.ok === false);
    if (failed) out.unstamped.push({ reminderId: item.id, kind: r.kind, why: failed.why || 'the write failed with no reason given' });
  }
  return out;
}
