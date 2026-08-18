// The bot's own commit identity, and the check that catches a wrong one
// (obot.agent#241, jwildfire/obot.roadmap#260).
//
// The defect these guard is not a stale constant. Counting every commit in the seven
// active checkouts on 2026-08-18 found ONE correct address, one legacy address that
// also links, and THIRTY-EIGHT distinct wrong nine-digit ids across 301 commits — one
// of them reading 223456789. Twenty-six of the thirty-eight are allocated GitHub
// accounts. That is a model typing a plausible number from memory, once per session.
//
// skills/obot-identity/SKILL.md has carried the correct number, and the words "look-up
// not needed", the entire time. So the guarded property is not "the number is written
// down somewhere" — it always was — but that the number is RESOLVED from one module and
// never retyped, and that anything typing it anyway is reported.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BOT_LOGIN, BOT_USER_ID, BOT_EMAIL, BOT_EMAIL_LEGACY,
  classifyEmail, linksToBot, identityEnv, identityArgs,
  agentMarker, misattributed, scanCommits, renderIdentity,
} from '../../lib/identity.mjs'
import { ALARM_RE } from '../../ops-dashboard/lib/navigator.mjs'

test('the canonical address is composed from the id, so the two cannot disagree', () => {
  assert.equal(BOT_USER_ID, 299836032)
  assert.equal(BOT_EMAIL, `${BOT_USER_ID}+${BOT_LOGIN}@users.noreply.github.com`)
  // Verified live against the commits API on 2026-08-18: this address returns
  // author obotclaw[bot], and a wrong id returns author null.
  assert.equal(BOT_EMAIL, '299836032+obotclaw[bot]@users.noreply.github.com')
})

test('both linkable spellings are recognised, and every other id is not', () => {
  assert.equal(classifyEmail(BOT_EMAIL).kind, 'canonical')
  // The legacy id-less form links too — verified live on commit 072739b8 in the hub.
  // It matters because it is the one spelling of the bot address with no number in it
  // to get wrong.
  assert.equal(classifyEmail(BOT_EMAIL_LEGACY).kind, 'legacy')
  assert.equal(BOT_EMAIL_LEGACY, 'obotclaw[bot]@users.noreply.github.com')

  // The two forms that were live in this workspace's own config and code.
  assert.equal(classifyEmail('223504588+obotclaw[bot]@users.noreply.github.com').kind, 'wrong-id')
  assert.equal(classifyEmail('219968887+obotclaw[bot]@users.noreply.github.com').kind, 'wrong-id')
  assert.equal(classifyEmail('223504588+obotclaw[bot]@users.noreply.github.com').id, '223504588')

  assert.equal(classifyEmail('jwildfire@gmail.com').kind, 'not-bot')
  assert.equal(classifyEmail('41898282+github-actions[bot]@users.noreply.github.com').kind, 'not-bot')
  assert.equal(classifyEmail('').kind, 'not-bot')
  assert.equal(classifyEmail(undefined).kind, 'not-bot')

  assert.equal(linksToBot(BOT_EMAIL), true)
  assert.equal(linksToBot(BOT_EMAIL_LEGACY), true)
  assert.equal(linksToBot('219968887+obotclaw[bot]@users.noreply.github.com'), false)
  assert.equal(linksToBot('jwildfire@gmail.com'), false)
})

test('the environment form sets author AND committer, because half of it is not attribution', () => {
  const env = identityEnv({ PATH: '/usr/bin' })
  assert.equal(env.PATH, '/usr/bin', 'it extends the caller environment rather than replacing it')
  for (const k of ['GIT_AUTHOR_NAME', 'GIT_COMMITTER_NAME']) assert.equal(env[k], BOT_LOGIN)
  for (const k of ['GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL']) assert.equal(env[k], BOT_EMAIL)
})

test('the -c form carries the same values, so a caller cannot pick a different wrong one', () => {
  assert.deepEqual(identityArgs(), [
    '-c', `user.name=${BOT_LOGIN}`,
    '-c', `user.email=${BOT_EMAIL}`,
  ])
})

test('an agent commit is known by its trailers, which he does not write', () => {
  // This is the whole reason the check cannot false-positive on his own work: the
  // marker is something only the agent lane puts there. 110 commits authored as him
  // carry one; 87 authored as him carry none, and those 87 are his.
  assert.equal(agentMarker({ coAuthors: 'Claude Opus 5 <noreply@anthropic.com>', worker: '' }), 'co-authored')
  assert.equal(agentMarker({ coAuthors: '', worker: 'W0060' }), 'worker')
  assert.equal(agentMarker({ coAuthors: 'Zelos Zhu <zelos.zhu@atorusresearch.com>', worker: '' }), null)
  assert.equal(agentMarker({ coAuthors: '', worker: '' }), null)
})

test('the finding is an agent commit whose author does not link to the bot', () => {
  const commits = [
    { sha: 'aaa1111', email: BOT_EMAIL, coAuthors: 'Claude Opus 5 <noreply@anthropic.com>', worker: '', committer: BOT_EMAIL, subject: 'correct' },
    { sha: 'bbb2222', email: BOT_EMAIL_LEGACY, coAuthors: '', worker: 'W0007', committer: BOT_EMAIL_LEGACY, subject: 'legacy still links' },
    { sha: 'ccc3333', email: 'jwildfire@gmail.com', coAuthors: 'Claude Opus 5 <noreply@anthropic.com>', worker: '', committer: 'jwildfire@gmail.com', subject: 'his name on agent work' },
    { sha: 'ddd4444', email: '219968887+obotclaw[bot]@users.noreply.github.com', coAuthors: '', worker: 'W0052', committer: 'jwildfire@gmail.com', subject: 'a fabricated id' },
    { sha: 'eee5555', email: 'jwildfire@gmail.com', coAuthors: '', worker: '', committer: 'jwildfire@gmail.com', subject: 'his own commit' },
  ]
  const out = misattributed(commits)
  assert.deepEqual(out.findings.map((f) => f.sha), ['ccc3333', 'ddd4444'])
  assert.equal(out.findings[0].why, 'authored as him')
  assert.equal(out.findings[1].why, 'wrong id 219968887')
  assert.equal(out.scanned, 5)
  // His own commit is never a finding, whatever else is true of it.
  assert.ok(!out.findings.some((f) => f.sha === 'eee5555'))
})

test('a squash commit GitHub authored is counted separately, not dropped and not blamed', () => {
  // Three of these exist. Nothing on this machine could have prevented them — GitHub
  // set the author when he merged — so they are not a local mis-attribution. Counting
  // them in the finding would be wrong; dropping them silently would be a silent cap.
  const commits = [
    { sha: 'f1', email: 'jwildfire@gmail.com', coAuthors: 'Claude Opus 5 <noreply@anthropic.com>', worker: '', committer: 'noreply@github.com', subject: 'squash merge' },
  ]
  const out = misattributed(commits)
  assert.equal(out.findings.length, 0)
  assert.equal(out.merges, 1)
})

test('scanCommits reads a real repository, because the scheduler runs no fixture', () => {
  // The seam this test refuses to inject past: the sweep calls git for real, on a real
  // checkout, from launchd. A fixture-only test would pass while the git invocation
  // itself was wrong (obot.agent#229).
  const dir = mkdtempSync(join(tmpdir(), 'identity-scan-'))
  const git = (args, env) => execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8', env: { ...process.env, ...env },
  })
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.name', 'Jeremy Wildfire'])
  git(['config', 'user.email', 'jwildfire@gmail.com'])

  writeFileSync(join(dir, 'a.txt'), 'a')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'agent work wearing his name\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>'])

  writeFileSync(join(dir, 'b.txt'), 'b')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'his own work'])

  writeFileSync(join(dir, 'c.txt'), 'c')
  git(['add', '-A'])
  // Committed the way the whole fix says to commit: environment, resolved not typed.
  git(['commit', '-q', '-m', 'correctly attributed\n\nWorker: W0060'], identityEnv())

  const commits = scanCommits(dir, { sinceDays: 3650 })
  assert.equal(commits.length, 3, 'every commit in the window is read')
  const out = misattributed(commits)
  assert.equal(out.findings.length, 1)
  assert.equal(out.findings[0].why, 'authored as him')
  assert.match(out.findings[0].subject, /wearing his name/)

  // And the property the whole design turns on, proven against real git rather than
  // asserted: the environment beats the repository's own config.
  const correct = commits.find((c) => c.subject === 'correctly attributed')
  assert.equal(correct.email, BOT_EMAIL, 'GIT_AUTHOR_EMAIL overrode user.email in .git/config')
  assert.equal(correct.committer, BOT_EMAIL, 'and the committer too')
})

test('scanCommits reports an unreadable directory rather than reading it as clean', () => {
  // ENOENT is the only failure allowed to read as absence, and this is not ENOENT-as-
  // absence: a directory that is not a repository is unknown, not empty.
  assert.throws(() => scanCommits(join(tmpdir(), 'definitely-not-a-repo-w0060'), { sinceDays: 1 }))
})

test('a long finding list is capped, and says what it did not show', () => {
  // The first live run found 123 findings in a fourteen-day window. Printed in full
  // they would bury every other section of a file rewritten every five minutes; dropped
  // silently they would read as a shorter list than exists. Both counts survive.
  const findings = Array.from({ length: 12 }, (_, i) => ({
    sha: `sha${i}`, why: i % 2 ? 'authored as him' : 'wrong id 223504588',
    subject: `commit ${i}`, date: '2026-08-18T02:00:00-04:00',
  }))
  const md = renderIdentity([{ repo: 'obot.agent', scanned: 200, merges: 0, findings }], { stamp: '[git 09:55]' })
  assert.match(md, /12 of 200 commits/)
  assert.match(md, /6 authored as him, 6 on 1 wrong id/)
  assert.match(md, /and 7 more in this window, not shown here/)
  assert.equal(md.split('\n').filter((l) => l.trim().startsWith('- `sha')).length, 5)
})

test('the section reports when clean, and says NO READING when it could not look', () => {
  const clean = renderIdentity([{ repo: 'obot.agent', scanned: 12, findings: [], merges: 0 }], { stamp: '[git 09:55]' })
  assert.match(clean, /^## Commit identity/m)
  assert.match(clean, /clean/i)
  assert.doesNotMatch(clean, /BROKEN|FINDING/)

  const finding = renderIdentity([{
    repo: 'obot.roadmap',
    scanned: 40,
    merges: 1,
    findings: [{ sha: 'ccc3333', why: 'authored as him', subject: 'his name on agent work', date: '2026-08-18' }],
  }], { stamp: '[git 09:55]' })
  assert.match(finding, /COMMIT IDENTITY FINDING/)
  assert.match(finding, /ccc3333/)
  assert.match(finding, /authored as him/)
  // The dashboard renders a headline as an alarm only if it matches ALARM_RE, which
  // admits `[A-Z0-9 ]` around one keyword. A hyphen or a lowercase word inside the
  // asterisks loses the match silently and the finding renders as grey text.
  assert.ok(finding.split('\n').some((l) => ALARM_RE.test(l)), 'the finding headline must read as an alarm')

  const unread = renderIdentity([{ repo: 'safety.viz', error: 'not a git repository' }], { stamp: '[git 09:55]' })
  assert.match(unread, /COMMIT IDENTITY READING BROKEN/)
  assert.match(unread, /not a git repository/)
  assert.ok(unread.split('\n').some((l) => ALARM_RE.test(l)), 'an unread checkout is an alarm too')
  // And the empty case, which is the one a broken repo walk produces.
  assert.match(renderIdentity([], {}), /COMMIT IDENTITY READING BROKEN/)
  // A repo that could not be read must never be summarised as clean — and the line
  // that reports it says which of the two it is, in those words.
  const line = unread.split('\n').find((l) => l.includes('safety.viz'))
  assert.match(line, /unknown, not clean/)
  assert.doesNotMatch(unread, /Commit identity: clean/)
})
