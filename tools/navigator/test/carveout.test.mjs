// Carve-out routing (obot.agent#264, under jwildfire/obot.roadmap#220).
//
// The properties held here are the ones whose violation is SILENT — which is the only
// reason this file is as long as it is:
//
//   A duplicate raise looks like a working detector. c0016 re-filed every five
//   minutes would still print "raised" on every sweep, and the damage lands days
//   later when he stops reading a list he cannot trust.
//   A failed read looks like a clean lane. An unparsed `--check` and a lane with no
//   carve-out path produce the same empty `carveOut` array, and one of them means
//   "nothing to do" while the other means "we did not find out".
//   A suppressed escalation looks like a quiet fleet. A pull request excluded from
//   the admiral's candidates simply is not there, and without the line that names it
//   a reader cannot tell the exclusion from a detector that stopped working.
//   A headline that misses ALARM_RE renders as ordinary grey text on the page he
//   reads, which is why the regex is IMPORTED here and never copied (obot.agent#129).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ALARM_ROUTE_FAILED, CHECK_AFTER_MIN, SECTION_HEAD, candidates, carveoutSection,
         coverageFrom, needsRoute, parseCheck, prRefs, raiseArgs, readCoverage,
         routingBroken } from '../carveout.mjs'
import { UNROUTED_NOTE, admiralSection, routedPRs, stuckPRs, triggers } from '../admiral.mjs'
import { renderState } from '../sweep.mjs'
import { ALARM_RE } from '../../ops-dashboard/lib/navigator.mjs'

// Captured verbatim from a real run on 2026-08-18:
//   obot.agent/scripts/obot-merge 198 -R jwildfire/obot.agent --check
// A fabricated fixture would only ever prove that the parser matches the fixture.
const REAL_198 = `PR #198 https://github.com/jwildfire/obot.agent/pull/198
  title: Structural GitHub writes go out as obotclaw[bot], enforced not remembered
  base:  main   state: OPEN   draft: False   files: 17
  head:  b1ae6d4200a708aeca86662797674135cddfc1ba
  policy: profile auto, role integration
  policy: carve-out path touched, attested lane forced (hooks/attribution-guard.sh, hooks/install.sh, scripts/obot-merge)
  closes: #197 #234 
  PR milestone: v0.5.0
  policy:       PASS - merging is permitted on the approval tier (explicit Jeremy approval + --jeremy-approved required)
  mergeability: READY - GitHub will merge this now
obot-merge: CHECK PASSED - policy permits merging PR #198 in jwildfire/obot.agent
`

// The ordinary case: an operational pull request on the standard lane, which is what
// almost every check returns and must never raise anything.
const STANDARD = `PR #263 https://github.com/jwildfire/obot.agent/pull/263
  title: A claim is checked on a cadence
  base:  main   state: OPEN   draft: False   files: 4
  head:  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  policy: profile auto, role integration
  closes: #262
  PR milestone: v0.5.0
  policy:       PASS - policy and the milestone gate permit merging
  mergeability: READY - GitHub will merge this now
obot-merge: CHECK PASSED - policy permits merging PR #263 in jwildfire/obot.agent
`

// ---- reading the wrapper -----------------------------------------------------

test('a real --check on a real attested-lane PR is read whole', () => {
  const c = parseCheck(REAL_198)
  assert.equal(c.ok, true)
  assert.equal(c.number, 198)
  assert.equal(c.role, 'integration')
  assert.equal(c.state, 'OPEN')
  assert.deepEqual(c.carveOut, ['hooks/attribution-guard.sh', 'hooks/install.sh', 'scripts/obot-merge'])
  assert.deepEqual(c.closes, [197, 234])
  assert.equal(c.approvalRequired, true)
  assert.equal(c.decisionCarried, false)
  assert.equal(needsRoute(c), true)
})

test('the ordinary standard-lane check raises nothing', () => {
  const c = parseCheck(STANDARD)
  assert.equal(c.ok, true)
  assert.deepEqual(c.carveOut, [])
  assert.equal(needsRoute(c), false)
})

test('THE rule — output this cannot parse is a FAILED reading, never a clean lane', () => {
  // The shape a wording change in obot-merge would produce. `carveOut` is empty
  // either way, so without `ok` the router would conclude every lane was clean and
  // report success while routing nothing — silent success, this house's signature.
  const c = parseCheck('obot-merge: something entirely different happened\n')
  assert.equal(c.ok, false)
  assert.equal(needsRoute(c), false)
})

test('an empty run is a failed reading too — a wrapper that printed nothing cleared nothing', () => {
  assert.equal(parseCheck('', '').ok, false)
  assert.equal(needsRoute(parseCheck('', '')), false)
})

test('a carve-out merge already carried by a recorded decision needs nothing from him', () => {
  const c = parseCheck(REAL_198.replace(
    'PASS - merging is permitted on the approval tier (explicit Jeremy approval + --jeremy-approved required)',
    'PASS - carve-out merge carried by a recorded decision on an operational integration branch'))
  assert.equal(c.decisionCarried, true)
  assert.equal(needsRoute(c), false)
})

test('a release-role base is a release candidate — bucket one, never routed to config', () => {
  const c = parseCheck(REAL_198.replace('policy: profile auto, role integration', 'policy: profile auto, role release'))
  assert.equal(c.role, 'release')
  assert.equal(needsRoute(c), false)
})

test('the authority gate forces the same lane and still raises nothing — it is an outage, not his keyboard', () => {
  const c = parseCheck(`PR #9 https://github.com/jwildfire/obot.agent/pull/9
  title: something
  base:  main   state: OPEN   draft: False   files: 1
  policy: profile auto, role integration
  policy: could not read the authority copy (jwildfire/obot.agent@main:scripts/policy.json) - attested lane forced
  policy:       PASS - merging is permitted on the approval tier (explicit Jeremy approval + --jeremy-approved required)
obot-merge: CHECK PASSED - policy permits merging PR #9 in jwildfire/obot.agent
`)
  assert.equal(c.forcedAttested, true, 'the lane really was forced')
  assert.deepEqual(c.carveOut, [], 'but no carve-out path was touched')
  assert.equal(needsRoute(c), false, 'and the config list admits only what his physical access fixes (BL1)')
})

// ---- what an entry covers ----------------------------------------------------

test('an issue reference is NOT read as a pull request', () => {
  // c0016 names jwildfire/obot.agent#197 in its Blocks field. A looser reader would
  // conclude the item covers PR #197 and leave the PR it is actually about uncovered
  // — while reporting that everything was routed.
  assert.equal(prRefs('Blocks: jwildfire/obot.agent#197 (verified open 2026-08-18)').size, 0)
})

test('the three unambiguous pull-request forms are all read', () => {
  assert.ok(prRefs('Source: https://github.com/jwildfire/obot.agent/pull/198').has('jwildfire/obot.agent#198'))
  assert.ok(prRefs('Do: obot.agent/scripts/obot-merge 198 -R jwildfire/obot.agent --squash').has('jwildfire/obot.agent#198'))
  assert.ok(prRefs('Verify: gh pr view 198 -R jwildfire/obot.agent --json state').has('jwildfire/obot.agent#198'))
})

// The real c0016, field for field, with its prose left out — this file is committed
// and the config list never is.
const C0016 = `## Open

- [ ] c0016 · filed 2026-08-18 · verified 2026-08-18 — **Merge obot.agent#198**
  Do: obot.agent/scripts/obot-merge 198 -R jwildfire/obot.agent --squash --delete-branch --jeremy-approved '<where>'
  Verify: gh pr view 198 -R jwildfire/obot.agent --json state --jq .state | grep -qx MERGED → exit 0 once merged
  Source: https://github.com/jwildfire/obot.agent/pull/198
  Blocks: jwildfire/obot.agent#197 (verified open 2026-08-18)

- [ ] c0017 · filed 2026-08-18 — **something with no PR in it**
  Do: tools/fold/install-launchd
  Source: https://github.com/jwildfire/obot.agent/issues/204

## Resolved

- [x] c0015 · filed 2026-08-18 — **Approve and merge obot.agent#198**  **RETIRED 2026-08-18: refiled as c0016**
  Source: https://github.com/jwildfire/obot.agent/pull/198
`

test('coverage joins an open entry to the pull request it names', () => {
  const cov = coverageFrom(C0016)
  assert.deepEqual(cov.get('jwildfire/obot.agent#198'), ['c0016'])
  assert.equal(cov.size, 1, 'an entry naming no pull request covers nothing')
})

test('a retired entry covers nothing — c0015 must not block the refile that replaced it', () => {
  // c0015 was retired for a verify that could not fail, and c0016 is the hand-filed
  // replacement. Had the Resolved section counted, the automatic refile this work
  // exists to perform would have been silently refused.
  const retiredOnly = C0016.replace('- [ ] c0016', '- [x] c0016')
  assert.equal(coverageFrom(retiredOnly).size, 0)
})

test('a list with no Open section covers nothing rather than throwing', () => {
  assert.equal(coverageFrom('# Blockers\n\nnothing here\n').size, 0)
})

// ---- read honesty ------------------------------------------------------------

test('an absent config list is a real reading of an empty one', () => {
  const ws = mkdtempSync(join(tmpdir(), 'carveout-'))
  const r = readCoverage(ws)
  assert.equal(r.read, true)
  assert.equal(r.absent, true)
  assert.equal(r.covered.size, 0)
})

test('THE rule — an unreadable config list is NOT an empty one', () => {
  const ws = mkdtempSync(join(tmpdir(), 'carveout-'))
  mkdirSync(join(ws, '.claude'), { recursive: true })
  // A directory where the file should be: EISDIR, which is not ENOENT and must not
  // read as absence (obot.agent#206/#215).
  mkdirSync(join(ws, '.claude', 'blockers.md'))
  const r = readCoverage(ws)
  assert.equal(r.read, false)
  assert.equal(r.absent, false)
  assert.match(r.why, /blockers\.md/)
})

// ---- which lanes are worth a check ------------------------------------------

const NOW = new Date('2026-08-18T12:00:00Z')
const agoMin = (m) => new Date(NOW.getTime() - m * 60000).toISOString()
const pr = (over = {}) => ({
  repo: 'jwildfire/obot.agent', integration: 'main', number: 1, title: 'a change',
  url: 'https://github.com/jwildfire/obot.agent/pull/1', baseRefName: 'main',
  isDraft: false, updatedAt: agoMin(500), ...over,
})

test('a pull request that already has a config item is never checked again', () => {
  const covered = new Map([['jwildfire/obot.agent#198', ['c0016']]])
  const { check } = candidates([pr({ number: 198 })], { now: NOW, covered })
  assert.equal(check.length, 0, 'the raise is stopped before an id is claimed, so a re-file costs nothing')
})

test('a fresh pull request is left alone — its author is probably about to merge it', () => {
  assert.equal(candidates([pr({ updatedAt: agoMin(CHECK_AFTER_MIN - 1) })], { now: NOW }).check.length, 0)
  assert.equal(candidates([pr({ updatedAt: agoMin(CHECK_AFTER_MIN + 1) })], { now: NOW }).check.length, 1)
})

test('drafts and release-role bases are never candidates', () => {
  assert.equal(candidates([pr({ isDraft: true })], { now: NOW }).check.length, 0)
  assert.equal(candidates([pr({ baseRefName: 'stable' })], { now: NOW }).check.length, 0)
})

test('a pull request already in his RC queue is never also a config item', () => {
  // One piece of work in two of his three buckets is the duplication #220 names:
  // "two mechanisms reaching him about one thing, because neither can see what the
  // other has done". The RC test is the shared classifier's, not a second opinion.
  assert.equal(candidates([pr({ reviewRequests: [{ login: 'jwildfire' }] })], { now: NOW }).check.length, 0)
  assert.equal(candidates([pr({ reviewDecision: 'CHANGES_REQUESTED' })], { now: NOW }).check.length, 0)
  assert.equal(candidates([pr({ reviewRequests: [{ login: 'someone-else' }] })], { now: NOW }).check.length, 1)
})

test('a lane read clean at this revision is not read again, and a new push re-opens it', () => {
  const p = pr({ number: 7, updatedAt: agoMin(500) })
  const checked = { 'jwildfire/obot.agent#7': { updatedAt: p.updatedAt } }
  assert.equal(candidates([p], { now: NOW, checked }).check.length, 0)
  // A push moves updatedAt — and a pull request can GAIN a carve-out path in a
  // commit, so the cache must not outlive the revision it was taken at.
  assert.equal(candidates([{ ...p, updatedAt: agoMin(3) }], { now: NOW, checked, afterMin: 1 }).check.length, 1)
})

test('what the per-run bound skipped is counted, never silently dropped', () => {
  const many = Array.from({ length: 7 }, (_, i) => pr({ number: i + 1, updatedAt: agoMin(100 + i) }))
  const sel = candidates(many, { now: NOW, max: 2 })
  assert.equal(sel.check.length, 2)
  assert.equal(sel.skipped.length, 5)
  assert.equal(sel.check[0].number, 7, 'oldest first — the one that has sat longest is routed first')
})

// ---- the entry that gets filed ----------------------------------------------

test('the raise is an installation qualification, and its verify can fail', () => {
  const args = raiseArgs(parseCheck(REAL_198), { repo: 'jwildfire/obot.agent' })
  for (const flag of ['--do', '--expect', '--verify', '--source']) assert.ok(args.includes(flag), `missing ${flag}`)
  const verify = args[args.indexOf('--verify') + 1]
  // The whole reason c0015 was retired: `gh pr view --json state --jq .state` exits 0
  // whether the answer is OPEN or MERGED, so it would record a pass while the merge
  // was still outstanding. The grep is what makes the exit code mean something.
  assert.match(verify, /grep -qx MERGED/)
  assert.match(verify, /->/, 'blocker-log refuses a verify with no stated expectation')
  assert.match(args[0], /^Merge obot\.agent#198 — /)
})

test('CRITICAL IS EARNED — the raise passes the closed issues and never claims the tag', () => {
  const args = raiseArgs(parseCheck(REAL_198), { repo: 'jwildfire/obot.agent' })
  const blocks = args.filter((a, i) => args[i - 1] === '--blocks')
  assert.deepEqual(blocks, ['jwildfire/obot.agent#197', 'jwildfire/obot.agent#234'])
  assert.equal(args.includes('--critical'), false, 'there is no such flag and inventing one is the failure')
})

test('the entry names the carve-out paths, because that is why it is his', () => {
  const args = raiseArgs(parseCheck(REAL_198), { repo: 'jwildfire/obot.agent' })
  const why = args[args.indexOf('--why') + 1]
  for (const p of ['hooks/attribution-guard.sh', 'hooks/install.sh', 'scripts/obot-merge']) assert.ok(why.includes(p))
})

// ---- the section -------------------------------------------------------------

test('the routing alarm matches the real ALARM_RE, imported rather than copied', () => {
  assert.match(ALARM_ROUTE_FAILED, ALARM_RE)
})

test('an unreadable config list reaches the page as an alarm, not as "nothing to route"', () => {
  const s = carveoutSection({ coverageRead: false, coverageWhy: '/ws/.claude/blockers.md could not be read (EISDIR)' })
  assert.match(s, ALARM_RE)
  assert.match(s, /Nothing was raised and nothing was suppressed/)
})

test('a clean pass says so rather than going silent', () => {
  const s = carveoutSection({ checked: 3 })
  assert.doesNotMatch(s, ALARM_RE)
  assert.match(s, /3 lane\(s\) checked/)
})

test('the section carries ids and counts and no item text', () => {
  const s = carveoutSection({ covered: [{ ref: 'obot.agent#198', ids: ['c0016'] }], checked: 1 })
  assert.match(s, /obot\.agent#198 · c0016/)
  assert.match(s, /already routed: 1 pull request/)
})

// ---- and the admiral ---------------------------------------------------------

const admiralPR = (over = {}) => ({ ...pr(over), reviewRequests: [], reviewDecision: '' })
const POLICY = { repos: { 'jwildfire/obot.agent': { profile: 'auto', class: 'operational', branches: { integration: 'main', release: ['stable'] } } } }
const COVERED = new Map([['jwildfire/obot.agent#198', ['c0016']]])

test('THE fix — the admiral stops escalating a pull request the config bucket already holds', () => {
  const prs = [admiralPR({ number: 198 })]
  assert.equal(stuckPRs(prs, { now: NOW }).length, 1, 'without coverage it is a stuck candidate, as it was every cycle')
  assert.equal(stuckPRs(prs, { now: NOW, covered: COVERED }).length, 0)
  const t = triggers({ jobs: [], prs, policy: POLICY, now: NOW, covered: COVERED })
  assert.equal(t.fired, false, 'and with nothing else holding, no admiral is launched at all')
})

test('THE rule — an unreadable config list suppresses NOTHING', () => {
  const prs = [admiralPR({ number: 198 })]
  assert.equal(stuckPRs(prs, { now: NOW, covered: COVERED, coverageRead: false }).length, 1)
  assert.equal(routedPRs(prs, { covered: COVERED, coverageRead: false }).length, 0)
})

test('the suppression is visible — the section names what it stopped escalating', () => {
  const t = triggers({ jobs: [], prs: [admiralPR({ number: 198 })], policy: POLICY, now: NOW, covered: COVERED })
  const s = admiralSection({ trigger: t })
  assert.match(s, /already his: 1 pull request\(s\) routed to the config bucket/)
  assert.match(s, /obot\.agent#198 · c0016/)
  assert.doesNotMatch(s, ALARM_RE, 'a routed pull request is not a finding — it is the system working')
})

test('and an unread list says so on the page rather than looking quiet', () => {
  const t = triggers({ jobs: [], prs: [admiralPR({ number: 198 })], policy: POLICY, now: NOW,
                       covered: new Map(), coverageRead: false })
  assert.ok(admiralSection({ trigger: t }).includes(UNROUTED_NOTE))
})

test('a routed pull request never reaches the brief the admiral acts from', () => {
  const t = triggers({ jobs: [], prs: [admiralPR({ number: 198 })], policy: POLICY, now: NOW, covered: COVERED })
  assert.equal(t.pulls.length, 0)
  assert.equal(t.routed.length, 1)
  assert.deepEqual(t.routed[0].ids, ['c0016'])
})

test('an uncovered idle pull request is still escalated — the exclusion is narrow', () => {
  const t = triggers({ jobs: [], prs: [admiralPR({ number: 199 })], policy: POLICY, now: NOW, covered: COVERED })
  assert.equal(t.fired, true)
  assert.equal(t.pulls.length, 1)
})

// ---- and the page it reaches -------------------------------------------------

test('the sweep folds the routing section into the file prime reads', () => {
  const meta = { sweptAt: '2026-08-18 08:35', cadenceMin: 5, repoCount: 7, ok: true, errors: [], lastGoodAt: null }
  const md = renderState({
    snapshot: {}, events: [], meta,
    admiral: '## Admiral — triggered, acts and exits\n\nadmiral: nothing to act on\n',
    carveout: carveoutSection({ covered: [{ ref: 'obot.agent#198', ids: ['c0016'] }], checked: 0 }),
  })
  assert.match(md, /## Carve-out routing/)
  assert.match(md, /obot\.agent#198 · c0016/)
  // Directly beneath the admiral: this section is the reason a pull request stopped
  // appearing in that one, and the explanation has to be where the silence is.
  assert.ok(md.indexOf('## Carve-out routing') > md.indexOf('## Admiral'))
})

test('a routing run that never happened reaches the page as an alarm, under the same heading', () => {
  // The failure mode this replaces: the section drops off the page and the absence
  // reads as "he has nothing waiting" — the claim least safe to make by accident, in
  // the one spot on the page where a carve-out pull request is supposed to appear.
  const broken = routingBroken('the router printed nothing (exit 1)')
  assert.match(broken, ALARM_RE)
  assert.ok(broken.startsWith(SECTION_HEAD), 'the same heading, so it cannot land in two places')
  assert.match(broken, /No lane was read this pass/)
})
