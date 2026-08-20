// carveout — a pull request that only @jwildfire's hands can merge, routed to the
// bucket that exists for exactly that (obot.agent#264, under jwildfire/obot.roadmap#220).
//
// THE GAP THIS CLOSES. His queue holds three buckets and nothing else: release
// candidates, decisions, config items. A pull request on the attested lane — one
// touching a carve-out path, which only he can approve — belongs in the third,
// because it is precisely a thing only his hands can clear. Nothing put it there.
// c0016 exists for obot.agent#198 because a person noticed and filed it by hand, and
// on a night nobody was looking that pull request would have sat unrouted: not a
// release candidate, so never in his review queue, and unmergeable by any agent, so
// never cleared.
//
// The condition is COMPUTED, not noticed. `obot-merge --check` already prints, on
// its own authority, that a carve-out path is touched and that the lane it forced
// admits no agent. Reading that output is the whole detector — the same shape as the
// ledger audits the sweep already shells for their verdict, and deliberately not a
// second implementation of the carve-out rules, which live in `scripts/policy.json`
// and are @jwildfire's.
//
// THREE PROPERTIES THIS FILE EXISTS TO GUARANTEE:
//
// 1. NOTHING IS RAISED TWICE. Raising c0016 again every five minutes is worse than
//    never raising it: a list he cannot trust is one he stops reading, which is the
//    failure the whole three-bucket rule was written against. Coverage is computed
//    from the open config list by PULL REQUEST REFERENCE — not by headline, which
//    changes when a title is reworded — and it stops the raise before an id is
//    claimed, so a refused re-file costs nothing and leaves no journal line.
//
// 2. A FAILED READ IS NEVER AN EMPTY LIST. An unreadable config list produces the
//    same empty coverage map as a list with nothing in it, and those two decide
//    opposite things: one means "raise it" and one means "we do not know". So
//    `readCoverage` carries a `read` flag, every caller is required to consult it,
//    and nothing is raised or suppressed on a read that did not happen. ENOENT is
//    the single failure allowed to read as absence (obot.agent#206/#215).
//
// 3. CRITICAL IS EARNED, NEVER CLAIMED. There is no flag for it here and none is
//    invented. The raise passes the issues the pull request closes as `--blocks`,
//    and `tools/blocker-log` asks GitHub whether they are open; a reference that
//    does not resolve earns exactly nothing. This module never composes the tag.
//
// What is NOT here, on purpose: any judgement about whether the merge should happen.
// The item asks him to run the merge he already has the authority for, and the fact
// that it is his to run is the entire content of the finding.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { readFailure } from '../ops-dashboard/lib/absent.mjs'
// What a release candidate IS, from the one function that decides it for the sweep
// and the dashboard alike. Imported rather than restated: a second definition here
// would let a pull request be an RC over there and a config item over here, which is
// exactly the duplication jwildfire/obot.roadmap#220 is about — "two mechanisms
// reaching him about one thing, because neither can see what the other has done".
import { classifyRC } from './classify.mjs'

/** The config list, in the one place it lives. Local only — it never enters a repo
 *  or a published site, and only its ids and counts ever render anywhere. */
export const configFile = (workspace) => join(workspace, '.claude', 'blockers.md')

/** `owner/repo#number`, the key everything here joins on. */
export const prKey = (repo, number) => `${repo}#${number}`

/** The short form a reader recognises: `obot.agent#198`. */
export const shortRef = (repo, number) => `${String(repo).replace(/^jwildfire\//, '')}#${number}`

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

// ---- reading `obot-merge --check` -------------------------------------------

/**
 * One `--check` run, parsed.
 *
 * POSITIVE PARSE, and that is the design call worth stating. Every field defaults to
 * "not seen" rather than to a safe-looking value, and `ok` is true only when the
 * header line AND a terminal verdict line were both found. A wording change in
 * obot-merge — a file this work may not touch and does not control — therefore turns
 * this into a reading that FAILED, which is reported, instead of a reading that found
 * no carve-out, which is silent and indistinguishable from a healthy lane. That
 * silent shape is this codebase's signature defect and it is worth the extra field.
 */
export function parseCheck(stdout = '', stderr = '') {
  const text = `${stdout}\n${stderr}`
  const out = {
    ok: false,
    number: null,
    url: null,
    title: null,
    base: null,
    state: null,
    role: null,
    profile: null,
    carveOut: [],
    forcedAttested: false,
    closes: [],
    tier: null,
    approvalRequired: false,
    decisionCarried: false,
    refused: null,
    verdict: null,
  }
  let sawHeader = false
  let sawVerdict = false
  for (const raw of String(text).split('\n')) {
    const l = raw.replace(/\s+$/, '')
    let m
    if ((m = /^PR #(\d+)\s+(\S+)/.exec(l))) { out.number = Number(m[1]); out.url = m[2]; sawHeader = true; continue }
    if ((m = /^\s+title:\s*(.*)$/.exec(l))) { out.title = m[1].trim(); continue }
    if ((m = /^\s+base:\s+(\S+)\s+state:\s+(\S+)/.exec(l))) { out.base = m[1]; out.state = m[2]; continue }
    if ((m = /^\s+policy: profile (\S+?)(?:,\s*role (\S+))?\s*$/.exec(l))) { out.profile = m[1]; out.role = m[2] ?? null; continue }
    if ((m = /^\s+policy: carve-out path touched, attested lane forced \(([^)]*)\)/.exec(l))) {
      out.carveOut = m[1].split(',').map((s) => s.trim()).filter(Boolean)
      out.forcedAttested = true
      continue
    }
    // The authority gate forces the same lane for a different reason — the guardrail
    // under the tool's feet is not the one in force. Recorded so `forcedAttested` is
    // honest, and deliberately NOT sufficient to raise an item: see `needsRoute`.
    if (/attested lane forced/.test(l)) { out.forcedAttested = true; continue }
    if ((m = /^\s+closes:\s*(.*)$/.exec(l))) {
      out.closes = [...m[1].matchAll(/#(\d+)/g)].map((c) => Number(c[1]))
      continue
    }
    if ((m = /^\s+policy:\s+PASS - (.*)$/.exec(l))) {
      out.tier = m[1].trim()
      out.approvalRequired = /approval tier/i.test(m[1])
      out.decisionCarried = /recorded decision/i.test(m[1])
      continue
    }
    if ((m = /^obot-merge: REFUSED - (.*)$/.exec(l))) { out.refused = m[1].trim(); sawVerdict = true; continue }
    if ((m = /^obot-merge: CHECK(?: PASSED)? - (.*)$/.exec(l))) { out.verdict = m[1].trim(); sawVerdict = true; continue }
  }
  out.ok = sawHeader && sawVerdict
  return out
}

/**
 * Does this pull request need a config item raised for it?
 *
 * Four conditions, and every one of them narrows deliberately:
 *
 *   the check was READ — an unparsed run is not a clean lane (property 2 above).
 *   a CARVE-OUT PATH is touched — not merely "the attested lane was forced". The
 *     authority gate forces the same lane when the policy copy under the tool's feet
 *     cannot be verified, and that is an outage, not something his keyboard fixes.
 *     The config list's own scope test (BL1) admits an item only when his physical
 *     access is the sole missing ingredient, so an authority mismatch fails it.
 *   the base is the INTEGRATION branch — a release-role base is a release candidate
 *     by definition, and a release candidate is bucket one. Routing it to config
 *     would put one piece of work in two of his three buckets at once.
 *   NO APPROVAL CARRIES IT — a merge already carried by a recorded decision needs
 *     nothing from him, and an item asking for what is already granted is exactly
 *     the false entry the three-bucket rule exists to keep off his list.
 */
export function needsRoute(check) {
  if (!check?.ok) return false
  if (!check.carveOut.length) return false
  if (check.role && check.role !== 'integration') return false
  if (check.state && check.state !== 'OPEN') return false
  if (check.decisionCarried) return false
  return check.approvalRequired === true
}

// ---- reading the config list -------------------------------------------------

/**
 * Every pull request an entry names, as `owner/repo#n`.
 *
 * Three unambiguous forms and no others. `owner/repo#12` on its own is NOT read,
 * because it cannot tell a pull request from an issue — and c0016's `Blocks:` field
 * names an ISSUE by exactly that spelling, so a looser reader would have concluded
 * that c0016 covers obot.agent#197 and left #198 uncovered while reporting success.
 * Each form below can only ever be a pull request:
 *
 *   https://github.com/owner/repo/pull/198     the Source field, and any link
 *   obot-merge 198 -R owner/repo               the Do field's merge command
 *   gh pr view 198 -R owner/repo               the Verify field's proof
 */
export function prRefs(entry = '') {
  const text = String(entry)
  const out = new Set()
  for (const m of text.matchAll(/https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g)) out.add(prKey(m[1], Number(m[2])))
  for (const m of text.matchAll(/obot-merge\s+(\d+)\s+-R\s+([\w.-]+\/[\w.-]+)/g)) out.add(prKey(m[2], Number(m[1])))
  for (const m of text.matchAll(/gh\s+pr\s+\w+\s+(\d+)\s+-R\s+([\w.-]+\/[\w.-]+)/g)) out.add(prKey(m[2], Number(m[1])))
  return out
}

/**
 * Open config items, as a map from pull request to the ids covering it.
 *
 * OPEN ONLY, and the bound is load-bearing in both directions. A retired entry no
 * longer covers anything — c0015 was retired for a verify that could not fail and
 * refiled as c0016, and had the retired copy still counted, the refile this work
 * automates would have been refused. A ticked entry describes a merge that already
 * happened, and the pull request it names is closed, so it can never be a candidate
 * again either way.
 *
 * Only ids and pull request numbers are kept. No headline, no body, nothing that
 * could reach a surface as text: this map is consumed by the admiral's section,
 * which renders on a page, and the containment rule on the config list is absolute.
 */
export function coverageFrom(md = '') {
  const covered = new Map()
  const lines = String(md).split(/\r?\n/)
  const start = lines.findIndex((l) => /^##\s+.*\bopen\b/i.test(l))
  if (start === -1) return covered
  let buf = null
  const flush = () => {
    if (!buf) return
    const entry = buf.join('\n')
    // `- [x]` is done or retired; either way it covers nothing any more.
    if (!/^-\s+\[[ ]\]/.test(buf[0])) { buf = null; return }
    const id = buf[0].match(/^-\s+\[.\]\s*(c\d{4})\b/i)?.[1]?.toLowerCase() ?? null
    for (const ref of prRefs(entry)) {
      if (!covered.has(ref)) covered.set(ref, [])
      if (id && !covered.get(ref).includes(id)) covered.get(ref).push(id)
    }
    buf = null
  }
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break
    if (/^-\s/.test(lines[i])) { flush(); buf = [lines[i]] }
    else if (buf !== null) buf.push(lines[i])
  }
  flush()
  return covered
}

/**
 * Coverage from the workspace, with the reading itself reported.
 *
 * `read: false` is not `covered: {}`. The first means nobody looked and nothing may
 * be decided on it — neither a raise nor a suppression; the second means the list
 * was read and covers nothing, which is a fact callers may act on. Only ENOENT
 * counts as absence, and an absent list IS a real reading of an empty one: a machine
 * with no config list has nothing covered, which is true.
 */
export function readCoverage(workspace) {
  const file = configFile(workspace)
  let md
  try { md = readFileSync(file, 'utf8') } catch (e) {
    const f = readFailure(e, file)
    if (f.absent) return { read: true, absent: true, covered: new Map(), why: null }
    return { read: false, absent: false, covered: new Map(), why: f.why }
  }
  return { read: true, absent: false, covered: coverageFrom(md), why: null }
}

// ---- what to check, and what to file ----------------------------------------

/**
 * How old a pull request must be before its lane is worth a `--check`.
 *
 * Measured, like every other bar in this fleet: median open-to-merge is 3 minutes in
 * obot.agent and 17 in obot.roadmap (tools/navigator/admiral.mjs, from the last 81
 * merges). A pull request its own author is about to land does not need routing to
 * anybody, and `--check` is not free — it costs a paginated file listing and a
 * mergeability poll per call. 20 minutes clears both medians and still routes a
 * carve-out change within one sweep of it going quiet.
 */
export const CHECK_AFTER_MIN = 20

/** How many `--check` calls one run may make. A bound, not a cap on coverage: what
 *  is skipped is named in the section and checked on the next sweep, because a run
 *  that silently examined four of forty would read as forty examined. */
export const MAX_CHECKS = 4

/**
 * Which open pull requests this run should spend a `--check` on.
 *
 * Cheap tests only — every one of these is answered by data `gh pr list` already
 * returned, so the expensive call is made for a candidate and never to find one.
 * Oldest first, so a pull request that has been sitting longest is routed first when
 * the bound bites.
 */
export function candidates(prs = [], { now = new Date(), covered = new Map(),
                                       afterMin = CHECK_AFTER_MIN, max = MAX_CHECKS,
                                       checked = {} } = {}) {
  const rows = []
  const skipped = []
  for (const pr of prs) {
    if (pr.isDraft) continue
    if (pr.baseRefName !== pr.integration) continue
    // ALREADY IN BUCKET ONE. A release candidate is his to look at by the route built
    // for that, and an item asking for the same pull request a second time is one
    // piece of work in two of his three buckets — the duplication the requirement
    // names outright. `needsRoute` refuses a release-role base later on the wrapper's
    // own reading; this catches the other two ways a pull request becomes an RC,
    // which the wrapper's output cannot see.
    if (classifyRC(pr, pr.release ?? [])) continue
    const key = prKey(pr.repo, pr.number)
    // Already routed. Checked BEFORE the age bar and before any call, so an item that
    // exists costs this run nothing at all.
    if (covered.has(key)) continue
    const mins = (now.getTime() - Date.parse(pr.updatedAt ?? '')) / 60000
    if (!Number.isFinite(mins) || mins < afterMin) continue
    // A lane that was read clean at this exact revision is not re-read. Keyed on
    // `updatedAt`, which moves on every push, comment and review — so a pull request
    // that GAINS a carve-out path in a new commit is checked again, and one that has
    // not changed is not checked forty times a day.
    if (checked[key] && checked[key].updatedAt === pr.updatedAt) continue
    rows.push({ ...pr, key, mins: Math.round(mins) })
  }
  rows.sort((a, b) => b.mins - a.mins)
  if (rows.length > max) skipped.push(...rows.slice(max))
  return { check: rows.slice(0, max), skipped }
}

/**
 * The `tools/blocker-log` argv for one routed pull request.
 *
 * The entry is an installation qualification because that is what @jwildfire asked
 * these to be — the exact action, what he should see, and a command that proves it —
 * and c0016, the hand-filed item this automates, is the shape it copies.
 *
 * The verify is the one field with a contract: it must exit 0 EXACTLY when the item
 * is done. `gh pr view --json state --jq .state` exits 0 whether the answer is OPEN
 * or MERGED, which is why c0015 was retired — it would have recorded a pass while
 * the merge was still outstanding. The `grep -qx MERGED` is what makes the exit code
 * mean something.
 *
 * `--blocks` carries the issues the pull request closes and nothing else. It is the
 * only route to the critical tag, it is checked against GitHub by blocker-log rather
 * than asserted here, and an unresolvable reference earns nothing.
 */
export function raiseArgs(check, { repo }) {
  const ref = shortRef(repo, check.number)
  const paths = check.carveOut.join(', ')
  const url = check.url ?? `https://github.com/${repo}/pull/${check.number}`
  const closes = check.closes.map((n) => `${repo}#${n}`)
  const args = [
    `Merge ${ref} — ${clip(check.title ?? 'a carve-out change', 90)}`,
    '--do', `obot.agent/scripts/obot-merge ${check.number} -R ${repo} --squash --delete-branch --jeremy-approved '<where and when you approved it>'`,
    '--expect', `The wrapper prints CHECK PASSED then MERGED, and ${url} shows Merged with the branch deleted.`,
    '--verify', `gh pr view ${check.number} -R ${repo} --json state --jq .state | grep -qx MERGED -> silent and exit 0, but only once the PR is actually merged`,
  ]
  if (closes.length) {
    args.push('--unblocks', `Closes ${closes.join(', ')} — they stay open until this merges.`)
  } else {
    args.push('--unblocks', `Lands ${ref}. No agent lane can: a carve-out merge never goes through on nobody's authority.`)
  }
  args.push('--source', url)
  for (const c of closes) args.push('--blocks', c)
  args.push('--why', `It touches ${paths} — all carve-out paths — so obot-merge forces the attested lane and no agent can clear it. Raised automatically by tools/carveout-route from obot-merge --check; nothing about the pull request was changed.`)
  return args
}

// ---- the section the sweep folds --------------------------------------------

/**
 * The alarm headline, spelled for `ALARM_RE` in tools/ops-dashboard/lib/navigator.mjs.
 *
 * That regex is case-sensitive ALL CAPS keyed on GAP/FINDING/BREACHED/FAILED/DOWN/
 * BROKEN, and its character class is `[A-Z0-9 ]` — nothing else. This constant was
 * first written `**CARVE-OUT ROUTING FAILED**`, which reads correctly, says the right
 * thing, contains FAILED, and renders on his page as ordinary grey text: the HYPHEN
 * is outside the character class and drops the match entirely. Its test caught it
 * before he ever saw it, which is the whole argument for asserting the wording
 * against the imported regex instead of reading it (obot.agent#129).
 */
export const ALARM_ROUTE_FAILED = '**CONFIG ROUTING FAILED**'

/** One spelling of the heading, so the router's section and the sweep's fallbacks
 *  cannot land under two different headings on the same page. */
export const SECTION_HEAD = '## Carve-out routing — a PR only he can merge, in the bucket for it'

/**
 * The section a run that did not happen leaves behind.
 *
 * A section that simply VANISHES reads as a page with nothing to report, which is the
 * house rule the sweep already applies to the admiral, the wake and the checkout —
 * and the reason it applies here too is that the whole point of this section is to be
 * the place a carve-out pull request appears. Silence in exactly that spot is
 * indistinguishable from "he has nothing waiting", which is the claim least safe to
 * make by accident. Shared, so the router and the two fallbacks in the sweep cannot
 * drift into three spellings of one headline — one of which would miss the regex.
 */
export const routingBroken = (why) =>
  `${SECTION_HEAD}\n\n${ALARM_ROUTE_FAILED} — ${clip(why, 200)}. No lane was read this pass, so nothing here says a carve-out pull request has been routed to him.\n`

/**
 * `## Carve-out routing`, for navigator-state.md.
 *
 * IDS AND COUNTS ONLY. Not one word of a config item's text appears here or can: the
 * inputs to this function carry ids and pull request numbers and nothing else, which
 * is a containment enforced by the shape of the data rather than by remembering. The
 * config list is local-only and this section renders on a page.
 */
export function carveoutSection({ raised = [], covered = [], checked = 0, skipped = 0,
                                  errors = [], coverageRead = true, coverageWhy = null,
                                  dryRun = false } = {}) {
  const lines = [SECTION_HEAD, '']
  if (!coverageRead) {
    lines.push(`${ALARM_ROUTE_FAILED} — the config list could not be read this pass${coverageWhy ? `: ${clip(coverageWhy, 160)}` : ''}. Nothing was raised and nothing was suppressed; an unreadable list is not an empty one.`)
    return lines.join('\n') + '\n'
  }
  if (raised.length) {
    for (const r of raised) {
      lines.push(`raised ${r.id ?? 'a config item'} — ${r.ref} touches ${r.paths.join(', ')}, so only @jwildfire can merge it`)
    }
  }
  if (covered.length) {
    // The one line that ends the recurring escalation, and it names the pair so a
    // reader can see WHY the admiral went quiet about a pull request rather than
    // discovering an unexplained silence.
    lines.push(`already routed: ${covered.length} pull request(s) covered by an open config item — ` +
               covered.map((c) => `${c.ref} · ${c.ids.join(', ')}`).join(' · '))
  }
  if (!raised.length && !covered.length) {
    lines.push(`carve-out routing: nothing to route — ${checked} lane(s) checked, none forced the attested lane on a carve-out path`)
  } else {
    lines.push(`  ${checked} lane(s) checked this pass${dryRun ? ' · DRY RUN, nothing was filed' : ''}`)
  }
  if (skipped) lines.push(`  ${skipped} candidate(s) over the per-run bound, checked next pass — not examined, not cleared`)
  for (const e of errors) lines.push(`  unread: ${clip(e, 180)}`)
  return lines.join('\n') + '\n'
}
