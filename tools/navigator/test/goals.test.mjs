// Goal membership (jwildfire/obot.roadmap#227, task jwildfire/obot.agent#155): the
// ancestor walk behind the Navigator tab's goal filter.
//
// The contract these tests hold is the one the commissioning issue named: this walk
// must agree with the roadmap-discipline checks. So the cases mirror the ones
// GOALLESS-REQUIREMENT learned the hard way — depth, cycles, and the difference
// between "walked, no goal" and "nothing to walk".
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseParentUrl, buildGoalIndex, goalsOf, issueGoals, prGoals, goalMatch, refKey,
} from '../goals.mjs'

const HUB = 'jwildfire/obot.roadmap'
const OA = 'jwildfire/obot.agent'
const url = (repo, n) => `https://api.github.com/repos/${repo}/issues/${n}`

// #73 is a goal; #227 a requirement under it; #155 a task in a spoke repo under the
// requirement. That is the real shape of the work this page is being built for.
const CACHE = {
  goals: [
    { repo: HUB, number: 73, title: 'Goal: the autonomy programme', createdAt: '2026-07-24T00:00:00Z', state: 'open' },
    { repo: HUB, number: 112, title: 'Goal: open.csr', createdAt: '2026-07-20T00:00:00Z', state: 'open' },
  ],
  issues: [
    { repo: HUB, number: 73, cls: 'goal' },
    { repo: HUB, number: 112, cls: 'goal' },
    { repo: HUB, number: 227, cls: 'requirement', parent: { repo: HUB, number: 73 } },
    { repo: OA, number: 155, cls: 'task', parent: { repo: HUB, number: 227 } },
    { repo: OA, number: 99, cls: 'task' },
  ],
}

test('parseParentUrl: the parent reference names its repo, not just its number', () => {
  assert.deepEqual(parseParentUrl(url(HUB, 227)), { repo: HUB, number: 227 })
  // A parent in a spoke repo resolves as itself rather than being assumed into the hub.
  assert.deepEqual(parseParentUrl(url(OA, 12)), { repo: OA, number: 12 })
  assert.equal(parseParentUrl(null), null)
  assert.equal(parseParentUrl('not a url'), null)
})

test('goalsOf: membership is an ancestor question at any depth, not a parent question', () => {
  const ix = buildGoalIndex(CACHE)
  // One hop: the requirement is a direct sub-issue of the goal.
  assert.deepEqual(goalsOf(refKey(HUB, 227), ix), [refKey(HUB, 73)])
  // Two hops through a repo boundary — the case a direct-parent check gets wrong,
  // and the one that matters most here since every task lives in a spoke repo.
  assert.deepEqual(goalsOf(refKey(OA, 155), ix), [refKey(HUB, 73)])
  // Walked, and there is genuinely nothing above it.
  assert.deepEqual(goalsOf(refKey(OA, 99), ix), [])
})

test('goalsOf: a goal is not its own ancestor, but a goal under a goal counts as both', () => {
  const ix = buildGoalIndex({
    ...CACHE,
    issues: [...CACHE.issues, { repo: HUB, number: 112, cls: 'goal', parent: { repo: HUB, number: 73 } }],
  })
  // Asking a goal about itself returns what is ABOVE it — otherwise every goal
  // would filter to itself and the counts would double.
  assert.deepEqual(goalsOf(refKey(HUB, 73), ix), [])
  assert.deepEqual(goalsOf(refKey(HUB, 112), ix), [refKey(HUB, 73)])
})

test('goalsOf: a parent cycle terminates instead of hanging the page', () => {
  const ix = buildGoalIndex({
    goals: [{ repo: HUB, number: 73 }],
    issues: [
      { repo: HUB, number: 200, parent: { repo: HUB, number: 201 } },
      { repo: HUB, number: 201, parent: { repo: HUB, number: 200 } },
    ],
  })
  assert.deepEqual(goalsOf(refKey(HUB, 200), ix), [])
})

test('issueGoals vs prGoals: null is "nothing to walk", [] is "walked, no goal"', () => {
  const ix = buildGoalIndex(CACHE)
  // A PR reaches the plan only through the issues it closes — its one structural
  // route, and the same field the discipline checks accept as a PR's ancestor.
  assert.deepEqual(prGoals({ closes: [refKey(OA, 155)] }, ix), [refKey(HUB, 73)])
  // A PR closing nothing was never asked the question. Reporting that as "not under
  // this goal" is the zero-that-means-two-things this page exists to avoid.
  assert.equal(prGoals({ closes: [] }, ix), null)
  assert.equal(prGoals({}, ix), null)
  // …whereas a PR that closes an unparented issue really has no goal.
  assert.deepEqual(prGoals({ closes: [refKey(OA, 99)] }, ix), [])
  assert.deepEqual(issueGoals({ repo: OA, number: 155 }, ix), [refKey(HUB, 73)])
  assert.equal(issueGoals({ repo: OA }, ix), null)
})

test('prGoals: one PR closing two issues under the same goal counts that goal once', () => {
  const ix = buildGoalIndex(CACHE)
  assert.deepEqual(prGoals({ closes: [refKey(OA, 155), refKey(HUB, 227)] }, ix), [refKey(HUB, 73)])
})

test('goalMatch: unattributable is its own answer, never folded into no', () => {
  assert.equal(goalMatch(null, null), 'yes', 'no filter selected: everything passes')
  assert.equal(goalMatch(refKey(HUB, 73), [refKey(HUB, 73)]), 'yes')
  assert.equal(goalMatch(refKey(HUB, 73), [refKey(HUB, 112)]), 'no')
  assert.equal(goalMatch(refKey(HUB, 73), []), 'no', 'walked and found none is a real no')
  assert.equal(goalMatch(refKey(HUB, 73), null), 'unattributable')
})
