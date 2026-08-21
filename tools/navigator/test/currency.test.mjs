// The currency of a claim — one mechanism, two artifact classes.
//
// Requirements jwildfire/obot.roadmap#264 and #266, issue jwildfire/obot.agent#262.
//
// What these hold down is not that a command can be run. It is the two things that
// would quietly destroy the capability:
//
//   1. UNKNOWN IS NOT A FAIL. A verify that never started — a missing binary, a
//      timeout, a command the allowlist will not run — must never be recorded or
//      rendered as a verify that came back negative. Collapsing them is the defect
//      this program has fixed in six separate files this week, and it was live in this
//      exact code path: `runVerify` coerced a spawn failure to `exitCode: 1` and judged
//      it. An item nothing could check would then read as an item still waiting on him.
//
//   2. A HEADLINE THAT DOES NOT MATCH `ALARM_RE` RENDERS AS GREY TEXT. The regular
//      expression is imported from the dashboard rather than copied here, because a
//      copy is a second source of truth that drifts silently and what it costs is a
//      finding nobody sees (obot.agent#223).
//
// Plus the containment rule the config half carries everywhere: ids and counts reach a
// surface, item text never does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  ALARM_PREMISE, ALARM_READING, HISTORY, LIVE, checkArtifact, companionSurfaces,
  configClaims, configCurrency, currencySection, malformedPremises, parsePremises,
  premiseClaims, runClaims,
} from '../currency.mjs'
import {
  FAILS, HOLDS, UNKNOWN, currency, currencyPhrase, judge, noAnswer, parseClaim,
  readChecks, runClaim, runFailure, shellMeta, verifyPlan,
} from '../../lib/claims.mjs'
import { ALARM_RE, parseNavigatorState } from '../../ops-dashboard/lib/navigator.mjs'
import { renderState } from '../sweep.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'currency-'))

/** A workspace with a config list holding the entries given. */
function workspace(entries) {
  const ws = tmp()
  fs.mkdirSync(path.join(ws, '.claude'), { recursive: true })
  fs.writeFileSync(path.join(ws, '.claude', 'blockers.md'), `# Config\n\n## Open\n\n${entries.join('\n\n')}\n`)
  return ws
}

const entry = (id, title, verify) => `- [ ] ${id} · filed 2026-08-18 — **${title}**
  Do: something only his hands can do
  Expect: it worked
  Verify: ${verify}`

/** A hub clone with a decisions registry and the pages named. */
function hub(artifacts) {
  const root = tmp()
  const dir = path.join(root, 'reports', 'decisions')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({
    artifacts: artifacts.map(({ id, slug, state, title }) => ({ id, slug, state, title })),
  }))
  for (const a of artifacts) {
    if (a.page === null) continue
    fs.mkdirSync(path.join(dir, a.slug), { recursive: true })
    fs.writeFileSync(path.join(dir, a.slug, 'index.html'), a.page ?? '<html><head></head></html>')
  }
  return root
}

// ------------------------------------------------------------- unknown is not a fail

test('a command that never started is unknown, not failed', async () => {
  const ws = tmp()
  // `git` is on the allowlist, so the plan admits it; the subcommand runs against a
  // directory that is not a repository, which is a real non-zero exit and a real fail.
  const real = await runClaim(ws, { id: 'x1', command: 'git rev-parse --git-dir', cwd: ws })
  assert.equal(real.result, 'fail')
  assert.equal(real.state, FAILS)

  // A binary the allowlist admits by name and this machine does not have.
  const missing = await runClaim(ws, { id: 'x2', command: 'rg --version-that-does-not-exist' })
  assert.notEqual(missing.result, 'fail', 'a command that produced no exit status is never a fail')
})

test('runFailure separates no-exit-status from a non-zero exit', () => {
  assert.equal(runFailure(null), null)
  assert.equal(runFailure({ code: 1 }), null, 'a numeric code is a real exit status')
  assert.equal(runFailure({ code: 127 }), null)
  assert.match(runFailure({ code: 'ENOENT' }), /not installed/)
  assert.match(runFailure({ killed: true, signal: 'SIGTERM', code: null }), /killed after the timeout/)
  assert.match(runFailure({ code: 'EACCES' }), /did not run/)
})

test('a killed command records unknown and keeps its reason', async () => {
  const ws = tmp()
  const rec = await runClaim(ws, { id: 'slow', command: 'git ls-files', timeoutMs: 1, cwd: ws })
  // Either it finished inside the millisecond or it was killed. Both are legitimate;
  // what is never legitimate is a kill reported as a fail.
  if (rec.result !== 'pass' && rec.result !== 'fail') {
    assert.equal(rec.state, UNKNOWN)
    assert.match(rec.why, /killed|did not run/)
  }
})

test('a refused command is never written to the ledger', async () => {
  const ws = tmp()
  const rec = await runClaim(ws, { id: 'nope', command: 'osascript -e beep' })
  assert.equal(rec.result, 'refused')
  assert.equal(rec.state, UNKNOWN)
  assert.equal(fs.existsSync(path.join(ws, '.claude', 'ops', 'checks.jsonl')), false,
    'a refusal is re-derivable from the command; recording it 288 times a day would bury the readings that are measurements')
})

test('a reading of a different command is not this claim’s reading', () => {
  const rec = { at: new Date().toISOString(), result: 'pass', command: 'test -f a' }
  const same = currency(rec, { command: 'test -f a' })
  assert.equal(same.state, HOLDS)
  const rewritten = currency(rec, { command: 'test -f b' })
  assert.equal(rewritten.state, UNKNOWN)
  assert.equal(rewritten.stale, true)
  assert.match(rewritten.why, /rewritten/)
})

test('never checked is phrased as never checked, not as a verdict', () => {
  assert.match(currencyPhrase(currency(null)), /Not checked yet/)
  const held = currency({ at: new Date(Date.now() - 4 * 60000).toISOString(), result: 'pass' })
  assert.equal(currencyPhrase(held), 'Checked 4 minutes ago: done.')
})

// ------------------------------------------------------------------ the config half

test('the config half reads every open item and plans each one once', () => {
  const ws = workspace([
    entry('c0001', 'a runnable one', 'test -f /nonexistent → the file exists'),
    entry('c0002', 'a manual one', 'manual — you look at your phone'),
    entry('c0003', 'a piped one', 'pmset -g sched | grep -q 06:55 → exits 0'),
  ])
  const { claims, read } = configClaims(ws)
  assert.equal(read, true)
  assert.deepEqual(claims.map((c) => c.id), ['c0001', 'c0002', 'c0003'])
  assert.equal(claims[0].plan.auto, true)
  assert.equal(claims[1].plan.auto, false)
  assert.equal(claims[2].plan.auto, false)
  assert.match(claims[2].plan.why, /chaining/)
})

test('an unreadable config list is a broken reading, not an empty queue', () => {
  const section = currencySection({ config: { read: false, why: 'EACCES' }, premises: { read: true, results: [], artifacts: 0, skipped: 0 } })
  assert.match(section, ALARM_RE)
  assert.match(section, /not the same as no item needing him/)
})

test('a manual item is not checkable, which is not the same as never checked', () => {
  const ws = workspace([entry('c0009', 'ask a human', 'manual — somebody outside this loop confirms it')])
  const item = configClaims(ws).claims[0]
  const cur = configCurrency({ id: 'c0009', iq: { verify: { command: null, manual: true } } }, {})
  assert.equal(cur.state, UNKNOWN)
  assert.equal(cur.auto, false)
  assert.match(cur.phrase, /Nothing here can check this for you/)
  assert.equal(item.plan.auto, false)
})

test('an item its own check proves done reports done, and one that fails reports outstanding', () => {
  const at = new Date().toISOString()
  const done = configCurrency({ id: 'c1', iq: { verify: { command: 'test -f a' } } },
    { c1: { at, result: 'pass', command: 'test -f a' } })
  assert.equal(done.state, HOLDS)
  assert.equal(done.done, true)
  assert.match(done.phrase, /done\./)

  const out = configCurrency({ id: 'c2', iq: { verify: { command: 'test -f a' } } },
    { c2: { at, result: 'fail', command: 'test -f a' } })
  assert.equal(out.state, FAILS)
  assert.equal(out.done, false)
  assert.match(out.phrase, /still outstanding/)
})

test('config item text never reaches the section — ids and counts only', async () => {
  const secret = 'the exact keystrokes only his hands can type'
  const ws = workspace([entry('c0042', secret, 'test -f /nonexistent → the file exists')])
  const cfg = configClaims(ws)
  const config = { ...cfg, ...(await runClaims(ws, cfg.claims)) }
  const section = currencySection({ config, premises: { read: true, results: [], artifacts: 0, skipped: 0 } })
  assert.match(section, /c0042/)
  assert.equal(section.includes(secret), false, 'the list is local-only and this file is read by agents')
  assert.equal(section.includes('/nonexistent'), false, 'the command is item text too')
})

// ----------------------------------------------------------------- the premise half

test('a premise is one meta line, in the artifact’s own head', () => {
  const html = `<head>
<meta name="description" content="what the page is">
<meta name="premise" content="the release is still held at the tag | gh release view v1.1.0 -R x/y --json isDraft --jq .isDraft → prints true">
</head>`
  const [p] = parsePremises(html)
  assert.equal(p.sentence, 'the release is still held at the tag')
  assert.equal(p.command, 'gh release view v1.1.0 -R x/y --json isDraft --jq .isDraft')
  assert.equal(p.expect, 'prints true')
  assert.equal(verifyPlan({ verify: p }).auto, true)
})

test('a page may declare several premises, and an escaped arrow still parses', () => {
  const html = `<meta name='premise' content='first | test -f a &rarr; the file exists'>
<meta name="premise" content="second | test -f b &#8594; the file exists">
<meta name="premise" content="third | manual — you look">`
  const ps = parsePremises(html)
  assert.deepEqual(ps.map((p) => p.sentence), ['first', 'second', 'third'])
  assert.deepEqual(ps.map((p) => p.command), ['test -f a', 'test -f b', null])
  assert.equal(ps[2].manual, true)
})

test('a premise with no sentence still parses — the proof is the load-bearing half', () => {
  assert.deepEqual(parseClaim('test -f a → the file exists'),
    { sentence: null, manual: false, command: 'test -f a', expect: 'the file exists' })
})

test('only the artifacts still awaiting him are re-checked, and the rest are counted', () => {
  const page = (s) => `<head><meta name="premise" content="${s} | test -f /nonexistent → the file exists"></head>`
  const root = hub([
    { id: 'D0019', slug: 'open-one', state: 'open', page: page('a') },
    { id: 'D0020', slug: 'partial-one', state: 'partially decided', page: page('b') },
    { id: 'D0018', slug: 'decided-one', state: 'decided', page: page('c') },
    { id: 'D0017', slug: 'closed-one', state: 'closed', page: page('d') },
  ])
  const r = premiseClaims(root)
  assert.equal(r.read, true)
  assert.equal(r.artifacts, 2)
  assert.equal(r.skipped, 2, 'a bound nobody can see reads as full coverage')
  assert.deepEqual(r.claims.map((c) => c.id), ['D0019.p1', 'D0020.p1'])
})

test('a hub with no registry is absent; a hub with a broken one is unreadable', () => {
  const absent = premiseClaims(tmp())
  assert.equal(absent.read, false)
  assert.equal(absent.absent, true)

  const root = tmp()
  fs.mkdirSync(path.join(root, 'reports', 'decisions'), { recursive: true })
  fs.writeFileSync(path.join(root, 'reports', 'decisions', 'registry.json'), 'not json')
  const broken = premiseClaims(root)
  assert.equal(broken.read, false)
  assert.equal(broken.absent, false)
})

test('an artifact the registry names but whose page cannot be read is a finding, not a silence', () => {
  const root = hub([{ id: 'D0019', slug: 'gone', state: 'open', page: null }])
  const r = premiseClaims(root)
  assert.equal(r.read, true)
  assert.equal(r.claims.length, 0)
  assert.equal(r.unreadable.length, 1)
  const section = currencySection({
    config: { read: true, results: [] },
    premises: { ...r, results: [] },
  })
  assert.match(section, ALARM_RE)
})

// ------------------------------------------------------------------- the headlines

test('the headlines match the real ALARM_RE, imported rather than copied', () => {
  assert.match(ALARM_PREMISE, ALARM_RE)
  assert.match(ALARM_READING, ALARM_RE)
})

test('an expired premise reaches the page as an alarm and names the artifact', async () => {
  const now = new Date()
  const results = [{
    id: 'D0021.p1', artifact: 'D0021', slug: '2026-08-17-safetycensus-stay-or-go',
    sentence: 'the release is still held at the tag', command: 'gh release view v1.1.0 -R x/y --json isDraft --jq .isDraft',
    expect: 'prints true', state: FAILS, cur: currency({ at: now.toISOString(), result: 'fail' }, { now }),
  }]
  const section = currencySection({
    config: { read: true, results: [] },
    premises: { read: true, results, artifacts: 1, skipped: 0, unreadable: [] },
  })
  assert.match(section, ALARM_RE)
  assert.match(section, /D0021/)
  assert.match(section, /the release is still held at the tag/)
  // The parser the dashboard actually uses has to see it as an alarm too.
  const parsed = parseNavigatorState(`# x\n\nswept: 2026-08-18 07:00 · cadence 5m\n\n${section}`, now)
  const rows = parsed.sections.flatMap((s) => s.items)
  assert.equal(rows.some((r) => r.alarm), true, 'a headline that renders grey is a finding nobody sees')
})

test('a section with nothing wrong is not an alarm', () => {
  const now = new Date()
  const holding = (id) => ({ id, artifact: id.split('.')[0], sentence: 'still true', command: 'test -f a', expect: '', state: HOLDS, cur: currency({ at: now.toISOString(), result: 'pass' }, { now }) })
  const section = currencySection({
    config: { read: true, results: [{ id: 'c0001', state: FAILS, cur: currency({ at: now.toISOString(), result: 'fail' }, { now }) }] },
    premises: { read: true, results: [holding('D0020.p1')], artifacts: 1, skipped: 3, unreadable: [] },
  })
  assert.doesNotMatch(section, ALARM_RE)
  assert.match(section, /1 hold/)
  assert.match(section, /3 decided or closed artifacts not re-checked/)
})

test('the three states render distinguishably in one section', async () => {
  const now = new Date()
  const at = now.toISOString()
  const results = [
    { id: 'c0001', state: HOLDS, cur: currency({ at, result: 'pass' }, { now }) },
    { id: 'c0002', state: FAILS, cur: currency({ at, result: 'fail' }, { now }) },
    { id: 'c0003', state: UNKNOWN, why: 'manual check — nothing to run', cur: currency(null) },
  ]
  const section = currencySection({ config: { read: true, results }, premises: { read: true, results: [], artifacts: 0, skipped: 0, unreadable: [] } })
  assert.match(section, /1 done · 1 still outstanding · 1 unchecked/)
  assert.match(section, /done — their own check now passes[^\n]*c0001/)
  assert.match(section, /still outstanding, measured: c0002/)
  assert.match(section, /c0003 unchecked — manual check[^\n]*Unknown, not outstanding and not done/)
})

// ------------------------------------------------------------------ the sweep's ride

test('a claim the budget did not reach keeps its previous reading and says so', async () => {
  const ws = tmp()
  const claims = [
    { id: 'a', command: 'test -f a', expect: '', plan: { auto: true } },
    { id: 'b', command: 'test -f b', expect: '', plan: { auto: true } },
  ]
  let calls = 0
  let t = 0
  const run = async (_ws, c) => { calls += 1; t += 1000; return { id: c.id, result: 'fail', state: FAILS, at: new Date().toISOString(), command: c.command } }
  const { results, notReached } = await runClaims(ws, claims, { budgetMs: 500, run, clock: () => t })
  assert.equal(calls, 1, 'the budget stops the pass starting new commands')
  assert.equal(notReached, 1)
  assert.equal(results[1].ran, false)
  assert.match(results[1].why, /not reached/)
  assert.equal(results[1].state, UNKNOWN, 'never measured is unknown, not outstanding')
})

test('the sweep renders the section, and says so loudly when the pass did not run', () => {
  const meta = { sweptAt: '2026-08-18 07:00', cadenceMin: 5, repoCount: 7, ok: true, errors: [], lastGoodAt: '2026-08-18 07:00' }
  const withIt = renderState({ snapshot: {}, events: [], meta, currency: '## Claim currency — what has been re-checked, and when\n\nconfig: 1 open · 1 done\n' })
  assert.match(withIt, /## Claim currency/)
  assert.match(withIt, /config: 1 open/)

  const without = renderState({ snapshot: {}, events: [], meta })
  assert.match(without, /## Claim currency/)
  assert.match(without, ALARM_RE)
  assert.match(without, /Unknown, not clean/)
})

test('the section sits above the queue — a stale claim is found before he goes to the keyboard', () => {
  const meta = { sweptAt: '2026-08-18 07:00', cadenceMin: 5, repoCount: 7, ok: true, errors: [], lastGoodAt: '2026-08-18 07:00' }
  const md = renderState({ snapshot: {}, events: [], meta, currency: '## Claim currency — what has been re-checked, and when\n\nconfig: 0 open\n' })
  assert.ok(md.indexOf('## Claim currency') < md.indexOf('## RC queue'))
})

// ------------------------------------------------------------------- the judge, kept

test('prints outranks the exit code, because a correct answer can exit non-zero', () => {
  assert.equal(judge(1, '0', 'prints 0'), 'pass')
  assert.equal(judge(0, '1', 'prints 0'), 'fail')
  assert.equal(judge(0, 'https://…/u/3680095?v=4', 'not u/3680095'), 'fail')
  assert.equal(judge(0, 'https://…/u/999?v=4', 'not u/3680095'), 'pass')
})

test('the ledger keeps every reading, so "it held on the 16th and does not now" survives', async () => {
  const ws = tmp()
  await runClaim(ws, { id: 'c1', command: 'git rev-parse --git-dir', cwd: ws })
  await runClaim(ws, { id: 'c1', command: 'git rev-parse --git-dir', cwd: ws })
  const lines = fs.readFileSync(path.join(ws, '.claude', 'ops', 'checks.jsonl'), 'utf8').trim().split('\n')
  assert.equal(lines.length, 2)
  assert.equal(Object.keys(readChecks(ws)).length, 1, 'the reader keeps the newest per id')
  assert.equal(JSON.parse(lines[0]).state, FAILS)
})

// ------------------------------------------- a shell was intended, or a quoted string

test('shell metacharacters count outside quotes and not inside them', () => {
  // Refused: the author wrote for a shell, and running it without one answers a
  // different question silently.
  assert.equal(shellMeta('pmset -g sched | grep -q 06:55'), '|')
  assert.equal(shellMeta('launchctl print gui/$UID/com.obot.x > /dev/null'), '$')
  assert.equal(shellMeta('gh pr view 198 --json state --jq .state | grep -qx MERGED'), '|')
  // Admitted: one command, and the metacharacters are characters in an argument that
  // `execFile` passes through untouched. 👯🤖 W0071's proof does its own work in jq.
  assert.equal(shellMeta(`gh api repos/x/y/contents/NAMESPACE --jq '.content | @base64d | test("export")'`), null)
  assert.equal(shellMeta(`grep -c "a|b" file`), null)
  assert.equal(shellMeta(`grep -c "a\\"b" file`), null)
  // And the plan agrees, which is the half that matters.
  assert.equal(verifyPlan({ verify: { command: `gh api repos/x/y/contents/N --jq '.a | @base64d'` } }).auto, true)
  assert.equal(verifyPlan({ verify: { command: 'pmset -g sched | grep -q x' } }).auto, false)
})

// ---------------------------------------- a command that ran but answered nothing

test('a prints-X claim whose command errored is unknown, not broken', () => {
  // 👯🤖 W0071's missing-file control, with the bytes measured on the real API rather
  // than the bytes it was assumed to produce: with `--jq` attached a 404 prints the
  // error object to STDOUT and exits 1, so an emptiness test alone misses it.
  const body = '{"message":"Not Found","status":"404"}'
  assert.equal(noAnswer(1, body, 'prints true', 'gh: Not Found (HTTP 404)'),
    'exited non-zero and reported an error, so what it printed is the failure rather than the answer')
  assert.equal(noAnswer(1, '', 'prints true', ''),
    'exited non-zero and printed nothing, so there was no output to compare with what the claim expects')

  // What it must NOT catch, and both are live on the config list today.
  assert.equal(noAnswer(1, '0', 'prints 0', ''), null, 'grep -c prints the right answer and exits 1')
  assert.equal(noAnswer(1, '', 'the file exists', 'test: no such file'), null, 'a prose expectation is judged on the exit code')
  assert.equal(noAnswer(0, '', 'prints true', 'a warning'), null, 'a clean exit answered the question')
})

test('a not-X claim whose command could not run is unknown, not broken', () => {
  // The reading a machine with no history produces. D0025 argues from "the prepared
  // safetyCharts work is still on this laptop only, because the branch has never been
  // pushed", proved by `git --git-dir=safetyCharts/.git branch -r --contains
  // remove-tendril → not origin/`. On a new laptop that repository is not cloned yet,
  // so git exits 128 with `fatal: not a git repository` on stderr and nothing on
  // stdout — and the page said **PREMISE BROKEN**, in a sentence carrying "checked
  // just now". Nobody checked anything: the thing the premise asks about is not here.
  assert.equal(noAnswer(128, '', 'not origin/', "fatal: not a git repository: 'safetyCharts/.git'"),
    'exited non-zero and reported an error, so what it printed is the failure rather than the answer')
  assert.equal(noAnswer(1, '', 'not origin/', 'gh auth login'),
    'exited non-zero and reported an error, so what it printed is the failure rather than the answer')

  // The half that deliberately does NOT carry over from `prints X`. Empty output is a
  // legitimate ANSWER to `not X` — "what it printed does not contain X" — where for
  // `prints X` there is nothing to compare against. A rule that read both halves here
  // would swallow a real negative into `unknown`.
  assert.equal(noAnswer(1, '', 'not origin/', ''), null, 'no error: the empty output is the answer')
  assert.equal(noAnswer(0, '', 'not origin/', 'a warning'), null, 'a clean exit answered the question')
  assert.equal(noAnswer(0, 'origin/main', 'not origin/', ''), null)

  // And nothing above changes what the two other expectation forms do.
  assert.equal(noAnswer(1, '0', 'prints 0', ''), null, 'grep -c prints the right answer and exits 1')
  assert.equal(noAnswer(1, '', 'the file exists', 'test: no such file'), null, 'a prose expectation is judged on the exit code')
})

test('the negative control still discriminates — a proof that always passes is not a proof', () => {
  // The other half of W0071's set: the same shape returning false must read as broken,
  // or the check is decorative.
  assert.equal(judge(0, 'false', 'prints true'), 'fail')
  assert.equal(judge(0, 'true', 'prints true'), 'pass')
})

// ------------------------------------------------------- the extractor, quote-aware

test('a premise containing quotes and pipes survives extraction whole', () => {
  const cmd = `gh api repos/x/y/contents/NAMESPACE --jq '.content | gsub("\\n";"") | @base64d | test("export")'`
  const html = `<meta name="premise" content="the function is still exported | ${cmd.replace(/"/g, '&quot;')} → prints true">`
  const [p] = parsePremises(html)
  assert.equal(p.sentence, 'the function is still exported')
  assert.equal(p.command, cmd, 'a value matcher that stops at the first quote of either kind judges a fragment')
  assert.equal(p.expect, 'prints true')
})

test('a meta tag whose value contains > is still one tag', () => {
  const html = `<meta name="premise" content="a | grep -c &quot;x>y&quot; f → prints 1">
<meta name="premise" content="b | test -f z → the file exists">`
  assert.equal(parsePremises(html).length, 2)
})

test('a premise nobody can read is counted rather than vanishing', () => {
  // An unbalanced quote matches nothing strict, so without this the page looks like it
  // declares a premise and the sweep reports nothing at all.
  const html = `<meta name="premise" content="a | test -f z → the file exists">
<meta name="premise" content=broken >`
  assert.equal(parsePremises(html).length, 1)
  assert.equal(malformedPremises(html), 1)
})

test('a malformed declaration reaches the page as an alarm', () => {
  const root = hub([{ id: 'D0019', slug: 'one', state: 'open', page: '<meta name="premise" content=nope >' }])
  const r = premiseClaims(root)
  assert.equal(r.unreadable.length, 1)
  assert.match(r.unreadable[0], /could not be read/)
  const section = currencySection({ config: { read: true, results: [] }, premises: { ...r, results: [] } })
  assert.match(section, ALARM_RE)
})

// --------------------------------------------------------------- the five surfaces

test('a broken premise names every surface that restates it', () => {
  const now = new Date()
  const surfaces = companionSurfaces('/nonexistent', 'a-slug', {
    since: '2026-08-18T06:00:00Z',
    git: (_root, rel) => (rel.endsWith('registry.json') ? '2026-08-17T09:00:00Z' : '2026-08-18T09:00:00Z'),
  })
  assert.equal(surfaces.length, 4)
  assert.equal(surfaces.find((s) => s.rel?.endsWith('registry.json')).stale, true)
  assert.equal(surfaces.find((s) => s.rel === 'reports/decisions/README.md').stale, false)
  // The one nobody read says so instead of being left out.
  const gh = surfaces.find((s) => s.rel === null)
  assert.match(gh.name, /discussion/)
  assert.match(gh.unchecked, /nothing here has read it/)

  const section = currencySection({
    config: { read: true, results: [] },
    premises: {
      read: true, artifacts: 1, skipped: 0, unreadable: [],
      results: [{
        id: 'D0021.p1', artifact: 'D0021', slug: 'a-slug', sentence: 'the release is held',
        command: 'gh release view v1 --json isDraft --jq .isDraft', expect: 'prints true',
        state: FAILS, surfaces, cur: currency({ at: now.toISOString(), result: 'fail' }, { now }),
      }],
    },
  })
  assert.match(section, /also stated on the artifact README/)
  assert.match(section, /still to bring along/)
  assert.match(section, /the Q&A discussion title[^\n]*nothing here has read it/)
})

test('a surface whose modification time cannot be read is unknown, not stale', () => {
  const [first] = companionSurfaces('/nonexistent', 'a-slug', { since: '2026-08-18T06:00:00Z', git: () => null })
  assert.equal(first.at, null)
  assert.equal(first.stale, null, 'unreadable is not a third way of saying out of date')
})

// ------------------------------------------------------------------- publish time

test('the publish-time gate answers for one artifact and fails on a premise that does not hold', async () => {
  const page = (s, cmd, exp) => `<meta name="premise" content="${s} | ${cmd} → ${exp}">`
  const root = hub([
    { id: 'D0019', slug: 'good', state: 'open', page: page('a', 'git rev-parse --git-dir', 'the answer') },
    { id: 'D0020', slug: 'bad', state: 'open', page: page('b', 'git rev-parse --git-dir', 'prints nothing-like-this') },
  ])
  const ws = tmp()
  const ok = await checkArtifact(ws, root, 'good')
  const bad = await checkArtifact(ws, root, 'bad')
  // `git rev-parse` outside a repository exits non-zero: the prose expectation reads
  // that as the answer, the `prints` one as an error it could not compare.
  assert.equal(ok.results.length, 1)
  assert.equal(bad.results.length, 1)
  assert.equal(bad.ok, false)
  assert.equal(ok.ok, false, 'neither holds here — what matters is that both were measured')
})

test('an artifact that declares no premise is not a failure', async () => {
  const root = hub([{ id: 'D0019', slug: 'quiet', state: 'open', page: '<html></html>' }])
  const r = await checkArtifact(tmp(), root, 'quiet')
  assert.equal(r.ok, true)
  assert.match(r.why, /declares a premise/)
})

// ------------------------------------- what decides a re-check is the premise, not the
// artifact's state (obot.agent#302, under obot.roadmap#266 call n0245)

/** One premise line, with a scope when one is given. */
const prem = (sentence, { scope = null, cmd = 'test -f /nonexistent', expect = 'the file exists' } = {}) =>
  `<meta name="premise"${scope === null ? '' : ` scope="${scope}"`} content="${sentence} | ${cmd} → ${expect}">`

test('a live premise on a decided artifact is re-checked and a history one is not', () => {
  const root = hub([{
    id: 'D0020',
    slug: 'decided-one',
    state: 'decided',
    page: `<head>
${prem('the rename is approved and nobody has applied it yet', { scope: 'live' })}
${prem('the release was published before this page was written', { scope: 'history' })}
</head>`,
  }])
  const r = premiseClaims(root)
  assert.deepEqual(r.claims.map((c) => c.id), ['D0020.p1'], 'decided is not the same as no longer claiming anything')
  assert.equal(r.claims[0].scope, LIVE)
  assert.equal(r.live, 1)
  assert.equal(r.liveArtifacts, 1)
  assert.equal(r.history, 1)
  assert.equal(r.declared, 2, 'the history one is still read — it is checked at publish time')
  assert.equal(r.skipped, 0, 'this artifact IS re-checked, so counting it as skipped would be a lie')
  assert.deepEqual(r.undeclared, [])
})

test('the premise decides on an open artifact too — history is history wherever it is written', () => {
  const root = hub([{
    id: 'D0022',
    slug: 'open-one',
    state: 'open',
    page: `${prem('a claim about today')}${prem('what was true in June', { scope: 'history' })}`,
  }])
  const r = premiseClaims(root)
  assert.deepEqual(r.claims.map((c) => c.id), ['D0022.p1'], 'the artifact state is only the default')
  assert.equal(r.history, 1)
  assert.equal(r.claims[0].scope, null, 'undeclared on an open artifact still defaults to re-checked')
})

test('an undeclared premise on a settled artifact is named, never quietly dropped', () => {
  const root = hub([
    { id: 'D0018', slug: 'settled', state: 'decided', page: prem('nobody said which kind this is') },
    { id: 'D0017', slug: 'gone-quiet', state: 'closed', page: '<html></html>' },
  ])
  const r = premiseClaims(root)
  assert.deepEqual(r.claims, [])
  assert.deepEqual(r.undeclared, ['D0018.p1'])
  assert.equal(r.history, 0, 'undeclared is not history — collapsing them is the defect')
  assert.equal(r.skipped, 2)
  const section = currencySection({ config: { read: true, results: [] }, premises: { ...r, results: [] } })
  assert.match(section, /no scope declared: 1 premise[^\n]*D0018\.p1/)
  assert.match(section, /not the same as history/)
  // A gap in the artifacts, not a finding about the world: it must not go red, or the
  // permanent-alarm problem the skip exists to prevent comes back one word over.
  assert.doesNotMatch(section, ALARM_RE)
})

test('a scope nobody can read is refused rather than defaulted, and says so', () => {
  const root = hub([{ id: 'D0022', slug: 'open-one', state: 'open', page: prem('a claim', { scope: 'alive' }) }])
  const r = premiseClaims(root)
  assert.deepEqual(r.claims, [], 'guessing which kind the author meant is what this replaces')
  assert.equal(r.unreadable.length, 1)
  assert.match(r.unreadable[0], /is not a scope/)
  assert.match(r.unreadable[0], /Refused rather than guessed/)
  const section = currencySection({ config: { read: true, results: [] }, premises: { ...r, results: [] } })
  assert.match(section, ALARM_RE, 'a declaration nothing can read must be loud, not a silent default')
})

test('the three scopes render as three states in one section', () => {
  const now = new Date()
  const held = {
    id: 'D0020.p1', artifact: 'D0020', slug: 'a', sentence: 'still true today', scope: LIVE,
    command: 'test -f a', expect: '', state: HOLDS, cur: currency({ at: now.toISOString(), result: 'pass' }, { now }),
  }
  const section = currencySection({
    config: { read: true, results: [] },
    premises: {
      read: true, results: [held], artifacts: 1, skipped: 16, live: 1, liveArtifacts: 1,
      history: 3, undeclared: ['D0021.p2', 'D0021.p3'], awaitingSilent: 0, declared: 6, unreadable: [],
    },
  })
  assert.match(section, /premises: 1 re-checked across 1 artifact/)
  assert.match(section, /16 decided or closed artifacts not re-checked/)
  assert.match(section, /live on settled: 1 premise on 1 decided or closed artifact/)
  assert.match(section, /history: 3 premises[^\n]*publish time/)
  assert.match(section, /no scope declared: 2 premises[^\n]*D0021\.p2, D0021\.p3/)
  assert.doesNotMatch(section, ALARM_RE)
})

test('nothing re-checked is not the same as nothing declared', () => {
  const base = { read: true, results: [], artifacts: 0, skipped: 1, live: 0, liveArtifacts: 0, history: 0, undeclared: [], awaitingSilent: 0, unreadable: [] }
  const none = currencySection({ config: { read: true, results: [] }, premises: { ...base, declared: 0 } })
  const some = currencySection({ config: { read: true, results: [] }, premises: { ...base, declared: 4, history: 4 } })
  assert.match(none, /No artifact declares a premise yet/)
  assert.match(some, /No premise is re-checked at all/)
  assert.doesNotMatch(some, /No artifact declares a premise yet/)
})

test('the publish-time gate answers for a decided artifact, whatever the scope', async () => {
  // The hole underneath the hole: `checkArtifact` read through the cadence's filter, so
  // an author adding a live premise to a decided page was told the page declared none.
  const root = hub([{
    id: 'D0020',
    slug: 'decided-one',
    state: 'decided',
    page: `${prem('a', { scope: 'live', cmd: 'git rev-parse --git-dir', expect: 'the answer' })}${prem('b', { scope: 'history', cmd: 'git rev-parse --git-dir', expect: 'the answer' })}`,
  }])
  const r = await checkArtifact(tmp(), root, 'decided-one')
  assert.equal(r.why, null, 'a page that declares two premises must never be reported as declaring none')
  assert.deepEqual(r.results.map((x) => x.scope), [LIVE, HISTORY])
  assert.equal(r.results.length, 2, 'a history premise is measured here and only here')
})

// ------------------------------------------- a live premise that cannot break is not one

test('prints compares the whole expectation, not its first word', () => {
  // D0020's premise expects a title with spaces in it. Judged on the first word alone
  // the rest never mattered; judged on the exit code — where a multi-word expectation
  // used to land — a `gh ... --jq` read passes whatever it printed.
  assert.equal(judge(0, 'Goal: increased autonomy in obot.agent', 'prints Goal: increased autonomy in obot.agent'), 'pass')
  assert.equal(judge(0, 'Goal: the app', 'prints Goal: increased autonomy in obot.agent'), 'fail')
  assert.equal(judge(0, 'OPEN', 'prints OPEN'), 'pass')
  assert.equal(judge(1, '0', 'prints 0'), 'pass', 'the single-token reading is unchanged')
})

test('a multi-word prints claim whose command errored is unknown, not broken', () => {
  assert.match(noAnswer(1, '', 'prints No destinations configured'), /nothing to compare|no output to compare/)
  assert.match(noAnswer(1, '{"message":"Not Found"}', 'prints No destinations configured', 'gh: Not Found'), /the failure rather than the answer/)
  assert.equal(noAnswer(1, '0', 'prints 0'), null, 'grep -c printing 0 with no stderr is still an answer')
})
