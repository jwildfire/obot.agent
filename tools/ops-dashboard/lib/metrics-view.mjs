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
//
// SINCE 2026-08-17 (jwildfire/obot.roadmap#227, task jwildfire/obot.agent#155) the
// same numbers are selectable: one period at a time, with a repo filter and a goal
// filter, and each series drawn as a trend rather than read across five columns.
// Nothing that shipped in #218 is discarded — the five-window table is still here,
// below the trends, because it is the fastest way to compare two horizons at once.
//
// The filters brought one obligation with them, and it is the whole reason this file
// is longer than a table renderer. Only about half the issues in the record carry a
// structural goal link, and only a fifth of pull requests do; releases and decision
// artifacts carry none at all. A goal filter that quietly drops the other half would
// draw a confident, wrong, falling line. So every filtered panel states what it could
// not attribute, and a series that structurally cannot answer the question renders as
// "not attributable" rather than as zero.
import { esc } from './esc.mjs';
import {
  WINDOWS, windowCounts, HISTORY_EPOCH, trendSeries, repoEpochs, BRANCH_MODEL_EPOCH,
} from '../../navigator/metrics.mjs';
import { buildGoalIndex, issueGoals, prGoals, goalMatch, refKey } from '../../navigator/goals.mjs';
import { sparkSvg, bucketTable, SPARK_CSS } from './spark.mjs';

// The metrics cache is refreshed hourly; three missed refreshes means the
// collector is dead — the same three-cadence rule the sweep applies to itself.
export const METRICS_STALE_MIN = 180;

// The periods he named, unchanged (jwildfire/obot.agent#155: "keep 1, 3, 7, 30 and
// 365"). The default is a week: short enough that today's work is visible in it,
// long enough that a quiet Sunday does not read as a stall.
export const PERIODS = WINDOWS;
export const PERIOD_DEFAULT = 7;

const num = (n) => (n === 0 ? '<span class="m0">0</span>' : `<span class="mn">${n}</span>`);
const minutesSince = (iso, now) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.round((now.getTime() - t) / 60000));
};
const humanMin = (m) => (m === null ? 'unknown age' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)}h ago`);
const shortRepo = (r) => String(r).replace(/^jwildfire\//, '');
const dayOnly = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * The query string → the three things that change what is counted.
 *
 * Everything is validated against what actually exists rather than trusted: a period
 * that is not one of his five falls back to the default, and a repo or goal that is
 * not in the cache is dropped rather than silently filtering everything to zero. A
 * mistyped URL must not be able to make the page say nothing happened.
 */
export function parseFilters(query = '', cache = null) {
  const q = new URLSearchParams(String(query).replace(/^\?/, ''));
  const p = Number(q.get('period'));
  const wantRepo = q.get('repo');
  const wantGoal = q.get('goal');
  const repos = (cache?.repos ?? []);
  const repo = repos.find((r) => r === wantRepo || shortRepo(r) === wantRepo) ?? null;
  const goals = (cache?.goals ?? []);
  const goal = goals.find((g) => String(g.number) === wantGoal || g.slug === wantGoal) ?? null;
  return {
    period: PERIODS.includes(p) ? p : PERIOD_DEFAULT,
    repo,
    goal,
    // What was asked for but does not exist, so the page can say so instead of
    // rendering an unexplained unfiltered view.
    unknown: [
      wantRepo && !repo ? `repo "${wantRepo}"` : null,
      wantGoal && !goal ? `goal "${wantGoal}"` : null,
    ].filter(Boolean),
  };
}

/** A link back to this page with one filter changed and the others kept. */
export function filterHref(current, change) {
  const q = new URLSearchParams();
  const period = change.period ?? current.period;
  const repo = 'repo' in change ? change.repo : current.repo;
  const goal = 'goal' in change ? change.goal : current.goal;
  if (period !== PERIOD_DEFAULT) q.set('period', String(period));
  if (repo) q.set('repo', shortRepo(repo));
  if (goal) q.set('goal', goal.slug || String(goal.number));
  const s = q.toString();
  return s ? `/navigator?${s}` : '/navigator';
}

/**
 * Split one kind of item three ways under the current filters.
 *
 * `kept` is what the filter admits. `unlinked` is what the goal filter had to drop
 * because the item carries no route to a goal at all — not because it belongs to a
 * different one. Those are different facts and the page shows them apart: on this data
 * the second is nearly half the issues and four fifths of the pull requests, and
 * folding it into the first turns "we cannot tell" into "it did not happen".
 *
 * All three come back as ARRAYS rather than counts, deliberately. The first version of
 * this returned totals, and the tile then reported "127 more carry no goal link" on
 * every pull-request tile — a number that was neither about that lane nor about the
 * period on screen. A note next to a trend has to be counted over the same window and
 * the same subset as the trend, which means the items have to survive this far.
 */
function splitByFilters(items, { repo, goalKey, resolve }) {
  const kept = [];
  const unlinked = [];
  const elsewhere = [];
  for (const it of items) {
    if (repo && it.repo !== repo) continue;
    if (!goalKey) { kept.push(it); continue; }
    const verdict = goalMatch(goalKey, resolve(it));
    if (verdict === 'yes') kept.push(it);
    // "in no goal at all" and "nothing to walk" are one fact from where he reads:
    // neither is in any goal's numbers. Only `other` means the work is real and is
    // somebody else's goal, which is the one case a filter is entitled to drop
    // silently.
    else if (verdict === 'other') elsewhere.push(it);
    else unlinked.push(it);
  }
  return { kept, unlinked, elsewhere };
}

/** How many of these fall inside the trend's own window — never a wider one. */
function countInWindow(items, { start, end }, dateOf = (i) => i.createdAt) {
  let n = 0;
  for (const it of items) {
    const t = Date.parse(String(dateOf(it) ?? ''));
    if (!Number.isNaN(t) && t >= start && t < end) n += 1;
  }
  return n;
}

/**
 * When a series could first have been non-zero, under the current filter.
 *
 * Two dates, because there are two different ways a trend can be reading its own
 * instrumentation rather than the work:
 *
 *   - `unmeasuredUntil` — before this, nothing in this series could have been
 *     recorded at all. It is the LATEST of the structural floors that apply: the
 *     earliest repo on record, the date the selected goal was created (nothing can
 *     belong to a goal that does not exist yet), and any floor the series carries of
 *     its own (the decisions record began three days ago; the release lane only
 *     exists in a repo once that repo has a branch model).
 *   - `partialUntil` — before this, only SOME of the included repos were on record.
 *     With one repo selected the two dates coincide and the second band vanishes,
 *     which is the honest outcome: there is nothing partial about a single repo.
 */
function seriesEpoch({ repos, epochs, goal, floor = null }) {
  const included = repos.map((r) => epochs.get(r)).filter(Boolean).sort();
  const parts = [included[0], goal?.createdAt?.slice(0, 10), floor].filter(Boolean);
  const partialParts = [included.at(-1), goal?.createdAt?.slice(0, 10), floor].filter(Boolean);
  const pick = (xs) => (xs.length ? xs.sort().at(-1) : null);
  const unmeasured = pick(parts);
  const partial = pick(partialParts);
  return {
    unmeasuredUntil: unmeasured ? Date.parse(`${unmeasured}T00:00:00Z`) : null,
    partialUntil: partial && partial !== unmeasured ? Date.parse(`${partial}T00:00:00Z`) : null,
  };
}

/**
 * The cache as a selected period, filtered, with a trend per series.
 *
 * Every series that is younger than the period says so on its own chart rather than
 * letting an empty stretch imply a quiet year — the decisions record is days old, and
 * five of the seven repos only moved under this account on 2026-07-02.
 */
export function buildMetricsModel(cache, now = new Date(), filters = {}) {
  if (!cache) return null;
  const period = PERIODS.includes(filters.period) ? filters.period : PERIOD_DEFAULT;
  const repo = filters.repo ?? null;
  const goal = filters.goal ?? null;
  const goalKey = goal ? refKey(goal.repo ?? 'jwildfire/obot.roadmap', goal.number) : null;
  const ageMin = minutesSince(cache.fetchedAt, now);
  const index = buildGoalIndex(cache);
  const epochs = repoEpochs(cache);
  const allRepos = cache.repos ?? [];
  const included = repo ? [repo] : allRepos;

  // The repo filter is applied here; the goal filter is applied per series, inside
  // `tile`, so that what it drops can be counted over the same subset and the same
  // window as the trend it sits beside.
  const repoOnly = (items) => (repo ? items.filter((i) => i.repo === repo) : items);
  const allIssues = repoOnly(cache.issues ?? []);
  const allPrs = repoOnly(cache.prs ?? []);
  const releasesAll = repoOnly(cache.releases ?? []);
  const resolveIssue = (i) => issueGoals(i, index);
  // A release is published from a repo, never from a goal: GitHub's release object
  // carries no issue, milestone or requirement field, and 15 of the 22 on record name
  // a hub issue only in their prose. Scraping that prose is exactly the "a reference
  // in prose is not a link" rule the discipline checks were written against, so the
  // honest answer is that the question cannot be asked.
  const resolvePr = (p) => prGoals(p, index);

  const filed = cache.decisions?.filed ?? [];
  const decided = cache.decisions?.decided ?? [];
  const cls = (...cs) => allIssues.filter((i) => cs.includes(i.cls));
  const lane = (l) => allPrs.filter((p) => p.lane === l);
  const day = { grain: 'day' };

  // A decision artifact belongs to the programme, not to a repo or a goal — nothing
  // in the registry links one to either. Under any filter it is unanswerable, and
  // saying so is the only honest rendering.
  const decisionsBlocked = repo ? 'decisions are recorded programme-wide, not per repo'
    : (goal ? 'a decision artifact carries no goal link' : null);
  const releasesBlocked = goal ? 'a release carries no structural link to a goal' : null;

  const rcFloor = included
    .map((r) => BRANCH_MODEL_EPOCH[r]).filter(Boolean).sort()[0] ?? null;
  const ep = (over, floor = null) => seriesEpoch({ repos: over, epochs, goal, floor });
  const trend = (items, opts = {}) => trendSeries(items, { period, now, ...opts });

  const tile = (group, label, pool, {
    muted = false, blocked = null, floor = null, grain, dateOf, resolve = null, over = included,
  } = {}) => {
    // A series the current filter cannot answer keeps its pool whole rather than
    // pretending to have filtered it: the tile prints the reason instead of a number,
    // and a filtered total behind a "—" is a number waiting to be believed.
    const split = blocked || !resolve
      ? { kept: pool, unlinked: [], elsewhere: [] }
      : splitByFilters(pool, { goalKey, resolve });
    const t = trend(split.kept, { ...(grain ? { grain } : {}), ...(dateOf ? { dateOf } : {}) });
    const zone = blocked ? { unmeasuredUntil: null, partialUntil: null } : ep(over, floor);
    // A delta is a comparison, and there is nothing to compare against when the
    // period before this one is wholly before measurement began. Printing "+400%"
    // off a base of zero-because-unmeasured is the lie with a slope, restated as
    // arithmetic — so the comparison is withheld and the reason is printed instead.
    const prevStart = t.start - (t.end - t.start);
    const comparable = !blocked && !(zone.unmeasuredUntil && zone.unmeasuredUntil > prevStart);
    return {
      group, label, muted, blocked,
      // Counted over this tile's own subset and this tile's own window — the two
      // things the first version of this note got wrong.
      unlinked: countInWindow(split.unlinked, t, dateOf ?? ((i) => i.createdAt)),
      elsewhere: countInWindow(split.elsewhere, t, dateOf ?? ((i) => i.createdAt)),
      total: t.total, prev: t.prevTotal, comparable,
      delta: comparable ? t.total - t.prevTotal : null,
      buckets: t.buckets, plan: t.plan, start: t.start, end: t.end, zone,
      // Where the clock actually is inside the last bucket. Time is injected here
      // like everywhere else in this codebase — a renderer reading the wall clock is
      // a renderer no test can pin.
      nowAt: now.getTime() < t.end ? now.getTime() : null,
      items: split.kept,
    };
  };

  const asIssue = { resolve: resolveIssue };
  const asPr = { resolve: resolvePr };
  const tiles = [
    tile('Issues opened', 'requirements', cls('requirement'), asIssue),
    tile('Issues opened', 'goals', cls('goal'), asIssue),
    tile('Issues opened', 'bugs', cls('bug'), asIssue),
    tile('Issues opened', 'tasks & audit trails', cls('task', 'audit'), asIssue),
    tile('Issues opened', 'no class yet (hub)', cls('unclassified'), { ...asIssue, muted: true }),
    tile('PRs opened', 'release candidates', lane('release-candidate'), { ...asPr, floor: rcFloor }),
    tile('PRs opened', 'standard lane', lane('standard'), asPr),
    tile('PRs opened', 'stacked (feature branch)', lane('stacked'), { ...asPr, muted: true }),
    tile('Shipped', 'releases published', releasesAll, {
      dateOf: (r) => r.publishedAt, blocked: releasesBlocked,
    }),
    tile('Decisions', 'filed for him', filed, {
      dateOf: (d) => d.date, grain: 'day', blocked: decisionsBlocked, over: [],
      floor: filed.map((d) => d.date).sort()[0] ?? null,
    }),
    tile('Decisions', 'decided by him', decided, {
      dateOf: (d) => d.date, grain: 'day', blocked: decisionsBlocked, over: [],
      floor: decided.map((d) => d.date).sort()[0] ?? null,
    }),
  ];

  // The legacy five-window table reads the same filtered pools the tiles do, so the
  // two panels on one page can never disagree about what a filter means.
  const issues = goalKey ? splitByFilters(allIssues, { goalKey, resolve: resolveIssue }).kept : allIssues;
  const prs = goalKey ? splitByFilters(allPrs, { goalKey, resolve: resolvePr }).kept : allPrs;
  const releases = releasesBlocked ? [] : releasesAll;
  const clsW = (...cs) => issues.filter((i) => cs.includes(i.cls));
  const laneW = (l) => prs.filter((p) => p.lane === l);

  const rows = [
    { group: 'Issues opened', label: 'requirements', counts: windowCounts(clsW('requirement'), now) },
    { group: 'Issues opened', label: 'goals', counts: windowCounts(clsW('goal'), now) },
    { group: 'Issues opened', label: 'bugs', counts: windowCounts(clsW('bug'), now) },
    { group: 'Issues opened', label: 'tasks & audit trails', counts: windowCounts(clsW('task', 'audit'), now) },
    // Hub issues with no class and no parent — mostly asks filed before the
    // requirement discipline. A data-quality figure: the trend toward zero is
    // the discipline working, and hiding these inside "tasks" would erase it.
    { group: 'Issues opened', label: 'no class yet (hub)', counts: windowCounts(clsW('unclassified'), now), muted: true },
    { group: 'PRs opened', label: 'release candidates', counts: windowCounts(laneW('release-candidate'), now) },
    { group: 'PRs opened', label: 'standard lane', counts: windowCounts(laneW('standard'), now) },
    { group: 'PRs opened', label: 'stacked (feature branch)', counts: windowCounts(laneW('stacked'), now), muted: true },
    { group: 'Shipped', label: 'releases published', counts: windowCounts(releases, now, (r) => r.publishedAt), items: releases },
    { group: 'Decisions', label: 'filed for him', counts: windowCounts(filed, now, (d) => d.date, day), epoch: filed.map((d) => d.date).sort()[0] ?? null },
    { group: 'Decisions', label: 'decided by him', counts: windowCounts(decided, now, (d) => d.date, day), epoch: decided.map((d) => d.date).sort()[0] ?? null },
  ];
  return {
    ageMin,
    stale: ageMin === null || ageMin > METRICS_STALE_MIN,
    repoCount: allRepos.length,
    period, repo, goal, tiles, rows,
    unknown: filters.unknown ?? [],
    repos: allRepos.map((r) => ({ key: r, short: shortRepo(r), epoch: epochs.get(r) ?? null })),
    goals: (cache.goals ?? []).map((g) => ({ ...g, key: refKey(g.repo, g.number) })),
    // How much of the record the goal filter can even see. Stated whenever a goal is
    // selected, because the number is not a detail: about half the issues and four
    // fifths of the pull requests on record carry no goal link, so an unqualified
    // goal-filtered count is a minority of the work and must never look like all of it.
    goalCoverage: goalKey ? {
      issuesLinked: (cache.issues ?? []).filter((i) => (issueGoals(i, index) ?? []).length).length,
      issuesTotal: (cache.issues ?? []).length,
      prsLinked: (cache.prs ?? []).filter((p) => (prGoals(p, index) ?? []).length).length,
      prsTotal: (cache.prs ?? []).length,
    } : null,
    bounds: cache.bounds ?? [],
    errors: cache.errors ?? [],
    noCloses: cache.noCloses ?? [],
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
    return `${groupCell}<tr${r.muted ? ' class="mmuted"' : ''}><td class="mlabel">${label}</td>${WINDOWS.map((w) => `<td class="mcell">${num(r.counts[w])}</td>`).join('')}</tr>`;
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
${filterBar(model)}
<p class="mprov">Counted from GitHub across ${model.repoCount} project repos, and from the decisions record, ${esc(humanMin(model.ageMin))} · <a href="${esc(hubUrl)}/decisions/" target="_blank" rel="noopener">decisions log</a></p>
${staleLine}
${unknownLine(model)}
${coverageLine(model)}
<div class="tiles">
${model.tiles.map((t, i) => tileHtml(t, `t${i}`, model)).join('\n')}
</div>
<details class="mfold"><summary>All five periods at once, as a table</summary>
<div class="mwrap"><table class="metrics">
<thead><tr><th class="mlabel"></th>${head}</tr></thead>
<tbody>
${body}
</tbody>
</table></div>
<p class="mepoch">History starts when measurement did: the oldest issue here is ${HISTORY_EPOCH} and five of the seven repos begin with the 2026-07-02 consolidation, so the 365-day column is all time, not a year. Issue classes are derived from labels (GitHub has no type field on these repos). Decisions count recorded decision entries — one artifact may carry several — on calendar days, filed since ${esc(filedEpoch ?? 'n/a')}, decided since ${esc(decidedEpoch ?? 'n/a')}.</p>
</details>
${gaps.length ? `<p class="mgap">Known gaps: ${gaps.map(esc).join(' · ')}.</p>` : ''}`;
}

// ---- the filter bar and the tiles -------------------------------------------

const chip = (href, label, on, title = '') => `<a class="chip${on ? ' on' : ''}" href="${esc(href)}"${
  on ? ' aria-current="true"' : ''}${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</a>`;

/**
 * Period, repo and goal as links rather than a form.
 *
 * This page carries no client-side JavaScript (render.mjs, navigatorPage), and a
 * `<select>` that needs a script to do anything is a control that does nothing on the
 * surface he actually reads. Links also make a filtered view a URL he can keep.
 */
export function filterBar(model) {
  const periods = PERIODS.map((p) => chip(
    filterHref(model, { period: p }),
    p === 365 ? '365d' : `${p}d`,
    p === model.period,
  )).join('');
  const repos = [chip(filterHref(model, { repo: null }), 'all repos', !model.repo)]
    .concat(model.repos.map((r) => chip(
      filterHref(model, { repo: r.key }), r.short, model.repo === r.key,
      r.epoch ? `on record here since ${r.epoch}` : '',
    ))).join('');
  const goals = [chip(filterHref(model, { goal: null }), 'all goals', !model.goal)]
    .concat(model.goals.map((g) => chip(
      filterHref(model, { goal: g }), g.slug || `#${g.number}`,
      model.goal?.number === g.number,
      `${g.title} (#${g.number})`,
    ))).join('');
  return `<div class="filters">
  <div class="frow"><span class="flab">period</span><div class="fset">${periods}</div></div>
  <div class="frow"><span class="flab">repo</span><div class="fset">${repos}</div></div>
  <div class="frow"><span class="flab">goal</span><div class="fset">${goals}</div></div>
</div>`;
}

const unknownLine = (model) => (model.unknown?.length
  ? `<p class="mgap">Ignored, because it is not in the record: ${model.unknown.map(esc).join(' · ')}. Everything below is unfiltered by it.</p>`
  : '');

/**
 * What a goal filter cannot see, stated before he reads a single number.
 *
 * Goal membership is a structural sub-issue link and only about half the issues on
 * record carry one; for pull requests it runs through `closingIssuesReferences` and
 * four fifths carry none. Those items are not in any goal's counts. Without this
 * sentence a goal-filtered page reads as the whole picture of that goal's work.
 */
export function coverageLine(model) {
  const c = model.goalCoverage;
  if (!c) return '';
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  return `<p class="mcover">Goal filter on. Of everything on record, ${c.issuesLinked} of ${c.issuesTotal} issues (${pct(c.issuesLinked, c.issuesTotal)}%) and ${c.prsLinked} of ${c.prsTotal} pull requests (${pct(c.prsLinked, c.prsTotal)}%) carry a structural link to any goal — the rest belong to no goal and are in none of these counts. Releases and decisions carry no goal link at all and say so below.</p>`;
}

const deltaHtml = (t) => {
  if (t.blocked) return '';
  if (!t.comparable) {
    return '<span class="t-delta t-none">no comparable period — measurement began inside this one</span>';
  }
  const d = t.delta;
  const sign = d > 0 ? '+' : '';
  return `<span class="t-delta">${d === 0 ? 'level' : `${sign}${d}`} vs the ${prevWords(t)}</span>`;
};

const prevWords = (t) => {
  const days = Math.round((t.end - t.start) / 86400000);
  return days >= 1 ? `previous ${days}d` : 'previous 24h';
};

/**
 * One metric as a stat tile: what it is, the number, the comparison, the trend.
 *
 * `blocked` is the branch that matters. A series the current filter cannot answer —
 * a release under a goal filter, a decision under either — renders the reason where
 * the number would be. Rendering it as `0` would be a lie in the shape of a fact.
 */
export function tileHtml(t, id, model) {
  const unit = t.plan?.unit ?? 'day';
  const span = `${Math.round((t.end - t.start) / 86400000)}d to now, by ${unit}`;
  if (t.blocked) {
    return `<figure class="tile blocked">
  <figcaption class="t-label">${esc(t.label)}<span class="t-group">${esc(t.group)}</span></figcaption>
  <div class="t-value t-na">&mdash;</div>
  <p class="t-why">Not attributable: ${esc(t.blocked)}.</p>
</figure>`;
  }
  const epochNote = t.zone.unmeasuredUntil && t.zone.unmeasuredUntil > t.start
    ? `<p class="t-epoch">Measured from ${esc(dayOnly(t.zone.unmeasuredUntil))} — the hatched span is before this series could record anything.</p>`
    : '';
  const partialNote = t.zone.partialUntil && t.zone.partialUntil > t.start
    ? `<p class="t-epoch">All repos on record from ${esc(dayOnly(t.zone.partialUntil))}; before that the count covers only some of them.</p>`
    : '';
  const unlinkedNote = model.goal && t.unlinked
    ? `<p class="t-epoch">${t.unlinked} more in this class carry no goal link and are counted under no goal.</p>`
    : '';
  const label = `${t.label}, ${t.total} in the last ${span}`;
  return `<figure class="tile${t.muted ? ' mmuted' : ''}">
  <figcaption class="t-label">${esc(t.label)}<span class="t-group">${esc(t.group)}</span></figcaption>
  <div class="t-value">${t.total}</div>
  ${deltaHtml(t)}
  ${sparkSvg({
    buckets: t.buckets, start: t.start, end: t.end, id, label,
    unmeasuredUntil: t.zone.unmeasuredUntil, nowAt: t.nowAt,
  })}
  <p class="t-span">${esc(span)}</p>
  ${epochNote}${partialNote}${unlinkedNote}
  <details class="t-table"><summary>the numbers</summary>${bucketTable(t.buckets, unit)}</details>
</figure>`;
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
<p class="nav-empty">Nothing recorded yet — events appear here as the sweep sees them.</p>`;
  }
  return `<h2 class="nav-h">What changed</h2>
${groups.map((g) => `<h3 class="fday">${esc(g.day)}</h3>
<ul class="feed">
${g.items.map((it) => `<li><span class="ftime">${esc(it.time)}</span> <span class="fbadge ${esc(it.tone)}">${esc(it.badge)}</span> ${it.url
    ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.text)}</a>`
    : esc(it.text)}${it.stamp ? ` <span class="fstamp">${esc(it.stamp)}</span>` : ''}</li>`).join('\n')}
</ul>`).join('\n')}`;
}

export const METRICS_CSS = `${SPARK_CSS}
  /* The filter bar. Three labelled rows of chips rather than three <select>s: this
     page ships no JavaScript, so a select would need a submit button beside it, and
     at 390px the chips wrap into exactly the shape a segmented control should have
     anyway. Wrapping is the whole layout strategy here — nothing is on a track that
     can starve, so there is no width at which a chip is cut off. */
  .filters { display:flex; flex-direction:column; gap:0.25rem; margin:0.1rem 0 0.5rem; }
  .frow { display:flex; align-items:baseline; gap:0.4rem; flex-wrap:wrap; }
  .flab { font-size:0.6rem; letter-spacing:0.11em; text-transform:uppercase; color:var(--faint);
          min-width:3.1rem; flex:none; }
  .fset { display:flex; gap:0.2rem; flex-wrap:wrap; min-width:0; }
  /* A comfortable tap target on a phone without looking like a button farm on a
     desktop: the padding does the work, not a min-height that would bloat the row. */
  .chip { font-size:0.72rem; padding:0.18rem 0.5rem; border-radius:99px; text-decoration:none;
          color:var(--muted); border:1px solid var(--line); white-space:nowrap; line-height:1.3; }
  .chip:hover { border-color:var(--muted); }
  .chip.on { background:var(--accent-soft); color:var(--accent); border-color:var(--accent); }
  .chip:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }

  /* auto-fill with a 150px floor: at 390px that is one or two columns and never a
     starved track, and the same rule gives five across on a wide window. */
  .tiles { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr));
           gap:0.5rem; margin:0.3rem 0 0.7rem; }
  .tile { margin:0; padding:0.4rem 0.5rem 0.3rem; border:1px solid var(--line); border-radius:7px;
          background:var(--card); min-width:0; }
  .tile.mmuted { opacity:0.78; }
  .tile.blocked { background:transparent; }
  .t-label { font-size:0.74rem; color:var(--ink); line-height:1.25; overflow-wrap:anywhere;
             display:flex; flex-direction:column; }
  .t-group { font-size:0.57rem; letter-spacing:0.1em; text-transform:uppercase; color:var(--faint); }
  /* Proportional figures, not tabular: these are standalone values in separate tiles
     with no column to align to, and tabular digits read loose at this size. */
  .t-value { font-size:1.5rem; font-weight:600; line-height:1.1; margin:0.1rem 0 0; }
  .t-value.t-na { color:var(--faint); font-weight:400; }
  .t-delta { font-size:0.66rem; color:var(--muted); display:block; margin-bottom:0.15rem; }
  /* Deliberately not coloured by direction. More releases is good and more bugs is
     not, and one rule cannot be right for both — a green "+3" on the bugs tile would
     be worse than no colour at all. */
  .t-delta.t-none { color:var(--faint); }
  .t-span, .t-epoch, .t-why { font-size:0.63rem; color:var(--muted); margin:0.1rem 0 0; line-height:1.3; }
  .t-span { color:var(--faint); }
  .t-why { color:var(--muted); }
  .t-none { font-size:0.65rem; color:var(--faint); margin:0.2rem 0 0; }
  .t-table summary { font-size:0.63rem; color:var(--faint); cursor:pointer; margin-top:0.2rem; }
  .mcover { font-size:0.7rem; color:var(--ink); margin:0.2rem 0 0.5rem; line-height:1.4;
            border-left:2px solid var(--warn); padding:0.15rem 0 0.15rem 0.45rem; }
  .mfold > summary { font-size:0.68rem; color:var(--muted); cursor:pointer; margin:0.3rem 0; }

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
