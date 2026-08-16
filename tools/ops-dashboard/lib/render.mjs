// The Operations Dashboard page.
//
// Layout is @jwildfire's, 2026-08-15: a persistent header, decision artifacts open
// in a main area, and a sidebar where he answers. The queue rail on the left is his
// todo list — release candidates, decisions, config — because that is the object the
// page is about.
//
// Density is his too, the same evening: "I like the sidebar, but make it much mroe
// compact." So a queue row is one line — an id chip and the title, nothing else. The
// kind is carried by the group heading and the coloured left edge rather than by a
// word above every row, the secondary line moved into the row's tooltip, and the
// explanatory paragraphs went from three to one. He reads this on a phone, so the
// budget is vertical pixels and each row now costs about a third of what it did.
//
// One page, no build step, no dependencies: the markup below is served as-is and the
// only script is the handful of lines that select a queue item and post an answer.
import { wakeText, DISMISS_MEANS } from './triage.mjs';
import { CRITICAL_BUDGET } from './rank.mjs';
import { parseNavigatorState } from './navigator.mjs';
import { phrase } from './last-seen.mjs';

/**
 * The long form of the header's last-look phrase, for the tooltip.
 *
 * Degradation is the point of this line, so each state says what it knows and
 * stops: "first look" is not "nothing changed", and "unknown" gives the reason
 * rather than a plausible-looking window (jwildfire/obot.roadmap#205).
 */
export function lastLookTitle(v) {
  if (!v || v.state === 'unknown') {
    return `When you last opened this page is unknown${v?.why ? ` — ${v.why}` : ''}. Nothing is being guessed in its place.`;
  }
  if (v.state === 'first') return 'No record of you opening this page before. This is the first look.';
  return `You last opened this page at ${new Date(v.at).toLocaleString()}. Recorded locally, never published.`;
}

export const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const KIND = {
  rc: { label: 'release candidate', tone: 'rc' },
  config: { label: 'config', tone: 'config' },
  decision: { label: 'decision', tone: 'decision' },
};

/**
 * The tab strip — the merged site's persistent header (@jwildfire, 2026-08-15: "I
 * want the ops db and orginal ops hub to be merged. just make them 2 different tabs
 * on the same (local) site for now. new ops db should be default view", and an hour
 * later "I think i almost certainly want a navigator tab").
 *
 * A list, not markup, because the surface grew twice in one evening: a fourth tab is
 * one entry here and a route in ops-dashboard.mjs, and nothing else moves.
 *
 * `/live.html` rather than a prettier path for the session tab: the status line builds
 * that exact URL from the served marker, so it stays the session view's address.
 */
export const TABS = [
  { id: 'ops', href: '/', label: 'Operations' },
  { id: 'session', href: '/live.html', label: 'Session' },
  { id: 'navigator', href: '/navigator', label: 'Navigator' },
];

export const tabs = (active) => `<nav class="tabs" aria-label="Views">
  ${TABS.map((t) => `<a href="${t.href}"${t.id === active ? ' aria-current="page"' : ''}>${t.label}</a>`).join('\n  ')}
</nav>`;

// The chip is a handle, never the explanation: `c0001` for a config item, `D0007` for
// a decision, `#52` for a release candidate. The sentence beside it is what he reads.
const chip = (it) => {
  if (it.id) return it.id;
  if (it.kind === 'rc') return `#${String(it.key || '').split('#')[1] ?? ''}`;
  return '';
};

const item = (it) => {
  const c = chip(it);
  // The critical claim rides with the row rather than in a legend: he judges
  // "is this really critical" by reading what it says is stuck behind it.
  const claim = it.critical && it.criticalClaim
    ? `<span class="q-claim">critical &middot; ${esc(it.criticalClaim)}</span>` : '';
  // An RC title carries no summary any more (@jwildfire, 2026-08-15), so the
  // sentence sits under it - the same second-line shape as a critical claim.
  const sub = it.sub ? `<span class="q-sub">${esc(it.sub)}</span>` : '';
  return `<li class="q ${KIND[it.kind]?.tone ?? ''}${it.critical ? ' crit' : ''}" data-kind="${esc(it.kind)}" data-key="${esc(it.key)}"${it.fingerprint ? ` data-fp="${esc(it.fingerprint)}"` : ''}${it.artifact ? ` data-artifact="${esc(it.artifact)}"` : ''}${it.url ? ` data-url="${esc(it.url)}"` : ''}${it.detail ? ` title="${esc(it.detail)}"` : ''}><span class="q-line">${c ? `<span class="q-id mono">${esc(c)}</span>` : ''}<span class="q-title">${esc(it.title)}</span></span>${sub}${claim}</li>`;
};

const group = (title, items, empty, moved = 0) => `<h2 class="q-h">${esc(title)} <span class="q-n">${items.length}</span>${
  moved ? `<span class="q-moved">${moved} pinned above</span>` : ''}</h2>
${items.length ? `<ul class="q-list">${items.map(item).join('')}</ul>` : `<p class="q-empty">${esc(empty)}</p>`}`;

const ageWords = (min) => {
  if (min === null || min === undefined || !Number.isFinite(min)) return null;
  if (min < 60) return `${Math.max(0, Math.round(min))}m old`;
  const h = min / 60;
  return h < 48 ? `${Math.round(h)}h old` : `${Math.round(h / 24)}d old`;
};

/**
 * What this page is made of: the commit it is running, and the commit its decisions
 * came from — printed whether or not either is stale.
 *
 * Printed on the healthy path deliberately. Twice on 2026-08-16 the running dashboard
 * was many merges behind `main` — eleven, the second time — with nothing on the page
 * saying so, and the hub clone it read decisions from was four commits behind
 * `origin/main`, which is why a decision @jwildfire made that morning was still listed
 * as awaiting him. A threshold would have caught neither: both were inside any sane
 * one, and what was missing was a sentence naming the snapshot next to the numbers.
 * Same reasoning as the audit-freshness line in tools/navigator/checks.mjs.
 *
 * The code half can only be reported — a process cannot reload its own modules, so a
 * stale build says "restart me" and names the command. The data half is already fixed
 * by the time this renders: the freshest committed hub state was read, and this says
 * which one that was.
 */
export const provenanceLine = ({ code = null, hub = null } = {}) => {
  const bits = [];
  let tone = 'ok';
  if (code?.unknown) { bits.push('code: which commit is running could not be read'); tone = 'warn'; }
  else if (code?.short) {
    const age = ageWords(code.ageMin);
    bits.push(code.behind
      ? `code: <code>${esc(code.short)}</code>${age ? `, ${esc(age)}` : ''} — ${code.behind} commit${code.behind === 1 ? '' : 's'} behind this checkout, restart to pick ${code.behind === 1 ? 'it' : 'them'} up`
      : `code: <code>${esc(code.short)}</code>${age ? `, ${esc(age)}` : ''}, current with this checkout`);
    if (code.behind) tone = 'warn';
  }
  if (hub?.warn) { bits.push(`decisions: ${esc(hub.warn)}`); tone = 'warn'; }
  else if (hub?.head) {
    bits.push(hub.source === 'clone'
      ? `decisions: <code>${esc(hub.head)}</code> from your hub clone${hub.dirty ? ', with uncommitted edits' : ''}`
      : `decisions: <code>${esc(hub.head)}</code> from <code>${esc(hub.source)}</code> — your clone is ${hub.behind} commit${hub.behind === 1 ? '' : 's'} behind it, so this page is ahead of it`);
  }
  if (!bits.length) return '';
  // Kill then relaunch, in that order and never overlapping: a second instance takes
  // the port after this one and steals the serve marker the status line reads,
  // deleting it when it exits (obot.agent#142).
  return `<p class="prov ${tone}">${bits.join(' &middot; ')}${
    code?.behind ? ` <span class="prov-fix"><code>${esc(RESTART_CMD)}</code>, then <code>/session-dashboard</code></span>` : ''}</p>`;
};

export const RESTART_CMD = "pkill -f 'ops-dashboard.mjs --serve'";

/**
 * The open pull requests that are ready but are *not* his — standard-lane work,
 * excluded from the release-candidate panel by the lane classifier.
 *
 * One line, naming them, because the alternative is a silent drop. Until 2026-08-16
 * these were listed as release candidates and one of the three on the page was an
 * ordinary feature PR into `dev`; removing them is the fix, and saying where they went
 * is what stops the fix from looking like a queue that lost something.
 */
export const foldedLane = (folded = []) => (folded.length
  ? `<p class="q-aside">${folded.length === 1 ? 'One decision was' : `${folded.length} decisions were`} folded into a later one and answered there: ${
    folded.map((f) => `${esc(f.id ?? f.key)} &rarr; ${esc(f.into ?? 'its successor')}`).join(', ')}.</p>`
  : '');

export const standardLane = (standard = []) => (standard.length
  ? `<p class="q-aside">${standard.length === 1 ? 'One other open PR is' : `${standard.length} other open PRs are`} on the standard lane, not yours to review: ${
    standard.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(String(s.key).replace(/^jwildfire\//, ''))}</a> &rarr; <code>${esc(s.base ?? '')}</code>`).join(', ')}.</p>`
  : '');

/**
 * Snoozed and cleared rows: on the page, collapsed.
 *
 * Nothing he acts on may vanish. A snooze he cannot see is a silent delete, and
 * a dismissal he cannot undo is the deletion the workspace rules forbid. Both
 * live in a `<details>`, so a long list costs one line of vertical space on a
 * phone until he opens it.
 */
const collapsed = (title, rows, describe) => (rows.length ? `<details class="q-fold">
<summary>${esc(title)} <span class="q-n">${rows.length}</span></summary>
<ul class="q-list">${rows.map((it) => `<li class="q ${KIND[it.kind]?.tone ?? ''} q-off" data-kind="${esc(it.kind)}" data-key="${esc(it.key)}"><span class="q-line"><span class="q-title">${esc(it.title)}</span></span><span class="q-claim">${esc(describe(it))} &middot; <button class="q-restore" data-key="${esc(it.key)}" data-kind="${esc(it.kind)}">restore</button></span></li>`).join('')}</ul>
</details>` : '');

// Palette, header and tab strip — shared by both tabs so the header is genuinely
// persistent: the same markup and the same styles whichever view is on screen.
const SHELL_CSS = `
  :root {
    --paper:#F4F1EC; --card:#FDFCFA; --ink:#26211B; --muted:#6F6558; --faint:#9C917F;
    --line:#E2DACC; --accent:#B4470E; --accent-soft:#F4E2D2; --good:#2F6B4F; --good-soft:#E2EFE7;
    --warn:#8A5A00; --warn-soft:#F6ECD8; --crit:#A8201A;
    --sans:"Instrument Sans","Avenir Next","Segoe UI",system-ui,sans-serif;
    --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
    --header:40px;
  }
  @media (prefers-color-scheme: dark) { :root {
    --paper:#1A1611; --card:#232019; --ink:#EAE4D8; --muted:#A69B89; --faint:#7E7462;
    --line:#383126; --accent:#E8843C; --accent-soft:#3C2A18; --good:#7FBF9B; --good-soft:#1E2E25;
    --warn:#D9A441; --warn-soft:#33280F; --crit:#F0736B;
  } }
  * { box-sizing:border-box; }
  html, body { height:100%; }
  body { margin:0; background:var(--paper); color:var(--ink); font-family:var(--sans); line-height:1.5; }
  a { color:var(--accent); }
  .mono { font-family:var(--mono); font-size:0.85em; }

  /* Persistent header — the same strip on both tabs, and the thing that stays put
     across everything below it. One row at 390px: brand, tabs, counts, all short. */
  header.top {
    position:sticky; top:0; z-index:10; min-height:var(--header);
    display:flex; align-items:center; gap:0.35rem 0.7rem; flex-wrap:wrap; padding:0.25rem 0.6rem;
    background:var(--card); border-bottom:1px solid var(--line);
  }
  header.top .brand { font-weight:600; letter-spacing:-0.01em; white-space:nowrap; font-size:0.85rem; }
  header.top .counts { display:flex; gap:0.3rem; flex-wrap:wrap; }
  .pill { font-size:0.7rem; padding:0.05rem 0.45rem; border-radius:99px; border:1px solid var(--line); white-space:nowrap; }
  .pill.rc { border-color:var(--accent); color:var(--accent); }
  .pill.config { border-color:var(--warn); color:var(--warn); }
  .pill.decision { border-color:var(--good); color:var(--good); }
  header.top .spacer { flex:1; }
  header.top .where { font-size:0.68rem; color:var(--faint); font-family:var(--mono); }
  /* The narrow header drops "local only · HH:MM" but never the last-look phrase:
     a signal about whether to look that is invisible in his usual window is the
     same as no signal at all (jwildfire/obot.agent#143). */
  @media (max-width:520px) { header.top .where .wide { display:none; } }

  .tabs { display:flex; gap:0.2rem; }
  .tabs a { font-size:0.75rem; padding:0.15rem 0.6rem; border-radius:99px; text-decoration:none;
            color:var(--muted); border:1px solid transparent; white-space:nowrap; }
  .tabs a:hover { border-color:var(--line); }
  .tabs a[aria-current="page"] { background:var(--accent-soft); color:var(--accent); border-color:var(--accent); }
`;

const DASHBOARD_CSS = `
  /* Sticky, not fixed: the header owns its height, so wrapped pills push the
     columns down instead of sitting on top of the first queue row. */
  .cols { display:grid; grid-template-columns:minmax(220px,18rem) 1fr minmax(240px,20rem);
          height:calc(100vh - var(--header)); }
  @media (max-width:900px) { .cols { grid-template-columns:1fr; height:auto; } }

  .rail, .side { overflow-y:auto; padding:0.6rem 0.7rem; }
  .rail { border-right:1px solid var(--line); }
  .side { border-left:1px solid var(--line); background:var(--card); }
  .main { overflow:hidden; display:flex; flex-direction:column; background:var(--card); }
  .main > iframe { flex:1; width:100%; border:0; min-height:70vh; }

  /* The release-candidate panel — his review order top to bottom: what it is, the ask,
     the notes, what it closes, then the demo running live. */
  .rc-panel { flex:1; overflow-y:auto; padding:1rem 1.1rem 1.4rem; }
  .rc-head { display:flex; align-items:baseline; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.35rem; }
  .rc-head h2 { font-size:1rem; margin:0; font-family:var(--mono); }
  .rc-checks { font-size:0.68rem; padding:0.05rem 0.4rem; border-radius:99px;
               background:var(--good-soft); color:var(--good); }
  .rc-checks.failing { background:var(--accent-soft); color:var(--accent); }
  .rc-checks.pending, .rc-checks.none { background:var(--warn-soft); color:var(--warn); }
  .rc-size { font-size:0.68rem; color:var(--faint); font-family:var(--mono); }
  .rc-summary { font-size:0.9rem; margin:0 0 0.5rem; max-width:64ch; }
  .rc-ask { font-size:0.82rem; margin:0 0 0.5rem; padding:0.3rem 0.5rem;
            background:var(--accent-soft); border-radius:5px; max-width:64ch; }
  .rc-links { font-size:0.8rem; margin:0 0 0.9rem; }
  .rc-panel h3 { font-size:0.78rem; text-transform:uppercase; letter-spacing:0.04em;
                 color:var(--muted); margin:0.9rem 0 0.35rem; }
  .rc-reqs { margin:0; padding-left:1.1rem; font-size:0.83rem; }
  .rc-reqs li { margin-bottom:0.15rem; }
  .rc-none { font-size:0.8rem; color:var(--muted); margin:0; }
  .rc-demo { width:100%; height:60vh; border:1px solid var(--line); border-radius:6px; background:var(--paper); }
  .main .placeholder { padding:1.2rem 1.1rem; color:var(--muted); max-width:52ch; }
  .main .placeholder h2 { font-size:1rem; margin:0 0 0.4rem; color:var(--ink); }
  .main .placeholder p { margin:0 0 0.5rem; font-size:0.85rem; }

  .q-h { font-size:0.66rem; letter-spacing:0.11em; text-transform:uppercase; color:var(--faint);
         font-weight:500; margin:0.85rem 0 0.3rem; display:flex; align-items:center; gap:0.4rem; }
  .q-h:first-child { margin-top:0; }
  .q-n { font-family:var(--mono); font-size:0.66rem; color:var(--muted); }
  .q-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.15rem; }
  /* One row, one line where the title allows it: an id chip and the sentence. */
  .q { border-left:3px solid var(--line); border-radius:0 5px 5px 0; padding:0.2rem 0.4rem;
       background:transparent; cursor:pointer; display:flex; align-items:baseline; gap:0.4rem;
       line-height:1.3; }
  .q:hover, .q:focus-visible { background:var(--card); }
  .q[aria-current="true"] { background:var(--accent-soft); }
  .q.rc { border-left-color:var(--accent); }
  .q.config { border-left-color:var(--warn); cursor:default; }
  .q.decision { border-left-color:var(--good); }
  .q-id { color:var(--faint); font-size:0.68rem; flex:none; }
  /* Two lines, hard. The titles say what he gets rather than naming a setting,
     which makes them longer — worth it in the panel, not worth an unbounded row
     in a list he scrolls on a phone. The full title is the panel's heading. */
  .q-title { font-size:0.82rem; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
             overflow:hidden; }
  /* An RC title carries no summary any more (@jwildfire, 2026-08-15), so the row runs to
     a second line under it. The .q row is already a column and .q-line already carries
     min-width:0, so this only has to be the line itself: one line, ellipsized, because
     he reads this list on a 390px phone. */
  .q-sub { font-size:0.72rem; color:var(--muted); line-height:1.25; min-width:0;
           overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .q-empty { font-size:0.76rem; color:var(--muted); margin:0 0 0.2rem; }
  /* Wraps rather than ellipsizes: it is one short line naming one or two PRs, and
     the point of it is that the refs stay readable at 390px. */
  .q-aside { font-size:0.7rem; color:var(--faint); margin:0.1rem 0 0.4rem; line-height:1.35; }
  /* What the page is made of. Above the queue, never hidden at any width: a
     staleness notice that disappears on a phone is the failure it warns about. */
  .prov { font-size:0.66rem; line-height:1.4; margin:0 0 0.6rem; color:var(--faint);
          border-left:2px solid var(--line); padding:0.15rem 0 0.15rem 0.45rem; }
  .prov.warn { color:var(--muted); border-left-color:var(--crit); }
  .prov code { font-family:var(--mono); font-size:0.95em; }
  .prov-fix { display:block; margin-top:0.15rem; }
  .q-aside a { color:var(--muted); }
  .q-aside code { font-family:var(--mono); font-size:0.92em; }
  .q-line { display:flex; align-items:baseline; gap:0.4rem; min-width:0; }
  .q-moved { font-size:0.62rem; color:var(--faint); text-transform:none; letter-spacing:0; }

  /* Critical: a red edge and the claim under the title. Only ever three rows,
     so the second line costs at most three lines of the phone's budget. */
  .q { flex-direction:column; align-items:stretch; gap:0; }
  .q.crit { border-left-color:var(--crit); }
  .q-claim { font-size:0.66rem; color:var(--muted); font-family:var(--mono); }
  .q.crit .q-claim { color:var(--crit); }
  .q-fold { margin-top:0.9rem; border-top:1px solid var(--line); padding-top:0.4rem; }
  .q-fold summary { font-size:0.66rem; letter-spacing:0.11em; text-transform:uppercase;
                    color:var(--faint); cursor:pointer; }
  .q-off { cursor:default; }
  .q-off .q-title { color:var(--muted); }
  .q-restore { font-size:0.66rem; padding:0 0.25rem; border:1px solid var(--line); border-radius:5px;
               background:var(--paper); color:var(--accent); cursor:pointer; font-family:var(--mono); }
  .overbudget { font-size:0.7rem; color:var(--warn); border:1px solid var(--warn); border-radius:6px;
                padding:0.2rem 0.4rem; margin:0 0 0.5rem; }

  /* The installation qualification, in the main pane. */
  .iq { padding:0.9rem 1rem; overflow-y:auto; max-width:60rem; }
  .iq h2 { font-size:1rem; margin:0 0 0.1rem; }
  .iq .iq-meta { font-size:0.7rem; color:var(--faint); font-family:var(--mono); margin:0 0 0.8rem; }
  .iq-f { margin:0 0 0.7rem; }
  .iq-f > .lab { font-size:0.62rem; letter-spacing:0.11em; text-transform:uppercase; color:var(--faint);
                 display:block; margin-bottom:0.1rem; }
  .iq-f p { margin:0; font-size:0.86rem; }
  /* Wrapped, not scrolled: on a phone a horizontal scrollbar inside a code block
     hides the half of the command he has not discovered yet. Wrapping is purely
     visual — the copy button hands over the exact text either way. */
  .iq-f pre { margin:0.3rem 0 0; padding:0.45rem 0.55rem; background:var(--paper); border:1px solid var(--line);
              border-radius:7px; font-family:var(--mono); font-size:0.74rem; overflow-x:auto;
              white-space:pre-wrap; word-break:break-word; }
  .iq-f .copy { font-size:0.66rem; padding:0.1rem 0.4rem; border:1px solid var(--line); border-radius:5px;
                background:var(--card); color:var(--accent); cursor:pointer; margin-left:0.35rem; }
  .iq-check { display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap; margin-top:0.35rem; }
  .iq-check button { font-size:0.76rem; padding:0.25rem 0.6rem; border-radius:7px; border:1px solid var(--accent);
                     background:var(--accent-soft); color:var(--accent); cursor:pointer; }
  .iq-check button[disabled] { opacity:0.5; cursor:not-allowed; border-color:var(--line); color:var(--muted);
                               background:var(--paper); }
  .iq-res { font-size:0.76rem; font-family:var(--mono); }
  .iq-res.pass { color:var(--good); }
  .iq-res.fail { color:var(--crit); }
  .iq-res.refused { color:var(--warn); }
  .iq-warn { font-size:0.72rem; color:var(--warn); margin:0.5rem 0 0; }

  /* Triage: one bar, in the sidebar, for whatever is selected. */
  .triage { border-top:1px solid var(--line); margin-top:0.7rem; padding-top:0.5rem; }
  .triage .row { display:flex; gap:0.25rem; flex-wrap:wrap; }
  .triage button { flex:1 1 auto; font-size:0.72rem; padding:0.25rem 0.3rem; border-radius:7px;
                   border:1px solid var(--line); background:var(--paper); color:var(--ink); cursor:pointer; }
  .triage button[disabled] { opacity:0.4; cursor:not-allowed; }
  .triage .means { font-size:0.68rem; color:var(--muted); margin:0.3rem 0 0; }
  .snooze-menu { display:flex; gap:0.25rem; flex-wrap:wrap; margin-top:0.25rem; }
  .snooze-menu button { font-size:0.68rem; }

  .side h2 { font-size:0.85rem; margin:0 0 0.15rem; }
  .side .hint { font-size:0.74rem; color:var(--muted); margin:0 0 0.6rem; }
  .adopt { width:100%; padding:0.5rem; font-size:0.88rem; font-weight:600; border-radius:8px;
           border:1.5px solid var(--good); background:var(--good-soft); color:var(--ink); cursor:pointer; }
  .adopt:hover { filter:brightness(1.04); }
  .verdicts { display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:0.25rem; margin:0.4rem 0; }
  .verdicts button { padding:0.3rem 0.2rem; font-size:0.74rem; border-radius:7px; border:1px solid var(--line);
                     background:var(--paper); color:var(--ink); cursor:pointer; }
  .verdicts button[aria-pressed="true"] { border-color:var(--accent); background:var(--accent-soft); }
  textarea { width:100%; min-height:5.5rem; padding:0.45rem; border-radius:8px; border:1px solid var(--line);
             background:var(--paper); color:var(--ink); font:inherit; font-size:0.82rem; resize:vertical; }
  .send { width:100%; margin-top:0.35rem; padding:0.45rem; border-radius:8px; border:1px solid var(--accent);
          background:var(--accent); color:#fff; font-weight:600; cursor:pointer; }
  .send[disabled] { opacity:0.45; cursor:not-allowed; }
  .note { font-size:0.7rem; color:var(--muted); margin:0.45rem 0 0; }
  .qq { border:1px solid var(--line); border-radius:7px; padding:0.35rem 0.45rem; margin:0.35rem 0; }
  .qq p { margin:0 0 0.25rem; font-size:0.8rem; }
  .qq .code { font-family:var(--mono); font-size:0.62rem; color:var(--faint); letter-spacing:0.06em; }
  .qq .row { display:flex; gap:0.2rem; flex-wrap:wrap; }
  .qq button { flex:1 1 auto; font-size:0.68rem; padding:0.2rem 0.3rem; border-radius:6px;
               border:1px solid var(--line); background:var(--paper); color:var(--ink); cursor:pointer; }
  .qq button[aria-pressed="true"] { border-color:var(--accent); background:var(--accent-soft); }
  .answers { margin-top:0.9rem; border-top:1px solid var(--line); padding-top:0.5rem; }
  .answers li { font-size:0.72rem; color:var(--muted); margin:0.15rem 0; list-style:none; }
  .ok { color:var(--good); font-size:0.78rem; margin:0.35rem 0 0; }

  /* Where his answers are. One row per decision — three clicks on the same one
     is one answer with a history, not three rows — and each row says which of
     the three states it is in, because "did it land?" is the question the page
     failed to answer on 2026-08-15. */
  .ans-list { list-style:none; margin:0; padding:0; }
  .ans { font-size:0.74rem; margin:0.3rem 0; padding-left:0.45rem; border-left:3px solid var(--line); }
  .ans[data-status="captured"] { border-left-color:var(--warn); }
  .ans[data-status="delivered"] { border-left-color:var(--accent); }
  .ans[data-status="applied"] { border-left-color:var(--good); }
  .ans .ans-head { display:flex; gap:0.35rem; align-items:baseline; flex-wrap:wrap; }
  .ans .ans-id { font-family:var(--mono); font-size:0.68rem; color:var(--faint); }
  .ans .ans-v { font-weight:600; }
  .ans .ans-st { display:block; color:var(--muted); }
  .ans .ans-hist { display:block; color:var(--faint); font-size:0.68rem; }
  .alarm { border:1px solid var(--accent); background:var(--accent-soft); border-radius:7px;
           padding:0.35rem 0.45rem; margin:0.4rem 0; font-size:0.72rem; }
  .alarm code { font-family:var(--mono); font-size:0.66rem; }
`;

/**
 * The session tab: the agent roster first, then the session hub's own live view.
 *
 * The roster is @jwildfire's ask of 2026-08-16 — "a list of all agents along with
 * thier ID, status, cost and the impact they had on the roadmap"
 * (jwildfire/obot.roadmap#199) — and it arrives here as markdown, parsed by the
 * same reader the Navigator tab uses. No table code: a table is the wrong object at
 * 390px, where he reads this, and a bullet that opens into its evidence is the
 * right one.
 *
 * The live view below it stays an iframe because that view is generated by a
 * different tool on its own watch loop — wrapping it means the merge costs neither
 * generator a line of layout, and nothing in it can be lost in translation.
 */
export function sessionShell({ frame = '/session/frame', missing = null, roster = null } = {}) {
  const sections = roster ? parseNavigatorState(roster).sections : [];
  const live = missing
    ? `<p class="missing">No session view yet — start the watch loop:<br><code>${esc(missing)}</code></p>`
    : `<iframe class="frame" title="Session hub" src="${esc(frame)}"></iframe>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Session · obot</title>
<style>${SHELL_CSS}${NAV_CSS}
  body { display:flex; flex-direction:column; }
  iframe.frame { flex:1; width:100%; border:0; min-height:22rem; }
  .missing { padding:1.2rem; color:var(--muted); font-size:0.85rem; }
  .missing code { font-family:var(--mono); font-size:0.78rem; }
  /* With a roster above it the page scrolls, so the frame takes a share of the
     viewport rather than the leftovers — on a phone "the leftovers" is nothing. */
  body.has-roster { display:block; }
  body.has-roster iframe.frame { height:70vh; border-top:1px solid var(--line); display:block; }
</style>
</head>
<body${sections.length ? ' class="has-roster"' : ''}>
<header class="top">
  <span class="brand">🍊😺 obot</span>
  ${tabs('session')}
  <span class="spacer"></span>
  <span class="where">local only</span>
</header>
${sections.length ? `<div class="nav-wrap">
${sectionsHtml(sections)}
<h2 class="nav-h">Live session view</h2>
</div>` : ''}
${live}
</body>
</html>`;
}

const NAV_CSS = `
  .nav-wrap { padding:0.7rem 0.8rem; max-width:60rem; }
  .dead { border:1px solid var(--accent); background:var(--accent-soft); color:var(--ink);
          border-radius:8px; padding:0.5rem 0.6rem; margin:0 0 0.7rem; font-size:0.82rem; }
  .dead code { font-family:var(--mono); font-size:0.74rem; }
  .swept { font-size:0.72rem; color:var(--faint); font-family:var(--mono); margin:0 0 0.7rem; }
  .nav-h { font-size:0.66rem; letter-spacing:0.11em; text-transform:uppercase; color:var(--faint);
           font-weight:500; margin:0.9rem 0 0.3rem; }
  .nav-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.15rem; }
  .nav-list li { border-left:3px solid var(--line); padding:0.2rem 0.4rem; font-size:0.82rem; line-height:1.3; }
  .nav-list li a { text-decoration:none; }
  .nav-list .at { color:var(--faint); font-family:var(--mono); font-size:0.68rem; }
  .nav-empty { font-size:0.76rem; color:var(--muted); margin:0; }

  /* A row that carries its own evidence. Closed it costs one line, which is the
     budget on a 390px screen; open it lists what the claim rests on. */
  .nav-list li details > summary { cursor:pointer; }
  .nav-list li details[open] > summary { color:var(--ink); }
  .nav-sub { list-style:none; margin:0.2rem 0 0.35rem; padding:0; display:flex; flex-direction:column; gap:0.1rem; }
  .nav-sub li { border-left:2px solid var(--line); padding:0.05rem 0.45rem; font-size:0.72rem;
                color:var(--muted); line-height:1.35; }
  /* A reference, a URL or a long agent name must wrap rather than push the page
     sideways — 390px is a gate here, not a nicety. */
  .nav-list li, .nav-sub li, .nav-list summary { overflow-wrap:anywhere; }
`;

/**
 * The Navigator tab: what the 🧭🤖 sweep has seen, rendered from the file it writes.
 *
 * Every section in that file renders, including ones this code has never heard of —
 * the seam for the per-agent ledger, which needs a data source that does not exist
 * yet (GitHub attributes every agent's work to one bot identity).
 *
 * A dead observer leads with a banner and the restart command. Presenting a stale
 * sweep as current is the one failure mode that matters here: it is the surface he
 * would trust to tell him a review had landed.
 */
/** One bullet: its link, its text, and the verification stamp as small print. */
const navItem = (it) => `${it.url
  ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.text)}</a>`
  : esc(it.text)}${it.verified ? ` <span class="at">${esc(it.verified)}</span>` : ''}`;

/**
 * A section, as both tabs render it. A row carrying details becomes a disclosure —
 * the summary is the claim, the list inside it is the evidence — so a roster row can
 * say "1 requirement moved, 3 closed or merged" on one line and still hand over
 * every issue number behind it.
 */
export const sectionsHtml = (sections = []) => sections.map((s) => `<h2 class="nav-h">${esc(s.title)}</h2>
${s.items.length
    ? `<ul class="nav-list">${s.items.map((it) => ((it.details ?? []).length
      ? `<li><details><summary>${navItem(it)}</summary><ul class="nav-sub">${
        it.details.map((d) => `<li>${navItem(d)}</li>`).join('')}</ul></details></li>`
      : `<li>${navItem(it)}</li>`)).join('')}</ul>`
    : '<p class="nav-empty">Nothing.</p>'}`).join('\n');

export function navigatorShell({ state = null, missing = null } = {}) {
  const body = missing || !state
    ? `<p class="nav-empty">No sweep file yet — <code>${esc(missing ?? 'navigator-state.md')}</code>. The Navigator writes it every five minutes: <code>launchctl kickstart -k gui/$UID/com.obot.navigator-sweep</code>.</p>`
    : `${state.stale
      ? `<p class="dead"><strong>The observer is dead</strong> — last swept ${esc(state.sweptAt ?? 'never')}${state.ageMin === null ? '' : ` (${state.ageMin} min ago, cadence ${state.cadenceMin}m)`}. What follows is <strong>not current</strong>. Restart: <code>launchctl kickstart -k gui/$UID/com.obot.navigator-sweep</code></p>`
      : `<p class="swept">swept ${esc(state.sweptAt)}${state.summary ? ` · ${esc(state.summary)}` : ''}</p>`}
${sectionsHtml(state.sections)}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Navigator · obot</title>
<style>${SHELL_CSS}${NAV_CSS}
</style>
</head>
<body>
<header class="top">
  <span class="brand">🍊😺 obot</span>
  ${tabs('navigator')}
  <span class="spacer"></span>
  <span class="where">local only</span>
</header>
<div class="nav-wrap">
${body}
</div>
</body>
</html>`;
}

/**
 * What the page says when nothing is listening for his answers.
 *
 * Shared with the server so the sentence he reads after clicking and the sentence
 * on the row are the same sentence. This is the failure the program keeps paying
 * for in other forms — green CI over a stale evidence baseline, a widget
 * rendering a pre-fix calculation for three weeks — so a hand-off with no
 * consumer has to look like a problem, not like success.
 */
export const NOT_LISTENING = 'Nothing is listening: the Navigator sweep is not running, so no agent will pick this up. Restart it with launchctl kickstart -k gui/$UID/com.obot.navigator-sweep';

const AGO = (at, now) => {
  const min = Math.max(0, Math.round((now.getTime() - Date.parse(at)) / 60000));
  if (!Number.isFinite(min)) return '';
  return min < 60 ? `${min}m ago` : `${Math.floor(min / 60)}h ago`;
};

const VERDICT = {
  'adopt-all': 'adopt all',
  'words-only': 'in your words',
  'per-question': 'question by question',
};

/**
 * One answer, with where it is in the pipeline. The three states are his three
 * questions: did the machine take it (captured), did anything see it (delivered),
 * did the artifact change (applied — and here is the link, go look).
 */
const answerRow = (a, now) => {
  const state = {
    captured: 'the Navigator picks it up within five minutes',
    delivered: 'an agent has it; the artifact updates next',
    applied: 'the artifact was updated',
  }[a.status] ?? a.status;
  const when = a.status === 'applied' ? (a.appliedAt ?? a.at) : a.at;
  const evidence = a.status === 'applied' && a.evidence
    ? ` — <a href="${esc(a.evidence)}" target="_blank" rel="noopener">see it</a>`
    : '';
  const history = (a.supersedes ?? []).length
    ? `<span class="ans-hist">replaced an earlier answer${(a.clicks ?? 1) > 1 ? `, clicked ${a.clicks} times` : ''}</span>`
    : ((a.clicks ?? 1) > 1 ? `<span class="ans-hist">clicked ${a.clicks} times — one answer</span>` : '');
  return `<li class="ans" data-status="${esc(a.status)}">
      <span class="ans-head"><span class="ans-id mono">${esc(a.decisionId ?? a.artifact ?? '')}</span><span class="ans-v">${esc(VERDICT[a.verdict] ?? a.verdict ?? '')}</span></span>
      <span class="ans-st">${esc(a.status)} ${esc(AGO(when, now))} · ${state}${evidence}</span>
      ${history}
    </li>`;
};

const answersPanel = (answers, deliverer, now) => {
  const waiting = answers.filter((a) => a.status === 'captured');
  const alarm = waiting.length && !deliverer?.alive
    ? `<p class="alarm"><strong>${waiting.length} answer${waiting.length === 1 ? '' : 's'} of yours ${waiting.length === 1 ? 'is' : 'are'} going nowhere.</strong>
      Nothing is listening — the Navigator sweep is not running${deliverer?.sweptAt ? ` (last swept ${esc(deliverer.sweptAt)})` : ''}, so no agent will pick ${waiting.length === 1 ? 'it' : 'them'} up.<br>
      <code>launchctl kickstart -k gui/$UID/com.obot.navigator-sweep</code></p>`
    : '';
  return `<div class="answers">
      <h2>Your answers <span class="q-n">${answers.length}</span></h2>
      ${alarm}
      <ul class="ans-list">${answers.length
    ? answers.map((a) => answerRow(a, now)).join('')
    : '<li class="q-empty">Nothing recorded yet. Answer a decision and it appears here with its state.</li>'}</ul>
    </div>`;
};

export function render({ queue, answers = [], deliverer = null, provenance = null, lastLook = null, workspace, hub, generated = new Date() }) {
  const critical = queue.critical ?? [];
  const snoozed = queue.snoozed ?? [];
  const cleared = queue.cleared ?? [];
  // The header pills count what is actually waiting on him, pinned rows
  // included — the critical section moves rows between sections, and a count
  // that moved with them would make the queue look shorter than it is.
  const counts = {
    rc: queue.rcs.items.length + critical.filter((i) => i.kind === 'rc').length,
    config: queue.config.items.length + critical.filter((i) => i.kind === 'config').length,
    decision: queue.decisions.items.length + critical.filter((i) => i.kind === 'decision').length,
  };
  const total = counts.rc + counts.config + counts.decision;

  // Everything the page needs to show an item without another round trip: the
  // installation qualification for config rows, and how a check may be run.
  const iqs = Object.fromEntries([...critical, ...queue.config.items]
    .filter((it) => it.kind === 'config' && it.iq)
    .map((it) => [it.key, {
      id: it.id, title: it.title, filed: it.date, verified: it.verified,
      complete: it.complete ?? null,
      claim: it.criticalClaim ?? null,
      fields: ['do', 'expect', 'verify', 'unblocks', 'blocks', 'source', 'why']
        .map((f) => (it.iq[f] ? { name: f, text: it.iq[f].text, code: it.iq[f].code ?? [] } : null))
        .filter(Boolean),
      verify: { command: it.iq.verify?.command ?? null, expect: it.iq.verify?.expect ?? null, manual: Boolean(it.iq.verify?.manual) },
      check: it.check ?? null,
    }]));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Operations Dashboard · obot</title>
<style>${SHELL_CSS}${DASHBOARD_CSS}
</style>
</head>
<body>

<header class="top">
  <span class="brand">🍊😺 Operations</span>
  ${tabs('ops')}
  <span class="counts">
    <span class="pill rc">${counts.rc} release candidate${counts.rc === 1 ? '' : 's'}</span>
    <span class="pill decision">${counts.decision} decision${counts.decision === 1 ? '' : 's'}</span>
    <span class="pill config">${counts.config} config</span>
  </span>
  <span class="spacer"></span>
  <span class="where" title="${esc(lastLookTitle(lastLook))}"><span class="wide">local only · ${esc(generated.toTimeString().slice(0, 5))} · </span>${esc(phrase(lastLook))}</span>
</header>

<div class="cols">

  <nav class="rail" aria-label="Your queue">
    ${provenanceLine(provenance ?? {})}
    ${total === 0 ? '<p class="q-empty">Nothing is waiting on you.</p>' : ''}
    ${critical.length ? group('Critical', critical, '') : ''}
    ${queue.overBudget ? `<p class="overbudget">${queue.overBudget} more item${queue.overBudget === 1 ? '' : 's'} claim${queue.overBudget === 1 ? 's' : ''} critical. The tag is capped at ${CRITICAL_BUDGET} so it keeps meaning something — the rest are at the top of their own sections.</p>` : ''}
    ${group('Release candidates', queue.rcs.items, queue.rcs.refreshing ? 'Sweeping GitHub…' : 'None waiting.', queue.rcs.moved)}
    ${standardLane(queue.rcs.standard)}
    ${group('Decisions', queue.decisions.items, 'All answered.', queue.decisions.moved)}
    ${foldedLane(queue.decisions.folded)}
    ${group('Config', queue.config.items, 'Nothing needs your keyboard.', queue.config.moved)}
    ${queue.decisions.error ? `<p class="q-empty">Decisions unavailable: ${esc(queue.decisions.error)}</p>` : ''}
    ${collapsed('Snoozed', snoozed, (it) => wakeText(it.triage))}
    ${collapsed('Cleared', cleared, (it) => (it.triage?.action === 'done' ? 'marked done' : 'dismissed'))}
  </nav>

  <main class="main" id="main">
    <div class="placeholder" id="placeholder">
      <h2>Your todo list, and where you answer it.</h2>
      <p>Pick anything on the left: a <strong>decision</strong> opens here and you answer it in the sidebar, a <strong>release candidate</strong> opens here too — summary, release notes, what it closes, and its demo page running live, with approval still a deliberate click on GitHub — and a <strong>config</strong> item opens as an installation qualification: the exact step, what you should see, and a check that proves it. Local, never published.</p>
    </div>
  </main>

  <aside class="side" id="side">
    <h2 id="side-title">Nothing selected</h2>
    <p class="hint" id="side-hint">Pick a decision to answer it.</p>
    <div id="answer" hidden>
      <button class="adopt" id="adopt">Adopt all recommendations</button>
      <div id="questions"></div>
      <div class="verdicts">
        <button data-v="approve" aria-pressed="false">Approve</button>
        <button data-v="reject" aria-pressed="false">Reject</button>
        <button data-v="defer" aria-pressed="false">Defer</button>
        <button data-v="more" aria-pressed="false">Ask for more</button>
      </div>
      <textarea id="words" placeholder="In your words — quoted verbatim in the artifact's Decisions section."></textarea>
      <button class="send" id="send" disabled>Record this decision</button>
      <p class="note">Your click is recorded on this machine, handed to an agent by the Navigator within five minutes, and applied to the artifact — you can watch all three below.</p>
      <p class="ok" id="ok" hidden></p>
    </div>
    <div class="triage" id="triage" hidden>
      <div class="row">
        <button id="tri-done" hidden>Done</button>
        <button id="tri-snooze">Snooze</button>
        <button id="tri-dismiss">Dismiss</button>
      </div>
      <div class="snooze-menu" id="snooze-menu" hidden>
        <button data-snooze="1d">a day</button>
        <button data-snooze="1w">a week</button>
        <button data-snooze="change">until it changes</button>
      </div>
      <p class="means" id="tri-means"></p>
    </div>
    ${answersPanel(answers, deliverer, generated)}
  </aside>

</div>

<script id="questions-data" type="application/json">${
  JSON.stringify(Object.fromEntries([...critical, ...queue.decisions.items]
    .filter((d) => d.kind === 'decision').map((d) => [d.artifact, d.questions ?? []])))
    .replace(/</g, '\\u003c')
}</script>
<script id="iq-data" type="application/json">${
  JSON.stringify(iqs).replace(/</g, '\\u003c')
}</script>
<script id="dismiss-data" type="application/json">${
  JSON.stringify(DISMISS_MEANS).replace(/</g, '\\u003c')
}</script>
<script id="rc-data" type="application/json">${
  JSON.stringify(Object.fromEntries(queue.rcs.items.map((r) => [r.key, {
    title: r.title, url: r.url, sub: r.sub ?? null, checks: r.checks ?? null,
    size: r.size ?? null, repo: r.repo ?? null, ...(r.rc ?? {}),
  }]))).replace(/</g, '\\u003c')
}</script>
<script>
  const QUESTIONS = JSON.parse(document.getElementById('questions-data').textContent);
  const IQ = JSON.parse(document.getElementById('iq-data').textContent);
  const DISMISS = JSON.parse(document.getElementById('dismiss-data').textContent);
  const RCS = JSON.parse(document.getElementById('rc-data').textContent);
  const state = { item: null, verdict: null, perQuestion: {} };
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  const LABEL = { do: 'Do', expect: 'Expect', verify: 'Verify', unblocks: 'Unblocks', blocks: 'Blocks', source: 'Source', why: 'Why' };

  // The installation qualification, rendered where he can act on it: the exact
  // step, what he should see, and a check that leaves a real pass/fail behind.
  // Text and code are kept apart on purpose — the code is what he pastes, and a
  // copy button beats selecting wrapped text on a phone.
  function renderIQ(key) {
    const iq = IQ[key];
    $('placeholder').hidden = true;
    document.querySelectorAll('#main iframe, #main .iq').forEach((n) => n.remove());
    if (!iq) return;
    const box = el('div', 'iq');
    const h = el('h2', null, iq.title);
    box.appendChild(h);
    const meta = el('p', 'iq-meta', [iq.id, iq.filed ? 'filed ' + iq.filed : null, iq.verified ? 'verified ' + iq.verified : null].filter(Boolean).join(' · '));
    box.appendChild(meta);
    if (iq.claim) { const c = el('p', 'iq-res fail', 'critical · ' + iq.claim); box.appendChild(c); }

    for (const f of iq.fields) {
      const wrap = el('div', 'iq-f');
      wrap.appendChild(el('span', 'lab', LABEL[f.name] || f.name));
      if (f.text) wrap.appendChild(el('p', null, f.text));
      if (f.code && f.code.length) {
        const pre = el('pre', null, f.code.join('\\n'));
        wrap.appendChild(pre);
        wrap.appendChild(copyBtn(f.code.join('\\n')));
      }
      if (f.name === 'verify') wrap.appendChild(checkRow(key, iq));
      box.appendChild(wrap);
    }
    if (iq.complete && iq.complete.ok === false) {
      box.appendChild(el('p', 'iq-warn', 'This entry is missing ' + iq.complete.missing.join(' and ') + ' — it was filed before the list became an installation qualification.'));
    }
    $('main').appendChild(box);
  }

  function copyBtn(text) {
    const b = el('button', 'copy', 'copy');
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); b.textContent = 'copied'; }
      catch { b.textContent = 'select it'; }
      setTimeout(() => { b.textContent = 'copy'; }, 1500);
    });
    return b;
  }

  // Running the proof. A read-only command runs here on a click and the result
  // is recorded; anything else is his to run, and says so rather than pretending
  // the button is broken.
  function checkRow(key, iq) {
    const row = el('div', 'iq-check');
    if (iq.verify.command) row.appendChild(copyBtn(iq.verify.command));
    const btn = el('button', null, 'Check');
    const out = el('span', 'iq-res');
    if (iq.check) { out.textContent = iq.check.result + ' · ' + (iq.check.at || '').slice(11, 16); out.classList.add(iq.check.result); }
    btn.addEventListener('click', async () => {
      btn.disabled = true; out.className = 'iq-res'; out.textContent = 'running…';
      const r = await fetch('/check', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: key, id: iq.id, command: iq.verify.command, expect: iq.verify.expect }) });
      const j = await r.json().catch(() => ({}));
      btn.disabled = false;
      out.classList.add(j.result || 'refused');
      // A failure has to say what was expected. "exit 1" tells him nothing he
      // can act on; "printed 0, expected 2" tells him the edit did not land.
      out.textContent = j.result === 'pass' ? 'PASS — ' + (j.stdout || 'exit 0')
        : j.result === 'fail'
          ? 'FAIL — ' + (j.stdout ? 'printed ' + j.stdout : 'exit ' + j.exitCode)
            + (iq.verify.expect ? ', expected ' + iq.verify.expect.replace(/^prints /, '') : '')
          : (j.why || 'could not run');
      if (j.result === 'pass') $('tri-done').hidden = false;
    });
    if (iq.verify.manual || !iq.verify.command) {
      btn.disabled = true;
      row.appendChild(btn);
      row.appendChild(el('span', 'iq-res refused', 'manual — nothing here can be scripted'));
    } else {
      row.appendChild(btn);
      row.appendChild(out);
    }
    return row;
  }

  function select(li) {
    document.querySelectorAll('.q').forEach((n) => n.setAttribute('aria-current', String(n === li)));
    const kind = li.dataset.kind;
    state.item = { kind, key: li.dataset.key, artifact: li.dataset.artifact || null };
    state.verdict = null;
    state.perQuestion = {};
    document.querySelectorAll('.verdicts button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    renderQuestions(li.dataset.artifact);
    $('ok').hidden = true;
    $('side-title').textContent = li.querySelector('.q-title').textContent;

    // Triage is available on every kind, because he asked to be able to clear
    // or defer anything in the list — not only the config half of it.
    state.item.fingerprint = li.dataset.fp || null;
    $('triage').hidden = false;
    $('snooze-menu').hidden = true;
    $('tri-done').hidden = kind !== 'config';
    $('tri-means').textContent = DISMISS[kind] || '';

    if (kind === 'decision') {
      $('placeholder').hidden = true;
      document.querySelectorAll('#main .iq').forEach((n) => n.remove());
      // The RC panel owns an iframe of its own inside #main, so it goes before the
      // artifact frame is looked up by selector.
      const panel = $('rc-panel'); if (panel) panel.remove();
      let f = document.querySelector('#main > iframe');
      if (!f) { f = document.createElement('iframe'); f.title = 'Decision artifact'; $('main').appendChild(f); }
      f.src = '/artifact/' + encodeURIComponent(li.dataset.artifact) + '/';
      $('answer').hidden = false;
      $('side-hint').textContent = 'Adopt all is one click. Otherwise pick a verdict and say why.';
    } else if (kind === 'rc') {
      $('answer').hidden = true;
      document.querySelectorAll('#main .iq').forEach((n) => n.remove());
      renderRC(li.dataset.key);
      $('side-hint').textContent = 'Skim it here, then approve on GitHub — the RC gate stays a deliberate click.';
    } else if (kind === 'config') {
      $('answer').hidden = true;
      const panel = $('rc-panel'); if (panel) panel.remove();
      renderIQ(li.dataset.key);
      $('side-hint').textContent = 'Only your keyboard can apply this one. Run the check when you have.';
    } else {
      $('answer').hidden = true;
      document.querySelectorAll('#main .iq').forEach((n) => n.remove());
      const panel = $('rc-panel'); if (panel) panel.remove();
      $('side-hint').textContent = 'Nothing to show for this one.';
    }
  }

  // The release-candidate panel. @jwildfire asked for the PR itself in an iframe;
  // github.com answers x-frame-options: deny, so that renders blank permanently and
  // no amount of trying changes it. This is the native version, and it is the better
  // one: it opens instantly from the cache (so it works with the network down), it
  // matches the dashboard instead of dropping a foreign page into the middle of it,
  // and it shows his review order — skim the summary, read the demo, read the notes —
  // without the GitHub chrome around it. The demo page *is* framed live: Pages sets no
  // frame headers. Approving stays on GitHub, deliberately.
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function renderRC(key) {
    const rc = RCS[key];
    const main = $('main');
    $('placeholder').hidden = true;
    const old = main.querySelector(':scope > iframe'); if (old) old.remove();
    let box = $('rc-panel');
    if (!box) { box = document.createElement('div'); box.id = 'rc-panel'; box.className = 'rc-panel'; main.appendChild(box); }
    if (!rc) { box.innerHTML = '<p class="rc-none">No detail cached for this one yet — open it on GitHub.</p>'; return; }

    const checks = rc.checks
      ? '<span class="rc-checks ' + esc(rc.checks.state) + '">' + ({
          green: 'checks green', failing: rc.checks.failing + ' failing', pending: rc.checks.pending + ' running', none: 'no checks',
        }[rc.checks.state] || 'checks') + '</span>'
      : '';

    const reqs = (rc.requirements || []).length
      ? '<h3>Requirements this release closes</h3><ul class="rc-reqs">' + rc.requirements.map((r) =>
          '<li><a href="' + esc(rcIssueUrl(rc.repo, r.ref)) + '" target="_blank" rel="noopener">' + esc(r.ref) + '</a> ' + esc(r.text) + '</li>').join('') + '</ul>'
      : '<h3>Requirements this release closes</h3><p class="rc-none">None named in the body — the RC body contract wants a <code>Closes #N</code> line per issue shipped.</p>';

    const demo = rc.demo && rc.frameable
      ? '<h3>The demo</h3><iframe class="rc-demo" src="' + esc(rc.demo) + '" title="Release demo" loading="lazy"></iframe>'
      : rc.demo
        ? '<h3>The demo</h3><p class="rc-none"><a href="' + esc(rc.demo) + '" target="_blank" rel="noopener">Open the demo</a> — it is not on the Pages site, so it cannot be shown inline.</p>'
        : '<h3>The demo</h3><p class="rc-none">No demo link in the body. A PR without a working demo is not an RC.</p>';

    box.innerHTML =
      '<div class="rc-head"><h2>' + esc(rc.title) + '</h2>' + checks +
        (rc.size ? '<span class="rc-size">' + esc(rc.size) + '</span>' : '') + '</div>' +
      (rc.sub || rc.summary ? '<p class="rc-summary">' + esc(rc.summary || rc.sub) + '</p>' : '') +
      (rc.ask ? '<p class="rc-ask"><strong>The ask:</strong> ' + esc(rc.ask) + '</p>' : '') +
      '<p class="rc-links">' + (rc.news ? '<a href="' + esc(rc.news) + '" target="_blank" rel="noopener">Release notes (NEWS.md)</a>' : '<span class="rc-none">No NEWS.md link — the contract requires one.</span>') +
        ' · <a href="' + esc(rc.url) + '" target="_blank" rel="noopener">Open on GitHub to approve</a></p>' +
      reqs + demo;
  }

  const rcIssueUrl = (repo, ref) => repo ? 'https://github.com/' + repo + '/issues/' + String(ref).replace('#', '') : '#';

  // ---- triage -------------------------------------------------------------
  // Every action posts to the local server and the row leaves the list. Nothing
  // is deleted anywhere: the server appends to a ledger, and the row reappears
  // under Snoozed or Cleared with a way back.
  async function postTriage(body) {
    const r = await fetch('/triage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) location.reload();
    else { const j = await r.json().catch(() => ({})); $('tri-means').textContent = 'Could not record: ' + (j.error || r.status); }
  }

  $('tri-dismiss').addEventListener('click', () => {
    if (state.item) postTriage({ ...state.item, action: 'dismiss' });
  });
  $('tri-done').addEventListener('click', () => {
    if (state.item) postTriage({ ...state.item, action: 'done' });
  });
  $('tri-snooze').addEventListener('click', () => { $('snooze-menu').hidden = !$('snooze-menu').hidden; });
  document.querySelectorAll('#snooze-menu button').forEach((b) => b.addEventListener('click', () => {
    if (!state.item) return;
    const pick = b.dataset.snooze;
    const day = 86400000;
    // Every snooze carries a change-watch as well as its date, so an item that
    // moves under the snooze comes back on its own.
    postTriage({
      ...state.item, action: 'snooze', wakeOnChange: true,
      until: pick === 'change' ? null : new Date(Date.now() + (pick === '1d' ? day : 7 * day)).toISOString(),
    });
  }));
  document.querySelectorAll('.q-restore').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    postTriage({ key: b.dataset.key, kind: b.dataset.kind, action: 'restore' });
  }));

  // The question text is the explanation; the id is only a handle. A row that
  // reads as a bare code has failed, so the sentence comes first and the code is
  // small print under it.
  function renderQuestions(artifact) {
    const box = document.getElementById('questions');
    const qs = (artifact && QUESTIONS[artifact]) || [];
    box.innerHTML = qs.map((q) => (
      '<div class="qq" data-q="' + q.id + '">' +
      '<p>' + q.question + '</p><span class="code">' + q.id + (q.code ? ' &middot; ' + q.code : '') + '</span>' +
      '<div class="row">' + ['approve', 'reject', 'defer', 'more']
        .map((v) => '<button data-v="' + v + '" aria-pressed="false">' + (v === 'more' ? 'more' : v) + '</button>').join('') +
      '</div></div>'
    )).join('');
    box.querySelectorAll('.qq').forEach((row) => row.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      state.perQuestion[row.dataset.q] = b.dataset.v;
      row.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      document.getElementById('send').disabled = false;
    })));
  }

  document.querySelectorAll('.q:not(.q-off)').forEach((li) => li.addEventListener('click', () => select(li)));

  document.querySelectorAll('.verdicts button').forEach((b) => b.addEventListener('click', () => {
    state.verdict = b.dataset.v;
    document.querySelectorAll('.verdicts button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    $('send').disabled = false;
  }));

  $('words').addEventListener('input', () => { $('send').disabled = !(state.verdict || $('words').value.trim()); });

  // What a click did, said on the page. He clicked three times on 2026-08-15 and
  // then asked twice whether it had landed, because the page named a state with
  // no consumer and said nothing else — so the reply now names the decision, the
  // state it is in, and what happens next, and a repeat click says so.
  async function post(body) {
    const r = await fetch('/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    const ok = $('ok');
    ok.hidden = false;
    if (!r.ok) {
      ok.style.color = 'var(--accent)';
      ok.textContent = 'Not recorded — ' + (j.error || r.status) + '. Nothing was saved; try again.';
      return;
    }
    const name = j.decisionId || body.artifact || 'this decision';
    ok.style.color = j.warning ? 'var(--accent)' : 'var(--good)';
    ok.textContent = (j.duplicate
      ? 'Same answer as the one already recorded for ' + name + ' — still one decision, not two. '
      : 'Recorded as ' + name + '. ')
      + (j.warning || j.next);
    // The row appears in its real state, with its real handle.
    const li = document.createElement('li');
    li.className = 'ans';
    li.dataset.status = j.status || 'captured';
    li.innerHTML = '<span class="ans-head"><span class="ans-id mono"></span><span class="ans-v"></span></span>'
      + '<span class="ans-st"></span>';
    li.querySelector('.ans-id').textContent = name;
    li.querySelector('.ans-v').textContent = body.verdict || 'answered';
    li.querySelector('.ans-st').textContent = j.duplicate
      ? 'already recorded — refresh to see its state'
      : 'captured just now — the Navigator picks it up within five minutes';
    if (!j.duplicate) document.querySelector('.ans-list').prepend(li);
  }

  $('adopt').addEventListener('click', () => {
    if (!state.item) return;
    post({ artifact: state.item.artifact, verdict: 'adopt-all', words: $('words').value, questions: {} });
  });
  $('send').addEventListener('click', () => {
    if (!state.item) return;
    // Never call prose "per-question": on 2026-08-15 that mislabel was written to
    // disk with an empty questions map, which is the record that held his actual
    // reasoning. The verdict now describes what he did.
    const answered = Object.keys(state.perQuestion).length > 0;
    const verdict = state.verdict || (answered ? 'per-question' : ($('words').value.trim() ? 'words-only' : null));
    post({ artifact: state.item.artifact, verdict, words: $('words').value, questions: state.perQuestion });
  });
</script>
</body>
</html>`;
}
