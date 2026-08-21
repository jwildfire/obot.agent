// Constraints in force, on the five-minute ride — jwildfire/obot.roadmap#267.
//
// The requirement's sentence is the whole design: "A constraint he states — a number, a
// bound, an exception, a 'do not' — is recorded where the judgment happens, not only where
// it was heard."
//
// Where the judgment happens is this file. `navigator-state.md` is what the Navigator reads
// before it judges a closeout, what 🎩🤖 prime reads to answer him, and what the Operations
// Dashboard renders. Putting his words there costs one section and removes the condition
// that made the wrong verdict likely: the party holding the exception was never the party
// doing the judging.
//
// ## Four readings, and the fourth is the one that matters
//
//   in force     every constraint, with its exception on the same line. Rendered EVERY
//                sweep, clean or not — a section that only appears when something is wrong
//                is indistinguishable from one that has stopped running.
//   uncited      a judgment made against something he said that cites no constraint. The
//                audio verdicts are exactly this shape.
//   half         a hedged quote with no exception recorded. Unwritable through the tool,
//                so it can only arrive by hand-edit — which is when nothing else looks.
//   last cited   not a finding. The only visible symptom a SILENT judge has.
//
// That last one is the point of the whole exercise. An objection that turns out wrong twice
// teaches the judge to stop objecting, and a judge that has quietly stopped checking looks
// exactly like a judge with nothing to report. A constraint that nobody has cited in a week
// of judging is not proof of anything, and it is the only thing on this machine that would
// show the check decaying at all — so it is printed, plainly, and alarms about nothing.
//
// ## Headlines
//
// Spelled for `ALARM_RE` in tools/ops-dashboard/lib/navigator.mjs, which admits only
// uppercase headlines carrying GAP / FINDING / BREACHED / FAILED / DOWN / BROKEN, and only
// on an UNINDENTED, NON-BULLET line — `parseNavigatorState` alarm-tests plain lines and
// never bullets (obot.roadmap#241). The constants are exported so the tests assert them
// against the real regular expression rather than against a copy of it.
import fs from 'node:fs';
import path from 'node:path';

import { auditConstraints, inForce, lastCited, readConstraints } from '../lib/constraints.mjs';
import { dispatchOverlap } from '../lib/dispatch.mjs';

/** The reading itself did not happen. Not a clean bill of health, and must not read as one. */
export const ALARM_READING = '**CONSTRAINT READING BROKEN**';
/** Something of his was judged against, and the judgment cannot say what. */
export const ALARM_UNCITED = '**UNCITED JUDGMENT FINDING**';
/** A bound recorded without the exception that arrived in the same sentence. */
export const ALARM_HALF = '**HALF A CONSTRAINT FINDING**';
/** Two or more workers in flight under one requirement. */
export const ALARM_OVERLAP = '**DISPATCH OVERLAP FINDING**';
/** A fleet is running and not one claim says what it is working under. */
export const ALARM_COVERAGE = '**DISPATCH COVERAGE GAP**';

export const HEADING = '## Constraints in force — his words, where the judging happens';

const deliveryPath = (ws) => path.join(ws, '.claude/session-hub/delivery.md');

/** One pass: the ledger, the judging it should have backed, and who is in flight. */
export function collectConstraints({ ws, jobs, now = new Date(), since = null, read = fs.readFileSync } = {}) {
  const c = readConstraints(ws);
  let deliveryText = '';
  try { deliveryText = read(deliveryPath(ws), 'utf8'); } catch { /* no record is not a constraint failure */ }
  const audit = auditConstraints({ constraints: c.constraints, deliveryText, since, read: c.read, armed: c.armed });
  return {
    now: new Date(now).toISOString(),
    constraints: c,
    audit,
    cited: lastCited(c.constraints, deliveryText),
    dispatch: dispatchOverlap({ ws, jobs, now }),
  };
}

const quote = (r) => `"${r.said}"${r.exception ? ` — AND, in the same breath: "${r.exception}"` : ''}`;

/**
 * The section, rendered whole every sweep.
 *
 * Verdict lines come first and findings after them, because a reader summarises by the
 * first line and a headline that arrives underneath its own detail is a headline nobody
 * reads (obot.agent#129).
 */
export function constraintsSection(state) {
  const { constraints: c, audit: a, cited = {}, dispatch = {} } = state ?? {};
  const out = [HEADING, ''];

  if (!c || !c.read) {
    out.push(`${ALARM_READING} — the constraint record could not be read this sweep${c?.why ? `: ${c.why}` : ''}. No judgment was checked against anything he said, and nothing here says a bound of his is in force. Unknown, not clean.`);
  } else if (!c.armed) {
    out.push('No constraint has been recorded on this machine yet, so every judgment made today is made against bounds nobody wrote down. That is not a clean record; it is an unwritten one. `obot.agent/tools/constraint-log add` writes the first.');
  } else {
    const alarms = [];
    if (a.uncited.length) {
      alarms.push(`${ALARM_UNCITED} — ${a.uncited.length} judgment(s) since ${a.epoch} judged against something he said and cited no constraint. Each one is a verdict that cannot be checked, and the last four of this shape were withdrawn as wrong (n0220).`);
    }
    if (a.unresolved.length) {
      alarms.push(`${ALARM_UNCITED} — ${a.unresolved.length} citation(s) name a constraint that is not in the record. A citation that does not resolve is worse than none, because it reads as checked.`);
    }
    if (a.half.length) {
      alarms.push(`${ALARM_HALF} — ${a.half.length} record(s) hedge with no exception recorded. Half of that sentence was worse than neither half.`);
    }
    out.push(alarms.length
      ? alarms.join('\n')
      : `${c.constraints.length} constraint(s) recorded; every citation resolves and nothing has been judged against an unrecorded bound since ${a.epoch}.`);
    out.push('');
    for (const r of c.constraints) {
      out.push(`- **${r.id}** ${r.on} · ${r.kind} · scope ${r.scope} · heard: ${r.heard} — ${quote(r)} · last cited ${cited[r.id] ?? 'never'}`);
    }
    for (const u of a.uncited) {
      out.push(`- ${u.day} ${u.who} (${u.kind}) judged against something he said, citing nothing: ${u.rest.slice(0, 160)}`);
    }
    for (const u of a.unresolved) out.push(`- ${u.day} ${u.who} cites ${u.id}, which is not in the record`);
  }

  out.push('', '### Dispatch — who is in flight, and under what', '');
  if (!dispatch || !dispatch.read) {
    out.push(`${ALARM_READING} — the dispatch record could not be read this sweep${dispatch?.why ? `: ${dispatch.why}` : ''}. Nothing here says whether two workers are on the same requirement.`);
    return `${out.join('\n')}\n`;
  }
  const cov = dispatch.coverage ?? { inFlight: 0, placed: 0 };
  if (dispatch.groups.length) {
    out.push(`${ALARM_OVERLAP} — ${dispatch.groups.length} requirement(s) have more than one worker in flight. Sometimes that is a split; three times in one week it was a collision nobody could see.`);
  } else if (cov.inFlight > 1 && cov.placed === 0) {
    out.push(`${ALARM_COVERAGE} — ${cov.inFlight} workers are in flight and not one claim says what it is working under, so overlap cannot be checked at all. This reads as no overlap and is not: record it with \`worker-id claim --requirement hub#267\`.`);
  } else {
    out.push(`${cov.inFlight} worker(s) in flight, ${cov.placed} of them placed under a requirement; no two are on the same one.`);
  }
  out.push('');
  for (const g of dispatch.groups) {
    out.push(`- **${g.requirement}** — ${g.workers.map((w) => `${w.id} ${w.slug}`).join(' and ')} are both in flight under it`);
  }
  return `${out.join('\n')}\n`;
}

/** What the sweep renders when this pass did not run at all. */
export const constraintsBroken = (why) => `${HEADING}\n\n${ALARM_READING} — ${why}. No constraint of his was read this sweep, so nothing here says what bounds the work being judged. Unknown, not clean.\n`;
