// What reached him, on the page he actually reads (jwildfire/obot.roadmap#257).
//
// @jwildfire, 2026-08-20, after four workers finished inside twenty-five minutes and
// closed five requirements with nothing telling him:
//
//   "I like the summary of the closed items in the top 10, but make them a plain
//    language executive summary instead of a bunch of issue numbers. Make sure that
//    those are passed to you properly (and passed to me) whenever they are created."
//
// So the bar for this panel is not "does it render". It is: the SENTENCE is the
// headline, the issue number is a trailing citation, and it holds at 390px — he
// reads this queue on a phone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { deliveredPanel, render } from '../lib/render.mjs'
import { collectDelivered } from '../lib/delivered.mjs'

const GOOD = 'When the system says it stopped a runaway agent, it now has to prove the process died.'
const NOW = new Date('2026-08-20T18:00:00Z')

const panel = (over = {}) => deliveredPanel({
  read: true,
  armed: true,
  closures: [{ id: 'L0001', issue: 'hub#264', summary: GOOD, worker: 'W0076', ageHours: 2, date: '2026-08-20' }],
  promises: [],
  ...over,
}, NOW)

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ops-delivered-'))

// ---- the sentence is the headline ----

test('the summary is the headline and the issue number trails it', () => {
  const html = panel()
  assert.match(html, /prove the process died/)
  assert.ok(html.indexOf('prove the process died') < html.indexOf('hub#264'),
    '"#251, #256 and #264 closed" is the failure being named here')
})

test('the issue number is never the headline', () => {
  const html = panel()
  const heading = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(html)
  assert.ok(heading, 'the panel has a heading')
  assert.doesNotMatch(heading[1], /#\d+/, 'a number is a citation, not a title')
})

test('a completion with no sentence is not rendered as a bare number', () => {
  const html = panel({ closures: [{ id: 'L0001', issue: 'hub#264', summary: '', ageHours: 1 }] })
  assert.doesNotMatch(html, /hub#264/,
    'half-delivering a completion is the version of this that looks like it works')
})

// ---- honesty: unread and unwritten are different from empty ----

test('a record that could not be read does NOT render as "nothing completed"', () => {
  const html = panel({ read: false, closures: [], why: 'landing-log exited 1' })
  assert.match(html, /could not/i)
  assert.doesNotMatch(html, /nothing (has )?completed/i)
})

test('a quiet day and an unwritten record are two different sentences', () => {
  const quiet = panel({ armed: true, closures: [], promises: [] })
  const unwritten = panel({ armed: false, closures: [], promises: [] })
  assert.match(quiet, /Nothing has completed yet today/i)
  assert.match(unwritten, /Nothing has been written on this machine yet/i)
  assert.notEqual(quiet, unwritten,
    'nothing recorded and nothing to record are different facts (hub#223)')
})

// ---- the promises half: what he asked for, and whether it landed ----

test('a promise that has gone quiet is shown with his words and its age', () => {
  const html = panel({
    closures: [],
    promises: [{ id: 'L0001', asked: 'an org chart of who does what', landing: 'https://x/org-chart/', state: 'not-landed', detail: 'fetched, HTTP 404', quiet: true, ageHours: 30 }],
  })
  assert.match(html, /an org chart of who does what/, 'his words, not the id')
  assert.match(html, /30h|1d/, 'an age, so a promise gone quiet surfaces on its own')
  assert.match(html, /404/, 'and what the fetch actually found')
})

test('a landing nobody could check is not shown as a landing that failed', () => {
  const html = panel({
    closures: [],
    promises: [{ id: 'L0001', asked: 'a page', landing: 'https://x/', state: 'unchecked', detail: 'curl did not run', quiet: true, ageHours: 30 }],
  })
  assert.match(html, /not been checked|unchecked/i)
  assert.doesNotMatch(html, /did not land|is missing/i,
    'ENOENT is the only failure allowed to read as absence (obot.agent#215)')
})

test('a promise that landed is not in the outstanding list', () => {
  const html = panel({
    closures: [],
    promises: [{ id: 'L0001', asked: 'the org chart', landing: 'https://x/', state: 'landed', detail: 'HTTP 200', quiet: false, ageHours: 40 }],
  })
  assert.doesNotMatch(html, /the org chart/)
})

// ---- the rules this rail is under ----

test('it asks him for nothing — his queue holds three things and this is not a fourth', () => {
  const html = panel({
    promises: [{ id: 'L0001', asked: 'x', landing: 'https://x/', state: 'not-landed', detail: 'HTTP 404', quiet: true, ageHours: 30 }],
  })
  assert.doesNotMatch(html, /<button|<input|<textarea|<form|onclick=/i)
  assert.doesNotMatch(html, /please|you should|approve|your call|needs you/i)
})

test('it never uses the .q class — that selector carries a click handler expecting a .q-title', () => {
  const html = panel()
  assert.doesNotMatch(html, /class="q[ "]/)
})

test('untrusted text is escaped — a summary comes from whatever an agent typed', () => {
  const html = panel({
    closures: [{ id: 'L0001', issue: 'hub#264', ageHours: 1, worker: 'W1', summary: '<img src=x onerror=alert(1)> a sentence long enough to be one' }],
  })
  assert.doesNotMatch(html, /<img src=x/)
  assert.match(html, /&lt;img/)
})

// ---- 390px: he reads this on a phone ----

test('nothing in the panel refuses to wrap — the rail has no min-width:0 to save it', () => {
  const css = render({
    queue: { rcs: { items: [], read: true }, decisions: { items: [], read: true }, config: { items: [], read: true } },
    workspace: '/tmp', hub: '/tmp',
  });
  const rules = css.split('\n').filter((l) => /^\s*\.dlv/.test(l))
  assert.ok(rules.length, 'the panel has its own CSS block')
  assert.ok(!rules.some((l) => /white-space:\s*nowrap/.test(l)),
    'a nowrap rule inside the rail widens the whole 220px grid track at 390px')
  const text = rules.filter((l) => /\.dlv-(line|ask|cite|why)/.test(l)).join('\n')
  assert.match(text, /overflow-wrap:\s*anywhere/,
    'a single unbreakable token in an agent-written sentence would otherwise push the page sideways')
})

test('the panel is on the page, below the three buckets', () => {
  const html = render({
    queue: { rcs: { items: [], read: true }, decisions: { items: [], read: true }, config: { items: [], read: true } },
    delivered: { read: true, armed: true, closures: [{ id: 'L0001', issue: 'hub#264', summary: GOOD, worker: 'W0076', ageHours: 1 }], promises: [] },
    workspace: '/tmp', hub: '/tmp',
  })
  assert.match(html, /prove the process died/)
  assert.ok(html.indexOf('Release candidates') < html.indexOf('prove the process died'),
    'his queue holds three things that need him; this sits under all of them')
})

test('a page rendered with no delivered reading at all still renders', () => {
  const html = render({
    queue: { rcs: { items: [], read: true }, decisions: { items: [], read: true }, config: { items: [], read: true } },
    workspace: '/tmp', hub: '/tmp',
  })
  assert.match(html, /Operations Dashboard/)
})

// ---- the collector ----

test('collectDelivered says read:false with a reason rather than an empty record', () => {
  const got = collectDelivered(tmp(), { tool: '/nonexistent/landing-log' })
  assert.equal(got.read, false)
  assert.ok(got.why, 'an unread source always carries a reason')
  assert.deepEqual(got.closures, [])
})

test('collectDelivered reads a real record through the tool that owns it', () => {
  const ws = tmp()
  const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const tool = path.join(repo, 'tools', 'landing-log')
  spawnSync(tool, ['closure', '--issue', 'hub#264', '--summary', GOOD],
    { env: { ...process.env, OBOT_WORKSPACE: ws, OBOT_ACTOR: 'W0080' }, encoding: 'utf8' })
  const got = collectDelivered(ws, { tool })
  assert.equal(got.read, true)
  assert.equal(got.armed, true)
  assert.equal(got.closures[0].summary, GOOD)
})
