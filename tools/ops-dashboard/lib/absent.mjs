// The vocabulary of absence — how every surface says "nothing recorded yet".
//
// Requirement: jwildfire/obot.roadmap#223. @jwildfire moves to a dedicated machine
// this week, where `~/.claude/jobs`, the worker ledger, the delivery record, the
// sweep's state file and the priced usage artifact are all absent on day one. None
// of the surfaces built on them had ever been looked at in that state; the one case
// that was found — the sessions brief losing its feed and its record link with an
// empty roster — was found by accident, in CI, because the runner had no job
// history and this workstation always did.
//
// THE DESIGN CALL, MADE DELIBERATELY (the requirement asks that it not be made by
// accident): **shared vocabulary, per-surface placement.** This module owns the
// words and the rule; each surface decides where the sentence goes and what shape it
// takes in its own markup. Not one shared component, because the failure being fixed
// is a CLAIM problem rather than a layout one — a component would either impose an
// empty frame on a surface that legitimately has nothing to draw (the brief's feed
// and record link must survive an empty roster, not be replaced by a panel), or grow
// enough configuration to be this module with extra steps. Not per-surface wording
// either, because that is how a page ends up saying "All answered" and "Decisions
// unavailable" in the same column.
//
// THE RULE, and it is the whole point:
//
//   A surface may print a figure only when it read the file the figure comes from.
//
// A zero and an unread file look identical on a page, and that confusion has cost
// this programme repeatedly. `$0.00 spent` above a column of cells each correctly
// reading "cost unavailable — no usage artifact" is not a rounding problem; it is
// the page asserting a measurement it never made. Where the source was not read the
// figure is `—`, carrying its reason, and the reader is told what would fill it.
//
// THE SHAPE of every notice: what is absent — what would populate it. The second
// half is not optional. A notice that does not say how to fill it is a dead end, and
// on the first morning of a new machine every panel is one.
import { esc } from './esc.mjs';

/** What stands where a figure cannot: never `0`, never `$0.00`. */
export const UNMEASURED = '—';

/**
 * One notice. `subject` names what is absent in the reader's terms ("No delivery
 * record yet"), `how` says what would produce it. Both plain text; escaped by
 * `absentNote`, left raw here so a caller can compose before escaping.
 */
export function nothingYet(subject, how) {
  const s = String(subject).trim().replace(/[.\s]+$/, '');
  const h = String(how ?? '').trim().replace(/[.\s]+$/, '');
  return h ? `${s} — ${h}.` : `${s}.`;
}

/** The same, as the standard block a surface drops into its own markup. */
export function absentNote(subject, how, { cls = 'absent' } = {}) {
  return `<p class="${esc(cls)}">${esc(nothingYet(subject, how))}</p>`;
}

/**
 * A figure and the words for it, decided by whether its source was read.
 *
 * `read: false` is not "the value is zero" and not "the value is unknown" — it is
 * "nobody looked", which is the only one of the three a page must never round off.
 * Returns `{ text, measured, title }`: `text` for the cell, `title` for the reason,
 * `measured` so a caller can style or test on it without parsing the string.
 */
export function figure(value, { read = true, format = (v) => String(v), why = '' } = {}) {
  if (!read || value === null || value === undefined) {
    return { text: UNMEASURED, measured: false, title: why || 'not measured — the source for this figure was not read' };
  }
  return { text: format(value), measured: true, title: '' };
}

/** `figure` for money, so no surface builds `$0.00` out of an unread file again. */
export const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const moneyFigure = (value, opts = {}) => figure(value, { format: money, ...opts });

/**
 * A count, where "the source was not read" and "the source was read and held
 * nothing" are different sentences rather than the same `0`.
 *
 * `zero` is what to say when the source WAS read and the count really is none —
 * "All answered" is a fine thing to say about a queue that was collected, and a lie
 * about one that could not be.
 */
export function countPhrase(n, { read = true, zero = 'none yet', unread = 'not read yet' } = {}) {
  if (!read) return unread;
  return n ? String(n) : zero;
}

/**
 * The first-morning line. Used where a whole surface has no history at all, as
 * opposed to one panel of it — it says the machine is not broken and that the
 * record starts now, which is the distinction the pages exist to make.
 */
export const MEASUREMENT_BEGINS = 'Nothing has been recorded on this machine yet — measurement begins here.';

/**
 * Which of a surface's inputs were actually readable.
 *
 * Threaded through the model rather than re-derived in the view: by the time a
 * renderer holds an empty array it can no longer tell an absent file from an empty
 * one, and every honest sentence below depends on that difference.
 */
export function source(path, { present, note = '' } = {}) {
  return { path, present: !!present, note };
}

/** True when every named source was read. */
export const allRead = (sources = {}) => Object.values(sources).every((s) => s?.present);

/** The names of the sources that were not read, for a one-line "why this is empty". */
export const unread = (sources = {}) => Object.entries(sources)
  .filter(([, s]) => !s?.present).map(([k]) => k);
