// rankhead — the ranked head, as the sweep sees it (jwildfire/obot.roadmap#278).
//
// WHY THE SWEEP CARRIES THIS AT ALL. @jwildfire set the replacement rule: when a
// requirement in the top ten finishes, the next is promoted. Done by hand that rots
// inside a fortnight — every hand-maintained list in this program has — and the
// condition is computable: a `top10` label on a CLOSED issue is a slot open, exactly
// the same shape as a carve-out pull request with no approval. The sweep already
// reads GitHub every five minutes, so nobody has to remember that a slot opened.
//
// WHAT THIS FILE IS FORBIDDEN TO DO, and both are asserted rather than promised:
//
// 1. IT NEVER CHOOSES THE REPLACEMENT. That is strategy, it belongs to 🎩🤖 obot-prime,
//    and a finding that named a successor would have made the call by implication.
//    The bench reaches this section as a COUNT and never as a list, which is a
//    containment in the shape of the data rather than in anyone's restraint.
//
// 2. IT NEVER REACHES @jwildfire. His queue holds three buckets and this is not a
//    fourth (jwildfire/obot.roadmap#220). Nothing here raises a config item, and the
//    word "@jwildfire" does not appear in anything this renders. A slot opening is
//    normal — it means something shipped — so it is reported in plain text and gets
//    no alarm. What DOES get an alarm is a read that did not happen and a membership
//    disagreement, because those are states where the surface would otherwise be
//    quietly wrong.
//
// The section prints on a clean pass too. A detector that only ever speaks up on
// failure is indistinguishable from a dead one — the same rule the ledgers, the
// checks and the carve-out router already follow.
import { execFileSync } from 'node:child_process'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { joinRank, readRank, rankTouched, RANK_REL } from './rank.mjs'

/** One spelling of the heading, so the section and its fallbacks cannot drift apart. */
export const SECTION_HEAD = '## Ranked head — the next ten, in order (rank declared, everything else derived)'

/**
 * The alarm headline, spelled for `ALARM_RE` in tools/ops-dashboard/lib/navigator.mjs.
 * That regex is case-sensitive ALL CAPS over `[A-Z0-9 ]` keyed on
 * GAP/FINDING/BREACHED/FAILED/DOWN/BROKEN — a hyphen anywhere in it drops the match,
 * which is how `**CARVE-OUT ROUTING FAILED**` once rendered as ordinary grey text.
 */
export const ALARM_READ_BROKEN = '**RANK HEAD READING BROKEN**'

/** Membership disagreeing with the order. Not a failure of the machine, but a state
 *  in which the page is quietly wrong about what the next ten are. */
export const ALARM_MEMBERSHIP = '**MEMBERSHIP FINDING**'

/** The order not holding ten. */
export const ALARM_COUNT = '**RANK HEAD COUNT GAP**'

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

/** How old, in the house's words. Never "just now" for something nobody measured. */
const age = (min) => {
  if (min === null || min === undefined || !Number.isFinite(min)) return null
  if (min < 60) return `${Math.max(0, Math.round(min))}m old`
  const h = min / 60
  return h < 48 ? `${Math.round(h)}h old` : `${Math.round(h / 24)}d old`
}

/**
 * When the rank was last touched, said in one clause.
 *
 * An unknown age is printed as unknown. It is never rendered as a zero and never
 * omitted: a list that has not been touched in three days has to say so, and the
 * failure that prompted this requirement is two state files in this program that are
 * stale right now and neither admits it.
 */
export const touchedPhrase = (t) => (t?.read
  ? `rank last touched ${t.iso.slice(0, 10)} (${age(t.ageMin)}${t.dirty ? ', edited since and not committed' : ''})`
  : `rank last touched: **not known** — ${clip(t?.why || `${RANK_REL} could not be dated`, 140)}`)

/** The section a pass that did not happen leaves behind. Never absent: silence in
 *  exactly this spot reads as a head with nothing to report. */
export const readingBroken = (why) =>
  `${SECTION_HEAD}\n\n${ALARM_READ_BROKEN} — ${clip(why, 200)}. Nothing here says whether the ranked head is still ten open requirements, or how old the order is.\n`

/**
 * `## Ranked head`, for navigator-state.md.
 *
 * Everything except the rank number and the one-line reason comes from `live`, which
 * is what GitHub returned for the membership label this pass. `live: null` is an
 * unread GitHub and produces no findings at all — an unread list is not an empty one,
 * and it is certainly not a clean one.
 */
export function rankheadSection({
  declared = { rank: [] }, live = null, read = true, why = '',
  touched = null, bench = null,
  declaredRead = true, declaredAbsent = false, declaredWhy = '',
} = {}) {
  const lines = [SECTION_HEAD, '']

  // The declaration itself is the first thing that can fail, and an absent one is a
  // fault rather than an emptiness: `rank/top10.json` is committed, so a checkout
  // without it is a checkout that is wrong, not a program with no opinion.
  if (!declaredRead) {
    lines.push(`${ALARM_READ_BROKEN} — ${clip(declaredWhy || `${RANK_REL} could not be read`, 200)}${
      declaredAbsent ? '' : ''}. No order was read this pass, so nothing here states what comes next.`)
    return lines.join('\n') + '\n'
  }

  if (!read) {
    lines.push(`${ALARM_READ_BROKEN} — ${clip(why || 'GitHub was not read this pass', 200)}. The order is declared and readable; what could not be read is the state beside it, so nothing below is derived and an unread head is not an empty one.`)
    lines.push('')
    lines.push(`  ${declared.rank.length} ranked in ${RANK_REL} · ${touchedPhrase(touched)}`)
    return lines.join('\n') + '\n'
  }

  const { items, findings } = joinRank(declared, live)
  lines.push(`${declared.rank.length} ranked · ${touchedPhrase(touched)} · membership from \`${declared.label}\` on ${declared.repo}, every other field derived this pass`)
  lines.push('')
  for (const it of items) lines.push(`  ${it.rank}. #${it.issue} ${rowState(it)} — ${clip(it.why || 'no reason recorded', 160)}${it.review ? ` [under review: ${clip(it.review, 120)}]` : ''}`)
  lines.push('')
  if (declared.boundary) lines.push(`  boundary: ${clip(declared.boundary, 240)}`)

  if (!findings.length) {
    lines.push('  no findings: every ranked issue is open, still carries the label, and nothing outside the order carries it')
    return lines.join('\n') + '\n'
  }
  for (const f of findings) lines.push(`  ${findingLine(f, declared, bench)}`)
  return lines.join('\n') + '\n'
}

const rowState = (it) => {
  if (!it.present) return 'NOT RETURNED by GitHub this pass'
  const bits = [it.state ?? 'state unknown']
  if (it.milestone) bits.push(it.milestone)
  if (it.blocked) bits.push('blocked')
  if (it.sub) bits.push(`${it.sub.completed}/${it.sub.total} sub-issues`)
  if (it.title) bits.push(`"${clip(it.title.replace(/^Requirement:\s*/, ''), 70)}"`)
  return bits.join(' · ')
}

/**
 * One finding, one line.
 *
 * The slot line is the one this module exists for, and it is the one that must stay
 * plain: a slot opening means something shipped. It names the rank and the issue that
 * closed and then stops — the bench appears as a count so that no reading of this line
 * can be mistaken for a recommendation.
 */
function findingLine(f, declared, bench) {
  switch (f.kind) {
    case 'slot-open':
      return `slot open at rank ${f.rank} — #${f.issue} is closed${f.closedAt ? ` (${f.closedAt.slice(0, 10)})` : ''}${f.title ? `, "${clip(f.title.replace(/^Requirement:\s*/, ''), 60)}"` : ''}. The replacement is 🎩🤖 obot-prime's call and is not chosen here; ${benchPhrase(declared, bench)}`
    case 'unlabelled-rank':
      return `${ALARM_MEMBERSHIP} — #${f.issue} is ranked ${f.rank} in ${RANK_REL} but no longer carries \`${declared.label}\`. The label is membership and the file is order; while they disagree, the one API call he asked for returns a different ten than this list shows.`
    case 'unranked-member':
      return `${ALARM_MEMBERSHIP} — #${f.issue} carries \`${declared.label}\` and has no rank in ${RANK_REL}${f.title ? `, "${clip(f.title.replace(/^Requirement:\s*/, ''), 60)}"` : ''}. It is in the ten and the order does not say where.`
    case 'missing':
      return `${ALARM_MEMBERSHIP} — #${f.issue} is ranked ${f.rank} and GitHub did not return it under \`${declared.label}\`. Its row is held open rather than dropped; a rank that vanishes silently is how an order loses an item nobody notices.`
    case 'count':
      return `${ALARM_COUNT} — the order holds ${f.n}, not ten.`
    default:
      return `unrecognised finding: ${clip(JSON.stringify(f), 120)}`
  }
}

/** The bench, as a number. Never as a list — see the header. */
const benchPhrase = (declared, bench) => {
  if (!declared.bench) return `${RANK_REL} names no bench label, so where a replacement comes from is undeclared.`
  if (!bench?.read) return `the \`${declared.bench}\` bench could not be counted this pass${bench?.why ? ` (${clip(bench.why, 120)})` : ''}.`
  return `the \`${declared.bench}\` bench holds ${bench.open} open issue${bench.open === 1 ? '' : 's'} to promote from.`
}

// ---------------------------------------------------------------------------
// Reading GitHub — the one call he asked for, run twice
// ---------------------------------------------------------------------------

/**
 * @jwildfire, 2026-08-19: "it becomes a simple github api call to get the list."
 * This is that call. REST rather than `gh issue list`, for one reason: the REST issues
 * endpoint carries `sub_issues_summary`, and sub-issue progress is one of the things
 * the panel derives rather than declares.
 */
export const issuesQuery = (repo, label) =>
  `repos/${repo}/issues?labels=${encodeURIComponent(label)}&state=all&per_page=100`

/**
 * One issue, by number.
 *
 * The label query cannot see an issue that no longer carries the label, and the most
 * ordinary way for that to happen is the very event this module exists to notice:
 * a requirement finishes, it is closed, and whatever closed it takes `top10` off on
 * the way out. Three of the first ten did exactly that within an hour of the label
 * being created. Without this, those three vanish from the head entirely and the
 * surface reports "GitHub did not return it" — true, unhelpful, and silent about the
 * three open slots that are the whole point.
 *
 * Called only for ranked issues the label query did not return, so it costs nothing
 * on a clean pass and at most one call per rank on the worst one.
 */
function ghIssue(gh, repo, number) {
  let out
  try {
    out = execFileSync(gh, ['api', `repos/${repo}/issues/${number}`], {
      encoding: 'utf8', timeout: 30000, maxBuffer: 2 << 20, stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch { return null }
  try {
    const raw = JSON.parse(out)
    return raw && raw.number ? shape(raw) : null
  } catch { return null }
}

function ghIssues(gh, repo, label) {
  let out
  try {
    out = execFileSync(gh, ['api', issuesQuery(repo, label)], {
      encoding: 'utf8', timeout: 60000, maxBuffer: 8 << 20, stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    const said = String(e?.stderr || e?.message || '').split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
    return { read: false, why: said || `gh exited without saying why while listing \`${label}\``, rows: null }
  }
  let raw
  try { raw = JSON.parse(out) } catch {
    return { read: false, why: `gh returned ${out.length} bytes that are not JSON while listing \`${label}\``, rows: null }
  }
  if (!Array.isArray(raw)) {
    return { read: false, why: `gh did not return a list of issues for \`${label}\``, rows: null }
  }
  return { read: true, why: '', rows: raw.filter((r) => !r.pull_request).map(shape) }
}

/** GitHub's shape, reduced to what this surface derives from. */
const shape = (r) => ({
  number: Number(r.number),
  state: r.state ?? null,
  title: r.title ?? null,
  url: r.html_url ?? null,
  labels: (r.labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean),
  milestone: r.milestone?.title ?? null,
  sub: r.sub_issues_summary
    ? { completed: Number(r.sub_issues_summary.completed) || 0, total: Number(r.sub_issues_summary.total) || 0 }
    : null,
  closedAt: r.closed_at ?? null,
})

/**
 * Everything the section needs, from a checkout and a `gh`.
 *
 * Synchronous, like the rest of the sweep. `gh` is injectable so the tests drive a
 * real child process with a real argv and real bytes on stdout — the parse, the flags
 * and the failure path are the parts that break, and a stub that returns a literal
 * exercises none of them.
 */
export function collectRankHead(repoRoot, { gh = 'gh', now = new Date() } = {}) {
  const store = readRank(repoRoot)
  const touched = rankTouched(repoRoot, { now })
  const base = {
    declared: store.declared, declaredRead: store.read, declaredAbsent: store.absent,
    declaredWhy: store.why, touched, read: false, why: '', live: null,
    bench: { read: false, why: '', open: null },
  }
  if (!store.read) return { ...base, why: store.why, bench: { read: false, why: store.why, open: null } }
  const { repo, label } = store.declared
  if (!repo || !label) {
    const why = `${RANK_REL} does not name both a repo and a membership label, so there is nothing to ask GitHub`
    return { ...base, why, bench: { read: false, why, open: null } }
  }

  const head = ghIssues(gh, repo, label)
  if (!head.read) return { ...base, why: head.why, bench: { read: false, why: head.why, open: null } }

  // Fill in any ranked issue the label query could not see — see `ghIssue`. A row that
  // still cannot be fetched stays absent and is reported as such; guessing at it would
  // be worse than saying nothing.
  const seen = new Set(head.rows.map((r) => r.number))
  const live = [...head.rows]
  for (const r of store.declared.rank) {
    if (seen.has(r.issue)) continue
    const one = ghIssue(gh, repo, r.issue)
    if (one) live.push(one)
  }

  // The bench is a separate reading and a separate verdict. It failing must not cost
  // the head its reading — the head is the thing on his page, and the bench is one
  // count inside one finding.
  let bench = { read: false, why: `${RANK_REL} names no bench label`, open: null }
  if (store.declared.bench) {
    const b = ghIssues(gh, repo, store.declared.bench)
    bench = b.read
      ? { read: true, why: '', open: b.rows.filter((r) => r.state === 'open').length }
      : { read: false, why: b.why, open: null }
  }
  return { ...base, read: true, why: '', live, bench }
}

// ---------------------------------------------------------------------------
// Child entrypoint — `node tools/navigator/rankhead.mjs <obot.agent checkout>`
//
// The Operations Dashboard refreshes its cache by spawning this rather than
// re-implementing the two `gh` calls. One implementation, so the sweep's section and
// the page's panel can never disagree about what the ten are — and out of process, so
// two synchronous network calls never block a render.
// ---------------------------------------------------------------------------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2]
  if (!root) {
    process.stderr.write(`usage: ${basename(fileURLToPath(import.meta.url))} <obot.agent-checkout>\n`)
    process.exit(2)
  }
  const got = collectRankHead(root)
  process.stdout.write(JSON.stringify(got))
  // Exit 0 whichever way it went: "GitHub could not be read" is a RESULT this program
  // has a sentence for, and turning it into a non-zero exit would hand the caller an
  // error string where it needs a reading that knows why it is empty.
  process.exit(0)
}
