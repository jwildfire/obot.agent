// The role registry, and the two questions it answers separately (obot.agent#181).
//
// These are guard tests rather than behaviour tests. The behaviour lives in
// wake.test.mjs; what is guarded here is the property whose absence lost a fleet
// manager for ten hours — that the list of roles @jwildfire pins and the list of
// roles allowed to rest are ASKED SEPARATELY, and are not the same set.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { PINNED_ROLES, ROLES, STANDING, TRIGGERED, mustExit, restsWhenIdle, roleOf } from '../../lib/roles.mjs'
import { STANDING_ROLES } from '../../ops-dashboard/lib/roster-view.mjs'
import { MANAGER_NAME, MANAGER_TAG } from '../fleet.mjs'

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

test('fleet is pinned like a role and watched like a worker', () => {
  // @jwildfire, on pinning: "pin prime, nav and fleet manager (fleet for short) by
  // default" (obot.agent#169). On liveness, fleet is the opposite of the other two:
  // it launches on a condition and must exit inside a budget.
  assert.ok(PINNED_ROLES.some((r) => r.short === 'fleet'), 'fleet is pinned')
  assert.equal(restsWhenIdle(MANAGER_NAME), false, 'stopping is not its resting state')
  assert.equal(mustExit(MANAGER_NAME), true, 'it must exit inside a budget')

  for (const name of ['\u{1F3A9}\u{1F916} obot-prime', '\u{1F9ED}\u{1F916} obot-navigator']) {
    assert.equal(restsWhenIdle(name), true, `${name} rests between wakings by design`)
    assert.equal(mustExit(name), false, `${name} has no budget to exit inside`)
  }
})

test('the registry and the launcher name the same manager', () => {
  // The dashboard used to hold these in step by a comment. They are one import now,
  // but the launcher still owns the tag it spawns under, so the guard stays.
  const fleet = ROLES.find((r) => r.short === 'fleet')
  assert.equal(fleet.tag, MANAGER_TAG)
  assert.equal(fleet.name, MANAGER_NAME)
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
