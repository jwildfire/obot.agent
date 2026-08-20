// Whether anything is polling the car lane on this machine.
//
// Kept as an explicit marker rather than inferred, and DEFAULT OFF, for one reason:
// polling means the five-minute Navigator sweep shells `osascript` into Apple
// Reminders, and the automation grant that allows that is his to give, per process.
// A lane that silently started prompting him every five minutes would be a worse
// failure than a lane that is not yet on — so it is off until something says
// otherwise, the sweep reports which state it is in on every pass, and the section
// carries the one command that changes it.
//
// Disarming writes `false`; it does not remove the file. Nothing in this program
// deletes without being asked, and a marker that has been turned off is a different
// fact from one that was never set.
import fs from 'node:fs';
import path from 'node:path';

import { SENTINEL } from '../../ops-dashboard/lib/store.mjs';
import { voiceDir } from './handles.mjs';

export const armFile = (workspace) => path.join(voiceDir(workspace), 'armed.json');

/** True only when something explicitly armed it. Any failure to read reads as off. */
export function isArmed(workspace) {
  try { return JSON.parse(fs.readFileSync(armFile(workspace), 'utf8')).armed === true; } catch { return false; }
}

export function setArmed(workspace, on, { now = new Date() } = {}) {
  fs.mkdirSync(voiceDir(workspace), { recursive: true });
  fs.writeFileSync(armFile(workspace), `${JSON.stringify({ _note: SENTINEL, armed: Boolean(on), at: now.toISOString() }, null, 2)}\n`);
  return Boolean(on);
}
