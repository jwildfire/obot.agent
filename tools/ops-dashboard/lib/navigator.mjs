// The Navigator tab's reader.
//
// @jwildfire, 2026-08-15: "I think i almost certainly want a navigator tab in the ops
// db that tells me what changes each agent made to the dasboard. basically a list of
// issues/PRs that were created/updated by each agent."
//
// What exists today is the Navigator's own sweep file — the RC queue and a capped
// event log, written every five minutes by `tools/navigator/sweep.mjs` and by nothing
// else. This renders that. Per-agent attribution is *not* here on purpose: every
// agent-authored issue and PR is authored by the same identity (`obotclaw[bot]`), so
// "which agent" is not a thing GitHub can answer — it needs a join against the
// scratchpad's per-sibling lines, which is a separate piece of work.
//
// The seam for it is the parser below: every `## Heading` in the state file becomes
// a section and renders as itself, and an indented bullet under a row becomes that
// row's detail. Whatever assembles a section reaches the page with no rendering
// code — which is how the agent roster (jwildfire/obot.roadmap#199) arrives on the
// session tab: it is markdown, parsed here, rendered by the same list.
//
// The one rule this must not lose in translation is the state file's own: a sweep older
// than three cadences means the observer is dead, and a dead observer's content must
// never be presented as current.

const SWEPT_RE = /^swept:\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})(?:\s*·\s*(.*))?$/m;
const CADENCE_RE = /cadence\s+(\d+)\s*m/i;

/** How many minutes old a `swept:` stamp is, read as local time (the sweep writes local). */
function ageMinutes(stamp, now) {
  const t = Date.parse(stamp.replace(' ', 'T'));
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((now.getTime() - t) / 60000));
}

/**
 * One bullet, as a row reads: the URL is the row's link and the verification stamp
 * is small print, so neither belongs in the middle of the text.
 */
function parseItem(text) {
  return {
    url: text.match(/https?:\/\/\S+/)?.[0] ?? null,
    verified: text.match(/\[verified gh ([^\]]+)\]/)?.[1] ?? null,
    text: text.replace(/https?:\/\/\S+/g, '').replace(/\[verified gh [^\]]+\]/g, '')
      .replace(/[*`"]/g, '').replace(/\s+/g, ' ').replace(/\s*·\s*$/, '').trim(),
  };
}

/**
 * The state file as data: the sweep stamp, whether the observer is alive, and every
 * `##` section with its bullets. Sections are generic by design — see the header.
 *
 * An indented bullet is the detail of the row above it rather than a row of its own.
 * That is what lets one line carry a summary and the evidence behind it without a
 * table: the row stays one line on a phone, and the detail opens when asked for.
 */
export function parseNavigatorState(md = '', now = new Date()) {
  const swept = SWEPT_RE.exec(md);
  const sweptAt = swept?.[1] ?? null;
  const summary = swept?.[2]?.trim() ?? null;
  const cadenceMin = Number(CADENCE_RE.exec(summary ?? md)?.[1] ?? 5);
  const ageMin = sweptAt ? ageMinutes(sweptAt, now) : null;
  // Three cadences, the threshold the file itself writes down.
  const stale = ageMin === null || ageMin > cadenceMin * 3;

  const sections = [];
  let current = null;
  for (const raw of md.split(/\r?\n/)) {
    const h = /^##\s+(.+)$/.exec(raw);
    if (h) {
      // Headings carry their own gloss after an em dash or a parenthesis; the tab is
      // narrow, so keep the name and drop the gloss.
      current = { title: h[1].replace(/\s+[—–-]\s+.*$/, '').replace(/\s*\(.*\)\s*$/, '').trim(), items: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const b = /^-\s+(.*)$/.exec(raw);
    if (b) {
      current.items.push({ ...parseItem(b[1]), details: [] });
      continue;
    }
    const sub = /^\s+-\s+(.*)$/.exec(raw);
    // A detail with no row above it is dropped rather than promoted: it would read
    // as a row, which is the one thing it is not.
    if (sub && current.items.length) current.items.at(-1).details.push(parseItem(sub[1]));
  }
  return { sweptAt, summary, cadenceMin, ageMin, stale, sections };
}
