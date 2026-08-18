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
