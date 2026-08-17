// The Navigator tab's view: release metrics first, then what changed.
//
// @jwildfire, 2026-08-16 (jwildfire/obot.roadmap#218): the tab read like an audit
// log for bots — "Nav is also pretty unreadable. Maybe actually turn that into
// metrics. Show me key release metrics (issues/PRs created by type, releases,
// decisions, etc) in the last 1/3/7/30/365 days." This renders that, from the
// cache the sweep collects (tools/navigator/metrics.mjs) — no network at render
// time, and the page always says how old its numbers are.
//
// The full sweep record — RC queue, delivery record, discipline findings — is not
// deleted by this view; it moves to /navigator/record, where its dense readers
// (agents, and him when something looks wrong) get it whole. This page is the
// catch-up read for someone who was not present.
import { esc } from './esc.mjs';
import { WINDOWS, windowCounts, HISTORY_EPOCH } from '../../navigator/metrics.mjs';

// The metrics cache is refreshed hourly; three missed refreshes means the
// collector is dead — the same three-cadence rule the sweep applies to itself.
export const METRICS_STALE_MIN = 180;

const num = (n) => (n === 0 ? '<span class="m0">0</span>' : `<span class="mn">${n}</span>`);
const minutesSince = (iso, now) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.round((now.getTime() - t) / 60000));
};
const humanMin = (m) => (m === null ? 'unknown age' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)}h ago`);

/**
 * The cache as table rows: one row per series, one column per window.
 *
 * Every series that is younger than a column says so via the epochs list rather
 * than letting an empty cell imply a quiet year — the decisions record is days
 * old, and the repos themselves only moved under this account on 2026-07-02.
 */
export function buildMetricsModel(cache, now = new Date()) {
  if (!cache) return null;
  const ageMin = minutesSince(cache.fetchedAt, now);
  const issues = cache.issues ?? [];
  const prs = cache.prs ?? [];
  const releases = cache.releases ?? [];
  const filed = cache.decisions?.filed ?? [];
  const decided = cache.decisions?.decided ?? [];
  const cls = (...cs) => issues.filter((i) => cs.includes(i.cls));
  const lane = (l) => prs.filter((p) => p.lane === l);
  const day = { grain: 'day' };
  const rows = [
    { group: 'Issues opened', label: 'requirements', counts: windowCounts(cls('requirement'), now) },
    { group: 'Issues opened', label: 'goals', counts: windowCounts(cls('goal'), now) },
    { group: 'Issues opened', label: 'bugs', counts: windowCounts(cls('bug'), now) },
    { group: 'Issues opened', label: 'tasks & audit trails', counts: windowCounts(cls('task', 'audit'), now) },
    // Hub issues with no class and no parent — mostly asks filed before the
    // requirement discipline. A data-quality figure: the trend toward zero is
    // the discipline working, and hiding these inside "tasks" would erase it.
    { group: 'Issues opened', label: 'no class yet (hub)', counts: windowCounts(cls('unclassified'), now), muted: true },
    { group: 'PRs opened', label: 'release candidates', counts: windowCounts(lane('release-candidate'), now) },
    { group: 'PRs opened', label: 'standard lane', counts: windowCounts(lane('standard'), now) },
    { group: 'PRs opened', label: 'stacked (feature branch)', counts: windowCounts(lane('stacked'), now), muted: true },
    { group: 'Shipped', label: 'releases published', counts: windowCounts(releases, now, (r) => r.publishedAt), items: releases },
    // `unread` rather than a row of zeros when the decisions record could not be
    // opened at all — a hub clone that is not there counts nothing, and five zeros
    // read as a year in which he decided nothing.
    { group: 'Decisions', label: 'filed for him', counts: windowCounts(filed, now, (d) => d.date, day), epoch: filed.map((d) => d.date).sort()[0] ?? null, unread: !cache.decisions },
    { group: 'Decisions', label: 'decided by him', counts: windowCounts(decided, now, (d) => d.date, day), epoch: decided.map((d) => d.date).sort()[0] ?? null, unread: !cache.decisions },
  ];
  return {
    ageMin,
    decisionsRead: !!cache.decisions,
    stale: ageMin === null || ageMin > METRICS_STALE_MIN,
    repoCount: (cache.repos ?? []).length,
    rows,
    bounds: cache.bounds ?? [],
    errors: cache.errors ?? [],
    releases: [...releases].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))),
  };
}

const releaseList = (releases) => releases.slice(0, 30).map((r) => {
  const d = String(r.publishedAt ?? '').slice(0, 10);
  return `<li>${esc(d)} · <a href="https://github.com/${esc(r.repo)}/releases/tag/${encodeURIComponent(r.tag)}" target="_blank" rel="noopener">${esc(r.repo.replace('jwildfire/', ''))} ${esc(r.name)}</a></li>`;
}).join('');

export function metricsHtml(model, { hubUrl = 'https://jwildfire.github.io/obot.roadmap' } = {}) {
  if (!model) {
    return `<h2 class="nav-h">Release metrics</h2>
<p class="nav-empty">No numbers yet — the sweep collects them hourly (tools/navigator/metrics.mjs). If the sweep is running, they arrive within the hour.</p>`;
  }
  const head = WINDOWS.map((w) => `<th>${w === 365 ? '365d' : `${w}d`}</th>`).join('');
  let lastGroup = null;
  const body = model.rows.map((r) => {
    const groupCell = r.group === lastGroup ? '' : `<tr class="mgroup"><td colspan="${WINDOWS.length + 1}">${esc(r.group)}</td></tr>`;
    lastGroup = r.group;
    const label = r.items
      ? `<details><summary>${esc(r.label)}</summary><ul class="mrel">${releaseList(r.items)}</ul></details>`
      : esc(r.label);
    const cells = r.unread
      ? WINDOWS.map(() => '<td class="mcell munread" title="the decisions record could not be read on this machine">—</td>').join('')
      : WINDOWS.map((w) => `<td class="mcell">${num(r.counts[w])}</td>`).join('');
    return `${groupCell}<tr${r.muted ? ' class="mmuted"' : ''}><td class="mlabel">${label}</td>${cells}</tr>`;
  }).join('\n');
  const decidedEpoch = model.rows.find((r) => r.label === 'decided by him')?.epoch;
  const filedEpoch = model.rows.find((r) => r.label === 'filed for him')?.epoch;
  const staleLine = model.stale
    ? `<p class="dead">These numbers are stale — counted ${esc(humanMin(model.ageMin))}, and the collector refreshes hourly. Recent activity is missing. If the sweep is dead, the banner above says so.</p>`
    : '';
  const gaps = [
    ...model.errors.map((e) => `counting failed for ${e}`),
    ...model.bounds.map((b) => `${b.repo} ${b.kind}: history older than ${String(b.oldestFetched ?? '').slice(0, 10)} not counted`),
  ];
  return `<h2 class="nav-h">Release metrics</h2>
<p class="mprov">${model.repoCount
    ? `Counted from GitHub across ${model.repoCount} project repos${model.decisionsRead ? ', and from the decisions record' : ' — the decisions record could not be read'}, ${esc(humanMin(model.ageMin))}`
    : 'No repos were counted — the sweep found no repo list to count across'} · <a href="${esc(hubUrl)}/decisions/" target="_blank" rel="noopener">decisions log</a></p>
${staleLine}
<div class="mwrap"><table class="metrics">
<thead><tr><th class="mlabel"></th>${head}</tr></thead>
<tbody>
${body}
</tbody>
</table></div>
<p class="mepoch">History starts when measurement did: the oldest issue here is ${HISTORY_EPOCH} and five of the seven repos begin with the 2026-07-02 consolidation, so the 365-day column is all time, not a year. Issue classes are derived from labels (GitHub has no type field on these repos). Decisions count recorded decision entries — one artifact may carry several — on calendar days, filed since ${esc(filedEpoch ?? 'n/a')}, decided since ${esc(decidedEpoch ?? 'n/a')}.</p>
${gaps.length ? `<p class="mgap">Known gaps: ${gaps.map(esc).join(' · ')}.</p>` : ''}`;
}

// ---- what changed: the sweep's typed events, rendered as a feed --------------

const BADGES = {
  'rc-new': ['NEW RC', 'b-new'],
  'review-new': ['REVIEW', 'b-review'],
  'decision-change': ['DECISION', 'b-review'],
  'comments-new': ['COMMENTS', 'b-quiet'],
  'rc-gone': ['RC CLOSED', 'b-done'],
  'answer-new': ['HIS ANSWER', 'b-answer'],
  // The session feed's kinds (lib/feed.mjs) — same renderer, same rules.
  'verdict-confirmed': ['DELIVERED', 'b-answer'],
  'verdict-drift': ['DRIFT', 'b-review'],
  'verdict-none': ['NO DELIVERY', 'b-quiet'],
  claim: ['CLAIMED', 'b-quiet'],
  death: ['DIED', 'b-bad'],
  done: ['FINISHED', 'b-done'],
  call: ['NAVIGATOR', 'b-review'],
  'gh-merged': ['MERGED', 'b-new'],
  'gh-closed': ['CLOSED', 'b-done'],
  'gh-requirement': ['REQUIREMENT', 'b-review'],
  'gh-release': ['RELEASE', 'b-new'],
};

const cleanLine = (line = '') => line
  .replace(/https?:\/\/\S+/g, '').replace(/\[[^\]]*\]/g, '')
  .replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();

const dayOf = (ts, now) => {
  if (!ts) return 'earlier';
  const d = new Date(ts);
  const today = now.toDateString();
  const yesterday = new Date(now.getTime() - 86400000).toDateString();
  if (d.toDateString() === today) return 'today';
  if (d.toDateString() === yesterday) return 'yesterday';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Events → day-grouped feed rows, newest first. Events from before the ts field
 * existed carry only a bare clock; they group under "earlier" rather than being
 * assigned to a day they cannot prove.
 */
export function buildFeedModel(events = [], now = new Date()) {
  const groups = [];
  let current = null;
  for (const e of events) {
    const day = dayOf(e.ts, now);
    if (!current || current.day !== day) { current = { day, items: [] }; groups.push(current); }
    const [badge, tone] = BADGES[e.type] ?? [String(e.type ?? 'EVENT').toUpperCase(), 'b-quiet'];
    const d = e.ts ? new Date(e.ts) : null;
    current.items.push({
      badge, tone,
      time: d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : (e.at ?? ''),
      text: cleanLine(e.line),
      url: e.url ?? null,
      stamp: /\[([^\]]+)\]/.exec(e.stamp ?? '')?.[1] ?? null,
    });
  }
  return groups;
}

export function feedHtml(groups) {
  if (!groups.length) {
    return `<h2 class="nav-h">What changed</h2>
<p class="nav-empty">Nothing recorded yet — this feed reads the delivery journal, the worker ledger, the job records and the GitHub sweep cache, and none of them has produced an event on this machine.</p>`;
  }
  return `<h2 class="nav-h">What changed</h2>
${groups.map((g) => `<h3 class="fday">${esc(g.day)}</h3>
<ul class="feed">
${g.items.map((it) => `<li><span class="ftime">${esc(it.time)}</span> <span class="fbadge ${esc(it.tone)}">${esc(it.badge)}</span> ${it.url
    ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.text)}</a>`
    : esc(it.text)}${it.stamp ? ` <span class="fstamp">${esc(it.stamp)}</span>` : ''}</li>`).join('\n')}
</ul>`).join('\n')}`;
}

export const METRICS_CSS = `
  .mprov { font-size:0.72rem; color:var(--faint); margin:0.15rem 0 0.4rem; }
  .mwrap { overflow-x:auto; }
  table.metrics { border-collapse:collapse; width:100%; font-size:0.78rem; }
  table.metrics th { font-size:0.64rem; letter-spacing:0.08em; text-transform:uppercase;
                     color:var(--faint); font-weight:500; text-align:right; padding:0.2rem 0.45rem; }
  table.metrics td { padding:0.22rem 0.45rem; border-top:1px solid var(--line); }
  table.metrics td.mcell { text-align:right; font-family:var(--mono); font-size:0.74rem; }
  table.metrics .m0 { color:var(--faint); opacity:0.6; }
  table.metrics tr.mgroup td { border-top:0; padding-top:0.6rem; font-size:0.66rem;
                               letter-spacing:0.11em; text-transform:uppercase; color:var(--muted); font-weight:600; }
  table.metrics tr.mmuted td { color:var(--muted); }
  table.metrics td.mlabel { color:var(--ink); overflow-wrap:anywhere; }
  table.metrics td.mlabel details summary { cursor:pointer; }
  .mrel { list-style:none; margin:0.2rem 0 0.3rem; padding:0; font-size:0.72rem; color:var(--muted); }
  .mrel li { padding:0.05rem 0; }
  .mepoch, .mgap { font-size:0.7rem; color:var(--muted); margin:0.45rem 0 0; }
  .mgap { color:var(--warn, #b45309); }

  .fday { font-size:0.66rem; letter-spacing:0.11em; text-transform:uppercase; color:var(--muted);
          font-weight:600; margin:0.7rem 0 0.25rem; }
  .feed { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.15rem; }
  .feed li { border-left:3px solid var(--line); padding:0.2rem 0.4rem; font-size:0.8rem;
             line-height:1.35; overflow-wrap:anywhere; }
  .feed a { text-decoration:none; }
  .ftime { font-family:var(--mono); font-size:0.68rem; color:var(--faint); }
  .fstamp { font-family:var(--mono); font-size:0.62rem; color:var(--faint); }
  .fbadge { font-size:0.58rem; letter-spacing:0.08em; font-weight:600; border-radius:4px;
            padding:0.08rem 0.3rem; vertical-align:0.08rem; }
  .b-new { background:var(--accent-soft); color:var(--accent); }
  .b-review { background:var(--accent-soft); color:var(--ink); }
  .b-done { background:var(--line); color:var(--muted); }
  .b-quiet { background:transparent; color:var(--faint); border:1px solid var(--line); }
  .b-answer { background:var(--good-soft, #dcfce7); color:var(--good, #15803d); }
  .b-bad { background:var(--accent-soft); color:var(--crit, #b91c1c); }
`;
