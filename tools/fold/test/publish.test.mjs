// Publishing, and every way it is allowed to fail (obot.agent#202).
//
// This is the one part of the fold that leaves the machine, so nothing here is
// assumed to have worked because a command exited zero, and no failure costs the
// record — the entry is on disk before any of this runs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeEntry, publishEntry } from '../lib/publish.mjs'
import { BOT_LOGIN, BOT_EMAIL, linksToBot } from '../../lib/identity.mjs'

const repo = () => {
  const d = mkdtempSync(join(tmpdir(), 'hub-'))
  const g = (...a) => execFileSync('git', ['-C', d, ...a], { stdio: 'ignore' })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't')
  mkdirSync(join(d, 'diary'), { recursive: true })
  writeFileSync(join(d, 'diary/README.md'), '# diary\n')
  g('add', '-A'); g('commit', '-q', '-m', 'init')
  return d
}

test('a hand-written entry is never replaced', () => {
  const hub = repo()
  writeFileSync(join(hub, 'diary/2026-08-18.md'), '# written by a person\n')
  const r = writeEntry(hub, '2026-08-18', '# by the fold\n')
  assert.equal(r.written, false)
  assert.match(readFileSync(join(hub, 'diary/2026-08-18.md'), 'utf8'), /by a person/)
})

test('a fresh day gets its entry', () => {
  const hub = repo()
  const r = writeEntry(hub, '2026-08-18', '# by the fold\n')
  assert.equal(r.written, true)
  assert.match(readFileSync(r.file, 'utf8'), /by the fold/)
})

test('it refuses to sweep unrelated work into its own commit', () => {
  const hub = repo()
  writeEntry(hub, '2026-08-18', '# entry\n')
  writeFileSync(join(hub, 'somebody-elses-work.md'), 'in progress\n')
  const r = publishEntry(hub, {
    date: '2026-08-18', paths: ['diary/2026-08-18.md'],
    mintToken: () => 'tok', message: 'diary',
  })
  assert.equal(r.committed, false)
  assert.match(r.why, /unrelated change/)
})

test('an empty token refuses to push rather than falling back to his credential', () => {
  const hub = repo()
  writeEntry(hub, '2026-08-18', '# entry\n')
  const r = publishEntry(hub, {
    date: '2026-08-18', paths: ['diary/2026-08-18.md'],
    mintToken: () => '', message: 'diary',
  })
  assert.equal(r.committed, true, 'the record still lands locally')
  assert.equal(r.pushed, false)
  assert.match(r.why, /refusing to push/)
  // obot.agent#207: an empty GH_TOKEN falls through to the ambient keyring and
  // the write is recorded as @jwildfire. One of those happened tonight.
})

test('the fold commit is authored by the bot, on the address that links to it', () => {
  // Until 2026-08-18 this commit carried a hand-written id belonging to a real GitHub
  // user, so every fold rendered the bot's name and linked to nobody. The id is now
  // resolved from tools/lib/identity.mjs; this is the guard that keeps it there
  // (obot.agent#241, jwildfire/obot.roadmap#260).
  const hub = repo()
  writeEntry(hub, '2026-08-18', '# entry\n')
  const r = publishEntry(hub, {
    date: '2026-08-18', paths: ['diary/2026-08-18.md'],
    mintToken: () => '', message: 'diary',
  })
  assert.equal(r.committed, true)
  const who = execFileSync('git', ['-C', hub, 'log', '-1', '--pretty=%an <%ae>'], { encoding: 'utf8' }).trim()
  assert.equal(who, `${BOT_LOGIN} <${BOT_EMAIL}>`)
  assert.equal(linksToBot(BOT_EMAIL), true)
})

test('a mint that throws leaves the commit and says so', () => {
  const hub = repo()
  writeEntry(hub, '2026-08-18', '# entry\n')
  const r = publishEntry(hub, {
    date: '2026-08-18', paths: ['diary/2026-08-18.md'],
    mintToken: () => { throw new Error('no Keychain item for service obot-github-app') },
    message: 'diary',
  })
  assert.equal(r.committed, true)
  assert.equal(r.pushed, false)
  assert.match(r.why, /Keychain/)
})

test('nothing staged is reported as nothing, not as success', () => {
  const hub = repo()
  const r = publishEntry(hub, {
    date: '2026-08-18', paths: ['diary/2026-08-18.md'],
    mintToken: () => 'tok', message: 'diary',
  })
  assert.equal(r.committed, false)
  assert.equal(r.pushed, false)
  assert.match(r.why, /nothing to commit/)
})

test('a clone behind origin is fast-forwarded before anything is committed', () => {
  const { hub, origin } = pair()
  // Somebody merged on GitHub since this clone last looked — which is the normal
  // state here, because nothing pulls it.
  execFileSync('git', ['-C', origin, 'commit', '-q', '--allow-empty', '-m', 'landed elsewhere'], { stdio: 'ignore' })
  writeEntry(hub, '2026-08-18', '# entry\n')
  const r = publishEntry(hub, {
    date: '2026-08-18', paths: ['diary/2026-08-18.md'],
    mintToken: () => 'unused-in-this-test', message: 'diary',
  })
  assert.equal(r.fastForwarded, true)
  assert.equal(r.committed, true)
  const log = execFileSync('git', ['-C', hub, 'log', '--format=%s', '-3'], { encoding: 'utf8' })
  assert.match(log, /landed elsewhere/, 'the commit sits ON TOP of what was already published')
})

test('a clone carrying unpushed local history is reported, never forced', () => {
  const { hub } = pair()
  execFileSync('git', ['-C', hub, 'commit', '-q', '--allow-empty', '-m', 'somebody was working here'], { stdio: 'ignore' })
  writeEntry(hub, '2026-08-18', '# entry\n')
  const r = publishEntry(hub, {
    date: '2026-08-18', paths: ['diary/2026-08-18.md'],
    mintToken: () => 'tok', message: 'diary',
  })
  assert.equal(r.committed, false)
  assert.match(r.why, /ahead of origin\/main/)
})

function pair() {
  const origin = mkdtempSync(join(tmpdir(), 'origin-'))
  const g = (d, ...a) => execFileSync('git', ['-C', d, ...a], { stdio: 'ignore' })
  g(origin, 'init', '-q', '-b', 'main')
  g(origin, 'config', 'user.email', 't@t'); g(origin, 'config', 'user.name', 't')
  g(origin, 'config', 'receive.denyCurrentBranch', 'ignore')
  mkdirSync(join(origin, 'diary'), { recursive: true })
  writeFileSync(join(origin, 'diary/README.md'), '# diary\n')
  g(origin, 'add', '-A'); g(origin, 'commit', '-q', '-m', 'init')

  const hub = mkdtempSync(join(tmpdir(), 'clone-'))
  execFileSync('git', ['clone', '-q', origin, hub], { stdio: 'ignore' })
  g(hub, 'config', 'user.email', 't@t'); g(hub, 'config', 'user.name', 't')
  return { hub, origin }
}

test('an unreachable origin does not stop the record landing locally', () => {
  const hub = repo()   // no remote at all — the offline case
  writeEntry(hub, '2026-08-18', '# entry\n')
  const r = publishEntry(hub, {
    date: '2026-08-18', paths: ['diary/2026-08-18.md'],
    mintToken: () => '', message: 'diary',
  })
  assert.equal(r.committed, true, 'being unable to reach GitHub is when the entry most needs saving')
  assert.equal(r.pushed, false)
  assert.ok(r.offline, 'and the fold says it could not reach origin')
})
