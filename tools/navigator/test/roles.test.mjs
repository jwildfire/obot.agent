// The role registry, and the two questions it answers separately (obot.agent#181).
//
// These are guard tests rather than behaviour tests. The behaviour lives in
// wake.test.mjs; what is guarded here is the property whose absence lost an admiral
// for ten hours — that the list of roles @jwildfire pins and the list of
// roles allowed to rest are ASKED SEPARATELY, and are not the same set.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { PINNED_ROLES, ROLES, STANDING, TRIGGERED, mustExit, restsWhenIdle, roleOf } from '../../lib/roles.mjs'
import { STANDING_ROLES } from '../../ops-dashboard/lib/roster-view.mjs'
import { ADMIRAL_NAME, ADMIRAL_TAG } from '../admiral.mjs'

test('every role declares a lifecycle, so a new one cannot arrive without answering', () => {
  // The whole fix. A fourth role added without this field is a fourth role that
  // silently inherits whatever the reader assumed.
  for (const r of ROLES) {
    assert.ok([STANDING, TRIGGERED].includes(r.lifecycle), `${r.short} must declare a lifecycle`)
    assert.ok(r.tag && r.name && r.short && r.resting, `${r.short} needs its display fields too`)
    assert.ok(r.name.startsWith(r.tag), `${r.short}'s name must carry its own tag`)
  }
})

test('pinning and liveness are different questions with different answers', () => {
  // If these two sets are ever equal again, the conflation is back and a triggered
  // role is silently exempt from the detectors the moment it is pinned.
  const pinned = PINNED_ROLES.map((r) => r.short).sort()
  const resting = ROLES.filter((r) => restsWhenIdle(r.name)).map((r) => r.short).sort()
  assert.notDeepEqual(pinned, resting, 'one list answering both questions is obot.agent#181');
  assert.ok(pinned.length > resting.length, 'a pinned role that does not rest is exactly the case that fell through')
})

test('the admiral is pinned like a role and watched like a worker', () => {
  // @jwildfire, on pinning: "pin prime, nav and fleet manager (fleet for short) by
  // default" (obot.agent#169) — the fleet manager he named there is the admiral since
  // obot.agent#182, later the same day. On liveness the admiral is the opposite of the
  // other two: it launches on a condition and must exit inside a budget.
  assert.ok(PINNED_ROLES.some((r) => r.short === 'admiral'), 'the admiral is pinned')
  assert.equal(restsWhenIdle(ADMIRAL_NAME), false, 'stopping is not its resting state')
  assert.equal(mustExit(ADMIRAL_NAME), true, 'it must exit inside a budget')

  for (const name of ['\u{1F3A9}\u{1F916} obot-prime', '\u{1F9ED}\u{1F916} obot-navigator']) {
    assert.equal(restsWhenIdle(name), true, `${name} rests between wakings by design`)
    assert.equal(mustExit(name), false, `${name} has no budget to exit inside`)
  }
})

test('the registry and the launcher name the same admiral', () => {
  // The dashboard used to hold these in step by a comment. They are one import now,
  // but the launcher still owns the tag it spawns under, so the guard stays. It went
  // red on the rename in obot.agent#182 with only one side moved, which is the whole
  // reason it exists.
  const admiral = ROLES.find((r) => r.short === 'admiral')
  assert.equal(admiral.tag, ADMIRAL_TAG)
  assert.equal(admiral.name, ADMIRAL_NAME)
})

test('a role still answers to the tags it used to carry', () => {
  // The rename in obot.agent#182 moved the admiral's tag, and every session already
  // recorded under the old one stopped resolving to the role — silently, because a
  // role with no session renders from the registry rather than from any session, so
  // the pinned band went on showing three roles while the history fell out.
  for (const r of ROLES) {
    for (const prior of r.priorTags ?? []) {
      assert.equal(roleOf(`${prior} obot-${r.short}`)?.short, r.short, `${prior} must still resolve to ${r.short}`)
      assert.equal(mustExit(`${prior} obot-${r.short}`), mustExit(r.name), 'and carry the same lifecycle')
    }
  }
})

test('a session that is not a role is not accidentally one', () => {
  for (const name of ['\u{1F46F}\u{1F916} W0037 2026-08-17 fix', '\u{1F9BE}\u{1F916} W0031 auto', 'some session', '', null]) {
    assert.equal(roleOf(name), null, `${name} is work, not a role`)
    assert.equal(restsWhenIdle(name), false)
    assert.equal(mustExit(name), false)
  }
})

test('the Agents tab still reads the whole registry for pinning', () => {
  // roster-view keeps its own export name because the page and its tests reach for
  // it there; what it must not do is become a second registry.
  assert.deepEqual(STANDING_ROLES.map((r) => r.tag), ROLES.map((r) => r.tag))
  assert.equal(STANDING_ROLES, PINNED_ROLES, 'one list, not a copy that can drift')
})
