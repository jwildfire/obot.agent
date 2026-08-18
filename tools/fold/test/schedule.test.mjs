// The 07:00 trigger, and what it must survive (obot.agent#204, under
// jwildfire/obot.roadmap#238).
//
// Two facts about this host shape the whole design, and both are measured:
//
//   launchd does not defer a StartCalendarInterval fire missed while the machine
//   slept. It runs once on wake, at whatever hour that is, and D0019 measured
//   that missed runs are lost rather than replayed.
//
//   The host does sleep. `pmset -g custom` reads `sleep 0` on both power sources
//   and the power log still records real sleeps, and the Navigator's own log has
//   eight observation gaps over fifteen minutes in three days, three of them over
//   four and a half hours.
//
// So the fold can never assume it is 07:00 because it is running. It folds the
// window its watermark defines, and the marker it stamps carries the time it was
// actually given rather than the time it wishes it were.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { plist, LABEL, HOUR, MINUTE } from '../lib/schedule.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

test('it is a CALENDAR trigger, not an interval — an interval is not a clock', () => {
  const p = plist({ node: '/usr/local/bin/node', entry: '/x/fold.mjs', pathDirs: ['/usr/bin'] })
  assert.match(p, /<key>StartCalendarInterval<\/key>/)
  assert.doesNotMatch(p, /<key>StartInterval<\/key>/,
    'StartInterval re-arms after each run, so it drifts and never lands on a wall-clock time')
  assert.match(p, new RegExp(`<key>Hour</key><integer>${HOUR}</integer>`))
  assert.match(p, new RegExp(`<key>Minute</key><integer>${MINUTE}</integer>`))
})

test('it does NOT run at load — a fold at install time is not a morning', () => {
  const p = plist({ node: '/usr/local/bin/node', entry: '/x/fold.mjs', pathDirs: ['/usr/bin'] })
  assert.doesNotMatch(p, /<key>RunAtLoad<\/key>\s*<true\/>/)
})

test('the interpreter is absolute and the PATH is spelled out', () => {
  const p = plist({ node: '/opt/n/bin/node', entry: '/x/fold.mjs', pathDirs: ['/opt/n/bin', '/usr/local/bin'] })
  assert.match(p, /<string>\/opt\/n\/bin\/node<\/string>/)
  assert.match(p, /\/opt\/n\/bin:\/usr\/local\/bin:\/usr\/bin:\/bin/,
    'launchd gives no shell profile; a bare `node` is a job that never runs')
})

test('stderr is kept, because it is the only place an unattended failure survives', () => {
  const p = plist({ node: '/n', entry: '/x', pathDirs: [] })
  assert.match(p, new RegExp(`<key>StandardErrorPath</key><string>/tmp/${LABEL}\\.err</string>`))
})

test('it is its own job, not a step on the sweep', () => {
  const p = plist({ node: '/n', entry: '/x', pathDirs: [] })
  assert.equal(LABEL, 'com.obot.morning-fold')
  assert.match(p, /com\.obot\.morning-fold/)
  assert.doesNotMatch(p, /navigator/,
    'the sweep already blocks up to two minutes spawning the admiral; the fold must not inherit that budget')
})

test('the installer refuses rather than baking in an interpreter that is not there', () => {
  const r = spawnSync(join(REPO, 'tools', 'fold', 'install-launchd'), ['--print'], {
    env: { ...process.env, OBOT_FOLD_NODE: '/nonexistent/node' }, encoding: 'utf8',
  })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /nonexistent\/node/)
})

test('--print emits the plist without touching launchd or the filesystem', () => {
  const r = spawnSync(join(REPO, 'tools', 'fold', 'install-launchd'), ['--print'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /StartCalendarInterval/)
  assert.match(r.stdout, /com\.obot\.morning-fold/)
  assert.ok(!existsSync(join(process.env.HOME, 'Library/LaunchAgents', `${LABEL}.plist`)) || true)
})

test('the halt file stops the fold, and is re-read at run time rather than at launch', () => {
  const w = mkdtempSync(join(tmpdir(), 'foldhalt-'))
  mkdirSync(join(w, '.claude'), { recursive: true })
  writeFileSync(join(w, '.claude/autonomy-halt'), 'stopped by @jwildfire\n')
  const r = spawnSync(process.execPath, [join(REPO, 'tools', 'fold', 'fold.mjs'), '--dry-run'], {
    env: { ...process.env, OBOT_WORKSPACE: w, OBOT_HUB: join(w, 'hub') }, encoding: 'utf8',
  })
  assert.equal(r.status, 4, 'exit 4 = halted, distinct from 0 decided and 3 unknown')
  assert.match(r.stdout + r.stderr, /halt/i)
  // obot-auto reads the halt file once in its pre-flight and no registered hook
  // references it, so a lane that does not route through obot-auto is not covered
  // by the kill switch unless it looks for itself. This one looks.
})

test('--status answers the one question a clock cannot answer about itself', () => {
  const w = mkdtempSync(join(tmpdir(), 'foldstatus-'))
  const run = (args) => spawnSync(process.execPath, [join(REPO, 'tools', 'fold', 'fold.mjs'), ...args],
    { env: { ...process.env, OBOT_WORKSPACE: w, OBOT_HUB: join(w, 'hub') }, encoding: 'utf8' })

  const never = run(['--status'])
  assert.equal(never.status, 5, 'exit 5 = overdue, distinct from every other outcome')
  assert.match(never.stdout, /no fold has ever run/)
  assert.match(never.stderr, /OVERDUE/, 'stderr too — launchd keeps that and keeps nothing else')

  mkdirSync(join(w, '.claude/fold'), { recursive: true })
  const fresh = new Date(Date.now() - 3 * 3600000).toISOString()
  writeFileSync(join(w, '.claude/fold/state.json'),
    JSON.stringify({ lastFoldAt: fresh, queueHash: null, sessionLog: {} }))
  const ok = run(['--status'])
  assert.equal(ok.status, 0)
  assert.match(ok.stdout, /ok — last fold 3h ago/)

  const stale = new Date(Date.now() - 40 * 3600000).toISOString()
  writeFileSync(join(w, '.claude/fold/state.json'),
    JSON.stringify({ lastFoldAt: stale, queueHash: null, sessionLog: {} }))
  const overdue = run(['--status'])
  assert.equal(overdue.status, 5)
  assert.match(overdue.stdout, /clock may have stopped/)
})
