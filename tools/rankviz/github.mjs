// What this page asks GitHub, and what it does when GitHub does not answer.
//
// Everything except the order and its one-line reason is derived here rather than
// written down anywhere — the title, whether the issue is still open, its milestone,
// whether it is blocked, how far its sub-issues have got. That is the whole contract of
// rank/README.md, and the reason it exists is that this program has already paid once
// for two hand-writable stores of one fact.
//
// REST rather than `gh issue list`, for the same reason tools/navigator/rankhead.mjs
// uses it: the REST issues endpoint carries `sub_issues_summary`, and sub-issue progress
// is one of the derived fields.
//
// EVERY FAILURE IS A READING. No function here throws on a GitHub that will not answer.
// Each returns `{ read, why, ... }`, and the page prints the `why`. An unread list is
// not an empty one, and the difference is the whole of what this surface is for.
import { execFileSync } from 'node:child_process'

/** GitHub's shape, reduced to the fields this page derives. Same reduction as the sweep. */
export const shape = (r) => ({
  number: Number(r.number),
  state: r.state ?? null,
  title: r.title ?? null,
  url: r.html_url ?? null,
  labels: (r.labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean),
  milestone: r.milestone?.title ?? null,
  sub: r.sub_issues_summary
    ? { completed: Number(r.sub_issues_summary.completed) || 0, total: Number(r.sub_issues_summary.total) || 0 }
    : null,
  createdAt: r.created_at ?? null,
  closedAt: r.closed_at ?? null,
})

const say = (e) => String(e?.stderr || e?.message || '').split('\n').map((l) => l.trim()).filter(Boolean).at(-1)

/** One `gh api` call, parsed. `{ read, why, data }`. */
export function ghApi(gh, path, { timeout = 60000 } = {}) {
  let out
  try {
    out = execFileSync(gh, ['api', path], {
      encoding: 'utf8', timeout, maxBuffer: 16 << 20, stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    return { read: false, why: say(e) || `gh exited without saying why while reading ${path}`, data: null }
  }
  try {
    return { read: true, why: '', data: JSON.parse(out) }
  } catch {
    return { read: false, why: `gh returned ${out.length} bytes that are not JSON for ${path}`, data: null }
  }
}

/** Every issue carrying a label, open or closed. */
export function issuesByLabel(gh, repo, label) {
  const got = ghApi(gh, `repos/${repo}/issues?labels=${encodeURIComponent(label)}&state=all&per_page=100`)
  if (!got.read) return { read: false, why: got.why, rows: null }
  if (!Array.isArray(got.data)) return { read: false, why: `gh did not return a list of issues for \`${label}\``, rows: null }
  return { read: true, why: '', rows: got.data.filter((r) => !r.pull_request).map(shape) }
}

/**
 * One issue, by number.
 *
 * Needed because the label query cannot see an issue that no longer carries the label,
 * and the most ordinary way for that to happen is the event this page is about: a
 * requirement leaves the head. Every issue that has ever appeared in the history has to
 * be nameable, or the animation renders bare numbers for the items that moved most.
 */
export function issueByNumber(gh, repo, number) {
  const got = ghApi(gh, `repos/${repo}/issues/${number}`, { timeout: 30000 })
  if (!got.read || !got.data?.number) return null
  return shape(got.data)
}

/**
 * The repository's `labeled` / `unlabeled` events for the labels this page cares about.
 *
 * Paged newest-first, so "reached the beginning" is not something the endpoint tells us —
 * it has to be inferred, and inferring it wrongly is the failure `membershipSpan` guards.
 * The rule here: keep paging until a whole page contains no event for a wanted label, or
 * until the cap. Hitting the cap sets `complete: false` and the page says the record
 * starts where the fetch stopped.
 */
export function labelEvents(gh, repo, labels, { maxPages = 8 } = {}) {
  const wanted = new Set(labels)
  const events = []
  let complete = false
  let pages = 0
  for (let page = 1; page <= maxPages; page += 1) {
    const got = ghApi(gh, `repos/${repo}/issues/events?per_page=100&page=${page}`)
    if (!got.read) {
      return { read: events.length > 0, why: got.why, events, complete: false, pages }
    }
    if (!Array.isArray(got.data)) {
      return { read: events.length > 0, why: `gh did not return a list of events on page ${page}`, events, complete: false, pages }
    }
    pages = page
    const hits = got.data
      .filter((e) => (e.event === 'labeled' || e.event === 'unlabeled') && wanted.has(e.label?.name))
      .map((e) => ({
        iso: e.created_at,
        action: e.event,
        label: e.label.name,
        issue: Number(e.issue?.number),
      }))
      .filter((e) => Number.isInteger(e.issue))
    events.push(...hits)
    // A page with none of our labels on it means the labels did not exist yet at that
    // depth: everything older is necessarily older than the first labelling.
    if (hits.length === 0) { complete = true; break }
    if (got.data.length < 100) { complete = true; break }
  }
  return { read: true, why: '', events, complete, pages }
}
