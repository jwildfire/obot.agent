// A completion has to reach a person (jwildfire/obot.roadmap#257, scope note 2026-08-20).
//
// On 2026-08-20 four workers finished inside twenty-five minutes and closed five
// requirements. The admiral's trigger is a positive PROBLEM condition — a session
// past the bar, an idle operational pull request, an unrecorded closeout — so a
// clean finish trips none of them and it never launches. The wake DID fire, three
// times, and its state file read `wake: clear — every worker that stopped has been
// judged`. The loop ran and closed entirely inside the machine: no hop in that
// chain ends at a person.
//
// So there are two failures under test here and they are different shapes:
//
//   the DETECTOR   a requirement closed on GitHub with nobody saying what he can now
//                  do is a finding, the same way an unstamped worker is. This is what
//                  makes the summary structural rather than an instruction — an agent
//                  that skips it does not get away quietly.
//   the CHANNEL    a recorded completion goes out on the wake the Navigator already
//                  tails, carrying the SENTENCE, exactly once, and it is never
//                  starved by a burst of stop-states.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  closedRequirements, unsummarised, completionDetections, landingsNote, landingsLine,
  CLOSURE_WINDOW_H, COMPLETION_WINDOW_H,
} from '../closures.mjs'
import { ALARM_RE } from '../../ops-dashboard/lib/navigator.mjs'
import { deliverable, parseWakeLog, wakeLine, REWAKE_MIN } from '../wake.mjs'

const NOW = new Date('2026-08-20T18:00:00Z')
const hoursAgo = (n) => new Date(NOW.getTime() - n * 3600000).toISOString()

const HUB = 'jwildfire/obot.roadmap'
const issue = (number, over = {}) => ({
  repo: HUB, number, kind: 'issue', state: 'CLOSED', title: `Requirement: thing ${number}`,
  closedAt: hoursAgo(1), parent: null, labels: ['requirement', 'infrastructure'], ...over,
})

const GOOD = 'When the system says it stopped a runaway agent, it now has to prove the process died.'
const closure = (over = {}) => ({
  id: 'L0001', issue: 'hub#264', summary: GOOD, worker: 'W0076',
  at: hoursAgo(1), date: '2026-08-20', ageHours: 1, landing: '', ...over,
})

// ---- what counts as a closure worth a sentence ----

test('a closed requirement issue on the hub is a closure', () => {
  const found = closedRequirements([issue(264)], { repo: HUB, now: NOW })
  assert.equal(found.length, 1)
  assert.equal(found[0].ref, 'hub#264')
})

test('a closed issue with no requirement label is not — this is the roadmap lane, not every issue', () => {
  const found = closedRequirements([issue(300, { labels: ['bug'] })], { repo: HUB, now: NOW })
  assert.deepEqual(found, [])
})

test('a closed issue in another repo is not a closure here — implementation is not a requirement', () => {
  const found = closedRequirements([issue(132, { repo: 'jwildfire/obot.agent' })], { repo: HUB, now: NOW })
  assert.deepEqual(found, [])
})

test('a merged pull request is not a closure — only the requirement above it is', () => {
  const found = closedRequirements([issue(264, { kind: 'pr', state: 'MERGED' })], { repo: HUB, now: NOW })
  assert.deepEqual(found, [])
})

test('a requirement closed long before the window is out of scope — this looks forward, never back over history', () => {
  const found = closedRequirements([issue(264, { closedAt: hoursAgo(CLOSURE_WINDOW_H + 5) })],
    { repo: HUB, now: NOW })
  assert.deepEqual(found, [])
})

// ---- the finding: a closure without a sentence ----

test('a requirement closed with nobody saying what he can now do is a FINDING', () => {
  const missing = unsummarised(closedRequirements([issue(251), issue(256)], { repo: HUB, now: NOW }), [])
  assert.equal(missing.length, 2, 'both of them — this is the 2026-08-20 incident exactly')
  assert.match(missing[0].why, /no sentence/i)
})

test('a requirement whose closure carries a sentence is NOT a finding', () => {
  const closed = closedRequirements([issue(264)], { repo: HUB, now: NOW })
  assert.deepEqual(unsummarised(closed, [closure({ issue: 'hub#264' })]), [])
})

test('the match is on the issue, whichever way the record spells the repo', () => {
  const closed = closedRequirements([issue(264)], { repo: HUB, now: NOW })
  assert.deepEqual(unsummarised(closed, [closure({ issue: 'jwildfire/obot.roadmap#264' })]), [],
    'hub#264 and jwildfire/obot.roadmap#264 are one requirement, not two')
})

test('a summary recorded for a DIFFERENT requirement does not cover this one', () => {
  const closed = closedRequirements([issue(264)], { repo: HUB, now: NOW })
  assert.equal(unsummarised(closed, [closure({ issue: 'hub#251' })]).length, 1)
})

// ---- the preamble verdict the sweep prints ----

test('the verdict names the gap in his language and says how to close it', () => {
  const closed = closedRequirements([issue(251), issue(256)], { repo: HUB, now: NOW })
  const note = landingsNote({ missing: unsummarised(closed, []), state: { armed: true, closures: [], promises: [] }, read: true, now: NOW })
  assert.match(landingsLine(note), /\*\*CLOSURE SUMMARY GAP\*\*/)
  assert.match(note.summary, /2 requirement/)
  assert.ok(note.detail.some((d) => /landing-log closure/.test(d)),
    'a finding that does not say what to do about it is a complaint')
  assert.equal(note.ok, false)
})

test('a clean pass states what it actually checked, not merely that it is clean', () => {
  const note = landingsNote({
    missing: [], read: true, now: NOW,
    state: { armed: true, closures: [closure()], promises: [] },
  })
  assert.equal(note.ok, true)
  assert.match(note.summary, /1 completion/)
})

test('a GitHub read that did not happen is NOT a clean pass', () => {
  const note = landingsNote({ missing: [], read: false, now: NOW, state: { armed: true, closures: [], promises: [] } })
  assert.equal(note.ok, false)
  assert.match(note.summary, /not read/i)
  assert.doesNotMatch(note.summary, /every closed requirement/,
    'nothing read is not a covered roadmap (hub#223)')
})

test('an unwritten ledger says so rather than reporting that nothing completed', () => {
  const note = landingsNote({ missing: [], read: true, now: NOW, state: { armed: false, closures: [], promises: [] } })
  assert.equal(note.ok, false)
  assert.match(note.summary, /unwritten one/)
})

test('a promise gone quiet reaches the same verdict line — the ask and the finish are one lane', () => {
  const note = landingsNote({
    missing: [], read: true, now: NOW,
    state: {
      armed: true, closures: [],
      promises: [{ id: 'L0001', asked: 'an org chart', landing: 'https://x/org-chart/', quiet: true, state: 'not-landed', detail: 'HTTP 404', ageHours: 30 }],
    },
  })
  assert.equal(note.ok, false)
  assert.match(landingsLine(note), /\*\*PROMISE DELIVERY GAP\*\*/)
  assert.ok(note.detail.some((d) => /an org chart/.test(d)), 'his words, not the id alone')
})

// ---- the channel: it must carry the sentence, once, to a person ----

test('a recorded completion becomes a wake detection carrying the SENTENCE', () => {
  const [d] = completionDetections([closure()], { now: NOW })
  assert.equal(d.kind, 'delivered')
  assert.equal(d.key, 'delivered:L0001')
  assert.match(d.line, /prove the process died/, 'the sentence IS the payload')
  assert.ok(d.line.indexOf('prove the process died') < d.line.indexOf('hub#264'),
    'the citation trails the summary; "#251, #256 and #264 closed" is the failure being named')
})

test('the line the listener actually receives carries the sentence', () => {
  const [d] = completionDetections([closure()], { now: NOW })
  const line = wakeLine(d, NOW.toISOString())
  assert.match(line, /WAKE delivered:L0001/)
  assert.match(line, /prove the process died/)
  const [parsed] = parseWakeLog(line)
  assert.equal(parsed.key, 'delivered:L0001')
  assert.match(parsed.line, /prove the process died/,
    'and it survives a round trip through the log the Navigator tails')
})

test('a completion is delivered exactly ONCE, however many sweeps run afterwards', () => {
  const [d] = completionDetections([closure()], { now: NOW })
  const first = deliverable([d], [], NOW)
  assert.equal(first.deliver.length, 1)
  const log = parseWakeLog(wakeLine(d, hoursAgo(6)))
  const second = deliverable([d], log, NOW)
  assert.equal(second.deliver.length, 0, 'a finish is an event, not a nag')
  assert.match(second.held[0].why, /already delivered/)
})

test('an unjudged closeout still nags — once-only is for completions and nothing else', () => {
  const stopped = { kind: 'stopped', key: 'stopped:abc', line: 'W0076 closed out and has no verdict' }
  const log = parseWakeLog(wakeLine(stopped, hoursAgo(6)))
  assert.equal(deliverable([stopped], log, NOW).deliver.length, 1,
    'the stop-state floor is 30m and this is six hours old')
})

test('delivered has its own re-wake floor rather than the silent 60m default', () => {
  assert.ok('delivered' in REWAKE_MIN,
    'a kind with no entry inherits `?? 60` silently — wake.test.mjs guards wedged for exactly this reason')
})

test('completions older than the window are not woken for — a cold start is not a burst of old news', () => {
  const old = closure({ at: hoursAgo(COMPLETION_WINDOW_H + 2), ageHours: COMPLETION_WINDOW_H + 2 })
  assert.deepEqual(completionDetections([old], { now: NOW }), [])
})

test('five completions in one breath all go out — a burst is exactly the case that failed', () => {
  const many = [1, 2, 3, 4, 5].map((n) => closure({ id: `L000${n}`, issue: `hub#${250 + n}` }))
  const { deliver } = deliverable(completionDetections(many, { now: NOW }), [], NOW,
    { max: completionDetections(many, { now: NOW }).length })
  assert.equal(deliver.length, 5)
})

test('a completion with no summary produces no wake line — the channel never carries a number alone', () => {
  assert.deepEqual(completionDetections([closure({ summary: '' })], { now: NOW }), [])
})

// ---- and what the state file the Navigator reads actually says ----

test('the sweep state file carries the verdict AND the section', async () => {
  const { renderState } = await import('../sweep.mjs')
  const md = renderState({
    snapshot: {}, events: [], meta: { sweptAt: '2026-08-20 18:00', cadenceMin: 5, repoCount: 7, ok: true },
    landingsVerdict: landingsNote({
      missing: [], read: true, now: NOW,
      state: { armed: true, closures: [closure()], promises: [] },
    }),
    landings: '## Landings — what reached him\n\n- ' + GOOD + ' — hub#264\n',
  })
  assert.match(md, /landings: 1 completion/)
  assert.match(md, /## Landings — what reached him/)
  assert.match(md, /prove the process died/)
})

test('a reading that did not run says unknown rather than vanishing from the file', async () => {
  const { renderState } = await import('../sweep.mjs')
  const md = renderState({
    snapshot: {}, events: [], meta: { sweptAt: '2026-08-20 18:00', cadenceMin: 5, repoCount: 7, ok: true },
  })
  assert.match(md, /landings: \*\*NO READING\*\*/)
  assert.match(md, /unknown, not clean/)
  assert.match(md, /## Landings — what reached him/,
    'a section that disappears when its reading fails is worse than either verdict it could print')
})

test('a closure with no summary is BOLD in the state file — a finding, not small print', async () => {
  const { renderState } = await import('../sweep.mjs')
  const closed = closedRequirements([issue(251), issue(256)], { repo: HUB, now: NOW })
  const md = renderState({
    snapshot: {}, events: [], meta: { sweptAt: '2026-08-20 18:00', cadenceMin: 5, repoCount: 7, ok: true },
    landingsVerdict: landingsNote({
      missing: unsummarised(closed, []), read: true, now: NOW,
      state: { armed: true, closures: [], promises: [] },
    }),
  })
  assert.match(md, ALARM_RE,
    'the dashboard reader keys its alarm styling off the bold headline (navigator.mjs ALARM_RE)')
  assert.match(md, /hub#251/)
  assert.match(md, /landing-log closure/)
})

// ---- the alarm headlines, against the REAL regex rather than a copy of it ----
//
// An alarm headline that does not match `ALARM_RE` renders as ordinary grey text on
// his page, so the finding exists and nobody sees it (obot.agent#223). Every failing
// branch is enumerated here on purpose: this is a check that has to be able to fail,
// and a headline is exactly the kind of thing a later edit rewords innocently.

test('EVERY not-ok verdict produces a headline the dashboard will style as an alarm', () => {
  const closed = closedRequirements([issue(251)], { repo: HUB, now: NOW })
  const branches = [
    ['record unreadable', landingsNote({ state: null, read: true, now: NOW })],
    ['nothing recorded', landingsNote({ state: { armed: false }, read: true, now: NOW })],
    ['closure with no summary', landingsNote({ missing: unsummarised(closed, []), read: true, now: NOW, state: { armed: true, closures: [], promises: [] } })],
    ['promise gone quiet', landingsNote({
      missing: [], read: true, now: NOW,
      state: { armed: true, closures: [], promises: [{ id: 'L0001', asked: 'an org chart', landing: 'https://x/', quiet: true, state: 'not-landed', detail: 'HTTP 404', ageHours: 30 }] },
    })],
    ['hub not read', landingsNote({ missing: [], read: false, now: NOW, state: { armed: true, closures: [], promises: [] } })],
  ]
  for (const [name, note] of branches) {
    assert.equal(note.ok, false, `${name} is not a clean pass`)
    assert.match(landingsLine(note), ALARM_RE, `${name} must render as an alarm, not as grey text`)
  }
})

test('a clean pass is NOT styled as an alarm — the vocabulary keeps meaning something', () => {
  const note = landingsNote({ missing: [], read: true, now: NOW, state: { armed: true, closures: [closure()], promises: [] } })
  assert.equal(note.ok, true)
  assert.doesNotMatch(landingsLine(note), ALARM_RE)
})

test('a missing verdict is NO READING and never a clean line', () => {
  assert.match(landingsLine(null), /NO READING/)
  assert.match(landingsLine(null), /unknown, not clean/)
})
