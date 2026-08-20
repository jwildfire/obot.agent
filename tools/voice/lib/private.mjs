// The private lane — one rule about what "private" means, in one place.
//
// `private:` has always meant "this stays on the machine, the hub is public". It was
// enforced twice with two different rules: bash tested `private:*` (case-sensitive, no
// leading whitespace) and the router tested `/^\s*private\s*:/i`. "Private: …" satisfied
// only the second, so it missed the branch that WROTE the file, reached the router,
// came back `private`, and was counted as "1 kept private" while nothing was kept
// anywhere and the reminder was never completed — so it was re-counted on every run.
// That is the house failure exactly: an operation reporting success while doing nothing.
//
// The rule now lives here and the bash lane defers to it.
//
// AND THE DESTINATION IS CHECKED. The inbox path comes from an environment variable
// (`OBOT_PRIVATE_INBOX`, or `CLAUDE_PROJECT_DIR`), so it can be pointed anywhere,
// including inside a checkout — where the one property this lane exists for, that the
// text is never committed, would depend on a `.gitignore` being right. A destination
// inside a git repository is refused rather than written.
import fs from 'node:fs';
import path from 'node:path';

export const PRIVATE_RE = /^\s*private\s*:/i;

export const isPrivate = (text) => PRIVATE_RE.test(String(text ?? ''));

/** The text with the marker removed, and nothing else changed. */
export const privateBody = (text) => String(text ?? '').replace(PRIVATE_RE, '').trim();

/** Is this path inside a git repository? A `.git` at any level above it says yes. */
export function insideRepo(file) {
  let dir = path.dirname(path.resolve(file));
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

export const inboxPath = (workspace) => process.env.OBOT_PRIVATE_INBOX
  || path.join(process.env.CLAUDE_PROJECT_DIR || workspace, '.claude', 'private-inbox.md');

/**
 * Append one private note. `{written, file, why}` — never throws, because the caller
 * has to be able to leave the reminder pending rather than lose the note.
 */
export function keepPrivate(workspace, text, { now = new Date(), file = null } = {}) {
  const dest = file ?? inboxPath(workspace);
  const repo = insideRepo(dest);
  if (repo) {
    return { written: false, file: dest, why: `${dest} is inside the git repository at ${repo}, and a private note is never written into a checkout` };
  }
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const stamp = now.toISOString().slice(0, 16).replace('T', ' ');
    fs.appendFileSync(dest, `- ${stamp} — ${privateBody(text)}\n`);
    return { written: true, file: dest, why: '' };
  } catch (e) {
    return { written: false, file: dest, why: `${dest} could not be written (${e.code ?? e.message})` };
  }
}
