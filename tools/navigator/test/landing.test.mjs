// The landing record — what he was promised, and what reached him
// (jwildfire/obot.roadmap#257, and the scope note @jwildfire added on 2026-08-20).
//
// TWO INCIDENTS, ONE MISSING LANE. He asked for an org chart on 2026-08-18; two
// workers built it and the page returned 404 for over a day. On 2026-08-20 four
// workers finished inside twenty-five minutes and closed five requirements, and
// nothing told him — he noticed the agent count had dropped, asked, and got a list
// of issue numbers back. Neither incident made a FALSE statement, so none of the
// four days of alarms built for false statements fired on either.
//
// So the tests below are mostly seeded FAILURES rather than happy paths. The trap
// this requirement names by name is that a check which cannot fail is not a check,
// and the sentence "#251, #256 and #264 closed" is the exact input every bar here
// is calibrated against.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const TOOL = join(REPO, 'tools', 'landing-log')

const ws = () => mkdtempSync(join(tmpdir(), 'landing-'))
const run = (workspace, args, env = {}) => spawnSync(TOOL, args, {
  env: { ...process.env, OBOT_WORKSPACE: workspace, OBOT_ACTOR: 'W0080', ...env },
  encoding: 'utf8',
})
const md = (workspace) => join(workspace, '.claude/session-hub/landings.md')
const read = (workspace) => (existsSync(md(workspace)) ? readFileSync(md(workspace), 'utf8') : '')

// The sentence the scope note gives as the standard, and the one it gives as the failure.
const GOOD = 'When the system says it stopped a runaway agent, it now has to prove the process died.'
const NUMBERS = '#251, #256 and #264 closed'

// ---- the bar: a summary that is not a summary is refused at the moment of writing ----

test('closure: a plain-English sentence is accepted and lands in the record he reads', () => {
  const w = ws()
  const r = run(w, ['closure', '--issue', 'hub#264', '--summary', GOOD, '--worker', 'W0080'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout.trim(), /^L\d{4}$/, 'the id goes to stdout alone, for $(...)')
  const text = read(w)
  assert.match(text, /prove the process died/)
  assert.match(text, /hub#264/)
})

test('closure: the SENTENCE leads and the issue number trails — never the other way round', () => {
  const w = ws()
  run(w, ['closure', '--issue', 'hub#264', '--summary', GOOD])
  const line = read(w).split('\n').find((l) => l.includes('prove the process died'))
  assert.ok(line, 'the closure line is in the record')
  assert.ok(line.indexOf('prove the process died') < line.indexOf('hub#264'),
    'the summary must come before the citation — "#251, #256 and #264 closed" is the failure being named')
})

test('closure: a list of issue numbers is REFUSED, with every reason it failed', () => {
  const w = ws()
  const r = run(w, ['closure', '--issue', 'hub#264', '--summary', NUMBERS])
  assert.equal(r.status, 1, 'the exact sentence that failed on 2026-08-20 must not be writable')
  assert.match(r.stderr, /issue references/)
  assert.equal(read(w), '', 'a refused summary leaves NOTHING behind — no half-record')
})

test('closure: a summary too short to be a sentence is refused', () => {
  const w = ws()
  const r = run(w, ['closure', '--issue', 'hub#264', '--summary', 'Done.'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /characters/)
  assert.match(r.stderr, /words/)
})

test('closure: a summary that opens with an issue number is refused', () => {
  const w = ws()
  const r = run(w, ['closure', '--issue', 'hub#264',
    '--summary', 'hub#264 gives the wake channel a completion event so a finish reaches a person.'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /opens with an issue number/)
})

test('closure: the issue TITLE verbatim is refused — the title names the work, not what he can now do', () => {
  const w = ws()
  const title = 'Requirement: a thing he asked for has a delivery state, and something notices when it goes quiet'
  const r = run(w, ['closure', '--issue', 'hub#257', '--summary', title, '--title', title])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /issue title verbatim/)
})

test('closure: an empty summary is refused rather than recorded as blank', () => {
  const w = ws()
  const r = run(w, ['closure', '--issue', 'hub#264', '--summary', ''])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /needs --summary/)
})

test('bar: the same check is available before writing, so an agent can ask first', () => {
  const w = ws()
  assert.equal(run(w, ['bar', '--summary', GOOD]).status, 0)
  const bad = run(w, ['bar', '--summary', NUMBERS])
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /issue references/)
})

// ---- promises: what he asked for, where it lands, and whether it did ----

test('promise: his words and a landing place become one tracked line', () => {
  const w = ws()
  const r = run(w, ['promise', '--asked', 'an org chart of who does what',
    '--landing', 'https://example.invalid/org-chart/', '--date', '2026-08-18'])
  assert.equal(r.status, 0, r.stderr)
  const text = read(w)
  assert.match(text, /an org chart of who does what/)
  assert.match(text, /example\.invalid/)
})

test('promise: a promise with nowhere to land is refused — an unverifiable list is a second place to be wrong', () => {
  const w = ws()
  const r = run(w, ['promise', '--asked', 'an org chart'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /landing place/)
})

test('check: a landing that is NOT there is recorded as not-landed, from a real fetch', () => {
  const w = ws()
  run(w, ['promise', '--asked', 'the org chart', '--landing', join(w, 'no-such-file.html')])
  const r = run(w, ['check'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /not-landed/)
  assert.match(run(w, ['list', '--json']).stdout, /"state": "not-landed"/)
})

test('check: a landing that IS there is recorded as landed — the effect, never an assertion', () => {
  const w = ws()
  const f = join(w, 'org-chart.html')
  writeFileSync(f, '<h1>who does what</h1>')
  run(w, ['promise', '--asked', 'the org chart', '--landing', f])
  const r = run(w, ['check'])
  assert.match(r.stdout, /landed/)
  assert.doesNotMatch(r.stdout, /not-landed/)
})

test('check: a fetch that could not run is UNCHECKED and never not-landed', () => {
  const w = ws()
  run(w, ['promise', '--asked', 'a page', '--landing', 'gopher://nowhere/x'])
  const r = run(w, ['check'])
  assert.match(r.stdout, /unchecked/,
    'a landing nothing can go and look at is unchecked; absence needs a look that succeeded')
  assert.doesNotMatch(r.stdout, /not-landed/)
})

test('check: it is bounded — a long promise list cannot hold the five-minute sweep open', () => {
  const w = ws()
  for (let i = 0; i < 8; i += 1) {
    run(w, ['promise', '--asked', `thing ${i}`, '--landing', join(w, `missing-${i}`)])
  }
  const r = run(w, ['check', '--max', '3'])
  assert.match(r.stdout, /fetched 3 landing\(s\)/)
})

// ---- the quiet detector: a promise that goes silent surfaces on its own ----

test('audit: a promise older than the quiet bar and not landed is a FINDING, and the verdict is the first line', () => {
  const w = ws()
  run(w, ['promise', '--asked', 'an org chart of who does what', '--landing', join(w, 'gone.html')])
  run(w, ['check'])
  // Age it past the bar by rewriting the journal's `at` stamp — the same thing the
  // clock would do, without waiting a day for it.
  const jp = join(w, '.claude/session-hub/landings.journal')
  const aged = readFileSync(jp, 'utf8').split('\n').filter(Boolean).map((l) => {
    const rec = JSON.parse(l)
    if (rec.op === 'promise') rec.at = '2026-08-18T09:00:00-04:00'
    return JSON.stringify(rec)
  }).join('\n')
  writeFileSync(jp, `${aged}\n`)

  const r = run(w, ['--audit'])
  assert.equal(r.status, 1, 'a promise gone quiet must fail the audit, not merely be noted')
  assert.match(r.stdout.split('\n')[0], /PROMISE GONE QUIET/,
    'the verdict is the FIRST line — callers summarise by first line (obot.agent#129)')
  assert.match(r.stdout, /an org chart of who does what/)
})

test('audit: a promise that LANDED is not a finding, however old it is', () => {
  const w = ws()
  const f = join(w, 'org-chart.html')
  writeFileSync(f, 'here')
  run(w, ['promise', '--asked', 'the org chart', '--landing', f])
  run(w, ['check'])
  const jp = join(w, '.claude/session-hub/landings.journal')
  const aged = readFileSync(jp, 'utf8').split('\n').filter(Boolean).map((l) => {
    const rec = JSON.parse(l)
    if (rec.op === 'promise') rec.at = '2026-08-01T09:00:00-04:00'
    return JSON.stringify(rec)
  }).join('\n')
  writeFileSync(jp, `${aged}\n`)
  const r = run(w, ['--audit'])
  assert.equal(r.status, 0, r.stdout)
  assert.match(r.stdout, /record clean/)
})

test('audit: a summary hand-edited into the record below the bar is caught', () => {
  const w = ws()
  run(w, ['closure', '--issue', 'hub#264', '--summary', GOOD])
  // The tool refuses a bad sentence; a hand-edit of the journal is the other door,
  // and the audit is what is behind it.
  const jp = join(w, '.claude/session-hub/landings.journal')
  const text = readFileSync(jp, 'utf8').replace(GOOD, NUMBERS)
  writeFileSync(jp, text)
  const r = run(w, ['--audit'])
  assert.equal(r.status, 1)
  assert.match(r.stdout.split('\n')[0], /SUMMARY BELOW THE BAR/)
})

test('audit: an id the journal issued and the record has lost is a finding', () => {
  const w = ws()
  run(w, ['closure', '--issue', 'hub#264', '--summary', GOOD])
  writeFileSync(md(w), '# landings\n')
  const r = run(w, ['--audit'])
  assert.equal(r.status, 1)
  assert.match(r.stdout.split('\n')[0], /LANDING RECORD GAP/)
})

test('audit: an unwritten record says so rather than reporting a clean day', () => {
  const w = ws()
  const r = run(w, ['--audit'])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /not armed/)
  assert.match(r.stdout, /not the same as a clean day/,
    'nothing recorded and nothing to record are different facts (hub#223)')
})

// ---- the record only ever grows ----

test('the file only ever grows — a second entry never rewrites the first', () => {
  const w = ws()
  run(w, ['closure', '--issue', 'hub#264', '--summary', GOOD])
  const first = read(w)
  run(w, ['closure', '--issue', 'hub#251',
    '--summary', 'A worker can now say what it finished in one sentence and have that sentence reach him.'])
  const second = read(w)
  assert.ok(second.startsWith(first), 'the earlier content must survive verbatim')
  assert.match(second, /L0001/)
  assert.match(second, /L0002/)
})

test('render: the section leads with what completed, in his language, not with numbers', () => {
  const w = ws()
  run(w, ['closure', '--issue', 'hub#264', '--summary', GOOD])
  const r = run(w, ['render'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^## Landings/m)
  assert.match(r.stdout, /Completed today, in his language/)
  assert.match(r.stdout, /prove the process died/)
})

test('render: an unwritten record renders NO RECORD rather than an empty clean section', () => {
  const w = ws()
  const r = run(w, ['render'])
  assert.match(r.stdout, /NO RECORD/)
  assert.match(r.stdout, /unwritten one/)
})

test('list --json: the wake and the dashboard read one shape, and it carries the sentence', () => {
  const w = ws()
  run(w, ['closure', '--issue', 'hub#264', '--summary', GOOD, '--worker', 'W0080'])
  const r = run(w, ['list', '--json'])
  assert.equal(r.status, 0, r.stderr)
  const state = JSON.parse(r.stdout)
  assert.equal(state.armed, true)
  assert.equal(state.closures.length, 1)
  assert.equal(state.closures[0].summary, GOOD)
  assert.equal(state.closures[0].issue, 'hub#264')
  assert.equal(state.closures[0].worker, 'W0080')
})

test('list --json on a fresh machine says armed:false rather than an empty clean record', () => {
  const w = ws()
  const state = JSON.parse(run(w, ['list', '--json']).stdout)
  assert.equal(state.armed, false)
  assert.deepEqual(state.closures, [])
})

// ---- the ledger mechanism it shares with every other id family ----

test('ids come from the journal, never from prose in the record (obot.agent#126)', () => {
  const w = ws()
  run(w, ['closure', '--issue', 'hub#264', '--summary', GOOD])
  mkdirSync(join(w, '.claude/session-hub'), { recursive: true })
  writeFileSync(md(w), `${read(w)}\n- a mention of L0009 in body prose\n`)
  run(w, ['closure', '--issue', 'hub#251',
    '--summary', 'A second closure still takes the next journal id and not the one named in prose.'])
  assert.match(read(w), /L0002/, 'the next id is L0002 — a mention in prose has no vote')
})

// ---- the check is bounded in WALL-CLOCK, not only in count ----
//
// `--max` bounds how many landings are looked at; it does not bound how long looking
// takes. Five landings against a black-holing host is five curl timeouts in series,
// inside a sweep that runs every five minutes and whose contract is the release-
// candidate queue rather than this. A count cap that can still cost a minute is the
// kind of bound that reads as one and is not.

test('check: the budget stops the run, and what it did not reach is NAMED not swallowed', () => {
  const w = ws()
  for (let i = 0; i < 5; i += 1) {
    // TEST-NET-1 (RFC 5737): reserved for documentation and guaranteed not to route,
    // so curl hangs until its own timeout rather than being refused in a millisecond.
    // A refused connection would finish all five inside the budget and the test would
    // pass while proving nothing.
    run(w, ['promise', '--asked', `thing ${i}`, '--landing', `https://192.0.2.1/${i}`])
  }
  const started = Date.now()
  const r = run(w, ['check', '--budget-sec', '1', '--timeout', '1'])
  const elapsed = (Date.now() - started) / 1000
  assert.equal(r.status, 0, r.stderr)
  assert.ok(elapsed < 12, `the run took ${elapsed}s; the budget is meant to stop it`)
  assert.match(r.stdout, /not reached/,
    'a silent truncation reads as "checked everything" when it did not (no-silent-caps)')
})

test('check: a budget that is not spent checks everything it was asked to', () => {
  const w = ws()
  for (let i = 0; i < 3; i += 1) {
    run(w, ['promise', '--asked', `thing ${i}`, '--landing', join(w, `missing-${i}`)])
  }
  const r = run(w, ['check', '--budget-sec', '30'])
  assert.match(r.stdout, /fetched 3 landing\(s\)/)
  assert.doesNotMatch(r.stdout, /not reached/)
})
