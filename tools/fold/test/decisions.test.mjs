// The one queue class the sweep does not already carry (task obot.agent#200).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDecisions } from '../lib/decisions.mjs'

test('only id, title and the discussion link cross the boundary', async () => {
  const r = await openDecisions('/nonexistent', {
    load: async () => ({
      collectDecisionLog: async () => ({
        open: [{
          id: 'D0019',
          title: 'Scheduled sessions: what is ready',
          date: '2026-08-16',
          // Live artifacts carry hundreds of words here. A briefing line is 15-20.
          statusPlain: 'Awaiting @jwildfire. '.repeat(60),
          questions: [{ id: 'D0019.1' }, { id: 'D0019.2' }],
          discussion: { url: 'https://github.com/jwildfire/obot.roadmap/discussions/222' },
        }],
      }),
    }),
  })
  assert.equal(r.unknown, false)
  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].key, 'D0019')
  assert.equal(r.items[0].questions, 2)
  assert.ok(!('statusPlain' in r.items[0]), 'the status prose does not travel')
  assert.ok(JSON.stringify(r.items).length < 300, 'a briefing item stays briefing-sized')
})

test('a missing collector is unknown, not an empty decision queue', async () => {
  const r = await openDecisions('/nonexistent/hub')
  assert.equal(r.unknown, true)
  assert.deepEqual(r.items, [])
})

test('a collector that throws is unknown, and says what threw', async () => {
  const r = await openDecisions('/nonexistent', {
    load: async () => ({ collectDecisionLog: async () => { throw new Error('gh rate limited') } }),
  })
  assert.equal(r.unknown, true)
  assert.match(r.why, /gh rate limited/)
})
