// The one way to get the shared keynote stylesheet.
//
// Task jwildfire/obot.agent#295. Mirrors assets/obot-css.mjs: consumers import and
// inline (or link SHARED_KEYNOTE_CSS_PATH), and they do not keep their own copy. The
// module reads from disk rather than exporting a string literal, because a literal is
// a copy with extra steps and it drifts the first time somebody edits the .css.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to the sheet, for a consumer that links or vendors it at build time. */
export const SHARED_KEYNOTE_CSS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'obot-keynote.css');

/** The sheet itself. Read once, at import — it ships with the repo and cannot change under a running process. */
export const OBOT_KEYNOTE_CSS = fs.readFileSync(SHARED_KEYNOTE_CSS_PATH, 'utf8');
