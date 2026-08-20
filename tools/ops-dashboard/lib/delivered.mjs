// What reached him — the landing record, on his own page (jwildfire/obot.roadmap#257).
//
// @jwildfire, 2026-08-20, after four workers finished inside twenty-five minutes and
// closed five requirements with nothing telling him: "I like the summary of the
// closed items in the top 10, but make them a plain language executive summary
// instead of a bunch of issue numbers. Make sure that those are passed to you
// properly (and passed to me) whenever they are created."
//
// SHELLED, NOT RE-READ. The record's own tool is the one reader — the same discipline
// that has the sweep shell `delivery-log render` and has `rankhead` spawn the
// Navigator's reader rather than repeating its `gh` calls. Two parsers of one
// append-only file is how the page and the sweep would come to disagree about what
// completed, and a disagreement between two halves of one detector is undetectable
// from either.
//
// READ INLINE RATHER THAN CACHED. It is a local file read through a small python
// process — no network, single-digit milliseconds — and the whole point of this panel
// is that a completion recorded a minute ago is on the page now. A cache would put
// the delivery lane behind a refresh interval, which is the failure being fixed
// wearing a different hat.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The tool that owns the record. */
export const TOOL = path.join(HERE, '..', '..', 'landing-log');

/**
 * The landing record, or an honest account of why it is not here.
 *
 * `read` is about whether this process actually opened the record; `armed` is about
 * whether anything has ever been written to it. They are different facts and the page
 * says them differently — "nothing completed today" and "nothing has ever been
 * recorded on this machine" and "the record could not be read" are three answers, and
 * collapsing any two of them is jwildfire/obot.roadmap#223.
 */
export function collectDelivered(workspace, { tool = TOOL, run = spawnSync } = {}) {
  const empty = { read: false, armed: false, closures: [], promises: [], why: '' };
  let r;
  try {
    r = run(tool, ['list', '--json'], {
      env: { ...process.env, OBOT_WORKSPACE: workspace }, encoding: 'utf8', timeout: 10000,
    });
  } catch (e) {
    return { ...empty, why: `the landing record could not be run — ${String(e.message).slice(0, 120)}` };
  }
  if (!r || r.error) {
    return { ...empty, why: `the landing record could not be run — ${String(r?.error?.message ?? 'no result').slice(0, 120)}` };
  }
  if (r.status !== 0) {
    return { ...empty, why: `${path.basename(tool)} exited ${r.status}${r.stderr ? ` — ${String(r.stderr).trim().slice(0, 120)}` : ''}` };
  }
  let state;
  try {
    state = JSON.parse(r.stdout || 'null');
  } catch {
    return { ...empty, why: 'the landing record returned something that is not JSON' };
  }
  if (!state) return { ...empty, why: 'the landing record returned nothing' };
  return {
    read: true,
    armed: Boolean(state.armed),
    closures: state.closures ?? [],
    promises: state.promises ?? [],
    why: '',
  };
}
