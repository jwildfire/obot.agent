// Delete and snooze, for anything in the list.
//
// @jwildfire, 2026-08-15: "i also want to just be able to delete/snooze anything
// in the list." Anything means anything - release candidates and decisions as
// well as config items - so this module knows nothing about kinds beyond the
// wording it puts on a button.
//
// Two rules shape it:
//
// **A snooze must have a wake.** A snooze with no way back is a silent delete
// wearing a friendlier word. So `triage` refuses one that carries neither a date
// nor a change-watch, and snoozed rows stay on the page with the condition that
// brings them back written on them.
//
// **Nothing is deleted.** The standing workspace rule is that agents never delete
// without approval; his click on Dismiss *is* that approval, so the affordance is
// legitimate - but the config list's own convention is retire-with-strikethrough,
// never delete, and that convention wins over the button. The reconciliation:
// **a dashboard click never edits `.claude/blockers.md`.** It appends to this
// ledger, the queue filters on the ledger, and the source file is untouched. A
// dismissal is therefore recoverable by construction, and "who, when, what" is
// the ledger's whole content. `blocker-log --retire` remains the one writer that
// moves an entry to `## Resolved`, and that is an agent's job, not a click's.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { opsDir, ensureStore, SENTINEL } from './store.mjs';

export const ACTIONS = ['snooze', 'dismiss', 'done', 'restore'];
const LEDGER = 'triage.jsonl';

const file = (workspace) => path.join(opsDir(workspace), LEDGER);

/**
 * What an item looks like right now, so a change can wake a snooze.
 *
 * Short and content-derived: re-reading the same item gives the same value, and
 * an item that was reworded, re-filed or pushed to gives a different one.
 */
export function fingerprint({ kind, key, title, body = '', date = '' } = {}) {
  return crypto.createHash('sha1').update([kind, key, title, body, date].join(' ')).digest('hex').slice(0, 12);
}

/**
 * Record one triage action. Append-only; the ledger is the history, and the
 * current state is derived from it rather than stored.
 */
export function triage(workspace, { key, kind = null, action, until = null, wakeOnChange = false, fingerprint: fp = null, note = '', by = 'jwildfire' }) {
  if (!key) throw new Error('triage: no key');
  if (!ACTIONS.includes(action)) throw new Error(`triage: unknown action ${action}`);
  // The rule that keeps a snooze from being a delete.
  if (action === 'snooze' && !until && !wakeOnChange) {
    throw new Error('triage: a snooze needs a wake - a date, a change-watch, or both');
  }
  const rec = {
    _note: SENTINEL,
    at: new Date().toISOString(),
    key, kind, action, by,
    until: action === 'snooze' ? until : null,
    wakeOnChange: action === 'snooze' ? Boolean(wakeOnChange) : false,
    fingerprint: fp,
    note: String(note ?? '').trim(),
  };
  ensureStore(workspace);
  fs.appendFileSync(file(workspace), `${JSON.stringify(rec)}\n`);
  return rec;
}

/** Every triage action ever taken, oldest first. */
export function readTriage(workspace) {
  let raw = '';
  try { raw = fs.readFileSync(file(workspace), 'utf8'); } catch { return []; }
  const out = [];
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l)); } catch { /* a truncated write; skip it */ }
  }
  return out;
}

/** The live state per key: the last action, with `restore` clearing it. */
export function triageState(workspace) {
  const state = {};
  for (const r of readTriage(workspace)) {
    if (r.action === 'restore') delete state[r.key];
    else state[r.key] = r;
  }
  return state;
}

/** Whether a snooze is still holding, given what the item looks like now. */
export function asleep(rec, item, now = new Date()) {
  if (!rec || rec.action !== 'snooze') return false;
  if (rec.until && Date.parse(rec.until) <= now.getTime()) return false;
  if (rec.wakeOnChange && rec.fingerprint && item?.fingerprint && rec.fingerprint !== item.fingerprint) return false;
  return true;
}

/** The sentence on a snoozed row. A wake he cannot see is not a wake. */
export function wakeText(rec) {
  if (!rec) return '';
  const parts = [];
  if (rec.until) {
    const d = new Date(rec.until);
    parts.push(`wakes ${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`);
  }
  if (rec.wakeOnChange) parts.push(parts.length ? 'or sooner if it changes' : 'wakes if it changes');
  return parts.join(', ');
}

/**
 * Split a queue into what he should see, what is asleep, and what he cleared.
 *
 * Nothing is dropped: a caller gets all three lists so the page can render the
 * other two collapsed rather than letting anything vanish.
 */
export function applyTriage(workspace, items, now = new Date()) {
  const state = triageState(workspace);
  const out = { items: [], snoozed: [], cleared: [] };
  for (const it of items) {
    const rec = state[it.key];
    if (!rec) { out.items.push(it); continue; }
    if (rec.action === 'snooze') {
      if (asleep(rec, it, now)) out.snoozed.push({ ...it, triage: rec });
      else out.items.push({ ...it, wokeFrom: rec });
      continue;
    }
    // dismiss / done - cleared from the queue, kept on the page and in the ledger.
    out.cleared.push({ ...it, triage: rec });
  }
  return out;
}

/**
 * What Dismiss actually does, said plainly per kind. Conflating "off my list"
 * with "gone" would hide real work - the pull request is still open whatever
 * this page shows.
 */
export const DISMISS_MEANS = {
  rc: 'Hides it here. The pull request stays open on GitHub.',
  decision: 'Hides it here. The decision stays open on the hub.',
  config: 'Hides it here. The entry stays on the config list, untouched.',
};
