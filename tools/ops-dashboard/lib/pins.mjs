// Pinning on the Agents tab.
//
// @jwildfire, 2026-08-17: "also let me pin agents. pin prime, nav and fleet manager
// (fleet for short) by default." Task jwildfire/obot.agent#169.
//
// THE DEFAULT IS DERIVED, NEVER LISTED. Nothing in this file names prime, the
// Navigator or fleet — the default set is "every standing role", read off the role
// registry in roster-view.mjs. Two failures that buys, both of them the same bug in
// opposite directions:
//
//   - a fourth standing role would otherwise arrive UNPINNED and stay that way until
//     somebody remembered this file existed;
//   - a worker that has run for a month, spent the most money and moved four
//     requirements would otherwise be a candidate for drifting into the pinned set,
//     because it looks important. It is not a role. It is judged on what it
//     delivered, and that judgement is the rest of the page.
//
// A pin is recorded against the ROLE for a standing session and against the worker
// ID for a worker — the two identities that are stable. A session name is neither:
// prime is restarted more often than anything else on this machine, and a pin keyed
// on the name of one of its sessions would quietly stop applying.
//
// LOCAL ONLY. Pins are his preference state, so they live in the ops store beside the
// answers and the cache, carry its sentinel, and never reach a repo — the same rule
// as the config list, for the same reason: the hub's deploy publishes `reports/`
// wholesale and a tracked file is one careless glob from the internet.
import fs from 'node:fs';
import path from 'node:path';

import { STANDING_ROLES, standingRoleOf } from './roster-view.mjs';
import { ensureStore, opsDir, SENTINEL } from './store.mjs';

export const PINS_FILE = 'pins.json';

const pinsPath = (workspace) => path.join(opsDir(workspace), PINS_FILE);

/** No pins recorded — which is not the same as nothing being pinned. */
export const emptyPins = () => ({ overrides: {}, at: null });

/**
 * The identity a pin is recorded against.
 *
 * `role:<tag>` for a standing role, so the pin follows the role across every restart
 * and every rename. The worker id for a worker, because an id is never reused. The
 * label for everything else, which is all that is left to key on.
 */
export function pinKey(row) {
  const role = standingRoleOf(row);
  if (role) return `role:${role.tag}`;
  if (row?.id) return String(row.id);
  return `label:${String(row?.label ?? '')}`;
}

/** Pinned unless he has said otherwise — true for a standing role, false for work. */
export const pinnedByDefault = (row) => !!standingRoleOf(row);

/**
 * What this row's pin is, and why. `byDefault` and `explicit` are both reported so
 * the page can say "pinned because it is a standing role" rather than leaving him to
 * infer why a pin he never clicked is on.
 */
export function pinState(row, pins = emptyPins()) {
  const key = pinKey(row);
  const explicit = pins?.overrides?.[key];
  const byDefault = pinnedByDefault(row);
  return {
    key,
    byDefault,
    explicit: explicit !== undefined && explicit !== null,
    pinned: explicit === undefined || explicit === null ? byDefault : !!explicit,
  };
}

export const isPinned = (row, pins) => pinState(row, pins).pinned;

/**
 * The same question asked of a job name, before any row exists.
 *
 * The model's scope rules run over job names, and they have to know what is pinned:
 * a pinned role that died and fell off the end of the capped list of deaths is a pin
 * that dropped its subject on death, and the absence then reads as health.
 */
export const labelIsPinned = (label, pins) => isPinned({ id: null, label: String(label ?? '') }, pins);

/** Every standing role he has NOT unpinned — the roles that owe him a row. */
export const pinnedRoles = (pins = emptyPins()) => STANDING_ROLES.filter(
  (r) => isPinned({ id: null, label: r.tag }, pins),
);

/** His pins as recorded, or none — an unreadable file is never a crash. */
export function readPins(workspace) {
  try {
    const raw = JSON.parse(fs.readFileSync(pinsPath(workspace), 'utf8'));
    const overrides = {};
    for (const [k, v] of Object.entries(raw?.overrides ?? {})) {
      if (typeof v === 'boolean') overrides[k] = v;
    }
    return { overrides, at: raw?.at ?? null };
  } catch {
    return emptyPins();
  }
}

/**
 * Record one pin, or clear it.
 *
 * `pinned: null` deletes the override so the row goes back to following its role —
 * which is a different state from "explicitly unpinned" and has to stay one, or
 * clearing a pin on a standing role would silently mean hiding it forever.
 */
export function writePin(workspace, { key, pinned }) {
  const k = String(key ?? '').trim();
  if (!k || k.length > 200) throw new Error('a pin needs a key');
  ensureStore(workspace);
  const pins = readPins(workspace);
  if (pinned === null || pinned === undefined) delete pins.overrides[k];
  else pins.overrides[k] = !!pinned;
  const out = { _note: SENTINEL, at: new Date().toISOString(), overrides: pins.overrides };
  fs.writeFileSync(pinsPath(workspace), `${JSON.stringify(out, null, 2)}\n`);
  return { overrides: out.overrides, at: out.at };
}
