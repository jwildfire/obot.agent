// The one way to get the shared stylesheet.
//
// Requirement jwildfire/obot.agent#15. Consumers import OBOT_CSS and inline it; they
// do not keep their own copy. That is the whole point of the file, and the reason this
// module reads from disk rather than exporting a string literal: a literal is a copy
// with extra steps, and it drifts the first time somebody edits the .css.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to the sheet, for a consumer that wants to link or copy it at build time. */
export const SHARED_CSS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'obot.css');

/** The sheet itself. Read once, at import — it ships with the repo and cannot change under a running process. */
export const OBOT_CSS = fs.readFileSync(SHARED_CSS_PATH, 'utf8');
