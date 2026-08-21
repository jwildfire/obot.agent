#!/usr/bin/env node
// Build the ranked-head page.
//
//   node tools/rankviz/build.mjs --out ../obot.roadmap/reports/ranked-head/index.html
//
// Reads the declared order out of `rank/top10.json`, walks every commit that has ever
// touched it, asks GitHub for everything the store deliberately does not hold, and
// writes one self-contained HTML file. Nothing on the produced page is hand-maintained:
// running this again re-reads both records, so the page cannot drift from them without
// somebody choosing not to rebuild it.
//
// THE JOIN IS BORROWED. `joinRank` from tools/navigator/rank.mjs is the same function
// the five-minute sweep and the Operations Dashboard use, so this page and those two
// surfaces cannot disagree about what the ten are or about which of them is a finding.
//
// THE BENCH IS LISTED HERE AND COUNTED THERE, ON PURPOSE. The sweep reduces the bench to
// a number so that nothing it prints can be read as a recommendation about who gets
// promoted (rank/README.md). This page lists it because @jwildfire asked to see it —
// naming the shelf to the person whose shelf it is is not the sweep recommending a
// successor to itself.
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { joinRank, readRank, rankTouched, RANK_REL } from '../navigator/rank.mjs'
import { issueByNumber, issuesByLabel, labelEvents } from './github.mjs'
import { readHistory } from './history.mjs'
import { membershipSpan, replayMembership } from './membership.mjs'
import { renderPage } from './render.mjs'

const TZ = 'America/New_York'

/** One finding, said in a sentence a reader can act on. */
function findingText(f, declared) {
  switch (f.kind) {
    case 'slot-open':
      return `Rank ${f.rank} is a slot open: #${f.issue}${f.title ? ` — "${String(f.title).replace(/^Requirement:\s*/, '')}"` : ''} is closed`
        + `${f.closedAt ? ` (${f.closedAt.slice(0, 10)})` : ''}. Something shipped. Choosing the replacement belongs to 🎩🤖 obot-prime and is not decided here or on this page.`
    case 'unlabelled-rank':
      return `#${f.issue} is ranked ${f.rank} in ${RANK_REL} but no longer carries \`${declared.label}\`. The label is membership and the file is order; while they disagree, the one API call returns a different ten than the cards above.`
    case 'unranked-member':
      return `#${f.issue} carries \`${declared.label}\` and has no rank in ${RANK_REL}${f.title ? ` — "${String(f.title).replace(/^Requirement:\s*/, '')}"` : ''}. It is in the ten and the order does not say where.`
    case 'missing':
      return `#${f.issue} is ranked ${f.rank} and GitHub did not return it under \`${declared.label}\`. Its card is held open rather than dropped: a rank that vanishes silently is how an order loses an item nobody notices.`
    case 'count':
      return `The order holds ${f.n}, not ten.`
    default:
      return JSON.stringify(f)
  }
}

/** Everything the page needs, from a checkout and a `gh`. */
export function collect(repoRoot, { gh = 'gh', now = new Date() } = {}) {
  const store = readRank(repoRoot)
  const touched = rankTouched(repoRoot, { now })
  const declared = store.declared
  const history = readHistory(repoRoot)

  const data = {
    generatedAt: now.toISOString(),
    tz: TZ,
    repo: declared.repo,
    label: declared.label,
    benchLabel: declared.bench,
    boundary: declared.boundary,
    order: { read: store.read, why: store.why, touched, rows: [] },
    findings: [],
    live: { read: false, why: '', at: null },
    bench: { read: false, why: '', rows: [] },
    history,
    membership: { read: false, why: '', span: null, states: [], pages: 0 },
    issues: {},
  }

  if (!store.read || !declared.repo || !declared.label) {
    data.live.why = store.read
      ? `${RANK_REL} does not name both a repo and a membership label, so there is nothing to ask GitHub`
      : store.why
    return data
  }

  const head = issuesByLabel(gh, declared.repo, declared.label)
  if (!head.read) {
    data.live.why = head.why
    const { items } = joinRank(declared, null)
    data.order.rows = items
    return data
  }

  // Any ranked issue the label query could not see — the ordinary cause is the event
  // this page is about: something finished and whatever closed it took the label off on
  // the way out. Fetched one by one so those rows still have names.
  const seen = new Set(head.rows.map((r) => r.number))
  const live = [...head.rows]
  for (const r of declared.rank) {
    if (seen.has(r.issue)) continue
    const one = issueByNumber(gh, declared.repo, r.issue)
    if (one) { live.push(one); seen.add(one.number) }
  }

  const { items, findings } = joinRank(declared, live)
  data.order.rows = items
  data.findings = findings.map((f) => ({ kind: f.kind, text: findingText(f, declared) }))
  data.live = { read: true, why: '', at: now.toISOString() }

  // The bench. Its own reading and its own verdict: it failing must not cost the head
  // its cards.
  if (declared.bench) {
    const b = issuesByLabel(gh, declared.repo, declared.bench)
    data.bench = b.read
      ? { read: true, why: '', rows: b.rows.sort((x, y) => y.number - x.number).map((r) => ({ ...r, issue: r.number, rank: null, why: null, review: null, present: true, member: null })) }
      : { read: false, why: b.why, rows: [] }
    for (const r of data.bench.rows) seen.add(r.issue)
  }

  // Every issue that has ever been on the head has to be nameable, or the player draws
  // bare numbers for exactly the items that moved most.
  const inHistory = new Set()
  for (const f of history.frames) for (const r of (f.order || [])) inHistory.add(r.issue)
  for (const r of live) data.issues[r.number] = { title: r.title, url: r.url, state: r.state }
  for (const r of data.bench.rows) data.issues[r.issue] = { title: r.title, url: r.url, state: r.state }
  for (const n of inHistory) {
    if (data.issues[n]) continue
    const one = issueByNumber(gh, declared.repo, n)
    if (one) data.issues[n] = { title: one.title, url: one.url, state: one.state }
  }

  // The membership record — the only part of this page that reaches back past the
  // store's first commit, and the only one with a truncation trap.
  const labels = [declared.label, declared.bench].filter(Boolean)
  const ev = labelEvents(gh, declared.repo, labels)
  if (ev.read) {
    const { states } = replayMembership(ev.events, { labels })
    data.membership = {
      read: true,
      why: ev.why,
      span: membershipSpan(ev.events, { complete: ev.complete }),
      states,
      pages: ev.pages,
    }
  } else {
    data.membership = { read: false, why: ev.why, span: null, states: [], pages: ev.pages }
  }

  return data
}

// ---------------------------------------------------------------------------

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const arg = (name, fallback) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
  }
  const repoRoot = resolve(arg('repo-root', resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')))
  const out = arg('out', null)
  const data = collect(repoRoot)
  const html = renderPage(data)
  if (!out || out === '-') {
    process.stdout.write(html)
  } else {
    const file = resolve(out)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, html)
    process.stderr.write(`${file}\n`)
    process.stderr.write(`  ${data.order.rows.length} ranked, ${data.bench.rows.length} on the bench, `
      + `${data.history.frames.length} frames (${data.history.unreconstructed} unreconstructed), `
      + `${data.findings.length} findings, membership ${data.membership.read ? `${data.membership.states.length} acts${data.membership.span?.complete ? '' : ' (TRUNCATED)'}` : `UNREAD: ${data.membership.why}`}\n`)
  }
  // Exit 0 whichever way the readings went: "GitHub could not be read" is a result this
  // page has a sentence for, and a non-zero exit would hand the caller an error where it
  // needs a page that knows why it is thin.
  process.exit(0)
}
