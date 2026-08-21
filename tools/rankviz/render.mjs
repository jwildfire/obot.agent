// The page: the ranked head and the bench as cards, and one day of re-ranking you can
// watch move.
//
// @jwildfire, 2026-08-21: "I'd like you to make me a page visualizing the high priority
// and top 10 requirements with cards. include an option to animate how it has changed
// over time."
//
// ONE POPULATION, TWO TIERS. There is no `high priority` label. He asked for one on
// 2026-08-19 and then said "Let's just make a 'top10' label for those requirements",
// and the second replaced the first. So this page renders `top10` — the ranked head —
// and `on-deck` — the bench — and invents no third tier.
//
// THE HONESTY THIS PAGE IS BUILT AGAINST. The ranked order goes back to one commit on
// 2026-08-20 at 12:39. A page that animates that behind a month-shaped axis would be
// this program's defining defect in a new format, so: the true span is stated in the
// masthead and drawn to scale on a rail that stops where the record stops; the scrubber
// steps by COMMIT and says it is not a time axis; a frame that cannot be rebuilt from
// its commit prints its own reason instead of an interpolated order; and the membership
// record, which does reach back further, is drawn as a separate rail and labelled with
// where it came from.
//
// THE STYLESHEET IS BORROWED, NOT COPIED. `assets/obot.css` carries the palette, the
// type and the components (obot.agent#15); everything in the local block below is
// layout, which that sheet deliberately does not set. No colour is written here as a
// literal, and none is defined only inside a theme block.
import { OBOT_CSS } from '../../assets/obot-css.mjs'

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** An instant, in the zone the record was written in. Never "now" for something absent. */
export function fmt(iso, tz = 'America/New_York', { time = true } = {}) {
  if (!iso) return 'not known'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'not known'
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {})
  const date = `${p.year}-${p.month}-${p.day}`
  return time ? `${date} ${p.hour}:${p.minute}` : date
}

/** The zone's short name on that date, so the page never prints a bare wall-clock time. */
export const tzName = (iso, tz) => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date(iso || Date.now())).find((p) => p.type === 'timeZoneName')?.value ?? tz
  } catch { return tz }
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A duration in the words a reader uses, from two instants. */
export function reach(fromIso, toIso) {
  if (!fromIso || !toIso) return null
  const mins = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60000)
  if (!Number.isFinite(mins) || mins < 0) return null
  if (mins < 60) return plural(mins, 'minute')
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 48) return m ? `${plural(h, 'hour')} ${plural(m, 'minute')}` : plural(h, 'hour')
  return plural(Math.round(h / 24), 'day')
}

/**
 * The sentence the whole page hangs on.
 *
 * It says how far back the order actually goes, in days, because "six frames" sounds
 * like a lot and "one day" is the fact. Both records are named, because they start on
 * different days and only one of them is the ranking.
 */
export function spanSentence(data) {
  const h = data.history
  const m = data.membership
  if (!h.read) return `The order's history could not be read: ${h.why}`
  if (!h.span.frames) return 'No commit in this checkout has ever touched the rank store, so there is no history to show.'
  const days = h.span.days === 1 ? 'one day' : plural(h.span.days, 'day')
  const window = reach(h.span.from, h.span.to)
  const order = `Ranked order exists from ${fmt(h.span.from, data.tz)} — ${plural(h.span.frames, 'commit')} across ${days}${window ? `, a window of ${window}` : ''}.`
  const mem = m?.read && m.span?.from
    ? ` Membership reaches further back, to ${fmt(m.span.from, data.tz)}, from the label events on the issues themselves${m.span.complete ? '' : ' — and that fetch was truncated, so it starts where the reading stopped'}.`
    : ''
  return `${order}${mem} There is nothing before that: neither record existed.`
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

const stateChip = (r) => {
  if (!r.present) return '<span class="chip bad">not returned by GitHub</span>'
  const bits = []
  bits.push(r.state === 'closed'
    ? '<span class="chip bad">closed</span>'
    : `<span class="chip ok">${esc(r.state ?? 'state unknown')}</span>`)
  if (r.blocked) bits.push('<span class="chip warn">blocked</span>')
  if (r.milestone) bits.push(`<span class="chip">${esc(r.milestone)}</span>`)
  // A 0/0 is an issue with no sub-issues, not progress worth a chip.
  if (r.sub && r.sub.total > 0) bits.push(`<span class="chip">${r.sub.completed}/${r.sub.total} sub-issues</span>`)
  return bits.join('')
}

const titleOf = (r) => (r.present
  ? esc(String(r.title ?? '').replace(/^Requirement:\s*/, '')) || `#${r.issue}`
  : 'title not returned by GitHub this reading')

const headCard = (r, data) => `
<article class="card rankcard${r.present && r.state === 'closed' ? ' is-closed' : ''}">
  <div class="rankcol"><span class="rank">${r.rank}</span></div>
  <div class="cardbody">
    <div class="chips">${stateChip(r)}</div>
    <h3><a href="${esc(r.url || `https://github.com/${data.repo}/issues/${r.issue}`)}">#${r.issue} ${titleOf(r)}</a></h3>
    <p class="why">${esc(r.why || 'no reason is recorded for this rank')}</p>
    ${r.review ? `<div class="review"><span class="k">under review</span><p>${esc(r.review)}</p></div>` : ''}
  </div>
</article>`

const benchCard = (r, data) => `
<article class="card benchcard">
  <div class="chips"><span class="chip mute">on the bench</span>${stateChip(r)}</div>
  <h3><a href="${esc(r.url || `https://github.com/${data.repo}/issues/${r.issue}`)}">#${r.issue} ${titleOf(r)}</a></h3>
</article>`

// ---------------------------------------------------------------------------
// The rails — the only thing on this page drawn to scale, and both stop where their
// record stops.
// ---------------------------------------------------------------------------

// `noteHtml` is trusted markup: every call site builds it from escaped parts, so the
// note can carry a <code> span without the rail second-guessing it.
function rail(points, fromIso, toIso, data, { label, noteHtml }) {
  if (!fromIso || !toIso || !points.length) {
    return `<div class="rail-empty">${noteHtml || 'nothing to draw'}</div>`
  }
  const a = Date.parse(fromIso)
  const b = Date.parse(toIso)
  const span = Math.max(1, b - a)
  const dots = points.map((p) => {
    const pct = ((Date.parse(p.iso) - a) / span) * 100
    return `<span class="dot" style="left:${Math.min(100, Math.max(0, pct)).toFixed(3)}%" title="${esc(p.title)}"></span>`
  }).join('')
  return `
<div class="rail" role="img" aria-label="${esc(label)}">
  <div class="railline">${dots}</div>
  <div class="railends"><span>${esc(fmt(fromIso, data.tz))}</span><span>${esc(fmt(toIso, data.tz))}</span></div>
  <p class="railnote">${noteHtml}</p>
</div>`
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const DESCRIPTION = 'The ten requirements ranked next and the eleven waiting behind them, '
  + 'each with the one line saying why it sits there — and a player that replays every '
  + 're-rank of the single day the order has existed.'

export function renderPage(data) {
  const h = data.history
  const zone = tzName(h.span?.from || data.generatedAt, data.tz)
  const headRows = data.order.rows ?? []
  // The bench is the `on-deck` label on GitHub and nothing else — unlike the ranked ten,
  // which are declared locally in `rank/top10.json` and are readable with no network at
  // all. So with no reading its length is not a count of anything, and "0 on the bench"
  // sat in the same strip as "state read not known" (jwildfire/obot.roadmap#223).
  const benchRows = data.bench.rows ?? []
  const holes = h.read ? h.frames.filter((f) => !f.reconstructed) : []

  const blob = JSON.stringify({
    tz: data.tz,
    repo: data.repo,
    zone,
    history: h,
    issues: data.issues ?? {},
  }).replace(/</g, '\\u003c')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The ranked head — the next ten and the bench</title>
<meta name="description" content="${esc(DESCRIPTION)}">
<style>
${OBOT_CSS}
${LAYOUT_CSS}
</style>
</head>
<body>
<div class="wrap">

<header class="mast">
  <div class="eyebrow">
    <span>obot roadmap</span><span class="dot"></span><span>the ranked head</span>
    <span class="dot"></span><span>${esc(data.repo)}</span>
  </div>
  <h1>The next ten, and the eleven on the bench</h1>
  <p class="lede">Two tiers of one population. The <code>top10</code> label says which ten come next and
  <code>rank/top10.json</code> says in what order; the <code>on-deck</code> label is the shelf a slot is
  filled from, and it is deliberately unranked. Every other thing on these cards — the title, whether
  it is still open, its milestone, how far its sub-issues have got — is read from GitHub rather than
  written down anywhere.</p>
  <div class="facts">
    <span><b>${headRows.length}</b> ranked</span>
    <span><b>${data.live.read ? benchRows.length : '&mdash;'}</b> on the bench</span>
    <span>order last touched <b>${esc(fmt(data.order.touched?.iso, data.tz))}</b>${data.order.touched?.dirty ? ' (edited since, not committed)' : ''}</span>
    <span>state read <b>${esc(fmt(data.live.at, data.tz))}</b></span>
    <span>all times ${esc(zone)}</span>
  </div>
</header>

<section class="callout note" id="depth">
  <span class="k">how deep this record goes</span>
  <p>${esc(spanSentence(data))}</p>
  ${rail(
    (h.frames || []).map((f) => ({ iso: f.iso, title: `${f.short} — ${f.subject}` })),
    h.span?.from, h.span?.to, data,
    {
      label: 'when each re-rank commit happened, drawn to scale',
      noteHtml: 'Every re-rank there has ever been, drawn to scale between the first commit and the last. '
        + 'The rail stops at the last commit because the record does.',
    },
  )}
  ${data.membership?.read && data.membership.span?.from ? rail(
    (data.membership.states || []).map((s) => ({ iso: s.iso, title: `${s.events} label changes` })),
    data.membership.span.from, data.membership.span.to, data,
    {
      label: 'when membership was changed by label, drawn to the same kind of scale',
      noteHtml: `The other record: ${plural(data.membership.span.events, 'label change')} on the `
        + `<code>${esc(data.label)}</code> and <code>${esc(data.benchLabel)}</code> labels, grouped into `
        + `${plural((data.membership.states || []).length, 'act')} of labelling. It starts earlier than the `
        + `order does and carries no ranking &mdash; a label cannot hold one.`,
    },
  ) : ''}
  ${holes.length ? `<p class="hole">${holes.length} of ${h.frames.length} frames could not be rebuilt from its commit. Each one says so where it sits, and the transitions across it are left blank rather than filled in.</p>` : ''}
  ${!data.live.read ? `<p class="hole">GitHub was not read for this build: ${esc(data.live.why)}. Every derived field below is missing rather than wrong, and the cards say so one by one.</p>` : ''}
  ${!data.order.read ? `<p class="hole">The order itself could not be read: ${esc(data.order.why)}</p>` : ''}
</section>

${data.findings?.length ? `<section class="findings">
  ${data.findings.map((f) => `<div class="callout"><span class="k">${esc(f.kind.replace(/-/g, ' '))}</span><p>${esc(f.text)}</p></div>`).join('')}
</section>` : ''}

<div class="cut"><span>the ranked head</span></div>
<section>
  <p class="secnote">Ten, in order, each with the one line <code>rank/top10.json</code> gives for why it sits there.
  Where a row carries a review note, that is the ranking flagging its own uncertainty; it is shown rather than hidden.</p>
  <div class="grid">
    ${headRows.map((r) => headCard(r, data)).join('')}
  </div>
</section>

<div class="cut"><span>the bench</span></div>
<section>
  <p class="secnote">${esc(data.boundary || 'The bench is what a slot is filled from.')}
  These cards carry no rank on purpose: the bench is <b>unranked</b>, and ordering it on screen would
  invent a decision nobody has made.</p>
  <div class="grid bench">
    ${benchRows.map((r) => benchCard(r, data)).join('')}
  </div>
</section>

<div class="cut"><span>how it moved</span></div>
<section>
  <p class="secnote">Every change to the order is a commit against one file, so the file's history is the
  whole record of how the ranking has moved. The player below replays it. It is a step per commit —
  <b>not a time axis</b>; the rail at the top of this page is the one thing drawn to scale.</p>

  <details class="player" data-autoplay="off" id="player">
    <summary>Watch how it moved — ${plural(h.frames?.length || 0, 'frame')}, ${h.span?.days === 1 ? 'one day' : plural(h.span?.days || 0, 'day')}</summary>
    <div class="playerbody">
      <div class="pbar">
        <button type="button" id="pf-prev" aria-label="previous commit">◀</button>
        <button type="button" id="pf-play" aria-label="play">▶ play</button>
        <button type="button" id="pf-next" aria-label="next commit">▶</button>
        <input type="range" id="pf-scrub" min="1" max="${Math.max(1, h.frames?.length || 1)}" value="${Math.max(1, h.frames?.length || 1)}" aria-label="commit">
        <span class="pcount" id="pf-count"></span>
      </div>
      <div class="phead">
        <div class="ptime" id="pf-time"></div>
        <div class="psubject" id="pf-subject"></div>
        <div class="psha" id="pf-sha"></div>
      </div>
      <div class="pnote" id="pf-note" hidden></div>
      <ol class="plist" id="pf-list"></ol>
      <div class="pleft" id="pf-left" hidden></div>
      <details class="pwhy" id="pf-whywrap"><summary>the commit's own reasoning</summary><pre class="pre" id="pf-why"></pre></details>
      <p class="plegend"><span class="mv up">▲</span> rose &nbsp; <span class="mv down">▼</span> fell &nbsp;
      <span class="mv new">new</span> entered the head &nbsp; <span class="mv back">back</span> returned after leaving</p>
    </div>
  </details>

  ${h.reversals?.length ? `<div class="callout note reversals">
    <span class="k">reversals</span>
    <p>An order that only ever moved one way would be a ranking nobody was arguing with. These are the
    items that left the head and came back:</p>
    <ul>
      ${h.reversals.map((r) => `<li><b>#${r.issue}</b> left at <code>${esc(r.leftAt.short)}</code>
        (${esc(fmt(r.leftAt.iso, data.tz))}, &ldquo;${esc(r.leftAt.subject)}&rdquo;) and came back at rank
        ${r.rankOnReturn} at <code>${esc(r.returnedAt.short)}</code> (${esc(fmt(r.returnedAt.iso, data.tz))},
        &ldquo;${esc(r.returnedAt.subject)}&rdquo;)${reach(r.leftAt.iso, r.returnedAt.iso) ? ` — ${esc(reach(r.leftAt.iso, r.returnedAt.iso))} later` : ''}.</li>`).join('')}
    </ul>
    ${h.unseenInReversals ? `<p>${h.unseenInReversals} of ${h.frames.length} frames could not be read, so this search had a hole in it and may have missed a return across that hole.</p>` : ''}
  </div>` : ''}

  <h3>The commits behind the player</h3>
  <p class="secnote">The same record, without needing the player to read it.</p>
  <ol class="commits">
    ${(h.frames || []).map((f) => `<li>
      <div class="ctime">${esc(fmt(f.iso, data.tz))} &middot; <code>${esc(f.short)}</code></div>
      <div class="csubject">${esc(f.subject)}</div>
      ${f.reconstructed
    ? `<div class="corder">${f.order.map((r, i) => `<span class="ci">${i + 1}. #${r.issue}</span>`).join('')}</div>`
    : `<div class="cbroken">This frame could not be rebuilt: ${esc(f.why)}. Nothing is shown in its place, and what changed at it is left blank.</div>`}
    </li>`).join('')}
  </ol>
</section>

${data.membership?.read && data.membership.states?.length ? `
<div class="cut"><span>membership, the other record</span></div>
<section>
  <p class="secnote">The label carries membership and the file carries order — two mechanisms, so they can
  disagree, and every disagreement is reported rather than quietly resolved. This is what the labels
  themselves record, read from GitHub's issue events${data.membership.span.complete ? '' : ' (truncated — see above)'}.
  Each row is one act of labelling: changes made within five minutes of each other are one decision,
  not eleven.</p>
  <ol class="acts">
    ${data.membership.states.map((s) => `<li>
      <div class="atime">${esc(fmt(s.iso, data.tz))}</div>
      <div class="achanges">${s.changes.length
    ? s.changes.map((c) => `<span class="chg ${c.action === 'labeled' ? 'add' : 'rm'}">${c.action === 'labeled' ? '+' : '−'}#${c.issue} <em>${esc(c.label)}</em></span>`).join('')
    : '<span class="chg none">no net change</span>'}</div>
      <div class="acount">${(s.sets[data.label] || []).length} on <code>${esc(data.label)}</code> &middot; ${(s.sets[data.benchLabel] || []).length} on <code>${esc(data.benchLabel)}</code></div>
    </li>`).join('')}
  </ol>
</section>` : ''}

<div class="cut"><span>where every number came from</span></div>
<section class="method">
  <ul>
    <li><b>The order and the one-line reason</b> — <code>rank/top10.json</code> in
      <a href="https://github.com/jwildfire/obot.agent">jwildfire/obot.agent</a>, the single declared store.
      It holds an order and a reason and nothing else, by test.</li>
    <li><b>Membership</b> — the <code>${esc(data.label)}</code> and <code>${esc(data.benchLabel)}</code> labels on
      ${esc(data.repo)}, one API call each.</li>
    <li><b>Title, state, milestone, sub-issue progress, blocked</b> — derived from GitHub at build time,
      read ${esc(fmt(data.live.at, data.tz))}. None of it is written into this page by hand, and a field
      GitHub did not answer for is printed as unanswered rather than left blank.</li>
    <li><b>The history</b> — every commit that has touched <code>rank/top10.json</code>, with the store's
      bytes at that commit asked for directly rather than replayed from a patch. A commit whose store
      will not parse produces a frame that prints its reason; nothing is filled in for it.</li>
    <li><b>The membership timeline</b> — GitHub's <code>labeled</code> and <code>unlabeled</code> issue events
      for the two labels${data.membership?.pages ? `, ${plural(data.membership.pages, 'page')} of them` : ''}.
      This is the only part of this page that reaches back past the store's first commit.</li>
    <li><b>Two clocks, never merged</b> — how old the order is comes from the commit that last touched the
      file, never the file's timestamp, which a fresh clone stamps with the moment it was written. How old
      the state beside it is comes from when GitHub last answered.</li>
  </ul>
</section>

<footer class="foot">
  <p>Generated ${esc(fmt(data.generatedAt, data.tz))} ${esc(zone)} by <code>tools/rankviz/build.mjs</code> in
  jwildfire/obot.agent. Regenerating it re-reads GitHub and re-walks the commits; nothing on this page is
  hand-maintained. Built for
  <a href="https://github.com/jwildfire/obot.roadmap/issues/297">requirement #297</a>; the mechanism it reads
  is <a href="https://github.com/jwildfire/obot.roadmap/issues/278">#278</a>.</p>
  <hr>
  <p>Drafted by 👯🤖 W0101 (Claude Code, Opus 5).</p>
</footer>

</div>
<script type="application/json" id="rankviz-data">${blob}</script>
<script>${PLAYER_JS}</script>
</body>
</html>
`
}

// ---------------------------------------------------------------------------

const LAYOUT_CSS = `
/* Layout only. The sheet above owns every colour, and nothing here invents one. */
.grid {
  display:grid; gap:14px; margin:18px 0 0;
  grid-template-columns:repeat(auto-fill, minmax(min(300px,100%), 1fr));
}
.card { margin:0; }
.rankcard { display:grid; grid-template-columns:34px 1fr; gap:12px; align-items:start; }
.rankcard.is-closed { opacity:.72; }
.rank { font:700 21px/1 var(--mono); color:var(--bronze); display:block; padding-top:2px; }
.cardbody { min-width:0; }
.card h3 { margin:8px 0 0; overflow-wrap:anywhere; }
.card h3 a { border-bottom:none; }
.card h3 a:hover { border-bottom:1px solid var(--link-rule); }
.why { margin:8px 0 0; font-size:14.5px; color:var(--ink2); max-width:none; }
.chips { display:flex; flex-wrap:wrap; gap:6px; }
.chip {
  font:600 10px/1.7 var(--mono); letter-spacing:.08em; text-transform:uppercase;
  color:var(--mute); background:var(--code-bg); border:1px solid var(--rule);
  border-radius:var(--radius-sm); padding:1px 6px;
}
.chip.ok { color:var(--go); }
.chip.bad { color:var(--flag); }
.chip.warn { color:var(--bronze); }
.chip.mute { color:var(--mute); }
.review { margin:10px 0 0; padding:9px 12px; border-left:3px solid var(--bronze); background:var(--bronze-soft); }
.review .k { font:600 9.5px/1 var(--mono); letter-spacing:.12em; text-transform:uppercase; color:var(--bronze); }
.review p { margin:6px 0 0; font-size:14px; color:var(--ink2); max-width:none; }
.benchcard { border-style:dashed; }
.benchcard h3 { font-size:15px; }
.secnote { margin:14px 0 0; color:var(--ink2); font-size:15.5px; }
.hole { margin:12px 0 0; color:var(--flag); font-size:14.5px; }

/* The rails: the only thing here drawn to scale. */
.rail { margin:16px 0 0; }
.railline {
  position:relative; height:3px; margin:14px 0 0;
  background:var(--rule); border-radius:2px;
}
.railline .dot {
  position:absolute; top:-4px; width:11px; height:11px; margin-left:-5.5px;
  border-radius:50%; background:var(--bronze); border:2px solid var(--panel);
}
.railends {
  display:flex; justify-content:space-between; gap:10px; margin:9px 0 0;
  font:500 11.5px/1.4 var(--mono); color:var(--mute);
}
.railnote { margin:8px 0 0; font-size:13.5px; color:var(--mute); max-width:none; }
.rail-empty { margin:14px 0 0; font-size:13.5px; color:var(--mute); }

/* The player. Closed by default: he lands on today and chooses to watch it move. */
.player { margin:20px 0 0; border:1px solid var(--rule2); border-radius:var(--radius); background:var(--panel); }
.player > summary {
  cursor:pointer; padding:14px 16px; font:600 14px/1.3 var(--display); color:var(--ink);
  list-style:none;
}
.player > summary::-webkit-details-marker { display:none; }
.player > summary::before { content:"▶ "; color:var(--bronze); font-size:11px; }
.player[open] > summary::before { content:"▼ "; }
.player[open] > summary { border-bottom:1px solid var(--rule); }
.playerbody { padding:14px 16px 18px; }
.pbar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.pbar button {
  font:600 12px/1 var(--mono); color:var(--ink2); background:var(--code-bg);
  border:1px solid var(--rule2); border-radius:var(--radius-sm); padding:7px 10px; cursor:pointer;
}
.pbar button:hover { border-color:var(--blue); color:var(--blue); }
.pbar input[type=range] { flex:1 1 120px; min-width:100px; accent-color:var(--bronze); }
.pcount { font:600 11.5px/1 var(--mono); color:var(--mute); }
.phead { margin:14px 0 0; }
.ptime { font:600 11.5px/1 var(--mono); color:var(--bronze); letter-spacing:.06em; }
.psubject { margin:6px 0 0; font:700 16px/1.3 var(--display); overflow-wrap:anywhere; }
.psha { margin:5px 0 0; font:500 11.5px/1 var(--mono); color:var(--mute); }
.pnote {
  margin:14px 0 0; padding:11px 13px; border-left:3px solid var(--flag);
  background:var(--flag-soft); color:var(--ink2); font-size:14px;
}
.plist { list-style:none; margin:16px 0 0; padding:0; max-width:none; }
.plist li {
  display:grid; grid-template-columns:26px 1fr auto; gap:10px; align-items:center;
  padding:8px 10px; margin:5px 0; border:1px solid var(--rule);
  border-radius:var(--radius-sm); background:var(--paper); will-change:transform;
}
.plist .pr { font:700 14px/1 var(--mono); color:var(--bronze); }
.plist .pt { font-size:13.5px; min-width:0; overflow-wrap:anywhere; }
.plist .pt a { border-bottom:none; }
.plist .pt .n { font-family:var(--mono); font-size:12.5px; color:var(--mute); }
.mv { font:600 10px/1.6 var(--mono); letter-spacing:.08em; text-transform:uppercase; padding:1px 6px; border-radius:var(--radius-sm); }
.mv.up { color:var(--go); background:var(--go-soft); }
.mv.down { color:var(--bronze); background:var(--bronze-soft); }
.mv.new { color:var(--blue); background:var(--blue-soft); }
.mv.back { color:var(--flag); background:var(--flag-soft); }
.mv.hold { color:var(--mute); background:var(--code-bg); }
.pleft { margin:12px 0 0; font-size:13.5px; color:var(--ink2); }
.pleft .mv { margin-right:6px; }
.pwhy { margin:14px 0 0; }
.pwhy > summary { cursor:pointer; font:600 12px/1 var(--mono); color:var(--mute); letter-spacing:.06em; }
.pwhy .pre { white-space:pre-wrap; max-height:340px; overflow:auto; }
.plegend { margin:14px 0 0; font-size:12.5px; color:var(--mute); max-width:none; }

.reversals ul { margin:10px 0 0; font-size:14.5px; }
.commits { margin:16px 0 0; padding-left:20px; max-width:none; }
.commits li { margin:14px 0; }
.ctime { font:600 11.5px/1 var(--mono); color:var(--mute); }
.csubject { margin:5px 0 0; font-weight:600; font-size:15px; overflow-wrap:anywhere; }
.corder { margin:7px 0 0; display:flex; flex-wrap:wrap; gap:4px 10px; }
.ci { font:500 12px/1.5 var(--mono); color:var(--ink2); }
.cbroken { margin:7px 0 0; font-size:13.5px; color:var(--flag); }

.acts { list-style:none; margin:16px 0 0; padding:0; max-width:none; }
.acts li { padding:10px 0; border-top:1px solid var(--rule); }
.atime { font:600 11.5px/1 var(--mono); color:var(--bronze); }
.achanges { margin:7px 0 0; display:flex; flex-wrap:wrap; gap:5px; }
.chg { font:500 11.5px/1.6 var(--mono); padding:1px 6px; border-radius:var(--radius-sm); background:var(--code-bg); color:var(--ink2); }
.chg.add { color:var(--go); }
.chg.rm { color:var(--flag); }
.chg em { font-style:normal; color:var(--mute); }
.acount { margin:6px 0 0; font:500 11.5px/1 var(--mono); color:var(--mute); }
.method ul { font-size:15px; }
.foot hr { border:0; border-top:1px solid var(--rule); margin:18px 0; }

@media (max-width:520px) {
  .grid { grid-template-columns:1fr; }
  .playerbody { padding:12px 12px 16px; }
  .plist li { grid-template-columns:24px 1fr; }
  .plist li .mv { grid-column:2; justify-self:start; }
}

@media (prefers-reduced-motion: reduce) {
  .plist li { transition:none !important; }
}
`

const PLAYER_JS = `
(function () {
  var el = document.getElementById('rankviz-data');
  if (!el) return;
  var D = JSON.parse(el.textContent);
  var H = D.history || {};
  var frames = H.frames || [];
  if (!frames.length) return;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var backAt = {};
  (H.reversals || []).forEach(function (r) { backAt[r.returnedAt.index + ':' + r.issue] = true; });

  var list = document.getElementById('pf-list');
  var leftBox = document.getElementById('pf-left');
  var note = document.getElementById('pf-note');
  var scrub = document.getElementById('pf-scrub');
  var pool = new Map();
  var timer = null;
  var at = frames.length;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function title(n) {
    var i = (D.issues || {})[String(n)];
    if (!i || !i.title) return 'title not read for #' + n;
    return String(i.title).replace(/^Requirement:\\s*/, '');
  }
  function url(n) {
    var i = (D.issues || {})[String(n)];
    return (i && i.url) || 'https://github.com/' + D.repo + '/issues/' + n;
  }
  function when(iso) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: D.tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date(iso)).replace(',', '');
    } catch (e) { return iso; }
  }

  function markFor(f, issue, rank) {
    if (backAt[f.index + ':' + issue]) return '<span class="mv back">back</span>';
    var c = f.change || {};
    if (!c.known) return '';
    for (var i = 0; i < (c.entered || []).length; i++) {
      if (c.entered[i].issue === issue) return '<span class="mv new">new</span>';
    }
    for (var j = 0; j < (c.moved || []).length; j++) {
      var m = c.moved[j];
      if (m.issue === issue) {
        return m.delta > 0
          ? '<span class="mv up">&#9650; ' + m.delta + '</span>'
          : '<span class="mv down">&#9660; ' + Math.abs(m.delta) + '</span>';
      }
    }
    return '';
  }

  function rowFor(issue) {
    var e = pool.get(issue);
    if (!e) {
      e = document.createElement('li');
      e.dataset.issue = String(issue);
      pool.set(issue, e);
    }
    return e;
  }

  function paint(i) {
    var f = frames[i - 1];
    at = i;
    scrub.value = String(i);
    document.getElementById('pf-count').textContent = i + ' / ' + frames.length;
    document.getElementById('pf-time').textContent = when(f.iso) + ' ' + (D.zone || '');
    document.getElementById('pf-subject').textContent = f.subject;
    document.getElementById('pf-sha').textContent = f.short + (f.author ? ' \\u00b7 ' + f.author : '');
    var why = document.getElementById('pf-why');
    why.textContent = f.body || 'this commit recorded no further reasoning';
    document.getElementById('pf-whywrap').hidden = false;

    // A frame nobody could rebuild shows its reason and NOTHING else. Carrying the
    // previous order forward here would draw a state that never existed.
    if (!f.reconstructed || !f.order) {
      note.hidden = false;
      note.textContent = 'This frame could not be rebuilt from its commit: ' + (f.why || 'no reason recorded')
        + '. Nothing is drawn for it, and what changed at it is not stated.';
      list.replaceChildren();
      leftBox.hidden = true;
      return;
    }
    note.hidden = true;

    var before = new Map();
    pool.forEach(function (e, issue) { if (e.isConnected) before.set(issue, e.getBoundingClientRect().top); });

    var next = [];
    f.order.forEach(function (r, idx) {
      var e = rowFor(r.issue);
      e.innerHTML = '<span class="pr">' + (idx + 1) + '</span>'
        + '<span class="pt"><a href="' + esc(url(r.issue)) + '"><span class="n">#' + r.issue + '</span> '
        + esc(title(r.issue)) + '</a></span>'
        + (markFor(f, r.issue, idx + 1) || '<span class="mv hold">&#183;</span>');
      next.push(e);
    });
    list.replaceChildren.apply(list, next);

    if (!reduced) {
      next.forEach(function (e) {
        var issue = Number(e.dataset.issue);
        if (!before.has(issue)) return;
        var d = before.get(issue) - e.getBoundingClientRect().top;
        if (!d) return;
        e.style.transition = 'none';
        e.style.transform = 'translateY(' + d + 'px)';
        requestAnimationFrame(function () {
          e.style.transition = 'transform .48s cubic-bezier(.2,.7,.2,1)';
          e.style.transform = '';
        });
      });
    }

    var gone = (f.change && f.change.left) || [];
    if (gone.length) {
      leftBox.hidden = false;
      leftBox.innerHTML = '<span class="mv down">left the head</span>' + gone.map(function (g) {
        return '<a href="' + esc(url(g.issue)) + '">#' + g.issue + '</a> (was rank ' + g.rank + ')';
      }).join(', ');
    } else if (f.change && f.change.known === false && !f.first) {
      leftBox.hidden = false;
      leftBox.textContent = f.change.why || 'what changed at this commit is not known';
    } else {
      leftBox.hidden = true;
    }
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    document.getElementById('pf-play').textContent = '\\u25b6 play';
  }
  function play() {
    if (timer) return stop();
    if (at >= frames.length) paint(1);
    document.getElementById('pf-play').textContent = '\\u2016 pause';
    timer = setInterval(function () {
      if (at >= frames.length) return stop();
      paint(at + 1);
    }, reduced ? 3200 : 2000);
  }

  document.getElementById('pf-prev').addEventListener('click', function () { stop(); paint(Math.max(1, at - 1)); });
  document.getElementById('pf-next').addEventListener('click', function () { stop(); paint(Math.min(frames.length, at + 1)); });
  document.getElementById('pf-play').addEventListener('click', play);
  scrub.addEventListener('input', function () { stop(); paint(Number(scrub.value)); });

  var player = document.getElementById('player');
  player.addEventListener('toggle', function () {
    if (player.open) paint(frames.length);
    else stop();
  });
})();
`
