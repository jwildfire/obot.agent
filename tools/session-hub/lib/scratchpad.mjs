// Tolerant parser for the session scratchpad (.claude/session-notes/YYYY-MM-DD.md).
//
// Contract (design #24 §2): recognized structures — `## <Section>` headings,
// `### <Group>` subheadings, `- [ ]`/`- [x]` checklist items, `- HH:MM — text`
// timestamped notes, plain bullets — get rich rendering. Anything else passes
// through as plain text; nothing is dropped and nothing throws.

/** Split a scratchpad into { title, sections: [{ heading, lines }] }. */
export function splitSections(md) {
  const lines = String(md ?? '').split('\n');
  const sections = [];
  let title = '';
  let current = null;
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.*)/);
    if (h1 && !title) {
      title = h1[1].trim();
      continue;
    }
    const h2 = line.match(/^##\s+(.*)/);
    if (h2) {
      current = { heading: h2[1].trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return { title, sections };
}

/** First section whose heading starts with `name` (case-insensitive), or null. */
export function findSection(parsed, name) {
  const want = name.toLowerCase();
  return (
    parsed.sections.find((s) => s.heading.toLowerCase().startsWith(want)) ?? null
  );
}

/**
 * Parse a section body into groups of items.
 * Returns [{ group: string|null, items: [{ checked: bool|null, text, time }] }].
 * - `### Heading` starts a named group.
 * - `- [ ] text` / `- [x] text` → checklist item (checked true/false).
 * - `- HH:MM — text` → timestamped item (checked null).
 * - `- text` → plain item (checked null).
 * - Continuation lines (indented) append to the previous item's text.
 * - Non-list prose lines are kept as items with `prose: true`.
 */
export function parseItems(section) {
  const groups = [{ group: null, items: [] }];
  if (!section) return groups;
  let cur = groups[0];
  let last = null;
  for (const raw of section.lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^<!--.*-->$/.test(line.trim())) continue; // markers handled elsewhere
    const g = line.match(/^###\s+(.*)/);
    if (g) {
      cur = { group: g[1].trim(), items: [] };
      groups.push(cur);
      last = null;
      continue;
    }
    const item = line.match(/^[-*]\s+(.*)/);
    if (item) {
      let text = item[1];
      let checked = null;
      let time = null;
      const box = text.match(/^\[( |x|X)\]\s*(.*)/);
      if (box) {
        checked = box[1].toLowerCase() === 'x';
        text = box[2];
      }
      const t = text.match(/^(\d{1,2}:\d{2})\s*[—–-]\s*(.*)/);
      if (t) {
        time = t[1];
        text = t[2];
      }
      last = { checked, time, text };
      cur.items.push(last);
      continue;
    }
    if (/^\s+\S/.test(raw) && last) {
      last.text += ' ' + line.trim();
      continue;
    }
    last = { checked: null, time: null, text: line.trim(), prose: true };
    cur.items.push(last);
  }
  return groups;
}

/**
 * Find the newest session-init marker in the scratchpad. Both marker shapes
 * session-init has written are recognized:
 *   <!-- session-init 2026-07-11 21:34 session #2 (job ce8f336e) -->   (canonical)
 *   <!-- session-init 2026-07-11 session #2 (bg job ce8f336e) -->      (job only)
 *   <!-- session-init 2026-07-11 21:34 -->                             (time only)
 * Returns { raw, sessionNumber, jobId, date, time } or null.
 */
export function findSessionMarker(md) {
  const re = /<!--\s*session-init\s+([^>]*?)\s*-->/g;
  let m;
  let lastm = null;
  while ((m = re.exec(String(md ?? ''))) !== null) lastm = m;
  if (!lastm) return null;
  const body = lastm[1];
  const num = body.match(/session\s*#(\d+)/i);
  const job = body.match(/\b(?:bg\s+)?job\s+([0-9a-f]{6,})/i);
  const date = body.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const time = body.match(/\b(\d{1,2}:\d{2})\b/);
  return {
    raw: lastm[0],
    sessionNumber: num ? Number(num[1]) : 1,
    jobId: job ? job[1] : null,
    date: date ? date[1] : null,
    time: time ? time[1] : null,
  };
}
