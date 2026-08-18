// The Wire — what changed, and the half of it that happened since he last looked.
//
// Requirement: jwildfire/obot.roadmap#203, one information architecture rendered
// twice. The public hub has carried a wire since D0018; this dashboard has carried
// the same feed for just as long, two clicks down inside the Agents tab's full
// record, where a reader who knew the hub would never think to look for it. Same
// entity, same content, different address — which is exactly the re-learning cost
// the requirement exists to remove. So it gets its own tab, third of four, in the
// same position it holds on the hub.
//
// ## The one place the two surfaces are allowed to differ, and why
//
// This page can answer a question the public wire cannot, and the difference is
// the design break #203 records rather than papers over.
//
// The dashboard is served from his own machine and its request handler already
// sees every page request, so `last-seen` knows when he last opened this surface
// (#205). The hub is a static site with no server, and per-visitor tracking has no
// place on a public page even if there were one to do it with. So:
//
//   this page   what changed SINCE YOU LAST LOOKED — a real per-surface record
//   the hub     what changed RECENTLY — a fixed 7-day window, a property of the
//               page rather than a claim about the reader
//
// Same question, two honest answers at different depths. Both pages say so, in
// their own voice, and each names the other — a reader who finds one is told where
// the other answer lives, which is the whole "navigate the other without being
// told" property the requirement is after.
//
// ## Degrading honestly is the requirement, not a nicety
//
// #205's rule, inherited whole: a missing record, a restarted server or a clock
// that moved must produce "first look" or "unknown" — never a silently wrong
// window. So the marker is drawn only where a real prior timestamp falls, and when
// there is none the page says which of those it is and shows the whole feed. A
// confident "nothing new since you looked" computed from a guess is the failure
// this programme has paid for most, and it is worse than no marker at all, because
// it tells him not to look.
import { esc } from './esc.mjs';
import { feedHtml } from './metrics-view.mjs';

/** The same wording the header's phrase() uses, so one page cannot disagree with the other. */
function agoWords(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** How the marker reads for each way the record can be absent. */
const ABSENT = {
  first: 'This is the first time this page has recorded you opening it, so everything below is shown.',
  unknown: 'No visit record could be read on this machine, so this page is not claiming to know what is new — everything is shown.',
};

/**
 * Split day-grouped feed items into what is new since `sinceMs` and what is not.
 *
 * Groups are never re-ordered or merged: the split happens inside the day the
 * boundary falls in, so a day is a day on both surfaces. Items with no usable
 * timestamp go to the older side — an event that cannot prove it is new is not
 * new, which keeps the error in the direction that makes him look rather than the
 * direction that tells him not to.
 */
export function splitFeed(groups, sinceMs) {
  if (!Number.isFinite(sinceMs)) return { fresh: groups, older: [], count: null };
  const fresh = [];
  const older = [];
  let count = 0;
  for (const g of groups) {
    const newItems = [];
    const oldItems = [];
    for (const it of g.items) {
      const t = Number.isFinite(it.tsMs) ? it.tsMs : null;
      if (t !== null && t > sinceMs) { newItems.push(it); count += 1; } else oldItems.push(it);
    }
    if (newItems.length) fresh.push({ ...g, items: newItems });
    if (oldItems.length) older.push({ ...g, items: oldItems });
  }
  return { fresh, older, count };
}

/**
 * The Wire's body.
 *
 * @param groups  buildFeedModel output, newest first
 * @param look    the lastSeen record for THIS surface, read before it was updated
 */
export function wireHtml(groups, look) {
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  if (!total) {
    return `<h1 class="nav-h1">Wire</h1>
<p class="wire-lede">What changed, newest first — the delivery journal, the worker ledger, the job records and the GitHub sweep, as one stream.</p>
<p class="nav-empty">Nothing recorded yet. None of the four sources has produced an event on this machine, which is not the same as nothing having happened — it is this page saying it cannot see.</p>
${breakNote()}`;
  }

  // `lastSeen` reports {state, at (ISO), ageMs}; the boundary is that timestamp.
  // Only the 'seen' state carries one — 'first' and 'unknown' deliberately do not,
  // and substituting anything for a missing stamp is the thing #205 forbids.
  const sinceMs = look && look.state === 'seen' ? Date.parse(look.at) : NaN;
  const ago = look && Number.isFinite(look.ageMs) ? agoWords(look.ageMs) : null;
  const { fresh, older, count } = splitFeed(groups, sinceMs);

  // The headline is the answer to his actual question, and it is stated as a
  // measurement with its own basis attached rather than as a bare number.
  let head;
  if (!Number.isFinite(sinceMs)) {
    head = `<p class="wire-since wire-absent">${esc(ABSENT[look?.state === 'first' ? 'first' : 'unknown'])}</p>`;
  } else if (count === 0) {
    head = `<p class="wire-since">Nothing has changed since you last opened this page${ago ? ` (${esc(ago)})` : ''}. The record below is what came before that.</p>`;
  } else {
    head = `<p class="wire-since"><b>${count}</b> thing${count === 1 ? '' : 's'} changed since you last opened this page${ago ? ` (${esc(ago)})` : ''}.</p>`;
  }

  const freshBlock = fresh.length ? feedHtml(fresh) : '';
  const olderBlock = older.length
    ? `<details class="wire-older"${count === 0 ? ' open' : ''}>
  <summary>${count === 0 ? 'The record' : 'Before that'} — ${older.reduce((n, g) => n + g.items.length, 0)} earlier event${older.reduce((n, g) => n + g.items.length, 0) === 1 ? '' : 's'}</summary>
${feedHtml(older)}
</details>`
    : '';

  return `<h1 class="nav-h1">Wire</h1>
<p class="wire-lede">What changed, newest first — the delivery journal, the worker ledger, the job records and the GitHub sweep, as one stream.</p>
${head}
${freshBlock}
${olderBlock}
${breakNote()}`;
}

/**
 * The stated break, on the page rather than in a design document.
 *
 * #203 asked for this specifically: the asymmetry between the two surfaces is
 * legitimate and should be drawn, so that a reader who moves between them is never
 * left wondering which one is lying to them.
 */
export function breakNote() {
  return `<p class="wire-foot">This page answers <i>what changed since you last looked</i>, because it is served from
your own machine and its request handler records when you open each surface (<a href="https://github.com/jwildfire/obot.roadmap/issues/205" target="_blank" rel="noopener">#205</a>) — local only, never committed, never published.
The public <a href="https://jwildfire.github.io/obot.roadmap/wire.html" target="_blank" rel="noopener">hub wire</a> answers <i>what changed recently</i> against a fixed 7-day window instead:
it is a static site with no server, and per-visitor tracking has no place on a public page.
Same question, two honest answers at different depths — the one break in the symmetry between these two surfaces
(<a href="https://github.com/jwildfire/obot.roadmap/issues/203" target="_blank" rel="noopener">#203</a>).</p>`;
}

export const WIRE_CSS = `
  /* Wire — the what-changed tab. One column, same measure as the Navigator tab, so
     moving between tabs does not move the text under him. */
  .nav-h1 { font-size:1.05rem; margin:0 0 0.15rem; }
  .wire-lede { font-size:0.78rem; color:var(--muted); margin:0 0 0.6rem; line-height:1.45; }
  /* The answer to his question gets a box, because it is the one line on this page
     he may read and then close the tab. */
  .wire-since { font-size:0.86rem; margin:0 0 0.7rem; padding:0.4rem 0.6rem; border-radius:7px;
                background:var(--accent-soft); color:var(--ink); border:1px solid var(--accent);
                line-height:1.4; overflow-wrap:anywhere; }
  .wire-since b { font-size:1rem; }
  /* An absent record must not look like a measurement. */
  .wire-since.wire-absent { background:transparent; border-color:var(--line); color:var(--muted); font-style:italic; }
  .wire-older { margin:0.8rem 0 0; }
  .wire-older > summary { cursor:pointer; font-size:0.74rem; color:var(--muted); padding:0.2rem 0; }
  .wire-older > summary:hover { color:var(--ink); }
  .wire-foot { margin:1.2rem 0 0; padding-top:0.5rem; border-top:1px solid var(--line);
               font-size:0.7rem; color:var(--muted); line-height:1.5; overflow-wrap:anywhere; }
  .wire-foot a { color:var(--muted); }`;
